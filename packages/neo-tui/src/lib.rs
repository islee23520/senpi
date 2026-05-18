//! `senpi-neo-tui` — native Rust + ratatui TUI for senpi.
//!
//! See [`README`](https://github.com/code-yeongyu/senpi/blob/main/packages/neo-tui/README.md)
//! and the [plan document](https://github.com/code-yeongyu/senpi/blob/main/plans/neo-tui.md)
//! for architecture rationale and module layout.
//!
//! The crate exposes a thin library surface so that integration tests (and the
//! faux RPC backend `senpi-neo-faux`) can drive individual subsystems without
//! constructing the full app.

#![doc(html_root_url = "https://docs.rs/senpi-neo-tui")]

pub mod anim;
pub mod app;
pub mod components;
pub mod compositor;
pub mod keymap;
pub mod layout;
pub mod rpc;
pub mod term;
pub mod theme;

/// Crate version, mirrored from `Cargo.toml`.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Bundled default keymap JSON source.
///
/// Embedded at compile time via [`include_str!`] so the binary stays
/// self-contained and the keymap is available even without the runtime asset
/// directory.
pub const DEFAULT_KEYMAP_JSON: &str = include_str!("../assets/keymaps/default.json");

/// Bundled default dark theme JSON source.
pub const DEFAULT_DARK_THEME_JSON: &str = include_str!("../assets/themes/senpi-neo-dark.json");
