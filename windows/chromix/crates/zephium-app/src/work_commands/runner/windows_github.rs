//! Windows source backend. Actual LPAC/AF_UNIX and runtime qualification is closed.
use super::{Failure, Output, Snapshot};
use sha2::{Digest, Sha256};
use std::{
    ffi::OsString,
    fs::{File, OpenOptions},
    future::Future,
    io::{Read, Write},
    os::windows::fs::{MetadataExt, OpenOptionsExt},
    path::{Path, PathBuf},
};
// Official gh2.96.0 windows-amd64 release archive:
// c2d6acc935cd2f00e2144d7e036d5cd82e6b6bd5594e8c75aa75ef2a4ed6aac3.
const IMAGE_DIGEST: &str = "cd79f16203f1fbe56937c4c96e2b6eadd10549418dcb241d91576ac77af0ac8b";
const IMAGE_BYTES: u64 = 41_504_056;
pub(super) struct Runtime {
    // Close the endpoint's no-delete handle before removing the private copy.
    endpoint: Option<File>,
    profile: super::windows::Profile,
    snapshot: Snapshot,
    executable: PathBuf,
    pub socket: PathBuf,
}
impl Runtime {
    pub fn prepare_checked(check: &dyn Fn() -> Result<(), Failure>) -> Result<Self, Failure> {
        check()?;
        // No installed/PATH fallback. Packaging and native Windows qualification
        // are mandatory; a Mac source check cannot populate this eligibility.
        const QUALIFIED: bool = false;
        if !QUALIFIED {
            return Err(Failure::GitHubUnavailable);
        }
        let installed = std::env::current_exe().map_err(|_| Failure::GitHubUnavailable)?;
        let image = installed
            .parent()
            .ok_or(Failure::GitHubUnavailable)?
            .join("work-runtime/gh-2.96.0/gh.exe");
        Self::prepare_image_checked(&image, check)
    }
    #[cfg(test)]
    fn prepare_image(image: &Path) -> Result<Self, Failure> {
        Self::prepare_image_checked(image, &|| Ok(()))
    }
    fn prepare_image_checked(
        image: &Path,
        check: &dyn Fn() -> Result<(), Failure>,
    ) -> Result<Self, Failure> {
        check()?;
        let _pins = crate::work_files::pin_directories(image.parent().ok_or(Failure::Input)?)
            .map_err(|_| Failure::GitHubUnavailable)?;
        let mut input = OpenOptions::new()
            .read(true)
            .share_mode(1)
            .custom_flags(0x0020_0000)
            .open(image)
            .map_err(|_| Failure::GitHubUnavailable)?;
        let metadata = input.metadata().map_err(|_| Failure::GitHubUnavailable)?;
        if !metadata.is_file()
            || metadata.file_attributes() & 0x400 != 0
            || metadata.len() != IMAGE_BYTES
            || !crate::work_files::single_link(&input).map_err(|_| Failure::GitHubUnavailable)?
        {
            return Err(Failure::GitHubUnavailable);
        }
        let snapshot = Snapshot::read_only_checked(Default::default(), check)?;
        let prepared = (|| -> Result<(PathBuf, PathBuf, super::windows::Profile), Failure> {
            std::fs::create_dir(snapshot.root.join("tool")).map_err(|_| Failure::Storage)?;
            let executable = snapshot.root.join("tool/gh.exe");
            let mut output = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&executable)
                .map_err(|_| Failure::Storage)?;
            let mut digest = Sha256::new();
            let mut total = 0u64;
            let mut chunk = [0u8; 64 * 1024];
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
            loop {
                check()?;
                if std::time::Instant::now() >= deadline {
                    return Err(Failure::Limit);
                }
                let count = input
                    .read(&mut chunk)
                    .map_err(|_| Failure::GitHubUnavailable)?;
                if count == 0 {
                    break;
                }
                total = total.checked_add(count as u64).ok_or(Failure::Limit)?;
                if total > IMAGE_BYTES {
                    return Err(Failure::GitHubUnavailable);
                }
                digest.update(&chunk[..count]);
                output
                    .write_all(&chunk[..count])
                    .map_err(|_| Failure::Storage)?;
            }
            if total != IMAGE_BYTES
                || format!("{:x}", digest.finalize()) != IMAGE_DIGEST
                || !crate::work_files::single_link(&input)
                    .map_err(|_| Failure::GitHubUnavailable)?
            {
                return Err(Failure::GitHubUnavailable);
            }
            output.sync_all().map_err(|_| Failure::Storage)?;
            drop(output);
            let socket = snapshot.root.join("broker.sock");
            super::github::write_config(&snapshot.home, &socket)?;
            let profile = super::windows::Profile::create()?;
            profile.grant_copy(&snapshot, true)?;
            check()?;
            Ok((executable, socket, profile))
        })();
        let (executable, socket, profile) = match prepared {
            Ok(value) => value,
            Err(error) => {
                snapshot.close()?;
                return Err(error);
            }
        };
        Ok(Self {
            endpoint: None,
            profile,
            snapshot,
            executable,
            socket,
        })
    }
    pub fn close(self) -> Result<(), Failure> {
        let Self {
            endpoint,
            profile,
            snapshot,
            ..
        } = self;
        drop(endpoint);
        drop(profile);
        snapshot.close()
    }
    pub fn grant_socket(&mut self) -> Result<(), Failure> {
        self.endpoint = Some(self.profile.grant_socket(&self.snapshot, &self.socket)?);
        Ok(())
    }
    pub async fn run<C, CF>(&self, nonce: &str, cancelled: &C) -> Result<Output, Failure>
    where
        C: Fn() -> CF,
        CF: Future<Output = bool>,
    {
        let arguments: Vec<OsString> = vec![
            "api".into(),
            "--method".into(),
            "GET".into(),
            format!("http://127.0.0.1:1/{nonce}").into(),
        ];
        let mut environment = super::github::environment();
        for (key, path) in [
            ("HOME", &self.snapshot.home),
            ("USERPROFILE", &self.snapshot.home),
            ("GH_CONFIG_DIR", &self.snapshot.home),
            ("TMP", &self.snapshot.temporary),
            ("TEMP", &self.snapshot.temporary),
        ] {
            environment.push((key.into(), path.as_os_str().to_owned()));
        }
        // Obtain system paths from the OS, never inherited environment/config.
        let mut system = [0u16; 32768];
        let length = unsafe {
            ::windows::Win32::System::SystemInformation::GetSystemDirectoryW(Some(&mut system))
        } as usize;
        if length == 0 || length >= system.len() {
            return Err(Failure::GitHubUnavailable);
        }
        use std::os::windows::ffi::OsStringExt;
        let system = PathBuf::from(OsString::from_wide(&system[..length]));
        environment.push(("PATH".into(), system.as_os_str().to_owned()));
        environment.push((
            "SystemRoot".into(),
            system
                .parent()
                .ok_or(Failure::GitHubUnavailable)?
                .as_os_str()
                .to_owned(),
        ));
        let result = super::windows::run_prepared(
            &self.snapshot,
            &self.executable,
            &arguments,
            environment,
            &self.profile,
            cancelled,
        )
        .await?;
        super::windows::Profile::verify_socket(self.endpoint.as_ref().ok_or(Failure::Storage)?)?;
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ordinary_file_cannot_receive_socket_exception() {
        let snapshot = Snapshot::read_only(Default::default()).unwrap();
        let path = snapshot.root.join("broker.sock");
        std::fs::write(&path, b"inert regular file").unwrap();
        let file = File::open(&path).unwrap();
        assert!(super::super::windows::Profile::verify_socket(&file).is_err());
    }
    #[tokio::test]
    #[ignore = "Physical Windows gh/LPAC/AF_UNIX qualification with the packaged pinned image; no remote requests"]
    async fn native_windows_github_exact_socket_returns_captured_fixture() {
        let installed = std::env::current_exe().unwrap();
        let image = installed
            .parent()
            .unwrap()
            .join("work-runtime/gh-2.96.0/gh.exe");
        let mut runtime = Runtime::prepare_image(&image).unwrap();
        let listener = super::super::github::socket::Listener::bind(&runtime.socket).unwrap();
        runtime.grant_socket().unwrap();
        let halted = std::sync::atomic::AtomicBool::new(false);
        let broker = super::super::github::serve(listener, 1, "inert-fixture", &halted, || async {
            Ok(br#"{"title":"Inert public fixture"}"#.to_vec())
        });
        let child = runtime.run("inert-fixture", &|| async { false });
        let (body, output) = tokio::join!(broker, child);
        let output = output.unwrap();
        assert!(output.success);
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&output.text).unwrap(),
            body.unwrap()
        );
        assert!(
            super::super::windows::Profile::verify_socket(runtime.endpoint.as_ref().unwrap())
                .is_ok()
        );
        // This test does not authorize production: the platform gate stays closed
        // until the separate denial, Stop, cleanup and packaging matrix qualifies.
        assert!(!super::super::github::available());
    }
}
