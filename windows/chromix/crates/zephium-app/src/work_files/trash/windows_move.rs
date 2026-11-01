//! Unqualified Windows move backend: opened handles prevent reparse/name races.
use super::*;
use std::sync::atomic::{AtomicBool, Ordering};
pub(crate) struct Destination {
    path: PathBuf,
    parent: File,
    identity: Identity,
}
fn directory_identity(file: &File) -> Result<Identity, Failure> {
    let mut info = BY_HANDLE_FILE_INFORMATION::default();
    unsafe { GetFileInformationByHandle(HANDLE(file.as_raw_handle()), &mut info) }
        .map_err(|_| Failure::Destination)?;
    if info.dwFileAttributes & 0x400 != 0 || info.dwFileAttributes & 0x10 == 0 {
        return Err(Failure::Destination);
    }
    Ok((
        info.dwVolumeSerialNumber,
        (u64::from(info.nFileIndexHigh) << 32) | u64::from(info.nFileIndexLow),
    ))
}
fn parent(path: &Path, apply: bool) -> Result<File, Failure> {
    OpenOptions::new()
        .access_mode(if apply { 0x0010_00a3 } else { 0x80 })
        .share_mode(if apply { 3 } else { 7 })
        .custom_flags(0x0220_0000)
        .open(path)
        .map_err(|_| Failure::Destination)
}
impl Destination {
    pub fn new(path: PathBuf) -> Result<Self, Failure> {
        let parent_path = path.parent().ok_or(Failure::Input)?;
        let parent = parent(parent_path, false)?;
        if !opened_at(&parent, parent_path) {
            return Err(Failure::Destination);
        }
        let identity = directory_identity(&parent)?;
        let value = Self {
            path,
            parent,
            identity,
        };
        value.check()?;
        Ok(value)
    }
    pub fn check(&self) -> Result<(), Failure> {
        let parent_path = self.path.parent().ok_or(Failure::Input)?;
        let now = parent(parent_path, false)?;
        if !opened_at(&now, parent_path)
            || directory_identity(&now)? != self.identity
            || directory_identity(&self.parent)? != self.identity
        {
            return Err(Failure::Destination);
        }
        match std::fs::symlink_metadata(&self.path) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            _ => Err(Failure::Destination),
        }
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
        let parent_path = destination.path.parent().ok_or(Failure::Input)?;
        let _guards = pin_mutation_directory(parent_path).map_err(Failure::File)?;
        let parent = parent(parent_path, true)?;
        destination.check()?;
        if !opened_at(&parent, parent_path) || directory_identity(&parent)? != destination.identity
        {
            return Err(Failure::Destination);
        }
        if destination.identity.0 != self.identity.0 {
            return Err(Failure::CrossVolume);
        }
        let file = stage
            .with_verified_path(|directory| {
                self.apply_at_with(directory, cancelled, |file, _| Ok(file))
            })
            .map_err(|_| Failure::RecoveryPending)??;
        let backup = record.backup().map_err(|_| Failure::RecoveryPending)?;
        let acknowledged = backup
            .with_verified_path(|directory| {
                let path = directory.join("recovery.txt");
                let checked = open_checked_file(&path, true).map_err(Failure::File)?;
                if digest(&bytes(&checked.input)?) != self.digest {
                    return Err(Failure::RecoveryPending);
                }
                let expected = identity(&checked.input)?;
                drop(checked);
                if cancelled.load(Ordering::Acquire) {
                    return Err(Failure::RecoveryPending);
                }
                native_trash(&path, expected)
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
                let source = directory.join(self.path.file_name().ok_or(Failure::Input)?);
                if !opened_at(&file, &source)
                    || identity(&file)? != self.identity
                    || digest(&bytes(&file)?) != self.digest
                {
                    return Err(Failure::RecoveryPending);
                }
                let name: Vec<u16> = destination
                    .path
                    .file_name()
                    .ok_or(Failure::Input)?
                    .encode_wide()
                    .collect();
                let length = size_of::<FILE_RENAME_INFO>() + name.len() * 2;
                let mut storage = vec![0usize; length.div_ceil(size_of::<usize>())];
                let rename = storage.as_mut_ptr().cast::<FILE_RENAME_INFO>();
                if cancelled.load(Ordering::Acquire) {
                    return Err(Failure::RecoveryPending);
                }
                unsafe {
                    (*rename).Anonymous.ReplaceIfExists = false;
                    (*rename).RootDirectory = HANDLE(parent.as_raw_handle());
                    (*rename).FileNameLength = (name.len() * 2) as u32;
                    std::ptr::copy_nonoverlapping(
                        name.as_ptr(),
                        (*rename).FileName.as_mut_ptr(),
                        name.len(),
                    );
                    SetFileInformationByHandle(
                        HANDLE(file.as_raw_handle()),
                        FileRenameInfo,
                        storage.as_ptr().cast(),
                        length as u32,
                    )
                }
                .map_err(|_| Failure::RecoveryPending)?;
                if !opened_at(&file, &destination.path) || identity(&file)? != self.identity {
                    return Err(Failure::RecoveryPending);
                }
                Ok(())
            })
            .map_err(|_| Failure::RecoveryPending)??;
        Ok(acknowledged)
    }
}
