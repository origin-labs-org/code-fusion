//! One private AF_UNIX stream, never an IP listener or a configurable proxy.
//! Nonblocking IO keeps timeout/drop independent of blocking-pool scheduling.
use super::super::Failure;
use socket2::{Domain, SockAddr, Socket, Type};
use std::{
    io::{Read, Write},
    path::Path,
    time::Duration,
};
const POLL: Duration = Duration::from_millis(10);
pub(super) fn endpoint_name(path: &Path) -> Result<String, Failure> {
    let name = path.to_str().ok_or(Failure::Input)?;
    #[cfg(windows)]
    let name = {
        // Only local DOS paths. Never turn a UNC endpoint into remote access.
        let stripped = name.strip_prefix(r"\\?\").unwrap_or(name);
        if stripped.len() < 3
            || !stripped.as_bytes()[0].is_ascii_alphabetic()
            || &stripped.as_bytes()[1..3] != b":\\"
        {
            return Err(Failure::Input);
        }
        stripped
    };
    if !path.is_absolute() || name.as_bytes().contains(&0) || name.len() > 100 {
        return Err(Failure::Input);
    }
    Ok(name.to_owned())
}
pub(crate) struct Listener {
    socket: Socket,
}
pub(crate) struct Stream(Socket);
impl Listener {
    pub fn bind(path: &Path) -> Result<Self, Failure> {
        let name = endpoint_name(path)?;
        let socket = Socket::new(Domain::UNIX, Type::STREAM, None).map_err(|_| Failure::Launch)?;
        socket.set_nonblocking(true).map_err(|_| Failure::Launch)?;
        socket
            .bind(&SockAddr::unix(&name).map_err(|_| Failure::Input)?)
            .map_err(|_| Failure::Launch)?;
        socket.listen(1).map_err(|_| Failure::Launch)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::{FileTypeExt, PermissionsExt};
            let metadata = std::fs::symlink_metadata(path).map_err(|_| Failure::Storage)?;
            if !metadata.file_type().is_socket() {
                return Err(Failure::Storage);
            }
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
                .map_err(|_| Failure::Storage)?;
        }
        Ok(Self { socket })
    }
    pub async fn accept(&self) -> Result<Stream, Failure> {
        loop {
            match self.socket.accept() {
                Ok((socket, _)) => {
                    socket.set_nonblocking(true).map_err(|_| Failure::Failed)?;
                    return Ok(Stream(socket));
                }
                Err(error) if retry(&error) => tokio::time::sleep(POLL).await,
                Err(_) => return Err(Failure::Failed),
            }
        }
    }
}
fn retry(error: &std::io::Error) -> bool {
    matches!(
        error.kind(),
        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::Interrupted
    )
}
impl Stream {
    pub async fn read(&mut self, bytes: &mut [u8]) -> Result<usize, Failure> {
        loop {
            match (&self.0).read(bytes) {
                Ok(count) => return Ok(count),
                Err(error) if retry(&error) => tokio::time::sleep(POLL).await,
                Err(_) => return Err(Failure::Failed),
            }
        }
    }
    pub async fn write_all(&mut self, mut bytes: &[u8]) -> Result<(), Failure> {
        while !bytes.is_empty() {
            match (&self.0).write(bytes) {
                Ok(0) => return Err(Failure::Failed),
                Ok(count) => bytes = &bytes[count..],
                Err(error) if retry(&error) => tokio::time::sleep(POLL).await,
                Err(_) => return Err(Failure::Failed),
            }
        }
        Ok(())
    }
    pub async fn shutdown(&mut self) -> Result<(), Failure> {
        self.0
            .shutdown(std::net::Shutdown::Write)
            .map_err(|_| Failure::Failed)
    }
    #[cfg(test)]
    pub fn connect(path: &Path) -> Self {
        let socket = Socket::new(Domain::UNIX, Type::STREAM, None).unwrap();
        socket
            .connect(&SockAddr::unix(endpoint_name(path).unwrap()).unwrap())
            .unwrap();
        socket.set_nonblocking(true).unwrap();
        Self(socket)
    }
    #[cfg(test)]
    pub async fn read_to_end(&mut self, bytes: &mut Vec<u8>) -> Result<(), Failure> {
        let mut chunk = [0u8; 4096];
        loop {
            let count = self.read(&mut chunk).await?;
            if count == 0 {
                return Ok(());
            }
            if bytes.len() + count > 64 * 1024 {
                return Err(Failure::Limit);
            }
            bytes.extend_from_slice(&chunk[..count]);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn endpoint_rejects_relative_nul_and_oversized_paths() {
        assert!(endpoint_name(Path::new("broker.sock")).is_err());
        assert!(endpoint_name(Path::new("/tmp/a\0b")).is_err());
        assert!(endpoint_name(Path::new(&format!("/tmp/{}", "x".repeat(101)))).is_err());
    }
    #[cfg(windows)]
    #[test]
    fn endpoint_accepts_only_local_drive_paths() {
        assert_eq!(
            endpoint_name(Path::new(r"\\?\C:\task\broker.sock")).unwrap(),
            r"C:\task\broker.sock"
        );
        for path in [
            r"\\server\share\broker.sock",
            r"\\?\UNC\server\share\broker.sock",
            r"\\.\pipe\broker",
        ] {
            assert!(endpoint_name(Path::new(path)).is_err());
        }
    }
    #[cfg(unix)]
    #[test]
    fn binding_never_unlinks_existing_file_or_alias() {
        let root = tempfile::tempdir().unwrap();
        let file = root.path().join("file");
        std::fs::write(&file, b"inert").unwrap();
        let alias = root.path().join("alias");
        std::os::unix::fs::symlink(&file, &alias).unwrap();
        assert!(Listener::bind(&file).is_err());
        assert!(Listener::bind(&alias).is_err());
        assert_eq!(std::fs::read(&file).unwrap(), b"inert");
        assert!(std::fs::symlink_metadata(alias)
            .unwrap()
            .file_type()
            .is_symlink());
    }
}
