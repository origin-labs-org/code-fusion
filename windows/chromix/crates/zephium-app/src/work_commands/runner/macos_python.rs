//! Qualification is intentionally specific to an OS and Apple runtime image.
use super::{Failure, Output, Snapshot};
use sha2::{Digest, Sha256};
use std::{
    ffi::OsString,
    future::Future,
    os::unix::fs::MetadataExt,
    path::{Path, PathBuf},
};
const RUNTIME: &str =
    "/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.9";
const EXECUTABLE: &str = "Resources/Python.app/Contents/MacOS/Python";
const EXECUTABLE_HASH: &str = "0b7aad9bf1adf74d3922cf351f7d2e908dae19edd5456299d162810ae083523d";
const LIBRARY_HASH: &str = "26422f0b21cb1e07236384afa4043c7401d39d09358c91df8bf3f5496f14712f";

pub(super) struct Runtime {
    executable: PathBuf,
    library: PathBuf,
    stdlib: PathBuf,
    dynamic: PathBuf,
}
impl Runtime {
    #[cfg(test)]
    pub fn qualified() -> Result<Self, Failure> {
        Self::qualified_checked(&|| Ok(()))
    }
    pub fn qualified_checked(check: &dyn Fn() -> Result<(), Failure>) -> Result<Self, Failure> {
        check()?;
        if !super::macos::qualified() {
            return Err(Failure::PythonUnavailable);
        }
        let root = Path::new(RUNTIME);
        let result = Self {
            executable: root.join(EXECUTABLE),
            library: root.join("Python3"),
            stdlib: root.join("lib/python3.9"),
            dynamic: root.join("lib/python3.9/lib-dynload"),
        };
        for path in [
            &result.executable,
            &result.library,
            &result.stdlib,
            &result.dynamic,
        ] {
            check()?;
            immutable_root_path(path)?;
        }
        verify_image(&result.executable, EXECUTABLE_HASH, check)?;
        verify_image(&result.library, LIBRARY_HASH, check)?;
        verify_stdlib(&result.stdlib, check)?;
        Ok(result)
    }
    fn profile(&self, snapshot: &Snapshot) -> Result<String, Failure> {
        // These values are exclusively pinned runtime paths and broker-generated
        // ASCII temporary roots, never source folders or model text.
        let quote = |path: &Path| -> Result<String, Failure> {
            let text = path.to_str().ok_or(Failure::Input)?;
            if !text.is_ascii() || text.contains(['"', '\\', '\n', '\r']) {
                return Err(Failure::Input);
            }
            Ok(format!("\"{text}\""))
        };
        Ok(format!(
            r#"(version 1)
(deny default)
(allow process-info* (target self))
(allow file-map-executable (subpath "/System/Library") (subpath "/usr/lib") (subpath {dynamic}) (literal {library}))
(allow file-read* (subpath "/System/Library") (subpath "/usr/lib") (subpath "/usr/share/locale") (subpath "/Library/Apple/System/Library") (subpath {work}) (subpath {stdlib}) (literal {library}) (literal {executable}))
(allow file-read-metadata (literal "/") (literal "/System") (literal "/usr") (literal "/usr/share") (literal "/Library") (literal "/Library/Apple") (literal "/Library/Apple/System") (literal "/private") (literal "/private/tmp"))
(allow file-read-data file-write-data (literal "/dev/null"))
(allow file-read-data (literal "/dev/urandom") (literal "/dev/random"))
"#,
            dynamic = quote(&self.dynamic)?,
            library = quote(&self.library)?,
            executable = quote(&self.executable)?,
            work = quote(&snapshot.root)?,
            stdlib = quote(&self.stdlib)?
        ))
    }
}
fn immutable_root_path(path: &Path) -> Result<(), Failure> {
    for path in path.ancestors() {
        let metadata = std::fs::symlink_metadata(path).map_err(|_| Failure::PythonUnavailable)?;
        if metadata.file_type().is_symlink() || metadata.uid() != 0 || metadata.mode() & 0o022 != 0
        {
            return Err(Failure::PythonUnavailable);
        }
    }
    Ok(())
}
fn verify_image(
    path: &Path,
    expected: &str,
    check: &dyn Fn() -> Result<(), Failure>,
) -> Result<(), Failure> {
    use std::io::Read;
    let mut file = std::fs::File::open(path).map_err(|_| Failure::PythonUnavailable)?;
    let metadata = file.metadata().map_err(|_| Failure::PythonUnavailable)?;
    if !metadata.is_file() || metadata.len() > 64 * 1024 * 1024 {
        return Err(Failure::PythonUnavailable);
    }
    let mut digest = Sha256::new();
    let mut bytes = [0u8; 64 * 1024];
    let mut count = 0u64;
    loop {
        check()?;
        let got = file
            .read(&mut bytes)
            .map_err(|_| Failure::PythonUnavailable)?;
        if got == 0 {
            break;
        }
        count += got as u64;
        if count > 64 * 1024 * 1024 {
            return Err(Failure::PythonUnavailable);
        }
        digest.update(&bytes[..got]);
    }
    if count != metadata.len() || format!("{:x}", digest.finalize()) != expected {
        return Err(Failure::PythonUnavailable);
    }
    Ok(())
}
// Bound and pin the complete stdlib/extension closure, including bytecode that
// CPython may load before the seal. Only two vendor links to the pinned framework
// image are admitted; source snapshots never inherit this exception.
fn verify_stdlib(root: &Path, check: &dyn Fn() -> Result<(), Failure>) -> Result<(), Failure> {
    use std::io::Read;
    let mut pending = vec![root.to_owned()];
    let mut rows = std::collections::BTreeMap::new();
    let mut entries = 0usize;
    while let Some(directory) = pending.pop() {
        for entry in std::fs::read_dir(directory).map_err(|_| Failure::PythonUnavailable)? {
            check()?;
            entries += 1;
            if entries > 10_000 {
                return Err(Failure::PythonUnavailable);
            }
            let path = entry.map_err(|_| Failure::PythonUnavailable)?.path();
            let metadata =
                std::fs::symlink_metadata(&path).map_err(|_| Failure::PythonUnavailable)?;
            if metadata.uid() != 0 || metadata.mode() & 0o022 != 0 {
                return Err(Failure::PythonUnavailable);
            }
            if metadata.is_dir() {
                pending.push(path);
                continue;
            }
            let relative = path
                .strip_prefix(root)
                .map_err(|_| Failure::PythonUnavailable)?
                .to_str()
                .ok_or(Failure::PythonUnavailable)?
                .to_owned();
            let link = if metadata.file_type().is_symlink() {
                if !matches!(
                    relative.as_str(),
                    "config-3.9-darwin/libpython3.9.dylib" | "config-3.9-darwin/libpython3.9.a"
                ) {
                    return Err(Failure::PythonUnavailable);
                }
                let target = std::fs::read_link(&path).map_err(|_| Failure::PythonUnavailable)?;
                if target != Path::new("../../../Python3") {
                    return Err(Failure::PythonUnavailable);
                }
                Some(b"../../../Python3".as_slice())
            } else if metadata.is_file() {
                None
            } else {
                return Err(Failure::PythonUnavailable);
            };
            rows.insert(relative, (path, metadata, link));
        }
    }
    let mut digest = Sha256::new();
    let mut total = 0u64;
    let mut buffer = [0u8; 64 * 1024];
    for (name, (path, metadata, link)) in rows {
        check()?;
        let size = link.map_or(metadata.len(), |link| link.len() as u64);
        total = total.checked_add(size).ok_or(Failure::PythonUnavailable)?;
        if total > 256 * 1024 * 1024 {
            return Err(Failure::PythonUnavailable);
        }
        digest.update((name.len() as u64).to_be_bytes());
        digest.update(name.as_bytes());
        digest.update([u8::from(link.is_some())]);
        digest.update(size.to_be_bytes());
        if let Some(link) = link {
            digest.update(link);
            continue;
        }
        use std::os::unix::fs::OpenOptionsExt;
        let mut file = std::fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
            .open(path)
            .map_err(|_| Failure::PythonUnavailable)?;
        let opened = file.metadata().map_err(|_| Failure::PythonUnavailable)?;
        if (opened.dev(), opened.ino(), opened.len())
            != (metadata.dev(), metadata.ino(), metadata.len())
        {
            return Err(Failure::PythonUnavailable);
        }
        let mut count = 0u64;
        loop {
            check()?;
            let got = file
                .read(&mut buffer)
                .map_err(|_| Failure::PythonUnavailable)?;
            if got == 0 {
                break;
            }
            count += got as u64;
            if count > size {
                return Err(Failure::PythonUnavailable);
            }
            digest.update(&buffer[..got]);
        }
        if count != size {
            return Err(Failure::PythonUnavailable);
        }
    }
    if format!("{:x}", digest.finalize())
        != "6e28c7aa97324a38f0f9636e8cede12c985f0cadb56e0a45af9b028dd1303717"
    {
        return Err(Failure::PythonUnavailable);
    }
    Ok(())
}
#[cfg(test)]
pub(super) async fn run<C, CF>(
    snapshot: &Snapshot,
    runtime: &Runtime,
    modules: &[String],
    cancelled: &C,
) -> Result<Output, Failure>
where
    C: Fn() -> CF,
    CF: Future<Output = bool>,
{
    run_mode(snapshot, runtime, modules, cancelled, false, |_| {}).await
}
pub(super) async fn run_custodied<C, CF>(
    snapshot: &Snapshot,
    runtime: &Runtime,
    modules: &[String],
    cancelled: &C,
    started: impl FnOnce(u32),
) -> Result<Output, Failure>
where
    C: Fn() -> CF,
    CF: Future<Output = bool>,
{
    run_mode(snapshot, runtime, modules, cancelled, true, started).await
}
async fn run_mode<C, CF>(
    snapshot: &Snapshot,
    runtime: &Runtime,
    modules: &[String],
    cancelled: &C,
    retain_custody: bool,
    started: impl FnOnce(u32),
) -> Result<Output, Failure>
where
    C: Fn() -> CF,
    CF: Future<Output = bool>,
{
    let request = serde_json::json!({"platform":"macos","guard_ready":retain_custody,"profile":runtime.profile(snapshot)?,"root":snapshot.work,"home":snapshot.home,"temporary":snapshot.temporary,"stdlib":[runtime.stdlib,runtime.dynamic],"modules":modules});
    let args: Vec<OsString> = vec![
        "-I".into(),
        "-S".into(),
        "-B".into(),
        "-c".into(),
        super::python::BOOTSTRAP.into(),
        request.to_string().into(),
    ];
    let environment = vec![
        ("HOME".into(), snapshot.home.as_os_str().to_owned()),
        ("LC_ALL".into(), "C".into()),
        ("TZ".into(), "UTC".into()),
    ];
    let spawn = || {
        let child = super::macos_spawn::spawn_direct_read_only(
            &snapshot.work,
            &runtime.executable,
            &args,
            &environment,
        )?;
        Ok(child)
    };
    if retain_custody {
        super::macos::monitor_custodied(cancelled, spawn, started).await
    } else {
        super::macos::monitor(cancelled, true, spawn).await
    }
}
