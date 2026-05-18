//! Theme system: JSON-driven semantic color tokens.
//!
//! Real loader + resolver land in T7 (Wave 2). This module exposes the
//! `Token` enum, the `ThemeSpec` / `ResolvedTheme` shapes, and `parse`
//! and `resolve` stubs so the RED tests in T2 can be compiled and locked
//! in place before T7 ships the implementation.

use std::collections::BTreeMap;

use ratatui::style::Color;
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Semantic color tokens. Mirrors the opencode token set plus the
/// senpi-neo-specific tokens called out in the design brief.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Token {
    Primary,
    Secondary,
    Error,
    Warning,
    Success,
    Info,
    Text,
    TextMuted,
    Background,
    BackgroundPanel,
    BackgroundElement,
    BackgroundMenu,
    Border,
    BorderActive,
    BorderSubtle,
    DiffAdded,
    DiffRemoved,
    DiffAddedText,
    DiffRemovedText,
    MarkdownHeading,
    MarkdownCode,
    MarkdownLink,
    MarkdownQuote,
    MarkdownList,
    SyntaxComment,
    SyntaxKeyword,
    SyntaxFunction,
    SyntaxVariable,
    SyntaxString,
    SyntaxNumber,
    SyntaxType,
    SyntaxOperator,
}

/// On-disk theme spec.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ThemeSpec {
    pub name: String,
    #[serde(rename = "type", default = "default_mode")]
    pub mode: ThemeMode,
    #[serde(default)]
    pub defs: BTreeMap<String, String>,
    pub tokens: BTreeMap<String, String>,
    #[serde(default)]
    pub options: Option<ThemeOptions>,
}

const fn default_mode() -> ThemeMode {
    ThemeMode::Dark
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeOptions {
    #[serde(default)]
    pub thinking_opacity_percent: Option<u8>,
    #[serde(default)]
    pub use_nerd_fonts: Option<bool>,
    #[serde(default)]
    pub supports_true_color: Option<bool>,
}

/// Dark vs light mode discriminator.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ThemeMode {
    Dark,
    Light,
}

/// A spec resolved into concrete RGB colors keyed by token.
#[derive(Clone, Debug)]
pub struct ResolvedTheme {
    pub name: String,
    pub mode: ThemeMode,
    pub colors: BTreeMap<Token, Color>,
    pub thinking_opacity: f32,
}

#[derive(Debug, Error)]
#[non_exhaustive]
pub enum ThemeError {
    #[error("invalid theme json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("unknown token `{0}`")]
    UnknownToken(String),
    #[error("invalid hex color `{0}`")]
    InvalidColor(String),
    #[error("required token `{0}` missing from theme")]
    MissingRequiredToken(String),
}

/// Parse a theme JSON document into a [`ThemeSpec`].
pub fn parse(input: &str) -> Result<ThemeSpec, ThemeError> {
    let spec: ThemeSpec = serde_json::from_str(input)?;
    Ok(spec)
}

/// Resolve a [`ThemeSpec`] into a [`ResolvedTheme`].
///
/// Walks the defs + tokens maps. Real implementation lands in T7; this
/// stub returns a [`ThemeError::MissingRequiredToken`] error so the T2
/// RED tests stay red until T7 switches it on.
pub fn resolve(spec: &ThemeSpec) -> Result<ResolvedTheme, ThemeError> {
    if spec.tokens.is_empty() {
        return Err(ThemeError::MissingRequiredToken("primary".into()));
    }
    if let Some(value) = spec.tokens.get("primary") {
        if !looks_like_hex_or_def(value, &spec.defs) {
            return Err(ThemeError::InvalidColor(value.clone()));
        }
    }
    // Real resolution lives in T7. Return a structural placeholder so
    // dependent code can read it without a second branch.
    Err(ThemeError::MissingRequiredToken("__t7_not_yet__".into()))
}

fn looks_like_hex_or_def(value: &str, defs: &BTreeMap<String, String>) -> bool {
    if defs.contains_key(value) {
        return true;
    }
    let hex = value.strip_prefix('#').unwrap_or(value);
    hex.chars().all(|c| c.is_ascii_hexdigit()) && (hex.len() == 6 || hex.len() == 8)
}
