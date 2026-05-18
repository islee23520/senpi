//! Configurable keymap with leader-key sequences.
//!
//! Real lookup + merge logic land in T8 (Wave 2). This module exposes the
//! `Action` enum, the `KeymapSpec` shape, and a `parse` stub so the RED
//! tests in T2 lock the public contract first.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Every action the TUI dispatches. Default bindings live in
/// `assets/keymaps/default.json`.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Action {
    Quit,
    Cancel,
    Submit,
    Newline,
    Palette,
    ModelPicker,
    ThemePicker,
    SessionPicker,
    Help,
    SidebarToggle,
    Interrupt,
    ScrollUp,
    ScrollDown,
    PageUp,
    PageDown,
    HalfPageUp,
    HalfPageDown,
    CycleFocus,
    CycleFocusBack,
    CycleModel,
    CycleModelBack,
    CycleThinking,
    ToggleAnimations,
    ToggleConceal,
    CopyMessage,
    Leader,
    NewSession,
    Compact,
    UndoMessage,
    RedoMessage,
    Suspend,
}

/// Focus context for keymap lookup. The same key may resolve to a
/// different `Action` depending on whether we are in input/dialog mode.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FocusMode {
    Normal,
    Input,
    Dialog,
}

/// On-disk keymap spec.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct KeymapSpec {
    #[serde(default)]
    pub leader: Option<String>,
    #[serde(default)]
    pub leader_timeout_ms: Option<u32>,
    #[serde(default)]
    pub bindings: BTreeMap<String, Vec<String>>,
}

#[derive(Debug, Error)]
#[non_exhaustive]
pub enum KeymapError {
    #[error("invalid keymap json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("unknown action `{0}`")]
    UnknownAction(String),
    #[error("invalid keybind `{0}`")]
    InvalidBind(String),
}

/// Parse a keymap JSON document into a [`KeymapSpec`].
pub fn parse(input: &str) -> Result<KeymapSpec, KeymapError> {
    let spec: KeymapSpec = serde_json::from_str(input)?;
    Ok(spec)
}
