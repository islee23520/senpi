//! `senpi-neo-faux` — minimal faux RPC backend used by offline QA scripts.
//!
//! Reads canned scenario fixtures and emits them as JSONL on stdout so
//! `senpi-neo-tui` can be exercised without a real LLM or network round-trip.
//! Real scenarios land alongside the QA harness (T18).

use std::process::ExitCode;

fn main() -> ExitCode {
    eprintln!("senpi-neo-faux scaffolded; scenarios land in T18.");
    ExitCode::SUCCESS
}
