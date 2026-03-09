# VocalType Release Checklist

## Release assets

Upload these files to the GitHub release for the matching tag:

- `release/latest.json`
- `src-tauri/target/release/bundle/nsis/VocalType_0.7.17_x64-setup.exe`
- `src-tauri/target/release/bundle/nsis/VocalType_0.7.17_x64-setup.exe.sig`
- `src-tauri/target/release/bundle/msi/VocalType_0.7.17_x64_en-US.msi`
- `src-tauri/target/release/bundle/msi/VocalType_0.7.17_x64_en-US.msi.sig`

## Tag and release

- Tag: `v0.7.17`
- Release title: `v0.7.17`
- Repository: `lazogrowth-glitch/vocaltype`

## Updater checks

- `src-tauri/tauri.conf.json` updater endpoint points to `https://github.com/lazogrowth-glitch/vocaltype/releases/latest/download/latest.json`
- `release/latest.json` points to the tagged NSIS installer URL
- `release/latest.json` contains the signature from `VocalType_0.7.17_x64-setup.exe.sig`

## Signing key hygiene

- Active signing key: `C:\Users\smail\.tauri\vocaltype-new.key`
- Active public key: `C:\Users\smail\.tauri\vocaltype-new.key.pub`
- Old compromised key should not exist anymore
