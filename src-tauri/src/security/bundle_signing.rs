/// License bundle signature verification.
///
/// The vocalype.com backend signs every license bundle it issues with an
/// Ed25519 private key that **never leaves the server**.  The matching
/// public key is embedded here so the client can verify the bundle
/// is authentic before trusting any of its fields.
///
/// # How it works
/// 1. Server builds the bundle JSON (all fields, no `signature` key yet).
/// 2. Server serialises it deterministically (keys sorted) and signs the
///    resulting bytes with the Ed25519 private key.
/// 3. Server base64-encodes the 64-byte signature and adds it to the JSON
///    as `"bundle_signature": "<base64>"`.
/// 4. Client calls `verify_bundle_signature()` before writing or using the
///    bundle.  It strips `bundle_signature`, re-serialises the remaining
///    object with sorted keys and verifies the signature.
///
/// # Generating the keypair (server setup, ONE TIME)
/// ```bash
/// openssl genpkey -algorithm Ed25519 -out license_private.pem
/// openssl pkey -in license_private.pem -pubout -out license_public.pem
/// # Keep license_private.pem on the server ONLY — never commit it.
/// # Copy the public key bytes below.
/// openssl pkey -in license_public.pem -pubin -noout -text
/// ```
///
/// # Signing a bundle on the server (Node.js example — see scripts/sign-bundle.js)
/// ```js
/// const { createPrivateKey } = require('crypto');
/// const key = createPrivateKey(fs.readFileSync('license_private.pem'));
/// // remove bundle_signature if present, sort keys, stringify
/// const payload = stableStringify(bundleWithoutSig);
/// const sig = sign(null, Buffer.from(payload), key);
/// bundle.bundle_signature = sig.toString('base64');
/// ```
use base64::Engine as _;
use ring::signature::{UnparsedPublicKey, ED25519};
use log::warn;

/// Ed25519 public key — 32 raw bytes.
/// Replace with your real public key once you generate your keypair.
///
/// Current value was generated with:
///   openssl genpkey -algorithm Ed25519 -out license_private.pem
///   openssl pkey -in license_private.pem -pubout -out license_public.pem
///   openssl pkey -in license_public.pem -pubin -noout -text
///
/// The private key lives ONLY in the Railway/server environment variable
/// LICENSE_SIGNING_KEY (base64-encoded 32-byte Ed25519 seed).
/// It is never committed to git or shipped with the app.
const LICENSE_PUBLIC_KEY: &[u8] = &[
    0x14, 0xec, 0x3b, 0x4a, 0x8c, 0x9f, 0xeb, 0x33,
    0xe6, 0x6a, 0x08, 0x71, 0x54, 0xb9, 0x64, 0xfe,
    0x12, 0xe2, 0xae, 0x66, 0xc9, 0x98, 0x41, 0x7c,
    0x5e, 0x06, 0x6e, 0xac, 0xb7, 0xfe, 0xbc, 0x48,
];

/// `true` = bundles without a valid signature are rejected.
/// `false` = unsigned bundles are accepted with a warning (migration mode).
/// Bundles WITH an invalid signature are ALWAYS rejected regardless of this flag.
pub const ENFORCE_BUNDLE_SIGNATURE: bool = true;

/// Verify the Ed25519 signature on a license bundle JSON string.
///
/// - If the bundle contains a `bundle_signature` field: verifies it strictly.
/// - If the bundle has no `bundle_signature` field:
///   - Returns `Err` when `ENFORCE_BUNDLE_SIGNATURE` is true.
///   - Returns `Ok` with a warning when `ENFORCE_BUNDLE_SIGNATURE` is false.
///
/// The signature covers the bundle JSON with `bundle_signature` removed and
/// keys sorted alphabetically (stable serialisation).
pub fn verify_bundle_signature(bundle_json: &str) -> Result<(), String> {
    let mut parsed: serde_json::Value = serde_json::from_str(bundle_json)
        .map_err(|e| format!("Invalid license bundle JSON: {}", e))?;

    let obj = parsed
        .as_object_mut()
        .ok_or("License bundle must be a JSON object")?;

    // Extract signature before rebuilding the payload.
    let signature_b64 = obj.remove("bundle_signature");

    match signature_b64 {
        None => {
            if ENFORCE_BUNDLE_SIGNATURE {
                return Err(
                    "License bundle is missing required signature. \
                     Please re-authenticate to get a signed bundle."
                        .to_string(),
                );
            }
            warn!(
                "[license] Bundle has no signature — enforcement not yet active. \
                 Update vocalype.com to sign all issued bundles, then set \
                 ENFORCE_BUNDLE_SIGNATURE = true."
            );
            Ok(())
        }

        Some(sig_value) => {
            let sig_b64 = sig_value
                .as_str()
                .ok_or("bundle_signature must be a string")?;

            // Decode the 64-byte Ed25519 signature.
            let sig_bytes = base64::engine::general_purpose::STANDARD
                .decode(sig_b64)
                .map_err(|e| format!("Invalid bundle_signature encoding: {}", e))?;

            // Re-serialise the payload WITHOUT bundle_signature, keys sorted.
            // Must match exactly what the server signed.
            let payload = sorted_json_string(&parsed)
                .map_err(|e| format!("Failed to serialise bundle for verification: {}", e))?;

            // Verify.
            let public_key = UnparsedPublicKey::new(&ED25519, LICENSE_PUBLIC_KEY);
            public_key
                .verify(payload.as_bytes(), &sig_bytes)
                .map_err(|_| {
                    "License bundle signature is invalid. \
                     The bundle may have been tampered with."
                        .to_string()
                })
        }
    }
}

/// Serialise a JSON value with object keys sorted alphabetically at every level.
/// This produces a deterministic string that matches what the server signed.
fn sorted_json_string(value: &serde_json::Value) -> Result<String, serde_json::Error> {
    let sorted = sort_json_value(value);
    serde_json::to_string(&sorted)
}

fn sort_json_value(value: &serde_json::Value) -> serde_json::Value {
    match value {
        serde_json::Value::Object(map) => {
            let mut sorted: serde_json::Map<String, serde_json::Value> =
                serde_json::Map::new();
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            for key in keys {
                sorted.insert(key.clone(), sort_json_value(&map[key]));
            }
            serde_json::Value::Object(sorted)
        }
        serde_json::Value::Array(arr) => {
            serde_json::Value::Array(arr.iter().map(sort_json_value).collect())
        }
        other => other.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Test that bundles without a signature are rejected when enforcement is on.
    #[test]
    fn unsigned_bundle_rejected_when_enforced() {
        assert!(ENFORCE_BUNDLE_SIGNATURE, "Update this test if enforcement is disabled");
        let bundle = r#"{"plan":"premium","entitlements":["premium"]}"#;
        assert!(verify_bundle_signature(bundle).is_err());
    }

    /// Test that bundles with an obviously invalid signature are rejected.
    #[test]
    fn invalid_signature_always_rejected() {
        let bundle = r#"{"plan":"premium","bundle_signature":"aW52YWxpZA=="}"#;
        assert!(verify_bundle_signature(bundle).is_err());
    }

    /// Test sorted JSON serialisation is deterministic.
    #[test]
    fn json_sort_is_stable() {
        let a: serde_json::Value = serde_json::json!({"z": 1, "a": 2, "m": 3});
        let b: serde_json::Value = serde_json::json!({"a": 2, "m": 3, "z": 1});
        assert_eq!(sorted_json_string(&a).unwrap(), sorted_json_string(&b).unwrap());
    }
}
