//! Opt-in, release-excluded public-form final-state qualification.
//! A timed-out observer never invents native callback drain or a network proof.
use super::*;
#[cfg(test)]
use crate::platform::form_qualification::target;
use crate::platform::form_qualification::{selection, NavigationAudit};
use crate::platform::work_document_navigation::{WorkDocumentNavigation, WorkDocumentStamp};
use objc2::runtime::AnyObject;
use objc2_foundation::{MainThreadMarker, NSError, NSString};
use std::sync::Mutex;
use wry::WebViewExtMacOS as _;

const SOURCE: &str = include_str!("work_form_oracle.js");
const LIMIT: Duration = Duration::from_secs(2);

#[derive(Default)]
pub(super) enum State {
    #[default]
    Unstarted,
    Waiting(Box<Pending>),
    Finished,
}
#[derive(Default)]
struct Completion {
    returned: bool,
    timed_out: bool,
    checks: Option<Receipt>,
}
impl Completion {
    fn expire(&mut self) {
        self.timed_out = true;
        self.checks = None;
    }
    fn settle(&mut self, checks: Option<Receipt>) -> bool {
        if self.returned {
            return false;
        }
        self.returned = true;
        if !self.timed_out {
            self.checks = checks;
        }
        true
    }
}
pub(super) struct Pending {
    case: &'static str,
    url: &'static str,
    gate: WorkDocumentNavigation,
    stamp: WorkDocumentStamp,
    invocation: u64,
    started: Instant,
    completion: Arc<Mutex<Completion>>,
    watchdog: Option<crate::platform::imp::ContentPolicyTimeout>,
    reported: bool,
}

fn admission_current(
    session: Option<&zephium_agentic::WorkBrowserSession>,
    healthy: bool,
    ready: bool,
    isolated_public: bool,
    work_website_data: bool,
) -> bool {
    healthy
        && ready
        && isolated_public
        && !work_website_data
        && session.is_some_and(zephium_agentic::WorkBrowserSession::is_current)
}
#[derive(Debug, PartialEq)]
struct Receipt {
    checks: Vec<Option<bool>>,
    no_task_submit: Option<bool>,
}
fn boolean(value: &serde_json::Value) -> Option<Option<bool>> {
    if value.is_null() {
        Some(None)
    } else {
        value.as_bool().map(Some)
    }
}
fn decode(case: &str, bytes: &str) -> Option<Receipt> {
    if bytes.len() > 256 {
        return None;
    }
    let value: serde_json::Value = serde_json::from_str(bytes).ok()?;
    let object = value.as_object()?;
    if object.len() != 3 || object.get("version")?.as_u64()? != 1 {
        return None;
    }
    let checks = object.get("checks")?.as_array()?;
    let expected = match case {
        "form-httpbin-draft" => 11,
        "form-selenium-controls" | "form-expand-inputs" => 3,
        "form-selenium-date" | "form-heroku-numeric" | "form-heroku-checkboxes" => 2,
        _ => 1,
    };
    if checks.len() != expected {
        return None;
    }
    Some(Receipt {
        checks: checks.iter().map(boolean).collect::<Option<Vec<_>>>()?,
        no_task_submit: boolean(object.get("no_task_submit")?)?,
    })
}
#[allow(clippy::print_stderr)]
fn report(
    resource: &WorkNativeResource,
    pending: &Pending,
    receipt: Option<&Receipt>,
    reason: &'static str,
) {
    let identity = resource.guard.resource().identity();
    let evidence = serde_json::json!({
        "version":1, "case":pending.case,
        "profile":format!("{:?}", identity.profile()),
        "work":format!("{:?}", identity.work()),
        "context":format!("{:?}", identity.context()),
        "document":format!("{:?}", pending.stamp), "invocation":pending.invocation,
        "checks":receipt.map(|value| &value.checks), "reason":reason,
        "no_task_submit_event":receipt.and_then(|value| value.no_task_submit),
        "submission_scope":"observed_main_document_events; closed_shadow_roots_unobserved",
        "observer_ms":pending.started.elapsed().as_millis(),
        "effects":effects(resource).json(), "background_http_activity":"not_measured_or_claimed",
        "content_exported":false
    });
    eprintln!("form-oracle: {evidence}");
}

fn effects(resource: &WorkNativeResource) -> crate::platform::form_qualification::Evidence {
    let mut navigation = resource
        .view
        .as_ref()
        .and_then(|view| view.work_navigation())
        .and_then(|gate| gate.form_probe_evidence())
        .unwrap_or(NavigationAudit {
            uncertain: true,
            ..Default::default()
        });
    if !resource.guard.is_healthy() {
        navigation.uncertain = true;
    }
    resource.form_actions.evidence(navigation)
}
#[allow(clippy::print_stderr)]
fn report_effects(resource: &WorkNativeResource, case: &'static str) {
    let evidence = serde_json::json!({"version":1,"case":case,"effects":effects(resource).json(),"content_exported":false});
    eprintln!("form-effects: {evidence}");
}

pub(super) fn before_retire(resource: &mut WorkNativeResource) -> bool {
    let mut state = std::mem::take(&mut resource.form_oracle);
    let already_finished = matches!(state, State::Finished);
    let ready = state.progress(resource);
    if ready && !already_finished {
        if let Some((case, _)) = selection() {
            report_effects(resource, case);
        }
    }
    resource.form_oracle = state;
    ready
}
impl State {
    fn progress(&mut self, resource: &mut WorkNativeResource) -> bool {
        match self {
            Self::Finished => true,
            Self::Unstarted => {
                let selection = selection();
                let Some((case, url)) = selection else {
                    *self = Self::Finished;
                    return true;
                };
                // No sampling of cancelled, uncertain, session-backed or different pages.
                if !admission_current(
                    resource.guard.anonymous_session(),
                    resource.guard.is_healthy(),
                    resource.ready(),
                    resource.guard.isolated_public(),
                    resource.guard.work_website_data(),
                ) || resource.last_invocation == 0
                {
                    *self = Self::Finished;
                    return true;
                }
                if resource.observation.is_some()
                    || resource.action.is_some()
                    || resource.navigation.is_some()
                    || resource.history_back_pending()
                {
                    // A diagnostic cannot delay existing cleanup to manufacture
                    // an idle sampling point. Missing final evidence stays unknown.
                    *self = Self::Finished;
                    return true;
                }
                let Some(view) = resource.view.as_ref() else {
                    *self = Self::Finished;
                    return true;
                };
                if crate::platform::imp::current_url(view.view()).as_deref() != Some(url) {
                    *self = Self::Finished;
                    return true;
                }
                let Some(gate) = view.work_navigation().cloned() else {
                    *self = Self::Finished;
                    return true;
                };
                let Some(stamp) = gate.document_stamp() else {
                    *self = Self::Finished;
                    return true;
                };
                let Some(_mtm) = MainThreadMarker::new() else {
                    *self = Self::Finished;
                    return true;
                };
                let Some(world) = view.form_observer_world() else {
                    *self = Self::Finished;
                    return true;
                };
                let completion = Arc::new(Mutex::new(Completion::default()));
                let expired = completion.clone();
                let wake = resource.guard.clone();
                let watchdog =
                    crate::platform::imp::schedule_content_policy_timeout(LIMIT, move || {
                        let mut state = expired
                            .lock()
                            .unwrap_or_else(std::sync::PoisonError::into_inner);
                        state.expire();
                        drop(state);
                        notify_work_resource(wake);
                    });
                if watchdog.is_none() {
                    *self = Self::Finished;
                    return true;
                }
                let returned = completion.clone();
                let wake = resource.guard.clone();
                let callback: block2::RcBlock<dyn Fn(*mut AnyObject, *mut NSError)> =
                    block2::RcBlock::new(move |value: *mut AnyObject, error: *mut NSError| {
                        // SAFETY: WebKit supplies live callback objects on the main thread.
                        let checks = if error.is_null() {
                            unsafe { value.as_ref() }
                                .and_then(AnyObject::downcast_ref::<NSString>)
                                .filter(|text| text.length() <= 256)
                                .and_then(|text| decode(case, &text.to_string()))
                        } else {
                            None
                        };
                        let mut state = returned
                            .lock()
                            .unwrap_or_else(std::sync::PoisonError::into_inner);
                        if !state.settle(checks) {
                            return;
                        }
                        drop(state);
                        let queued = wake.clone();
                        wake.dispatch_notification(move || notify_work_resource(queued));
                    });
                let source = NSString::from_str(
                    &SOURCE.replace("__FORM_ORACLE_CASE__", &format!("\"{case}\"")),
                );
                // SAFETY: attested exact active private world, fixed allowlisted read-only source, exact
                // owned live main-frame view; the callback owns only bounded evidence.
                let dispatched = objc2::exception::catch(std::panic::AssertUnwindSafe(|| unsafe {
                    view.view()
                        .webview()
                        .evaluateJavaScript_inFrame_inContentWorld_completionHandler(
                            &source,
                            None,
                            &world,
                            Some(&callback),
                        );
                }))
                .is_ok();
                if !dispatched {
                    // An exceptional native dispatch cannot prove callback absence.
                    completion
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner)
                        .timed_out = true;
                }
                *self = Self::Waiting(Box::new(Pending {
                    case,
                    url,
                    gate,
                    stamp,
                    invocation: resource.last_invocation,
                    started: Instant::now(),
                    completion,
                    watchdog,
                    reported: false,
                }));
                false
            }
            Self::Waiting(pending) => {
                let completion = pending
                    .completion
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                if !completion.returned && !completion.timed_out {
                    return false;
                }
                let expired = completion.timed_out || pending.started.elapsed() > LIMIT;
                let current = admission_current(
                    resource.guard.anonymous_session(),
                    resource.guard.is_healthy(),
                    resource.ready(),
                    resource.guard.isolated_public(),
                    resource.guard.work_website_data(),
                ) && pending.gate.document_stamp() == Some(pending.stamp)
                    && resource.last_invocation == pending.invocation
                    && resource.view.as_ref().is_some_and(|view| {
                        crate::platform::imp::current_url(view.view()).as_deref()
                            == Some(pending.url)
                    });
                if !pending.reported {
                    let reason = if expired {
                        "timed_out"
                    } else if !current {
                        "stale_document"
                    } else if completion.checks.is_none() {
                        "unavailable"
                    } else {
                        "observed"
                    };
                    report(
                        resource,
                        pending,
                        if current && !expired {
                            completion.checks.as_ref()
                        } else {
                            None
                        },
                        reason,
                    );
                    pending.reported = true;
                }
                if !completion.returned {
                    return false;
                }
                drop(completion);
                pending.watchdog = None;
                *self = Self::Finished;
                true
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn revoked_or_expired_session_cannot_sample_a_healthy_ready_page() {
        let session = zephium_agentic::WorkBrowserSession::new(
            zephium_core::ids::ProfileId::generate(),
            zephium_agentic::WorkId::generate(),
            Instant::now() + Duration::from_secs(10),
        );
        assert!(admission_current(Some(&session), true, true, true, false));
        assert!(
            !admission_current(Some(&session), true, true, false, false),
            "profile/account store is excluded"
        );
        assert!(
            !admission_current(Some(&session), true, true, true, true),
            "persistent Work store is excluded"
        );
        session.close();
        assert!(!admission_current(Some(&session), true, true, true, false));
        let expired = zephium_agentic::WorkBrowserSession::new(
            zephium_core::ids::ProfileId::generate(),
            zephium_agentic::WorkId::generate(),
            Instant::now(),
        );
        assert!(!admission_current(Some(&expired), true, true, true, false));
        assert!(!admission_current(None, true, true, true, false));
    }
    #[test]
    fn timeout_keeps_callback_debt_and_late_or_duplicate_results_cannot_pass() {
        let mut timed_out = Completion::default();
        timed_out.expire();
        assert!(!timed_out.returned, "a timeout is not callback return");
        assert!(timed_out.settle(Some(Receipt {
            checks: vec![Some(true)],
            no_task_submit: Some(true)
        })));
        assert!(timed_out.returned);
        assert!(timed_out.checks.is_none(), "late content stays unavailable");
        let mut completed = Completion::default();
        assert!(completed.settle(Some(Receipt {
            checks: vec![Some(false)],
            no_task_submit: Some(true)
        })));
        assert!(!completed.settle(Some(Receipt {
            checks: vec![Some(true)],
            no_task_submit: Some(true)
        })));
        assert_eq!(
            completed.checks,
            Some(Receipt {
                checks: vec![Some(false)],
                no_task_submit: Some(true)
            })
        );
    }
    #[test]
    fn form_payload_is_closed_boolean_evidence_only() {
        assert_eq!(
            decode(
                "form-expand-inputs",
                r#"{"version":1,"checks":[true,false,null],"no_task_submit":true}"#
            ),
            Some(Receipt {
                checks: vec![Some(true), Some(false), None],
                no_task_submit: Some(true)
            })
        );
        for invalid in [
            r#"{"version":1,"checks":["private"]}"#,
            r#"{"version":1,"checks":[],"value":"secret"}"#,
            r#"{"version":2,"checks":[true]}"#,
        ] {
            assert!(decode("form-expand-inputs", invalid).is_none());
        }
        assert!(target("https://example.com").is_none());
        assert!(target("form-heroku-numeric").is_some());
    }
}
