# Vocalype Brain - Daily Actions

Date: 2026-04-23

## Top 5 Actions

### 1. Track first dictation success rate

Agent: product_agent
Impact: critical
Difficulty: medium
Priority score: 155

Problem: The most important activation event is not visible as a daily metric.
Why it matters: This metric tells whether product changes actually improve activation.
Expected business impact: critical
Files or areas affected: analytics, onboarding, dictation
Proposed action: Record first successful dictation per new user session without storing dictated content.
Validation test: Complete first dictation on a clean profile and verify one activation event is recorded.
Metric to measure: first_dictation_success_rate

---

### 2. Improve first successful dictation flow

Agent: product_agent
Impact: critical
Difficulty: medium
Priority score: 140

Problem: New users may not reach the first successful dictation fast enough.
Why it matters: First successful dictation is the activation event that proves Vocalype works.
Expected business impact: critical
Files or areas affected: onboarding, dictation flow
Proposed action: Remove one avoidable step between first launch and dictating text into another app.
Validation test: Fresh install user completes first successful dictation and paste in under 3 minutes.
Metric to measure: first_dictation_success_rate

---

### 3. Map first successful dictation blockers

Agent: product_agent
Impact: critical
Difficulty: medium
Priority score: 140

Problem: The activation path may contain unknown permission, model, or paste friction.
Why it matters: First successful dictation is Vocalype's most important activation event.
Expected business impact: critical
Files or areas affected: onboarding, dictation, permissions
Proposed action: Run a clean-install activation audit and record every step before first dictation.
Validation test: New profile reaches first successful dictation in under 3 minutes.
Metric to measure: first_dictation_success_rate

---

### 4. Add onboarding checklist

Agent: product_agent
Impact: high
Difficulty: medium
Priority score: 95

Problem: New users can lose track of permissions, model setup, and first dictation steps.
Why it matters: A short checklist reduces first-session confusion and support burden.
Expected business impact: high
Files or areas affected: onboarding, first-run UX
Proposed action: Add a checklist for permissions, model readiness, test dictation, and paste verification.
Validation test: Five new users follow the checklist without founder guidance.
Metric to measure: onboarding_completion_rate

---

### 5. Track trial-to-paid conversion

Agent: saas_agent
Impact: high
Difficulty: medium
Priority score: 90

Problem: Revenue work cannot be prioritized without a trial-to-paid metric.
Why it matters: Trial-to-paid conversion links activation, pricing, and checkout quality to revenue.
Expected business impact: high
Files or areas affected: pricing, checkout, analytics
Proposed action: Track trial start, upgrade click, checkout start, paid activation, and refund request.
Validation test: Run a test checkout path and verify each funnel event appears in order.
Metric to measure: trial_to_paid_conversion_rate

---

## Rejected / Low Priority

- Low priority: Add model recommendation presets (score 30)
- Low priority: Compare low-end PC performance (score 30)
