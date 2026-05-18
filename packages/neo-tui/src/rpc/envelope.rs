//! Wire-level envelope for senpi `--mode rpc` traffic.
//!
//! See `packages/coding-agent/docs/rpc.md` for the canonical protocol.
//!
//! The full event taxonomy lands in T6. This stub captures the two top-level
//! kinds (`response`, `event`) plus the shapes needed by the RED tests in T2.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

/// Envelope discriminator for messages flowing from the backend.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Envelope {
    /// Command result.
    Response(Response),
    /// Streaming event (text delta, tool call, thinking, usage, ...).
    Event(Event),
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Response {
    #[serde(default)]
    pub id: Option<String>,
    pub command: String,
    pub success: bool,
    #[serde(default)]
    pub data: Option<Value>,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Event {
    pub event: String,
    #[serde(flatten)]
    pub payload: Value,
}

#[derive(Debug, Error)]
#[non_exhaustive]
pub enum EnvelopeError {
    #[error("invalid jsonl line: {0}")]
    Json(#[from] serde_json::Error),
}

/// Parse a single JSONL line into an [`Envelope`]. T6 expands this with
/// streaming-friendly partial-line buffering.
pub fn parse_line(line: &str) -> Result<Envelope, EnvelopeError> {
    let trimmed = line.trim_end_matches(['\r', '\n']);
    let value: Envelope = serde_json::from_str(trimmed)?;
    Ok(value)
}
