#!/usr/bin/env python3
"""
agent_analyze.py — Analyse un rapport eval Parakeet et produit un contexte riche pour l'agent.
Usage: python agent_analyze.py <report.json> <manifest.json> [fleurs_report.json] [fleurs_manifest.json]
"""

import json
import sys
from collections import defaultdict

def load(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)

def percent(v):
    return f"{v * 100:.3f}%"

def analyze_report(report_path, manifest_path, label="Local"):
    report = load(report_path)
    manifest = load(manifest_path)

    # Index manifest par sample_id
    ref_map = {}
    for s in manifest.get('samples', []):
        ref_map[s['sample_id']] = s

    samples = report.get('samples', [])
    agg = report.get('aggregate', {}).get('quality', {})

    lines = []
    lines.append(f"\n{'='*60}")
    lines.append(f"ANALYSE {label.upper()} — {len(samples)} samples")
    lines.append(f"{'='*60}")

    # Stats globales
    lines.append(f"\n## Stats globales")
    lines.append(f"  WER:             {percent(agg.get('global_wer', 0))}")
    lines.append(f"  CER:             {percent(agg.get('global_cer', 0))}")
    lines.append(f"  Omissions:       {percent(agg.get('global_omission_rate', 0))}")
    lines.append(f"  Hallucinations:  {percent(agg.get('global_hallucination_rate', 0))}")
    lines.append(f"  Duplications:    {percent(agg.get('global_duplication_rate', 0))}")
    lines.append(f"  End truncation:  {percent(agg.get('average_end_truncation_score', 0))}")
    lines.append(f"  Latency moy.:    {report.get('aggregate', {}).get('avg_latency_ms', 0):.0f}ms")

    # Breakdown par langue
    by_lang = defaultdict(list)
    for s in samples:
        lang = ref_map.get(s['sample_id'], {}).get('language', s.get('language', 'unknown'))
        by_lang[lang].append(s)

    lines.append(f"\n## Breakdown par langue")
    for lang in sorted(by_lang.keys()):
        lang_samples = by_lang[lang]
        n = len(lang_samples)
        avg_wer = sum(s['metrics']['wer'] for s in lang_samples) / n
        avg_cer = sum(s['metrics']['cer'] for s in lang_samples) / n
        avg_omit = sum(s['metrics']['omission_rate'] for s in lang_samples) / n
        avg_hall = sum(s['metrics']['hallucination_rate'] for s in lang_samples) / n
        lines.append(f"  [{lang.upper():3}] n={n:3}  WER={percent(avg_wer):8}  CER={percent(avg_cer):8}  Omit={percent(avg_omit):8}  Hall={percent(avg_hall):8}")

    # Breakdown par durée
    by_duration = defaultdict(list)
    for s in samples:
        dur = ref_map.get(s['sample_id'], {}).get('duration_bucket', 'unknown')
        by_duration[dur].append(s)

    if len(by_duration) > 1:
        lines.append(f"\n## Breakdown par durée")
        for dur in sorted(by_duration.keys()):
            dur_samples = by_duration[dur]
            n = len(dur_samples)
            avg_wer = sum(s['metrics']['wer'] for s in dur_samples) / n
            avg_omit = sum(s['metrics']['omission_rate'] for s in dur_samples) / n
            lines.append(f"  [{dur:12}] n={n:3}  WER={percent(avg_wer):8}  Omit={percent(avg_omit):8}")

    # Top 10 pires samples
    worst = sorted(samples, key=lambda s: s['metrics']['wer'], reverse=True)[:10]
    has_errors = [s for s in worst if s['metrics']['wer'] > 0]

    if has_errors:
        lines.append(f"\n## Top {len(has_errors)} pires samples (avec erreurs)")
        for s in has_errors:
            sid = s['sample_id']
            ref_info = ref_map.get(sid, {})
            lang = ref_info.get('language', '?')
            duration = ref_info.get('duration_bucket', '?')
            ref_text = ref_info.get('reference_text', '[ref non disponible]')
            hyp_text = s.get('hypothesis_text', '[hyp non disponible]')
            m = s['metrics']

            lines.append(f"\n  --- {sid} [{lang}/{duration}] ---")
            lines.append(f"  WER={percent(m['wer'])}  Omit={percent(m['omission_rate'])}  Hall={percent(m['hallucination_rate'])}  EndTrunc={percent(m['end_truncation_score'])}")
            lines.append(f"  REF: {ref_text[:200]}")
            lines.append(f"  HYP: {hyp_text[:200]}")

            # Mots omis/hallucinés
            omitted = [t['word'] for t in m.get('omitted_terms', [])]
            hallucinated = [t['word'] for t in m.get('hallucinated_terms', [])]
            if omitted:
                lines.append(f"  OMIS: {', '.join(omitted)}")
            if hallucinated:
                lines.append(f"  HALLUCINES: {', '.join(hallucinated)}")

    # Top termes problématiques globaux
    lines.append(f"\n## Termes les plus omis globalement")
    for t in agg.get('top_omitted_terms', [])[:8]:
        lines.append(f"  '{t['word']}' x{t['count']}")

    lines.append(f"\n## Termes les plus hallucinés globalement")
    for t in agg.get('top_hallucinated_terms', [])[:8]:
        lines.append(f"  '{t['word']}' x{t['count']}")

    return '\n'.join(lines), {
        'wer': agg.get('global_wer', 0) * 100,
        'cer': agg.get('global_cer', 0) * 100,
        'omissions': agg.get('global_omission_rate', 0) * 100,
        'hallucinations': agg.get('global_hallucination_rate', 0) * 100,
    }

def get_exploration_strategy(iteration):
    """Retourne la strategie d'exploration selon l'iteration."""
    if iteration <= 10:
        return """PHASE 1 (iter 1-10) — Fichier: parakeet_text.rs
Focus: Corrections texte, normalisation, deduplication, fillers.
Pistes prioritaires:
- Normalisation prudente nombres, ponctuation EN/FR/ES/PT
- Fillers de fin (euh, um, hmm)
- Deduplication mots repetes entre chunks
- Corrections ciblees (want/wanted, this/the, coupe/coupes)"""

    else:
        return """PHASE 2 (iter 11+) — Fichier: transcribe.rs
Focus: Pipeline recovery, detection omissions, assemblage chunks.
Pistes prioritaires:
- Recovery conditionnelle: retry seulement si ratio audio/texte suspect
- Detection fin tronquee plus precise
- Assemblage chunks sans perte de mots
- Seuils recovery differents selon langue"""

def main():
    if len(sys.argv) < 3:
        print("Usage: python agent_analyze.py <report.json> <manifest.json> [iteration] [fleurs_report.json] [fleurs_manifest.json]")
        sys.exit(1)

    report_path = sys.argv[1]
    manifest_path = sys.argv[2]
    iteration = int(sys.argv[3]) if len(sys.argv) > 3 else 1
    fleurs_report_path = sys.argv[4] if len(sys.argv) > 4 else None
    fleurs_manifest_path = sys.argv[5] if len(sys.argv) > 5 else None

    output = []
    output.append(f"# Analyse Eval Parakeet V3 — Iteration {iteration}")
    output.append(f"# Strategie: {get_exploration_strategy(iteration)}")

    # Analyse local
    local_analysis, local_stats = analyze_report(report_path, manifest_path, "Local 70")
    output.append(local_analysis)

    # Analyse FLEURS si disponible
    fleurs_stats = None
    if fleurs_report_path and fleurs_manifest_path:
        try:
            fleurs_analysis, fleurs_stats = analyze_report(fleurs_report_path, fleurs_manifest_path, "FLEURS 400")
            output.append(fleurs_analysis)
        except Exception as e:
            output.append(f"\n[FLEURS analyse indisponible: {e}]")

    # Output JSON stats pour le script PowerShell
    output.append("\n## JSON_STATS_START")
    stats = {'local': local_stats, 'fleurs': fleurs_stats}
    output.append(json.dumps(stats))
    output.append("## JSON_STATS_END")

    print('\n'.join(output))

if __name__ == '__main__':
    main()
