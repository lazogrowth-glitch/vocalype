# Mission: Améliorer le pipeline ASR Parakeet V3

## Objectif
Réduire WER/CER/omissions/hallucinations sur EN/ES/FR/PT sans régression.

## Règles absolues
- 65% des users sont anglais — ne jamais régresser l'anglais
- Hindi retiré définitivement — ne pas réintroduire
- Toujours valider sur local 70 ET FLEURS 400 avant d'accepter
- Ne jamais accepter amélioration FLEURS si ça régresse local 70
- Ne pas changer la taille de chunk globalement (prouvé régressif)
- Ne pas faire git reset ni revert de changements inconnus

## Baselines actuelles (Recovery V2)
- Local 70:   WER 0.525%, CER 1.443%
- FLEURS 400: WER 8.009%, CER 5.523%, omissions 6.728%, hallucinations 6.353%

## Ce qui a échoué — ne pas retenter
- Chunk 20s: FLEURS WER 6.950% mais local 70 WER 4.088% (régression)
- Chunk 14s: local 70 WER 4.711%
- Chunk 10s: local 70 WER 10.162%
- Chunk 60s: FLEURS WER 6.754% mais local 70 WER 5.058%
- Corrections builtin Parakeet V3 trop agressives (retiré, remplacé par corrections ciblées)

## Ce qui est déjà implémenté — ne pas supprimer
- Recovery full-audio conditionnelle dans transcribe.rs
- Debug sample env var (VOCALYPE_EVAL_DEBUG_SAMPLE)
- Chunk env var pour expériences (VOCALYPE_EVAL_CHUNK_SECONDS)
- Nettoyages fillers de fin
- Corrections ciblées (pas builtin trop agressives)

## Pistes à explorer
- Recovery conditionnelle plus fine: retry seulement si ratio audio/texte suspect
- Déduplication assemblage chunks améliorée
- Normalisation texte prudente: nombres, ponctuation, termes techniques
- Détection fin tronquée plus précise
- Seuils recovery différents selon langue

## Validation obligatoire avant tout commit
1. cargo check --manifest-path .\src-tauri\Cargo.toml --example parakeet_pipeline_eval
2. cargo test --manifest-path .\src-tauri\Cargo.toml runtime::parakeet_text::tests --lib
3. Eval local 70 → comparer baseline
4. Eval FLEURS 400 → comparer baseline
5. Si régression → rejeter ou rendre conditionnel
