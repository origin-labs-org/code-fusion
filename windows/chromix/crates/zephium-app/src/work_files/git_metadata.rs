//! The sole exception to `.git` path protection. The caller can name only fixed
//! Git metadata kinds, rooted in an already granted ordinary repository folder.
use super::{single_link, WorkFileError, WorkFileGrant};
use std::{
    fs::File,
    io::Read,
    path::{Path, PathBuf},
};

type Identity = (u64, u64);
#[derive(Clone, Copy)]
pub(crate) enum GitMetadataPath {
    Index,
    Loose([u8; 20]),
    PackIndex([u8; 20]),
    Pack([u8; 20]),
}
fn hex(id: &[u8; 20]) -> String {
    id.iter().map(|byte| format!("{byte:02x}")).collect()
}
impl GitMetadataPath {
    fn components(self) -> Vec<String> {
        match self {
            Self::Index => vec!["index".into()],
            Self::Loose(id) => {
                let id = hex(&id);
                vec!["objects".into(), id[..2].into(), id[2..].into()]
            }
            Self::PackIndex(id) => vec![
                "objects".into(),
                "pack".into(),
                format!("pack-{}.idx", hex(&id)),
            ],
            Self::Pack(id) => vec![
                "objects".into(),
                "pack".into(),
                format!("pack-{}.pack", hex(&id)),
            ],
        }
    }
}
pub(crate) struct GitMetadata {
    root: PathBuf,
    directory: File,
    root_identity: Identity,
    git_identity: Identity,
    _root: File,
    #[cfg(windows)]
    _guards: Vec<File>,
}
pub(crate) struct GitMetadataBytes {
    pub bytes: Vec<u8>,
    pub identity: Identity,
    _handle: File,
}
impl GitMetadata {
    pub fn open(grant: &WorkFileGrant, root: &Path) -> Result<Self, WorkFileError> {
        if grant.resolve(root.to_str().ok_or(WorkFileError::Denied)?, false)? != root {
            return Err(WorkFileError::Denied);
        }
        #[cfg(unix)]
        let original = super::open_unix(root, true)?;
        #[cfg(windows)]
        let (original, guards) = windows_root(root)?;
        #[cfg(not(any(unix, windows)))]
        return Err(WorkFileError::Unavailable);
        #[cfg(any(unix, windows))]
        {
            let root_identity = identity(&original)?;
            let directory = child(&original, root, ".git", true)?;
            let git_identity = identity(&directory)?;
            Ok(Self {
                root: root.to_owned(),
                directory,
                root_identity,
                git_identity,
                _root: original,
                #[cfg(windows)]
                _guards: guards,
            })
        }
    }
    fn verify(&self) -> Result<(), WorkFileError> {
        #[cfg(unix)]
        let root = super::open_unix(&self.root, true)?;
        #[cfg(windows)]
        let (root, _guards) = windows_root(&self.root)?;
        #[cfg(not(any(unix, windows)))]
        return Err(WorkFileError::Unavailable);
        #[cfg(any(unix, windows))]
        {
            let directory = child(&root, &self.root, ".git", true)?;
            if identity(&root)? != self.root_identity || identity(&directory)? != self.git_identity
            {
                return Err(WorkFileError::Changed);
            }
            Ok(())
        }
    }
    fn open_path(&self, path: GitMetadataPath) -> Result<File, WorkFileError> {
        let parts = path.components();
        let mut directory = self.directory.try_clone().map_err(|_| WorkFileError::Io)?;
        let mut shown = self.root.join(".git");
        for (index, name) in parts.iter().enumerate() {
            directory = child(&directory, &shown, name, index + 1 < parts.len())?;
            shown.push(name);
        }
        Ok(directory)
    }
    pub fn read(
        &self,
        path: GitMetadataPath,
        limit: usize,
    ) -> Result<GitMetadataBytes, WorkFileError> {
        self.read_open(|| self.open_path(path), limit)
    }
    pub fn working(
        &self,
        path: &Path,
        limit: usize,
    ) -> Result<Option<GitMetadataBytes>, WorkFileError> {
        use std::path::Component;
        if path.as_os_str().is_empty()
            || super::protected_path(path)
            || path
                .components()
                .any(|part| !matches!(part, Component::Normal(_)))
            || path.components().count() > 32
        {
            return Err(WorkFileError::Denied);
        }
        let open = || {
            let mut directory = self._root.try_clone().map_err(|_| WorkFileError::Io)?;
            let mut shown = self.root.clone();
            let parts: Vec<_> = path.components().collect();
            for (index, part) in parts.iter().enumerate() {
                let name = part.as_os_str().to_str().ok_or(WorkFileError::Denied)?;
                directory = child(&directory, &shown, name, index + 1 < parts.len())?;
                shown.push(name);
            }
            Ok(directory)
        };
        match self.read_open(open, limit) {
            Ok(file) => Ok(Some(file)),
            Err(WorkFileError::NotFound) => Ok(None),
            Err(error) => Err(error),
        }
    }
    fn read_open(
        &self,
        open: impl Fn() -> Result<File, WorkFileError>,
        limit: usize,
    ) -> Result<GitMetadataBytes, WorkFileError> {
        if limit == 0 || limit > 64 * 1024 * 1024 {
            return Err(WorkFileError::TooLarge);
        }
        self.verify()?;
        let mut file = open()?;
        let metadata = file.metadata().map_err(|_| WorkFileError::Io)?;
        if !metadata.is_file() || !single_link(&file)? {
            return Err(WorkFileError::Denied);
        }
        if metadata.len() > limit as u64 {
            return Err(WorkFileError::TooLarge);
        }
        let original = identity(&file)?;
        let mut bytes = Vec::new();
        file.by_ref()
            .take(limit as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| WorkFileError::Io)?;
        if bytes.len() > limit || bytes.len() as u64 != metadata.len() {
            return Err(WorkFileError::Changed);
        }
        let named = open()?;
        if identity(&named)? != original
            || !single_link(&named)?
            || file.metadata().map_err(|_| WorkFileError::Io)?.len() != metadata.len()
        {
            return Err(WorkFileError::Changed);
        }
        self.verify()?;
        Ok(GitMetadataBytes {
            bytes,
            identity: original,
            _handle: file,
        })
    }
    pub fn pack_ids(&self) -> Result<Vec<[u8; 20]>, WorkFileError> {
        self.verify()?;
        let objects = child(&self.directory, &self.root.join(".git"), "objects", true)?;
        let path = self.root.join(".git/objects");
        let pack = match child(&objects, &path, "pack", true) {
            Ok(file) => file,
            Err(WorkFileError::NotFound) => return Ok(Vec::new()),
            Err(error) => return Err(error),
        };
        let mut ids = Vec::new();
        for name in names(&pack, &path.join("pack"), 128)? {
            let Some(name) = name.to_str() else {
                return Err(WorkFileError::Denied);
            };
            if !name.ends_with(".idx") {
                continue;
            }
            let hash = name
                .strip_prefix("pack-")
                .and_then(|name| name.strip_suffix(".idx"))
                .ok_or(WorkFileError::Denied)?;
            if hash.len() != 40
                || !hash
                    .bytes()
                    .all(|b| b.is_ascii_digit() || matches!(b, b'a'..=b'f'))
            {
                return Err(WorkFileError::Denied);
            }
            let mut id = [0; 20];
            for (i, part) in hash.as_bytes().chunks_exact(2).enumerate() {
                id[i] = u8::from_str_radix(std::str::from_utf8(part).unwrap(), 16)
                    .map_err(|_| WorkFileError::Denied)?;
            }
            ids.push(id);
            if ids.len() > 16 {
                return Err(WorkFileError::TooLarge);
            }
        }
        self.verify()?;
        ids.sort_unstable();
        Ok(ids)
    }
}
fn identity(file: &File) -> Result<Identity, WorkFileError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let metadata = file.metadata().map_err(|_| WorkFileError::Io)?;
        Ok((metadata.dev(), metadata.ino()))
    }
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows::Win32::{
            Foundation::HANDLE,
            Storage::FileSystem::{GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION},
        };
        let mut info = BY_HANDLE_FILE_INFORMATION::default();
        unsafe { GetFileInformationByHandle(HANDLE(file.as_raw_handle()), &mut info) }
            .map_err(|_| WorkFileError::Io)?;
        Ok((
            u64::from(info.dwVolumeSerialNumber),
            (u64::from(info.nFileIndexHigh) << 32) | u64::from(info.nFileIndexLow),
        ))
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = file;
        Err(WorkFileError::Unavailable)
    }
}
fn child(parent: &File, path: &Path, name: &str, directory: bool) -> Result<File, WorkFileError> {
    #[cfg(unix)]
    {
        use std::{
            ffi::CString,
            os::fd::{AsRawFd, FromRawFd},
        };
        let _ = path;
        let name = CString::new(name).map_err(|_| WorkFileError::Denied)?;
        let flags = libc::O_RDONLY
            | libc::O_NOFOLLOW
            | libc::O_CLOEXEC
            | libc::O_NONBLOCK
            | if directory { libc::O_DIRECTORY } else { 0 };
        let fd = unsafe { libc::openat(parent.as_raw_fd(), name.as_ptr(), flags) };
        if fd < 0 {
            return Err(
                if std::io::Error::last_os_error().kind() == std::io::ErrorKind::NotFound {
                    WorkFileError::NotFound
                } else {
                    WorkFileError::Denied
                },
            );
        }
        Ok(unsafe { File::from_raw_fd(fd) })
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
        let _ = parent;
        let path = path.join(name);
        let file = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(1)
            .custom_flags(0x0020_0000 | if directory { 0x0200_0000 } else { 0 })
            .open(&path)
            .map_err(|error| {
                if error.kind() == std::io::ErrorKind::NotFound {
                    WorkFileError::NotFound
                } else {
                    WorkFileError::Denied
                }
            })?;
        let metadata = file.metadata().map_err(|_| WorkFileError::Io)?;
        if metadata.file_attributes() & 0x400 != 0
            || metadata.is_dir() != directory
            || !super::opened_at(&file, &path)
        {
            return Err(WorkFileError::Denied);
        }
        Ok(file)
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = (parent, path, name, directory);
        Err(WorkFileError::Unavailable)
    }
}
#[cfg(windows)]
fn windows_root(path: &Path) -> Result<(File, Vec<File>), WorkFileError> {
    use std::os::windows::fs::MetadataExt;
    let guards = super::pin_directories(path)?;
    if guards.iter().any(|file| {
        file.metadata()
            .map_or(true, |metadata| metadata.file_attributes() & 0x400 != 0)
    }) {
        return Err(WorkFileError::Denied);
    }
    let file = guards
        .last()
        .ok_or(WorkFileError::Denied)?
        .try_clone()
        .map_err(|_| WorkFileError::Io)?;
    if !super::opened_at(&file, path) {
        return Err(WorkFileError::Denied);
    }
    Ok((file, guards))
}
fn names(
    directory: &File,
    path: &Path,
    limit: usize,
) -> Result<Vec<std::ffi::OsString>, WorkFileError> {
    #[cfg(unix)]
    {
        use std::{
            ffi::CStr,
            os::{fd::AsRawFd, unix::ffi::OsStrExt},
        };
        let _ = path;
        let fd = unsafe { libc::fcntl(directory.as_raw_fd(), libc::F_DUPFD_CLOEXEC, 3) };
        if fd < 0 {
            return Err(WorkFileError::Io);
        }
        let stream = unsafe { libc::fdopendir(fd) };
        if stream.is_null() {
            unsafe { libc::close(fd) };
            return Err(WorkFileError::Io);
        }
        struct Stream(*mut libc::DIR);
        impl Drop for Stream {
            fn drop(&mut self) {
                unsafe { libc::closedir(self.0) };
            }
        }
        let stream = Stream(stream);
        let mut result = Vec::new();
        loop {
            #[cfg(target_os = "macos")]
            unsafe {
                *libc::__error() = 0;
            }
            #[cfg(target_os = "linux")]
            unsafe {
                *libc::__errno_location() = 0;
            }
            let entry = unsafe { libc::readdir(stream.0) };
            if entry.is_null() {
                if std::io::Error::last_os_error()
                    .raw_os_error()
                    .is_some_and(|code| code != 0)
                {
                    return Err(WorkFileError::Io);
                }
                break;
            }
            let name = unsafe { CStr::from_ptr((*entry).d_name.as_ptr()) }.to_bytes();
            if matches!(name, b"." | b"..") {
                continue;
            }
            if result.len() == limit {
                return Err(WorkFileError::TooLarge);
            }
            result.push(std::ffi::OsStr::from_bytes(name).to_owned());
        }
        Ok(result)
    }
    #[cfg(windows)]
    {
        let _ = directory;
        let mut result = Vec::new();
        for entry in std::fs::read_dir(path).map_err(|_| WorkFileError::Io)? {
            if result.len() == limit {
                return Err(WorkFileError::TooLarge);
            }
            result.push(entry.map_err(|_| WorkFileError::Io)?.file_name());
        }
        Ok(result)
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = (directory, path, limit);
        Err(WorkFileError::Unavailable)
    }
}
