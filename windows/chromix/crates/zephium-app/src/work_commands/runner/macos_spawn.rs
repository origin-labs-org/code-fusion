//! Darwin closes every non-stdio descriptor atomically at spawn, including
//! descriptors opened concurrently by browser frameworks without CLOEXEC.
use super::Failure;
use std::{
    ffi::{CString, OsStr, OsString},
    fs::File,
    io,
    os::{
        fd::{AsRawFd, FromRawFd, IntoRawFd, OwnedFd},
        unix::{ffi::OsStrExt, process::ExitStatusExt},
    },
    path::Path,
    process::ExitStatus,
};
use tokio::net::unix::pipe::Receiver;

unsafe extern "C" {
    fn posix_spawn_file_actions_addchdir_np(
        actions: *mut libc::posix_spawn_file_actions_t,
        path: *const libc::c_char,
    ) -> libc::c_int;
}
struct Attributes(libc::posix_spawnattr_t);
impl Drop for Attributes {
    fn drop(&mut self) {
        unsafe {
            libc::posix_spawnattr_destroy(&mut self.0);
        }
    }
}
struct Actions(libc::posix_spawn_file_actions_t);
impl Drop for Actions {
    fn drop(&mut self) {
        unsafe {
            libc::posix_spawn_file_actions_destroy(&mut self.0);
        }
    }
}
fn checked(code: i32) -> Result<(), Failure> {
    if code == 0 {
        Ok(())
    } else {
        Err(Failure::Launch)
    }
}
fn string(value: &OsStr) -> Result<CString, Failure> {
    CString::new(value.as_bytes()).map_err(|_| Failure::Input)
}
fn above_stdio(fd: impl AsRawFd) -> Result<OwnedFd, Failure> {
    let copy = unsafe { libc::fcntl(fd.as_raw_fd(), libc::F_DUPFD_CLOEXEC, 3) };
    if copy < 0 {
        return Err(Failure::Launch);
    }
    Ok(unsafe { OwnedFd::from_raw_fd(copy) })
}
fn pipe() -> Result<(Receiver, OwnedFd), Failure> {
    let (read, write) = io::pipe().map_err(|_| Failure::Launch)?;
    let writer = above_stdio(write)?;
    let reader = unsafe { OwnedFd::from_raw_fd(read.into_raw_fd()) };
    Ok((
        Receiver::from_owned_fd(reader).map_err(|_| Failure::Launch)?,
        writer,
    ))
}

pub(super) struct Child {
    pid: Option<i32>,
    status: Option<ExitStatus>,
    pub stdout: Option<Receiver>,
    pub stderr: Option<Receiver>,
}
impl Child {
    pub fn id(&self) -> u32 {
        self.pid.expect("owned spawned process") as u32
    }
    /// Descriptive native identity while this owner still holds the unreaped
    /// child. Signaling never depends on a later PID lookup or this metadata.
    pub(super) fn instance(&self) -> Option<u64> {
        #[repr(C)]
        #[derive(Default)]
        struct Info {
            _uuid: [u8; 16],
            unique: u64,
            _parent: u64,
            _version: i32,
            _parent_version: i32,
            _reserved: [u64; 2],
        }
        const _: () = assert!(std::mem::size_of::<Info>() == 56);
        let mut info = Info::default();
        // PROC_PIDUNIQIDENTIFIERINFO from Apple's proc_info_private.h. The
        // measured OS gate controls use; absence remains explicitly unknown.
        let size = unsafe {
            libc::proc_pidinfo(
                self.pid?,
                17,
                0,
                (&mut info as *mut Info).cast(),
                std::mem::size_of::<Info>() as i32,
            )
        };
        (size == std::mem::size_of::<Info>() as i32 && info.unique != 0).then_some(info.unique)
    }
    pub fn poll(&mut self) -> io::Result<Option<ExitStatus>> {
        if let Some(status) = self.status {
            return Ok(Some(status));
        }
        let Some(pid) = self.pid else {
            return Err(io::Error::from_raw_os_error(libc::ECHILD));
        };
        let mut status = 0;
        let waited = unsafe { libc::waitpid(pid, &mut status, libc::WNOHANG) };
        if waited == 0 {
            return Ok(None);
        }
        if waited != pid {
            let error = io::Error::last_os_error();
            if error.raw_os_error() == Some(libc::ECHILD) {
                self.pid = None;
            }
            return if error.raw_os_error() == Some(libc::EINTR) {
                Ok(None)
            } else {
                Err(error)
            };
        }
        let status = ExitStatus::from_raw(status);
        self.status = Some(status);
        self.pid = None;
        Ok(Some(status))
    }
}
impl Drop for Child {
    fn drop(&mut self) {
        let Some(pid) = self.pid.take() else {
            return;
        };
        // This PID has not been reaped, so it cannot identify an unrelated
        // process. There is never a persisted PID or model-selected target.
        unsafe {
            libc::kill(pid, libc::SIGKILL);
        }
        let mut status = 0;
        let waited = unsafe { libc::waitpid(pid, &mut status, libc::WNOHANG) };
        if waited == 0
            || (waited < 0 && io::Error::last_os_error().raw_os_error() == Some(libc::EINTR))
        {
            // A dropped future cannot synchronously block the app on kernel IO.
            // Keep the exact unreaped child owned until it settles.
            let _ = std::thread::Builder::new()
                .name("work-runner-reap".into())
                .spawn(move || loop {
                    let result = unsafe { libc::waitpid(pid, &mut status, 0) };
                    if result == pid
                        || io::Error::last_os_error().raw_os_error() != Some(libc::EINTR)
                    {
                        break;
                    }
                });
        }
    }
}

pub(super) fn spawn(
    cwd: &Path,
    arguments: &[OsString],
    environment: &[(OsString, OsString)],
) -> Result<Child, Failure> {
    spawn_program(
        cwd,
        Path::new("/usr/bin/sandbox-exec"),
        arguments,
        environment,
        false,
        None,
    )
}

pub(super) fn spawn_direct_read_only(
    cwd: &Path,
    program: &Path,
    arguments: &[OsString],
    environment: &[(OsString, OsString)],
) -> Result<Child, Failure> {
    spawn_program(cwd, program, arguments, environment, true, None)
}

/// The private guard receives one control pipe as stdin, and no ambient FDs.
pub(super) fn spawn_guard(
    program: &Path,
    arguments: &[OsString],
) -> Result<
    (
        Child,
        std::sync::Arc<crate::work_commands::groups::GuardControl>,
    ),
    Failure,
> {
    use crate::work_commands::groups::{self, GuardControl};
    let (read, write) = io::pipe().map_err(|_| Failure::Launch)?;
    let read = above_stdio(read)?;
    let write = above_stdio(write)?;
    let flags = unsafe { libc::fcntl(write.as_raw_fd(), libc::F_GETFL) };
    if flags < 0
        || unsafe { libc::fcntl(write.as_raw_fd(), libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0
        || unsafe {
            libc::fcntl(
                write.as_raw_fd(),
                73, /* Darwin F_SETNOSIGPIPE from sys/fcntl.h */
                1,
            )
        } < 0
    {
        return Err(Failure::Launch);
    }
    let input = std::sync::Arc::new(GuardControl::new(write));
    let child = groups::launch_guard(
        &input,
        || {
            spawn_program(
                Path::new("/private/tmp"),
                program,
                arguments,
                &[("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())],
                false,
                Some(read),
            )
        },
        Failure::Stopped,
    )?;
    Ok((child, input))
}

impl Child {
    /// A guard may itself own a confined child. Close its control pipe and reap
    /// it without killing it; killing the guard would abandon that custody.
    pub(super) fn reap_without_signal(mut self) {
        let Some(pid) = self.pid.take() else {
            return;
        };
        let _ = std::thread::Builder::new()
            .name("work-guard-reap".into())
            .spawn(move || {
                let mut status = 0;
                loop {
                    let result = unsafe { libc::waitpid(pid, &mut status, 0) };
                    if result == pid
                        || std::io::Error::last_os_error().raw_os_error() != Some(libc::EINTR)
                    {
                        break;
                    }
                }
            });
    }
}

fn spawn_program(
    cwd: &Path,
    program: &Path,
    arguments: &[OsString],
    environment: &[(OsString, OsString)],
    fatal_footprint: bool,
    input: Option<OwnedFd>,
) -> Result<Child, Failure> {
    let executable = string(program.as_os_str())?;
    let cwd = string(cwd.as_os_str())?;
    let argv: Vec<CString> = std::iter::once(Ok(executable.clone()))
        .chain(arguments.iter().map(|arg| string(arg)))
        .collect::<Result<_, _>>()?;
    let environment: Vec<CString> = environment
        .iter()
        .map(|(name, value)| {
            let mut pair = name.clone();
            pair.push("=");
            pair.push(value);
            string(&pair)
        })
        .collect::<Result<_, _>>()?;
    let mut argv: Vec<_> = argv.iter().map(|arg| arg.as_ptr().cast_mut()).collect();
    argv.push(std::ptr::null_mut());
    let mut envp: Vec<_> = environment
        .iter()
        .map(|value| value.as_ptr().cast_mut())
        .collect();
    envp.push(std::ptr::null_mut());
    let (stdout, out) = pipe()?;
    let (stderr, err) = pipe()?;
    let input = match input {
        Some(input) => input,
        None => above_stdio(File::open("/dev/null").map_err(|_| Failure::Launch)?)?,
    };
    let mut raw = std::ptr::null_mut();
    checked(unsafe { libc::posix_spawnattr_init(&mut raw) })?;
    let mut attributes = Attributes(raw);
    if fatal_footprint {
        // Private ABI qualified only for the explicitly admitted OS. Configure
        // both active and inactive fatal limits on the final interpreter, never
        // on an exec wrapper that can reset them. Missing SPI fails closed.
        type SetFootprint = unsafe extern "C" fn(
            *mut libc::posix_spawnattr_t,
            libc::c_short,
            libc::c_int,
            libc::c_int,
            libc::c_int,
        ) -> libc::c_int;
        let symbol = unsafe {
            libc::dlsym(
                libc::RTLD_DEFAULT,
                c"posix_spawnattr_setjetsam_ext".as_ptr(),
            )
        };
        if symbol.is_null() {
            return Err(Failure::PythonUnavailable);
        }
        let set: SetFootprint = unsafe { std::mem::transmute(symbol) };
        checked(unsafe { set(&mut attributes.0, 0x04 | 0x08, -1, 256, 256) })?;
    }
    let mut raw = std::ptr::null_mut();
    checked(unsafe { libc::posix_spawn_file_actions_init(&mut raw) })?;
    let mut actions = Actions(raw);
    let flags = libc::POSIX_SPAWN_CLOEXEC_DEFAULT
        | libc::POSIX_SPAWN_SETPGROUP
        | libc::POSIX_SPAWN_SETSIGMASK
        | libc::POSIX_SPAWN_SETSIGDEF;
    checked(unsafe { libc::posix_spawnattr_setflags(&mut attributes.0, flags as i16) })?;
    checked(unsafe { libc::posix_spawnattr_setpgroup(&mut attributes.0, 0) })?;
    let mut empty = unsafe { std::mem::zeroed::<libc::sigset_t>() };
    checked(unsafe { libc::sigemptyset(&mut empty) })?;
    checked(unsafe { libc::posix_spawnattr_setsigmask(&mut attributes.0, &empty) })?;
    for signal in [
        libc::SIGPIPE,
        libc::SIGINT,
        libc::SIGTERM,
        libc::SIGHUP,
        libc::SIGQUIT,
        libc::SIGCHLD,
    ] {
        checked(unsafe { libc::sigaddset(&mut empty, signal) })?;
    }
    checked(unsafe { libc::posix_spawnattr_setsigdefault(&mut attributes.0, &empty) })?;
    for (source, target) in [
        (input.as_raw_fd(), 0),
        (out.as_raw_fd(), 1),
        (err.as_raw_fd(), 2),
    ] {
        checked(unsafe { libc::posix_spawn_file_actions_adddup2(&mut actions.0, source, target) })?;
    }
    for descriptor in [input.as_raw_fd(), out.as_raw_fd(), err.as_raw_fd()] {
        checked(unsafe { libc::posix_spawn_file_actions_addclose(&mut actions.0, descriptor) })?;
    }
    checked(unsafe { posix_spawn_file_actions_addchdir_np(&mut actions.0, cwd.as_ptr()) })?;
    let mut pid = 0;
    // Input buffers live through the synchronous call. CLOEXEC_DEFAULT is a
    // required Darwin primitive, never replaced by racy parent-FD enumeration.
    checked(unsafe {
        libc::posix_spawn(
            &mut pid,
            executable.as_ptr(),
            &actions.0,
            &attributes.0,
            argv.as_ptr(),
            envp.as_ptr(),
        )
    })?;
    if pid <= 0 {
        return Err(Failure::Launch);
    }
    Ok(Child {
        pid: Some(pid),
        status: None,
        stdout: Some(stdout),
        stderr: Some(stderr),
    })
}
