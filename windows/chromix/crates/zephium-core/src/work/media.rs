//! Immutable native record pictures. References describe stored content, not fetch authority.
use super::{WorkArtifactId, WorkAttemptId, WorkError, WorkExecutionId, WorkId, WorkStepId};
use serde::{Deserialize, Serialize};

pub const MAX_RECORD_MEDIA_BYTES: usize = 64 * 1024;
pub const MAX_RECORD_MEDIA_PER_STEP: usize = 12;
pub const MAX_RECORD_MEDIA_WIDTH: u16 = 320;
pub const MAX_RECORD_MEDIA_HEIGHT: u16 = 240;

#[cfg_attr(feature = "ipc-types", derive(specta::Type))]
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkRecordMediaOriginV1 {
    /// Exact anonymous HTTPS source, retrieved under the original public-read grant.
    PublicFetch,
    NativeFetch,
    NativeCrop,
}

#[cfg_attr(feature = "ipc-types", derive(specta::Type))]
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkRecordMediaRefV1 {
    pub profile: crate::ids::ProfileId,
    pub work: WorkId,
    pub execution: WorkExecutionId,
    pub attempt: WorkAttemptId,
    pub step: WorkStepId,
    pub extraction: WorkArtifactId,
    pub record: u16,
    pub source: String,
    pub digest: String,
    pub width: u16,
    pub height: u16,
    pub origin: WorkRecordMediaOriginV1,
}

impl WorkRecordMediaRefV1 {
    pub fn validate(&self) -> Result<(), WorkError> {
        let digest = |text: &str| {
            text.len() == 64
                && text
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        };
        if !digest(&self.source)
            || !digest(&self.digest)
            || !(1..=MAX_RECORD_MEDIA_WIDTH).contains(&self.width)
            || !(1..=MAX_RECORD_MEDIA_HEIGHT).contains(&self.height)
        {
            return Err(WorkError::Invalid);
        }
        Ok(())
    }
}

/// Whether a legacy public image candidate passes the shared public URL policy.
/// This does not grant native session access or pixel-capture authority.
pub fn is_public_image_candidate(value: &str) -> bool {
    super::runtime::validate_public_reference_url(value).is_ok()
}
