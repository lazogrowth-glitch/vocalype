# Tauri Runtime

Native desktop runtime, Rust application logic, Tauri configuration, and
speech evaluation tooling.

- `src/`: Rust application code
- `evals/`: local evaluation tooling and datasets
  - `parakeet/`: curated manifests plus archived experiment outputs
  - `postprocess/`: current benchmark comparisons plus archived benchmark runs
- `resources/`: bundled runtime resources
- `vendor/`: vendored Rust dependencies customized for Vocalype
- `capabilities/`, `icons/`, `swift/`: platform and packaging support files
