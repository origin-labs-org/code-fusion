//! Synthetic loopback-only human-handoff qualification. The fixture controller
//! changes its own page only after native Presented has been observed. It never
//! invokes Continue, injects production readiness, or handles real credentials.
use super::*;
use std::time::Instant;

const PREFIX: &str = "/human-fixture/";
const FACT: &str = "Fixture balance is 73 credits and the reference is J17";
const HOLD: Duration = Duration::from_secs(3);
const DEADLINE: Duration = Duration::from_secs(90);
// Closed server instructions; no production page or native callback uses these.
const WAIT: usize = 0;
const CLEAR_FIRST: usize = 1;
const NEXT_DOCUMENT: usize = 2;
const CLEAR_OLD_DOCUMENT: usize = 3;
const EMAIL_CODE: usize = 4;
static EMAIL_SHOWN: AtomicBool = AtomicBool::new(false);
static CONTROL: AtomicUsize = AtomicUsize::new(WAIT);
static CLEARED_DOCUMENT: AtomicUsize = AtomicUsize::new(0);
static POLLED_DOCUMENT: AtomicUsize = AtomicUsize::new(0);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum Scenario {
    SignIn,
    /// A sign-in that lands on an app routing by its fragment, as Gmail's
    /// `#inbox`.
    SignInHash,
    /// A sign-in that leaves the site for another one and comes back to a
    /// new document, as a provider's account pages do.
    SignInSites,
    EmailCode,
    Check,
    Unresolved,
    Cancel,
    StaleDocument,
    LongWait,
}
pub(super) const SCENARIOS: [Scenario; 9] = [
    Scenario::SignIn,
    Scenario::SignInHash,
    Scenario::SignInSites,
    Scenario::EmailCode,
    Scenario::Check,
    Scenario::Unresolved,
    Scenario::Cancel,
    Scenario::StaleDocument,
    Scenario::LongWait,
];
impl Scenario {
    fn name(self) -> &'static str {
        match self {
            Self::SignIn => "signin",
            Self::SignInHash => "signin-hash",
            Self::SignInSites => "signin-sites",
            Self::EmailCode => "email-code",
            Self::Check => "check",
            Self::Unresolved => "unresolved",
            Self::Cancel => "cancel",
            Self::StaleDocument => "stale",
            Self::LongWait => "long-wait",
        }
    }
    fn reason(self) -> WorkHumanReasonV1 {
        if self == Self::Check {
            WorkHumanReasonV1::Challenge
        } else {
            WorkHumanReasonV1::SignIn
        }
    }
    fn hold(self) -> Duration {
        if self == Self::LongWait {
            Duration::from_secs(35)
        } else {
            HOLD
        }
    }
    fn resumes(self) -> bool {
        matches!(
            self,
            Self::SignIn
                | Self::SignInHash
                | Self::SignInSites
                | Self::EmailCode
                | Self::Check
                | Self::LongWait
        )
    }
}

pub(super) struct Session {
    scenario: Scenario,
    started: Instant,
    id: Option<WorkHumanPageIdV1>,
    admitted: Option<(
        WorkExecutionId,
        WorkExecutionAuthorization,
        WorkExecutionSpec,
    )>,
    revision: Option<String>,
    presented_since: Option<Instant>,
    presented_samples: usize,
    signal_at: Option<Instant>,
    email_since: Option<Instant>,
    stale_revision: Option<String>,
    unresolved_held: bool,
    check_waiting: bool,
    check_clear: bool,
    cancel_sent: bool,
    cancel_millis: Option<u128>,
    failure: Option<&'static str>,
}
impl Session {
    fn new(scenario: Scenario) -> Self {
        Self {
            scenario,
            started: Instant::now(),
            id: None,
            admitted: None,
            revision: None,
            presented_since: None,
            presented_samples: 0,
            signal_at: None,
            email_since: None,
            stale_revision: None,
            unresolved_held: false,
            check_waiting: false,
            check_clear: false,
            cancel_sent: false,
            cancel_millis: None,
            failure: None,
        }
    }
    pub(super) fn execution_timeout_seconds(&self) -> u32 {
        if self.scenario == Scenario::LongWait {
            30
        } else {
            1200
        }
    }
    fn fail(&mut self, reason: &'static str) {
        self.failure.get_or_insert(reason);
    }
}

enum Action {
    None,
    Present(WorkHumanPageIdV1),
    Check(WorkHumanPageIdV1, bool),
    Cancel,
}

/// Returns only a fixture-local instruction for the specified synthetic document.
fn instruction(control: usize, document: usize) -> &'static str {
    match (control, document) {
        (CLEAR_FIRST | CLEAR_OLD_DOCUMENT, 1) => "clear",
        (NEXT_DOCUMENT, 1) => "navigate",
        (EMAIL_CODE, 1) => "email",
        _ => "wait",
    }
}

pub(super) fn response(path: &str) -> String {
    let path = path.split('?').next().unwrap_or(path);
    let parts: Vec<_> = path.trim_start_matches(PREFIX).split('/').collect();
    if let [operation @ ("state" | "ack" | "email-ack"), document] = parts.as_slice() {
        let document = document.parse::<usize>().unwrap_or(0);
        if !(1..=2).contains(&document) {
            return "wait".into();
        }
        if *operation == "email-ack" {
            EMAIL_SHOWN.store(true, Ordering::SeqCst);
            return "ok".into();
        }
        if *operation == "ack" {
            CLEARED_DOCUMENT.store(document, Ordering::SeqCst);
            return "ok".into();
        }
        POLLED_DOCUMENT.fetch_max(document, Ordering::SeqCst);
        return instruction(CONTROL.load(Ordering::SeqCst), document).into();
    }
    if parts.as_slice() == ["frame"] {
        return "<!doctype html><title>Local fixture verification</title><p>This is an inert loopback human-check fixture.</p>".into();
    }
    let [scenario, document] = parts.as_slice() else {
        return String::new();
    };
    let document = document.parse::<usize>().unwrap_or(0);
    if ![
        "signin",
        "signin-hash",
        "signin-sites",
        "email-code",
        "check",
        "unresolved",
        "cancel",
        "stale",
        "long-wait",
    ]
    .contains(scenario)
        || !(1..=2).contains(&document)
    {
        return String::new();
    }
    let (title, wall) = if *scenario == "check" {
        (
            "Verify you are human",
            "<h1>Verify you are human</h1><p>Complete this local human check to view the fixture dashboard.</p><iframe title=\"Security verification captcha\" src=\"/human-fixture/frame\" width=\"320\" height=\"120\"></iframe>",
        )
    } else {
        (
            "Sign in",
            "<h1>Sign in to the fixture dashboard</h1><p>Local qualification only. Do not enter real credentials.</p><form onsubmit=\"return false\"><label>Fixture password <input type=\"password\" autocomplete=\"off\"></label><button type=\"button\" disabled>Fixture human sign-in</button></form>",
        )
    };
    let content = if *scenario == "email-code" {
        format!("<div aria-label=\"Main Content\"><h1>Inbox</h1><input type=\"range\" aria-label=\"Sidebar width\"><input type=\"search\" aria-label=\"Channel or user name\"><div role=\"list\" aria-label=\"Project channel\" aria-owns=\"fixture-message\" style=\"min-height:20px\"></div><div id=\"fixture-message\"><p>{FACT}.</p></div><div><button>Task: {FACT}.</button><button>Task: Review the synthetic project checklist.</button><button>Task: Read the synthetic integration notes.</button></div><div role=\"textbox\" aria-multiline=\"true\" contenteditable=\"true\" aria-label=\"Message to project channel\"><p><br></p></div></div>")
    } else {
        format!("<main><h1>Fixture dashboard</h1><p>{FACT}.</p><p>This dashboard is public synthetic test data. The retained page now exposes its balance and reference without a reload, route change, cookie signal or manual continue command.</p></main>")
    };
    let (title, wall) = if *scenario == "signin-sites" && document == 2 {
        ("Fixture dashboard", content.as_str())
    } else {
        (title, wall)
    };
    let arrival = if *scenario == "signin-sites" && document == 2 {
        "location.hash='inbox';"
    } else {
        ""
    };
    let routed = if *scenario == "signin-hash" {
        "location.hash='inbox';"
    } else {
        ""
    };
    let tamper = if *scenario == "email-code" {
        "Object.defineProperty(window,'getComputedStyle',{value(){throw new Error('fixture_page_world_tampered');},configurable:true});"
    } else {
        ""
    };
    // This polling simulation is present only in a synthetic loopback document.
    // Its controller never publishes a clear before observing native Presented.
    format!(
        r#"<!doctype html><html><head><title>{title}</title></head><body>
<main id="wall">{wall}</main><script>
(function(){{
 const documentNumber={document}; let finished=false, emailShown=false;
 {tamper}{arrival}
 async function poll(){{
  if(finished)return;
  try{{
   const response=await fetch('/human-fixture/state/'+documentNumber,{{cache:'no-store'}});
   const action=await response.text();
   if(action==='navigate'){{finished=true;location.replace('/human-fixture/stale/2');return;}}
   if(action==='email' && !emailShown){{
    emailShown=true;document.title='Fixture confirmation';
    document.body.innerHTML='<main><h1>Continue to your workspace</h1><p>Complete the next step to open your account.</p><input type="text" name="code"><button type="button">Continue</button></main>';
    await fetch('/human-fixture/email-ack/'+documentNumber,{{cache:'no-store'}});
   }}
   if(action==='clear' && '{scenario}'==='signin-sites'){{
    finished=true;
    await fetch('/human-fixture/ack/'+documentNumber,{{cache:'no-store'}});
    location.assign('/human-fixture/exit');return;
   }}
   if(action==='clear'){{
    finished=true;document.title='Fixture dashboard';
    document.body.innerHTML='{content}';{routed}
    await fetch('/human-fixture/ack/'+documentNumber,{{cache:'no-store'}});return;
   }}
  }}catch(_){{}}
  setTimeout(poll,150);
 }}poll();
}})();</script></body></html>"#
    )
}

fn advance(session: &mut Session, pages: &[WorkHumanPageV1]) -> Action {
    if session.cancel_sent {
        return Action::None;
    }
    if session.started.elapsed() > DEADLINE {
        session.fail("fixture_deadline");
    }
    if session.failure.is_some() {
        return Action::Cancel;
    }
    let Some(page) = pages
        .iter()
        .find(|page| page.reason == session.scenario.reason())
    else {
        return Action::None;
    };
    if session.id.is_none() && page.phase == WorkHumanPhaseV1::WaitingForHuman {
        session.id = Some(page.id);
        return Action::Present(page.id);
    }
    if session.id.is_some_and(|id| id != page.id) {
        session.fail("human_page_identity_changed");
        return Action::Cancel;
    }
    // The app's own route change after sign-in moves the revision on.
    if !matches!(
        session.scenario,
        Scenario::StaleDocument | Scenario::SignInHash | Scenario::SignInSites
    ) && session
        .revision
        .as_ref()
        .is_some_and(|revision| *revision != page.document_revision)
    {
        session.fail("same_document_revision_changed");
        return Action::Cancel;
    }
    if page.phase != WorkHumanPhaseV1::Presented {
        if session.presented_since.is_some()
            && (!session.scenario.resumes() || session.signal_at.is_none())
            && matches!(
                page.phase,
                WorkHumanPhaseV1::Continuing | WorkHumanPhaseV1::Reading
            )
        {
            session.fail("unresolved_wall_resumed");
            return Action::Cancel;
        }
        return Action::None;
    }
    session.presented_samples += 1;
    let since = *session.presented_since.get_or_insert_with(Instant::now);
    let original = session
        .revision
        .get_or_insert_with(|| page.document_revision.clone());
    if !session.check_waiting {
        return Action::Check(page.id, false);
    }
    if session.scenario.resumes()
        && session.signal_at.is_some()
        && CLEARED_DOCUMENT.load(Ordering::SeqCst) == 1
        && (session.scenario != Scenario::SignInSites
            || POLLED_DOCUMENT.load(Ordering::SeqCst) == 2)
        && !session.check_clear
    {
        return Action::Check(page.id, true);
    }
    if session.signal_at.is_none() {
        if since.elapsed() < session.scenario.hold() {
            return Action::None;
        }
        session.unresolved_held = session.presented_samples >= 3;
        if session.scenario == Scenario::EmailCode {
            CONTROL.store(EMAIL_CODE, Ordering::SeqCst);
            if !EMAIL_SHOWN.load(Ordering::SeqCst) {
                return Action::None;
            }
            if session.email_since.is_none() {
                session.email_since = Some(Instant::now());
                session.check_waiting = false;
                return Action::Check(page.id, false);
            }
            if session.email_since.is_some_and(|at| at.elapsed() < HOLD) {
                return Action::None;
            }
        }
        match session.scenario {
            Scenario::SignIn
            | Scenario::SignInHash
            | Scenario::SignInSites
            | Scenario::EmailCode
            | Scenario::Check
            | Scenario::LongWait => {
                CONTROL.store(CLEAR_FIRST, Ordering::SeqCst);
                session.signal_at = Some(Instant::now());
            }
            Scenario::StaleDocument => {
                CONTROL.store(NEXT_DOCUMENT, Ordering::SeqCst);
                session.signal_at = Some(Instant::now());
            }
            Scenario::Unresolved | Scenario::Cancel => return Action::Cancel,
        }
    } else if session.scenario == Scenario::StaleDocument {
        if session.stale_revision.is_none()
            && *original != page.document_revision
            && POLLED_DOCUMENT.load(Ordering::SeqCst) == 2
        {
            session.stale_revision = Some(page.document_revision.clone());
            session.signal_at = Some(Instant::now());
            CONTROL.store(CLEAR_OLD_DOCUMENT, Ordering::SeqCst);
        }
        if let Some(revision) = &session.stale_revision {
            if *revision != page.document_revision {
                session.fail("unexpected_third_document");
                return Action::Cancel;
            }
            if session.signal_at.is_some_and(|at| at.elapsed() >= HOLD) {
                return Action::Cancel;
            }
        }
    }
    Action::None
}

pub(super) async fn person(context: &Context<'_>, work: WorkId, pages: &[WorkHumanPageV1]) {
    let action = {
        let Ok(mut state) = context.human_fixture.lock() else {
            return;
        };
        let Some(session) = state.as_mut() else {
            return;
        };
        advance(session, pages)
    };
    match action {
        Action::None => {}
        Action::Present(id) => {
            let admitted = context.projection(work).await.and_then(|state| {
                (state.work.profile == context.profile)
                    .then_some(state)
                    .and_then(|state| {
                        state
                            .executions
                            .iter()
                            .find(|execution| {
                                execution.steps.iter().any(|step| step.id == id.step)
                                    && execution
                                        .attempts
                                        .iter()
                                        .any(|attempt| attempt.id == id.attempt)
                            })
                            .map(|execution| {
                                (
                                    execution.id,
                                    execution.authorization,
                                    execution.spec.clone(),
                                )
                            })
                    })
            });
            if let Ok(mut state) = context.human_fixture.lock() {
                if let Some(session) = state.as_mut() {
                    session.admitted = admitted;
                    if session.admitted.is_none() {
                        session.fail("fixture_authority_snapshot");
                        return;
                    }
                }
            }
            if context
                .composition
                .present_human_page(
                    context.profile,
                    work,
                    id,
                    WorkHumanRegionV1 {
                        x: 0,
                        y: 0,
                        width: 640,
                        height: 480,
                    },
                )
                .is_err()
            {
                if let Ok(mut state) = context.human_fixture.lock() {
                    if let Some(session) = state.as_mut() {
                        session.fail("native_present_refused");
                    }
                }
            }
        }
        Action::Check(id, clear) => {
            use zephium_ipc::work::WorkHumanCheckOutcomeV1 as Check;
            let mut stale = id;
            stale.generation = stale.generation.saturating_add(1);
            let stale_refused = context
                .composition
                .check_human_page(context.profile, work, stale)
                .await
                == Check::Unavailable;
            let (first, repeated) = tokio::join!(
                context
                    .composition
                    .check_human_page(context.profile, work, id),
                context
                    .composition
                    .check_human_page(context.profile, work, id),
            );
            let expected = if clear { Check::Clear } else { Check::Waiting };
            let unchanged = context
                .composition
                .human_pages(context.profile, work)
                .is_ok_and(|pages| {
                    pages.iter().any(|page| {
                        page.id == id
                            && page.phase == WorkHumanPhaseV1::Presented
                            && (clear || !page.can_continue)
                    })
                });
            if let Ok(mut state) = context.human_fixture.lock() {
                if let Some(session) = state.as_mut() {
                    if first != expected || repeated != expected || !stale_refused || !unchanged {
                        session.fail("native_recheck_result_or_identity");
                    } else if clear {
                        session.check_clear = true;
                    } else {
                        session.check_waiting = true;
                    }
                }
            }
            let _ = writeln!(
                std::io::stdout().lock(),
                "loopback-human-recheck: expected_clear={clear} first={first:?} repeated={repeated:?} stale_refused={stale_refused} same_page_held={unchanged}; content=synthetic"
            );
        }
        Action::Cancel => {
            let Some(state) = context.projection(work).await else {
                return;
            };
            let Some(execution) = state.executions.last() else {
                return;
            };
            let execution = execution.id;
            let command = WorkCommandId::generate();
            // Start at actual dispatch, not when the polling loop first decides to Stop.
            let started = Instant::now();
            let deadline = tokio::time::Instant::from_std(started + Duration::from_secs(1));
            let sent = context.handle.work_command(
                context.profile,
                WorkCommandV1 {
                    version: 1,
                    work,
                    expected_revision: state.work.revision,
                    command,
                    intent: WorkRuntimeIntent::Cancel {
                        execution,
                        intervention: None,
                    },
                },
            );
            let admitted = sent.is_ok();
            let observed: Result<u128, &'static str> = async {
                let reply = sent.map_err(|_| "cancel_admission_refused")?;
                let reply = tokio::time::timeout_at(deadline, reply)
                    .await
                    .map_err(|_| "cancel_receipt_deadline")?
                    .map_err(|_| "cancel_receipt_rejected")?;
                if reply.profile != context.profile {
                    return Err("cancel_receipt_scope");
                }
                let port::WorkReply::RuntimeCommand {
                    projection,
                    receipt,
                } = reply.reply
                else {
                    return Err("cancel_receipt_shape");
                };
                if receipt.command != command
                    || receipt.execution != execution
                    || projection.work.profile != context.profile
                    || projection.work.id != work
                {
                    return Err("cancel_receipt_scope");
                }
                if let Ok(state) = context.human_fixture.lock() {
                    if state
                        .as_ref()
                        .is_some_and(|session| session.scenario == Scenario::Cancel)
                    {
                        // The only late signal is this synthetic page's own DOM update.
                        CONTROL.store(CLEAR_FIRST, Ordering::SeqCst);
                    }
                }
                if cancelled_projection(&projection, context.profile, work, execution) {
                    return Ok(started.elapsed().as_millis());
                }
                loop {
                    let projection = tokio::time::timeout_at(deadline, context.projection(work))
                        .await
                        .map_err(|_| "cancel_durable_deadline")?
                        .ok_or("cancel_projection_refused")?;
                    if cancelled_projection(&projection, context.profile, work, execution) {
                        return Ok(started.elapsed().as_millis());
                    }
                    if tokio::time::Instant::now() >= deadline {
                        return Err("cancel_durable_deadline");
                    }
                    tokio::time::sleep(Duration::from_millis(20)).await;
                }
            }
            .await;
            let failed = !matches!(observed, Ok(millis) if millis <= 1000);
            let mut cleanup = None;
            if let Ok(mut state) = context.human_fixture.lock() {
                if let Some(session) = state.as_mut() {
                    cleanup = failed.then_some(session.id).flatten();
                    // A queued command retains its original owner even if its
                    // observation times out; never issue a second Cancel as proof.
                    session.cancel_sent = admitted;
                    match observed {
                        Ok(millis) if millis <= 1000 => session.cancel_millis = Some(millis),
                        Ok(_) => session.fail("cancel_durable_deadline"),
                        Err(reason) => session.fail(reason),
                    }
                }
            }
            if let Some(id) = cleanup {
                // Failed qualification must still release its own native pane;
                // cleanup never stands in for the missing cancellation proof.
                let _ = context
                    .composition
                    .release_human_page(context.profile, work, id);
            }
        }
    }
}

fn cancelled_projection(
    state: &WorkRuntimeProjection,
    profile: ProfileId,
    work: WorkId,
    execution: WorkExecutionId,
) -> bool {
    state.work.profile == profile
        && state.work.id == work
        && state
            .executions
            .iter()
            .any(|row| row.id == execution && row.status == WorkExecutionStatus::Cancelled)
}

pub(super) async fn run(
    context: &Context<'_>,
    scenario: Scenario,
) -> Result<(Run, bool), &'static str> {
    CONTROL.store(WAIT, Ordering::SeqCst);
    EMAIL_SHOWN.store(false, Ordering::SeqCst);
    CLEARED_DOCUMENT.store(0, Ordering::SeqCst);
    POLLED_DOCUMENT.store(0, Ordering::SeqCst);
    *context
        .human_fixture
        .lock()
        .map_err(|_| "human_fixture_state")? = Some(Session::new(scenario));
    let route = format!("{PREFIX}{}/1", scenario.name());
    let before = context.sites.hits(Site::Account, &route).len();
    let run = context.run("Inspect the synthetic human-handoff dashboard", false, "Allow",
        vec![vec![browse(&route, "Report the dashboard balance and reference code after the person finishes the required sign-in or human check.")]]).await;
    let state = context
        .human_fixture
        .lock()
        .map_err(|_| "human_fixture_state")?
        .take()
        .ok_or("human_fixture_state")?;
    CONTROL.store(WAIT, Ordering::SeqCst);
    let run = run?;
    let main_loads = context
        .sites
        .hits(Site::Account, &route)
        .len()
        .saturating_sub(before);
    let presented =
        state.presented_since.is_some() && state.id.is_some() && state.revision.is_some();
    let content = says(&run, FACT) || mentions(&run, &["73", "j17"]);
    let calls = run
        .opened
        .iter()
        .filter_map(|page| page.model_calls)
        .map(u32::from)
        .sum::<u32>();
    let expected = if scenario == Scenario::Check {
        WorkPageHandoffKindV1::Check
    } else {
        WorkPageHandoffKindV1::SignIn
    };
    let receipt = run.opened.len() == 1 && run.opened[0].resolved_handoff == Some(expected);
    let cancelled = run
        .state
        .executions
        .last()
        .is_some_and(|execution| execution.status == WorkExecutionStatus::Cancelled);
    let retired = context
        .composition
        .human_pages(context.profile, run.state.work.id)
        .is_ok_and(|pages| pages.is_empty());
    let retired_check_refused = if let Some(id) = state.id {
        context
            .composition
            .check_human_page(context.profile, run.state.work.id, id)
            .await
            == zephium_ipc::work::WorkHumanCheckOutcomeV1::Unavailable
    } else {
        false
    };
    let elapsed_ms = state.started.elapsed().as_millis();
    let held_ms = state
        .signal_at
        .zip(state.presented_since)
        .map_or(0, |(clear, presented)| {
            clear.saturating_duration_since(presented).as_millis()
        });
    let admitted_timeout = state.execution_timeout_seconds();
    let original_limits_unchanged = run.state.work.profile == context.profile
        && state
            .admitted
            .as_ref()
            .is_some_and(|(id, authorization, spec)| {
                spec.limits.timeout_seconds == admitted_timeout
                    && run.state.executions.iter().any(|execution| {
                        execution.id == *id
                            && execution.authorization == *authorization
                            && execution.spec == *spec
                    })
            });
    let past_original_deadline = scenario != Scenario::LongWait
        || (held_ms >= 35_000 && elapsed_ms > u128::from(admitted_timeout) * 1_000);
    let base = state.failure.is_none()
        && presented
        && state.check_waiting
        && retired_check_refused
        && state.unresolved_held
        && (scenario != Scenario::EmailCode
            || state.email_since.is_some_and(|at| at.elapsed() >= HOLD))
        && main_loads == 1
        && retired
        && original_limits_unchanged
        && past_original_deadline;
    let passed = base
        && if scenario.resumes() {
            content
                && state.check_clear
                && receipt
                && calls > 0
                && CLEARED_DOCUMENT.load(Ordering::SeqCst) == 1
                && run.opened[0].status == Some(WorkStepStatus::Succeeded)
                && !state.cancel_sent
        } else {
            cancelled
                && state.cancel_sent
                && state.cancel_millis.is_some_and(|millis| millis <= 1000)
                && !content
                && !run
                    .opened
                    .iter()
                    .any(|page| page.resolved_handoff.is_some())
                && (scenario != Scenario::StaleDocument
                    || (state.stale_revision.is_some()
                        && POLLED_DOCUMENT.load(Ordering::SeqCst) == 2
                        && CLEARED_DOCUMENT.load(Ordering::SeqCst) != 2))
        };
    let check_waiting = state.check_waiting;
    let check_clear = state.check_clear;
    let cancel_millis = state.cancel_millis.unwrap_or(0);
    let durable_cancelled = state.cancel_millis.is_some();
    let _ = writeln!(
        std::io::stdout().lock(),
        "loopback-human: scenario={} presented={presented} unresolved_held={} native_page_identity_stable={} same_document={} main_loads={main_loads} resolved_handoff={receipt} planner_calls={calls} cancelled={cancelled} durable_cancelled={durable_cancelled} cancel_millis={cancel_millis} retired={retired} stale_fixture_document_held={} manual_continue_calls=0 check_waiting={check_waiting} check_clear={check_clear} retired_check_refused={retired_check_refused} admitted_timeout_seconds={admitted_timeout} presented_hold_ms={held_ms} elapsed_ms={elapsed_ms} original_limits_unchanged={original_limits_unchanged} past_original_deadline={past_original_deadline} simulated_human=loopback_dom_only passed={passed} failure={}; content=synthetic",
        scenario.name(),
        state.unresolved_held,
        state.id.is_some() && state.failure != Some("human_page_identity_changed"),
        scenario.resumes()
            && state.revision.is_some()
            && state.failure != Some("same_document_revision_changed"),
        state.stale_revision.is_some(),
        state.failure.unwrap_or("none")
    );
    Ok((run, passed))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn page(reason: WorkHumanReasonV1) -> WorkHumanPageV1 {
        WorkHumanPageV1 {
            id: WorkHumanPageIdV1 {
                attempt: WorkAttemptId::generate(),
                step: WorkStepId::generate(),
                generation: 1,
            },
            phase: WorkHumanPhaseV1::Presented,
            reason,
            remaining_millis: 60000,
            document_revision: "0".into(),
            can_continue: false,
            can_extend: false,
            work_memory: true,
        }
    }
    #[test]
    fn long_wait_clears_only_after_the_admitted_deadline_has_elapsed() {
        let mut session = Session::new(Scenario::LongWait);
        session.check_waiting = true;
        let page = page(WorkHumanReasonV1::SignIn);
        session.id = Some(page.id);
        session.presented_since = Some(Instant::now() - Duration::from_secs(34));
        assert_eq!(session.execution_timeout_seconds(), 30);
        assert!(matches!(
            advance(&mut session, &[page.clone()]),
            Action::None
        ));
        assert!(session.signal_at.is_none());
        session.presented_since = Some(Instant::now() - Duration::from_secs(36));
        assert!(matches!(advance(&mut session, &[page]), Action::None));
        assert!(session.signal_at.is_some());
        CONTROL.store(WAIT, Ordering::SeqCst);
    }

    #[test]
    fn fixture_never_clears_an_unpresented_page_and_old_document_cannot_clear_new() {
        let mut session = Session::new(Scenario::SignIn);
        let mut page = page(WorkHumanReasonV1::SignIn);
        page.phase = WorkHumanPhaseV1::WaitingForHuman;
        assert!(matches!(advance(&mut session, &[page]), Action::Present(_)));
        assert!(session.signal_at.is_none() && session.presented_since.is_none());
        assert_eq!(instruction(CLEAR_OLD_DOCUMENT, 1), "clear");
        assert_eq!(instruction(CLEAR_OLD_DOCUMENT, 2), "wait");
        assert_eq!(instruction(NEXT_DOCUMENT, 2), "wait");
    }
    #[test]
    fn unresolved_resume_or_replaced_identity_fails_qualification() {
        let mut session = Session::new(Scenario::Unresolved);
        let mut page = page(WorkHumanReasonV1::SignIn);
        session.id = Some(page.id);
        page.can_continue = true; // Navigation readiness is not wall-clear proof.
        session.presented_since = Some(Instant::now());
        page.phase = WorkHumanPhaseV1::Continuing;
        assert!(matches!(
            advance(&mut session, &[page.clone()]),
            Action::Cancel
        ));
        assert_eq!(session.failure, Some("unresolved_wall_resumed"));
        let mut session = Session::new(Scenario::SignIn);
        session.id = Some(page.id);
        page.id.generation += 1;
        assert!(matches!(advance(&mut session, &[page]), Action::Cancel));
        assert_eq!(session.failure, Some("human_page_identity_changed"));
    }
}
