mod session;
mod signals;

pub use session::{PtyError, PtyExit, PtyResult, PtySession, PtySessionOptions};

use napi_derive::napi;

#[napi]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_matches_crate_version() {
        assert_eq!(version(), env!("CARGO_PKG_VERSION"));
    }

    #[test]
    fn portable_pty_backend_is_linked() {
        let _pty_system = portable_pty::native_pty_system();
    }
}

#[cfg(test)]
mod session_tests;
