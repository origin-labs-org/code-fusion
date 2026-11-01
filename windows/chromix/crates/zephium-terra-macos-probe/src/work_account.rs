//! Explicit account qualification in a fresh probe profile. Account contents
//! remain in the ephemeral Work store; only closed counters leave this adapter.
mod approval;
use std::{
    io::{Read, Write},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex, OnceLock,
    },
    time::Duration,
};
use zephium_core::{
    ids::ProfileId,
    work::{runtime::*, search::*, *},
};
use zephium_ipc::work::*;
use zephium_work_composition::MacosWorkComposition;

fn stage_label(line: &str) -> Option<&str> {
    Some(match line {
        "human:resume_stage:plan"
        | "human:resume_stage:account"
        | "human:resume_stage:remaining"
        | "human:resume_stage:access"
        | "human:resume_stage:deadline"
        | "human:resume_stage:compile"
        | "human:resume_stage:decisions"
        | "human:resume_stage:spec"
        | "human:resume_stage:prepare"
        | "human:resume_stage:queue"
        | "compile:profile"
        | "compile:budget"
        | "compile:navigation"
        | "compile:capacity"
        | "compile:fields"
        | "compile:extraction"
        | "compile:findings"
        | "human:wall_cleared"
        | "human:successor_queued"
        | "close:recovery"
        | "close:cancel_requested"
        | "close:cancel_read_failed"
        | "close:attempt_deadline"
        | "close:abandoned"
        | "close:entry_declined"
        | "close:unconfirmed_commit"
        | "close:uncertain"
        | "close:retired"
        | "close:lost" => line,
        "human:resume_refused:Invalid"
        | "human:resume_refused:Capacity"
        | "human:resume_refused:Unavailable"
        | "human:resume_refused:OutcomeUnknown"
        | "human:resume_refused:Conflict" => line,
        value if value.starts_with("compile:admission:") => "compile:admission",
        value if value.starts_with("human:resume_refused:") => "human:resume_refused",
        value if value.starts_with("close:human_wait:") => "close:human_wait",
        value if value.starts_with("close:not_ready:") => "close:not_ready",
        value if value.starts_with("close:terminal:") => "close:terminal",
        _ => return None,
    })
}

pub(super) fn stage(line: &str) {
    let Some(label) = stage_label(line) else {
        return;
    };
    let _ = writeln!(
        std::io::stdout().lock(),
        "account-probe: stage={label}; content=redacted"
    );
}

fn model_event_label(event: zephium_agent_controller::AgentWorkEventKind) -> Option<String> {
    use zephium_agent_controller::AgentWorkEventKind as Event;
    Some(match event {
        Event::ToolProposed(kind) => format!("tool:{kind:?}"),
        Event::NavigationRefused(reason) => format!("navigation_refused:{reason:?}"),
        Event::ModelRequestedHuman(reason) => format!("human_requested:{reason:?}"),
        Event::ActionProposalRefused(error) => {
            use zephium_agentic::SemanticActionBindingError as Error;
            let kind = match error {
                Error::CredentialBoundary => "credential_boundary",
                Error::AssignmentDenied => "assignment_denied",
                Error::TaskEffectMismatch(_) => "effect_mismatch",
                Error::Reference(_) => "reference",
                Error::TargetIncomplete => "target_incomplete",
                Error::ValueUnobserved => "value_unobserved",
                Error::OutcomeContract => "outcome_contract",
                Error::BudgetExhausted => "budget",
                _ => "other",
            };
            format!("action_refused:{kind}")
        }
        Event::InspectionRefused => "inspection_refused".into(),
        Event::ExtractionCorrected => "extraction_corrected".into(),
        Event::ExtractionDropped { values } => format!("extraction_dropped:{values}"),
        Event::Verified => "verified".into(),
        _ => return None,
    })
}

pub(super) fn model_event(event: zephium_agent_controller::AgentWorkEventKind) {
    if let Some(label) = model_event_label(event) {
        let _ = writeln!(
            std::io::stdout().lock(),
            "account-probe: event={label}; content=redacted"
        );
    }
}

pub(super) struct Account {
    origin: &'static str,
    start: String,
    entry: String,
    input: Mutex<mpsc::Receiver<Input>>,
    stopped: Arc<AtomicBool>,
    send: bool,
    approval: Mutex<approval::Gate>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Input {
    Check,
    Stop,
}
static ACCOUNT: OnceLock<Account> = OnceLock::new();
pub(super) fn active() -> Option<&'static Account> {
    ACCOUNT.get()
}
fn origin(url: &str) -> Option<&'static str> {
    [
        "https://app.slack.com/",
        "https://app.todoist.com/",
        "https://linear.app/",
    ]
    .into_iter()
    .find(|origin| url.starts_with(origin))
    .filter(|_| {
        url.len() <= 1024
            && url.is_ascii()
            && !url
                .bytes()
                .any(|b| b.is_ascii_control() || b == b' ' || b == b'\\' || b == b'?' || b == b'#')
    })
}
/// Shows every sign-in or check page a lead run hands to the person in the
/// probe window, so they can sign in once; the run resumes by itself.
pub(super) async fn present_human_pages(
    composition: &MacosWorkComposition,
    profile: ProfileId,
    work: WorkId,
) {
    let mut presented = Vec::new();
    loop {
        tokio::time::sleep(Duration::from_millis(300)).await;
        let Ok(pages) = composition.human_pages(profile, work) else {
            continue;
        };
        for page in pages {
            if presentable_reason(page.reason)
                && page.phase == WorkHumanPhaseV1::WaitingForHuman
                && !presented.contains(&page.id)
            {
                let result = composition.present_human_page(
                    profile,
                    work,
                    page.id,
                    WorkHumanRegionV1 {
                        x: 0,
                        y: 0,
                        width: 760,
                        height: 640,
                    },
                );
                let _ = writeln!(
                    std::io::stdout().lock(),
                    "lead-person: presented {:?} page ok={}; content=redacted",
                    page.reason,
                    result.is_ok()
                );
                presented.push(page.id);
            }
        }
    }
}

fn presentable_reason(reason: WorkHumanReasonV1) -> bool {
    matches!(
        reason,
        WorkHumanReasonV1::SignIn | WorkHumanReasonV1::Challenge
    )
}
fn command(bytes: &[u8]) -> Option<Input> {
    match bytes {
        b"check" => Some(Input::Check),
        b"stop" => Some(Input::Stop),
        _ => None,
    }
}
fn route_command(bytes: &[u8], tx: &mpsc::SyncSender<Input>, stopped: &AtomicBool) {
    match command(bytes) {
        Some(Input::Stop) => stopped.store(true, Ordering::Release),
        Some(Input::Check) => {
            let _ = tx.try_send(Input::Check);
        }
        None => {}
    }
}
async fn unless_stopped<T>(
    stopped: &AtomicBool,
    task: impl std::future::Future<Output = T>,
) -> Option<T> {
    tokio::select! {
        result = task => Some(result),
        _ = async { while !stopped.load(Ordering::Acquire) { tokio::time::sleep(Duration::from_millis(25)).await; } } => None,
    }
}
pub(super) fn configure(url: &str) -> Result<String, &'static str> {
    configure_mode(url, false)
}
pub(super) fn configure_send(url: &str) -> Result<String, &'static str> {
    if !slack_channel(url) {
        return Err("account_send_fixture");
    }
    configure_mode(url, true)
}
fn slack_channel(url: &str) -> bool {
    let Some(path) = url.strip_prefix("https://app.slack.com/client/") else {
        return false;
    };
    let Some((team, channel)) = path.split_once('/') else {
        return false;
    };
    [(team, 'T'), (channel, 'C')]
        .into_iter()
        .all(|(id, prefix)| {
            (2..=40).contains(&id.len())
                && id.starts_with(prefix)
                && id
                    .bytes()
                    .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit())
        })
}
fn configure_mode(url: &str, send: bool) -> Result<String, &'static str> {
    let origin = origin(url).ok_or("account_site")?;
    // No inherited profile, seeded cookies, debug/export or model override.
    if std::env::vars_os().any(|(key, _)| key.to_string_lossy().starts_with("ZEPHIUM_")) {
        return Err("account_environment");
    }
    let host = origin.trim_start_matches("https://").trim_end_matches('/');
    let entry =
        zephium_app::work_sites::entry_question_for(&[zephium_app::work_sites::service_name(host)])
            .0;
    let (tx, rx) = mpsc::sync_channel(4);
    let stopped = Arc::new(AtomicBool::new(false));
    let input_stop = stopped.clone();
    std::thread::Builder::new()
        .name("account-probe-input".into())
        .spawn(move || {
            let mut line = [0u8; 32];
            let mut length = 0usize;
            let mut byte = [0u8; 1];
            while std::io::stdin().read_exact(&mut byte).is_ok() {
                if byte[0] == b'\n' {
                    if length <= line.len() {
                        route_command(&line[..length], &tx, &input_stop);
                    }
                    line.fill(0);
                    length = 0;
                } else {
                    if length < line.len() {
                        line[length] = byte[0];
                    }
                    length = length.saturating_add(1);
                }
            }
            // Losing the interactive control channel cannot leave an account
            // task running without someone able to stop or review it.
            input_stop.store(true, Ordering::Release);
        })
        .map_err(|_| "account_input")?;
    ACCOUNT
        .set(Account {
            origin,
            start: url.to_owned(),
            entry,
            input: Mutex::new(rx),
            stopped,
            send,
            approval: Mutex::new(approval::Gate::default()),
        })
        .map_err(|_| "account_duplicate")?;
    if send {
        return Ok(slack_send_request(url));
    }
    Ok(format!(
        "Open my test account at {url} with the Browser helper and read only the currently visible channel, inbox or issue list. If sign-in or MFA is needed, hand the live page to me and resume after native verification. Summarize at most three visible items with sources, or report honestly what blocks access. Do not search, substitute documentation, use Computer, type into account content, send, create, edit or delete anything.\nExplain the previous result from recorded state and evidence. If access was blocked, say exactly what is needed; do not retry or open a new page just to explain."
    ))
}
pub(super) fn slack_send_request(url: &str) -> String {
    super::work_site::slack_send_request(url, approval::MESSAGE)
}

impl Account {
    pub(super) fn report(&self, execution: &WorkExecutionFact) {
        let confirmations = execution
            .steps
            .iter()
            .filter_map(|step| match &step.kind {
                WorkStepKindV1::Confirm { confirm } => Some(confirm),
                _ => None,
            })
            .collect::<Vec<_>>();
        let _ = writeln!(
            std::io::stdout().lock(),
            "account-probe: approved={} declined={} run_grants={}; content=redacted",
            confirmations
                .iter()
                .filter(|c| c.decision == Some(WorkConfirmDecisionV1::Approved))
                .count(),
            confirmations
                .iter()
                .filter(|c| c.decision == Some(WorkConfirmDecisionV1::Declined))
                .count(),
            confirmations
                .iter()
                .filter(|c| c.decision == Some(WorkConfirmDecisionV1::AllowedForRun))
                .count()
        );
        for part in &execution.parts {
            use zephium_core::work::parts::WorkPartNeedV1;
            let need = match &part.need {
                None => "none",
                Some(WorkPartNeedV1::SignIn { .. }) => "sign_in",
                Some(WorkPartNeedV1::Check { .. }) => "check",
                Some(WorkPartNeedV1::AllowSite { .. }) => "allow_site",
                Some(WorkPartNeedV1::ChooseFolder) => "choose_folder",
                Some(WorkPartNeedV1::AllowFolder { .. }) => "allow_folder",
                Some(WorkPartNeedV1::UseConnection { .. }) => "use_connection",
                Some(WorkPartNeedV1::Connect { .. }) => "connect",
                Some(WorkPartNeedV1::Retry { .. }) => "retry",
            };
            let _ = writeln!(
                std::io::stdout().lock(),
                "account-probe: part_state={:?} need={need}; content=redacted",
                part.state
            );
        }
        for (index, step) in execution
            .steps
            .iter()
            .filter(|s| matches!(s.kind, WorkStepKindV1::Read { .. }))
            .enumerate()
        {
            let _ = writeln!(
                std::io::stdout().lock(),
                "account-probe: page={} status={:?} outcome={:?} native_actions={:?} planner_calls={:?}; content=redacted",
                index + 1,
                step.status,
                step.measurements.as_ref().and_then(|m| m.outcome),
                step.measurements.as_ref().map(|m| m.native_actions),
                step.measurements.as_ref().map(|m| m.planner_calls)
            );
            if let WorkStepKindV1::Read { goal, .. } = &step.kind {
                let text = goal.as_deref().unwrap_or_default().to_ascii_lowercase();
                let words: Vec<_> = text.split(|c: char| !c.is_ascii_alphabetic()).collect();
                let _ = writeln!(std::io::stdout().lock(), "account-probe: page={} task_goal={} send_word={} prepare_word={} approval_word={} exact_fixture={}; content=redacted",
                    index + 1, goal.is_some(), words.contains(&"send"), words.contains(&"prepare"),
                    words.iter().any(|word| matches!(*word, "approve" | "approval" | "confirmation")),
                    text.contains(&approval::MESSAGE.to_ascii_lowercase()));
            }
        }
    }
    pub(super) fn stopped(&self) -> bool {
        self.stopped.load(Ordering::Acquire)
    }
    pub(super) fn permits(
        &self,
        request: &zephium_app::work_agent::WorkAgentBrowseRequest,
    ) -> bool {
        request.private_run
            && request.session == zephium_app::work_sites::SiteSession::Private
            && matches!(&request.step, WorkStepKindV1::Read { url, .. } if origin(url) == Some(self.origin))
            && (!self.send
                || matches!(&request.step, WorkStepKindV1::Read { url, .. } if url == &self.start))
    }
    fn answer(&self, kind: &WorkStepKindV1) -> Option<String> {
        match kind {
            WorkStepKindV1::Ask {
                prompt,
                options,
                answer: None,
                purpose,
                ..
            } => {
                let answer = if *purpose == Some(WorkAskPurposeV1::Entry)
                    && *prompt == self.entry
                    && options.iter().any(|o| o == "Allow")
                {
                    // The CLI invocation authorizes this one named test site.
                    "Allow"
                } else if *purpose == Some(WorkAskPurposeV1::Question) {
                    if self.send {
                        "Use only the disposable test channel named in the request; wait for explicit confirmation for the exact fixture message."
                    } else {
                        "Read only the specified account page. Do not make changes."
                    }
                } else {
                    "Not now"
                };
                Some(answer.into())
            }
            _ => None,
        }
    }
    pub(super) async fn person(
        &self,
        handle: &zephium_app::Handle,
        composition: &MacosWorkComposition,
        profile: ProfileId,
        work: WorkId,
    ) {
        let mut presented = Vec::new();
        let mut previous = None;
        let mut review: Option<approval::Review> = None;
        loop {
            tokio::time::sleep(Duration::from_millis(100)).await;
            let input = self.input.lock().ok().and_then(|rx| rx.try_recv().ok());
            let decision = if review.as_ref().is_some_and(approval::Review::ready) {
                let decision = match review.as_mut() {
                    Some(review) => review.finish().await,
                    None => continue,
                };
                review = None;
                Some(decision)
            } else {
                None
            };
            let mut decision_pages = std::collections::BTreeSet::new();
            if let Ok(pages) = composition.human_pages(profile, work) {
                decision_pages.extend(
                    pages
                        .iter()
                        .filter(|page| {
                            page.reason == WorkHumanReasonV1::UserDecision
                                && page.phase == WorkHumanPhaseV1::WaitingForHuman
                        })
                        .map(|page| page.id.step),
                );
                if let Some(page) = pages.iter().find(|page| {
                    presentable_reason(page.reason)
                        && matches!(
                            page.phase,
                            WorkHumanPhaseV1::WaitingForHuman
                                | WorkHumanPhaseV1::Presenting
                                | WorkHumanPhaseV1::Presented
                        )
                }) {
                    let state = (page.id, page.phase, page.reason);
                    if previous != Some(state) {
                        let _ = writeln!(
                            std::io::stdout().lock(),
                            "account-probe: handoff={:?} phase={:?}; content=redacted",
                            page.reason,
                            page.phase
                        );
                        previous = Some(state);
                    }
                    if page.phase == WorkHumanPhaseV1::WaitingForHuman
                        && !presented.contains(&page.id)
                    {
                        if composition
                            .present_human_page(
                                profile,
                                work,
                                page.id,
                                WorkHumanRegionV1 {
                                    x: 0,
                                    y: 0,
                                    width: 760,
                                    height: 640,
                                },
                            )
                            .is_ok()
                        {
                            presented.push(page.id);
                        }
                    }
                    if input == Some(Input::Check) {
                        if let Some(result) = unless_stopped(
                            &self.stopped,
                            composition.check_human_page(profile, work, page.id),
                        )
                        .await
                        {
                            let _ = writeln!(
                                std::io::stdout().lock(),
                                "account-probe: native_check={result:?}; content=redacted"
                            );
                        }
                    }
                }
            }
            let Ok(request) = handle.work_projection(profile, work) else {
                continue;
            };
            let Ok(response) =
                tokio::time::timeout(Duration::from_millis(200), request.response(profile)).await
            else {
                continue;
            };
            let WorkReplyV1::Projection { projection } = response.reply else {
                continue;
            };
            let Some(execution) = projection
                .executions
                .iter()
                .rev()
                .find(|e| !e.status.terminal())
            else {
                self.clear_offer();
                review = None;
                continue;
            };
            // Invalidate even a queued approval if its original confirmation or
            // retained approval page disappeared between observations.
            let candidate = self
                .send
                .then(|| {
                    execution.steps.iter().find(|step| {
                        step.status == WorkStepStatus::Running
                            && matches!(&step.kind, WorkStepKindV1::Confirm { confirm }
                        if approval::Gate::eligible(confirm) && confirm.page.is_some_and(|page| decision_pages.contains(&page)))
                    })
                })
                .flatten();
            if candidate.is_none() || self.stopped() {
                self.clear_offer();
                review = None;
            }
            let intent = if self.stopped() {
                Some(WorkRuntimeIntent::Cancel {
                    execution: execution.id,
                    intervention: None,
                })
            } else {
                execution.steps.iter().find_map(|step| {
                    if step.status != WorkStepStatus::Running {
                        return None;
                    }
                    if let Some(answer) = self.answer(&step.kind) {
                        return Some(WorkRuntimeIntent::AnswerStep {
                            execution: execution.id,
                            step: step.id,
                            answer,
                        });
                    }
                    let waiting = match &step.kind {
                        WorkStepKindV1::Confirm { confirm } => confirm.decision.is_none(),
                        kind => kind.proposes_write() && kind.file_decision().is_none(),
                    };
                    if waiting && self.send {
                        if let WorkStepKindV1::Confirm { confirm } = &step.kind {
                            if approval::Gate::eligible(confirm) {
                                if !confirm.page.is_some_and(|page| decision_pages.contains(&page)) { return None; }
                                let mut gate = self.approval.lock().ok()?;
                                if let Some((offer, fresh)) = gate.offer(execution.id, step.id, confirm) {
                                    if fresh {
                                        review = Some(approval::Review::start(offer, &self.start, confirm));
                                        let _ = writeln!(std::io::stdout().lock(), "account-probe: approval_offer={offer}; native_review=open; content=redacted");
                                    }
                                    let decision = decision?;
                                    let approve = gate.decide(decision, execution.id, step.id, confirm)?;
                                    return Some(WorkRuntimeIntent::ApproveStep {
                                        execution: execution.id, step: step.id, approve, for_run: false,
                                    });
                                }
                            }
                        }
                    }
                    waiting.then_some(WorkRuntimeIntent::ApproveStep {
                        execution: execution.id,
                        step: step.id,
                        approve: false,
                        for_run: false,
                    })
                })
            };
            if let Some(intent) = intent {
                if let Ok(request) = handle.work_command(
                    profile,
                    WorkCommandV1 {
                        version: 1,
                        work,
                        expected_revision: projection.work.revision,
                        command: WorkCommandId::generate(),
                        intent,
                    },
                ) {
                    let _ =
                        tokio::time::timeout(Duration::from_millis(200), request.response(profile))
                            .await;
                }
            }
        }
    }
    fn clear_offer(&self) {
        if let Ok(mut gate) = self.approval.lock() {
            gate.clear();
        }
    }
}
pub(super) struct NoSearch;
impl WorkPublicSearchProvider for NoSearch {
    fn search<'a>(
        &'a self,
        _: &'a WorkPublicSearchScope,
        _: &'a [zephium_core::work::context::WorkContextBody],
        _: WorkExecutionLimits,
    ) -> WorkPublicSearchFuture<'a> {
        Box::pin(async { Err(WorkPublicSearchError::NotDispatched(WorkError::Unavailable)) })
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn account_stage_diagnostics_never_include_arbitrary_details() {
        assert_eq!(
            stage_label("human:resume_refused:Invalid"),
            Some("human:resume_refused:Invalid")
        );
        for (prefix, closed) in [
            ("human:resume_refused:", "human:resume_refused"),
            ("compile:admission:", "compile:admission"),
            ("close:human_wait:", "close:human_wait"),
            ("close:not_ready:", "close:not_ready"),
            ("close:terminal:", "close:terminal"),
        ] {
            assert_eq!(
                stage_label(&format!("{prefix}private fixture detail")),
                Some(closed)
            );
        }
        assert_eq!(stage_label("private fixture detail"), None);
        assert_eq!(
            stage_label("human:wall_cleared private fixture detail"),
            None
        );
    }
    #[test]
    fn account_events_export_only_closed_operations_and_refusal_classes() {
        use zephium_agent_controller::AgentWorkEventKind as Event;
        use zephium_agentic::{AgentBrowserToolKind, SemanticActionBindingError};
        assert_eq!(
            model_event_label(Event::ToolProposed(AgentBrowserToolKind::ShowForHuman)).as_deref(),
            Some("tool:ShowForHuman")
        );
        assert_eq!(
            model_event_label(Event::ActionProposalRefused(
                SemanticActionBindingError::CredentialBoundary
            ))
            .as_deref(),
            Some("action_refused:credential_boundary")
        );
        assert_eq!(
            model_event_label(Event::ObservationFacts {
                nodes: 123,
                text_bytes: 456,
                dialogs: 1,
                complete: true
            }),
            None
        );
    }

    #[test]
    fn native_presentation_never_advances_a_hidden_approval_handoff() {
        assert!(presentable_reason(WorkHumanReasonV1::SignIn));
        assert!(presentable_reason(WorkHumanReasonV1::Challenge));
        for reason in [
            WorkHumanReasonV1::Permission,
            WorkHumanReasonV1::Verification,
            WorkHumanReasonV1::UserDecision,
            WorkHumanReasonV1::SensitiveEffect,
            WorkHumanReasonV1::UnsupportedInteraction,
        ] {
            assert!(!presentable_reason(reason));
        }
    }
    #[test]
    fn account_origins_and_input_are_closed() {
        assert_eq!(
            origin("https://app.slack.com/client/T0/C0"),
            Some("https://app.slack.com/")
        );
        assert!(origin("https://app.todoist.com/app/inbox").is_some());
        assert!(origin("https://linear.app/test/team").is_some());
        for bad in [
            "https://app.slack.com.evil.test/",
            "https://app.slack.com@evil.test/",
            "https://app.slack.com:443/",
            "http://app.slack.com/",
            "https://app.slack.com/\\evil",
            "https://app.slack.com/?token=test",
            "https://app.slack.com/#token=test",
        ] {
            assert!(origin(bad).is_none());
        }
        assert!(command(b"check").is_some());
        assert!(command(b"stop").is_some());
        for bad in [b"approve".as_slice(), b"continue", b"allow", b"password"] {
            assert!(command(bad).is_none());
        }
    }
    #[test]
    fn only_the_exact_native_entry_question_can_be_allowed() {
        let (_, rx) = mpsc::sync_channel(1);
        let account = Account {
            origin: "https://app.slack.com/",
            start: "https://app.slack.com/client/T0/C0".into(),
            entry: "Work in your Slack?".into(),
            input: Mutex::new(rx),
            stopped: Arc::new(AtomicBool::new(false)),
            send: false,
            approval: Mutex::new(approval::Gate::default()),
        };
        let ask = |prompt: &str, purpose| WorkStepKindV1::Ask {
            prompt: prompt.into(),
            options: vec!["Allow".into(), "Not now".into()],
            answer: None,
            purpose: Some(purpose),
        };
        assert_eq!(
            account
                .answer(&ask("Work in your Slack?", WorkAskPurposeV1::Entry))
                .as_deref(),
            Some("Allow")
        );
        assert_eq!(
            account
                .answer(&ask("Work in your Gmail?", WorkAskPurposeV1::Entry))
                .as_deref(),
            Some("Not now")
        );
        assert_eq!(
            account
                .answer(&ask("Work in your Slack?", WorkAskPurposeV1::Confirm))
                .as_deref(),
            Some("Not now")
        );
    }
    #[tokio::test]
    async fn stop_bypasses_full_input_queue_and_a_pending_native_check() {
        let (tx, rx) = mpsc::sync_channel(4);
        let stop = AtomicBool::new(false);
        for _ in 0..8 {
            route_command(b"check", &tx, &stop);
        }
        route_command(b"stop", &tx, &stop);
        assert!(stop.load(Ordering::Acquire));
        assert_eq!(rx.try_iter().count(), 4);
        let result = tokio::time::timeout(
            Duration::from_millis(100),
            unless_stopped(&stop, std::future::pending::<()>()),
        )
        .await;
        assert!(matches!(result, Ok(None)));
    }
    #[test]
    fn sending_and_sign_in_share_one_execution_without_a_preliminary_read_run() {
        let request = slack_send_request("https://app.slack.com/client/TTEST/CCHANNEL");
        let runs = request.lines().collect::<Vec<_>>();
        assert_eq!(runs.len(), 2);
        assert_eq!(runs[0].matches(approval::MESSAGE).count(), 1);
        assert!(runs[0].contains("wait for the normal explicit confirmation"));
        assert!(runs[0].contains("Never resend"));
        assert!(!runs[1].contains(approval::MESSAGE));
        assert!(runs[1].contains("Do not send or retry"));
    }

    #[test]
    fn send_fixture_is_a_named_channel_and_stdin_cannot_approve() {
        assert!(slack_channel("https://app.slack.com/client/T0/C0"));
        for bad in [
            "https://app.slack.com/client/T0/D0",
            "https://app.slack.com/client/T0/C0/extra",
            "https://app.slack.com/client/T0/C0?token=x",
            "https://app.slack.com/client/T0/C0#x",
            "https://app.slack.com/client/T0/",
            "https://linear.app/client/T0/C0",
        ] {
            assert!(!slack_channel(bad));
        }
        let (tx, rx) = mpsc::sync_channel(4);
        let stop = AtomicBool::new(false);
        route_command(b"approve 1", &tx, &stop);
        assert!(rx.try_recv().is_err());
    }
}
