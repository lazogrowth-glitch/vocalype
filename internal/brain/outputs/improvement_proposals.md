# Vocalype Brain - Improvement Proposals

Date: 2026-04-23

## 1. Add result fields to action reviews

Target file: memory/experiments.md
Risk: low
Status: proposed

Current weakness: Actions and experiments can be created without a later result review.
Proposed change: Add a weekly reminder to record result, metric movement, and next decision for each completed experiment.
Expected benefit: Improves learning quality and prevents repeated unmeasured work.
Validation test: Next weekly review includes result and decision fields for each completed experiment.

## 2. Strengthen growth hook scoring

Target file: memory/growth_playbook.md
Risk: low
Status: proposed

Current weakness: Growth ideas can be generated without an explicit demo strength score.
Proposed change: Add a rule that each content idea must show the app, name the target user, and track view-to-download click rate.
Expected benefit: Keeps distribution focused on product demos instead of generic founder content.
Validation test: Generated growth reports include demo scene and metric for every idea.

## 3. Add benchmark decision threshold

Target file: memory/model_playbook.md
Risk: low
Status: proposed

Current weakness: Model recommendations can compare metrics without a minimum improvement threshold.
Proposed change: Require at least 15 percent latency improvement or 10 percent WER improvement before changing a default model.
Expected benefit: Prevents churn from tiny benchmark differences.
Validation test: Next model recommendation cites the threshold it passed.
