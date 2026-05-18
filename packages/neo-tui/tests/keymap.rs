//! Contract tests for the keymap system.
//!
//! T2 locks the parse-time contract that T8 builds on. The strict
//! Action-enum validation lives in T8 and arrives as additional tests
//! once the lookup logic lands.

use senpi_neo_tui::keymap;

const DEFAULT_JSON: &str = senpi_neo_tui::DEFAULT_KEYMAP_JSON;

#[test]
fn parses_default_keymap() {
    let spec = keymap::parse(DEFAULT_JSON).expect("default keymap must parse");
    assert_eq!(spec.leader.as_deref(), Some("ctrl+x"));
    assert!(
        spec.bindings.contains_key("palette.open"),
        "default keymap must register palette.open"
    );
    assert!(
        spec.bindings.contains_key("app.quit"),
        "default keymap must register app.quit"
    );
}

#[test]
fn default_palette_binding_is_ctrl_p() {
    let spec = keymap::parse(DEFAULT_JSON).expect("default keymap must parse");
    let binds = spec
        .bindings
        .get("palette.open")
        .expect("palette.open must exist");
    assert!(
        binds.iter().any(|b| b == "ctrl+p"),
        "default palette.open must include ctrl+p, got {binds:?}"
    );
}

#[test]
fn accepts_arbitrary_keys_until_t8_strictens() {
    // Today the parser round-trips arbitrary string keys. T8 will reject
    // unknown actions at merge time; that test lives alongside T8.
    let bad = r#"{ "bindings": { "nonsense.action": ["alt+x"] } }"#;
    let spec = keymap::parse(bad).expect("parser accepts unknown action names today");
    assert!(spec.bindings.contains_key("nonsense.action"));
}
