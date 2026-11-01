//! Optional media keeps the same drained native resource and its terminal owner.
use super::*;
use crate::platform::{
    record_media::{self, Crop, FrameCapture, NativeMediaResult},
    work_document_navigation::WorkDocumentNavigation,
};
use std::{
    cell::{Cell, RefCell},
    rc::Rc,
};
use zephium_agentic::{
    SemanticRecordMediaOutcome, SemanticRecordMediaPlan, WorkBrowserMediaProgress,
    WorkBrowserRecordImage,
};

macro_rules! media_stage {
    ($stage:ident) => {
        #[cfg(all(target_os = "macos", feature = "native-agentic-semantic-probe"))]
        record_media::probe_stage(record_media::ProbeStage::$stage);
    };
}

pub(super) struct Batch {
    presentation: RefCell<crate::platform::imp::WorkObservationPresentation>,
    presented: Cell<bool>,
    ready_since: Cell<Option<Instant>>,
    started: Cell<bool>,
    finished: Cell<Option<bool>>,
    wakes: Cell<u16>,
    cancelled: Arc<std::sync::atomic::AtomicBool>,
    task: RefCell<Option<WorkLifecycleTask>>,
    guard: Arc<WorkResourceGuard>,
    progress: WorkBrowserMediaProgress,
    deadline: zephium_agentic::AgentPolicyInstant,
    plans: Vec<SemanticRecordMediaPlan>,
    fetch_mode: zephium_agentic::WorkBrowserMediaFetchMode,
    cursor: Cell<usize>,
    images: RefCell<Vec<WorkBrowserRecordImage>>,
    public_asset: RefCell<Option<PendingPublicAsset>>,
    semantic: record_media::MediaDispatch,
    capture: FrameCapture,
    privacy: record_media::PrivacyDispatch,
    gate: WorkDocumentNavigation,
}
struct PendingPublicAsset {
    plan: SemanticRecordMediaPlan,
    url: String,
    reply: zephium_agentic::WorkBrowserPublicAssetReply,
    window: Rc<RefCell<record_media::MediaRetryWindow>>,
}
impl Batch {
    fn current(&self, plan: &SemanticRecordMediaPlan) -> bool {
        let current = self.guard.media_current()
            && self.progress.current()
            && self.presentation.borrow().human_current()
            && work_browser_monotonic_now().is_some_and(|now| {
                now < self.deadline
                    && self.task.try_borrow().ok().is_some_and(|task| {
                        task.as_ref()
                            .and_then(WorkLifecycleTask::request)
                            .is_some_and(|request| {
                                request.media_fetch_authority_current(self.guard.resource(), now)
                            })
                    })
            })
            && self
                .gate
                .observation_stamp(plan.frame().context())
                .is_some();
        if !current {
            self.cancelled.store(true, Ordering::Release);
        }
        current
    }
    fn crop_current(&self, plan: &SemanticRecordMediaPlan) -> bool {
        let current = self.current(plan) && plan.local_crop_permitted(Instant::now());
        if !current {
            self.cancelled.store(true, Ordering::Release);
        }
        current
    }
    fn next(self: Rc<Self>) {
        let Some(plan) = self.plans.get(self.cursor.get()).cloned() else {
            self.finish(true);
            return;
        };
        if !self.current(&plan) {
            self.finish(true);
            return;
        }
        self.cursor.set(self.cursor.get() + 1);
        let Some(now) = work_browser_monotonic_now() else {
            self.finish(false);
            return;
        };
        let started = Instant::now();
        let window = Rc::new(RefCell::new(record_media::MediaRetryWindow::new(
            started,
            Duration::from_millis(self.deadline.millis().saturating_sub(now.millis())),
            self.fetch_mode == zephium_agentic::WorkBrowserMediaFetchMode::PublicAssetRetry,
        )));
        let initial = window.borrow_mut().initial(started);
        let Some(fetch) = initial else {
            self.next();
            return;
        };
        self.fetch(plan, fetch, window);
    }
    fn fetch(
        self: Rc<Self>,
        plan: SemanticRecordMediaPlan,
        fetch: record_media::MediaFetchAttempt,
        window: Rc<RefCell<record_media::MediaRetryWindow>>,
    ) {
        if !self.current(&plan) {
            self.finish(true);
            return;
        }
        media_stage!(Dispatched);
        let batch = self.clone();
        (self.semantic)(
            &plan.clone(),
            false,
            fetch,
            Box::new(move |outcome| {
                if !batch.current(&plan) {
                    media_stage!(CurrentLost);
                    batch.finish(outcome.is_some());
                    return;
                }
                // Renderer dispatch/callback delay never extends the original
                // public-asset window. Its callback still drains before discard.
                if batch.fetch_mode == zephium_agentic::WorkBrowserMediaFetchMode::PublicAssetRetry
                    && !window.borrow().active(Instant::now())
                {
                    batch.next();
                    return;
                }
                match outcome {
                    Some(NativeMediaResult::RetryableNetwork) => {
                        let retry = window
                            .borrow_mut()
                            .retry(Instant::now(), batch.current(&plan));
                        if let Some(retry) = retry {
                            batch.fetch(plan, retry, window);
                        } else {
                            batch.next();
                        }
                    }
                    Some(NativeMediaResult::PublicAsset(url)) => {
                        let now = work_browser_monotonic_now();
                        let remaining = window.borrow().remaining(Instant::now());
                        let reply = now.zip(remaining).and_then(|(now, remaining)| {
                            let deadline = zephium_agentic::AgentPolicyInstant::from_millis(
                                now.millis().checked_add(u64::from(remaining))?,
                            );
                            batch
                                .progress
                                .request_public_asset(&plan, &url, now, deadline)
                        });
                        if let Some(reply) = reply {
                            media_stage!(PublicAssetQueued);
                            *batch.public_asset.borrow_mut() = Some(PendingPublicAsset {
                                plan,
                                url,
                                reply,
                                window,
                            });
                            crate::host::notify_work_resource(batch.guard.clone());
                        } else {
                            media_stage!(PublicAssetDenied);
                            batch.next();
                        }
                    }
                    Some(NativeMediaResult::Fetched(bytes)) => {
                        plan.record_native_outcome(SemanticRecordMediaOutcome::Fetched);
                        media_stage!(Fetched);
                        if let Some(image) = record_media::raster(&plan, bytes, None) {
                            plan.record_native_outcome(SemanticRecordMediaOutcome::Fetched);
                            batch.images.borrow_mut().push(image);
                            batch.next();
                        } else {
                            batch.validate_for_crop(plan);
                        }
                    }
                    Some(NativeMediaResult::Crop(crop)) => {
                        media_stage!(Crop);
                        batch.capture_crop(plan, crop)
                    }
                    Some(NativeMediaResult::Unavailable(reason, stage)) => {
                        plan.record_native_outcome(reason);
                        plan.record_native_fetch_stage(stage);
                        media_stage!(Unavailable);
                        batch.next()
                    }
                    None => {
                        media_stage!(TransportUnknown);
                        batch.finish(false)
                    }
                }
            }),
        );
    }
    fn poll_public_asset(self: Rc<Self>) {
        let Some(pending) = self.public_asset.borrow_mut().take() else {
            return;
        };
        if !self.current(&pending.plan) || !pending.window.borrow().active(Instant::now()) {
            media_stage!(PublicAssetExpired);
            self.next();
            return;
        }
        let Some(result) = pending.reply.poll() else {
            *self.public_asset.borrow_mut() = Some(pending);
            return;
        };
        let Some(bytes) = result else {
            media_stage!(PublicAssetUnavailable);
            self.next();
            return;
        };
        media_stage!(PublicAssetBytes);
        let batch = self.clone();
        (self.semantic)(
            &pending.plan.clone(),
            false,
            record_media::MediaFetchAttempt::public_validation(),
            Box::new(move |outcome| match outcome {
                Some(NativeMediaResult::PublicAsset(url))
                    if url == pending.url
                        && batch.current(&pending.plan)
                        && pending.window.borrow().active(Instant::now()) =>
                {
                    media_stage!(PublicAssetVerified);
                    if let Some(image) = record_media::raster_public(&pending.plan, bytes) {
                        pending
                            .plan
                            .record_native_outcome(SemanticRecordMediaOutcome::Fetched);
                        batch.images.borrow_mut().push(image);
                    } else {
                        media_stage!(PublicAssetRasterRejected);
                    }
                    batch.next();
                }
                Some(_) => {
                    media_stage!(PublicAssetUnverified);
                    batch.next()
                }
                None => batch.finish(false),
            }),
        );
    }
    fn validate_for_crop(self: Rc<Self>, plan: SemanticRecordMediaPlan) {
        if !self.current(&plan) {
            self.finish(true);
            return;
        }
        let batch = self.clone();
        (self.semantic)(
            &plan.clone(),
            true,
            record_media::MediaFetchAttempt::validation(),
            Box::new(move |outcome| match outcome {
                Some(NativeMediaResult::Crop(crop)) if batch.current(&plan) => {
                    batch.capture_crop(plan, crop)
                }
                Some(NativeMediaResult::Unavailable(reason, stage)) => {
                    plan.record_native_outcome(reason);
                    plan.record_native_fetch_stage(stage);
                    batch.next()
                }
                Some(_) => batch.next(),
                None => batch.finish(false),
            }),
        );
    }
    fn capture_crop(self: Rc<Self>, plan: SemanticRecordMediaPlan, crop: Crop) {
        if !plan.local_crop_permitted(Instant::now()) {
            plan.record_native_outcome(SemanticRecordMediaOutcome::CropNotAuthorized);
            media_stage!(CropPermissionMissing);
            self.next();
            return;
        }
        if !self.crop_current(&plan) {
            self.finish(true);
            return;
        }
        let before = self.clone();
        let before_plan = plan.clone();
        let probe = Rc::new(
            move |reply: crate::platform::semantic_pixel_privacy::PrivacyCompletion| {
                if !before.crop_current(&before_plan) {
                    reply(None);
                    return;
                }
                let after = before.clone();
                let captured = before_plan.clone();
                (before.privacy)(Box::new(move |proof| {
                    reply(if after.crop_current(&captured) {
                        proof
                    } else {
                        None
                    })
                }));
            },
        );
        let capture = self.clone();
        let capture_plan = plan.clone();
        let after = self.clone();
        crate::platform::semantic_pixel_privacy::guarded_capture_at(
            crop.proof,
            probe,
            move |reply| {
                if !capture.crop_current(&capture_plan) {
                    return Err(zephium_agentic::SemanticScreenshotNativeFailure::Cancelled);
                }
                if !capture_plan.begin_local_crop(Instant::now()) {
                    return Err(
                        zephium_agentic::SemanticScreenshotNativeFailure::ResourceExhausted,
                    );
                }
                let capture_started = Instant::now();
                let pending = Rc::new(RefCell::new(Some(reply)));
                let callback = pending.clone();
                let dispatched = (capture.capture)(
                    crop,
                    Box::new(move |frame| {
                        if let Some(reply) = callback.borrow_mut().take() {
                            reply(
                                if capture_started.elapsed()
                                    > Duration::from_millis(
                                        zephium_agentic::MAX_SEMANTIC_SCREENSHOT_CAPTURE_MILLIS,
                                    )
                                {
                                    Err(zephium_agentic::SemanticScreenshotNativeFailure::TimedOut)
                                } else {
                                    frame.ok_or(
                                        zephium_agentic::SemanticScreenshotNativeFailure::NotReady,
                                    )
                                },
                            );
                        }
                    }),
                );
                if !dispatched && pending.borrow().is_some() {
                    Err(zephium_agentic::SemanticScreenshotNativeFailure::NotReady)
                } else {
                    Ok(())
                }
            },
            self.cancelled.clone(),
            move |frame| {
                let Ok(frame) = frame else {
                    plan.record_native_outcome(SemanticRecordMediaOutcome::PrivacyRefused);
                    after.next();
                    return;
                };
                if !after.crop_current(&plan) {
                    after.finish(true);
                    return;
                }
                let final_owner = after.clone();
                (after.semantic)(
                    &plan.clone(),
                    true,
                    record_media::MediaFetchAttempt::validation(),
                    Box::new(move |outcome| {
                        if let Some(NativeMediaResult::Crop(current)) = outcome {
                            if final_owner.crop_current(&plan)
                                && plan.local_crop_permitted(Instant::now())
                                && current == crop
                            {
                                if let Some(image) =
                                    record_media::raster(&plan, frame.png, Some(frame.geometry))
                                {
                                    plan.record_native_outcome(SemanticRecordMediaOutcome::Fetched);
                                    final_owner.images.borrow_mut().push(image);
                                }
                            }
                            final_owner.next();
                        } else if let Some(NativeMediaResult::Unavailable(reason, stage)) = outcome
                        {
                            plan.record_native_outcome(reason);
                            plan.record_native_fetch_stage(stage);
                            final_owner.next();
                        } else if outcome.is_some() {
                            final_owner.next();
                        } else {
                            final_owner.finish(false);
                        }
                    }),
                );
            },
        );
    }

    fn finish(self: Rc<Self>, clean: bool) {
        if !clean {
            self.cancelled.store(true, Ordering::Release);
        }
        self.finished
            .set(Some(self.finished.get().unwrap_or(true) && clean));
        crate::host::notify_work_resource(self.guard.clone());
    }
    pub(super) fn presented(&self) -> bool {
        self.presented.get()
    }
    pub(super) fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
        self.progress.cancel();
        if !self.started.get() {
            self.finished.set(Some(true));
        }
        crate::host::notify_work_resource(self.guard.clone());
    }
}
impl WorkNativeResource {
    pub(super) fn handle_media(&mut self, task: WorkLifecycleTask) {
        let Some(request) = task.request() else {
            task.complete(Outcome::Refused);
            return;
        };
        let admitted = || {
            if !self.guard.media_current() || !self.ready() || self.pending() {
                media_stage!(OwnerNotReady);
                return None;
            }
            let plans = request.media_plans()?.to_vec();
            let now = work_browser_monotonic_now()?;
            if !request.media_fetch_authority_current(self.guard.resource(), now) {
                return None;
            }
            let progress = request.media_progress()?;
            let deadline = request.media_deadline()?;
            if plans.is_empty() || plans.len() > 12 {
                media_stage!(InvalidPlanCount);
                return None;
            }
            let view = self.view.as_ref()?;
            let (semantic, capture, privacy) = view.record_media_ports()?;
            let gate = view.work_navigation()?.clone();
            if plans
                .iter()
                .any(|plan| gate.observation_stamp(plan.frame().context()).is_none())
            {
                media_stage!(SourceNotCurrent);
                return None;
            }
            Some((plans, progress, deadline, semantic, capture, gate, privacy))
        };
        let Some((plans, progress, deadline, semantic, capture, gate, privacy)) = admitted() else {
            media_stage!(AdmissionRefused);
            task.complete(Outcome::Refused);
            return;
        };
        let fetch_mode = request.media_fetch_mode();
        let Some(view) = self.view.as_ref() else {
            task.complete(Outcome::Refused);
            return;
        };
        let Some(now) = work_browser_monotonic_now() else {
            task.complete(Outcome::Refused);
            return;
        };
        let expires =
            Instant::now() + Duration::from_millis(deadline.millis().saturating_sub(now.millis()));
        #[cfg(feature = "native-agentic-work-lifetime-diagnostic")]
        let prepared = {
            let guard = self.guard.clone();
            crate::platform::imp::WorkObservationPresentation::prepare(
                view.view(),
                expires,
                move |failure| {
                    guard.record_failure_cause(ResourceFailureCause::ObservationPresentation(
                        failure,
                    ))
                },
            )
        };
        #[cfg(not(feature = "native-agentic-work-lifetime-diagnostic"))]
        let prepared =
            crate::platform::imp::WorkObservationPresentation::prepare(view.view(), expires);
        let Ok(presentation) = prepared else {
            media_stage!(PresentationRefused);
            task.complete(Outcome::Refused);
            return;
        };
        media_stage!(Admitted);
        self.media_pending = true;
        let batch = Rc::new(Batch {
            presentation: RefCell::new(presentation),
            presented: Cell::new(false),
            ready_since: Cell::new(None),
            started: Cell::new(false),
            finished: Cell::new(None),
            wakes: Cell::new(0),
            cancelled: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            task: RefCell::new(Some(task)),
            guard: self.guard.clone(),
            progress,
            deadline,
            plans,
            fetch_mode,
            cursor: Cell::new(0),
            images: RefCell::new(Vec::new()),
            public_asset: RefCell::new(None),
            semantic,
            capture,
            privacy,
            gate,
        });
        self.media_batch = Some(batch);
        crate::host::notify_work_resource(self.guard.clone());
    }
}

impl EngineHost {
    pub(super) fn progress_work_media(&mut self, guard: &Arc<WorkResourceGuard>) {
        use crate::platform::imp::PresentationState;
        let id = guard.resource().identity().context();
        let Some(batch) = self
            .work_resources
            .get(&id)
            .filter(|resource| Arc::ptr_eq(&resource.guard, guard))
            .and_then(|resource| resource.media_batch.clone())
        else {
            return;
        };
        if !batch.started.get() && batch.plans.first().is_none_or(|plan| !batch.current(plan)) {
            if batch.finished.get().is_none() {
                media_stage!(CurrentLost);
            }
            batch.finished.set(Some(true));
        }
        if batch.finished.get().is_none() && !batch.started.get() {
            if !batch.presented.get() && self.work_presentation_available(id) {
                batch.presentation.borrow_mut().present();
                batch.presented.set(true);
            }
            let state = if batch.presented.get() {
                batch.presentation.borrow_mut().poll()
            } else {
                PresentationState::Acquiring
            };
            match state {
                PresentationState::Ready => {
                    let since = batch.ready_since.get().unwrap_or_else(Instant::now);
                    batch.ready_since.set(Some(since));
                    if since.elapsed() >= Duration::from_millis(100) {
                        batch.started.set(true);
                        batch.clone().next();
                    }
                }
                PresentationState::Prepared | PresentationState::Acquiring => {}
                _ => batch.finished.set(Some(false)),
            }
        }
        batch.clone().poll_public_asset();
        if let Some(clean) = batch.finished.get() {
            let retired = batch.presentation.borrow_mut().retire() == PresentationState::Retired;
            let Some(resource) = self.work_resources.get_mut(&id) else {
                return;
            };
            if let Some(wake) = &mut resource.media_wake {
                wake.cancel();
            }
            let drained = resource
                .media_wake
                .as_ref()
                .is_none_or(observation::ObservationWake::drained);
            if retired && drained {
                resource.media_wake = None;
                resource.media_pending = false;
                resource.media_batch = None;
                if clean && guard.media_current() {
                    batch
                        .progress
                        .finish(std::mem::take(&mut *batch.images.borrow_mut()));
                } else {
                    batch.progress.cancel();
                }
                if let Some(task) = batch.task.borrow_mut().take() {
                    task.complete(if clean {
                        Outcome::MediaRead
                    } else {
                        Outcome::Refused
                    });
                }
                return;
            }
        }
        let Some(resource) = self.work_resources.get_mut(&id) else {
            return;
        };
        if resource
            .media_wake
            .as_ref()
            .is_some_and(observation::ObservationWake::drained)
        {
            resource.media_wake = None;
        }
        if resource.media_wake.is_none() {
            if batch.wakes.get() >= 200 {
                guard.fail();
                return;
            }
            batch.wakes.set(batch.wakes.get() + 1);
            resource.media_wake = observation::ObservationWake::schedule(guard);
            if resource.media_wake.is_none() {
                guard.fail();
                batch.finished.set(Some(false));
            }
        }
    }
}
