//! Create the mutation guard in the opened directory, without ambient traversal.
use super::WorkFileError;
use std::{
    ffi::c_void,
    fs::File,
    os::windows::io::{AsRawHandle, FromRawHandle},
};
use windows::{
    core::PWSTR,
    Win32::{
        Foundation::{HANDLE, UNICODE_STRING},
        System::IO::IO_STATUS_BLOCK,
    },
};

#[repr(C)]
struct ObjectAttributes {
    length: u32,
    root_directory: HANDLE,
    object_name: *const UNICODE_STRING,
    attributes: u32,
    security_descriptor: *const c_void,
    security_quality_of_service: *const c_void,
}

#[link(name = "ntdll")]
unsafe extern "system" {
    fn NtCreateFile(
        file: *mut HANDLE,
        access: u32,
        attributes: *const ObjectAttributes,
        status: *mut IO_STATUS_BLOCK,
        allocation: *const i64,
        file_attributes: u32,
        share: u32,
        disposition: u32,
        options: u32,
        ea: *const c_void,
        ea_length: u32,
    ) -> i32;
}

pub(super) fn create(parent: &File, name: &str) -> Result<File, WorkFileError> {
    // Only the generated, single-component marker name is accepted.
    if !name.starts_with(".zephium-pin-")
        || name.len() > 128
        || !name
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'-'))
    {
        return Err(WorkFileError::Denied);
    }
    let mut wide: Vec<u16> = name.encode_utf16().collect();
    let string = UNICODE_STRING {
        Length: (wide.len() * 2) as u16,
        MaximumLength: (wide.len() * 2) as u16,
        Buffer: PWSTR(wide.as_mut_ptr()),
    };
    let attributes = ObjectAttributes {
        length: std::mem::size_of::<ObjectAttributes>() as u32,
        root_directory: HANDLE(parent.as_raw_handle()),
        object_name: &string,
        attributes: 0x40 | 0x1000, // OBJ_CASE_INSENSITIVE | OBJ_DONT_REPARSE
        security_descriptor: std::ptr::null(),
        security_quality_of_service: std::ptr::null(),
    };
    let mut handle = HANDLE::default();
    let mut io = IO_STATUS_BLOCK::default();
    // FILE_GENERIC_READ | FILE_GENERIC_WRITE | DELETE; FILE_SHARE_READ;
    // FILE_CREATE; NON_DIRECTORY | SYNCHRONOUS_IO_NONALERT |
    // OPEN_REPARSE_POINT | DELETE_ON_CLOSE. No fallback to a pathname open.
    // SAFETY: the parent and all buffers remain live for this synchronous call.
    let status = unsafe {
        NtCreateFile(
            &raw mut handle,
            0x0013_019f,
            &attributes,
            &raw mut io,
            std::ptr::null(),
            0x80,
            1,
            2,
            0x40 | 0x20 | 0x0020_0000 | 0x1000,
            std::ptr::null(),
            0,
        )
    };
    if status < 0 || handle.is_invalid() {
        return Err(WorkFileError::Denied);
    }
    // SAFETY: successful NtCreateFile transferred ownership of this handle.
    let file = unsafe { File::from_raw_handle(handle.0) };
    if status != 0 {
        return Err(WorkFileError::Denied);
    }
    Ok(file)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::windows::fs::OpenOptionsExt;
    use windows::Win32::Storage::FileSystem::{
        FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT,
    };

    #[test]
    fn renamed_parent_marker_stays_with_opened_directory() {
        let scratch = tempfile::tempdir().unwrap();
        let original = scratch.path().join("original");
        let moved = scratch.path().join("moved");
        std::fs::create_dir(&original).unwrap();
        let parent = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(7)
            .custom_flags((FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT).0)
            .open(&original)
            .unwrap();
        std::fs::rename(&original, &moved).unwrap();
        std::fs::create_dir(&original).unwrap();
        let marker = create(&parent, ".zephium-pin-fixture").unwrap();
        assert_eq!(std::fs::read_dir(&original).unwrap().count(), 0);
        assert!(moved.join(".zephium-pin-fixture").exists());
        drop(marker);
        assert_eq!(std::fs::read_dir(&moved).unwrap().count(), 0);
        assert_eq!(std::fs::read_dir(&original).unwrap().count(), 0);
    }
}
