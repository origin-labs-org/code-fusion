//! Fixed Git comparison stages; this owner never receives original source paths.
use super::{Failure, GitOperation, Output, ReadOperation, Snapshot};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, future::Future, path::PathBuf};

#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum Read {
    Status,
    Diff,
    Check,
}
impl TryFrom<ReadOperation> for Read {
    type Error = Failure;
    fn try_from(value: ReadOperation) -> Result<Self, Failure> {
        match value {
            ReadOperation::Status => Ok(Self::Status),
            ReadOperation::Diff => Ok(Self::Diff),
            ReadOperation::Check => Ok(Self::Check),
            #[cfg(all(test, target_os = "macos"))]
            ReadOperation::Files => Err(Failure::Input),
        }
    }
}
impl From<Read> for ReadOperation {
    fn from(value: Read) -> Self {
        match value {
            Read::Status => Self::Status,
            Read::Diff => Self::Diff,
            Read::Check => Self::Check,
        }
    }
}
pub(super) struct Prepared {
    pub snapshot: Snapshot,
    after: BTreeMap<PathBuf, Vec<u8>>,
    read: Read,
}
impl Prepared {
    pub fn new(
        before: BTreeMap<PathBuf, Vec<u8>>,
        after: BTreeMap<PathBuf, Vec<u8>>,
        read: Read,
        check: &dyn Fn() -> Result<(), Failure>,
    ) -> Result<Self, Failure> {
        // Validate both trees before creating any scratch. The snapshot repeats
        // validation, including protected names and recognized credentials.
        if before
            .keys()
            .chain(after.keys())
            .collect::<std::collections::BTreeSet<_>>()
            .len()
            > 2_000
        {
            return Err(Failure::Limit);
        }
        Snapshot::validate_git_files(&before, check)?;
        Snapshot::validate_git_files(&after, check)?;
        let snapshot = Snapshot::from_files_checked(before, check)?;
        Ok(Self {
            snapshot,
            after,
            read,
        })
    }
    fn replace_after(&self, check: &dyn Fn() -> Result<(), Failure>) -> Result<(), Failure> {
        let expires = std::time::Instant::now() + std::time::Duration::from_secs(10);
        let write_check = || {
            check()?;
            if std::time::Instant::now() >= expires {
                Err(Failure::Limit)
            } else {
                Ok(())
            }
        };
        // The index already holds the baseline. Remove its working files before
        // exclusive after-tree creation so native case/Unicode aliases cannot
        // overwrite another admitted name silently.
        for path in self.snapshot.files.keys() {
            write_check()?;
            std::fs::remove_file(self.snapshot.work.join(path)).map_err(|_| Failure::Storage)?;
        }
        for (path, bytes) in &self.after {
            write_check()?;
            self.snapshot.write_new(path, bytes)?;
        }
        write_check()
    }
    pub async fn run<C, CF, S>(
        &self,
        check: &dyn Fn() -> Result<(), Failure>,
        cancelled: &C,
        mut spawned: S,
    ) -> Result<Output, Failure>
    where
        C: Fn() -> CF,
        CF: Future<Output = bool>,
        S: FnMut(u8, u32, Option<u64>),
    {
        for (ordinal, operation) in [
            GitOperation::Initialize,
            GitOperation::CaptureIndex,
            GitOperation::CommitBaseline,
        ]
        .into_iter()
        .enumerate()
        {
            check()?;
            if !super::macos::git_custodied(
                &self.snapshot,
                operation,
                cancelled,
                |pid, instance| spawned(ordinal as u8, pid, instance),
            )
            .await?
            .success
            {
                return Err(Failure::Failed);
            }
        }
        self.replace_after(check)?;
        check()?;
        if !super::macos::git_custodied(
            &self.snapshot,
            GitOperation::IntentToAdd,
            cancelled,
            |pid, instance| spawned(3, pid, instance),
        )
        .await?
        .success
        {
            return Err(Failure::Failed);
        }
        check()?;
        super::macos::git_custodied(
            &self.snapshot,
            GitOperation::Read(self.read.into()),
            cancelled,
            |pid, instance| spawned(4, pid, instance),
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn tree(path: &str, body: &[u8]) -> BTreeMap<PathBuf, Vec<u8>> {
        [(PathBuf::from(path), body.to_vec())].into_iter().collect()
    }
    #[test]
    fn validates_both_trees_and_bounds_their_union_before_staging() {
        for bad in [
            tree("../outside", b"inert"),
            tree(".env", b"inert"),
            tree(".GiT/config", b"inert"),
            tree(".gitattributes", b"* -diff"),
            tree(".GiTattributeſ", b"* -diff"),
        ] {
            assert!(
                Prepared::new(tree("note.txt", b"inert"), bad, Read::Diff, &|| Ok(())).is_err()
            );
        }
        let key = b"-----BEGIN PRIVATE KEY-----\ninert\n";
        assert!(matches!(
            Prepared::new(
                tree("note.txt", key),
                tree("note.txt", b"inert"),
                Read::Diff,
                &|| Ok(())
            ),
            Err(Failure::Sensitive)
        ));
        let before = (0..1001)
            .map(|n| (PathBuf::from(format!("before-{n}.txt")), b"inert".to_vec()))
            .collect();
        let after = (0..1001)
            .map(|n| (PathBuf::from(format!("after-{n}.txt")), b"inert".to_vec()))
            .collect();
        assert!(matches!(
            Prepared::new(before, after, Read::Diff, &|| Ok(())),
            Err(Failure::Limit)
        ));
    }
    #[test]
    fn one_owned_copy_holds_only_validated_baseline_and_closes_explicitly() {
        let prepared = Prepared::new(
            tree("note.txt", b"before"),
            tree("note.txt", b"after"),
            Read::Diff,
            &|| Ok(()),
        )
        .unwrap();
        let root = prepared.snapshot.root.clone();
        assert_eq!(
            std::fs::read(prepared.snapshot.work.join("note.txt")).unwrap(),
            b"before"
        );
        prepared.snapshot.close().unwrap();
        assert!(!root.exists());
    }
    #[test]
    fn after_tree_replacement_is_exclusive_on_the_native_filesystem() {
        let prepared = Prepared::new(
            tree("note.txt", b"before"),
            tree("note.txt", b"after"),
            Read::Diff,
            &|| Ok(()),
        )
        .unwrap();
        prepared.replace_after(&|| Ok(())).unwrap();
        assert_eq!(
            std::fs::read(prepared.snapshot.work.join("note.txt")).unwrap(),
            b"after"
        );
        assert!(matches!(
            prepared
                .snapshot
                .write_new(std::path::Path::new("note.txt"), b"overwrite"),
            Err(Failure::Storage)
        ));
        // If this volume equates alternate case or canonical Unicode spelling,
        // exclusive creation rejects that actual alias too. On a case-sensitive
        // volume distinct names are valid rather than a claimed denial.
        for (original, alias) in [
            ("Case.txt", "case.txt"),
            ("caf\u{e9}.txt", "cafe\u{301}.txt"),
        ] {
            prepared
                .snapshot
                .write_new(std::path::Path::new(original), b"first")
                .unwrap();
            if prepared.snapshot.work.join(alias).exists() {
                assert!(matches!(
                    prepared
                        .snapshot
                        .write_new(std::path::Path::new(alias), b"second"),
                    Err(Failure::Storage)
                ));
                assert_eq!(
                    std::fs::read(prepared.snapshot.work.join(original)).unwrap(),
                    b"first"
                );
            }
        }
        prepared.snapshot.close().unwrap();
    }
}
