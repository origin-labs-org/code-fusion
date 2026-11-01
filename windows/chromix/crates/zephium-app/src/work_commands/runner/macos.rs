//! Version-qualified Seatbelt backend. A denied/missing sandbox never falls back.
use super::{Failure, GitOperation, Output, Snapshot};
use std::{
    ffi::{CString, OsString},
    future::Future,
    path::{Path, PathBuf},
    time::Duration,
};
use tokio::io::AsyncReadExt;

const OUTPUT_LIMIT: usize = 64 * 1024;
const DEADLINE: Duration = Duration::from_secs(15);
const PROFILE: &str = r#"(version 1)
(deny default)
(allow process-exec (literal (param "TOOL")))
(allow process-info* (target self))
(allow file-map-executable (literal (param "TOOL")) (subpath "/System/Library") (subpath "/usr/lib"))
(allow file-read-data (literal "/"))
(allow file-read* (subpath "/System/Library") (subpath "/usr/lib")
  (subpath "/usr/share/locale") (subpath "/Library/Apple/System/Library")
  (literal (param "TOOL")) (subpath (param "WORK")))
(allow file-read-metadata (literal "/") (literal "/System") (literal "/usr")
  (literal "/usr/share") (literal "/Library") (literal "/Library/Apple")
  (literal "/Library/Apple/System") (literal "/private") (literal "/private/tmp"))
(allow file-read-data file-write-data (literal "/dev/null"))
(allow file-read-data (literal "/dev/urandom") (literal "/dev/random"))
(allow file-write* (subpath (param "META")) (subpath (param "TEMP")))
"#;

pub(super) fn qualified() -> bool {
    // Populated only after the actual native denial matrix is reviewed. A new
    // macOS build or CPU architecture must not inherit another native qualification.
    const BUILDS: &[&str] = &["25G83"];
    cfg!(target_arch = "aarch64")
        && os_build().is_some_and(|build| BUILDS.contains(&build.as_str()))
}
fn os_build() -> Option<String> {
    let key = CString::new("kern.osversion").ok()?;
    let mut value = [0u8; 128];
    let mut size = value.len();
    if unsafe {
        libc::sysctlbyname(
            key.as_ptr(),
            value.as_mut_ptr().cast(),
            &mut size,
            std::ptr::null_mut(),
            0,
        )
    } != 0
        || size == 0
        || size > value.len()
    {
        return None;
    }
    std::str::from_utf8(&value[..size.saturating_sub(1)])
        .ok()
        .map(str::to_owned)
}
fn git_binary() -> Result<PathBuf, Failure> {
    // Never execute Apple's install-prompt stub, PATH, or a repository tool.
    for name in [
        "/Library/Developer/CommandLineTools/usr/bin/git",
        "/Applications/Xcode.app/Contents/Developer/usr/bin/git",
    ] {
        let path = Path::new(name);
        if path.is_file() {
            return path.canonicalize().map_err(|_| Failure::Launch);
        }
    }
    Err(Failure::ToolUnavailable)
}

#[cfg(test)]
pub(super) async fn git<C, CF>(
    snapshot: &Snapshot,
    operation: GitOperation,
    cancelled: &C,
) -> Result<Output, Failure>
where
    C: Fn() -> CF,
    CF: Future<Output = bool>,
{
    run(
        snapshot,
        &git_binary()?,
        &operation.arguments(snapshot),
        cancelled,
    )
    .await
}

fn process(
    snapshot: &Snapshot,
    program: &Path,
    args: &[OsString],
) -> Result<super::macos_spawn::Child, Failure> {
    let metadata = snapshot.work.join(".git");
    let mut arguments = Vec::new();
    for (key, value) in [
        ("TOOL", program),
        ("WORK", snapshot.root.as_path()),
        ("META", metadata.as_path()),
        ("TEMP", snapshot.temporary.as_path()),
    ] {
        let mut parameter = OsString::from(key);
        parameter.push("=");
        parameter.push(value);
        arguments.push("-D".into());
        arguments.push(parameter);
    }
    arguments.extend([
        "-p".into(),
        PROFILE.into(),
        "--".into(),
        program.as_os_str().to_owned(),
    ]);
    arguments.extend_from_slice(args);
    let mut environment: Vec<(OsString, OsString)> = [
        ("GIT_CONFIG_NOSYSTEM", "1"),
        ("GIT_CONFIG_GLOBAL", "/dev/null"),
        ("GIT_TERMINAL_PROMPT", "0"),
        ("GIT_OPTIONAL_LOCKS", "0"),
        ("GIT_ATTR_NOSYSTEM", "1"),
        ("GIT_AUTHOR_DATE", "2000-01-01T00:00:00Z"),
        ("GIT_COMMITTER_DATE", "2000-01-01T00:00:00Z"),
        ("TZ", "UTC"),
        ("LC_ALL", "C"),
        ("LANG", "C"),
        ("NO_COLOR", "1"),
        ("CI", "1"),
        ("TERM", "dumb"),
    ]
    .into_iter()
    .map(|(key, value)| (key.into(), value.into()))
    .collect();
    environment.extend([
        ("HOME".into(), snapshot.home.as_os_str().to_owned()),
        ("TMPDIR".into(), snapshot.temporary.as_os_str().to_owned()),
        (
            "XDG_CONFIG_HOME".into(),
            snapshot.home.as_os_str().to_owned(),
        ),
    ]);
    super::macos_spawn::spawn(&snapshot.work, &arguments, &environment)
}

pub(super) async fn git_custodied<C, CF, S>(
    snapshot: &Snapshot,
    operation: GitOperation,
    cancelled: &C,
    spawned: S,
) -> Result<Output, Failure>
where
    C: Fn() -> CF,
    CF: Future<Output = bool>,
    S: FnOnce(u32, Option<u64>),
{
    let program = git_binary()?;
    let arguments = operation.arguments(snapshot);
    // The monitor's15-second clock starts before this spawn/status callback.
    // It retains exact child ownership through reap, even after parent EOF.
    monitor_mode(cancelled, false, true, None::<fn(u32)>, || {
        let child = process(snapshot, &program, &arguments)?;
        spawned(child.id(), child.instance());
        Ok(child)
    })
    .await
}

#[cfg(test)]
async fn run<C, CF>(
    snapshot: &Snapshot,
    program: &Path,
    args: &[OsString],
    cancelled: &C,
) -> Result<Output, Failure>
where
    C: Fn() -> CF,
    CF: Future<Output = bool>,
{
    monitor(cancelled, false, || process(snapshot, program, args)).await
}

pub(super) async fn monitor<C, CF>(
    cancelled: &C,
    include_errors: bool,
    spawn: impl FnOnce() -> Result<super::macos_spawn::Child, Failure>,
) -> Result<Output, Failure>
where
    C: Fn() -> CF,
    CF: Future<Output = bool>,
{
    monitor_mode(cancelled, include_errors, false, None::<fn(u32)>, spawn).await
}
pub(super) const PYTHON_READY: &[u8] = b"\0ZEPHIUM-PYTHON-SEALED-V1\0";
pub(super) async fn monitor_custodied<C, CF, S>(
    cancelled: &C,
    spawn: impl FnOnce() -> Result<super::macos_spawn::Child, Failure>,
    sealed: S,
) -> Result<Output, Failure>
where
    C: Fn() -> CF,
    CF: Future<Output = bool>,
    S: FnOnce(u32),
{
    monitor_mode(cancelled, true, true, Some(sealed), spawn).await
}
fn ready_prefix(output: &mut Vec<u8>, eof: bool) -> Result<bool, Failure> {
    if output.len() < PYTHON_READY.len() {
        return if !eof && PYTHON_READY.starts_with(output) {
            Ok(false)
        } else {
            Err(Failure::Failed)
        };
    }
    if !output.starts_with(PYTHON_READY) {
        return Err(Failure::Failed);
    }
    output.drain(..PYTHON_READY.len());
    Ok(true)
}
async fn monitor_mode<C, CF, S>(
    cancelled: &C,
    include_errors: bool,
    retain_custody: bool,
    mut sealed: Option<S>,
    spawn: impl FnOnce() -> Result<super::macos_spawn::Child, Failure>,
) -> Result<Output, Failure>
where
    C: Fn() -> CF,
    CF: Future<Output = bool>,
    S: FnOnce(u32),
{
    if super::cancellation_requested(cancelled).await {
        return Err(Failure::Stopped);
    }
    let expires = tokio::time::Instant::now() + DEADLINE;
    let (mut child, mut group) = crate::work_commands::groups::Group::launch(
        || {
            let child = spawn()?;
            let id = child.id();
            Ok((child, id))
        },
        Failure::Stopped,
    )?;
    let child_id = child.id();
    let mut stdout = child.stdout.take().ok_or(Failure::Launch)?;
    let mut stderr = child.stderr.take().ok_or(Failure::Launch)?;
    let mut output = Vec::new();
    let mut errors = Vec::new();
    let mut out = [0u8; 8192];
    let mut err = [0u8; 8192];
    let mut out_open = true;
    let mut err_open = true;
    let mut status = None;
    let deadline = tokio::time::sleep_until(expires);
    tokio::pin!(deadline);
    let mut tick = tokio::time::interval(Duration::from_millis(50));
    let failure = loop {
        tokio::select! {
            value = stdout.read(&mut out), if out_open => match value {
                Ok(0) => out_open=false, Ok(n) => output.extend_from_slice(&out[..n]), Err(_) => break Some(Failure::Failed)
            },
            value = stderr.read(&mut err), if err_open => match value {
                Ok(0) => err_open=false, Ok(n) => errors.extend_from_slice(&err[..n]), Err(_) => break Some(Failure::Failed)
            },
            _ = &mut deadline => break Some(Failure::Stopped),
            _ = tick.tick() => {
                if group.quitting() || super::cancellation_requested(cancelled).await { break Some(Failure::Stopped); }
                if status.is_none() {
                    match group.poll_single_process(|| child.poll()) {
                        Ok(value) => status = value,
                        Err(_) => break Some(Failure::StopUnconfirmed),
                    }
                }
            }
        }
        if sealed.is_some() {
            match ready_prefix(&mut output, !out_open) {
                Ok(true) => {
                    let report = sealed.take().expect("one fixed ready prefix");
                    if status.is_none() {
                        report(child_id);
                    }
                }
                Ok(false) => {}
                Err(error) => break Some(error),
            }
        }
        // No later project output can attest readiness or expose the private
        // bootstrap marker as model evidence. All output remains held.
        if retain_custody
            && sealed.is_none()
            && [output.as_slice(), errors.as_slice()].iter().any(|stream| {
                stream
                    .windows(PYTHON_READY.len())
                    .any(|bytes| bytes == PYTHON_READY)
            })
        {
            break Some(Failure::Failed);
        }
        if output.len() + errors.len() > OUTPUT_LIMIT {
            break Some(Failure::Limit);
        }
        if status.is_some() && !out_open && !err_open {
            break None;
        }
    };
    // Fork is denied by the profile. Kill the owned group on every unsettled exit,
    // and wait boundedly so cancellation does not depend on cooperative shutdown.
    let failure = failure.or_else(|| group.quitting().then_some(Failure::Stopped));
    if let Some(failure) = failure {
        group.signal(libc::SIGKILL);
        let settling = async {
            loop {
                if group
                    .poll_single_process(|| child.poll())
                    .ok()
                    .flatten()
                    .is_some()
                {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        };
        if retain_custody {
            // This standalone guard is the final native owner. Its host may
            // stop waiting, but no cleanup acknowledgement or process exit can
            // abandon an unsettled child. ECHILD stays unknown, never PID-killed.
            settling.await;
            return Err(failure);
        }
        let settled = tokio::time::timeout(Duration::from_millis(300), settling).await;
        return Err(if settled.is_ok() {
            failure
        } else {
            Failure::StopUnconfirmed
        });
    }
    let success = status.is_some_and(|status| status.success());
    if include_errors && !errors.is_empty() {
        if output.len() + errors.len() + 10 > OUTPUT_LIMIT {
            return Err(Failure::Limit);
        }
        if !output.is_empty() {
            output.extend_from_slice(b"\n[stderr]\n");
        }
        output.extend_from_slice(&errors);
    }
    // A native diagnostic is not model evidence: it may contain attempted paths.
    if !success && output.is_empty() {
        return Err(Failure::Failed);
    }
    let text = super::output_text(output)?;
    Ok(Output {
        text,
        success,
        exit: status.and_then(|status| status.code()).unwrap_or(-1),
    })
}

pub(super) async fn monitor_single_custodied<C, CF>(
    cancelled: &C,
    spawn: impl FnOnce() -> Result<super::macos_spawn::Child, Failure>,
) -> Result<Output, Failure>
where
    C: Fn() -> CF,
    CF: Future<Output = bool>,
{
    monitor_mode(cancelled, false, true, None::<fn(u32)>, spawn).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Stdio;
    #[test]
    fn guard_readiness_requires_one_exact_bounded_first_prefix() {
        let mut partial = PYTHON_READY[..5].to_vec();
        assert_eq!(ready_prefix(&mut partial, false), Ok(false));
        assert_eq!(ready_prefix(&mut partial, true), Err(Failure::Failed));
        assert_eq!(
            ready_prefix(&mut b"project text".to_vec(), false),
            Err(Failure::Failed)
        );
        let mut bytes = PYTHON_READY.to_vec();
        bytes.extend_from_slice(b"project output");
        assert_eq!(ready_prefix(&mut bytes, false), Ok(true));
        assert_eq!(bytes, b"project output");
    }

    #[tokio::test]
    #[ignore = "Native cancellation qualification with an intentionally pending host query"]
    async fn native_pending_cancellation_query_is_bounded_after_launch() {
        let snapshot = Snapshot::fixture(&[]);
        let helper = helper(&snapshot);
        let ready = snapshot.work.join(".git/ready");
        let requested = std::sync::Mutex::new(None::<std::time::Instant>);
        let cancel = || async {
            if !ready.exists() {
                false
            } else {
                requested
                    .lock()
                    .unwrap()
                    .get_or_insert_with(std::time::Instant::now);
                std::future::pending::<bool>().await
            }
        };
        let result = run(
            &snapshot,
            &helper,
            &["hold".into(), ready.as_os_str().to_owned()],
            &cancel,
        )
        .await;
        assert!(matches!(result, Err(Failure::Stopped)));
        assert!(
            ready.exists(),
            "the callback stalls after the native process starts"
        );
        assert!(
            requested
                .lock()
                .unwrap()
                .expect("query stalled after ready")
                .elapsed()
                < Duration::from_secs(1)
        );
    }

    #[tokio::test]
    #[ignore = "Native Seatbelt qualification uses inert private copies; run explicitly"]
    async fn native_git_operates_only_on_generated_snapshot_index() {
        let snapshot = Snapshot::fixture(&[
            ("notes.txt", b"baseline\n"),
            ("src/main.rs", b"fn main() {}\n"),
        ]);
        let cancelled = || async { false };
        for operation in [
            GitOperation::Initialize,
            GitOperation::CaptureIndex,
            GitOperation::CommitBaseline,
        ] {
            assert!(git(&snapshot, operation, &cancelled).await.unwrap().success);
        }
        let result = git(
            &snapshot,
            GitOperation::Read(super::super::ReadOperation::Files),
            &cancelled,
        )
        .await
        .unwrap();
        assert_eq!(result.text, "notes.txt\nsrc/main.rs\n");
        snapshot
            .write(Path::new("notes.txt"), b"approved copy change\n")
            .unwrap();
        let result = git(
            &snapshot,
            GitOperation::Read(super::super::ReadOperation::Status),
            &cancelled,
        )
        .await
        .unwrap();
        assert_eq!(result.text, " M notes.txt\n");
        let result = git(
            &snapshot,
            GitOperation::Read(super::super::ReadOperation::Diff),
            &cancelled,
        )
        .await
        .unwrap();
        assert!(result.text.contains("-baseline") && result.text.contains("+approved copy change"));
    }

    #[tokio::test]
    #[ignore = "Native Seatbelt qualification reads only an inert outside sentinel"]
    async fn native_policy_denies_outside_read_and_write_and_source_write() {
        let outside = tempfile::tempdir().unwrap();
        let sentinel = outside.path().join("sentinel.txt");
        std::fs::write(&sentinel, "inert outside marker").unwrap();
        let snapshot = Snapshot::fixture(&[("notes.txt", b"inert inside marker\n")]);
        let cancelled = || async { false };
        let allowed = run(
            &snapshot,
            Path::new("/bin/cat"),
            &[snapshot.work.join("notes.txt").into_os_string()],
            &cancelled,
        )
        .await
        .unwrap();
        assert_eq!(allowed.text, "inert inside marker\n");
        assert!(run(
            &snapshot,
            Path::new("/bin/cat"),
            &[sentinel.clone().into_os_string()],
            &cancelled
        )
        .await
        .is_err());
        for target in [sentinel.clone(), snapshot.work.join("notes.txt")] {
            assert!(run(
                &snapshot,
                Path::new("/usr/bin/touch"),
                &[target.into_os_string()],
                &cancelled
            )
            .await
            .is_err());
        }
        assert_eq!(
            std::fs::read_to_string(sentinel).unwrap(),
            "inert outside marker"
        );
        assert_eq!(
            std::fs::read_to_string(snapshot.work.join("notes.txt")).unwrap(),
            "inert inside marker\n"
        );
    }

    fn helper(snapshot: &Snapshot) -> PathBuf {
        let source = snapshot.root.join("deny.c");
        let program = snapshot.root.join("deny-fixture");
        std::fs::write(&source, include_str!("fixtures/deny.c")).unwrap();
        let status = std::process::Command::new("/usr/bin/clang")
            .args(["--no-default-config", "-O0", "-o"])
            .arg(&program)
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
            .unwrap();
        assert!(
            status.success(),
            "inert denial helper must compile before qualification"
        );
        program
    }

    async fn assertion(snapshot: &Snapshot, helper: &Path, operation: &str, path: &Path) -> String {
        let result = run(
            snapshot,
            helper,
            &[operation.into(), path.as_os_str().to_owned()],
            &|| async { false },
        )
        .await
        .unwrap();
        assert!(result.success);
        result.text.trim().to_owned()
    }

    #[tokio::test]
    #[ignore = "Native read-denial probes open only; no payloads, names or private values are consumed"]
    async fn native_private_roots_and_granted_symlinks_are_denied() {
        use std::os::unix::fs::symlink;
        let snapshot = Snapshot::fixture(&[("ordinary.txt", b"inert fixture")]);
        let helper = helper(&snapshot);
        let home = PathBuf::from(
            std::env::var_os("HOME").expect("qualification requires an existing home"),
        );
        let paths = vec![
            ("Users", PathBuf::from("/Users"), "list"),
            ("home", home.clone(), "list"),
            ("Volumes", PathBuf::from("/Volumes"), "list"),
            (
                "private-var-folders",
                PathBuf::from("/private/var/folders"),
                "list",
            ),
            ("ssh", home.join(".ssh"), "open"),
            ("Keychains", home.join("Library/Keychains"), "open"),
            ("aws", home.join(".aws"), "open"),
            ("gh", home.join(".config/gh"), "open"),
            // A known shared home is an existing outside-home directory; no
            // account enumeration or directory contents are read by this test.
            ("shared-home", PathBuf::from("/Users/Shared"), "list"),
            (
                "other-home",
                PathBuf::from("/Users/zephium-absent-fixture-user"),
                "list",
            ),
        ];
        assert_eq!(
            assertion(
                &snapshot,
                &helper,
                "open",
                &snapshot.work.join("ordinary.txt")
            )
            .await,
            "opened"
        );
        let mut missing = Vec::new();
        for (index, (label, path, operation)) in paths.iter().enumerate() {
            let direct = assertion(&snapshot, &helper, operation, path).await;
            if direct == "missing" {
                assert!(
                    !path.try_exists().unwrap_or(true),
                    "missing is not a permission-denial pass"
                );
                missing.push(*label);
            } else {
                assert_eq!(direct, "denied", "case {label}");
            }
            let link = snapshot.work.join(format!("link-{index}"));
            symlink(path, &link).unwrap();
            let through_link = assertion(&snapshot, &helper, operation, &link).await;
            assert_eq!(through_link, direct, "symlink case {label}");
        }
        // Existing inert targets establish denial independently of a user's
        // optional credentials/account directories. Missing real targets remain
        // explicitly absent from the native-denial evidence count above.
        let outside = tempfile::tempdir().unwrap();
        for (index, relative) in [
            "home/.ssh",
            "home/Library/Keychains",
            "home/.aws",
            "home/.config/gh",
            "other-home",
        ]
        .iter()
        .enumerate()
        {
            let path = outside.path().join(relative);
            std::fs::create_dir_all(&path).unwrap();
            std::fs::write(path.join("inert.txt"), "inert fixture").unwrap();
            assert_eq!(assertion(&snapshot, &helper, "list", &path).await, "denied");
            assert_eq!(
                assertion(&snapshot, &helper, "open", &path.join("inert.txt")).await,
                "denied"
            );
            let link = snapshot.work.join(format!("inert-link-{index}"));
            symlink(path, &link).unwrap();
            assert_eq!(assertion(&snapshot, &helper, "list", &link).await, "denied");
        }
        eprintln!("native protected-root denial cases: {}; absent targets (not denial passes): {missing:?}; inert protected-root cases: 5", paths.len() - missing.len());
    }

    #[tokio::test]
    #[ignore = "Native no-network/fork/output/Stop fixtures use only private scratch and loopback"]
    async fn native_resource_and_authority_bounds() {
        let snapshot = Snapshot::fixture(&[]);
        let helper = helper(&snapshot);
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port().to_string();
        let cancelled = || async { false };
        for (args, expected) in [
            (vec!["network".into(), port.into()], "denied\n"),
            (vec!["fork".into()], "denied\n"),
            (vec!["spawn".into()], "denied\n"),
            (vec!["double-fork".into()], "denied\n"),
            (vec!["environment".into()], "absent\n"),
        ] {
            let result = run(&snapshot, &helper, &args, &cancelled).await.unwrap();
            assert!(result.success);
            assert_eq!(result.text, expected);
        }
        let outside = tempfile::tempdir().unwrap();
        assert_eq!(
            assertion(
                &snapshot,
                &helper,
                "create",
                &outside.path().join("not-created")
            )
            .await,
            "denied"
        );
        assert!(!outside.path().join("not-created").exists());
        assert!(matches!(
            run(&snapshot, &helper, &["flood".into()], &cancelled).await,
            Err(Failure::Limit)
        ));
        let ready = snapshot.work.join(".git/ready");
        let stopped = std::sync::Mutex::new(None::<std::time::Instant>);
        let cancel = || async {
            if ready.exists() {
                stopped
                    .lock()
                    .unwrap()
                    .get_or_insert_with(std::time::Instant::now);
                true
            } else {
                false
            }
        };
        assert!(matches!(
            run(
                &snapshot,
                &helper,
                &["hold".into(), ready.as_os_str().to_owned()],
                &cancel
            )
            .await,
            Err(Failure::Stopped)
        ));
        assert!(
            stopped
                .lock()
                .unwrap()
                .expect("fixture reached running state")
                .elapsed()
                < Duration::from_secs(1)
        );
    }

    #[tokio::test]
    #[ignore = "Native same-owner group-change/Stop fixture, only inert scratch"]
    async fn native_stop_does_not_depend_on_group_membership() {
        let snapshot = Snapshot::fixture(&[]);
        let helper = helper(&snapshot);
        let ready = snapshot.work.join(".git/session-ready");
        let requested = std::sync::Mutex::new(None::<std::time::Instant>);
        let cancel = || async {
            if std::fs::read_to_string(&ready)
                .is_ok_and(|value| matches!(value.as_str(), "moved" | "denied"))
            {
                requested
                    .lock()
                    .unwrap()
                    .get_or_insert_with(std::time::Instant::now);
                true
            } else {
                false
            }
        };
        let original_group = unsafe { libc::getpgrp() }.to_string();
        let result = run(
            &snapshot,
            &helper,
            &[
                "group-hold".into(),
                ready.as_os_str().to_owned(),
                original_group.into(),
            ],
            &cancel,
        )
        .await;
        assert!(matches!(result, Err(Failure::Stopped)));
        let state = std::fs::read_to_string(&ready).unwrap();
        assert_eq!(
            state, "moved",
            "the fixture must leave its initial process group"
        );
        eprintln!("final_group_change={state}");
        assert!(requested.lock().unwrap().unwrap().elapsed() < Duration::from_secs(1));
    }

    #[tokio::test]
    #[ignore = "Native owned-child drop proof, only inert scratch"]
    async fn native_dropped_child_settles_after_group_change() {
        let snapshot = Snapshot::fixture(&[]);
        let helper = helper(&snapshot);
        let ready = snapshot.work.join(".git/drop-ready");
        let args = [
            "group-hold".into(),
            ready.as_os_str().to_owned(),
            unsafe { libc::getpgrp() }.to_string().into(),
        ];
        let mut child = process(&snapshot, &helper, &args).unwrap();
        let mut stdout = child.stdout.take().unwrap();
        tokio::time::timeout(Duration::from_secs(5), async {
            while !std::fs::read_to_string(&ready)
                .is_ok_and(|value| matches!(value.as_str(), "moved" | "denied"))
            {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("fixture reached running state");
        drop(child);
        // The fixture keeps stdout open while alive and cannot create children.
        let mut bytes = Vec::new();
        tokio::time::timeout(Duration::from_secs(1), stdout.read_to_end(&mut bytes))
            .await
            .expect("drop ended the exact child")
            .unwrap();
        assert!(bytes.is_empty());
    }

    #[tokio::test]
    #[ignore = "Native descriptor inheritance proof uses only an inert outside file"]
    async fn native_child_cannot_inherit_unlisted_handles() {
        use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
        let outside = tempfile::tempfile().unwrap();
        // Deliberately bypass Rust's default CLOEXEC for this inert fixture.
        let fd = unsafe { libc::fcntl(outside.as_raw_fd(), libc::F_DUPFD, 200) };
        assert!(fd >= 200);
        let inherited = unsafe { OwnedFd::from_raw_fd(fd) };
        let snapshot = Snapshot::fixture(&[]);
        let helper = helper(&snapshot);
        let result = run(
            &snapshot,
            &helper,
            &["fd".into(), inherited.as_raw_fd().to_string().into()],
            &|| async { false },
        )
        .await
        .unwrap();
        assert_eq!(result.text, "closed\n");
    }

    #[tokio::test]
    #[ignore = "Subprocess-only terminal shutdown fixture"]
    async fn shutdown_child_fixture() {
        if std::env::var_os("ZEPHIUM_RUNNER_SHUTDOWN_FIXTURE").is_none() {
            return;
        }
        let snapshot = Snapshot::fixture(&[]);
        let helper = helper(&snapshot);
        let ready = snapshot.work.join(".git/ready");
        let args = [
            "group-hold".into(),
            ready.as_os_str().to_owned(),
            unsafe { libc::getpgrp() }.to_string().into(),
        ];
        let operation = run(&snapshot, &helper, &args, &|| async { false });
        let shutdown = async {
            tokio::time::timeout(Duration::from_secs(5), async {
                while !std::fs::read_to_string(&ready)
                    .is_ok_and(|value| matches!(value.as_str(), "moved" | "denied"))
                {
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
            })
            .await
            .expect("fixture reached running state");
            tokio::task::spawn_blocking(crate::work_commands::groups::shutdown)
                .await
                .unwrap();
        };
        let (result, _) = tokio::join!(operation, shutdown);
        assert!(matches!(result, Err(Failure::Stopped)));
        let launched = std::cell::Cell::new(false);
        let result = crate::work_commands::groups::Group::launch(
            || {
                launched.set(true);
                Err::<((), u32), _>(Failure::Launch)
            },
            Failure::Stopped,
        );
        assert!(matches!(result, Err(Failure::Stopped)) && !launched.get());
    }

    #[test]
    #[ignore = "Native terminal shutdown proof runs in its own process"]
    fn native_shutdown_drains_and_refuses_new_admission() {
        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "work_commands::runner::macos::tests::shutdown_child_fixture",
                "--ignored",
                "--test-threads=1",
            ])
            .env_clear()
            .env("PATH", "/usr/bin:/bin")
            .env("HOME", "/private/tmp")
            .env("ZEPHIUM_RUNNER_SHUTDOWN_FIXTURE", "1")
            .stdin(Stdio::null())
            .status()
            .unwrap();
        assert!(status.success());
    }

    #[test]
    fn profile_does_not_grant_network_fork_or_ambient_user_files() {
        assert!(!PROFILE.contains("allow network"));
        assert!(!PROFILE.contains("allow process-fork"));
        assert!(!PROFILE.contains("/Users/"));
        assert!(!PROFILE.contains("(subpath \"/\")"));
    }
}
