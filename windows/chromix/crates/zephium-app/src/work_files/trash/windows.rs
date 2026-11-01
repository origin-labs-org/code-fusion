//! Windows source backend; runtime admission remains closed pending native QA.
//! A handle-bound same-volume stage precedes an exact IFileOperation recycle ack.
#[path = "windows_move.rs"]
mod move_file;
use super::{digest, journal::Record, Failure, MAX_BYTES};
use crate::work_files::{open_checked_file, opened_at, pin_mutation_directory, single_link};
use ::windows::{
    core::{implement, Ref, HRESULT, PCWSTR},
    Win32::{
        Foundation::{E_ABORT, HANDLE, S_OK},
        Storage::FileSystem::{
            FileRenameInfo, GetFileInformationByHandle, SetFileInformationByHandle,
            BY_HANDLE_FILE_INFORMATION, FILE_RENAME_INFO,
        },
        System::Com::{
            CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_INPROC_SERVER,
            COINIT_APARTMENTTHREADED,
        },
        UI::Shell::*,
    },
};
pub(super) use move_file::Destination;
use std::{
    fs::{File, OpenOptions},
    io::{Read, Seek, SeekFrom},
    mem::size_of,
    os::windows::{
        ffi::OsStrExt,
        fs::{MetadataExt, OpenOptionsExt},
        io::AsRawHandle,
    },
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use zephium_private_fs::PrivateDirectory;

type Identity = (u32, u64);
fn identity(file: &File) -> Result<Identity, Failure> {
    let mut info = BY_HANDLE_FILE_INFORMATION::default();
    unsafe { GetFileInformationByHandle(HANDLE(file.as_raw_handle()), &mut info) }
        .map_err(|_| Failure::Changed)?;
    if info.dwFileAttributes & (0x10 | 0x400) != 0
        || info.nNumberOfLinks != 1
        || !single_link(file).map_err(Failure::File)?
    {
        return Err(Failure::Changed);
    }
    Ok((
        info.dwVolumeSerialNumber,
        (u64::from(info.nFileIndexHigh) << 32) | u64::from(info.nFileIndexLow),
    ))
}
fn bytes(file: &File) -> Result<Vec<u8>, Failure> {
    let mut file = file.try_clone().map_err(|_| Failure::Changed)?;
    file.seek(SeekFrom::Start(0))
        .map_err(|_| Failure::Changed)?;
    let mut content = Vec::new();
    file.take(MAX_BYTES as u64 + 1)
        .read_to_end(&mut content)
        .map_err(|_| Failure::Changed)?;
    if content.len() > MAX_BYTES {
        return Err(Failure::Input);
    }
    Ok(content)
}
pub(super) struct Prepared {
    path: PathBuf,
    original: File,
    identity: Identity,
    pub text: String,
    pub digest: String,
}
impl Prepared {
    pub fn new(path: PathBuf, known: &str) -> Result<Self, Failure> {
        let checked = open_checked_file(&path, true).map_err(Failure::File)?;
        let original_identity = identity(&checked.input)?;
        let content = bytes(&checked.input)?;
        let digest = digest(&content);
        if digest != known {
            return Err(Failure::Changed);
        }
        let text = String::from_utf8(content).map_err(|_| Failure::Input)?;
        if crate::work_files::binary_looking(&text) {
            return Err(Failure::Input);
        }
        // This identity handle does not prevent the person editing during approval.
        let original = OpenOptions::new()
            .access_mode(0x80)
            .share_mode(7)
            .custom_flags(0x0020_0000)
            .open(&path)
            .map_err(|_| Failure::Changed)?;
        if identity(&original)? != original_identity {
            return Err(Failure::Changed);
        }
        Ok(Self {
            path,
            original,
            identity: original_identity,
            text,
            digest,
        })
    }
    pub fn apply(
        &self,
        stage: &PrivateDirectory,
        _: &Record,
        cancelled: &std::sync::atomic::AtomicBool,
    ) -> Result<PathBuf, Failure> {
        stage
            .with_verified_path(|directory| self.apply_at(directory, cancelled))
            .map_err(|_| Failure::RecoveryPending)?
    }
    fn apply_at(
        &self,
        directory: &Path,
        cancelled: &std::sync::atomic::AtomicBool,
    ) -> Result<PathBuf, Failure> {
        self.apply_at_with(directory, cancelled, |file, target| {
            drop(file);
            native_trash(target, self.identity)
        })
    }
    fn apply_at_with<T>(
        &self,
        directory: &Path,
        cancelled: &std::sync::atomic::AtomicBool,
        publish: impl FnOnce(File, &Path) -> Result<T, Failure>,
    ) -> Result<T, Failure> {
        let _source_guards = pin_mutation_directory(self.path.parent().ok_or(Failure::Input)?)
            .map_err(Failure::File)?;
        let _stage_guards = pin_mutation_directory(directory).map_err(Failure::File)?;
        let file = OpenOptions::new()
            .access_mode(0x8001_0000)
            .share_mode(1)
            .custom_flags(0x0020_0000)
            .open(&self.path)
            .map_err(|_| Failure::Changed)?;
        if !opened_at(&file, &self.path)
            || identity(&file)? != self.identity
            || identity(&self.original)? != self.identity
            || digest(&bytes(&file)?) != self.digest
        {
            return Err(Failure::Changed);
        }
        let parent = OpenOptions::new()
            .access_mode(0x0010_00a3)
            .share_mode(3)
            .custom_flags(0x0220_0000)
            .open(directory)
            .map_err(|_| Failure::Storage)?;
        if !opened_at(&parent, directory)
            || parent
                .metadata()
                .map_err(|_| Failure::Storage)?
                .file_attributes()
                & 0x400
                != 0
        {
            return Err(Failure::Storage);
        }
        let mut parent_info = BY_HANDLE_FILE_INFORMATION::default();
        unsafe { GetFileInformationByHandle(HANDLE(parent.as_raw_handle()), &mut parent_info) }
            .map_err(|_| Failure::Storage)?;
        if parent_info.dwVolumeSerialNumber != self.identity.0 {
            return Err(Failure::CrossVolume);
        }
        let name: Vec<u16> = self
            .path
            .file_name()
            .ok_or(Failure::Input)?
            .encode_wide()
            .collect();
        let length = size_of::<FILE_RENAME_INFO>() + name.len() * 2;
        let mut storage = vec![0usize; length.div_ceil(size_of::<usize>())];
        let rename = storage.as_mut_ptr().cast::<FILE_RENAME_INFO>();
        if cancelled.load(std::sync::atomic::Ordering::Acquire) {
            return Err(Failure::Stopped);
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
        .map_err(|_| Failure::Changed)?;
        let target = directory.join(self.path.file_name().ok_or(Failure::Input)?);
        if !opened_at(&file, &target) || identity(&file)? != self.identity {
            return Err(Failure::RecoveryPending);
        }
        if cancelled.load(std::sync::atomic::Ordering::Acquire) {
            return Err(Failure::RecoveryPending);
        }
        publish(file, &target)
    }
}
fn item_path(item: &IShellItem) -> windows::core::Result<PathBuf> {
    let allocated = unsafe { item.GetDisplayName(SIGDN_FILESYSPATH) }?;
    let text = unsafe { allocated.to_string() };
    unsafe { CoTaskMemFree(Some(allocated.0.cast())) };
    Ok(PathBuf::from(text?))
}
fn check_path(path: &Path, expected: Identity) -> bool {
    OpenOptions::new()
        .access_mode(0x80)
        .share_mode(7)
        .custom_flags(0x0020_0000)
        .open(path)
        .ok()
        .is_some_and(|file| identity(&file).ok() == Some(expected) && opened_at(&file, path))
}
#[derive(Default)]
struct Acknowledgment {
    pre: bool,
    post: bool,
    finished: bool,
    returned: Option<PathBuf>,
}
#[implement(IFileOperationProgressSink)]
struct RecycleSink {
    path: PathBuf,
    file_identity: Identity,
    state: Arc<Mutex<Acknowledgment>>,
}
#[allow(non_snake_case)]
impl IFileOperationProgressSink_Impl for RecycleSink_Impl {
    fn StartOperations(&self) -> windows::core::Result<()> {
        Ok(())
    }
    fn FinishOperations(&self, result: HRESULT) -> windows::core::Result<()> {
        if result != S_OK {
            return Err(E_ABORT.into());
        }
        self.state
            .lock()
            .map_err(|_| windows::core::Error::from(E_ABORT))?
            .finished = true;
        Ok(())
    }
    fn PreDeleteItem(&self, flags: u32, item: Ref<'_, IShellItem>) -> windows::core::Result<()> {
        // An operation which cannot recycle is vetoed before deleting anything.
        if flags & TSF_DELETE_RECYCLE_IF_POSSIBLE.0 as u32 == 0 {
            return Err(E_ABORT.into());
        }
        let item = item
            .as_ref()
            .ok_or_else(|| windows::core::Error::from(E_ABORT))?;
        if item_path(item)? != self.path || !check_path(&self.path, self.file_identity) {
            return Err(E_ABORT.into());
        }
        let mut state = self
            .state
            .lock()
            .map_err(|_| windows::core::Error::from(E_ABORT))?;
        if state.pre {
            return Err(E_ABORT.into());
        }
        state.pre = true;
        Ok(())
    }
    fn PostDeleteItem(
        &self,
        flags: u32,
        _: Ref<'_, IShellItem>,
        result: HRESULT,
        created: Ref<'_, IShellItem>,
    ) -> windows::core::Result<()> {
        if result != S_OK || flags & TSF_DELETE_RECYCLE_IF_POSSIBLE.0 as u32 == 0 {
            return Err(E_ABORT.into());
        }
        let created = created
            .as_ref()
            .ok_or_else(|| windows::core::Error::from(E_ABORT))?;
        let path = item_path(created)?;
        if !check_path(&path, self.file_identity) {
            return Err(E_ABORT.into());
        }
        let mut state = self
            .state
            .lock()
            .map_err(|_| windows::core::Error::from(E_ABORT))?;
        if !state.pre || state.post {
            return Err(E_ABORT.into());
        }
        state.post = true;
        state.returned = Some(path);
        Ok(())
    }
    fn PreRenameItem(
        &self,
        _dwflags: u32,
        _psiitem: windows::core::Ref<'_, IShellItem>,
        _psznewname: &windows::core::PCWSTR,
    ) -> windows::core::Result<()> {
        Err(E_ABORT.into())
    }
    fn PostRenameItem(
        &self,
        _dwflags: u32,
        _psiitem: windows::core::Ref<'_, IShellItem>,
        _psznewname: &windows::core::PCWSTR,
        _hrrename: windows::core::HRESULT,
        _psinewlycreated: windows::core::Ref<'_, IShellItem>,
    ) -> windows::core::Result<()> {
        Err(E_ABORT.into())
    }
    fn PreMoveItem(
        &self,
        _dwflags: u32,
        _psiitem: windows::core::Ref<'_, IShellItem>,
        _psidestinationfolder: windows::core::Ref<'_, IShellItem>,
        _psznewname: &windows::core::PCWSTR,
    ) -> windows::core::Result<()> {
        Err(E_ABORT.into())
    }
    fn PostMoveItem(
        &self,
        _dwflags: u32,
        _psiitem: windows::core::Ref<'_, IShellItem>,
        _psidestinationfolder: windows::core::Ref<'_, IShellItem>,
        _psznewname: &windows::core::PCWSTR,
        _hrmove: windows::core::HRESULT,
        _psinewlycreated: windows::core::Ref<'_, IShellItem>,
    ) -> windows::core::Result<()> {
        Err(E_ABORT.into())
    }
    fn PreCopyItem(
        &self,
        _dwflags: u32,
        _psiitem: windows::core::Ref<'_, IShellItem>,
        _psidestinationfolder: windows::core::Ref<'_, IShellItem>,
        _psznewname: &windows::core::PCWSTR,
    ) -> windows::core::Result<()> {
        Err(E_ABORT.into())
    }
    fn PostCopyItem(
        &self,
        _dwflags: u32,
        _psiitem: windows::core::Ref<'_, IShellItem>,
        _psidestinationfolder: windows::core::Ref<'_, IShellItem>,
        _psznewname: &windows::core::PCWSTR,
        _hrcopy: windows::core::HRESULT,
        _psinewlycreated: windows::core::Ref<'_, IShellItem>,
    ) -> windows::core::Result<()> {
        Err(E_ABORT.into())
    }
    fn PreNewItem(
        &self,
        _dwflags: u32,
        _psidestinationfolder: windows::core::Ref<'_, IShellItem>,
        _psznewname: &windows::core::PCWSTR,
    ) -> windows::core::Result<()> {
        Err(E_ABORT.into())
    }
    fn PostNewItem(
        &self,
        _dwflags: u32,
        _psidestinationfolder: windows::core::Ref<'_, IShellItem>,
        _psznewname: &windows::core::PCWSTR,
        _psztemplatename: &windows::core::PCWSTR,
        _dwfileattributes: u32,
        _hrnew: windows::core::HRESULT,
        _psinewitem: windows::core::Ref<'_, IShellItem>,
    ) -> windows::core::Result<()> {
        Err(E_ABORT.into())
    }
    fn UpdateProgress(&self, _iworktotal: u32, _iworksofar: u32) -> windows::core::Result<()> {
        Ok(())
    }
    fn ResetTimer(&self) -> windows::core::Result<()> {
        Ok(())
    }
    fn PauseTimer(&self) -> windows::core::Result<()> {
        Ok(())
    }
    fn ResumeTimer(&self) -> windows::core::Result<()> {
        Ok(())
    }
}
struct Apartment;
impl Drop for Apartment {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}
fn native_trash(path: &Path, expected: Identity) -> Result<PathBuf, Failure> {
    unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }
        .ok()
        .map_err(|_| Failure::RecoveryPending)?;
    let _apartment = Apartment;
    let operation: IFileOperation =
        unsafe { CoCreateInstance(&FileOperation, None, CLSCTX_INPROC_SERVER) }
            .map_err(|_| Failure::RecoveryPending)?;
    let mut name: Vec<u16> = path.as_os_str().encode_wide().collect();
    name.push(0);
    let item: IShellItem = unsafe { SHCreateItemFromParsingName(PCWSTR(name.as_ptr()), None) }
        .map_err(|_| Failure::RecoveryPending)?;
    let state = Arc::new(Mutex::new(Acknowledgment::default()));
    let sink: IFileOperationProgressSink = RecycleSink {
        path: path.to_owned(),
        file_identity: expected,
        state: state.clone(),
    }
    .into();
    let flags = FOFX_RECYCLEONDELETE
        | FOFX_EARLYFAILURE
        | FOFX_NOCOPYHOOKS
        | FOF_NO_UI
        | FOF_NORECURSION
        | FOF_NORECURSEREPARSE
        | FOF_NO_CONNECTED_ELEMENTS;
    unsafe {
        operation
            .SetOperationFlags(flags)
            .map_err(|_| Failure::RecoveryPending)?;
        let cookie = operation
            .Advise(&sink)
            .map_err(|_| Failure::RecoveryPending)?;
        let result = operation
            .DeleteItem(&item, None)
            .and_then(|_| operation.PerformOperations());
        let aborted = operation.GetAnyOperationsAborted();
        let _ = operation.Unadvise(cookie);
        if result.is_err() || aborted.map_or(true, |value| value.as_bool()) {
            return Err(Failure::RecoveryPending);
        }
    }
    let mut state = state.lock().map_err(|_| Failure::RecoveryPending)?;
    if !state.pre
        || !state.post
        || !state.finished
        || path.try_exists().map_err(|_| Failure::RecoveryPending)?
    {
        return Err(Failure::RecoveryPending);
    }
    state.returned.take().ok_or(Failure::RecoveryPending)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_sink_refuses_permanent_delete_and_missing_recycle_ack() {
        let sink: IFileOperationProgressSink = RecycleSink {
            path: PathBuf::new(),
            file_identity: (0, 0),
            state: Default::default(),
        }
        .into();
        assert!(unsafe { sink.PreDeleteItem(0, None) }.is_err());
        assert!(unsafe {
            sink.PostDeleteItem(TSF_DELETE_RECYCLE_IF_POSSIBLE.0 as u32, None, S_OK, None)
        }
        .is_err());
        assert!(unsafe { sink.FinishOperations(E_ABORT) }.is_err());
    }
    #[test]
    #[ignore = "Physical Windows exact Recycle Bin acknowledgment qualification; inert scratch file only"]
    fn native_recycle_returns_the_exact_inert_item() {
        let scratch = tempfile::Builder::new()
            .prefix("work-recycle-fixture-")
            .tempdir()
            .unwrap();
        let path = scratch
            .path()
            .join(format!("zephium-inert-{}.txt", super::super::recovery_id()));
        std::fs::write(&path, "inert recycle fixture").unwrap();
        let file = File::open(&path).unwrap();
        let expected = identity(&file).unwrap();
        drop(file);
        let returned = native_trash(&path, expected).unwrap();
        assert!(!path.exists());
        assert!(check_path(&returned, expected));
        // Never enumerate or clean another Recycle Bin item.
        std::fs::remove_file(returned).unwrap();
    }
}
