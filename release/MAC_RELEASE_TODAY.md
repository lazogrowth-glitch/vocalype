# Release macOS Today

This repo is already close to a usable macOS release pipeline.

## What is already wired

- macOS signing and notarization environment variables are already consumed by:
  - `.github/workflows/build.yml`
- Tauri bundle config already enables:
  - hardened runtime
  - entitlements plist
  - updater artifacts
- macOS permissions are already handled in-app for:
  - microphone
  - accessibility

## What you need in GitHub Secrets

Add these repository secrets in GitHub:

- `APPLE_CERTIFICATE`
  - Base64 of your Developer ID Application `.p12`
- `APPLE_CERTIFICATE_PASSWORD`
  - Password used when exporting the `.p12`
- `KEYCHAIN_PASSWORD`
  - Any strong temporary password for the CI keychain
- `APPLE_ID`
  - Your Apple developer account email
- `APPLE_PASSWORD`
  - App-specific password for notarization
- `APPLE_TEAM_ID`
  - Your Apple Developer Team ID
- `TAURI_SIGNING_PRIVATE_KEY`
  - Private key used for Tauri updater signing
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
  - Password for the updater private key

## What to run

After pushing to GitHub:

1. Open `Actions`
2. Run `Release macOS`
3. Leave `create-release = true`
4. Wait for both macOS jobs to finish

## What you get

- signed macOS app bundles
- notarized Apple builds if the Apple secrets are valid
- draft GitHub release with uploaded assets

## Important limitations

CI can build and notarize macOS.
CI cannot truly validate first-run system prompts like:

- Accessibility approval
- possible Input Monitoring behavior
- real insertion into third-party apps

So before public launch, one manual test on a real clean Mac is still strongly recommended.

## Fastest fallback if you have no Mac

- use GitHub Actions for build/sign/notarize
- ask one friend/tester with a Mac to validate first launch and permissions
- only then publish broadly
