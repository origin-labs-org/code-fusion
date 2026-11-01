//! A move preserves the checked original and puts a separate recovery copy in Trash.
use super::*;
use std::sync::atomic::{AtomicBool, Ordering};

pub(crate) struct PreparedMove {
    pub original: PreparedTrash,
    pub destination: PathBuf,
    #[cfg(any(target_os = "macos", windows))]
    target: native::Destination,
}
impl PreparedMove {
    pub fn prepare(
        grant: &WorkFileGrant,
        from: &str,
        to: &str,
        known: &str,
    ) -> Result<Self, Failure> {
        available()?;
        root()?;
        // Shares only the exact macOS build qualified for native recovery.
        // The generic MoveFile implementation and Windows stay gated.
        Self::prepare_checked(grant, from, to, known)
    }
    pub(super) fn prepare_checked(
        grant: &WorkFileGrant,
        from: &str,
        to: &str,
        known: &str,
    ) -> Result<Self, Failure> {
        let destination = grant.resolve(to, true).map_err(Failure::File)?;
        let _destination_guards =
            super::super::pin_directories(Path::new(to).parent().ok_or(Failure::Input)?)
                .map_err(Failure::File)?;
        let original = PreparedTrash::prepare_checked(grant, from, known)?;
        if destination == original.path || std::fs::symlink_metadata(&destination).is_ok() {
            return Err(Failure::Destination);
        }
        #[cfg(any(target_os = "macos", windows))]
        {
            let target = native::Destination::new(destination.clone())?;
            Ok(Self {
                original,
                destination,
                target,
            })
        }
        #[cfg(not(any(target_os = "macos", windows)))]
        {
            let _ = (original, destination);
            Err(Failure::Unavailable)
        }
    }
    pub fn fact(&self) -> WorkLocalStepV1 {
        let mut fact = self.original.fact();
        fact.proposal = Some(format!(
            "Move {} to {}; refuse overwrite and keep a separate recovery copy in Trash.",
            self.original.path.display(),
            self.destination.display()
        ));
        fact
    }
    pub fn apply(self, profile: &str, step: &str, cancelled: &AtomicBool) -> Result<(), Failure> {
        self.apply_at(root()?, profile, step, cancelled).map(|_| ())
    }
    pub(super) fn apply_at(
        self,
        root: &Path,
        profile: &str,
        step: &str,
        cancelled: &AtomicBool,
    ) -> Result<PathBuf, Failure> {
        if cancelled.load(Ordering::Acquire) {
            return Err(Failure::Stopped);
        }
        #[cfg(any(target_os = "macos", windows))]
        {
            self.target.check()?;
            let journal = journal::Journal::open(root, profile, true)?.ok_or(Failure::Storage)?;
            let receipt = journal::Receipt {
                version: 1,
                id: self.original.id,
                path: self.original.path,
                digest: self.original.native.digest.clone(),
                bytes: self.original.native.text.len(),
                step: step.into(),
                destination: Some(self.destination),
            };
            let record = journal.prepare(receipt, self.original.native.text.as_bytes())?;
            let stage = record.stage()?;
            let acknowledged =
                self.original
                    .native
                    .move_to(&stage, &record, &self.target, cancelled)?;
            record.mark("moved").map_err(|_| Failure::RecoveryPending)?;
            Ok(acknowledged)
        }
        #[cfg(not(any(target_os = "macos", windows)))]
        {
            let _ = (root, profile, step);
            Err(Failure::Unavailable)
        }
    }
}
