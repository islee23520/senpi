//! Contract tests for the theme system.
//!
//! T2 locks the parse-time and resolve-error shape that T7 builds on. The
//! resolve-happy-path tests land alongside T7 once the actual color
//! resolution is wired up.

use senpi_neo_tui::theme;

const DARK_JSON: &str = senpi_neo_tui::DEFAULT_DARK_THEME_JSON;

#[test]
fn parses_bundled_dark_theme() {
    let spec = theme::parse(DARK_JSON).expect("dark theme must parse");
    assert_eq!(spec.name, "senpi-neo-dark");
    assert!(!spec.tokens.is_empty(), "tokens must populate");
    assert!(!spec.defs.is_empty(), "defs must populate");
}

#[test]
fn rejects_invalid_hex_in_resolve() {
    let bad = r#"{
        "name": "broken",
        "type": "dark",
        "tokens": { "primary": "not-a-hex" }
    }"#;
    let spec = theme::parse(bad).expect("parses raw json");
    let err = theme::resolve(&spec).expect_err("must reject invalid hex");
    let msg = err.to_string().to_lowercase();
    assert!(
        msg.contains("not-a-hex") || msg.contains("invalid hex") || msg.contains("invalid"),
        "expected invalid-hex error, got: {msg}"
    );
}

#[test]
fn rejects_empty_tokens_at_resolve() {
    let bad = r#"{
        "name": "empty",
        "type": "dark",
        "tokens": {}
    }"#;
    let spec = theme::parse(bad).expect("parses raw json");
    let err = theme::resolve(&spec).expect_err("must reject missing tokens");
    let msg = err.to_string().to_lowercase();
    assert!(
        msg.contains("missing") || msg.contains("required"),
        "expected missing-token error, got: {msg}"
    );
}
