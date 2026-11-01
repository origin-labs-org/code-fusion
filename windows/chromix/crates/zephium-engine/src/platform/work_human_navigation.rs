use super::*;
use std::time::{Duration, Instant};

pub(super) struct HumanNavigation {
    source: ContextNavigationTarget,
    /// A sign-in may pass through another site's sign-in pages.
    open: bool,
    current: ContextNavigationTarget,
    native_id: wry::NavigationId,
    requested: bool,
    loading: Option<wry::NavigationId>,
    committed: bool,
    finished: bool,
    revision: u64,
    deadline: Instant,
    progress: Option<zephium_agentic::WorkBrowserHumanProgress>,
    wall_clear_samples: u8,
    wall_sampled: Option<Instant>,
    /// A sign-in or check surface was sampled on the handed-over page.
    wall_seen: bool,
    #[cfg(target_os = "windows")]
    write_navigation: Option<(wry::NavigationId, u64, ContextNavigationTarget)>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct WorkHumanDocumentStamp {
    epoch: u64,
    revision: u64,
    native_id: wry::NavigationId,
}

const SIGN_IN_WORDS: &[&str] = &[
    "login",
    "signin",
    "sign-in",
    "sign_in",
    "log-in",
    "logon",
    "sso",
    "auth",
    "oauth",
    "authorize",
    "2fa",
    "mfa",
    "2sv",
    "otp",
    "totp",
    "two-factor",
    "two_factor",
    "twofactor",
    "verify",
    "verification",
    "challenge",
    "checkpoint",
    "challenge-platform",
    "accountchooser",
    "select-account",
    "select_account",
];

pub(super) fn fragment_move(current: &ContextNavigationTarget, raw: &str) -> bool {
    ContextNavigationTarget::parse(raw).is_ok_and(|next| {
        next.as_url().fragment().is_some()
            && without_fragment(&next).as_url() == without_fragment(current).as_url()
    })
}

/// A change to the fragment alone loads no document, whatever the fragment
/// holds (`#inbox?compose=new`). The stricter `fragment_move` guards the human
/// gate, where a fragment may carry a sign-in step.
pub(super) fn same_document_move(current: &ContextNavigationTarget, raw: &str) -> bool {
    ContextNavigationTarget::parse(raw).is_ok_and(|next| {
        next.as_url().fragment().is_some()
            && without_any_fragment(&next) == without_any_fragment(current)
    })
}

pub(super) fn without_any_fragment(target: &ContextNavigationTarget) -> url::Url {
    let mut url = target.as_url().clone();
    url.set_fragment(None);
    url
}

pub(super) fn without_fragment(target: &ContextNavigationTarget) -> ContextNavigationTarget {
    // Only an app's route (`#inbox`, `#/projects`) is dropped; a fragment
    // with state or a sign-in step in it stays part of the address.
    let route = target.as_url().fragment().is_some_and(|fragment| {
        !fragment.contains('=')
            && zephium_agentic::plain_url_fragment(target)
            && !fragment
                .split(|c: char| !c.is_ascii_alphanumeric() && c != '-' && c != '_')
                .any(|word| SIGN_IN_WORDS.contains(&word.to_ascii_lowercase().as_str()))
    });
    if !route {
        return target.clone();
    }
    let mut url = target.as_url().clone();
    url.set_fragment(None);
    ContextNavigationTarget::parse(url.as_str()).unwrap_or_else(|_| target.clone())
}

impl HumanNavigation {
    fn target(&self, raw: &str) -> Option<ContextNavigationTarget> {
        ContextNavigationTarget::parse(raw).ok().filter(|target| {
            target.as_url().as_str() == raw
                && (zephium_agentic::same_work_human_site(&self.source, target)
                    || (self.open && zephium_agentic::work_site_scheme(target)))
        })
    }
    /// This URL may hold the resumed task. URL checks alone never prove that
    /// a password, account chooser or challenge disappeared from the document.
    fn back_on_site(&self) -> bool {
        self.finished
            && self.loading.is_none()
            // A human may navigate through credential-bearing callback URLs,
            // but the retained actor must never resume on one of those URLs.
            // An app that routes by its fragment (Gmail's `#inbox`) is back
            // on its page; the fragment is the app's, not a request.
            && zephium_agentic::WorkBrowserDocumentPolicy::SiteSession
                .admits_request(&without_fragment(&self.current))
            && zephium_agentic::same_work_human_site(&self.source, &self.current)
            && !self.current.as_url().host_str().is_some_and(|host| {
                [
                    "accounts.",
                    "login.",
                    "signin.",
                    "auth.",
                    "sso.",
                    "identity.",
                    "idp.",
                ]
                .iter()
                .any(|prefix| host.starts_with(prefix))
            })
            && (self.source.as_url().origin() == self.current.as_url().origin()
                || !self
                    .current
                    .as_url()
                    .path_segments()
                    .into_iter()
                    .flatten()
                    .any(|segment| SIGN_IN_WORDS.contains(&segment.to_ascii_lowercase().as_str())))
    }
    fn invalidate_wall(&mut self) {
        self.wall_clear_samples = 0;
        self.wall_sampled = None;
        if let Some(progress) = &self.progress {
            progress.invalidate_wall_check();
            progress.record_verified_wall_clear(false);
        }
    }
    fn verified_wall_clear(&self) -> bool {
        self.back_on_site()
            && !self.requested
            // Clear means a wall that was there is gone, or the person moved
            // the page on: a signed-out landing page shows no wall at all.
            && (self.wall_seen || self.revision != 0)
            && self.wall_clear_samples >= 2
            && self
                .wall_sampled
                .is_some_and(|at| at.elapsed() <= Duration::from_secs(2))
    }
    pub(super) fn allows(&mut self, raw: &str, main_frame: Option<bool>) -> bool {
        if Instant::now() >= self.deadline {
            return false;
        }
        if main_frame == Some(false) {
            return true;
        }
        if main_frame != Some(true) || self.target(raw).is_none() {
            return false;
        }
        // Moving to a fragment of the page itself (Gmail's `#inbox`) loads
        // nothing, even while the page is still loading; `location_changed`
        // records the new address.
        if fragment_move(&self.current, raw) {
            return true;
        }
        if self.loading.is_some() {
            return !self.committed;
        }
        self.invalidate_wall();
        self.requested = true;
        self.finished = false;
        true
    }
    pub(super) fn observe(&mut self, event: wry::NavigationEvent) -> Result<(bool, bool), ()> {
        use wry::NavigationEventPhase as E;
        #[cfg(target_os = "windows")]
        if self
            .write_navigation
            .as_ref()
            .is_some_and(|(id, _, _)| *id == event.id)
            && event.phase != E::Started
        {
            self.write_navigation = None;
        }
        if Instant::now() >= self.deadline {
            return Err(());
        }
        let target = self.target(&event.url).ok_or(())?;
        self.invalidate_wall();
        match event.phase {
            E::Started if self.requested => {
                self.requested = false;
                self.loading = Some(event.id);
                self.committed = false;
                self.finished = false;
                #[cfg(target_os = "windows")]
                {
                    self.write_navigation = Some((event.id, self.revision, target));
                }
                Ok((false, true))
            }
            E::Redirected if self.loading == Some(event.id) && !self.committed => {
                // A native precommit redirect is a new request in this same
                // Human navigation. Preserve its existing target policy while
                // minting only the exact redirect URI's one-use method join.
                // Work's confirmed-action POST token remains separate.
                #[cfg(target_os = "windows")]
                {
                    self.write_navigation = Some((event.id, self.revision, target));
                }
                Ok((false, false))
            }
            E::Committed if self.loading == Some(event.id) && !self.committed => {
                self.native_id = event.id;
                self.current = target;
                self.committed = true;
                self.revision = self.revision.checked_add(1).ok_or(())?;
                Ok((true, true))
            }
            E::Finished if self.loading == Some(event.id) && self.committed => {
                // The finish names the loaded URL; the page may have routed
                // itself to a fragment since (`location_changed` saw it).
                self.loading = None;
                self.finished = true;
                Ok((false, true))
            }
            E::Failed if self.loading == Some(event.id) => {
                self.loading = None;
                self.finished = false;
                Ok((false, true))
            }
            _ => Err(()),
        }
    }
    pub(super) fn location_changed(&mut self, raw: Option<&str>) -> Result<bool, ()> {
        if Instant::now() >= self.deadline {
            return Err(());
        }
        let current = self.target(raw.ok_or(())?).ok_or(())?;
        if self.current == current {
            return Ok(false);
        }
        self.invalidate_wall();
        self.current = current;
        self.revision = self.revision.checked_add(1).ok_or(())?;
        Ok(true)
    }
    #[cfg(target_os = "windows")]
    pub(super) fn allows_windows_request(&mut self, raw: &str, main_frame: Option<bool>) -> bool {
        if main_frame == Some(true) {
            return self.allows(raw, Some(false));
        }
        // Headers may not yet include Sec-Fetch-Dest. Correlate only this
        // Human lease's admitted main Started URI/ID and unchanged revision;
        // absence alone is never main-frame authority. The token is consumed
        // once, with the same same-URI subframe availability limit as Work.
        let current = Instant::now() < self.deadline
            && main_frame.is_none()
            && !self.committed
            && self
                .write_navigation
                .as_ref()
                .is_some_and(|(id, revision, target)| {
                    self.loading == Some(*id)
                        && self.revision == *revision
                        && target.as_url().as_str() == raw
                        && self.target(raw).is_some()
                });
        if current {
            self.write_navigation = None;
        }
        current
    }
}

impl WorkDocumentNavigation {
    pub(crate) fn human_ready(&self) -> bool {
        self.0.lock().is_ok_and(|state| {
            state.phase == Phase::Human
                && state.human.as_ref().is_some_and(|human| {
                    Instant::now() < human.deadline
                        && human.finished
                        && human.loading.is_none()
                        && !human.requested
                })
        })
    }
    pub(crate) fn human_load_preparation_needed(&self, main_frame: Option<bool>) -> bool {
        main_frame == Some(true)
            && self.0.lock().is_ok_and(|state| {
                state.phase == Phase::Human
                    && state
                        .human
                        .as_ref()
                        .is_some_and(|human| human.loading.is_none() && !human.requested)
            })
    }
    /// The person's page moving to a fragment of itself loads no document,
    /// so the page reader is not prepared for one.
    pub(crate) fn human_fragment_move(&self, target: &str) -> bool {
        self.0.lock().is_ok_and(|state| {
            state.phase == Phase::Human
                && state.human.as_ref().is_some_and(|human| {
                    human.loading.is_none() && fragment_move(&human.current, target)
                })
        })
    }
    pub(crate) fn human_verified_wall_clear(&self) -> bool {
        self.0.lock().is_ok_and(|state| {
            state.phase == Phase::Human
                && state
                    .human
                    .as_ref()
                    .is_some_and(HumanNavigation::verified_wall_clear)
        })
    }
    pub(crate) fn bind_human_progress(&self, progress: zephium_agentic::WorkBrowserHumanProgress) {
        if let Ok(mut state) = self.0.lock() {
            if let Some(human) = state.human.as_mut() {
                progress.record_verified_wall_clear(false);
                human.progress = Some(progress);
            }
        }
    }
    pub(crate) fn human_wall_probe(&self) -> Option<WorkHumanDocumentStamp> {
        let state = self.0.lock().ok()?;
        let human = state.human.as_ref()?;
        (state.phase == Phase::Human
            && Instant::now() < human.deadline
            && human.back_on_site()
            && !human.requested
            && human
                .wall_sampled
                .is_none_or(|at| at.elapsed() >= Duration::from_millis(300)))
        .then_some(WorkHumanDocumentStamp {
            epoch: state.navigation_epoch,
            revision: human.revision,
            native_id: human.native_id,
        })
    }
    /// A late callback from an old document/presentation cannot clear a wall.
    pub(crate) fn record_human_wall_clear(
        &self,
        stamp: WorkHumanDocumentStamp,
        clear: bool,
        wall: bool,
    ) -> bool {
        let Ok(mut state) = self.0.lock() else {
            return false;
        };
        if state.phase != Phase::Human || state.navigation_epoch != stamp.epoch {
            return false;
        }
        let Some(human) = state.human.as_mut() else {
            return false;
        };
        if Instant::now() >= human.deadline
            || human.revision != stamp.revision
            || human.native_id != stamp.native_id
            || !human.back_on_site()
            || human.requested
        {
            return false;
        }
        human.wall_seen |= wall;
        human.wall_clear_samples = if clear {
            human.wall_clear_samples.saturating_add(1).min(2)
        } else {
            0
        };
        human.wall_sampled = Some(Instant::now());
        if let Some(progress) = &human.progress {
            progress.record_verified_wall_clear(human.verified_wall_clear());
        }
        true
    }
    pub(crate) fn begin_human(
        &self,
        source: &ContextNavigationTarget,
        deadline: Instant,
        open: bool,
    ) -> Result<(), ()> {
        let now = Instant::now();
        if deadline <= now
            || deadline.duration_since(now)
                > Duration::from_millis(zephium_agentic::MAX_WORK_HUMAN_WAIT_MILLIS)
        {
            return Err(());
        }
        let mut state = self.0.lock().map_err(|_| ())?;
        let site = state.policy == zephium_agentic::WorkBrowserDocumentPolicy::SiteSession;
        let current = state.effective.clone().ok_or(())?;
        if state.phase != Phase::Ready
            || state.human.is_some()
            || (current != *source && !(site && zephium_agentic::same_work_site(source, &current)))
        {
            return Err(());
        }
        state.human = Some(HumanNavigation {
            source: source.clone(),
            open,
            current,
            native_id: state.native_id.ok_or(())?,
            requested: false,
            loading: None,
            committed: true,
            finished: true,
            revision: 0,
            deadline,
            progress: None,
            wall_clear_samples: 0,
            wall_sampled: None,
            wall_seen: false,
            #[cfg(target_os = "windows")]
            write_navigation: None,
        });
        state.follow = None;
        state.phase = Phase::Human;
        state.operation = None;
        Ok(())
    }

    pub(crate) fn human_revision(&self) -> Option<u64> {
        let state = self.0.lock().ok()?;
        (state.phase == Phase::Human)
            .then(|| state.human.as_ref().map(|human| human.revision))
            .flatten()
    }

    /// The caller must hide and retire native input before freezing this gate.
    pub(crate) fn finish_human(
        &self,
        current: &str,
        revision: u64,
    ) -> Result<ContextNavigationTarget, ()> {
        let mut state = self.0.lock().map_err(|_| ())?;
        let human = state.human.as_ref().ok_or(())?;
        if state.phase != Phase::Human
            || Instant::now() >= human.deadline
            || !human.finished
            || human.loading.is_some()
            || human.requested
            || human.revision != revision
            || human.current.as_url().as_str() != current
            || !zephium_agentic::same_work_human_site(&human.source, &human.current)
        {
            return Err(());
        }
        // The app's own fragment is not part of the page the run reads on.
        let target = without_fragment(&human.current);
        let id = human.native_id;
        let epoch = state.navigation_epoch.checked_add(1).ok_or(())?;
        state.human = None;
        state.navigation_epoch = epoch;
        state.native_id = Some(id);
        state.target = Some(target.clone());
        state.effective = Some(target.clone());
        state.operation = None;
        state.requested = false;
        state.admission_kind = None;
        state.phase = Phase::Ready;
        Ok(target)
    }
}

#[cfg(all(test, target_os = "windows"))]
mod windows_tests {
    use super::super::tests::{event, ready_gate, URL};
    use super::*;
    use wry::NavigationEventPhase as E;

    fn human(open: bool) -> WorkDocumentNavigation {
        let gate = ready_gate();
        gate.begin_human(
            &ContextNavigationTarget::parse(URL).unwrap(),
            Instant::now() + Duration::from_secs(30),
            open,
        )
        .unwrap();
        gate
    }

    #[test]
    fn human_missing_destination_joins_one_exact_started_post_with_existing_site_policy() {
        for (open, target) in [
            (false, "https://example.test/login"),
            (true, "https://identity.test/login"),
        ] {
            let gate = human(open);
            assert!(!gate.allows_windows_request(target, "POST", None));
            assert!(gate.allows(target));
            assert!(!gate.allows_windows_request(target, "POST", None));
            gate.observe(event(2, E::Started, target)).unwrap();
            assert!(!gate.allows_windows_request("https://example.test/unrelated", "POST", None));
            assert!(!gate.allows_windows_request("https://attacker.test/login", "POST", None));
            assert!(gate.allows_windows_request(target, "POST", None));
            assert!(!gate.allows_windows_request(target, "POST", None));
            gate.observe(event(2, E::Committed, target)).unwrap();
            gate.observe(event(2, E::Finished, target)).unwrap();
            assert!(!gate.allows_windows_request(target, "POST", None));
        }
        assert!(!human(false).allows("https://identity.test/login"));
    }

    #[test]
    fn human_missing_destination_refuses_cancelled_expired_and_changed_identity() {
        let target = "https://example.test/login";
        for failure in 0..4 {
            let gate = human(false);
            assert!(gate.allows(target));
            gate.observe(event(2, E::Started, target)).unwrap();
            match failure {
                0 => {
                    gate.observe(event(2, E::Cancelled, target)).unwrap();
                }
                1 => {
                    gate.0.lock().unwrap().human.as_mut().unwrap().deadline = Instant::now();
                }
                2 => {
                    gate.0.lock().unwrap().human.as_mut().unwrap().revision += 1;
                }
                _ => {
                    gate.0.lock().unwrap().human.as_mut().unwrap().loading =
                        Some(wry::NavigationId::from_raw(3));
                }
            }
            assert!(!gate.allows_windows_request(target, "POST", None));
            gate.retire();
            assert!(!gate.allows_windows_request(target, "POST", None));
        }
    }

    #[test]
    fn human_missing_destination_redirect_post_uses_only_current_native_target() {
        let first = "https://example.test/login";
        let redirected = "https://example.test/signin/continue";
        let gate = human(false);
        assert!(gate.allows(first));
        gate.observe(event(2, E::Started, first)).unwrap();
        assert!(gate.allows_windows_request(first, "POST", None));
        assert!(!gate.allows_windows_request(first, "POST", None));
        assert!(gate.allows(redirected));
        gate.observe(event(2, E::Redirected, redirected)).unwrap();
        assert!(!gate.allows_windows_request(first, "POST", None));
        assert!(gate.allows_windows_request(redirected, "POST", None));
        assert!(!gate.allows_windows_request(redirected, "POST", None));
        let external = "https://identity.test/continue";
        let gate = human(true);
        assert!(gate.allows(first));
        gate.observe(event(2, E::Started, first)).unwrap();
        assert!(gate.allows(external));
        gate.observe(event(2, E::Redirected, external)).unwrap();
        assert!(gate.allows_windows_request(external, "POST", None));
        assert!(!gate.allows_windows_request(external, "POST", None));
        for (id, target) in [(3, redirected), (2, external)] {
            let gate = human(false);
            assert!(gate.allows(first));
            gate.observe(event(2, E::Started, first)).unwrap();
            gate.observe(event(id, E::Redirected, target)).unwrap();
            assert!(gate.failed());
            assert!(!gate.allows_windows_request(target, "POST", None));
        }
    }

    #[test]
    fn human_missing_destination_token_cannot_survive_handoff_end_or_successor() {
        let gate = human(false);
        assert!(gate.allows(URL));
        gate.observe(event(2, E::Started, URL)).unwrap();
        gate.observe(event(2, E::Committed, URL)).unwrap();
        gate.observe(event(2, E::Finished, URL)).unwrap();
        let revision = gate.human_revision().unwrap();
        gate.finish_human(URL, revision).unwrap();
        assert!(!gate.allows_windows_request(URL, "POST", None));
        gate.begin_human(
            &ContextNavigationTarget::parse(URL).unwrap(),
            Instant::now() + Duration::from_secs(30),
            false,
        )
        .unwrap();
        assert!(!gate.allows_windows_request(URL, "POST", None));
    }
}

#[cfg(all(test, any(target_os = "macos", target_os = "ios")))]
mod tests {
    use super::super::tests::{apple_action, event, ready_gate, URL};
    use super::*;
    use wry::{AppleNavigationType as T, NavigationEventPhase as E};

    #[test]
    fn human_navigation_seals_agent_stamps_and_accepts_only_the_original_origin() {
        let gate = ready_gate();
        let source = ContextNavigationTarget::parse(URL).unwrap();
        gate.begin_human(&source, Instant::now() + Duration::from_secs(30), false)
            .unwrap();
        assert!(gate.ready_target().is_none());
        assert!(!gate.ready(Some(URL)));
        for foreign in [
            "https://example.test.attacker.test/",
            "https://attacker.test/",
            "http://example.test/",
            "https://example.test:8443/",
        ] {
            assert!(!gate.allows_apple_action(foreign, apple_action(T::LinkActivated, true)));
        }
        let current = "https://example.test/en.html";
        assert!(gate.allows_apple_action(current, apple_action(T::FormSubmitted, false)));
        gate.observe(event(2, E::Started, current)).unwrap();
        assert!(gate.finish_human(current, 0).is_err());
        gate.observe(event(2, E::Committed, current)).unwrap();
        let revision = gate.human_revision().unwrap();
        gate.observe(event(2, E::Finished, current)).unwrap();
        assert!(gate.finish_human(current, revision - 1).is_err());
        gate.finish_human(current, revision).unwrap();
        assert!(gate.ready(Some(current)));
        assert!(!gate.allows_apple_action(current, apple_action(T::Reload, true)));
        assert!(gate.finish_human(current, revision).is_err());
    }

    #[test]
    fn human_form_followup_before_start_keeps_one_navigation_episode() {
        let gate = ready_gate();
        let source = ContextNavigationTarget::parse(URL).unwrap();
        gate.begin_human(&source, Instant::now() + Duration::from_secs(30), false)
            .unwrap();
        assert!(gate.allows_apple_action(URL, apple_action(T::FormSubmitted, false)));
        assert!(gate.allows_apple_action(URL, apple_action(T::FormSubmitted, true)));
        assert!(!gate.allows_apple_action(
            "https://attacker.test/",
            apple_action(T::FormSubmitted, true)
        ));
        assert!(!gate.human_ready());
        assert!(!gate.ready(Some(URL)));
        assert!(!gate.human_load_preparation_needed(Some(true)));
        assert!(gate.finish_human(URL, 0).is_err());
        gate.observe(event(2, E::Started, URL)).unwrap();
        gate.observe(event(2, E::Committed, URL)).unwrap();
        assert!(gate.finish_human(URL, 1).is_err());
        gate.observe(event(2, E::Finished, URL)).unwrap();
        assert!(gate.human_ready());
        assert_eq!(gate.human_revision(), Some(1));
        gate.finish_human(URL, 1).unwrap();
        assert!(gate.ready(Some(URL)));
        assert!(!gate.allows_apple_action(URL, apple_action(T::FormSubmitted, true)));
    }

    #[test]
    fn foreign_redirect_and_expired_human_window_cannot_be_frozen() {
        let gate = ready_gate();
        let source = ContextNavigationTarget::parse(URL).unwrap();
        assert!(gate.begin_human(&source, Instant::now(), false).is_err());
        gate.begin_human(&source, Instant::now() + Duration::from_secs(30), false)
            .unwrap();
        assert!(gate.allows_apple_action(URL, apple_action(T::Reload, true)));
        gate.observe(event(2, E::Started, URL)).unwrap();
        gate.observe(event(2, E::Redirected, "https://attacker.test/"))
            .unwrap();
        assert!(gate.failed());
        assert!(gate.finish_human(URL, 0).is_err());
    }

    #[test]
    fn a_sign_in_may_pass_through_another_site_but_must_settle_back() {
        let gate = ready_gate();
        let source = ContextNavigationTarget::parse(URL).unwrap();
        gate.begin_human(&source, Instant::now() + Duration::from_secs(30), true)
            .unwrap();
        let idp = "https://accounts.google.com/signin";
        assert!(gate.allows_apple_action(idp, apple_action(T::LinkActivated, true)));
        assert!(
            !gate.allows_apple_action("http://plain.test/", apple_action(T::LinkActivated, true))
        );
        gate.observe(event(2, E::Started, idp)).unwrap();
        gate.observe(event(2, E::Committed, idp)).unwrap();
        gate.observe(event(2, E::Finished, idp)).unwrap();
        assert!(!gate.human_verified_wall_clear());
        let revision = gate.human_revision().unwrap();
        assert!(gate.finish_human(idp, revision).is_err());
        let back = "https://example.test/home";
        assert!(gate.allows_apple_action(back, apple_action(T::Other, true)));
        gate.observe(event(3, E::Started, back)).unwrap();
        gate.observe(event(3, E::Committed, back)).unwrap();
        gate.observe(event(3, E::Finished, back)).unwrap();
        assert!(
            !gate.human_verified_wall_clear(),
            "returning URL alone cannot clear a wall"
        );
        let stamp = gate.human_wall_probe().unwrap();
        assert!(gate.record_human_wall_clear(stamp, true, false));
        assert!(
            !gate.human_verified_wall_clear(),
            "one transient clear sample is insufficient"
        );
        assert!(gate.record_human_wall_clear(stamp, true, false));
        assert!(gate.human_verified_wall_clear());
        gate.finish_human(back, gate.human_revision().unwrap())
            .unwrap();
    }

    #[test]
    fn a_landing_page_that_never_showed_a_wall_holds_until_the_person_moves_on() {
        let gate = ready_gate();
        let source = ContextNavigationTarget::parse(URL).unwrap();
        gate.begin_human(&source, Instant::now() + Duration::from_secs(30), true)
            .unwrap();
        let stamp = gate.human_wall_probe().unwrap();
        assert!(gate.record_human_wall_clear(stamp, true, false));
        assert!(gate.record_human_wall_clear(stamp, true, false));
        assert!(
            !gate.human_verified_wall_clear(),
            "a page that looked clear from the start was never signed in to"
        );
        assert!(gate.record_human_wall_clear(stamp, false, true));
        assert!(gate.record_human_wall_clear(stamp, true, false));
        assert!(gate.record_human_wall_clear(stamp, true, false));
        assert!(
            gate.human_verified_wall_clear(),
            "the wall it showed is gone"
        );
    }

    #[test]
    fn an_app_moving_to_its_own_fragment_after_sign_in_settles_back_on_its_page() {
        let gate = ready_gate();
        let source = ContextNavigationTarget::parse(URL).unwrap();
        gate.begin_human(&source, Instant::now() + Duration::from_secs(30), true)
            .unwrap();
        let back = "https://example.test/mail/u/0/";
        assert!(gate.allows_apple_action(back, apple_action(T::Other, true)));
        gate.observe(event(2, E::Started, back)).unwrap();
        gate.observe(event(2, E::Committed, back)).unwrap();
        gate.observe(event(2, E::Finished, back)).unwrap();
        let routed = "https://example.test/mail/u/0/#inbox";
        assert!(gate.human_fragment_move(routed));
        assert!(gate.allows_apple_action(routed, apple_action(T::Other, true)));
        assert!(
            gate.human_load_preparation_needed(Some(true)),
            "no load was armed"
        );
        gate.location_changed(Some(routed)).unwrap();
        let stamp = gate.human_wall_probe().unwrap();
        assert!(gate.record_human_wall_clear(stamp, true, false));
        assert!(gate.record_human_wall_clear(stamp, true, false));
        assert!(gate.human_verified_wall_clear());
        let resumed = gate
            .finish_human(routed, gate.human_revision().unwrap())
            .unwrap();
        assert_eq!(resumed.as_url().as_str(), back);
        assert!(
            gate.ready(Some(routed)),
            "the app's fragment stays its page"
        );
        assert!(!gate.human_fragment_move("https://example.test/mail/u/0/#inbox"));
    }

    #[test]
    fn a_route_set_while_the_landing_page_loads_survives_its_finish() {
        let gate = ready_gate();
        let source = ContextNavigationTarget::parse(URL).unwrap();
        gate.begin_human(&source, Instant::now() + Duration::from_secs(30), true)
            .unwrap();
        let back = "https://example.test/mail/u/0/";
        assert!(gate.allows_apple_action(back, apple_action(T::Other, true)));
        gate.observe(event(2, E::Started, back)).unwrap();
        gate.observe(event(2, E::Committed, back)).unwrap();
        let routed = "https://example.test/mail/u/0/#inbox";
        assert!(gate.allows_apple_action(routed, apple_action(T::Other, true)));
        gate.location_changed(Some(routed)).unwrap();
        gate.observe(event(2, E::Finished, back)).unwrap();
        let revision = gate.human_revision().unwrap();
        gate.finish_human(routed, revision).unwrap();
    }

    #[test]
    fn a_fragment_carrying_a_token_is_never_the_page_signed_in_to() {
        let gate = ready_gate();
        let source = ContextNavigationTarget::parse(URL).unwrap();
        gate.begin_human(&source, Instant::now() + Duration::from_secs(30), true)
            .unwrap();
        let back = "https://example.test/home";
        assert!(gate.allows_apple_action(back, apple_action(T::Other, true)));
        gate.observe(event(2, E::Started, back)).unwrap();
        gate.observe(event(2, E::Committed, back)).unwrap();
        gate.observe(event(2, E::Finished, back)).unwrap();
        let token = "https://example.test/home#access_token=abc123def456ghi789";
        gate.location_changed(Some(token)).unwrap();
        assert!(gate.human_wall_probe().is_none());
        assert!(!gate.human_verified_wall_clear());
    }

    #[test]
    fn a_two_factor_step_on_the_site_is_still_signing_in() {
        let gate = ready_gate();
        let source = ContextNavigationTarget::parse(URL).unwrap();
        gate.begin_human(&source, Instant::now() + Duration::from_secs(30), true)
            .unwrap();
        for (id, path) in [
            (2, "https://example.test/sessions/two-factor/app"),
            (3, "https://example.test/account/otp"),
            (4, "https://example.test/signin/verification"),
        ] {
            assert!(gate.allows_apple_action(path, apple_action(T::Other, true)));
            gate.observe(event(id, E::Started, path)).unwrap();
            gate.observe(event(id, E::Committed, path)).unwrap();
            gate.observe(event(id, E::Finished, path)).unwrap();
            assert!(!gate.human_verified_wall_clear(), "{path}");
        }
    }
}

#[cfg(test)]
mod wall_proof_tests {
    use super::super::tests::{ready_gate, URL};
    use super::*;

    fn human() -> (
        WorkDocumentNavigation,
        zephium_agentic::WorkBrowserHumanProgress,
    ) {
        let gate = ready_gate();
        gate.begin_human(
            &ContextNavigationTarget::parse(URL).unwrap(),
            Instant::now() + Duration::from_secs(30),
            true,
        )
        .unwrap();
        let progress = zephium_agentic::WorkBrowserHumanProgress::default();
        gate.bind_human_progress(progress.clone());
        (gate, progress)
    }

    #[test]
    fn same_document_wall_clear_requires_two_fresh_dom_samples_and_rejects_late_documents() {
        let (gate, progress) = human();
        let revision = gate.human_revision();
        let stamp = gate.human_wall_probe().unwrap();
        assert!(gate.record_human_wall_clear(stamp, false, true));
        assert!(!progress.verified_wall_clear());
        assert!(gate.record_human_wall_clear(stamp, true, false));
        assert!(!progress.verified_wall_clear());
        assert!(gate.record_human_wall_clear(stamp, true, false));
        assert!(progress.verified_wall_clear());
        assert_eq!(
            gate.human_revision(),
            revision,
            "same-URL DOM proof is not a navigation"
        );
        {
            let mut state = gate.0.lock().unwrap();
            state
                .human
                .as_mut()
                .unwrap()
                .location_changed(Some("https://example.test/next"))
                .unwrap();
        }
        assert!(
            !progress.verified_wall_clear(),
            "native location changes revoke proof immediately"
        );
        assert!(!gate.record_human_wall_clear(stamp, true, false));
        let next = gate.human_wall_probe().unwrap();
        assert!(gate.record_human_wall_clear(next, true, false));
        assert!(gate.record_human_wall_clear(next, true, false));
        assert!(gate.human_verified_wall_clear());
        gate.retire();
        assert!(
            !gate.record_human_wall_clear(next, true, false),
            "a stopped native page cannot recover authority"
        );
    }

    #[test]
    fn strong_dom_clearance_can_resume_the_same_sign_in_path_without_a_navigation() {
        let (gate, progress) = human();
        {
            let mut state = gate.0.lock().unwrap();
            state
                .human
                .as_mut()
                .unwrap()
                .location_changed(Some("https://example.test/human-fixture/signin/1"))
                .unwrap();
        }
        let revision = gate.human_revision();
        let stamp = gate
            .human_wall_probe()
            .expect("an unchanged sign-in route may replace its DOM in place");
        assert!(gate.record_human_wall_clear(stamp, false, true));
        assert!(
            !progress.verified_wall_clear(),
            "a credential/chooser observation is never bypassed by the URL"
        );
        assert!(gate.record_human_wall_clear(stamp, true, false));
        assert!(gate.record_human_wall_clear(stamp, true, false));
        assert!(progress.verified_wall_clear());
        assert_eq!(gate.human_revision(), revision);
        {
            let mut state = gate.0.lock().unwrap();
            state
                .human
                .as_mut()
                .unwrap()
                .location_changed(Some("https://accounts.google.com/home"))
                .unwrap();
        }
        assert!(
            gate.human_wall_probe().is_none(),
            "identity hosts/outside sites are not task content even without a login path"
        );
        assert!(!progress.verified_wall_clear());
    }

    #[test]
    fn authentication_callback_state_stays_with_the_person_until_an_admissible_document() {
        for suffix in [
            "?code=fixture",
            "?state=fixture",
            "?token=fixture",
            "#verification",
        ] {
            let (gate, progress) = human();
            let stamp = gate.human_wall_probe().unwrap();
            assert!(gate.record_human_wall_clear(stamp, true, false));
            assert!(gate.record_human_wall_clear(stamp, true, false));
            {
                let mut state = gate.0.lock().unwrap();
                let human = state.human.as_mut().unwrap();
                human
                    .location_changed(Some(&format!("https://example.test/verify{suffix}")))
                    .unwrap();
                assert!(human.target("https://example.test/workspace").is_some());
            }
            assert!(!progress.verified_wall_clear());
            assert!(gate.human_wall_probe().is_none());
            assert!(!gate.record_human_wall_clear(stamp, true, false));
            {
                let mut state = gate.0.lock().unwrap();
                state
                    .human
                    .as_mut()
                    .unwrap()
                    .location_changed(Some("https://example.test/workspace"))
                    .unwrap();
            }
            let clean = gate.human_wall_probe().unwrap();
            assert!(gate.record_human_wall_clear(clean, true, false));
            assert!(gate.record_human_wall_clear(clean, true, false));
            assert!(progress.verified_wall_clear());
        }
    }

    #[test]
    fn expired_or_prior_presentation_proof_cannot_clear_the_current_wall() {
        let (gate, _) = human();
        let prior = gate.human_wall_probe().unwrap();
        assert!(gate.record_human_wall_clear(prior, true, false));
        assert!(gate.record_human_wall_clear(prior, true, false));
        gate.0.lock().unwrap().human.as_mut().unwrap().wall_sampled =
            Some(Instant::now() - Duration::from_secs(3));
        assert!(!gate.human_verified_wall_clear());
        gate.finish_human(URL, gate.human_revision().unwrap())
            .unwrap();
        gate.begin_human(
            &ContextNavigationTarget::parse(URL).unwrap(),
            Instant::now() + Duration::from_secs(30),
            true,
        )
        .unwrap();
        assert!(
            !gate.record_human_wall_clear(prior, true, false),
            "same URL/native id does not reuse a prior human epoch"
        );
        assert!(!gate.human_verified_wall_clear());
    }
}
