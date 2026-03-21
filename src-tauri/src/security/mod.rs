//! Security subsystem.
//!
//! Threats addressed:
//! - Model piracy:     `model_crypto` seals premium models with ChaCha20-Poly1305.
//! - Tampering:        `integrity` checks the binary hash at runtime.
//! - Credential leak:  `secret_store` uses the OS keyring (no plaintext on disk).
//! - License bypass:   `license` validates access against the backend on every session.

pub mod integrity;
pub mod license;
pub mod model_crypto;
pub mod secret_store;
