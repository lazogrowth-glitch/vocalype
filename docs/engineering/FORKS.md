# Custom Forks & Pinned Third-Party Dependencies

This file documents every dependency that is pulled from a git fork instead of
crates.io, along with the reason and the maintenance status.

---

## rdev

| Field          | Value                                                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Upstream**   | https://github.com/Narsil/rdev                                                                                                                               |
| **Fork used**  | https://github.com/rustdesk-org/rdev                                                                                                                         |
| **Pinned rev** | `a90dbe1172f8832f54c97c62e823c5a34af5fdfe`                                                                                                                   |
| **Used for**   | Global keyboard/mouse event capture (shortcut listening)                                                                                                     |
| **Why forked** | The rustdesk-org fork maintains active Windows/macOS/Linux fixes for low-level input capture that are not merged upstream. Upstream is largely unmaintained. |
| **Delta**      | Bug fixes for Windows raw input, improved macOS event tap stability.                                                                                         |
| **Status**     | ⚠️ Permanent fork — upstream unlikely to accept patches. Pin to a known-good rev and review on each major OS update.                                         |
| **To update**  | Check https://github.com/rustdesk-org/rdev/commits for new fixes, test shortcut capture on all three platforms, then bump the rev.                           |

---

## vad-rs

| Field          | Value                                                                                                                |
| -------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Upstream**   | https://github.com/nicholasgasior/vad-rs (original)                                                                  |
| **Fork used**  | https://github.com/cjpais/vad-rs                                                                                     |
| **Pinned rev** | `88b3a01f72f83a5d80d0e7ea9bacfc0d897fd03f`                                                                           |
| **Used for**   | Voice Activity Detection (Silero VAD v4 ONNX inference)                                                              |
| **Why forked** | The cjpais fork adds `default-features = false` support and updated Silero v4 compatibility not yet in the original. |
| **Delta**      | Silero VAD v4 model support, feature flag gating for minimal build.                                                  |
| **Status**     | ⚠️ Likely permanent fork — niche library with few maintainers.                                                       |
| **To update**  | Check https://github.com/cjpais/vad-rs/commits, verify VAD accuracy on speech/silence fixtures, then bump rev.       |

---

## rodio

| Field          | Value                                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Upstream**   | https://github.com/RustAudio/rodio                                                                                                               |
| **Fork used**  | https://github.com/cjpais/rodio                                                                                                                  |
| **Pinned rev** | `fed30292db417cb95305c118c0e1d804fb74cbff`                                                                                                       |
| **Used for**   | Audio feedback playback (start/stop sounds)                                                                                                      |
| **Why forked** | The cjpais fork likely includes patches for specific audio device handling or format support needed for low-latency feedback sounds.             |
| **Delta**      | TODO: document exact delta vs upstream rodio.                                                                                                    |
| **Status**     | ⚠️ Should be reviewed — upstream rodio is actively maintained. If the delta is small, consider upstreaming or switching back to crates.io rodio. |
| **To update**  | Compare with upstream rodio. If feasible, migrate back to `rodio = "0.x"` on crates.io.                                                          |

---

## tauri-nspanel

| Field         | Value                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------- |
| **Upstream**  | https://github.com/ahkohd/tauri-nspanel                                                                 |
| **Fork used** | Same upstream, pinned to branch `v2.1`                                                                  |
| **Used for**  | macOS floating panel (NSPanel) for the recording overlay                                                |
| **Why used**  | tauri-nspanel is not on crates.io; must be pulled from git. This is the canonical upstream, not a fork. |
| **Delta**     | N/A — using official upstream.                                                                          |
| **Status**    | ✅ Not a fork. Monitor https://github.com/ahkohd/tauri-nspanel/releases for v2.x updates.               |

---

## Maintenance checklist

When bumping a pinned dependency:

1. Review the commit log between old and new rev for breaking changes.
2. Build and test on all supported platforms (Windows, macOS, Linux).
3. Update the rev in `Cargo.toml` AND update the **Pinned rev** field above.
4. Run `cargo update` to refresh `Cargo.lock`.
