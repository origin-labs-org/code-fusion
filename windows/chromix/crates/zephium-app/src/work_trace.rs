//! Closed facts from the page lane and searches for the Work development
//! log: causes, counts and phases, never page, model or person text. The host
//! installs the sink; without one nothing is written.
use std::sync::{Arc, OnceLock};

pub type WorkTraceSink = dyn Fn(std::fmt::Arguments<'_>) + Send + Sync;

static SINK: OnceLock<Arc<WorkTraceSink>> = OnceLock::new();

pub fn install(sink: Arc<WorkTraceSink>) {
    let _ = SINK.set(sink);
}

pub fn record(arguments: std::fmt::Arguments<'_>) {
    if let Some(sink) = SINK.get() {
        sink(arguments);
    }
}

/// Closed optional-media facts. This channel cannot carry URLs, page text,
/// account identity, source references, or pixel bytes.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RecordMediaTrace {
    /// Closed original read authority status, never signed-out or pixel proof.
    OriginalRead {
        status: zephium_agentic::WorkBrowserAnonymousReadStatus,
    },
    /// The retained app owner refused the queued request before native dispatch.
    OwnerRefused,
    /// Exact native source-stage counts before any retrieval attempt.
    Source {
        observed_images: usize,
        eligible_image_geometry: usize,
        structural_candidates: usize,
        saturated_candidates: usize,
        identity_roles: [usize; 7],
        identity_fields: [usize; 4],
        self_image_pairs: usize,
        records: usize,
        identity_sources: usize,
        same_capture_pairs: usize,
        related_pairs: usize,
    },
    /// Original immutable authority facts, never origin/account or task text.
    PublicAssetAuthority {
        isolated_public: bool,
        public_policy: bool,
        identified_account: bool,
        request_present: bool,
        private_session: bool,
        read: bool,
        has_goal: bool,
        entry: bool,
        view: bool,
        allow_edits: bool,
        hold_typing: bool,
    },
    /// Later sign-in clearance can only remove the original public retry mode.
    PublicAssetResolution {
        original_public: bool,
        sign_in_resumed: bool,
    },
    /// Native source association and retained-owner admission.
    Admitted {
        plans: usize,
        original_crop_permits: usize,
        native_started: bool,
        public_asset_retry: bool,
        work_memory: bool,
    },
    /// Native terminal output and immutable Store acknowledgement counts.
    Settled {
        native_images: usize,
        native_fetch: usize,
        public_fetch: usize,
        native_crop: usize,
        stored: usize,
    },
}

type RecordMediaTraceSink = dyn Fn(RecordMediaTrace) + Send + Sync;
static MEDIA_SINK: OnceLock<Arc<RecordMediaTraceSink>> = OnceLock::new();

/// Installs an optional host-owned diagnostic sink; ordinary hosts install none.
pub fn install_record_media(sink: Arc<RecordMediaTraceSink>) {
    let _ = MEDIA_SINK.set(sink);
}

/// Records counts through the closed channel, independently of free-text traces.
pub fn record_media(event: RecordMediaTrace) {
    if let Some(sink) = MEDIA_SINK.get() {
        sink(event);
    }
}
