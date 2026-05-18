//! `senpi-neo-tui` binary entry.
//!
//! Invoked by Node-side `senpi --neo`. Owns the terminal directly, then spawns
//! `senpi --mode rpc` as a child for the agent backend.
//!
//! The current build only prints the CLI surface. Real run loop lands in T16.

use std::process::ExitCode;

use clap::Parser;

/// CLI for `senpi-neo-tui`.
#[derive(Debug, Parser)]
#[command(
    name = "senpi-neo-tui",
    version,
    about = "Native Rust + ratatui TUI for senpi (launched via `senpi --neo`)."
)]
struct Cli {
    /// Path to the senpi backend binary to spawn for `--mode rpc`.
    ///
    /// Defaults to the value of `$SENPI_NEO_BACKEND_BIN`, then falls back to
    /// `senpi` resolved from `$PATH`.
    #[arg(long, env = "SENPI_NEO_BACKEND_BIN")]
    backend_bin: Option<String>,

    /// Forwarded argv for the backend, JSON-encoded.
    ///
    /// `senpi --neo --provider anthropic` passes
    /// `["--provider", "anthropic"]` here.
    #[arg(long, env = "SENPI_NEO_BACKEND_ARGS", default_value = "[]")]
    backend_args: String,

    /// Path to user keymap override (JSON).
    #[arg(long, env = "SENPI_NEO_KEYMAP")]
    keymap: Option<String>,

    /// Path to user theme override (JSON).
    #[arg(long, env = "SENPI_NEO_THEME")]
    theme: Option<String>,

    /// Disable all animations (skip spinners, scanners, pulses).
    #[arg(long, env = "SENPI_NEO_NO_ANIM", default_value_t = false)]
    no_animations: bool,

    /// Use inline viewport instead of alternate screen.
    #[arg(long, default_value_t = false)]
    inline: bool,
}

fn main() -> ExitCode {
    if let Err(err) = run() {
        eprintln!("senpi-neo-tui: {err:#}");
        return ExitCode::from(1);
    }
    ExitCode::SUCCESS
}

fn run() -> color_eyre::Result<()> {
    color_eyre::install()?;
    let cli = Cli::parse();
    eprintln!(
        "senpi-neo-tui v{} scaffolded (backend_bin={:?}, no_anim={}, inline={})",
        senpi_neo_tui::VERSION,
        cli.backend_bin,
        cli.no_animations,
        cli.inline
    );
    Ok(())
}
