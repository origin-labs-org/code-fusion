use crate::NativeWorkComposition;
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use zephium_agentic::{
    AgentBrowserHumanReason, WorkBrowserHumanRegion, MAX_WORK_HUMAN_WAIT_MILLIS,
};
use zephium_app::{RetainedHumanPhase, RetainedWorkHandle};
use zephium_core::{
    ids::ProfileId,
    work::{WorkAttemptId, WorkError, WorkId, WorkStepId},
};
use zephium_ipc::work::*;

type Key = (ProfileId, WorkId, WorkAttemptId, WorkStepId);
type Notify = Arc<dyn Fn(WorkHumanChangedV1) + Send + Sync>;
const MAX_RETAINED_HUMAN_PAGES: usize = 3;
/// What one "keep waiting" adds to a short wait. A short wait never grows
/// past the long one a sign-in gets, nor past the page's own deadline.
const EXTEND_SHORT_WAIT: Duration = Duration::from_secs(90);
#[derive(Default)]
pub(crate) struct HumanPages(Mutex<Pages>);
#[derive(Default)]
struct Pages {
    entries: BTreeMap<Key, Page>,
    notify: Option<Notify>,
}
struct Page {
    handle: RetainedWorkHandle,
    projected: Option<WorkHumanPageV1>,
    account: Option<(u32, WorkHumanAccountV1)>,
    released: bool,
    short: Option<ShortWait>,
    facts: HumanPageFacts,
    /// This page puts its site's bot check to the person.
    check_claimed: bool,
}
/// What the page was opened as, for the person's words about it.
pub(crate) struct HumanPageFacts {
    /// The page's registrable site, for an alert outside the window.
    pub(crate) site: Option<String>,
    pub(crate) work_memory: bool,
}
/// A short wait the run gives the person, and what the person added to it.
struct ShortWait {
    since: Instant,
    cap: Duration,
    extra: Duration,
}
impl ShortWait {
    fn ends(&self) -> Instant {
        self.since + self.cap + self.extra
    }
    /// How much longer the person may still ask for, within `deadline`.
    fn room(&self, deadline: Instant) -> Duration {
        let ceiling = Duration::from_millis(MAX_WORK_HUMAN_WAIT_MILLIS);
        deadline
            .saturating_duration_since(self.ends())
            .min(ceiling.saturating_sub(self.cap + self.extra))
    }
}
/// A page now waiting on the person, for the app's alert outside its window.
pub struct WaitingHumanPage {
    pub key: String,
    pub reason: WorkHumanReasonV1,
    pub site: Option<String>,
}
pub(crate) struct HumanRegistration<'a> {
    pages: &'a HumanPages,
    key: Key,
}
impl HumanPages {
    pub(crate) fn register(
        &self,
        key: Key,
        handle: RetainedWorkHandle,
        facts: HumanPageFacts,
    ) -> Result<HumanRegistration<'_>, WorkError> {
        let mut pages = self.0.lock().map_err(|_| WorkError::Unavailable)?;
        if pages.entries.len() >= MAX_RETAINED_HUMAN_PAGES || pages.entries.contains_key(&key) {
            return Err(WorkError::Capacity);
        }
        pages.entries.insert(
            key,
            Page {
                handle,
                projected: None,
                account: None,
                released: false,
                short: None,
                facts,
                check_claimed: false,
            },
        );
        Ok(HumanRegistration { pages: self, key })
    }
}
impl HumanRegistration<'_> {
    pub(crate) fn update(&self) {
        let Ok(mut pages) = self.pages.0.lock() else {
            return;
        };
        let Some(page) = pages.entries.get_mut(&self.key) else {
            return;
        };
        let next = snapshot(page, self.key);
        // Remaining time is computed on reads; it is not an invalidation clock.
        let changed = match (&page.projected, &next) {
            (Some(old), Some(new)) => {
                old.id != new.id
                    || old.phase != new.phase
                    || old.document_revision != new.document_revision
                    || old.can_continue != new.can_continue
                    || old.can_extend != new.can_extend
            }
            (None, None) => false,
            _ => true,
        };
        page.projected = next;
        let notify = pages.notify.clone();
        drop(pages);
        if changed {
            notify_change(notify, self.key);
        }
    }
}
impl HumanRegistration<'_> {
    /// Whether this page puts its bot check to the person: the first of
    /// this work's pages on a site to claim it does, while it still waits;
    /// any other page of the site meeting the check meanwhile does not.
    pub(crate) fn claim_site_check(&self) -> bool {
        let Ok(mut pages) = self.pages.0.lock() else {
            return true;
        };
        let Some(site) = pages
            .entries
            .get(&self.key)
            .and_then(|page| page.facts.site.clone())
        else {
            return true;
        };
        let taken = pages.entries.iter().any(|(key, page)| {
            *key != self.key
                && (key.0, key.1) == (self.key.0, self.key.1)
                && page.check_claimed
                && !page.released
                && page.facts.site.as_deref() == Some(site.as_str())
                && page.handle.human_snapshot().is_some_and(|human| {
                    human.reason == AgentBrowserHumanReason::HumanChallenge
                        && matches!(
                            human.phase,
                            RetainedHumanPhase::WaitingForHuman
                                | RetainedHumanPhase::Presenting
                                | RetainedHumanPhase::Presented
                        )
                })
        });
        if let Some(page) = pages.entries.get_mut(&self.key) {
            page.check_claimed = !taken;
        }
        !taken
    }

    /// How long a short wait lasts now, from `since`: the run's cap plus what
    /// the person added. A long wait, or none, is left as it is; a wait that
    /// starts again starts without the additions.
    pub(crate) fn wait_for(&self, since: Instant, cap: u64) -> u64 {
        if cap == 0 || cap >= MAX_WORK_HUMAN_WAIT_MILLIS {
            return cap;
        }
        let Ok(mut pages) = self.pages.0.lock() else {
            return cap;
        };
        let Some(page) = pages.entries.get_mut(&self.key) else {
            return cap;
        };
        let cap = Duration::from_millis(cap);
        let short = match &mut page.short {
            Some(short) if short.since == since => short,
            other => other.insert(ShortWait {
                since,
                cap,
                extra: Duration::ZERO,
            }),
        };
        short.cap = cap;
        u64::try_from((short.cap + short.extra).as_millis()).unwrap_or(u64::MAX)
    }
}
impl Drop for HumanRegistration<'_> {
    fn drop(&mut self) {
        if let Ok(mut pages) = self.pages.0.lock() {
            if let Some(page) = pages.entries.remove(&self.key) {
                page.handle.close();
            }
            let notify = pages.notify.clone();
            drop(pages);
            notify_change(notify, self.key);
        }
    }
}
fn notify_change(notify: Option<Notify>, key: Key) {
    if let Some(notify) = notify {
        notify(WorkHumanChangedV1 {
            profile: key.0.to_string(),
            work: key.1,
        });
    }
}
fn snapshot(page: &Page, key: Key) -> Option<WorkHumanPageV1> {
    let Some(state) = page.handle.human_snapshot() else {
        let mut prior = page.projected.clone()?;
        prior.phase = if page.released || page.handle.is_closed() {
            WorkHumanPhaseV1::Released
        } else {
            WorkHumanPhaseV1::Reading
        };
        prior.can_continue = false;
        prior.remaining_millis = 0;
        return Some(prior);
    };
    // While nobody has taken the page, a short wait ends it before its deadline.
    let short = page
        .short
        .as_ref()
        .filter(|_| state.phase == RetainedHumanPhase::WaitingForHuman && !page.released);
    let ends = short.map_or(state.deadline, |short| short.ends().min(state.deadline));
    Some(WorkHumanPageV1 {
        id: WorkHumanPageIdV1 {
            attempt: key.2,
            step: key.3,
            generation: state.generation,
        },
        phase: if page.released {
            WorkHumanPhaseV1::Released
        } else {
            match state.phase {
                RetainedHumanPhase::WaitingForHuman => WorkHumanPhaseV1::WaitingForHuman,
                RetainedHumanPhase::Presenting => WorkHumanPhaseV1::Presenting,
                RetainedHumanPhase::Presented => WorkHumanPhaseV1::Presented,
                RetainedHumanPhase::Continuing | RetainedHumanPhase::ReadyToResume => {
                    WorkHumanPhaseV1::Continuing
                }
                RetainedHumanPhase::Released => WorkHumanPhaseV1::Released,
            }
        },
        reason: reason_of(state.reason),
        remaining_millis: u32::try_from(ends.saturating_duration_since(Instant::now()).as_millis())
            .unwrap_or(u32::MAX),
        document_revision: state.document_revision.to_string(),
        can_continue: state.can_continue && !page.released,
        can_extend: short.is_some_and(|short| !short.room(state.deadline).is_zero()),
        work_memory: page.facts.work_memory,
    })
}
fn reason_of(reason: AgentBrowserHumanReason) -> WorkHumanReasonV1 {
    match reason {
        AgentBrowserHumanReason::SignIn => WorkHumanReasonV1::SignIn,
        AgentBrowserHumanReason::HumanChallenge => WorkHumanReasonV1::Challenge,
        AgentBrowserHumanReason::Permission => WorkHumanReasonV1::Permission,
        AgentBrowserHumanReason::Verification => WorkHumanReasonV1::Verification,
        AgentBrowserHumanReason::UserDecision => WorkHumanReasonV1::UserDecision,
        AgentBrowserHumanReason::SensitiveEffect => WorkHumanReasonV1::SensitiveEffect,
        AgentBrowserHumanReason::UnsupportedInteraction => {
            WorkHumanReasonV1::UnsupportedInteraction
        }
    }
}
impl NativeWorkComposition {
    pub fn release_presented_human_pages(&self) {
        if let Ok(mut pages) = self.human_pages.0.lock() {
            for page in pages.entries.values_mut() {
                if page.handle.human_snapshot().is_some_and(|state| {
                    matches!(
                        state.phase,
                        RetainedHumanPhase::Presenting
                            | RetainedHumanPhase::Presented
                            | RetainedHumanPhase::Continuing
                    )
                }) {
                    page.released = true;
                    page.handle.close();
                }
            }
        }
    }

    pub fn set_human_page_observer(&self, observer: Notify) {
        if let Ok(mut pages) = self.human_pages.0.lock() {
            pages.notify = Some(observer);
        }
    }
    pub fn human_pages(
        &self,
        profile: ProfileId,
        work: WorkId,
    ) -> Result<Vec<WorkHumanPageV1>, WorkError> {
        let pages = self
            .human_pages
            .0
            .lock()
            .map_err(|_| WorkError::Unavailable)?;
        Ok(pages
            .entries
            .iter()
            .filter(|(key, _)| key.0 == profile && key.1 == work)
            .filter_map(|(key, page)| snapshot(page, *key))
            .collect())
    }
    /// Every page, of any profile or work, still waiting for the person to take it.
    pub fn pages_waiting_for_person(&self) -> Vec<WaitingHumanPage> {
        let Ok(pages) = self.human_pages.0.lock() else {
            return Vec::new();
        };
        pages
            .entries
            .iter()
            .filter(|(_, page)| !page.released)
            .filter_map(|(key, page)| {
                let state = page.handle.human_snapshot()?;
                (state.phase == RetainedHumanPhase::WaitingForHuman).then(|| WaitingHumanPage {
                    key: format!(
                        "{}:{}:{}:{}:{}",
                        key.0, key.1, key.2, key.3, state.generation
                    ),
                    reason: reason_of(state.reason),
                    site: page.facts.site.clone(),
                })
            })
            .collect()
    }
    /// Keeps a short wait going a while longer, at the person's word.
    pub fn extend_human_page(
        &self,
        profile: ProfileId,
        work: WorkId,
        id: WorkHumanPageIdV1,
    ) -> Result<(), WorkError> {
        self.with_human_page(profile, work, id, |page| {
            let Some(state) = page
                .handle
                .human_snapshot()
                .filter(|state| state.phase == RetainedHumanPhase::WaitingForHuman)
            else {
                return false;
            };
            let Some(short) = page.short.as_mut() else {
                return false;
            };
            let room = short.room(state.deadline);
            if room.is_zero() {
                return false;
            }
            short.extra += EXTEND_SHORT_WAIT.min(room);
            true
        })
    }
    pub fn present_human_page(
        &self,
        profile: ProfileId,
        work: WorkId,
        id: WorkHumanPageIdV1,
        region: WorkHumanRegionV1,
    ) -> Result<(), WorkError> {
        let region =
            WorkBrowserHumanRegion::try_new(region.x, region.y, region.width, region.height)
                .ok_or(WorkError::Invalid)?;
        self.with_human_page(profile, work, id, |page| {
            page.handle.present_human(id.generation, region)
        })
    }
    /// Actively request one coalesced native survey of this exact live page.
    /// A click never clears the wall or extends any deadline.
    pub async fn check_human_page(
        &self,
        profile: ProfileId,
        work: WorkId,
        id: WorkHumanPageIdV1,
    ) -> WorkHumanCheckOutcomeV1 {
        use zephium_agentic::WorkBrowserHumanCheckState as Check;
        let check = {
            let Ok(pages) = self.human_pages.0.lock() else {
                return WorkHumanCheckOutcomeV1::Unavailable;
            };
            let Some(page) = pages.entries.get(&(profile, work, id.attempt, id.step)) else {
                return WorkHumanCheckOutcomeV1::Unavailable;
            };
            let Some(state) = page.handle.human_snapshot().filter(|state| {
                state.generation == id.generation && Instant::now() < state.deadline
            }) else {
                return WorkHumanCheckOutcomeV1::Unavailable;
            };
            if page.released
                || !page.handle.human_requests_open()
                || !matches!(
                    state.reason,
                    AgentBrowserHumanReason::SignIn | AgentBrowserHumanReason::HumanChallenge
                )
            {
                return WorkHumanCheckOutcomeV1::Unavailable;
            }
            if matches!(
                state.phase,
                RetainedHumanPhase::WaitingForHuman | RetainedHumanPhase::Presenting
            ) {
                return WorkHumanCheckOutcomeV1::OpenPage;
            }
            let Some(check) = page.handle.check_human(id.generation) else {
                return WorkHumanCheckOutcomeV1::Unavailable;
            };
            check
        };
        loop {
            let result = {
                let Ok(pages) = self.human_pages.0.lock() else {
                    return WorkHumanCheckOutcomeV1::Unavailable;
                };
                let Some(page) = pages.entries.get(&(profile, work, id.attempt, id.step)) else {
                    return WorkHumanCheckOutcomeV1::Unavailable;
                };
                let Some(state) = page.handle.human_snapshot().filter(|state| {
                    state.generation == id.generation && Instant::now() < state.deadline
                }) else {
                    return WorkHumanCheckOutcomeV1::Unavailable;
                };
                if page.released
                    || !page.handle.human_requests_open()
                    || state.phase != RetainedHumanPhase::Presented
                {
                    return WorkHumanCheckOutcomeV1::Unavailable;
                }
                page.handle.human_check_state(id.generation, &check)
            };
            match result {
                Check::Waiting => return WorkHumanCheckOutcomeV1::Waiting,
                Check::Clear => return WorkHumanCheckOutcomeV1::Clear,
                Check::Unavailable => return WorkHumanCheckOutcomeV1::Unavailable,
                Check::Pending => tokio::time::sleep(Duration::from_millis(25)).await,
            }
        }
    }
    pub fn continue_human_page(
        &self,
        profile: ProfileId,
        work: WorkId,
        id: WorkHumanPageIdV1,
        account: WorkHumanAccountV1,
    ) -> Result<(), WorkError> {
        self.with_human_page(profile, work, id, |page| {
            if page.account.is_some()
                || !page
                    .handle
                    .human_snapshot()
                    .is_some_and(|state| state.can_continue)
                || !page.handle.continue_human(id.generation)
            {
                return false;
            }
            page.account = Some((id.generation, account));
            true
        })
    }
    pub fn release_human_page(
        &self,
        profile: ProfileId,
        work: WorkId,
        id: WorkHumanPageIdV1,
    ) -> Result<(), WorkError> {
        self.with_human_page(profile, work, id, |page| {
            page.released = true;
            page.handle.close();
            true
        })
    }
    fn with_human_page(
        &self,
        profile: ProfileId,
        work: WorkId,
        id: WorkHumanPageIdV1,
        action: impl FnOnce(&mut Page) -> bool,
    ) -> Result<(), WorkError> {
        let mut pages = self
            .human_pages
            .0
            .lock()
            .map_err(|_| WorkError::Unavailable)?;
        let page = pages
            .entries
            .get_mut(&(profile, work, id.attempt, id.step))
            .ok_or(WorkError::Unavailable)?;
        if page.released
            || !page.handle.human_snapshot().is_some_and(|state| {
                state.generation == id.generation && Instant::now() < state.deadline
            })
            || !action(page)
        {
            return Err(WorkError::Invalid);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_short_wait_grows_at_the_persons_word_within_the_long_wait_and_the_deadline() {
        let since = Instant::now();
        let later = since + Duration::from_secs(3600);
        let long = Duration::from_millis(MAX_WORK_HUMAN_WAIT_MILLIS);
        let mut wait = ShortWait {
            since,
            cap: Duration::from_secs(90),
            extra: Duration::ZERO,
        };
        assert_eq!(wait.room(later), long - Duration::from_secs(90));
        assert_eq!(
            wait.room(since + Duration::from_secs(120)),
            Duration::from_secs(30)
        );
        assert!(wait.room(since + Duration::from_secs(60)).is_zero());
        wait.extra = long - wait.cap;
        assert_eq!(wait.ends(), since + long);
        assert!(wait.room(later).is_zero());
    }
}
