use super::{PtySession, PtySessionOptions};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[cfg(unix)]
#[test]
fn pty_session_streams_raw_bytes_and_exit_code() {
    let output = Arc::new(Mutex::new(Vec::new()));
    let seen = Arc::clone(&output);
    let mut session = PtySession::start(
        PtySessionOptions::new("sh")
            .arg("-lc")
            .arg("printf 'hello-stream\\n'"),
        move |chunk| seen.lock().unwrap().extend_from_slice(chunk),
    )
    .unwrap();

    let exit = session.wait().unwrap();
    assert_eq!(exit.exit_code, Some(0));
    assert!(!exit.cancelled);
    assert!(!exit.timed_out);
    assert_eq!(
        String::from_utf8_lossy(&output.lock().unwrap()).as_ref(),
        "hello-stream\r\n"
    );
}

#[test]
fn pty_session_reports_nonexistent_command_error() {
    let result = PtySession::start(
        PtySessionOptions::new("__senpi_missing_command_for_pty_test__"),
        |_| {},
    );

    assert!(result.is_err());
}

#[cfg(unix)]
#[test]
fn pty_session_times_out_hung_command() {
    let mut session = PtySession::start(
        PtySessionOptions::new("sh")
            .arg("-lc")
            .arg("sleep 30")
            .timeout(Duration::from_millis(100)),
        |_| {},
    )
    .unwrap();

    let exit = session.wait().unwrap();
    assert!(exit.cancelled);
    assert!(exit.timed_out);
}

#[cfg(unix)]
#[test]
fn pty_session_writes_stdin_round_trip() {
    let output = Arc::new(Mutex::new(Vec::new()));
    let seen = Arc::clone(&output);
    let mut session = PtySession::start(PtySessionOptions::new("cat"), move |chunk| {
        seen.lock().unwrap().extend_from_slice(chunk);
    })
    .unwrap();

    session.write(b"cat-round-trip\n").unwrap();
    wait_until(Duration::from_secs(2), || {
        String::from_utf8_lossy(&output.lock().unwrap()).contains("cat-round-trip")
    });
    session.kill().unwrap();
    let _ = session.wait().unwrap();
    assert!(String::from_utf8_lossy(&output.lock().unwrap()).contains("cat-round-trip"));
}

#[cfg(unix)]
#[test]
fn pty_session_resizes_reported_terminal_size() {
    let output = Arc::new(Mutex::new(Vec::new()));
    let seen = Arc::clone(&output);
    let mut session = PtySession::start(
        PtySessionOptions::new("sh")
            .arg("-lc")
            .arg("sleep 0.2; stty size"),
        move |chunk| seen.lock().unwrap().extend_from_slice(chunk),
    )
    .unwrap();

    session.resize(101, 33).unwrap();
    let exit = session.wait().unwrap();
    assert_eq!(exit.exit_code, Some(0));
    assert!(String::from_utf8_lossy(&output.lock().unwrap()).contains("33 101"));
}

#[cfg(unix)]
#[test]
fn pty_session_sends_signal_to_process_group() {
    let output = Arc::new(Mutex::new(Vec::new()));
    let seen = Arc::clone(&output);
    let mut session = PtySession::start(
        PtySessionOptions::new("sh")
            .arg("-lc")
            .arg("trap 'echo got-term; exit 7' TERM; echo ready; sleep 30"),
        move |chunk| seen.lock().unwrap().extend_from_slice(chunk),
    )
    .unwrap();

    wait_until(Duration::from_secs(2), || {
        String::from_utf8_lossy(&output.lock().unwrap()).contains("ready")
    });
    session.signal("term").unwrap();
    let exit = session.wait().unwrap();
    assert_eq!(exit.exit_code, Some(7));
    assert!(String::from_utf8_lossy(&output.lock().unwrap()).contains("got-term"));
}

#[cfg(unix)]
#[test]
fn pty_session_kill_removes_child_process_tree() {
    let output = Arc::new(Mutex::new(Vec::new()));
    let seen = Arc::clone(&output);
    let mut session = PtySession::start(
        PtySessionOptions::new("sh")
            .arg("-lc")
            .arg("sleep 30 & echo child=$!; wait"),
        move |chunk| seen.lock().unwrap().extend_from_slice(chunk),
    )
    .unwrap();

    let child_pid = wait_for_child_pid(&output);
    session.kill().unwrap();
    let exit = session.wait().unwrap();
    assert!(exit.cancelled);
    wait_until(Duration::from_secs(3), || !process_exists(child_pid));
    assert!(!process_exists(child_pid), "child pid {child_pid} still exists");
}

#[cfg(unix)]
#[test]
fn pty_session_write_after_exit_returns_benign_error() {
    let mut session = PtySession::start(PtySessionOptions::new("true"), |_| {}).unwrap();
    let exit = session.wait().unwrap();
    assert_eq!(exit.exit_code, Some(0));

    let error = session.write(b"late").unwrap_err();
    assert!(error.to_string().contains("closed"));
}

fn wait_for_child_pid(output: &Arc<Mutex<Vec<u8>>>) -> u32 {
    let mut child_pid = None;
    wait_until(Duration::from_secs(2), || {
        let text = String::from_utf8_lossy(&output.lock().unwrap()).into_owned();
        child_pid = text
            .split_whitespace()
            .find_map(|part| part.strip_prefix("child=")?.parse().ok());
        child_pid.is_some()
    });
    child_pid.expect("child pid output")
}

#[cfg(windows)]
#[test]
fn windows_pty_session_writes_resizes_kills_and_reports_exit() {
    let output = Arc::new(Mutex::new(Vec::new()));
    let seen = Arc::clone(&output);
    let mut session = PtySession::start(
        PtySessionOptions::new("cmd.exe")
            .arg("/d")
            .arg("/q")
            .timeout(Duration::from_secs(5)),
        move |chunk| seen.lock().unwrap().extend_from_slice(chunk),
    )
    .unwrap();

    session.resize(100, 30).unwrap();
    session.write(b"echo windows-pty-round-trip\r\n").unwrap();
    wait_until(Duration::from_secs(3), || {
        String::from_utf8_lossy(&output.lock().unwrap()).contains("windows-pty-round-trip")
    });
    session.kill().unwrap();
    let exit = session.wait().unwrap();

    assert!(exit.cancelled);
    assert!(String::from_utf8_lossy(&output.lock().unwrap()).contains("windows-pty-round-trip"));
}

fn wait_until(timeout: Duration, mut predicate: impl FnMut() -> bool) {
    let deadline = std::time::Instant::now() + timeout;
    while std::time::Instant::now() < deadline {
        if predicate() {
            return;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    assert!(predicate());
}

#[cfg(unix)]
fn process_exists(pid: u32) -> bool {
    // SAFETY: libc::kill with signal 0 performs existence/permission checking only. The pid comes
    // from test child output and no Rust memory is shared with libc.
    unsafe { libc::kill(pid as i32, 0) == 0 }
}

#[cfg(not(unix))]
fn process_exists(_pid: u32) -> bool {
    false
}
