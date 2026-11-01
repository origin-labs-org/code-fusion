use super::*;

const HUMAN_POLL_INTERVAL: Duration = Duration::from_millis(100);

fn wall_survey_outcome(wire: &str) -> Option<u8> {
    let code = wire.parse::<u8>().ok()?;
    (code <= 24 && wire == code.to_string()).then_some(code)
}

impl WorkNativeResource {
    pub(super) fn handle_human(
        &mut self,
        task: WorkLifecycleTask,
        dispatch: crate::MainThreadDispatch,
    ) {
        let result = task.request().ok_or(()).and_then(|request| {
            let operation = request.operation();
            let now = work_browser_monotonic_now().ok_or(())?;
            if !self.guard.human_current(operation, now)
                || self.pending()
                || self.frame_in_flight.load(Ordering::Acquire)
            {
                return Err(());
            }
            match operation {
                Operation::PresentHuman => {
                    if self.human_presentation.is_some()
                        || self.human_unpresented
                        || !self.ready()
                        || self.observation_visible()
                    {
                        return Err(());
                    }
                    if request.human_region().is_none() {
                        // The page stays hidden and unchanged; only the
                        // actor lease ends until the person decides.
                        self.human_unpresented = true;
                        return Ok(None);
                    }
                    let remaining = request
                        .human_deadline()
                        .ok_or(())?
                        .millis()
                        .checked_sub(now.millis())
                        .ok_or(())?;
                    let deadline = Instant::now()
                        .checked_add(Duration::from_millis(remaining))
                        .ok_or(())?;
                    let view = self.view.as_ref().ok_or(())?;
                    let presentation = crate::platform::imp::WorkHumanPresentation::prepare(
                        view.view(),
                        request.human_region().ok_or(())?,
                        deadline,
                    )
                    .ok_or(())?;
                    #[cfg(target_os = "windows")]
                    if !view.activate_work_human() {
                        return Err(());
                    }
                    view.work_navigation().ok_or(())?.begin_human(
                        request.human_source().ok_or(())?,
                        deadline,
                        request.human_sign_in(),
                    )?;
                    #[cfg(target_os = "windows")]
                    if request.human_sign_in() {
                        view.note_work_sign_in();
                    }
                    self.human_presentation = Some(presentation);
                    self.human_progress = request.human_progress();
                    if let Some(progress) = &self.human_progress {
                        let guard = Arc::downgrade(&self.guard);
                        progress.bind_wall_check_wake(Arc::new(move || {
                            let Some(guard) = guard.upgrade() else {
                                return;
                            };
                            let _ = dispatch(Box::new(move || {
                                let _ = crate::host::try_with_agent_context(move |host| {
                                    if let Some(resource) = host
                                        .work_resources
                                        .get(&guard.resource().identity().context())
                                        .filter(|resource| Arc::ptr_eq(&resource.guard, &guard))
                                    {
                                        resource.sample_human_wall();
                                    }
                                });
                            }));
                        }));
                        view.work_navigation()
                            .ok_or(())?
                            .bind_human_progress(progress.clone());
                    }
                    if !self
                        .human_presentation
                        .as_mut()
                        .is_some_and(|presentation| presentation.present())
                        || !self.schedule_human_wake()
                    {
                        return Err(());
                    }
                    Ok(None)
                }
                Operation::ContinueAfterHuman if self.human_unpresented => {
                    self.human_unpresented = false;
                    let view = self.view.as_ref().ok_or(())?;
                    let current = crate::platform::imp::current_url(view.view()).ok_or(())?;
                    let effective = view.work_navigation().ok_or(())?.hand_back(&current)?;
                    if view.semantic_pending_for_audit() != Some(false) {
                        return Err(());
                    }
                    Ok(Some(effective))
                }
                Operation::ContinueAfterHuman => {
                    if let Some(revision) = request
                        .human_progress()
                        .and_then(|progress| progress.wall_continuation_revision())
                    {
                        let gate = self
                            .view
                            .as_ref()
                            .and_then(|view| view.work_navigation())
                            .ok_or(())?;
                        if gate.human_revision() != Some(revision)
                            || !gate.human_verified_wall_clear()
                        {
                            return Err(());
                        }
                    }
                    if !self
                        .human_presentation
                        .as_ref()
                        .is_some_and(|presentation| presentation.current())
                        || !self.retire_human_presentation()
                    {
                        return Err(());
                    }
                    let view = self.view.as_ref().ok_or(())?;
                    let gate = view.work_navigation().ok_or(())?;
                    let revision = gate.human_revision().ok_or(())?;
                    let current = crate::platform::imp::current_url(view.view()).ok_or(())?;
                    let effective = gate.finish_human(&current, revision)?;
                    if view.semantic_pending_for_audit() != Some(false) {
                        return Err(());
                    }
                    Ok(Some(effective))
                }
                _ => Err(()),
            }
        });
        match result {
            Ok(None) => task.complete(Outcome::HumanPresented),
            Ok(Some(document)) => {
                // The sign-in lives in this site's Work store until it is
                // added to the person's profile, so their tabs have it too.
                // The page stays active until then and resumes afterwards.
                #[cfg(target_os = "windows")]
                if self
                    .view
                    .as_ref()
                    .is_some_and(|view| view.work_session_return_pending())
                {
                    self.human_return = Some((task, document));
                    let returning = self.guard.clone();
                    self.guard.dispatch_notification(move || {
                        crate::host::best_effort_with(move |host| {
                            host.return_work_site_session(&returning);
                        });
                    });
                    return;
                }
                self.finish_human_continue(task, document);
            }
            Err(()) => {
                self.retire_human_presentation();
                #[cfg(target_os = "windows")]
                if let Some(view) = self.view.as_ref() {
                    view.finish_work_human_activity(|_| {});
                }
                self.guard.fail();
                task.complete(Outcome::Refused);
            }
        }
    }

    pub(crate) fn finish_human_continue(
        &mut self,
        task: WorkLifecycleTask,
        document: zephium_agentic::ContextNavigationTarget,
    ) {
        #[cfg(target_os = "windows")]
        if let Some(view) = self.view.as_ref() {
            let guard = self.guard.clone();
            view.finish_work_human_activity(move |clean| {
                if clean {
                    task.complete_human_document(document);
                } else {
                    guard.fail();
                    task.complete(Outcome::Refused);
                }
            });
            return;
        }
        task.complete_human_document(document);
    }

    fn schedule_human_wake(&mut self) -> bool {
        if self.human_wake.is_some() {
            return true;
        }
        let guard = self.guard.clone();
        let rejected = guard.clone();
        self.human_wake =
            crate::platform::imp::schedule_content_policy_timeout(HUMAN_POLL_INTERVAL, move || {
                if !crate::host::try_with_agent_context_terminal(move |host| {
                    if let Some(resource) = host
                        .work_resources
                        .get_mut(&guard.resource().identity().context())
                        .filter(|resource| Arc::ptr_eq(&resource.guard, &guard))
                    {
                        resource.human_wake = None;
                    }
                    host.progress_work_resource(&guard);
                }) {
                    rejected.fail();
                }
            });
        self.human_wake.is_some()
    }

    fn sample_human_wall(&self) {
        if !self
            .human_presentation
            .as_ref()
            .is_some_and(|presentation| presentation.current())
            || !work_browser_monotonic_now()
                .is_some_and(|now| self.guard.human_current(Operation::PresentHuman, now))
        {
            return;
        }
        let Some(progress) = self.human_progress.as_ref() else {
            return;
        };
        let Some(view) = self.view.as_ref() else {
            return;
        };
        let Some(gate) = view.work_navigation().cloned() else {
            return;
        };
        let Some(stamp) = gate.human_wall_probe() else {
            return;
        };
        if !progress.begin_wall_probe() {
            return;
        }
        let check = progress.pending_wall_check();
        let failed_check = check.clone();
        let progress = progress.clone();
        let completed = progress.clone();
        let admitted = gate.clone();
        let guard = self.guard.clone();
        let answered = std::sync::atomic::AtomicBool::new(false);
        let sampled = Instant::now();
        if view
            .sample_work_human_wall(move |result| {
                if answered.swap(true, Ordering::AcqRel) {
                    return;
                }
                let fresh = sampled.elapsed() <= Duration::from_secs(1);
                let outcome = wall_survey_outcome(&result);
                #[cfg(feature = "agentic-browser-qa")]
                if check.is_some() {
                    use std::io::Write;
                    let _ = writeln!(
                        std::io::stderr(),
                        "agent_view human_survey_code={} fresh={fresh}; content=redacted",
                        outcome.unwrap_or(255)
                    );
                }
                let valid = fresh
                    && outcome.is_some()
                    && work_browser_monotonic_now()
                        .is_some_and(|now| guard.human_current(Operation::PresentHuman, now))
                    && admitted.record_human_wall_clear(
                        stamp,
                        outcome == Some(0),
                        outcome.is_some_and(|code| code != 0),
                    );
                if !valid {
                    admitted.record_human_wall_clear(stamp, false, false);
                }
                if let Some(check) = check.as_ref() {
                    if !valid {
                        check.finish(None);
                    } else if outcome != Some(0) {
                        check.finish(Some(false));
                    } else if admitted.human_verified_wall_clear() {
                        check.finish(Some(true));
                    }
                    // One positive sample alone leaves the request pending.
                }
                completed.finish_wall_probe();
                // Run cleanup only after the private-world callback returns.
                let wake = guard.clone();
                guard.dispatch_notification(move || notify_work_resource(wake));
            })
            .is_err()
        {
            gate.record_human_wall_clear(stamp, false, false);
            if let Some(check) = failed_check {
                check.finish(None);
            }
            progress.finish_wall_probe();
        }
    }

    pub(super) fn progress_human(&mut self, erased: bool) {
        if let Some(presentation) = self.human_presentation.as_mut() {
            presentation.refit();
        }
        let Some(presentation) = self.human_presentation.as_ref() else {
            return;
        };
        if let Some(progress) = &self.human_progress {
            progress.record_ready(
                self.view
                    .as_ref()
                    .and_then(|view| view.work_navigation())
                    .is_some_and(|gate| gate.human_ready()),
            );
        }
        if let Some(progress) = &self.human_progress {
            // Polling can revoke stale proof, never renew it. Only a fresh
            // DOM callback timestamps positive evidence.
            if !self
                .view
                .as_ref()
                .and_then(|view| view.work_navigation())
                .is_some_and(|gate| gate.human_verified_wall_clear())
            {
                progress.record_verified_wall_clear(false);
            }
        }
        if let Some((progress, revision)) = self.human_progress.as_ref().zip(
            self.view
                .as_ref()
                .and_then(|view| view.work_navigation())
                .and_then(|gate| gate.human_revision()),
        ) {
            progress.record_revision(revision);
        }
        if !erased && presentation.current() {
            self.sample_human_wall();
        }
        if erased
            || !presentation.current()
            || !work_browser_monotonic_now().is_some_and(|now| {
                self.guard.human_current(Operation::PresentHuman, now)
                    || self.guard.human_current(Operation::ContinueAfterHuman, now)
            })
            || !self.schedule_human_wake()
        {
            #[cfg(feature = "agentic-browser-qa")]
            {
                use std::io::Write;
                let present = work_browser_monotonic_now()
                    .is_some_and(|now| self.guard.human_current(Operation::PresentHuman, now));
                let continuing = work_browser_monotonic_now().is_some_and(|now| {
                    self.guard.human_current(Operation::ContinueAfterHuman, now)
                });
                let _ = writeln!(
                    std::io::stderr(),
                    "agent_view human_retire_fault erased={erased} presentation={} present_guard={present} continue_guard={continuing} wake={}",
                    self.human_presentation
                        .as_ref()
                        .is_some_and(|p| p.current()),
                    self.human_wake.is_some()
                );
            }
            self.retire_human_presentation();
            #[cfg(target_os = "windows")]
            if let Some(view) = self.view.as_ref() {
                view.finish_work_human_activity(|_| {});
            }
            self.guard.fail();
        }
    }

    pub(super) fn retire_human_presentation(&mut self) -> bool {
        self.human_wake = None;
        if let Some(progress) = self.human_progress.take() {
            progress.invalidate_wall_check();
        }
        let clean = self
            .human_presentation
            .as_mut()
            .is_none_or(|presentation| presentation.retire());
        if clean {
            self.human_presentation = None;
        } else {
            self.retirement_clean = false;
            self.guard.fail();
        }
        clean
    }
}

#[cfg(test)]
mod wall_survey_wire_tests {
    use super::wall_survey_outcome;
    #[test]
    fn only_closed_structural_codes_are_admitted() {
        for code in 0..=24 {
            assert_eq!(wall_survey_outcome(&code.to_string()), Some(code));
        }
        for wire in [
            "true",
            "false",
            "0.0",
            "00",
            " 0",
            "25",
            "255",
            "-1",
            "null",
            "{}",
            "private detail",
        ] {
            assert_eq!(wall_survey_outcome(wire), None);
        }
    }
}

#[cfg(all(
    target_os = "macos",
    feature = "agentic-browser-qa",
    feature = "native-agentic-semantic-probe"
))]
impl EngineHost {
    pub(crate) fn navigate_human_fixture(
        &mut self,
        resource: &zephium_agentic::WorkBrowserResourceJoin,
    ) -> bool {
        let Some(resource) = self
            .work_resources
            .get(&resource.identity().context())
            .filter(|owned| owned.guard.resource() == resource)
        else {
            return false;
        };
        let Some(view) = resource.view.as_ref() else {
            return false;
        };
        if !resource
            .human_presentation
            .as_ref()
            .is_some_and(|presentation| presentation.current())
            || !resource.guard.document().is_some_and(|target| {
                target.as_url().host_str() == Some("127.0.0.1")
                    && target.as_url().scheme() == "http"
                    && target.as_url().path() == "/"
            })
        {
            return false;
        }
        if !resource
            .human_presentation
            .as_ref()
            .is_some_and(|presentation| presentation.qualify_geometry_invalidation())
        {
            return false;
        }
        eprintln!("human_probe changed_parent_geometry_kept=true");
        view.view()
            .evaluate_script("location.assign('/verified')")
            .is_ok()
    }
}
