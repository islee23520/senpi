use senpi_pty::{PtySession, PtySessionOptions};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[test]
fn manual_cat_resize_kill_transcript() {
    let cat_output = Arc::new(Mutex::new(Vec::new()));
    let cat_seen = Arc::clone(&cat_output);
    let mut cat = PtySession::start(PtySessionOptions::new("cat"), move |chunk| {
        cat_seen.lock().unwrap().extend_from_slice(chunk);
    })
    .unwrap();
    cat.write(b"manual-cat-round-trip\n").unwrap();
    wait_until(Duration::from_secs(2), || {
        text(&cat_output).contains("manual-cat-round-trip")
    });
    eprintln!("cat bytes: {:?}", text(&cat_output));
    cat.kill().unwrap();
    let cat_exit = cat.wait().unwrap();
    eprintln!(
        "cat exit: exit_code={:?} cancelled={} timed_out={}",
        cat_exit.exit_code, cat_exit.cancelled, cat_exit.timed_out
    );

    let resize_output = Arc::new(Mutex::new(Vec::new()));
    let resize_seen = Arc::clone(&resize_output);
    let mut resized = PtySession::start(
        PtySessionOptions::new("sh")
            .arg("-lc")
            .arg("sleep 0.2; stty size"),
        move |chunk| resize_seen.lock().unwrap().extend_from_slice(chunk),
    )
    .unwrap();
    resized.resize(123, 42).unwrap();
    let resize_exit = resized.wait().unwrap();
    let resize_text = text(&resize_output);
    eprintln!("resize bytes: {:?}", resize_text);
    assert_eq!(resize_exit.exit_code, Some(0));
    assert!(resize_text.contains("42 123"));

    let kill_output = Arc::new(Mutex::new(Vec::new()));
    let kill_seen = Arc::clone(&kill_output);
    let mut session = PtySession::start(
        PtySessionOptions::new("sh")
            .arg("-lc")
            .arg("sleep 30 & echo child=$!; wait"),
        move |chunk| kill_seen.lock().unwrap().extend_from_slice(chunk),
    )
    .unwrap();
    let child_pid = wait_for_child_pid(&kill_output);
    eprintln!("spawned child pid: {child_pid}");
    session.kill().unwrap();
    let kill_exit = session.wait().unwrap();
    wait_until(Duration::from_secs(3), || !process_exists(child_pid));
    eprintln!(
        "kill exit: exit_code={:?} cancelled={} timed_out={} child_alive={}",
        kill_exit.exit_code,
        kill_exit.cancelled,
        kill_exit.timed_out,
        process_exists(child_pid)
    );
    assert!(kill_exit.cancelled);
    assert!(!process_exists(child_pid));
}

fn text(output: &Arc<Mutex<Vec<u8>>>) -> String {
    String::from_utf8_lossy(&output.lock().unwrap()).into_owned()
}

fn wait_for_child_pid(output: &Arc<Mutex<Vec<u8>>>) -> u32 {
    let mut child_pid = None;
    wait_until(Duration::from_secs(2), || {
        child_pid = text(output)
            .split_whitespace()
            .find_map(|part| part.strip_prefix("child=")?.parse().ok());
        child_pid.is_some()
    });
    child_pid.expect("child pid output")
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
    unsafe { libc::kill(pid as i32, 0) == 0 }
}

#[cfg(not(unix))]
fn process_exists(_pid: u32) -> bool {
    false
}
