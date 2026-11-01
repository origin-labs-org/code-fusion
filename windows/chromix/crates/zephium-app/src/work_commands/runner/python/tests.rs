use super::*;
#[cfg(target_os = "macos")]
use std::fs;
#[cfg(target_os = "macos")]
struct Fixture {
    _home: tempfile::TempDir,
    grant: WorkFileGrant,
    root: PathBuf,
}
#[cfg(target_os = "macos")]
impl Fixture {
    fn new(code: &str) -> Self {
        let home = tempfile::Builder::new()
            .prefix("work-python-qualification-")
            .tempdir()
            .unwrap();
        let canonical = home.path().canonicalize().unwrap();
        let root = canonical.join("code/project");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("test_inert.py"), code).unwrap();
        let _home_guard = crate::work_files::TestGrantHome::new(canonical);
        let (grant, refused) = WorkFileGrant::admit(&[root.to_string_lossy().into_owned()]);
        assert!(refused.is_empty());
        Self {
            _home: home,
            grant,
            root,
        }
    }
    fn request(&self) -> UnittestRequest {
        UnittestRequest::new(&["test_inert.py".into()], &[]).unwrap()
    }
    async fn run(&self) -> Result<Output, Failure> {
        run(&self.grant, &self.root, &self.request(), || async { false }).await
    }
}
#[test]
fn requests_have_no_interpreter_options_or_protected_paths() {
    for path in [
        "../test.py",
        "/test.py",
        ".env.py",
        "test-name.py",
        "ghp_inertFixtureToken.py",
        "test.py/other",
        "a\\test.py",
    ] {
        assert!(UnittestRequest::new(&[path.into()], &[]).is_err());
    }
    assert_eq!(
        UnittestRequest::new(
            &["tests/test_inert.py".into()],
            &["package/module.py".into()]
        )
        .unwrap()
        .count(),
        1
    );
}
#[cfg(target_os = "macos")]
#[tokio::test]
#[ignore = "Native qualified read-only Apple CPython test class; inert source only"]
async fn native_python_runs_selected_tests_and_preserves_failures() {
    let fixture=Fixture::new("import unittest\nclass Inert(unittest.TestCase):\n def test_value(self): self.assertEqual(2+2,4)\n");
    let result = fixture.run().await.unwrap();
    assert!(result.success);
    assert!(result.text.contains("Ran 1 test"));
    assert!(result.text.contains("OK"));
    fs::write(fixture.root.join("test_inert.py"),"import unittest\nclass Inert(unittest.TestCase):\n def test_value(self): self.assertEqual(2+2,5)\n").unwrap();
    let result = fixture.run().await.unwrap();
    assert!(!result.success);
    assert_eq!(result.exit, 1);
    assert!(result.text.contains("FAILED (failures=1)"));
}
#[cfg(target_os = "macos")]
#[tokio::test]
#[ignore = "Native readonly/no-network/no-exec/closure qualification; inert source only"]
async fn native_python_authority_and_environment_are_confined() {
    let outside = tempfile::NamedTempFile::new().unwrap();
    let outside = outside.path().canonicalize().unwrap();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let code = format!(
        r#"import ctypes,errno,os,socket,sys,unittest
class Inert(unittest.TestCase):
 def test_reads_and_writes(self):
  for path,flags in [({outside:?},os.O_RDONLY),("no-write",os.O_WRONLY|os.O_CREAT)]:
   try: descriptor=os.open(path,flags,0o600)
   except OSError as error: self.assertIn(error.errno,[errno.EPERM,errno.EACCES])
   else: os.close(descriptor);self.fail("access unexpectedly allowed")
 def test_fork_and_exec(self):
  with self.assertRaises(OSError) as error: os.fork()
  self.assertIn(error.exception.errno,[errno.EPERM,errno.EACCES])
  with self.assertRaises(OSError) as error: os.execve(sys.executable,[sys.executable,"-I","-c","pass"],{{}})
  self.assertIn(error.exception.errno,[errno.EPERM,errno.EACCES])
 def test_network(self):
  with self.assertRaises(OSError) as error: socket.create_connection(("127.0.0.1",{port}),timeout=.1)
  self.assertIn(error.exception.errno,[errno.EPERM,errno.EACCES])
 def test_environment(self):
  self.assertEqual(set(os.environ),{{"HOME","USERPROFILE","TMPDIR","TEMP","TMP"}})
 def test_dynamic_stdlib(self):
  import math
  self.assertEqual(math.sqrt(4),2)
"#,
        outside = outside.to_string_lossy(),
        port = port
    );
    let fixture = Fixture::new(&code);
    let result = fixture.run().await.unwrap();
    assert!(result.success);
    assert!(result.text.contains("Ran 5 tests"));
    assert!(!fixture.root.join("no-write").exists());
}
#[cfg(target_os = "macos")]
#[tokio::test]
#[ignore = "Native held-output privacy and cap qualification; inert generated values"]
async fn native_python_holds_split_secret_output_and_caps_floods() {
    let fixture=Fixture::new("import sys,time,unittest\nclass Inert(unittest.TestCase):\n def test_output(self):\n  sys.stdout.write('ghp_');sys.stdout.flush();time.sleep(.01);sys.stdout.write('inertFixtureToken');sys.stdout.flush()\n");
    assert!(matches!(fixture.run().await, Err(Failure::Sensitive)));
    fs::write(fixture.root.join("test_inert.py"),"import sys,unittest\nclass Inert(unittest.TestCase):\n def test_output(self):\n  for _ in range(64): sys.stdout.write('x'*8192);sys.stdout.flush()\n").unwrap();
    assert!(matches!(fixture.run().await, Err(Failure::Limit)));
}
#[cfg(target_os = "macos")]
#[tokio::test]
#[ignore = "Native fatal256MiB footprint qualification; allocation bounded to384MiB"]
async fn native_python_enforces_fatal_footprint() {
    let fixture=Fixture::new("import unittest\nclass Inert(unittest.TestCase):\n def test_memory(self):\n  print('allocating',flush=True)\n  value=bytearray(384*1024*1024)\n  for index in range(0,len(value),4096): value[index]=1\n  print('allocation_completed',flush=True)\n");
    let output = fixture.run().await.unwrap();
    assert!(!output.success);
    assert_eq!(output.exit, -1);
    assert!(output.text.contains("allocating"));
    assert!(!output.text.contains("allocation_completed"));
}
#[cfg(target_os = "macos")]
#[tokio::test]
#[ignore = "Native same-owner Python group-change/Stop qualification"]
async fn native_python_stop_survives_group_change() {
    let code=format!("import os,time,unittest\nclass Inert(unittest.TestCase):\n def test_wait(self):\n  os.setpgid(0,{})\n  time.sleep(3)\n",unsafe{libc::getpgrp()});
    let fixture = Fixture::new(&code);
    let files = [(PathBuf::from("test_inert.py"), code.into_bytes())].into();
    let snapshot = Snapshot::read_only(files).unwrap();
    let runtime = super::super::macos_python::Runtime::qualified().unwrap();
    let started = std::time::Instant::now();
    let result = super::super::macos_python::run(
        &snapshot,
        &runtime,
        &fixture.request().modules,
        &|| async { started.elapsed() > Duration::from_millis(200) },
    )
    .await;
    assert!(matches!(result, Err(Failure::Stopped)));
    assert!(started.elapsed() < Duration::from_secs(1));
}

#[cfg(target_os = "macos")]
#[tokio::test]
#[ignore = "Qualified Python class admission under pending worker debt; no interpreter starts"]
async fn native_python_pending_workers_hold_capacity_before_preparation() {
    // This admission-only fixture never launches the test executable as a guard.
    super::super::guard::entry();
    ensure_available().unwrap();
    super::super::worker::pending_capacity_fixture(slots().clone(), || async {
        let request = UnittestRequest::new(&["test_inert.py".into()], &[]).unwrap();
        matches!(
            run(
                &WorkFileGrant::default(),
                Path::new("/unused-fixture-path"),
                &request,
                || async { false }
            )
            .await,
            Err(Failure::WorkerBusy)
        )
    })
    .await;
}
