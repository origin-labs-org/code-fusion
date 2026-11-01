//! A checked private copy of one gh image, with only an exact local socket.
use super::{Failure, Output, Snapshot};
use sha2::{Digest, Sha256};
use std::{
    ffi::OsString,
    future::Future,
    io::{Read, Write},
    os::unix::fs::{MetadataExt, OpenOptionsExt},
    path::{Path, PathBuf},
};
const IMAGE: &str = "/opt/homebrew/Cellar/gh/2.96.0/bin/gh";
const IMAGE_BYTES: u64 = 38_299_474;
const IMAGE_DIGEST: &str = "02d2d4a85241c6a8c0b77ebb1ec76fc723caf7fb128e00915b306b968847cba1";
pub(super) struct Runtime {
    pub snapshot: Snapshot,
    executable: PathBuf,
    pub socket: PathBuf,
}
pub(super) fn present() -> bool {
    super::macos::qualified() && Path::new(IMAGE).is_file()
}
impl Runtime {
    pub fn prepare_checked(check: &dyn Fn() -> Result<(), Failure>) -> Result<Self, Failure> {
        check()?;
        if !super::macos::qualified() {
            return Err(Failure::GitHubUnavailable);
        }
        // Never follow Homebrew's public symlink or execute a mutable source
        // pathname. No-follow reads plus digest verification admit only this image.
        let mut input = crate::work_files::open_unix(Path::new(IMAGE), false)
            .map_err(|_| Failure::GitHubUnavailable)?;
        let meta = input.metadata().map_err(|_| Failure::GitHubUnavailable)?;
        if !meta.is_file() || meta.nlink() != 1 || meta.len() != IMAGE_BYTES {
            return Err(Failure::GitHubUnavailable);
        }
        let snapshot = Snapshot::read_only_checked(Default::default(), check)?;
        let prepared = (|| -> Result<(PathBuf, PathBuf), Failure> {
            let executable = snapshot.root.join("gh");
            let mut output = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o500)
                .open(&executable)
                .map_err(|_| Failure::Storage)?;
            let mut digest = Sha256::new();
            let mut total = 0u64;
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
            let mut bytes = [0u8; 64 * 1024];
            loop {
                check()?;
                if std::time::Instant::now() >= deadline {
                    return Err(Failure::Limit);
                }
                let got = input
                    .read(&mut bytes)
                    .map_err(|_| Failure::GitHubUnavailable)?;
                if got == 0 {
                    break;
                }
                total = total.checked_add(got as u64).ok_or(Failure::Limit)?;
                if total > IMAGE_BYTES {
                    return Err(Failure::GitHubUnavailable);
                }
                digest.update(&bytes[..got]);
                output
                    .write_all(&bytes[..got])
                    .map_err(|_| Failure::Storage)?;
            }
            if total != IMAGE_BYTES
                || format!("{:x}", digest.finalize()) != IMAGE_DIGEST
                || input
                    .metadata()
                    .map_err(|_| Failure::GitHubUnavailable)?
                    .nlink()
                    != 1
            {
                return Err(Failure::GitHubUnavailable);
            }
            output.sync_all().map_err(|_| Failure::Storage)?;
            let socket = snapshot.root.join("broker.sock");
            super::github::write_config(&snapshot.home, &socket)?;
            check()?;
            Ok((executable, socket))
        })();
        let (executable, socket) = match prepared {
            Ok(value) => value,
            Err(error) => {
                snapshot.close()?;
                return Err(error);
            }
        };
        Ok(Self {
            snapshot,
            executable,
            socket,
        })
    }
    pub fn close(self) -> Result<(), Failure> {
        self.snapshot.close()
    }
    pub async fn run_custodied<C, CF, S>(
        &self,
        nonce: &str,
        cancelled: &C,
        spawned: S,
    ) -> Result<Output, Failure>
    where
        C: Fn() -> CF,
        CF: Future<Output = bool>,
        S: FnOnce(u32, Option<u64>),
    {
        super::macos::monitor_single_custodied(cancelled, || {
            let child = self.process(nonce)?;
            spawned(child.id(), child.instance());
            Ok(child)
        })
        .await
    }
    fn process(&self, nonce: &str) -> Result<super::macos_spawn::Child, Failure> {
        self.process_arguments(&[
            "api".into(),
            "--method".into(),
            "GET".into(),
            format!("http://127.0.0.1:1/{nonce}").into(),
        ])
    }
    fn process_arguments(
        &self,
        command: &[OsString],
    ) -> Result<super::macos_spawn::Child, Failure> {
        let mut arguments = Vec::<OsString>::new();
        for (key, value) in [
            ("TOOL", self.executable.as_os_str()),
            ("WORK", self.snapshot.root.as_os_str()),
            ("BROKER", self.socket.as_os_str()),
        ] {
            let mut parameter = OsString::from(key);
            parameter.push("=");
            parameter.push(value);
            arguments.extend(["-D".into(), parameter]);
        }
        arguments.extend([
            "-p".into(),
            PROFILE.into(),
            "--".into(),
            self.executable.as_os_str().to_owned(),
        ]);
        arguments.extend_from_slice(command);
        let mut environment = super::github::environment();
        for (key, path) in [
            ("HOME", &self.snapshot.home),
            ("GH_CONFIG_DIR", &self.snapshot.home),
            ("TMPDIR", &self.snapshot.temporary),
        ] {
            environment.push((key.into(), path.as_os_str().to_owned()));
        }
        super::macos_spawn::spawn(&self.snapshot.work, &arguments, &environment)
    }
}
pub(super) const PROFILE: &str = r#"(version 1)
(deny default)
(allow process-exec (literal (param "TOOL")))
(allow process-info* (target self))
(allow sysctl-read (sysctl-name "hw.pagesize_compat"))
(allow file-map-executable (literal (param "TOOL")) (subpath "/System/Library") (subpath "/usr/lib"))
(allow file-read* (subpath "/System/Library") (subpath "/usr/lib") (subpath "/usr/share/locale") (subpath "/Library/Apple/System/Library") (subpath (param "WORK")))
(allow file-read-metadata (literal "/") (literal "/System") (literal "/usr") (literal "/usr/share") (literal "/Library") (literal "/Library/Apple") (literal "/Library/Apple/System") (literal "/private") (literal "/private/tmp"))
(allow file-read-data (literal "/"))
(allow file-read-data file-write-data (literal "/dev/null"))
(allow file-read-data (literal "/dev/urandom") (literal "/dev/random"))
(allow network-outbound (literal (param "BROKER")))
"#;

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, process::Stdio};
    use tokio::net::TcpListener;

    fn helper() -> Runtime {
        let snapshot = Snapshot::read_only(Default::default()).unwrap();
        let source = snapshot.root.join("deny.c");
        let executable = snapshot.root.join("deny-fixture");
        fs::write(&source, include_str!("fixtures/deny.c")).unwrap();
        assert!(std::process::Command::new("/usr/bin/clang")
            .args(["--no-default-config", "-O0", "-o"])
            .arg(&executable)
            .arg(source)
            .env_clear()
            .env("PATH", "/usr/bin:/bin")
            .env("TMPDIR", &snapshot.temporary)
            .env("HOME", &snapshot.home)
            .env("XDG_CONFIG_HOME", &snapshot.home)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .unwrap()
            .success());
        Runtime {
            socket: snapshot.root.join("broker.sock"),
            snapshot,
            executable,
        }
    }
    async fn check(runtime: &Runtime, _port: u16, operation: &str, argument: &Path) -> String {
        let arguments = [operation.into(), argument.as_os_str().to_owned()];
        let output = super::super::macos::monitor(&|| async { false }, false, || {
            runtime.process_arguments(&arguments)
        })
        .await
        .unwrap();
        assert!(output.success);
        output.text.trim().to_owned()
    }
    #[tokio::test]
    #[ignore = "Native gh profile denial matrix: open-only helpers, no private payloads or directory names"]
    async fn native_github_profile_denies_private_roots_aliases_writes_forks_and_other_network() {
        let runtime = helper();
        let allowed = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = allowed.local_addr().unwrap().port();
        let other = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let outside = tempfile::Builder::new()
            .prefix("work-gh-outside-")
            .tempdir_in("/private/tmp")
            .unwrap();
        let outside = outside.path().canonicalize().unwrap();
        for (index, suffix) in [
            ".ssh",
            "Library/Keychains",
            ".aws",
            ".config/gh",
            "other-user",
        ]
        .into_iter()
        .enumerate()
        {
            let target = outside.join(suffix);
            fs::create_dir_all(&target).unwrap();
            assert_eq!(check(&runtime, port, "list", &target).await, "denied");
            let alias = runtime.snapshot.work.join(format!("alias-{index}"));
            std::os::unix::fs::symlink(&target, &alias).unwrap();
            assert_eq!(check(&runtime, port, "list", &alias).await, "denied");
        }
        let home = PathBuf::from(std::env::var_os("HOME").unwrap());
        let mut denied = 0;
        let mut missing = 0;
        for (index, target) in [
            PathBuf::from("/Users"),
            home.clone(),
            home.join(".ssh"),
            home.join("Library/Keychains"),
            home.join(".aws"),
            home.join(".config/gh"),
            PathBuf::from("/Users/Guest"),
            PathBuf::from("/Volumes"),
            PathBuf::from("/private/var/folders"),
        ]
        .into_iter()
        .enumerate()
        {
            if !target.try_exists().unwrap_or(false) {
                missing += 1;
                continue;
            }
            assert_eq!(check(&runtime, port, "list", &target).await, "denied");
            denied += 1;
            let alias = runtime.snapshot.work.join(format!("private-alias-{index}"));
            std::os::unix::fs::symlink(&target, &alias).unwrap();
            assert_eq!(check(&runtime, port, "list", &alias).await, "denied");
        }
        eprintln!(
            "existing_private_roots_denied={denied}; missing_private_roots_not_counted={missing}"
        );
        assert!(denied >= 4);
        for destination in [
            runtime.snapshot.work.join("write.txt"),
            outside.join("write.txt"),
        ] {
            assert_eq!(
                check(&runtime, port, "create", &destination).await,
                "denied"
            );
            assert!(!destination.exists());
        }
        for operation in ["fork", "spawn", "double-fork"] {
            assert_eq!(
                check(&runtime, port, operation, Path::new("unused")).await,
                "denied"
            );
        }
        assert_eq!(
            check(
                &runtime,
                port,
                "network",
                Path::new(&other.local_addr().unwrap().port().to_string())
            )
            .await,
            "denied"
        );
        assert_eq!(
            check(&runtime, port, "network-external", Path::new("unused")).await,
            "denied"
        );
        assert_eq!(
            check(&runtime, port, "network", Path::new(&port.to_string())).await,
            "denied"
        );
        let local = super::super::github::socket::Listener::bind(&runtime.socket).unwrap();
        assert_eq!(
            check(&runtime, port, "unix", &runtime.socket).await,
            "opened"
        );
        let _ = local.accept().await.unwrap();
        let adjacent = runtime.snapshot.root.join("other.sock");
        let _other_socket = super::super::github::socket::Listener::bind(&adjacent).unwrap();
        assert_eq!(check(&runtime, port, "unix", &adjacent).await, "denied");
        use std::os::fd::AsRawFd;
        let inherited_path = outside.join("descriptor.txt");
        fs::write(&inherited_path, b"inert descriptor").unwrap();
        let inherited = fs::File::open(&inherited_path).unwrap();
        assert_eq!(
            unsafe { libc::fcntl(inherited.as_raw_fd(), libc::F_SETFD, 0) },
            0
        );
        assert_eq!(
            check(
                &runtime,
                port,
                "fd",
                Path::new(&inherited.as_raw_fd().to_string())
            )
            .await,
            "closed"
        );
        assert_eq!(
            check(&runtime, port, "environment", Path::new("unused")).await,
            "absent"
        );
    }
}
