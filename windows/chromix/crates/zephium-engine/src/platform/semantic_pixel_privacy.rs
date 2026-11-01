//! Content-free native pixel fence shared by both platform capture adapters.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]
use std::{
    cell::RefCell,
    rc::Rc,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
use zephium_agentic::SemanticScreenshotNativeFailure;

pub(crate) const INVOCATION: &str = "P1:privacy";
pub(crate) const PUBLIC_INVOCATION: &str = "P1:public";
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct PixelPrivacyProof {
    v: u8,
    r: u64,
    c: bool,
    public_page: Option<bool>,
    w: f64,
    h: f64,
    x: f64,
    y: f64,
}
impl PixelPrivacyProof {
    pub(crate) fn decode(bytes: &[u8]) -> Option<Self> {
        Self::decode_mode(bytes, false)
    }
    /// Additional account-workflow exclusion only. Never storage/consent proof.
    pub(crate) fn decode_public(bytes: &[u8]) -> Option<Self> {
        Self::decode_mode(bytes, true)
    }
    fn decode_mode(bytes: &[u8], public: bool) -> Option<Self> {
        if bytes.len() > 512 {
            return None;
        }
        let value: serde_json::Value = serde_json::from_slice(bytes).ok()?;
        let object = value.as_object()?;
        if object.len() != if public { 8 } else { 7 } {
            return None;
        }
        let proof = Self {
            v: object.get("v")?.as_u64()?.try_into().ok()?,
            r: object.get("r")?.as_u64()?,
            c: object.get("c")?.as_bool()?,
            public_page: if public {
                Some(object.get("a")?.as_bool()?)
            } else {
                None
            },
            w: object.get("w")?.as_f64()?,
            h: object.get("h")?.as_f64()?,
            x: object.get("x")?.as_f64()?,
            y: object.get("y")?.as_f64()?,
        };
        (proof.v == 1
            && proof.r > 0
            && proof.r <= 9_007_199_254_740_991
            && [proof.w, proof.h, proof.x, proof.y]
                .iter()
                .all(|x| x.is_finite())
            && proof.w > 0.0
            && proof.h > 0.0
            && proof.w <= 16384.0
            && proof.h <= 16384.0)
            .then_some(proof)
    }
    pub(crate) fn viewport(self) -> (f64, f64) {
        (self.w, self.h)
    }
    pub(crate) fn clear(self) -> bool {
        self.c
    }
}
pub(crate) type PrivacyCompletion = Box<dyn FnOnce(Option<PixelPrivacyProof>)>;
type CaptureResult<T> = Result<T, SemanticScreenshotNativeFailure>;
pub(crate) type CaptureCompletion<T> = Box<dyn FnOnce(CaptureResult<T>)>;

/// Both surveys execute on the same private runtime. Navigation is fenced by
/// the owner independently; these revisions also fence input and DOM changes.
pub(crate) fn guarded_capture<T: 'static>(
    probe: Rc<dyn Fn(PrivacyCompletion)>,
    capture: impl FnOnce(CaptureCompletion<T>) -> Result<(), SemanticScreenshotNativeFailure> + 'static,
    cancelled: Arc<AtomicBool>,
    completion: impl FnOnce(CaptureResult<T>) + 'static,
) {
    guarded_capture_inner(None, false, probe, capture, cancelled, completion)
}
/// Crops additionally require the fresh pre-capture survey to match the exact
/// native element/rectangle admission proof, before any pixels are captured.
pub(crate) fn guarded_capture_at<T: 'static>(
    expected: PixelPrivacyProof,
    probe: Rc<dyn Fn(PrivacyCompletion)>,
    capture: impl FnOnce(CaptureCompletion<T>) -> Result<(), SemanticScreenshotNativeFailure> + 'static,
    cancelled: Arc<AtomicBool>,
    completion: impl FnOnce(CaptureResult<T>) + 'static,
) {
    guarded_capture_inner(Some(expected), false, probe, capture, cancelled, completion)
}
/// Native-only linear proof: constructed exclusively after matching public
/// privacy samples bracketed this exact capture value. No public attestation
/// setter or constructor is exposed outside this private engine module.
pub(crate) struct ModelCapture<T> {
    capture: T,
    public: bool,
}
impl<T> ModelCapture<T> {
    pub(crate) fn capture(&self) -> &T {
        &self.capture
    }
    pub(crate) fn public_survey(&self) -> bool {
        self.public
    }
    pub(crate) fn into_capture(self) -> T {
        self.capture
    }
}
impl<T> std::fmt::Debug for ModelCapture<T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ModelCapture([private native receipt])")
    }
}

/// Model viewport proof with the same common privacy checks. This private
/// wrapper is distinct from local crop outputs and carries no consent grant.
pub(crate) fn guarded_model_capture<T: 'static>(
    public: bool,
    probe: Rc<dyn Fn(PrivacyCompletion)>,
    capture: impl FnOnce(CaptureCompletion<T>) -> Result<(), SemanticScreenshotNativeFailure> + 'static,
    cancelled: Arc<AtomicBool>,
    completion: impl FnOnce(CaptureResult<ModelCapture<T>>) + 'static,
) {
    if public {
        guarded_public_capture(probe, capture, cancelled, completion);
    } else {
        guarded_capture(probe, capture, cancelled, move |result| {
            completion(result.map(|capture| ModelCapture {
                capture,
                public: false,
            }))
        });
    }
}

/// Additional public-workflow survey, only after native storage/task admission.
/// A missing public bit cannot fall back to ordinary privacy clearance.
pub(crate) fn guarded_public_capture<T: 'static>(
    probe: Rc<dyn Fn(PrivacyCompletion)>,
    capture: impl FnOnce(CaptureCompletion<T>) -> Result<(), SemanticScreenshotNativeFailure> + 'static,
    cancelled: Arc<AtomicBool>,
    completion: impl FnOnce(CaptureResult<ModelCapture<T>>) + 'static,
) {
    guarded_capture_inner(None, true, probe, capture, cancelled, move |result| {
        completion(result.map(|capture| ModelCapture {
            capture,
            public: true,
        }))
    })
}
fn guarded_capture_inner<T: 'static>(
    expected: Option<PixelPrivacyProof>,
    public: bool,
    probe: Rc<dyn Fn(PrivacyCompletion)>,
    capture: impl FnOnce(CaptureCompletion<T>) -> Result<(), SemanticScreenshotNativeFailure> + 'static,
    cancelled: Arc<AtomicBool>,
    completion: impl FnOnce(CaptureResult<T>) + 'static,
) {
    let finish = Rc::new(RefCell::new(Some(
        Box::new(completion) as CaptureCompletion<T>
    )));
    let after_probe = probe.clone();
    probe(Box::new(move |before| {
        let Some(before) = before
            .filter(|proof| proof.clear() && expected.is_none_or(|expected| *proof == expected))
        else {
            complete(&finish, Err(SemanticScreenshotNativeFailure::Stale));
            return;
        };
        if public && before.public_page != Some(true) {
            complete(
                &finish,
                Err(SemanticScreenshotNativeFailure::ConsentRequired),
            );
            return;
        }
        if cancelled.load(Ordering::Acquire) {
            complete(&finish, Err(SemanticScreenshotNativeFailure::Cancelled));
            return;
        }
        let after_finish = finish.clone();
        let failure = capture(Box::new(move |outcome| {
            if outcome.is_err() {
                complete(&after_finish, outcome);
                return;
            }
            after_probe(Box::new(move |after| {
                let outcome = if cancelled.load(Ordering::Acquire) {
                    Err(SemanticScreenshotNativeFailure::Cancelled)
                } else if after != Some(before) {
                    Err(SemanticScreenshotNativeFailure::Stale)
                } else {
                    outcome
                };
                complete(&after_finish, outcome);
            }));
        }));
        if let Err(failure) = failure {
            complete(&finish, Err(failure));
        }
    }));
}
fn complete<T>(finish: &Rc<RefCell<Option<CaptureCompletion<T>>>>, outcome: CaptureResult<T>) {
    let callback = finish.borrow_mut().take();
    if let Some(callback) = callback {
        callback(outcome);
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn proof_is_closed_bounded_and_revision_sensitive() {
        let proof =
            PixelPrivacyProof::decode(br#"{"v":1,"r":1,"c":true,"w":1280,"h":800,"x":0,"y":0}"#)
                .unwrap();
        assert!(proof.clear());
        assert_ne!(
            Some(proof),
            PixelPrivacyProof::decode(br#"{"v":1,"r":2,"c":true,"w":1280,"h":800,"x":0,"y":0}"#)
        );
        assert!(PixelPrivacyProof::decode(
            br#"{"v":1,"r":1,"c":true,"w":1280,"h":800,"x":0,"y":0,"value":"secret"}"#
        )
        .is_none());
    }
    #[test]
    fn unsafe_or_missing_survey_never_starts_capture() {
        for response in [
            None,
            PixelPrivacyProof::decode(br#"{"v":1,"r":1,"c":false,"w":1280,"h":800,"x":0,"y":0}"#),
            PixelPrivacyProof::decode(
                br#"{"v":1,"r":9007199254740991,"c":false,"w":1280,"h":800,"x":0,"y":0}"#,
            ),
            PixelPrivacyProof::decode(
                br#"{"v":1,"r":9007199254740992,"c":true,"w":1280,"h":800,"x":0,"y":0}"#,
            ),
        ] {
            let completed = Rc::new(RefCell::new(false));
            let result = completed.clone();
            guarded_capture::<()>(
                Rc::new(move |reply| reply(response)),
                |_| panic!("capture must not start"),
                Arc::new(AtomicBool::new(false)),
                move |outcome| {
                    assert!(outcome.is_err());
                    *result.borrow_mut() = true;
                },
            );
            assert!(*completed.borrow());
        }
    }
}

#[cfg(test)]
mod lifecycle_tests {
    use super::*;
    fn proof() -> PixelPrivacyProof {
        PixelPrivacyProof::decode(br#"{"v":1,"r":1,"c":true,"w":1280,"h":800,"x":0,"y":0}"#)
            .unwrap()
    }
    #[test]
    fn changed_missing_and_unsafe_post_capture_proofs_discard_pixels() {
        let original = proof();
        for after in [
            None,
            Some(PixelPrivacyProof { r: 2, ..original }),
            Some(PixelPrivacyProof {
                c: false,
                ..original
            }),
            Some(PixelPrivacyProof { x: 1.0, ..original }),
        ] {
            let count = Rc::new(RefCell::new(0));
            let calls = count.clone();
            let result = Rc::new(RefCell::new(None));
            let output = result.clone();
            guarded_capture(
                Rc::new(move |reply| {
                    let n = *calls.borrow();
                    *calls.borrow_mut() += 1;
                    reply(if n == 0 { Some(original) } else { after });
                }),
                |reply| {
                    reply(Ok("private pixels"));
                    Ok(())
                },
                Arc::new(AtomicBool::new(false)),
                move |reply| *output.borrow_mut() = Some(reply),
            );
            assert_eq!(*count.borrow(), 2);
            assert_eq!(
                *result.borrow(),
                Some(Err(SemanticScreenshotNativeFailure::Stale))
            );
        }
    }
    #[test]
    fn exact_proof_passes_and_cancellation_between_capture_and_delivery_revokes() {
        for cancelled in [false, true] {
            let cancel = Arc::new(AtomicBool::new(false));
            let inside = cancel.clone();
            let result = Rc::new(RefCell::new(None));
            let output = result.clone();
            guarded_capture(
                Rc::new(move |reply| reply(Some(proof()))),
                move |reply| {
                    inside.store(cancelled, Ordering::Release);
                    reply(Ok(7));
                    Ok(())
                },
                cancel,
                move |reply| *output.borrow_mut() = Some(reply),
            );
            assert_eq!(
                *result.borrow(),
                Some(if cancelled {
                    Err(SemanticScreenshotNativeFailure::Cancelled)
                } else {
                    Ok(7)
                })
            );
        }
    }
}

#[cfg(test)]
mod record_admission_tests {
    use super::*;
    #[test]
    fn changed_proof_after_record_admission_prevents_native_capture() {
        let expected =
            PixelPrivacyProof::decode(br#"{"v":1,"r":1,"c":true,"w":1280,"h":800,"x":0,"y":0}"#)
                .unwrap();
        let changed = PixelPrivacyProof { r: 2, ..expected };
        let result = Rc::new(RefCell::new(None));
        let output = result.clone();
        guarded_capture_at::<()>(
            expected,
            Rc::new(move |reply| reply(Some(changed))),
            |_| panic!("stale record must not capture pixels"),
            Arc::new(AtomicBool::new(false)),
            move |reply| *output.borrow_mut() = Some(reply),
        );
        assert_eq!(
            *result.borrow(),
            Some(Err(SemanticScreenshotNativeFailure::Stale))
        );
    }
}

#[cfg(test)]
mod record_cancellation_tests {
    use super::*;
    fn proof() -> PixelPrivacyProof {
        PixelPrivacyProof::decode(br#"{"v":1,"r":1,"c":true,"w":1280,"h":800,"x":0,"y":0}"#)
            .unwrap()
    }
    #[test]
    fn cancelled_record_never_starts_capture_or_publishes_bytes() {
        let result = Rc::new(RefCell::new(None));
        let output = result.clone();
        guarded_capture_at::<Vec<u8>>(
            proof(),
            Rc::new(move |reply| reply(Some(proof()))),
            |_| panic!("cancelled owner must not capture"),
            Arc::new(AtomicBool::new(true)),
            move |reply| *output.borrow_mut() = Some(reply),
        );
        assert_eq!(
            *result.borrow(),
            Some(Err(SemanticScreenshotNativeFailure::Cancelled))
        );
    }
    #[test]
    fn cancellation_during_capture_discards_private_bytes() {
        let flag = Arc::new(AtomicBool::new(false));
        let cancel = flag.clone();
        let result = Rc::new(RefCell::new(None));
        let output = result.clone();
        guarded_capture_at(
            proof(),
            Rc::new(move |reply| reply(Some(proof()))),
            move |reply| {
                cancel.store(true, Ordering::Release);
                reply(Ok(vec![7u8; 8]));
                Ok(())
            },
            flag,
            move |reply| *output.borrow_mut() = Some(reply),
        );
        assert_eq!(
            *result.borrow(),
            Some(Err(SemanticScreenshotNativeFailure::Cancelled))
        );
    }
    #[test]
    fn unsafe_or_mutated_post_capture_proof_discards_all_bytes() {
        for changed in [
            PixelPrivacyProof { r: 2, ..proof() },
            PixelPrivacyProof {
                c: false,
                ..proof()
            },
        ] {
            let calls = Rc::new(RefCell::new(0));
            let count = calls.clone();
            let result = Rc::new(RefCell::new(None));
            let output = result.clone();
            guarded_capture_at(
                proof(),
                Rc::new(move |reply| {
                    let n = *count.borrow();
                    *count.borrow_mut() += 1;
                    reply(Some(if n == 0 { proof() } else { changed }));
                }),
                |reply| {
                    reply(Ok(vec![7u8; 8]));
                    Ok(())
                },
                Arc::new(AtomicBool::new(false)),
                move |reply| *output.borrow_mut() = Some(reply),
            );
            assert_eq!(
                *result.borrow(),
                Some(Err(SemanticScreenshotNativeFailure::Stale))
            );
        }
    }
}

#[cfg(test)]
mod public_page_tests {
    use super::*;
    fn proof(public: bool) -> PixelPrivacyProof {
        PixelPrivacyProof::decode_public(
            format!(r#"{{"v":1,"r":1,"c":true,"a":{public},"w":1280,"h":800,"x":0,"y":0}}"#)
                .as_bytes(),
        )
        .unwrap()
    }
    #[test]
    fn public_decoder_requires_exact_boolean_and_legacy_decoder_remains_closed() {
        let public = br#"{"v":1,"r":1,"c":true,"a":true,"w":1280,"h":800,"x":0,"y":0}"#;
        assert!(PixelPrivacyProof::decode(public).is_none());
        assert!(PixelPrivacyProof::decode_public(public).is_some());
        for bytes in [
            br#"{"v":1,"r":1,"c":true,"w":1280,"h":800,"x":0,"y":0}"#.as_slice(),
            br#"{"v":1,"r":1,"c":true,"a":1,"w":1280,"h":800,"x":0,"y":0}"#,
            br#"{"v":1,"r":1,"c":true,"a":true,"w":1280,"h":800,"x":0,"y":0,"url":"private"}"#,
        ] {
            assert!(PixelPrivacyProof::decode_public(bytes).is_none());
        }
    }
    #[test]
    fn public_capture_refuses_account_or_legacy_proof_before_pixels() {
        let mut legacy = proof(true);
        legacy.public_page = None;
        for before in [proof(false), legacy] {
            let output = Rc::new(RefCell::new(None));
            let result = output.clone();
            guarded_public_capture::<()>(
                Rc::new(move |reply| reply(Some(before))),
                |_| panic!("account or unknown page must not capture"),
                Arc::new(AtomicBool::new(false)),
                move |value| *result.borrow_mut() = Some(value),
            );
            assert!(matches!(
                &*output.borrow(),
                Some(Err(SemanticScreenshotNativeFailure::ConsentRequired))
            ));
        }
    }
    #[test]
    fn account_transition_during_public_capture_discards_the_pixels() {
        let count = Rc::new(RefCell::new(0));
        let calls = count.clone();
        let output = Rc::new(RefCell::new(None));
        let result = output.clone();
        guarded_public_capture(
            Rc::new(move |reply| {
                let first = *calls.borrow() == 0;
                *calls.borrow_mut() += 1;
                reply(Some(proof(first)));
            }),
            |reply| {
                reply(Ok(7));
                Ok(())
            },
            Arc::new(AtomicBool::new(false)),
            move |value| *result.borrow_mut() = Some(value),
        );
        assert!(matches!(
            &*output.borrow(),
            Some(Err(SemanticScreenshotNativeFailure::Stale))
        ));
    }
}
