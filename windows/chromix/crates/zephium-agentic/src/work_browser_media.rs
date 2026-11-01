//! Optional bounded asset reads on a drained, still-owned Work page.
use super::*;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};

/// Trusted original task authority for optional asset retrieval. This does not
/// assert that a Work-memory jar has no cookies or that public bytes equal an
/// authenticated representation. It never grants screenshot/account authority.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum WorkBrowserMediaFetchMode {
    /// Keep the native session behavior; never remove credentials and retry.
    #[default]
    SessionOnly,
    /// Bounded cross-origin anonymous retries after opaque network/CORS failure.
    /// Native HTTPS fallback retains the original window and public task grant.
    PublicAssetRetry,
}

/// Whether an admitted asset came from the page's own session or exact pixels.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WorkBrowserRecordImageOrigin {
    /// Exact anonymous HTTPS source, retrieved under the original public-read grant.
    PublicFetch,
    /// Retrieved in the native browser context from the exact observed source.
    NativeFetch,
    /// Cropped from a fresh privacy-fenced native frame of that exact element.
    NativeCrop,
}
/// Ephemeral numeric raster diagnostics, never pixels or new capture authority.
#[derive(Clone, Copy, Debug)]
pub struct WorkBrowserCropGeometry {
    /// Encoded native frame dimensions before the record crop.
    pub captured: [u32; 2],
    /// CSS viewport dimensions attested by the privacy proof.
    pub viewport: [f64; 2],
    /// Exact original DOM rectangle in that viewport.
    pub css_rect: [f64; 4],
    /// Inward-rounded native pixel rectangle.
    pub raster_rect: [u32; 4],
}
/// Sanitized native bytes joined to a private source-record plan. Local canvas
/// custody only: this is not a provider screenshot or serializable model input.
/// ```compile_fail
/// fn disclose(image: zephium_agentic::WorkBrowserRecordImage) -> zephium_agentic::SemanticScreenshot {
///     image
/// }
/// ```
/// ```compile_fail
/// fn serialize(image: zephium_agentic::WorkBrowserRecordImage) {
///     let _ = serde_json::to_vec(&image);
/// }
/// ```
#[derive(Clone)]
pub struct WorkBrowserRecordImage {
    record: u16,
    source: [u8; 32],
    origin: WorkBrowserRecordImageOrigin,
    width: u16,
    height: u16,
    png: Arc<Vec<u8>>,
    crop_geometry: Option<WorkBrowserCropGeometry>,
}
impl WorkBrowserRecordImage {
    /// Called only by the native adapter after raster decoding, privacy checks,
    /// metadata stripping, and exact original plan revalidation.
    pub fn from_native(
        plan: &crate::SemanticRecordMediaPlan,
        origin: WorkBrowserRecordImageOrigin,
        width: u16,
        height: u16,
        png: Vec<u8>,
    ) -> Option<Self> {
        ((origin != WorkBrowserRecordImageOrigin::NativeCrop
            || plan.local_crop_reserved(std::time::Instant::now()))
            && width > 0
            && height > 0
            && width <= 320
            && height <= 240
            && !png.is_empty()
            && png.len() <= 65536)
            .then(|| Self {
                record: plan.record(),
                source: plan.source(),
                origin,
                width,
                height,
                png: Arc::new(png),
                crop_geometry: None,
            })
    }
    /// Attaches numeric native geometry only; it grants no permission and is not persisted.
    pub fn with_crop_geometry(mut self, geometry: WorkBrowserCropGeometry) -> Self {
        if self.origin == WorkBrowserRecordImageOrigin::NativeCrop {
            self.crop_geometry = Some(geometry);
        }
        self
    }
    /// Content-free diagnostic geometry, absent for fetched assets.
    pub const fn crop_geometry(&self) -> Option<WorkBrowserCropGeometry> {
        self.crop_geometry
    }
    /// Original flattened record index.
    pub const fn record(&self) -> u16 {
        self.record
    }
    /// Exact private native plan identity, distinct from the archived row digest.
    pub const fn source(&self) -> [u8; 32] {
        self.source
    }
    /// Actual acquisition method.
    pub const fn origin(&self) -> WorkBrowserRecordImageOrigin {
        self.origin
    }
    /// Encoded dimensions bounded by the record preview budget.
    pub const fn dimensions(&self) -> (u16, u16) {
        (self.width, self.height)
    }
    /// Immutable sanitized PNG; no cookies, remote addresses, or image metadata.
    pub fn png(&self) -> &[u8] {
        self.png.as_slice()
    }
}
impl fmt::Debug for WorkBrowserRecordImage {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("WorkBrowserRecordImage")
            .field("record", &self.record)
            .field("bytes", &self.png.len())
            .finish()
    }
}
struct Progress {
    cancelled: AtomicBool,
    completed: AtomicBool,
    result: Mutex<Option<Vec<WorkBrowserRecordImage>>>,
    public_asset: Mutex<public_asset::Exchange>,
    waker: Mutex<Option<std::task::Waker>>,
}
/// Bounded result projection; cancellation revokes publication, never native debt.
#[derive(Clone)]
pub struct WorkBrowserMediaProgress(Arc<Progress>);
impl fmt::Debug for WorkBrowserMediaProgress {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("WorkBrowserMediaProgress")
            .finish_non_exhaustive()
    }
}
impl WorkBrowserMediaProgress {
    fn new() -> Self {
        Self(Arc::new(Progress {
            cancelled: AtomicBool::new(false),
            completed: AtomicBool::new(false),
            result: Mutex::new(None),
            public_asset: Mutex::new(public_asset::Exchange::default()),
            waker: Mutex::new(None),
        }))
    }
    /// Revokes result publication immediately. The original native owner must drain.
    pub fn cancel(&self) {
        self.0.cancelled.store(true, Ordering::Release);
        if let Ok(mut exchange) = self.0.public_asset.lock() {
            exchange.pending.take();
        }
        if let Ok(mut result) = self.0.result.lock() {
            let completed = self.0.completed.swap(true, Ordering::AcqRel);
            if !completed || result.is_some() {
                *result = Some(Vec::new());
            }
        }
    }
    /// Whether the original result is still allowed to publish.
    pub fn current(&self) -> bool {
        !self.0.cancelled.load(Ordering::Acquire)
    }
    /// Take a terminal result once. Empty means no qualified image was available.
    pub fn take_result(&self) -> Option<Vec<WorkBrowserRecordImage>> {
        let result = self.0.result.lock().ok()?.take()?;
        Some(if self.current() { result } else { Vec::new() })
    }
    /// Native terminal projection only; this does not settle a lifecycle request.
    pub fn finish(&self, images: Vec<WorkBrowserRecordImage>) -> bool {
        let Ok(mut result) = self.0.result.lock() else {
            return false;
        };
        if images.len() > 12
            || result.is_some()
            || !self.current()
            || self.0.completed.swap(true, Ordering::AcqRel)
        {
            return false;
        }
        *result = Some(images);
        true
    }
}
#[derive(Clone)]
pub(super) struct MediaRetryAuthority {
    pub(super) original: WorkBrowserAnonymousReadAuthority,
    pub(super) resource: WorkBrowserResourceJoin,
    pub(super) generation: u64,
    pub(super) deadline: AgentPolicyInstant,
}
impl fmt::Debug for MediaRetryAuthority {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("MediaRetryAuthority([redacted])")
    }
}
#[derive(Clone, Debug)]
pub(super) struct MediaRead {
    pub(super) retry_authority: Option<MediaRetryAuthority>,
    pub(super) fetch_mode: WorkBrowserMediaFetchMode,
    pub(super) plans: Vec<crate::SemanticRecordMediaPlan>,
    pub(super) progress: WorkBrowserMediaProgress,
    pub(super) deadline: AgentPolicyInstant,
}
impl WorkBrowserResourceRequest {
    /// Host-admitted original task class, independent of cookie-jar contents.
    pub fn media_fetch_mode(&self) -> WorkBrowserMediaFetchMode {
        self.media
            .as_ref()
            .map_or(WorkBrowserMediaFetchMode::SessionOnly, |media| {
                media.fetch_mode
            })
    }

    /// Rechecks the request's original opaque retry proof at native admission
    /// and each callback. This does not attest cookie state or permit pixels.
    /// The supplied resource must be the native owner's independently bound join.
    pub fn media_fetch_authority_current(
        &self,
        resource: &WorkBrowserResourceJoin,
        now: AgentPolicyInstant,
    ) -> bool {
        let Some(media) = self.media.as_ref() else {
            return false;
        };
        if self.operation() != WorkBrowserResourceOperation::ReadMedia
            || self.resource() != resource
            || now >= media.deadline
            || !media.progress.current()
            || media.plans.is_empty()
            || media.plans.len() > 12
        {
            return false;
        }
        if media.fetch_mode == WorkBrowserMediaFetchMode::SessionOnly {
            return true;
        }
        let Some(authority) = &media.retry_authority else {
            return false;
        };
        self.isolated_public
            && authority.resource == *resource
            && authority.deadline == media.deadline
            && media.plans.iter().all(|plan| {
                plan.frame().frame() == crate::FrameId::MAIN
                    && plan.frame().context().identity().id() == resource.identity().context()
                    && plan.frame().context().context_generation().get() == authority.generation
                    && authority
                        .original
                        .matches(plan.frame().context().identity(), now)
            })
    }

    /// Exact private source-record candidates of this admitted optional read.
    pub fn media_plans(&self) -> Option<&[crate::SemanticRecordMediaPlan]> {
        self.media.as_ref().map(|media| media.plans.as_slice())
    }
    /// Bounded native result projection for this exact admitted read.
    pub fn media_progress(&self) -> Option<WorkBrowserMediaProgress> {
        self.media.as_ref().map(|media| media.progress.clone())
    }
    /// Immutable media deadline, bounded by the original active deadline and8seconds.
    pub fn media_deadline(&self) -> Option<AgentPolicyInstant> {
        self.media.as_ref().map(|media| media.deadline)
    }
}
impl WorkBrowserResources {
    /// Admits one optional media batch only after all actor lease work drains.
    /// It preserves profile/session/page identity and grants no actor or navigation scope.
    pub fn read_record_media(
        &mut self,
        resource: &WorkBrowserResourceJoin,
        plans: Vec<crate::SemanticRecordMediaPlan>,
        fetch_mode: WorkBrowserMediaFetchMode,
        now: AgentPolicyInstant,
        deadline: AgentPolicyInstant,
    ) -> Result<(WorkBrowserResourceRequest, WorkBrowserMediaProgress), WorkBrowserResourceError>
    {
        if self.sealed {
            return Err(WorkBrowserResourceError::Sealed);
        }
        if plans.is_empty()
            || plans.len() > 12
            || deadline <= now
            || deadline.millis() - now.millis() > 8000
            || plans.iter().any(|plan| {
                plan.frame().frame() != crate::FrameId::MAIN
                    || plan.frame().context().identity().id() != resource.identity().context()
            })
        {
            return Err(WorkBrowserResourceError::Source);
        }
        let sequence = self.next()?;
        let row = self.row_mut(resource)?;
        if row.phase != WorkBrowserResourcePhase::Retained
            || row.pending.is_some()
            || row.failure.is_some()
            || row.lease.is_some()
            || !row.document_available
        {
            return Err(WorkBrowserResourceError::Phase);
        }
        let deadline = if fetch_mode == WorkBrowserMediaFetchMode::PublicAssetRetry {
            let proof = row
                .anonymous_read_authority
                .as_ref()
                .ok_or(WorkBrowserResourceError::Source)?;
            if !row.isolated_public
                || !plans.iter().all(|plan| {
                    proof.matches(plan.frame().context().identity(), now)
                        && row.anonymous_read_generation
                            == Some(plan.frame().context().context_generation().get())
                })
            {
                return Err(WorkBrowserResourceError::Source);
            }
            proof
                .bound_deadline(now, deadline)
                .ok_or(WorkBrowserResourceError::Expired)?
        } else {
            deadline
        };
        let retry_authority = if fetch_mode == WorkBrowserMediaFetchMode::PublicAssetRetry {
            Some(MediaRetryAuthority {
                original: row
                    .anonymous_read_authority
                    .clone()
                    .ok_or(WorkBrowserResourceError::Source)?,
                resource: resource.clone(),
                generation: row
                    .anonymous_read_generation
                    .ok_or(WorkBrowserResourceError::Source)?,
                deadline,
            })
        } else {
            None
        };
        row.tick(now)?;
        let operation = OperationJoin {
            resource: resource.clone(),
            sequence,
            kind: WorkBrowserResourceOperation::ReadMedia,
            lease: None,
        };
        row.pending = Some(operation.clone());
        let progress = WorkBrowserMediaProgress::new();
        if let Ok(mut exchange) = progress.0.public_asset.lock() {
            exchange.authority = retry_authority.clone();
            exchange.plans = plans.clone();
        }
        Ok((
            WorkBrowserResourceRequest {
                construction: None,
                operation: Box::new(operation),
                storage: row.storage,
                isolated_public: row.isolated_public,
                document: row.document.clone(),
                document_policy: row.document_policy,
                delivery: None,
                health: None,
                human: None,
                media: Some(Box::new(MediaRead {
                    retry_authority,
                    fetch_mode,
                    plans,
                    progress: progress.clone(),
                    deadline,
                })),
            },
            progress,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn private_image() -> WorkBrowserRecordImage {
        WorkBrowserRecordImage {
            record: 0,
            source: [1; 32],
            origin: WorkBrowserRecordImageOrigin::NativeCrop,
            width: 1,
            height: 1,
            png: Arc::new(vec![1, 2, 3]),
            crop_geometry: None,
        }
    }
    #[test]
    fn cancellation_erases_private_bytes_and_late_native_completion_cannot_republish() {
        for completed_before_stop in [false, true] {
            let progress = WorkBrowserMediaProgress::new();
            if completed_before_stop {
                assert!(progress.finish(vec![private_image()]));
            }
            progress.cancel();
            assert!(!progress.current());
            assert!(progress.take_result().unwrap().is_empty());
            progress.cancel();
            assert!(!progress.finish(vec![private_image()]));
            assert!(progress.take_result().is_none());
        }
    }
}

#[path = "work_browser_public_asset.rs"]
mod public_asset;
pub use public_asset::{
    WorkBrowserPublicAssetReply, WorkBrowserPublicAssetRequest, MAX_PUBLIC_RECORD_IMAGE_BYTES,
};
