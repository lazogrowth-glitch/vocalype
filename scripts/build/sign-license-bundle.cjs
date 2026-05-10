#!/usr/bin/env node
/**
 * sign-license-bundle.js
 *
 * SERVER-SIDE TOOL — run this on vocalype.com, never on client machines.
 *
 * Signs a Vocalype license bundle JSON with the Ed25519 private key so the
 * desktop client can verify it wasn't tampered with.
 *
 * Usage:
 *   node sign-license-bundle.js <bundle.json> [license_private.pem]
 *
 * Or require it as a module in your auth server:
 *   const { signBundle, verifyBundle } = require('./sign-license-bundle');
 *
 * Setup (one time):
 *   openssl genpkey -algorithm Ed25519 -out license_private.pem
 *   openssl pkey -in license_private.pem -pubout -out license_public.pem
 *   # Copy the 32 public key bytes into bundle_signing.rs (LICENSE_PUBLIC_KEY)
 *   openssl pkey -in license_public.pem -pubin -noout -text
 *
 * IMPORTANT: Keep license_private.pem on the server ONLY.
 *            NEVER commit it to git or ship it with the app.
 */

'use strict';

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

// ─── Core functions ──────────────────────────────────────────────────────────

/**
 * Sort all object keys recursively (must match Rust's sort_json_value).
 * This produces the exact same bytes that the client will verify against.
 */
function sortedJson(value) {
  if (Array.isArray(value)) {
    return value.map(sortedJson);
  }
  if (value !== null && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortedJson(value[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Sign a license bundle object.
 *
 * @param {object} bundle        - The bundle fields (no bundle_signature yet).
 * @param {string|Buffer} privKeyPem - PEM-encoded Ed25519 private key.
 * @returns {object} The bundle with `bundle_signature` added.
 */
function signBundle(bundle, privKeyPem) {
  // Remove any existing signature before signing.
  const { bundle_signature: _removed, ...clean } = bundle;

  // Deterministic serialisation — must match Rust's sorted_json_string().
  const payload = JSON.stringify(sortedJson(clean));

  const privateKey = crypto.createPrivateKey(privKeyPem);
  const sigBuffer  = crypto.sign(null, Buffer.from(payload, 'utf8'), privateKey);

  return { ...clean, bundle_signature: sigBuffer.toString('base64') };
}

/**
 * Verify a signed bundle (useful for testing on the server side).
 *
 * @param {object} bundle       - The bundle including bundle_signature.
 * @param {string|Buffer} pubKeyPem - PEM-encoded Ed25519 public key.
 * @returns {boolean}
 */
function verifyBundle(bundle, pubKeyPem) {
  const { bundle_signature, ...clean } = bundle;
  if (!bundle_signature) return false;

  const payload   = JSON.stringify(sortedJson(clean));
  const publicKey = crypto.createPublicKey(pubKeyPem);
  const sigBuffer = Buffer.from(bundle_signature, 'base64');

  return crypto.verify(null, Buffer.from(payload, 'utf8'), publicKey, sigBuffer);
}

// ─── CLI mode ────────────────────────────────────────────────────────────────

if (require.main === module) {
  const bundlePath = process.argv[2];
  const keyPath    = process.argv[3] || path.join(__dirname, '..', 'license_private.pem');

  if (!bundlePath) {
    console.error('Usage: node sign-license-bundle.js <bundle.json> [license_private.pem]');
    process.exit(1);
  }

  let bundle, privKeyPem;
  try {
    bundle    = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
    privKeyPem = fs.readFileSync(keyPath, 'utf8');
  } catch (err) {
    console.error('Error reading files:', err.message);
    process.exit(1);
  }

  const signed = signBundle(bundle, privKeyPem);
  const output = JSON.stringify(signed, null, 2);

  // Write signed bundle to <original>.signed.json
  const outPath = bundlePath.replace(/\.json$/, '.signed.json');
  fs.writeFileSync(outPath, output, 'utf8');

  console.log(`✅ Bundle signed → ${outPath}`);
  console.log(`   bundle_signature: ${signed.bundle_signature.slice(0, 24)}...`);
}

module.exports = { signBundle, verifyBundle, sortedJson };
