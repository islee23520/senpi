//! RPC client: subprocess `senpi --mode rpc` + JSONL line codec.
//!
//! Real client lands in T6 (Wave 2). The envelope module declares the
//! wire-level types so other modules and the RED tests in T2 can reference
//! them now.

pub mod envelope;
