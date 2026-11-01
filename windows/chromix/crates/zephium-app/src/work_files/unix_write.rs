//! Approved writes use the directory we opened, never a pathname reopened after
//! validation. A replaced parent cannot redirect creation, publication or cleanup.
use super::{open_unix, protected_path, single_link, WorkFileError, MAX_READ_BYTES};
use sha2::{Digest, Sha256};
use std::{
    ffi::{CStr, CString},
    fs::{File, Metadata},
    io::{Read, Write},
    os::{
        fd::{AsRawFd, FromRawFd},
        unix::{ffi::OsStrExt, fs::MetadataExt},
    },
    path::{Path, PathBuf},
};
use zephium_core::work::WorkArtifactId;

type Identity = (u64, u64);
fn identity(metadata: &Metadata) -> Identity {
    (metadata.dev(), metadata.ino())
}

fn open_at(directory: &File, name: &CStr) -> Result<Option<File>, WorkFileError> {
    let fd = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDONLY | libc::O_CLOEXEC | libc::O_NOFOLLOW | libc::O_NONBLOCK,
        )
    };
    if fd >= 0 {
        return Ok(Some(unsafe { File::from_raw_fd(fd) }));
    }
    if std::io::Error::last_os_error().kind() == std::io::ErrorKind::NotFound {
        Ok(None)
    } else {
        Err(WorkFileError::Denied)
    }
}

struct Original {
    _file: File,
    metadata: Metadata,
    digest: String,
}
fn read_at(directory: &File, name: &CStr) -> Result<Option<Original>, WorkFileError> {
    let Some(mut file) = open_at(directory, name)? else {
        return Ok(None);
    };
    let metadata = file.metadata().map_err(|_| WorkFileError::Io)?;
    if !metadata.is_file() {
        return Err(WorkFileError::NotAFile);
    }
    if !single_link(&file)? {
        return Err(WorkFileError::Denied);
    }
    if metadata.len() > MAX_READ_BYTES {
        return Err(WorkFileError::TooLarge);
    }
    let mut bytes = Vec::new();
    Read::by_ref(&mut file)
        .take(MAX_READ_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| WorkFileError::Io)?;
    if bytes.len() as u64 > MAX_READ_BYTES {
        return Err(WorkFileError::TooLarge);
    }
    Ok(Some(Original {
        _file: file,
        metadata,
        digest: format!("{:x}", Sha256::digest(bytes)),
    }))
}

struct PendingWrite {
    directory: File,
    directory_path: PathBuf,
    destination: CString,
    temporary: CString,
    output: File,
    original: Option<Original>,
    expected: Option<String>,
    published: bool,
}
impl PendingWrite {
    fn stage(path: &Path, bytes: &[u8], expected: Option<&str>) -> Result<Self, WorkFileError> {
        if protected_path(path) {
            return Err(WorkFileError::Denied);
        }
        if bytes.len() as u64 > MAX_READ_BYTES {
            return Err(WorkFileError::TooLarge);
        }
        let directory_path = path.parent().ok_or(WorkFileError::Denied)?.to_owned();
        let destination = CString::new(path.file_name().ok_or(WorkFileError::Denied)?.as_bytes())
            .map_err(|_| WorkFileError::Denied)?;
        let directory = open_unix(&directory_path, true)?;
        let original = read_at(&directory, &destination)?;
        if original.as_ref().map(|file| file.digest.as_str()) != expected {
            return Err(WorkFileError::Changed);
        }
        let temporary = CString::new(format!(".zephium-{}", WorkArtifactId::generate()))
            .map_err(|_| WorkFileError::Denied)?;
        let fd = unsafe {
            libc::openat(
                directory.as_raw_fd(),
                temporary.as_ptr(),
                libc::O_RDWR
                    | libc::O_CREAT
                    | libc::O_EXCL
                    | libc::O_CLOEXEC
                    | libc::O_NOFOLLOW
                    | libc::O_NONBLOCK,
                0o600,
            )
        };
        if fd < 0 {
            return Err(WorkFileError::Io);
        }
        let mut pending = Self {
            directory,
            directory_path,
            destination,
            temporary,
            output: unsafe { File::from_raw_fd(fd) },
            original,
            expected: expected.map(str::to_owned),
            published: false,
        };
        if let Some(original) = &pending.original {
            pending
                .output
                .set_permissions(original.metadata.permissions())
                .map_err(|_| WorkFileError::Io)?;
        }
        pending
            .output
            .write_all(bytes)
            .map_err(|_| WorkFileError::Io)?;
        pending.output.sync_all().map_err(|_| WorkFileError::Io)?;
        Ok(pending)
    }

    fn temporary_is_ours(&self) -> bool {
        let Ok(Some(file)) = open_at(&self.directory, &self.temporary) else {
            return false;
        };
        file.metadata()
            .ok()
            .zip(self.output.metadata().ok())
            .is_some_and(|(named, opened)| named.is_file() && identity(&named) == identity(&opened))
    }

    fn publish(mut self) -> Result<(), WorkFileError> {
        // A pathname change is a stale approval, even though descriptor-relative
        // operations would still refer to the originally opened directory.
        let current = open_unix(&self.directory_path, true).map_err(|_| WorkFileError::Changed)?;
        if identity(&current.metadata().map_err(|_| WorkFileError::Io)?)
            != identity(&self.directory.metadata().map_err(|_| WorkFileError::Io)?)
        {
            return Err(WorkFileError::Changed);
        }
        if !self.temporary_is_ours() || !single_link(&self.output)? {
            return Err(WorkFileError::Changed);
        }
        let current = read_at(&self.directory, &self.destination)?;
        if current.as_ref().map(|file| file.digest.as_str()) != self.expected.as_deref()
            || current
                .as_ref()
                .map(|file| (identity(&file.metadata), file.metadata.mode()))
                != self
                    .original
                    .as_ref()
                    .map(|file| (identity(&file.metadata), file.metadata.mode()))
        {
            return Err(WorkFileError::Changed);
        }
        let directory = self.directory.as_raw_fd();
        let renamed = if self.expected.is_some() {
            unsafe {
                libc::renameat(
                    directory,
                    self.temporary.as_ptr(),
                    directory,
                    self.destination.as_ptr(),
                )
            }
        } else {
            #[cfg(target_os = "macos")]
            {
                unsafe {
                    libc::renameatx_np(
                        directory,
                        self.temporary.as_ptr(),
                        directory,
                        self.destination.as_ptr(),
                        libc::RENAME_EXCL,
                    )
                }
            }
            #[cfg(target_os = "linux")]
            {
                unsafe {
                    libc::renameat2(
                        directory,
                        self.temporary.as_ptr(),
                        directory,
                        self.destination.as_ptr(),
                        libc::RENAME_NOREPLACE,
                    )
                }
            }
            #[cfg(not(any(target_os = "macos", target_os = "linux")))]
            {
                return Err(WorkFileError::Unavailable);
            }
        };
        if renamed != 0 {
            return Err(
                if std::io::Error::last_os_error().kind() == std::io::ErrorKind::AlreadyExists {
                    WorkFileError::Changed
                } else {
                    WorkFileError::Io
                },
            );
        }
        self.published = true;
        Ok(())
    }
}
impl Drop for PendingWrite {
    fn drop(&mut self) {
        if !self.published && self.temporary_is_ours() {
            // Cleanup is tied to the held directory and our own inode. It never
            // follows the caller's path or removes a substituted temporary file.
            unsafe {
                libc::unlinkat(self.directory.as_raw_fd(), self.temporary.as_ptr(), 0);
            }
        }
    }
}

pub(super) fn write_atomic(
    path: &Path,
    bytes: &[u8],
    expected: Option<&str>,
) -> Result<(), WorkFileError> {
    PendingWrite::stage(path, bytes, expected)?.publish()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;

    #[test]
    fn parent_swap_cannot_redirect_publication_or_cleanup() {
        let scratch = tempfile::tempdir().unwrap();
        let root = scratch.path().canonicalize().unwrap();
        let granted = root.join("granted");
        let outside = root.join("outside");
        std::fs::create_dir(&granted).unwrap();
        std::fs::create_dir(&outside).unwrap();
        std::fs::write(outside.join("note.txt"), "outside sentinel").unwrap();
        let pending = PendingWrite::stage(&granted.join("note.txt"), b"approved", None).unwrap();
        let temporary = pending.temporary.to_str().unwrap().to_owned();
        // The same temporary spelling outside the grant must also survive cleanup.
        std::fs::write(outside.join(&temporary), "outside temporary sentinel").unwrap();
        let moved = root.join("original");
        std::fs::rename(&granted, &moved).unwrap();
        symlink(&outside, &granted).unwrap();
        assert_eq!(pending.publish().unwrap_err(), WorkFileError::Changed);
        assert_eq!(
            std::fs::read_to_string(outside.join("note.txt")).unwrap(),
            "outside sentinel"
        );
        assert_eq!(
            std::fs::read_to_string(outside.join(&temporary)).unwrap(),
            "outside temporary sentinel"
        );
        assert!(!moved.join("note.txt").exists());
        assert!(!moved.join(temporary).exists());
    }

    #[test]
    fn raced_destination_and_substituted_temporary_are_preserved() {
        let scratch = tempfile::tempdir().unwrap();
        let root = scratch.path().canonicalize().unwrap();
        let path = root.join("note.txt");
        let pending = PendingWrite::stage(&path, b"approved", None).unwrap();
        std::fs::write(&path, "other writer").unwrap();
        assert_eq!(pending.publish().unwrap_err(), WorkFileError::Changed);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "other writer");
        std::fs::remove_file(&path).unwrap();
        let pending = PendingWrite::stage(&path, b"approved", None).unwrap();
        let temporary = root.join(pending.temporary.to_str().unwrap());
        std::fs::remove_file(&temporary).unwrap();
        std::fs::write(&temporary, "substituted").unwrap();
        assert_eq!(pending.publish().unwrap_err(), WorkFileError::Changed);
        assert_eq!(std::fs::read_to_string(temporary).unwrap(), "substituted");
        assert!(!path.exists());
    }
}
