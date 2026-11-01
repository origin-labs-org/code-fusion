//! Additional revocation at model dispatch; never a source or pixel grant.
use std::sync::{Arc, Mutex};
use tokio::sync::Notify;
use zephium_core::work::model::WorkModelImageFence;

/// Host-owned switch whose changes invalidate every previously issued fence.
/// A pending/unconfirmed write is closed, including a pending enable.
#[derive(Clone)]
pub struct ModelImageGate(Arc<Inner>);
struct Inner {
    state: Mutex<State>,
    changed: Notify,
}
struct State {
    epoch: u64,
    enabled: Option<bool>,
    exhausted: bool,
}
impl ModelImageGate {
    /// Initializes only from a confirmed host setting; `None` is unavailable.
    pub fn new(enabled: Option<bool>) -> Self {
        Self(Arc::new(Inner {
            state: Mutex::new(State {
                epoch: 1,
                enabled,
                exhausted: false,
            }),
            changed: Notify::new(),
        }))
    }
    /// Closes immediately before a setting change is queued. No old fence can
    /// survive this transition, even if persistence fails or the value repeats.
    pub fn begin_change(&self) -> Option<u64> {
        let result = self.0.state.lock().ok().and_then(|mut state| {
            state.enabled = None;
            let Some(next) = state.epoch.checked_add(1) else {
                state.exhausted = true;
                return None;
            };
            if state.exhausted {
                return None;
            }
            state.epoch = next;
            Some(state.epoch)
        });
        self.0.changed.notify_waiters();
        result
    }
    /// Confirms the exact pending write from authoritative readback. Stale
    /// callbacks cannot re-enable a later pending/disabled epoch.
    pub fn confirm(&self, epoch: u64, enabled: bool) -> bool {
        let changed = self.0.state.lock().is_ok_and(|mut state| {
            if state.exhausted || state.epoch != epoch || state.enabled.is_some() {
                return false;
            }
            state.enabled = Some(enabled);
            true
        });
        self.0.changed.notify_waiters();
        changed
    }
    /// Current opt-in state, without minting disclosure or native authority.
    pub fn enabled(&self) -> bool {
        self.0
            .state
            .lock()
            .is_ok_and(|state| state.enabled == Some(true))
    }
    /// Captures the current epoch as an additional dispatch fence. The caller
    /// must separately authorize the exact native image/source before use.
    pub fn fence(&self) -> Option<Arc<dyn WorkModelImageFence>> {
        let state = self.0.state.lock().ok()?;
        (state.enabled == Some(true)).then(|| {
            Arc::new(Fence {
                inner: self.0.clone(),
                epoch: state.epoch,
            }) as Arc<dyn WorkModelImageFence>
        })
    }
}
struct Fence {
    inner: Arc<Inner>,
    epoch: u64,
}
impl WorkModelImageFence for Fence {
    fn while_current(&self, operation: &mut dyn FnMut()) -> bool {
        let Ok(state) = self.inner.state.lock() else {
            return false;
        };
        if state.epoch != self.epoch || state.enabled != Some(true) {
            return false;
        }
        operation();
        true
    }
    fn revoked(&self) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send + '_>> {
        Box::pin(async move {
            loop {
                let notified = self.inner.changed.notified();
                tokio::pin!(notified);
                notified.as_mut().enable();
                if !self.while_current(&mut || {}) {
                    return;
                }
                notified.await;
            }
        })
    }
}
impl std::fmt::Debug for ModelImageGate {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ModelImageGate")
            .field("enabled", &self.enabled())
            .finish()
    }
}

/// Polls a provider send only while the original image permission is current.
/// Revocation serializes with each synchronous poll, never with a network wait.
pub(crate) async fn fenced<F: std::future::Future>(
    fence: Option<&Arc<dyn WorkModelImageFence>>,
    future: F,
) -> Result<F::Output, ()> {
    let Some(fence) = fence else {
        return Ok(future.await);
    };
    tokio::pin!(future);
    let drive = std::future::poll_fn(|cx| {
        let mut result = None;
        let allowed = fence.while_current(&mut || result = Some(future.as_mut().poll(cx)));
        if !allowed {
            return std::task::Poll::Ready(Err(()));
        }
        match result {
            Some(result) => result.map(Ok),
            None => std::task::Poll::Ready(Err(())),
        }
    });
    tokio::select! {
        biased;
        () = fence.revoked() => Err(()),
        result = drive => result,
    }
}

pub(crate) fn request_has_image(request: &zephium_core::work::model::WorkModelRequest) -> bool {
    use zephium_core::work::model::{WorkModelMessage, WorkModelPart};
    request.messages.iter().any(|message| match message {
        WorkModelMessage::User(parts) | WorkModelMessage::Assistant(parts) => {
            parts.iter().any(|part| match part {
                WorkModelPart::Image { .. } => true,
                WorkModelPart::Replay(value) => replay_has_image(value),
                _ => false,
            })
        }
        WorkModelMessage::ToolResults(_) => false,
    })
}
pub(crate) fn provider_body_has_image(body: &[u8]) -> bool {
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(body) else {
        return true;
    };
    ["input", "messages"]
        .iter()
        .any(|key| value.get(*key).is_some_and(replay_has_image))
}
pub(crate) async fn revoked(fence: Option<&Arc<dyn WorkModelImageFence>>) {
    match fence {
        Some(fence) => fence.revoked().await,
        None => std::future::pending().await,
    }
}
fn replay_has_image(root: &serde_json::Value) -> bool {
    use serde_json::Value;
    let mut pending = vec![(root, 0_u8)];
    let mut visited = 0_usize;
    while let Some((value, depth)) = pending.pop() {
        visited += 1;
        if visited > 4096 || depth > 32 {
            return true;
        }
        match value {
            Value::Object(fields) => {
                if fields
                    .keys()
                    .any(|key| matches!(key.as_str(), "image_url" | "inlineData" | "inline_data"))
                    || fields
                        .get("type")
                        .and_then(Value::as_str)
                        .is_some_and(|kind| {
                            matches!(kind, "image" | "input_image" | "output_image")
                        })
                {
                    return true;
                }
                if pending.len().saturating_add(fields.len()) > 4096 {
                    return true;
                }
                pending.extend(fields.values().map(|value| (value, depth + 1)));
            }
            Value::Array(items) => {
                if pending.len().saturating_add(items.len()) > 4096 {
                    return true;
                }
                pending.extend(items.iter().map(|value| (value, depth + 1)));
            }
            _ => {}
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    fn current(fence: &dyn WorkModelImageFence) -> bool {
        fence.while_current(&mut || {})
    }
    #[test]
    fn pending_writes_and_old_readbacks_fail_closed() {
        let gate = ModelImageGate::new(Some(true));
        let old = gate.fence().unwrap();
        let first = gate.begin_change().unwrap();
        assert!(!gate.enabled());
        assert!(gate.fence().is_none());
        assert!(!current(old.as_ref()));
        let second = gate.begin_change().unwrap();
        assert!(!gate.confirm(first, true));
        assert!(!gate.enabled());
        assert!(gate.confirm(second, false));
        assert!(!gate.enabled());
        assert!(!gate.confirm(second, true));
    }
    #[test]
    fn off_then_on_never_resurrects_any_old_image_history_fence() {
        let gate = ModelImageGate::new(Some(true));
        let old = gate.fence().unwrap();
        let off = gate.begin_change().unwrap();
        assert!(gate.confirm(off, false));
        let on = gate.begin_change().unwrap();
        assert!(gate.confirm(on, true));
        assert!(!current(old.as_ref()));
        assert!(current(gate.fence().unwrap().as_ref()));
    }
    #[test]
    fn unavailable_and_exhausted_epochs_never_issue_a_fence() {
        let gate = ModelImageGate::new(None);
        assert!(gate.fence().is_none());
        gate.0.state.lock().unwrap().epoch = u64::MAX;
        assert!(gate.begin_change().is_none());
        assert!(!gate.enabled());
        assert!(!gate.confirm(u64::MAX, true));
        assert!(gate.fence().is_none());
    }
    #[tokio::test]
    async fn revocation_wakes_an_active_image_call_and_closes_queued_poll() {
        let gate = ModelImageGate::new(Some(true));
        let fence = gate.fence().unwrap();
        let revoked = fence.revoked();
        tokio::pin!(revoked);
        assert!(futures_util::poll!(revoked.as_mut()).is_pending());
        gate.begin_change().unwrap();
        tokio::time::timeout(std::time::Duration::from_millis(100), revoked)
            .await
            .unwrap();
        let mut dispatched = false;
        assert!(!fence.while_current(&mut || dispatched = true));
        assert!(!dispatched);
    }
    #[test]
    fn body_gate_checks_actual_input_modality_not_tool_schema_or_plain_text() {
        let text = serde_json::json!({"tools":[{"properties":{"image_url":{"type":"string"}}}],"input":[{"role":"user","content":[{"type":"input_text","text":"data:image/png is a URL prefix"}]}]});
        assert!(!provider_body_has_image(
            &serde_json::to_vec(&text).unwrap()
        ));
        let image = serde_json::json!({"input":[{"role":"user","content":[{"type":"input_image","image_url":"data:image/png;base64,eA=="}]}]});
        assert!(provider_body_has_image(
            &serde_json::to_vec(&image).unwrap()
        ));
        assert!(provider_body_has_image(b"malformed"));
    }

    #[test]
    fn old_replay_images_and_unbounded_replay_require_a_live_fence() {
        use zephium_core::work::model::*;
        let mut request = super::super::tests::request(WorkModelWire::OpenAiResponses, "fixture");
        assert!(request_has_image(&request));
        for value in [
            serde_json::json!({"type":"input_image","image_url":"data:image/png;base64,eA=="}),
            serde_json::json!({"nested":{"inlineData":{"mimeType":"image/png","data":"eA=="}}}),
            serde_json::json!([]),
        ] {
            request.messages = vec![WorkModelMessage::Assistant(vec![WorkModelPart::Replay(
                value.clone(),
            )])];
            assert_eq!(request_has_image(&request), !value.is_array());
        }
        request.messages = vec![WorkModelMessage::Assistant(vec![WorkModelPart::Replay(
            serde_json::Value::Array(vec![serde_json::Value::Null; 4097]),
        )])];
        assert!(request_has_image(&request));
        request.messages = vec![WorkModelMessage::User(vec![WorkModelPart::Text(
            "Use page text".into(),
        )])];
        assert!(!request_has_image(&request));
    }
    #[tokio::test]
    async fn disabled_or_unfenced_image_requests_never_resolve_credentials() {
        use super::super::*;
        struct NeverCredential;
        impl LeadCredential for NeverCredential {
            fn secret(&self) -> LeadSecretFuture<'_> {
                panic!("image refusal must precede credentials/network");
            }
        }
        let client = LeadClient::new(
            LeadTarget::direct(WorkModelProvider::OpenAi).unwrap(),
            Arc::new(NeverCredential),
            None,
        );
        let mut request = tests::request(WorkModelWire::OpenAiResponses, "fixture");
        request.image_fence = None;
        assert!(matches!(
            client.call(request.clone(), &|_| {}).await,
            Err(WorkModelError::BadRequest)
        ));
        let gate = ModelImageGate::new(Some(true));
        request.image_fence = gate.fence();
        gate.begin_change().unwrap();
        assert!(matches!(
            client.call(request, &|_| {}).await,
            Err(WorkModelError::Cancelled)
        ));
    }
    #[tokio::test]
    async fn transport_poll_cannot_run_after_revocation_or_revive_after_enable() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let gate = ModelImageGate::new(Some(true));
        let fence = gate.fence().unwrap();
        let polls = AtomicUsize::new(0);
        let send = std::future::poll_fn(|_| {
            polls.fetch_add(1, Ordering::SeqCst);
            std::task::Poll::<()>::Pending
        });
        let call = fenced(Some(&fence), send);
        tokio::pin!(call);
        assert!(futures_util::poll!(call.as_mut()).is_pending());
        let before = polls.load(Ordering::SeqCst);
        let pending = gate.begin_change().unwrap();
        gate.confirm(pending, true);
        assert_eq!(call.await, Err(()));
        assert_eq!(polls.load(Ordering::SeqCst), before);
    }
}
