//! Private current-executable custody for closed local operations. The guard owns
//! its copy from creation to verified removal and never receives a source grant.
use super::{Failure, Output, Snapshot};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    future::Future,
    io::Read,
    os::unix::fs::MetadataExt,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use tokio::io::AsyncReadExt;
const ARGUMENT: &str = "--zephium-private-unittest-guard-v1";
const REQUEST_LIMIT: usize = 64 * 1024 * 1024;
const RESPONSE_LIMIT: usize = 512 * 1024;
const DEADLINE: Duration = Duration::from_secs(35);
const GIT_DEADLINE: Duration = Duration::from_secs(90);
const GITHUB_QUALIFIED: bool = true; // Native8 and connected broker6 groups on25G83.
const GITHUB_DEADLINE: Duration = Duration::from_secs(30);
const GIT_QUALIFIED: bool = true; // Native7 and connected tool9 checks on25G83.
const QUALIFIED: bool = true; // Copied v19: attested child/host-death/Stop/cleanup matrix on25G83.
static INSTALLED: AtomicBool = AtomicBool::new(false);

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    version: u8,
    id: [u8; 16],
    operation: Operation,
}
#[derive(Serialize, Deserialize)]
#[serde(tag = "kind", deny_unknown_fields)]
enum Operation {
    PublicGitHub {},
    SelectedUnittest {
        #[serde(deserialize_with = "bounded_modules")]
        modules: Vec<String>,
        #[serde(deserialize_with = "bounded_files")]
        files: BTreeMap<String, String>,
    },
    GitComparison {
        #[serde(deserialize_with = "bounded_files")]
        before: BTreeMap<String, String>,
        #[serde(deserialize_with = "bounded_files")]
        after: BTreeMap<String, String>,
        operation: super::guard_git::Read,
    },
}
#[derive(Serialize)]
struct RequestRef<'a> {
    version: u8,
    id: [u8; 16],
    operation: OperationRef<'a>,
}
#[derive(Serialize)]
#[serde(tag = "kind")]
enum OperationRef<'a> {
    PublicGitHub {},
    SelectedUnittest {
        modules: &'a [String],
        files: BTreeMap<&'a str, &'a str>,
    },
    GitComparison {
        before: BTreeMap<&'a str, &'a str>,
        after: BTreeMap<&'a str, &'a str>,
        operation: super::guard_git::Read,
    },
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "kind", deny_unknown_fields)]
enum Reply {
    GitHubChildSpawned {
        id: [u8; 16],
        pid: u32,
        instance: Option<u64>,
    },
    FetchRequested {
        id: [u8; 16],
        challenge: [u8; 16],
    },
    Prepared {
        id: [u8; 16],
        root: String,
        challenge: [u8; 16],
        device: u64,
        inode: u64,
    },
    Started {
        id: [u8; 16],
        pid: u32,
    },
    GitChildSpawned {
        id: [u8; 16],
        ordinal: u8,
        pid: u32,
        instance: Option<u64>,
    },
    Completed {
        id: [u8; 16],
        result: Result<Value, Error>,
        cleanup: bool,
    },
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Value {
    text: String,
    success: bool,
    exit: i32,
}
#[derive(Serialize, Deserialize)]
enum Error {
    Input,
    Unavailable,
    ToolUnavailable,
    GitHubUnavailable,
    CustodyUnavailable,
    Limit,
    Stopped,
    Unconfirmed,
    Failed,
    Sensitive,
    Storage,
}
impl From<Failure> for Error {
    fn from(error: Failure) -> Self {
        match error {
            Failure::Input => Self::Input,
            Failure::PythonUnavailable | Failure::Unavailable => Self::Unavailable,
            Failure::ToolUnavailable => Self::ToolUnavailable,
            Failure::GitHubUnavailable => Self::GitHubUnavailable,
            Failure::CustodyUnavailable => Self::CustodyUnavailable,
            Failure::Limit => Self::Limit,
            Failure::Stopped => Self::Stopped,
            Failure::CleanupPending | Failure::StopUnconfirmed => Self::Unconfirmed,
            Failure::Sensitive => Self::Sensitive,
            Failure::Storage => Self::Storage,
            _ => Self::Failed,
        }
    }
}
impl From<Error> for Failure {
    fn from(error: Error) -> Self {
        match error {
            Error::Input => Self::Input,
            Error::Unavailable => Self::PythonUnavailable,
            Error::ToolUnavailable => Self::ToolUnavailable,
            Error::GitHubUnavailable => Self::GitHubUnavailable,
            Error::CustodyUnavailable => Self::CustodyUnavailable,
            Error::Limit => Self::Limit,
            Error::Stopped => Self::Stopped,
            Error::Unconfirmed => Self::CleanupPending,
            Error::Failed => Self::Failed,
            Error::Sensitive => Self::Sensitive,
            Error::Storage => Self::Storage,
        }
    }
}
pub(super) fn installed() -> bool {
    QUALIFIED && INSTALLED.load(Ordering::Acquire)
}
pub(super) fn github_installed() -> bool {
    GITHUB_QUALIFIED && INSTALLED.load(Ordering::Acquire)
}
pub(super) fn git_installed() -> bool {
    GIT_QUALIFIED && INSTALLED.load(Ordering::Acquire)
}

/// Call before app initialization. No other command-line or environment input
/// can select a program, source folder, profile, credential, or sandbox policy.
pub(crate) fn entry() {
    let arguments: Vec<_> = std::env::args_os().skip(1).collect();
    if arguments.first().is_none_or(|arg| arg != ARGUMENT) {
        INSTALLED.store(true, Ordering::Release);
        return;
    }
    if arguments.len() != 1 {
        std::process::exit(2);
    }
    if !QUALIFIED && !cfg!(debug_assertions) {
        std::process::exit(2);
    }
    let good = serve(Instant::now()).is_ok();
    std::process::exit(if good { 0 } else { 1 });
}
fn bounded_modules<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Vec<String>, D::Error> {
    struct Visitor;
    impl<'de> serde::de::Visitor<'de> for Visitor {
        type Value = Vec<String>;
        fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
            f.write_str("at most64 closed module names")
        }
        fn visit_seq<A: serde::de::SeqAccess<'de>>(
            self,
            mut sequence: A,
        ) -> Result<Self::Value, A::Error> {
            let mut result = Vec::new();
            while let Some(value) = sequence.next_element::<String>()? {
                if result.len() == 64 || value.len() > 1024 {
                    return Err(serde::de::Error::custom("module limit"));
                }
                result.push(value);
            }
            Ok(result)
        }
    }
    deserializer.deserialize_seq(Visitor)
}
fn bounded_files<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<BTreeMap<String, String>, D::Error> {
    struct Visitor;
    impl<'de> serde::de::Visitor<'de> for Visitor {
        type Value = BTreeMap<String, String>;
        fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
            f.write_str("at most2000 filtered text files")
        }
        fn visit_map<A: serde::de::MapAccess<'de>>(
            self,
            mut map: A,
        ) -> Result<Self::Value, A::Error> {
            let mut result = BTreeMap::new();
            let mut total = 0usize;
            while let Some((key, value)) = map.next_entry::<String, String>()? {
                total = total.saturating_add(value.len());
                if result.len() == 2000
                    || key.len() > 1024
                    || value.len() > 1024 * 1024
                    || total > 32 * 1024 * 1024
                    || result.contains_key(&key)
                {
                    return Err(serde::de::Error::custom("file limit"));
                }
                result.insert(key, value);
            }
            Ok(result)
        }
    }
    deserializer.deserialize_map(Visitor)
}

pub(super) struct Control {
    pub(super) broker: super::guard_github::Broker,
    stopped: AtomicBool,
    go: AtomicBool,
    challenge: std::sync::Mutex<Option<[u8; 16]>>,
    started: Instant,
    budget_secs: std::sync::atomic::AtomicU64,
}
impl Control {
    fn expires(&self) -> Instant {
        self.started + Duration::from_secs(self.budget_secs.load(Ordering::Acquire))
    }
    pub(super) fn check(&self) -> Result<(), Failure> {
        if self.stopped.load(Ordering::Acquire) {
            return Err(Failure::Stopped);
        }
        if Instant::now() >= self.expires() {
            return Err(Failure::Limit);
        }
        Ok(())
    }
}
fn request(input: &mut impl Read) -> Result<Request, Failure> {
    let mut length = [0; 4];
    input.read_exact(&mut length).map_err(|_| Failure::Input)?;
    let length = u32::from_be_bytes(length) as usize;
    if length == 0 || length > REQUEST_LIMIT {
        return Err(Failure::Input);
    }
    let mut bytes = vec![0; length];
    input.read_exact(&mut bytes).map_err(|_| Failure::Input)?;
    let value: Request = serde_json::from_slice(&bytes).map_err(|_| Failure::Input)?;
    if value.version != 1 {
        return Err(Failure::Input);
    }
    Ok(value)
}
type SelectedFiles = BTreeMap<PathBuf, Vec<u8>>;
fn validate(operation: Operation) -> Result<(Vec<String>, SelectedFiles), Failure> {
    let Operation::SelectedUnittest { modules, files } = operation else {
        return Err(Failure::Input);
    };
    if modules.is_empty() || modules.len() > 64 || files.len() > 2_000 {
        return Err(Failure::Input);
    }
    for module in &modules {
        if module.len() > 1024
            || !module.split('.').all(|part| {
                let mut bytes = part.bytes();
                bytes
                    .next()
                    .is_some_and(|b| b.is_ascii_alphabetic() || b == b'_')
                    && bytes.all(|b| b.is_ascii_alphanumeric() || b == b'_')
            })
        {
            return Err(Failure::Input);
        }
    }
    Ok((modules, file_map(files)?))
}
fn file_map(files: BTreeMap<String, String>) -> Result<SelectedFiles, Failure> {
    let mut total = 0usize;
    let mut result = BTreeMap::new();
    for (name, text) in files {
        total = total.checked_add(text.len()).ok_or(Failure::Limit)?;
        if name.len() > 1024
            || name.contains('\\')
            || text.len() > 1024 * 1024
            || total > 32 * 1024 * 1024
        {
            return Err(Failure::Input);
        }
        // Snapshot repeats component, protected-name, alias and secret checks.
        result.insert(PathBuf::from(name), text.into_bytes());
    }
    Ok(result)
}

enum Prepared {
    GitHub(super::macos_github::Runtime),
    Python {
        snapshot: Snapshot,
        runtime: super::macos_python::Runtime,
        modules: Vec<String>,
    },
    Git(super::guard_git::Prepared),
}
impl Prepared {
    fn new(operation: Operation, check: &dyn Fn() -> Result<(), Failure>) -> Result<Self, Failure> {
        if matches!(&operation, Operation::PublicGitHub { .. }) {
            if !GITHUB_QUALIFIED && !cfg!(debug_assertions) {
                return Err(Failure::GitHubUnavailable);
            }
            return super::macos_github::Runtime::prepare_checked(check).map(Self::GitHub);
        }

        if let Operation::GitComparison {
            before,
            after,
            operation,
        } = operation
        {
            if !super::macos::qualified() {
                return Err(Failure::Unavailable);
            }
            if !GIT_QUALIFIED && !cfg!(debug_assertions) {
                return Err(Failure::CustodyUnavailable);
            }
            return super::guard_git::Prepared::new(
                file_map(before)?,
                file_map(after)?,
                operation,
                check,
            )
            .map(Self::Git);
        }
        let (modules, files) = validate(operation)?;
        let runtime = super::macos_python::Runtime::qualified_checked(check)?;
        let snapshot = Snapshot::read_only_checked(files, check)?;
        Ok(Self::Python {
            snapshot,
            runtime,
            modules,
        })
    }
    fn snapshot(&self) -> &Snapshot {
        match self {
            Self::Python { snapshot, .. } => snapshot,
            Self::Git(git) => &git.snapshot,
            Self::GitHub(runtime) => &runtime.snapshot,
        }
    }
    async fn run(&self, control: &Control, id: [u8; 16]) -> Result<Output, Failure> {
        let cancelled = || async { control.check().is_err() };
        match self {
            Self::GitHub(runtime) => super::guard_github::run(runtime, control, id).await,
            Self::Python {
                snapshot,
                runtime,
                modules,
            } => {
                super::macos_python::run_custodied(snapshot, runtime, modules, &cancelled, |pid| {
                    if send(&Reply::Started { id, pid }, control).is_err() {
                        control.stopped.store(true, Ordering::Release);
                    }
                })
                .await
            }
            Self::Git(git) => {
                git.run(&|| control.check(), &cancelled, |ordinal, pid, instance| {
                    if send(
                        &Reply::GitChildSpawned {
                            id,
                            ordinal,
                            pid,
                            instance,
                        },
                        control,
                    )
                    .is_err()
                    {
                        control.stopped.store(true, Ordering::Release);
                    }
                })
                .await
            }
        }
    }
    fn close(self) -> Result<(), Failure> {
        match self {
            Self::Python { snapshot, .. } => snapshot.close(),
            Self::Git(git) => git.snapshot.close(),
            Self::GitHub(runtime) => runtime.close(),
        }
    }
}
pub(super) fn github_child(
    control: &Control,
    id: [u8; 16],
    pid: u32,
    instance: Option<u64>,
) -> Result<(), Failure> {
    send(&Reply::GitHubChildSpawned { id, pid, instance }, control)
}
pub(super) fn github_fetch(
    control: &Control,
    id: [u8; 16],
    challenge: [u8; 16],
) -> Result<(), Failure> {
    send(&Reply::FetchRequested { id, challenge }, control)
}
fn send(reply: &Reply, control: &Control) -> Result<(), Failure> {
    let bytes = serde_json::to_vec(reply).map_err(|_| Failure::Failed)?;
    if bytes.len() > RESPONSE_LIMIT {
        return Err(Failure::Limit);
    }
    let mut frame = Vec::with_capacity(bytes.len() + 4);
    frame.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
    frame.extend(bytes);
    // Never strand custody on a host that stopped reading its status pipe.
    let write_deadline = Instant::now() + Duration::from_millis(50);
    let deadline = if matches!(reply, Reply::Completed { .. }) {
        write_deadline
    } else {
        control.expires().min(write_deadline)
    };
    let fd = libc::STDOUT_FILENO;
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
    if flags < 0 || unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0 {
        return Err(Failure::Failed);
    }
    let mut offset = 0;
    while offset < frame.len() {
        if Instant::now() >= deadline {
            return Err(Failure::Limit);
        }
        let wrote =
            unsafe { libc::write(fd, frame[offset..].as_ptr().cast(), frame.len() - offset) };
        if wrote > 0 {
            offset += wrote as usize;
            continue;
        }
        let error = std::io::Error::last_os_error();
        if !matches!(error.raw_os_error(), Some(libc::EAGAIN | libc::EINTR))
            || Instant::now() >= deadline
        {
            return Err(Failure::Failed);
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    Ok(())
}
fn serve(started: Instant) -> Result<(), Failure> {
    // SIGPIPE must not terminate the owner before it closes its copy. Target
    // spawn restores default signals and closes all guard protocol descriptors.
    unsafe {
        libc::signal(libc::SIGPIPE, libc::SIG_IGN);
    }
    let control = Arc::new(Control {
        broker: Default::default(),
        stopped: AtomicBool::new(false),
        go: AtomicBool::new(false),
        challenge: std::sync::Mutex::new(None),
        started,
        budget_secs: std::sync::atomic::AtomicU64::new(DEADLINE.as_secs()),
    });
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    let input_control = control.clone();
    std::thread::Builder::new()
        .name("work-guard-control".into())
        .spawn(move || {
            let mut input = std::io::stdin().lock();
            let parsed = request(&mut input);
            let public_github = parsed
                .as_ref()
                .is_ok_and(|request| matches!(&request.operation, Operation::PublicGitHub { .. }));
            if sender.send(parsed).is_err() {
                return;
            }
            let mut go = [0; 17];
            if input.read_exact(&mut go).is_ok()
                && go[0] == 1
                && input_control
                    .challenge
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .as_ref()
                    .is_some_and(|challenge| go[1..] == challenge[..])
            {
                input_control.go.store(true, Ordering::Release);
                if public_github && input_control.broker.receive(&mut input).is_err() {
                    input_control.stopped.store(true, Ordering::Release);
                    return;
                }
                // No second request or trailing payload is admitted. EOF is Stop.
                let _ = input.read(&mut [0]);
            }
            input_control.stopped.store(true, Ordering::Release);
        })
        .map_err(|_| Failure::Launch)?;
    let request = receiver
        .recv_timeout(Duration::from_secs(10))
        .map_err(|_| Failure::Limit)??;
    let id = request.id;
    if matches!(&request.operation, Operation::PublicGitHub { .. }) {
        control
            .budget_secs
            .store(GITHUB_DEADLINE.as_secs(), Ordering::Release);
    }
    if matches!(&request.operation, Operation::GitComparison { .. }) {
        control
            .budget_secs
            .store(GIT_DEADLINE.as_secs(), Ordering::Release);
    }
    let outcome = (|| -> Result<(Output, bool), Failure> {
        control.check()?;
        let preparation_deadline = Instant::now() + Duration::from_secs(10);
        let prepared = Prepared::new(request.operation, &|| {
            control.check()?;
            if Instant::now() >= preparation_deadline {
                Err(Failure::Limit)
            } else {
                Ok(())
            }
        })?;
        let snapshot = prepared.snapshot();
        let result = (|| -> Result<Output, Failure> {
            let meta = std::fs::symlink_metadata(&snapshot.root).map_err(|_| Failure::Storage)?;
            let mut challenge = [0u8; 16];
            if unsafe { libc::getentropy(challenge.as_mut_ptr().cast(), challenge.len()) } != 0 {
                return Err(Failure::Launch);
            }
            *control.challenge.lock().unwrap_or_else(|e| e.into_inner()) = Some(challenge);
            send(
                &Reply::Prepared {
                    id,
                    root: snapshot
                        .root
                        .file_name()
                        .and_then(|name| name.to_str())
                        .ok_or(Failure::Input)?
                        .to_owned(),
                    challenge,
                    device: meta.dev(),
                    inode: meta.ino(),
                },
                &control,
            )?;
            while !control.go.load(Ordering::Acquire) {
                control.check()?;
                std::thread::sleep(Duration::from_millis(5));
            }
            control.check()?;
            let executor = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .map_err(|_| Failure::Launch)?;
            executor.block_on(prepared.run(&control, id))
        })();
        // Custodied native execution never returns while its child is unsettled.
        let closed = prepared.close();
        super::worker::closed(result, closed).map(|output| (output, true))
    })();
    let cleanup = !matches!(
        outcome,
        Err(Failure::CleanupPending | Failure::StopUnconfirmed)
    );
    let result = outcome
        .map(|(out, _)| Value {
            text: out.text,
            success: out.success,
            exit: out.exit,
        })
        .map_err(Error::from);
    send(
        &Reply::Completed {
            id,
            result,
            cleanup,
        },
        &control,
    )
}

struct BoundedRequest(Vec<u8>);
impl std::io::Write for BoundedRequest {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if bytes.len() > REQUEST_LIMIT.saturating_sub(self.0.len()) {
            return Err(std::io::ErrorKind::FileTooLarge.into());
        }
        self.0.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

struct Guard {
    child: Option<super::macos_spawn::Child>,
    input: Option<Arc<crate::work_commands::groups::GuardControl>>,
}
impl Drop for Guard {
    fn drop(&mut self) {
        self.input.take();
        if let Some(child) = self.child.take() {
            child.reap_without_signal();
        }
    }
}
async fn write_control(
    control: &crate::work_commands::groups::GuardControl,
    bytes: &[u8],
) -> Result<(), Failure> {
    let mut offset = 0;
    while offset < bytes.len() {
        match control.write(&bytes[offset..]) {
            Ok(0) => return Err(Failure::Stopped),
            Ok(count) => offset += count,
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::Interrupted
                ) =>
            {
                tokio::time::sleep(Duration::from_millis(2)).await
            }
            Err(_) => return Err(Failure::Stopped),
        }
    }
    Ok(())
}

async fn receive(input: &mut tokio::net::unix::pipe::Receiver) -> Result<Reply, Failure> {
    let length = input
        .read_u32()
        .await
        .map_err(|_| Failure::StopUnconfirmed)? as usize;
    if length == 0 || length > RESPONSE_LIMIT {
        return Err(Failure::StopUnconfirmed);
    }
    let mut bytes = vec![0; length];
    input
        .read_exact(&mut bytes)
        .await
        .map_err(|_| Failure::StopUnconfirmed)?;
    serde_json::from_slice(&bytes).map_err(|_| Failure::StopUnconfirmed)
}
pub(super) async fn run<C, CF>(
    files: &BTreeMap<PathBuf, Vec<u8>>,
    modules: &[String],
    cancelled: &C,
) -> Result<Output, Failure>
where
    C: Fn() -> CF,
    CF: Future<Output = bool>,
{
    if !installed() {
        return Err(Failure::PythonUnavailable);
    }
    transact(
        OperationRef::SelectedUnittest {
            modules,
            files: borrowed_files(files)?,
        },
        cancelled,
        || async { Err(Failure::Input) },
    )
    .await
}
pub(super) async fn git<C, CF>(
    before: &BTreeMap<PathBuf, Vec<u8>>,
    after: &BTreeMap<PathBuf, Vec<u8>>,
    operation: super::ReadOperation,
    cancelled: &C,
) -> Result<Output, Failure>
where
    C: Fn() -> CF,
    CF: Future<Output = bool>,
{
    if !git_installed() {
        return Err(Failure::CustodyUnavailable);
    }
    transact(
        OperationRef::GitComparison {
            before: borrowed_files(before)?,
            after: borrowed_files(after)?,
            operation: operation.try_into()?,
        },
        cancelled,
        || async { Err(Failure::Input) },
    )
    .await
}
pub(super) async fn github<C, CF, F, FF>(cancelled: &C, fetch: F) -> Result<Output, Failure>
where
    C: Fn() -> CF,
    CF: Future<Output = bool>,
    F: FnOnce() -> FF,
    FF: Future<Output = Result<Vec<u8>, Failure>>,
{
    if !github_installed() {
        return Err(Failure::GitHubUnavailable);
    }
    transact(OperationRef::PublicGitHub {}, cancelled, fetch).await
}
fn borrowed_files(files: &BTreeMap<PathBuf, Vec<u8>>) -> Result<BTreeMap<&str, &str>, Failure> {
    files
        .iter()
        .map(|(path, bytes)| {
            Ok((
                path.to_str().ok_or(Failure::Input)?,
                std::str::from_utf8(bytes).map_err(|_| Failure::Input)?,
            ))
        })
        .collect()
}
async fn transact<C, CF, F, FF>(
    operation: OperationRef<'_>,
    cancelled: &C,
    fetch: F,
) -> Result<Output, Failure>
where
    C: Fn() -> CF,
    CF: Future<Output = bool>,
    F: FnOnce() -> FF,
    FF: Future<Output = Result<Vec<u8>, Failure>>,
{
    let is_git = matches!(&operation, OperationRef::GitComparison { .. });
    let is_github = matches!(&operation, OperationRef::PublicGitHub { .. });
    let mut fetch = Some(fetch);
    let mut fetch_completed = false;
    let mut host_failure = None;
    let id = zephium_core::work::WorkArtifactId::generate().bytes();
    let mut encoded = BoundedRequest(Vec::new());
    serde_json::to_writer(
        &mut encoded,
        &RequestRef {
            version: 1,
            id,
            operation,
        },
    )
    .map_err(|_| Failure::Limit)?;
    let request = encoded.0;
    if super::cancellation_requested(cancelled).await {
        return Err(Failure::Stopped);
    }
    let program = std::env::current_exe().map_err(|_| {
        if is_github {
            Failure::GitHubUnavailable
        } else if is_git {
            Failure::CustodyUnavailable
        } else {
            Failure::PythonUnavailable
        }
    })?;
    let (mut child, input) = super::macos_spawn::spawn_guard(&program, &[ARGUMENT.into()])?;
    let mut status = child.stdout.take().ok_or(Failure::Launch)?;
    let mut errors = child.stderr.take().ok_or(Failure::Launch)?;
    let mut owner = Guard {
        child: Some(child),
        input: Some(input),
    };
    // No source path or credential enters this bounded channel.
    let sent = tokio::time::timeout(Duration::from_secs(10), async {
        let input = owner.input.as_mut().ok_or(Failure::Stopped)?;
        write_control(input, &(request.len() as u32).to_be_bytes()).await?;
        write_control(input, &request).await
    })
    .await;
    if !matches!(sent, Ok(Ok(()))) {
        owner.input.take();
    }
    let mut tick = tokio::time::interval(Duration::from_millis(25));
    let mut prepared = false;
    let mut started_child = false;
    let mut git_ordinal = 0u8;
    let mut completion = None;
    let mut protocol = true;
    let mut diagnostic = [0; 1024];
    let (sender, mut replies) = tokio::sync::mpsc::channel(1);
    tokio::spawn(async move {
        loop {
            let reply = receive(&mut status).await;
            let done = reply.is_err() || matches!(reply, Ok(Reply::Completed { .. }));
            if sender.send(reply).await.is_err() || done {
                break;
            }
        }
    });
    let mut errors_open = true;
    let mut exited = None;
    loop {
        tokio::select! {
            reply = replies.recv(), if protocol => {
                let reply = reply.unwrap_or(Err(Failure::StopUnconfirmed));
                match reply {
                    Ok(Reply::Prepared { id: seen, root, challenge, .. }) if seen == id && !prepared && !started_child && root.starts_with("zephium-work-copy-") && !root.contains(['/', '\\']) => {
                        prepared = true;
                        if !super::cancellation_requested(cancelled).await {
                            if let Some(input)=owner.input.as_mut() { let mut go=vec![1];go.extend_from_slice(&challenge);if write_control(input,&go).await.is_err() { owner.input.take(); } }
                        } else { owner.input.take(); }
                    },
                    Ok(Reply::Started { id: seen, pid }) if seen == id && prepared && !is_git && !is_github && !started_child && pid > 0 => { started_child = true; },
                    Ok(Reply::GitChildSpawned { id: seen, ordinal, pid, .. }) if seen == id && prepared && is_git && ordinal == git_ordinal && ordinal < 5 && pid > 0 => { started_child = true; git_ordinal += 1; },
                    Ok(Reply::GitHubChildSpawned { id:seen, pid, .. }) if seen == id && prepared && is_github && !started_child && pid > 0 => { started_child=true; },
                    Ok(Reply::FetchRequested { id:seen, challenge }) if seen == id && prepared && started_child && is_github && !fetch_completed => {
                        fetch_completed=true;
                        let response=super::guard_github::fetch_response(challenge,fetch.take().expect("one closed broker fetch")(),cancelled).await;
                        let sent=match (response,owner.input.as_ref()) {
                            (Ok(bytes),Some(input))=>match tokio::time::timeout(Duration::from_secs(1),write_control(input,&bytes)).await {
                                Ok(Ok(()))=>true,
                                _=>{host_failure=Some(Failure::Failed);false},
                            },
                            (Err(error),_)=>{host_failure=Some(error);false},
                            _=>false,
                        };
                        if !sent {owner.input.take();}
                    },
                    Ok(Reply::Completed { id: seen, result, cleanup }) if seen == id => {
                        let phase_valid = result.is_err() || if is_github {prepared && started_child && fetch_completed && git_ordinal==0} else {completion_phase(is_git, prepared, started_child, git_ordinal)};
                        completion = Some(if !phase_valid { Err(Failure::StopUnconfirmed) } else if cleanup { result.map(|value| Output { text: value.text, success: value.success, exit: value.exit }).map_err(|error| if is_git && matches!(error, Error::Unavailable) { Failure::Unavailable } else { error.into() }) } else { Err(Failure::CleanupPending) });
                        owner.input.take(); protocol = false;
                    },
                    _ => { owner.input.take(); protocol = false; },
                }
            },
            value = errors.read(&mut diagnostic), if errors_open => { if !matches!(value, Ok(n) if n > 0) { errors_open = false; } },
            _ = tick.tick() => {
                if super::cancellation_requested(cancelled).await { owner.input.take(); }
                if exited.is_none() {
                    match owner.child.as_mut().expect("owned guard").poll() {
                        Ok(Some(exit)) => exited = Some(exit.success()),
                        Err(_) => return Err(Failure::StopUnconfirmed),
                        Ok(None) => {},
                    }
                }
            }
        }
        if let Some(success) = exited {
            if !success {
                return Err(Failure::StopUnconfirmed);
            }
            if let Some(result) = completion.take() {
                return settled_host_failure(result, host_failure);
            }
            if !protocol {
                return Err(Failure::StopUnconfirmed);
            }
        }
    }
}

fn settled_host_failure(
    result: Result<Output, Failure>,
    host_failure: Option<Failure>,
) -> Result<Output, Failure> {
    if matches!(
        &result,
        Err(Failure::CleanupPending | Failure::StopUnconfirmed)
    ) {
        return result;
    }
    match host_failure {
        Some(error) => Err(error),
        None => result,
    }
}

fn completion_phase(is_git: bool, prepared: bool, started_child: bool, git_ordinal: u8) -> bool {
    prepared
        && started_child
        && if is_git {
            git_ordinal == 5
        } else {
            git_ordinal == 0
        }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn framed(body: &[u8]) -> Vec<u8> {
        let mut bytes = (body.len() as u32).to_be_bytes().to_vec();
        bytes.extend_from_slice(body);
        bytes
    }
    fn body() -> serde_json::Value {
        serde_json::json!({"version":1,"id":vec![0;16],"operation":{"kind":"SelectedUnittest","modules":["test_inert"],"files":{"test_inert.py":"import unittest\n"}}})
    }
    #[test]
    fn closed_protocol_rejects_unknown_fields_operations_and_trailing_json() {
        let good = body();
        assert!(request(&mut framed(&serde_json::to_vec(&good).unwrap()).as_slice()).is_ok());
        for changed in [
            {
                let mut v = good.clone();
                v["source_root"] = serde_json::json!("/unavailable");
                v
            },
            {
                let mut v = good.clone();
                v["operation"]["program"] = serde_json::json!("unavailable");
                v
            },
            {
                let mut v = good.clone();
                v["operation"]["kind"] = serde_json::json!("Shell");
                v
            },
        ] {
            assert!(
                request(&mut framed(&serde_json::to_vec(&changed).unwrap()).as_slice()).is_err()
            );
        }
        let mut two = serde_json::to_vec(&good).unwrap();
        two.extend_from_slice(b" {}");
        assert!(request(&mut framed(&two).as_slice()).is_err());
    }
    #[test]
    fn oversized_prefix_and_early_eof_never_produce_request() {
        assert!(request(&mut ((REQUEST_LIMIT + 1) as u32).to_be_bytes().as_slice()).is_err());
        for bytes in [&[][..], &[0, 0, 0][..], &[0, 0, 0, 4, b'{'][..]] {
            let mut input: &[u8] = bytes;
            assert!(request(&mut input).is_err());
        }
    }
    #[test]
    fn duplicate_paths_and_module_overflow_are_rejected_during_decode() {
        let source = serde_json::to_string(&body()).unwrap().replace(
            "\"test_inert.py\":\"import unittest\\n\"",
            "\"test_inert.py\":\"a\",\"test_inert.py\":\"b\"",
        );
        assert!(request(&mut framed(source.as_bytes()).as_slice()).is_err());
        let mut many = body();
        many["operation"]["modules"] = serde_json::json!(vec!["test_inert"; 65]);
        assert!(request(&mut framed(&serde_json::to_vec(&many).unwrap()).as_slice()).is_err());
    }
    #[test]
    fn absolute_clock_and_control_eof_are_independent_of_native_timer() {
        let control = Control {
            broker: Default::default(),
            stopped: AtomicBool::new(false),
            go: AtomicBool::new(false),
            challenge: std::sync::Mutex::new(None),
            started: Instant::now() - DEADLINE,
            budget_secs: std::sync::atomic::AtomicU64::new(DEADLINE.as_secs()),
        };
        assert_eq!(control.check(), Err(Failure::Limit));
        control.stopped.store(true, Ordering::Release);
        assert_eq!(control.check(), Err(Failure::Stopped));
    }
    #[test]
    fn git_protocol_is_closed_and_completion_requires_every_native_stage() {
        let body = serde_json::json!({"version":1,"id":vec![0;16],"operation":{
            "kind":"GitComparison","before":{"note.txt":"before"},"after":{"note.txt":"after"},"operation":"diff"}});
        assert!(request(&mut framed(&serde_json::to_vec(&body).unwrap()).as_slice()).is_ok());
        for bad in [
            {
                let mut value = body.clone();
                value["operation"]["operation"] = serde_json::json!("shell");
                value
            },
            {
                let mut value = body.clone();
                value["operation"]["source_root"] = serde_json::json!("/unavailable");
                value
            },
        ] {
            assert!(request(&mut framed(&serde_json::to_vec(&bad).unwrap()).as_slice()).is_err());
        }
        assert!(completion_phase(true, true, true, 5));
        assert!(completion_phase(false, true, true, 0));
        for ordinal in 0..5 {
            assert!(!completion_phase(true, true, true, ordinal));
        }
        assert!(!completion_phase(true, false, true, 5));
        assert!(!completion_phase(false, true, false, 0));
        assert!(!completion_phase(false, true, true, 1));
    }
}

#[cfg(test)]
mod github_protocol_tests {
    use super::*;
    #[test]
    fn public_broker_request_has_no_resource_credential_or_program_fields() {
        let request_value = serde_json::json!({"version":1,"id":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"operation":{"kind":"PublicGitHub"}});
        let framed = |value: &serde_json::Value| {
            let bytes = serde_json::to_vec(value).unwrap();
            let mut frame = (bytes.len() as u32).to_be_bytes().to_vec();
            frame.extend(bytes);
            frame
        };
        assert!(request(&mut framed(&request_value).as_slice()).is_ok());
        for name in ["url", "token", "path", "program", "arguments"] {
            let mut bad = request_value.clone();
            bad["operation"][name] = serde_json::json!("inert");
            assert!(request(&mut framed(&bad).as_slice()).is_err(), "{name}");
        }
    }
}

#[cfg(test)]
mod github_host_failure_tests {
    use super::*;
    #[test]
    fn confirmed_eof_does_not_turn_a_privacy_or_limit_refusal_into_user_stop() {
        for cause in [Failure::Sensitive, Failure::Limit, Failure::Failed] {
            assert!(
                matches!(settled_host_failure(Err(Failure::Stopped),Some(cause)),Err(error) if error==cause)
            );
            assert!(matches!(
                settled_host_failure(Err(Failure::CleanupPending), Some(cause)),
                Err(Failure::CleanupPending)
            ));
            assert!(matches!(
                settled_host_failure(Err(Failure::StopUnconfirmed), Some(cause)),
                Err(Failure::StopUnconfirmed)
            ));
        }
    }
}
