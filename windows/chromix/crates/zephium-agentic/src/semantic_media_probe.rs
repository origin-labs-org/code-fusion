//! Release-excluded observer of already validated Name source coordinates.
use crate::SemanticFrameJoin;
use std::sync::{Arc, Mutex};

/// Opaque native source coordinates. No constructor, serialization, source text,
/// arbitrary URL payload, pixels, or new read/capture authority is exposed to model callers.
pub struct SemanticMediaNameProbe {
    pub(crate) record: u16,
    pub(crate) frame: SemanticFrameJoin,
    pub(crate) invocation: u64,
    pub(crate) snapshot: u64,
    pub(crate) node: u64,
}
impl SemanticMediaNameProbe {
    /// Original flattened record ordinal, not its model-proposed name.
    pub const fn record(&self) -> u16 {
        self.record
    }
    /// Exact native context/document/frame provenance.
    pub const fn frame(&self) -> &SemanticFrameJoin {
        &self.frame
    }
    /// Original native invocation coordinate.
    pub const fn invocation(&self) -> u64 {
        self.invocation
    }
    /// Original native snapshot coordinate.
    pub const fn snapshot(&self) -> u64 {
        self.snapshot
    }
    /// Native node coordinate; diagnostic receivers must never log this value.
    pub const fn node(&self) -> u64 {
        self.node
    }
}
impl std::fmt::Debug for SemanticMediaNameProbe {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SemanticMediaNameProbe([redacted])")
    }
}
/// A probe-only observer; its return value cannot change extraction or authority.
pub type SemanticMediaNameObserver = dyn Fn(&[SemanticMediaNameProbe], bool) + Send + Sync;
static OBSERVER: Mutex<Option<Arc<SemanticMediaNameObserver>>> = Mutex::new(None);
/// Installs or removes the single release-excluded native diagnostics observer.
/// Production/model paths cannot configure this hook. Account mode must remove it.
pub fn set_semantic_media_name_probe(observer: Option<Arc<SemanticMediaNameObserver>>) {
    if let Ok(mut slot) = OBSERVER.lock() {
        *slot = observer;
    }
}
pub(crate) fn observer() -> Option<Arc<SemanticMediaNameObserver>> {
    OBSERVER.lock().ok()?.clone()
}
