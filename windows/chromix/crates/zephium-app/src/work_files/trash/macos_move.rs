//! Handle-relative publication; the original inode and its metadata survive.
use super::*;
use std::sync::atomic::{AtomicBool, Ordering};
pub(crate) struct Destination {
    path: PathBuf,
    parent: File,
    name: CString,
    identity: Identity,
}
fn directory_identity(file: &File) -> Result<Identity, Failure> {
    let metadata = file.metadata().map_err(|_| Failure::Destination)?;
    if !metadata.is_dir() {
        return Err(Failure::Destination);
    }
    Ok((metadata.dev(), metadata.ino()))
}
impl Destination {
    pub fn new(path: PathBuf) -> Result<Self, Failure> {
        let parent =
            open_unix(path.parent().ok_or(Failure::Input)?, true).map_err(Failure::File)?;
        let identity = directory_identity(&parent)?;
        let name = CString::new(path.file_name().ok_or(Failure::Input)?.as_bytes())
            .map_err(|_| Failure::Input)?;
        let value = Self {
            path,
            parent,
            name,
            identity,
        };
        value.check()?;
        Ok(value)
    }
    pub fn check(&self) -> Result<(), Failure> {
        let now = open_unix(self.path.parent().ok_or(Failure::Input)?, true)
            .map_err(|_| Failure::Destination)?;
        if directory_identity(&now)? != self.identity
            || directory_identity(&self.parent)? != self.identity
        {
            return Err(Failure::Destination);
        }
        let mut metadata = std::mem::MaybeUninit::<libc::stat>::uninit();
        let result = unsafe {
            libc::fstatat(
                self.parent.as_raw_fd(),
                self.name.as_ptr(),
                metadata.as_mut_ptr(),
                libc::AT_SYMLINK_NOFOLLOW,
            )
        };
        if result == 0 || std::io::Error::last_os_error().raw_os_error() != Some(libc::ENOENT) {
            return Err(Failure::Destination);
        }
        Ok(())
    }
}
impl Prepared {
    pub fn move_to(
        &self,
        stage: &PrivateDirectory,
        record: &Record,
        destination: &Destination,
        cancelled: &AtomicBool,
    ) -> Result<PathBuf, Failure> {
        self.move_to_with(stage, record, destination, cancelled, native_trash)
    }
    fn move_to_with(
        &self,
        stage: &PrivateDirectory,
        record: &Record,
        destination: &Destination,
        cancelled: &AtomicBool,
        recycle: impl FnOnce(&Path, Identity) -> Result<PathBuf, Failure>,
    ) -> Result<PathBuf, Failure> {
        destination.check()?;
        if destination.identity.0 != self.identity.0 {
            return Err(Failure::CrossVolume);
        }
        // Finish each verified-path callback before entering the shared journal
        // lease again. Nested mutations are deliberately rejected by private-fs.
        stage
            .with_verified_path(|directory| {
                self.apply_at_with(directory, cancelled, |source, _| Ok(source.to_path_buf()))
            })
            .map_err(|_| Failure::RecoveryPending)??;
        let backup = record.backup().map_err(|_| Failure::RecoveryPending)?;
        let acknowledged = backup
            .with_verified_path(|directory| {
                let path = directory.join("recovery.txt");
                let file = open_unix(&path, false).map_err(Failure::File)?;
                if digest(&bytes(&file)?) != self.digest {
                    return Err(Failure::RecoveryPending);
                }
                if cancelled.load(Ordering::Acquire) {
                    return Err(Failure::RecoveryPending);
                }
                recycle(&path, identity(&file)?)
            })
            .map_err(|_| Failure::RecoveryPending)??;
        record
            .mark("move_backup_trashed")
            .map_err(|_| Failure::RecoveryPending)?;
        if cancelled.load(Ordering::Acquire) {
            return Err(Failure::RecoveryPending);
        }
        destination.check().map_err(|_| Failure::RecoveryPending)?;
        stage
            .with_verified_path(|directory| {
                let stage = open_unix(directory, true).map_err(|_| Failure::RecoveryPending)?;
                let file = open_at(&stage, &self.name)?;
                if identity(&file)? != self.identity || digest(&bytes(&file)?) != self.digest {
                    return Err(Failure::RecoveryPending);
                }
                if cancelled.load(Ordering::Acquire) {
                    return Err(Failure::RecoveryPending);
                }
                if unsafe {
                    libc::renameatx_np(
                        stage.as_raw_fd(),
                        self.name.as_ptr(),
                        destination.parent.as_raw_fd(),
                        destination.name.as_ptr(),
                        libc::RENAME_EXCL,
                    )
                } != 0
                {
                    return Err(Failure::RecoveryPending);
                }
                stage
                    .sync_all()
                    .and_then(|_| destination.parent.sync_all())
                    .map_err(|_| Failure::RecoveryPending)?;
                let published = open_at(&destination.parent, &destination.name)?;
                if identity(&published)? != self.identity
                    || digest(&bytes(&published)?) != self.digest
                {
                    return Err(Failure::RecoveryPending);
                }
                Ok(())
            })
            .map_err(|_| Failure::RecoveryPending)??;
        Ok(acknowledged)
    }
}
#[cfg(test)]
mod tests {
    use super::super::super::{journal, recovery_id};
    use super::*;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;

    struct Fixture {
        _root: tempfile::TempDir,
        root: PathBuf,
        source: PathBuf,
        target: PathBuf,
    }
    impl Fixture {
        fn new() -> Self {
            let directory = tempfile::Builder::new()
                .prefix("work-move-native-")
                .tempdir_in("/private/tmp")
                .unwrap();
            let root = directory.path().canonicalize().unwrap();
            fs::create_dir(root.join("destination")).unwrap();
            let source = root.join("note.txt");
            let target = root.join("destination/moved.txt");
            fs::write(&source, "inert move fixture").unwrap();
            fs::set_permissions(&source, fs::Permissions::from_mode(0o640)).unwrap();
            Self {
                _root: directory,
                root,
                source,
                target,
            }
        }
        fn prepared(&self) -> (Prepared, Destination, journal::Journal, Record) {
            let prepared =
                Prepared::new(self.source.clone(), &digest(b"inert move fixture")).unwrap();
            let destination = Destination::new(self.target.clone()).unwrap();
            let journal = journal::Journal::open(&self.root, "move-fixture", true)
                .unwrap()
                .unwrap();
            let record = journal
                .prepare(
                    journal::Receipt {
                        version: 1,
                        id: recovery_id(),
                        path: self.source.clone(),
                        destination: Some(self.target.clone()),
                        digest: prepared.digest.clone(),
                        bytes: prepared.text.len(),
                        step: "inert".into(),
                    },
                    prepared.text.as_bytes(),
                )
                .unwrap();
            (prepared, destination, journal, record)
        }
    }
    #[test]
    #[ignore = "Native recovery qualification: moves inert scratch files and cleans only exact acknowledged Trash backups"]
    fn native_move_preserves_original_identity_mode_and_exact_backup_ack() {
        let f = Fixture::new();
        let (prepared, destination, journal, record) = f.prepared();
        let original = prepared.identity;
        let stage = record.stage().unwrap();
        let mut acknowledged = None;
        prepared
            .move_to_with(
                &stage,
                &record,
                &destination,
                &AtomicBool::new(false),
                |path, expected| {
                    assert_ne!(
                        expected, original,
                        "Trash must receive a separate backup inode"
                    );
                    let result = native_trash(path, expected)?;
                    acknowledged = Some(result.clone());
                    Ok(result)
                },
            )
            .unwrap();
        record.mark("moved").unwrap();
        assert!(!f.source.exists());
        let moved = open_unix(&f.target, false).unwrap();
        assert_eq!(identity(&moved).unwrap(), original);
        assert_eq!(
            moved.metadata().unwrap().permissions().mode() & 0o777,
            0o640
        );
        assert_eq!(fs::read_to_string(&f.target).unwrap(), "inert move fixture");
        drop(record);
        drop(stage);
        drop(journal);
        let journal = journal::Journal::open(&f.root, "move-fixture", false)
            .unwrap()
            .unwrap();
        let record = journal.records().unwrap().pop().unwrap();
        assert!(record.marked("move_backup_trashed").unwrap());
        assert!(record.marked("moved").unwrap());
        assert_eq!(record.saved().unwrap(), "inert move fixture");
        // Only remove the exact inert backup URL acknowledged by this call.
        fs::remove_file(acknowledged.unwrap()).unwrap();
    }
    #[test]
    fn move_refuses_parent_replacement_and_destination_collision_before_staging() {
        for replace_parent in [false, true] {
            let f = Fixture::new();
            let (prepared, destination, _journal, record) = f.prepared();
            if replace_parent {
                fs::rename(f.target.parent().unwrap(), f.root.join("retired")).unwrap();
                fs::create_dir(f.target.parent().unwrap()).unwrap();
            } else {
                fs::write(&f.target, "keep existing").unwrap();
            }
            let stage = record.stage().unwrap();
            assert_eq!(
                prepared.move_to_with(
                    &stage,
                    &record,
                    &destination,
                    &AtomicBool::new(false),
                    |_, _| panic!("native Trash must not run")
                ),
                Err(Failure::Destination)
            );
            assert_eq!(fs::read_to_string(&f.source).unwrap(), "inert move fixture");
        }
    }
    #[test]
    fn interrupted_move_never_overwrites_or_replays_after_backup_ack() {
        for cancel in [false, true] {
            let f = Fixture::new();
            let (prepared, destination, journal, record) = f.prepared();
            let original = prepared.identity;
            let stage = record.stage().unwrap();
            let stopped = AtomicBool::new(false);
            let result =
                prepared.move_to_with(&stage, &record, &destination, &stopped, |path, _| {
                    // Inert injected native acknowledgment; no OS Trash needed here.
                    fs::remove_file(path).unwrap();
                    if cancel {
                        stopped.store(true, Ordering::Release);
                    } else {
                        fs::write(&f.target, "concurrent destination").unwrap();
                    }
                    Ok(f.root.join("inert-native-ack"))
                });
            assert_eq!(result, Err(Failure::RecoveryPending));
            assert!(!f.source.exists());
            stage
                .with_verified_path(|path| {
                    assert_eq!(
                        identity(&open_unix(&path.join("note.txt"), false).unwrap()).unwrap(),
                        original
                    );
                })
                .unwrap();
            assert!(!record.marked("moved").unwrap());
            drop(record);
            drop(stage);
            drop(journal);
            let journal = journal::Journal::open(&f.root, "move-fixture", false)
                .unwrap()
                .unwrap();
            let record = journal.records().unwrap().pop().unwrap();
            assert_eq!(record.saved().unwrap(), "inert move fixture");
            assert!(record.marked("move_backup_trashed").unwrap());
            assert!(!record.marked("moved").unwrap());
            if cancel {
                assert!(!f.target.exists());
            } else {
                assert_eq!(
                    fs::read_to_string(&f.target).unwrap(),
                    "concurrent destination"
                );
            }
            assert!(
                !f.source.exists(),
                "reopening journal must never replay a move"
            );
        }
    }
    #[tokio::test]
    async fn held_move_backup_ack_never_publishes_after_pending_stop() {
        use std::{
            sync::Arc,
            time::{Duration, Instant},
        };
        let f = Fixture::new();
        let id = recovery_id();
        let flag = Arc::new(AtomicBool::new(false));
        let worker_flag = flag.clone();
        let active = Arc::new(AtomicBool::new(false));
        let entered = active.clone();
        let release = Arc::new(AtomicBool::new(false));
        let proceed = release.clone();
        let finished = Arc::new(AtomicBool::new(false));
        let done = finished.clone();
        let root = f.root.clone();
        let source = f.source.clone();
        let target = f.target.clone();
        let worker_id = id.clone();
        let worker = super::super::super::wait::launch(move || {
            let prepared = Prepared::new(source.clone(), &digest(b"inert move fixture"))?;
            let destination = Destination::new(target.clone())?;
            let journal =
                journal::Journal::open(&root, "move-held", true)?.ok_or(Failure::Storage)?;
            let record = journal.prepare(
                journal::Receipt {
                    version: 1,
                    id: worker_id,
                    path: source,
                    destination: Some(target),
                    digest: prepared.digest.clone(),
                    bytes: prepared.text.len(),
                    step: "exact-move-step".into(),
                },
                prepared.text.as_bytes(),
            )?;
            let stage = record.stage()?;
            let result = prepared
                .move_to_with(
                    &stage,
                    &record,
                    &destination,
                    &worker_flag,
                    |path, expected| {
                        entered.store(true, Ordering::Release);
                        let deadline = Instant::now() + Duration::from_secs(3);
                        while !proceed.load(Ordering::Acquire) && Instant::now() < deadline {
                            std::thread::sleep(Duration::from_millis(2));
                        }
                        if !proceed.load(Ordering::Acquire) {
                            return Err(Failure::RecoveryPending);
                        }
                        let acknowledged = root.join("inert-backup-ack");
                        fs::rename(path, &acknowledged).map_err(|_| Failure::RecoveryPending)?;
                        assert_eq!(
                            identity(&open_unix(&acknowledged, false).unwrap()).unwrap(),
                            expected
                        );
                        Ok(acknowledged)
                    },
                )
                .map(|_| ());
            if result.is_ok() {
                record.mark("moved")?;
            }
            drop(stage);
            drop(record);
            drop(journal);
            done.store(true, Ordering::Release);
            result
        })
        .unwrap();
        let result = super::super::super::wait::observe_with_limits(
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
        assert!(!f.source.exists());
        assert!(!f.target.exists());
        let record_root = f
            .root
            .join(".zephium-work-recovery")
            .join(digest(b"move-held"))
            .join(&id);
        assert_eq!(
            fs::read(record_root.join("stage/note.txt")).unwrap(),
            b"inert move fixture"
        );
        release.store(true, Ordering::Release);
        tokio::time::timeout(Duration::from_secs(2), async {
            while !finished.load(Ordering::Acquire) {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .unwrap();
        let journal = journal::Journal::open(&f.root, "move-held", false)
            .unwrap()
            .unwrap();
        let rows = journal.records().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].receipt.id, id);
        assert_eq!(rows[0].receipt.step, "exact-move-step");
        assert!(rows[0].marked("move_backup_trashed").unwrap());
        assert!(!rows[0].marked("moved").unwrap());
        assert!(!f.target.exists());
        assert_eq!(
            fs::read(record_root.join("stage/note.txt")).unwrap(),
            b"inert move fixture"
        );
    }
    #[test]
    fn uncertain_backup_result_retains_original_without_publishing_destination() {
        let f = Fixture::new();
        let (prepared, destination, _journal, record) = f.prepared();
        let stage = record.stage().unwrap();
        assert_eq!(
            prepared.move_to_with(
                &stage,
                &record,
                &destination,
                &AtomicBool::new(false),
                |_, _| Err(Failure::RecoveryPending)
            ),
            Err(Failure::RecoveryPending)
        );
        assert!(!f.target.exists());
        assert!(!record.marked("move_backup_trashed").unwrap());
        assert!(!record.marked("moved").unwrap());
        assert_eq!(record.saved().unwrap(), "inert move fixture");
    }
}
