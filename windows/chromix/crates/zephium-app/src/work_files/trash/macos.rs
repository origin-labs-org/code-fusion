//! The original is staged on the same volume before the native Trash call.
//! No pathname replacement can turn that call into deletion of an unchecked file.
#[path = "macos_move.rs"]
mod move_file;
use super::{digest, journal::Record, Failure, MAX_BYTES};
use crate::work_files::{open_unix, single_link};
pub(super) use move_file::Destination;
use objc2_foundation::{NSFileManager, NSString, NSURL};
use std::{
    ffi::CString,
    fs::File,
    io::{Read, Seek, SeekFrom},
    os::{
        fd::{AsRawFd, FromRawFd},
        unix::{ffi::OsStrExt, fs::MetadataExt},
    },
    path::{Path, PathBuf},
};
use zephium_private_fs::PrivateDirectory;

type Identity = (u64, u64);
fn identity(file: &File) -> Result<Identity, Failure> {
    let metadata = file.metadata().map_err(|_| Failure::Changed)?;
    if !metadata.is_file() || !single_link(file).map_err(|_| Failure::Changed)? {
        return Err(Failure::Changed);
    }
    Ok((metadata.dev(), metadata.ino()))
}
fn bytes(file: &File) -> Result<Vec<u8>, Failure> {
    let mut file = file.try_clone().map_err(|_| Failure::Changed)?;
    file.seek(SeekFrom::Start(0))
        .map_err(|_| Failure::Changed)?;
    let mut bytes = Vec::new();
    file.take(MAX_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| Failure::Changed)?;
    if bytes.len() > MAX_BYTES {
        return Err(Failure::Input);
    }
    Ok(bytes)
}
fn open_at(directory: &File, name: &CString) -> Result<File, Failure> {
    let descriptor = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC,
        )
    };
    if descriptor < 0 {
        return Err(Failure::Changed);
    }
    Ok(unsafe { File::from_raw_fd(descriptor) })
}
pub(super) struct Prepared {
    file: File,
    parent: File,
    name: CString,
    path: PathBuf,
    identity: Identity,
    pub text: String,
    pub digest: String,
}
impl Prepared {
    pub fn new(path: PathBuf, known: &str) -> Result<Self, Failure> {
        let file = open_unix(&path, false).map_err(Failure::File)?;
        let original_identity = identity(&file)?;
        let content = bytes(&file)?;
        let digest = digest(&content);
        if digest != known {
            return Err(Failure::Changed);
        }
        let text = String::from_utf8(content).map_err(|_| Failure::Input)?;
        if crate::work_files::binary_looking(&text) {
            return Err(Failure::Input);
        }
        let parent =
            open_unix(path.parent().ok_or(Failure::Input)?, true).map_err(Failure::File)?;
        let name = CString::new(path.file_name().ok_or(Failure::Input)?.as_bytes())
            .map_err(|_| Failure::Input)?;
        if identity(&open_at(&parent, &name)?)? != original_identity {
            return Err(Failure::Changed);
        }
        Ok(Self {
            file,
            parent,
            name,
            path,
            identity: original_identity,
            text,
            digest,
        })
    }
    pub fn apply(
        &self,
        stage: &PrivateDirectory,
        record: &Record,
        cancelled: &std::sync::atomic::AtomicBool,
    ) -> Result<PathBuf, Failure> {
        stage
            .with_verified_path(|directory| self.apply_at(directory, record, cancelled))
            .map_err(|_| Failure::RecoveryPending)?
    }
    fn apply_at(
        &self,
        directory: &Path,
        _record: &Record,
        cancelled: &std::sync::atomic::AtomicBool,
    ) -> Result<PathBuf, Failure> {
        self.apply_at_with(directory, cancelled, native_trash)
    }
    fn apply_at_with(
        &self,
        directory: &Path,
        cancelled: &std::sync::atomic::AtomicBool,
        native: impl FnOnce(&Path, Identity) -> Result<PathBuf, Failure>,
    ) -> Result<PathBuf, Failure> {
        let stage = open_unix(directory, true).map_err(Failure::File)?;
        let target = directory.join(self.path.file_name().ok_or(Failure::Input)?);
        let parent_now = open_unix(self.path.parent().ok_or(Failure::Input)?, true)
            .map_err(|_| Failure::Changed)?;
        let parent_identity = |file: &File| {
            file.metadata()
                .map(|m| (m.dev(), m.ino()))
                .map_err(|_| Failure::Changed)
        };
        if parent_identity(&parent_now)? != parent_identity(&self.parent)?
            || identity(&open_at(&self.parent, &self.name)?)? != self.identity
            || identity(&self.file)? != self.identity
            || digest(&bytes(&self.file)?) != self.digest
        {
            return Err(Failure::Changed);
        }
        if stage.metadata().map_err(|_| Failure::Storage)?.dev() != self.identity.0 {
            return Err(Failure::CrossVolume);
        }
        if cancelled.load(std::sync::atomic::Ordering::Acquire) {
            return Err(Failure::Stopped);
        }
        let moved = unsafe {
            libc::renameatx_np(
                self.parent.as_raw_fd(),
                self.name.as_ptr(),
                stage.as_raw_fd(),
                self.name.as_ptr(),
                libc::RENAME_EXCL,
            )
        };
        if moved != 0 {
            return Err(Failure::Changed);
        }
        // Raced source substitutions are never passed to Trash. Restore the
        // staged entry without overwriting; a conflict retains it for recovery.
        let valid = open_at(&stage, &self.name).and_then(|file| {
            if identity(&file)? == self.identity && digest(&bytes(&file)?) == self.digest {
                Ok(())
            } else {
                Err(Failure::Changed)
            }
        });
        if valid.is_err() {
            unsafe {
                libc::renameatx_np(
                    stage.as_raw_fd(),
                    self.name.as_ptr(),
                    self.parent.as_raw_fd(),
                    self.name.as_ptr(),
                    libc::RENAME_EXCL,
                );
            }
            let _ = self.parent.sync_all();
            let _ = stage.sync_all();
            return Err(Failure::RecoveryPending);
        }
        self.parent
            .sync_all()
            .and_then(|_| stage.sync_all())
            .map_err(|_| Failure::RecoveryPending)?;
        if cancelled.load(std::sync::atomic::Ordering::Acquire) {
            return Err(Failure::RecoveryPending);
        }
        let trashed = native(&target, self.identity)?;
        stage.sync_all().map_err(|_| Failure::RecoveryPending)?;
        Ok(trashed)
    }
}
fn native_trash(path: &Path, expected: Identity) -> Result<PathBuf, Failure> {
    objc2::rc::autoreleasepool(|_| {
        let path_text = path.to_str().ok_or(Failure::RecoveryPending)?;
        let url = NSURL::fileURLWithPath_isDirectory(&NSString::from_str(path_text), false);
        let mut result = None;
        NSFileManager::defaultManager()
            .trashItemAtURL_resultingItemURL_error(&url, Some(&mut result))
            .map_err(|_| Failure::RecoveryPending)?;
        let returned = result
            .and_then(|url| url.path())
            .ok_or(Failure::RecoveryPending)?
            .to_string();
        // Only metadata for the exact URL returned by this native request is read.
        // No Trash inventory or persisted external-path read authority is created.
        let metadata =
            std::fs::symlink_metadata(&returned).map_err(|_| Failure::RecoveryPending)?;
        if !metadata.is_file()
            || metadata.nlink() != 1
            || (metadata.dev(), metadata.ino()) != expected
            || path.try_exists().map_err(|_| Failure::RecoveryPending)?
        {
            return Err(Failure::RecoveryPending);
        }
        Ok(PathBuf::from(returned))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn uncertain_native_result_retains_staged_original_and_durable_saved_copy() {
        let scratch = tempfile::Builder::new()
            .prefix("work-trash-interrupt-")
            .tempdir_in("/private/tmp")
            .unwrap();
        let root = scratch.path().canonicalize().unwrap();
        let source = root.join("note.txt");
        std::fs::write(&source, "saved text").unwrap();
        let prepared = Prepared::new(source.clone(), &digest(b"saved text")).unwrap();
        let journal = super::super::journal::Journal::open(&root, "profile", true)
            .unwrap()
            .unwrap();
        let receipt = super::super::journal::Receipt {
            version: 1,
            id: super::super::recovery_id(),
            path: source.clone(),
            digest: prepared.digest.clone(),
            bytes: prepared.text.len(),
            step: "fixture".into(),
            destination: None,
        };
        let record = journal.prepare(receipt, prepared.text.as_bytes()).unwrap();
        let stage = record.stage().unwrap();
        let result = stage
            .with_verified_path(|directory| {
                prepared.apply_at_with(
                    directory,
                    &std::sync::atomic::AtomicBool::new(false),
                    |_, _| Err(Failure::RecoveryPending),
                )
            })
            .unwrap();
        assert_eq!(result.unwrap_err(), Failure::RecoveryPending);
        assert!(!source.exists());
        stage
            .with_verified_path(|directory| {
                assert_eq!(
                    std::fs::read_to_string(directory.join("note.txt")).unwrap(),
                    "saved text"
                )
            })
            .unwrap();
        assert_eq!(record.saved().unwrap(), "saved text");
        assert!(!record.marked("trashed").unwrap());
        drop(stage);
        drop(record);
        drop(journal);
        let journal = super::super::journal::Journal::open(&root, "profile", false)
            .unwrap()
            .unwrap();
        let record = journal.records().unwrap().pop().unwrap();
        assert_eq!(record.saved().unwrap(), "saved text");
        assert!(!record.marked("trashed").unwrap());
        assert!(
            !source.exists(),
            "reopening never replays or restores an interrupted operation"
        );
    }
}

#[cfg(test)]
mod held_ack_tests {
    use super::*;
    use std::{
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        },
        time::Duration,
    };
    #[tokio::test]
    async fn pending_ack_retains_exact_stage_and_late_ack_marks_original_receipt() {
        let scratch = tempfile::Builder::new()
            .prefix("work-trash-held-")
            .tempdir_in("/private/tmp")
            .unwrap();
        let root = scratch.path().canonicalize().unwrap();
        let source = root.join("note.txt");
        std::fs::write(&source, "inert held native file").unwrap();
        let id = super::super::recovery_id();
        let flag = Arc::new(AtomicBool::new(false));
        let worker_flag = flag.clone();
        let active = Arc::new(AtomicBool::new(false));
        let entered = active.clone();
        let release = Arc::new(AtomicBool::new(false));
        let proceed = release.clone();
        let finished = Arc::new(AtomicBool::new(false));
        let done = finished.clone();
        let worker_root = root.clone();
        let worker_id = id.clone();
        let worker_source = source.clone();
        let worker = super::super::wait::launch(move || {
            let prepared =
                Prepared::new(worker_source.clone(), &digest(b"inert held native file"))?;
            let journal = super::super::journal::Journal::open(&worker_root, "held-native", true)?
                .ok_or(Failure::Storage)?;
            let record = journal.prepare(
                super::super::journal::Receipt {
                    version: 1,
                    id: worker_id,
                    path: worker_source,
                    digest: prepared.digest.clone(),
                    bytes: prepared.text.len(),
                    step: "exact-original-step".into(),
                    destination: None,
                },
                prepared.text.as_bytes(),
            )?;
            let stage = record.stage()?;
            stage
                .with_verified_path(|directory| {
                    prepared.apply_at_with(directory, &worker_flag, |path, expected| {
                        entered.store(true, Ordering::Release);
                        let until = std::time::Instant::now() + Duration::from_secs(3);
                        while !proceed.load(Ordering::Acquire) && std::time::Instant::now() < until
                        {
                            std::thread::sleep(Duration::from_millis(2));
                        }
                        if !proceed.load(Ordering::Acquire) {
                            return Err(Failure::RecoveryPending);
                        }
                        let target = worker_root.join("inert-native-ack");
                        std::fs::rename(path, &target).map_err(|_| Failure::RecoveryPending)?;
                        assert_eq!(
                            identity(&open_unix(&target, false).unwrap()).unwrap(),
                            expected
                        );
                        Ok(target)
                    })
                })
                .map_err(|_| Failure::RecoveryPending)??;
            record.mark("trashed")?;
            drop(stage);
            drop(record);
            drop(journal);
            done.store(true, Ordering::Release);
            Ok(())
        })
        .unwrap();
        let result = super::super::wait::observe_with_limits(
            worker,
            flag,
            || async { active.load(Ordering::Acquire) },
            Duration::from_secs(2),
            Duration::from_millis(20),
        )
        .await;
        assert_eq!(result, Err(Failure::RecoveryPending));
        assert_eq!(
            result.unwrap_err().step_status(),
            zephium_core::work::runtime::WorkStepStatus::OutcomeUnknown
        );
        assert!(!source.exists());
        let record_root = root
            .join(".zephium-work-recovery")
            .join(digest(b"held-native"))
            .join(&id);
        assert_eq!(
            std::fs::read(record_root.join("stage/note.txt")).unwrap(),
            b"inert held native file"
        );
        assert_eq!(
            std::fs::read(record_root.join("saved")).unwrap(),
            b"inert held native file"
        );
        assert!(!record_root.join("trashed").exists());
        release.store(true, Ordering::Release);
        tokio::time::timeout(Duration::from_secs(2), async {
            while !finished.load(Ordering::Acquire) {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .unwrap();
        let journal = super::super::journal::Journal::open(&root, "held-native", false)
            .unwrap()
            .unwrap();
        let rows = journal.records().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].receipt.id, id);
        assert_eq!(rows[0].receipt.step, "exact-original-step");
        assert!(rows[0].marked("trashed").unwrap());
        assert_eq!(rows[0].saved().unwrap(), "inert held native file");
        assert!(
            !source.exists(),
            "late acknowledgement must not reopen or replay the original source"
        );
    }
    #[test]
    fn prestage_stop_never_dispatches_or_moves_original() {
        let scratch = tempfile::Builder::new()
            .prefix("work-trash-prestop-")
            .tempdir_in("/private/tmp")
            .unwrap();
        let root = scratch.path().canonicalize().unwrap();
        let source = root.join("note.txt");
        std::fs::write(&source, "inert prestage").unwrap();
        let prepared = Prepared::new(source.clone(), &digest(b"inert prestage")).unwrap();
        let stage = root.join("stage");
        std::fs::create_dir(&stage).unwrap();
        let result = prepared.apply_at_with(&stage, &AtomicBool::new(true), |_, _| {
            panic!("native call must not start")
        });
        assert_eq!(result, Err(Failure::Stopped));
        assert_eq!(std::fs::read(&source).unwrap(), b"inert prestage");
        assert!(!stage.join("note.txt").exists());
    }
}
