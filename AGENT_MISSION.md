# Agent Mission: Améliorer le pipeline ASR Parakeet V3

## Objectif
Réduire les erreurs (WER/CER/omissions/hallucinations) du pipeline ASR Parakeet V3 multilingual de Vocalype sur EN/ES/FR/PT, sans régression.

## Règles absolues
- 65% des users sont anglais. Ne jamais régresser l'anglais.
- Hindi retiré définitivement — ne pas réintroduire dans les evals Parakeet.
- Toujours comparer avant/après sur les deux datasets (local 70 + FLEURS 400).
- Ne jamais accepter une amélioration FLEURS si ça régresse local 70.
- Ne jamais accepter une amélioration local 70 si ça casse FLEURS.
- Ne pas changer globalement la taille de chunk (prouvé: régressif).
- Ne pas faire git reset ni revert de changements inconnus.
- Ne pas optimiser uniquement pour les 70 vocaux locaux (ce serait tricher).

## Fichiers cibles principaux
- `src-tauri/src/actions/transcribe.rs` — pipeline: chunking, assemblage, recovery, finalisation
- `src-tauri/src/runtime/parakeet_text.rs` — nettoyage texte, corrections, normalisation
- `src-tauri/src/runtime/parakeet_quality.rs` — diagnostics
- `src-tauri/src/runtime/chunking.rs` — profils chunking (attention: tester avant de changer)
- `src-tauri/examples/parakeet_pipeline_eval.rs` — outil d'évaluation principal

## Datasets
- Local 70: `src-tauri/evals/parakeet/dataset_manifest_combined_current.json`
- FLEURS 400 (sans Hindi): `src-tauri/evals/parakeet/external/fleurs_supported_400/dataset_manifest_external.json`

## Baselines de référence (Recovery V2 — état actuel)
- Local 70: WER 0.525%, CER 1.443%
- FLEURS 400: WER 8.009%, CER 5.523%, omissions 6.728%, hallucinations 6.353%

## Ce qui est déjà implémenté (ne pas supprimer)
- Recovery full-audio conditionnelle dans transcribe.rs
- Eval parity dans parakeet_pipeline_eval.rs
- Debug sample env var (`VOCALYPE_EVAL_DEBUG_SAMPLE`)
- Chunk env var pour expériences (`VOCALYPE_EVAL_CHUNK_SECONDS`)
- Suppression Hindi des evals
- Retrait corrections builtin Parakeet V3 trop agressives, remplacé par corrections ciblées
- Nettoyages fillers de fin

## Ce qui a échoué (ne pas re-tenter globalement)
- Chunk 20s: FLEURS mieux (WER 6.950%) mais local 70 régresse fort (WER 4.088%)
- Chunk 14s: local 70 WER 4.711%
- Chunk 10s: local 70 WER 10.162%
- Chunk 60s / full context: FLEURS WER 6.754% mais local 70 WER 5.058%

## Pistes prometteuses à explorer
1. Recovery conditionnelle plus intelligente (pas full-audio partout)
2. Détection texte suspect: ratio audio/texte bizarres, chunk vide, fin tronquée
3. Retry seulement pour cas suspects (éviter latence inutile)
4. Ajustements seuils recovery
5. Amélioration assemblage chunks + déduplication
6. Normalisation texte prudente (nombres, emails, URLs, termes techniques)
7. Analyse par langue EN/ES/FR/PT et par durée court/moyen/long
8. Stratégie adaptative: chunk plus long seulement si audio >60s ET langue non-EN

## Validation obligatoire avant chaque commit
1. `cargo check --manifest-path .\src-tauri\Cargo.toml --example parakeet_pipeline_eval`
2. `cargo test --manifest-path .\src-tauri\Cargo.toml runtime::parakeet_text::tests --lib`
3. Lancer eval local 70 → comparer baseline
4. Lancer eval FLEURS 400 → comparer baseline
5. `git diff --check`
6. Si régression sur une langue ou un type de durée → rejeter ou rendre conditionnel

## Modèle
`%APPDATA%\com.vocalype.desktop\models\parakeet-tdt-0.6b-v3-int8`
