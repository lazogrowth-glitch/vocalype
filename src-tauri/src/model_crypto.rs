use anyhow::Result;
use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};
use rand::rngs::OsRng;
use rand::RngCore;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;

const MODEL_BLOB_MAGIC: &[u8; 8] = b"VTMENC01";
const NONCE_LEN: usize = 12;

fn cipher_from_unlock_key(unlock_key: &str) -> ChaCha20Poly1305 {
    let digest = Sha256::digest(unlock_key.as_bytes());
    let key = Key::from_slice(&digest[..32]);
    ChaCha20Poly1305::new(key)
}

pub fn encrypt_bytes(unlock_key: &str, plaintext: &[u8]) -> Result<Vec<u8>> {
    let cipher = cipher_from_unlock_key(unlock_key);
    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|err| anyhow::anyhow!("Failed to encrypt model bytes: {}", err))?;

    let mut payload = Vec::with_capacity(MODEL_BLOB_MAGIC.len() + NONCE_LEN + ciphertext.len());
    payload.extend_from_slice(MODEL_BLOB_MAGIC);
    payload.extend_from_slice(&nonce_bytes);
    payload.extend_from_slice(&ciphertext);
    Ok(payload)
}

pub fn decrypt_bytes(unlock_key: &str, payload: &[u8]) -> Result<Vec<u8>> {
    if payload.len() <= MODEL_BLOB_MAGIC.len() + NONCE_LEN {
        anyhow::bail!("Encrypted model payload is too small");
    }
    if &payload[..MODEL_BLOB_MAGIC.len()] != MODEL_BLOB_MAGIC {
        anyhow::bail!("Encrypted model payload has invalid header");
    }

    let nonce_start = MODEL_BLOB_MAGIC.len();
    let ciphertext_start = nonce_start + NONCE_LEN;
    let nonce = Nonce::from_slice(&payload[nonce_start..ciphertext_start]);
    let ciphertext = &payload[ciphertext_start..];

    cipher_from_unlock_key(unlock_key)
        .decrypt(nonce, ciphertext)
        .map_err(|err| anyhow::anyhow!("Failed to decrypt model bytes: {}", err))
}

pub fn encrypt_file(unlock_key: &str, src: &Path, dest: &Path) -> Result<()> {
    let bytes = fs::read(src)?;
    let encrypted = encrypt_bytes(unlock_key, &bytes)?;
    fs::write(dest, encrypted)?;
    Ok(())
}

pub fn decrypt_file(unlock_key: &str, src: &Path, dest: &Path) -> Result<()> {
    let payload = fs::read(src)?;
    let decrypted = decrypt_bytes(unlock_key, &payload)?;
    fs::write(dest, decrypted)?;
    Ok(())
}
