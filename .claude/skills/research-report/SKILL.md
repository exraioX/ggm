---
name: research-report
description: Produce reproducible technical reports from GODMODE Research Lab experiments, including methods, model configurations, evidence, limitations and remediation priorities. Use when the user requests a research summary, benchmark report or red-team findings.
---

# Research Report

## Required structure
1. **Title and scope** — research question, experiment ID and authorization boundary.
2. **Executive summary** — the main observation, sample size and confidence limitations.
3. **Method** — models and provider IDs, date, test-case IDs, prompts or dataset version, temperature, token cap and repetitions.
4. **Results** — pass, fail, review and error counts; binary pass rate denominator; latency and token metrics where available.
5. **Evidence** — quote only the minimum response excerpts needed and link each finding to its case and repetition.
6. **Interpretation** — explain what the results support and what they do not support.
7. **Limitations** — heuristic evaluators, sample size, provider changes, stochastic output, language and context effects.
8. **Recommendations** — mitigations and a repeatable validation plan.

## Integrity
- Preserve the difference between measured facts, manual judgments and hypotheses.
- Include failed calls and inconclusive outcomes.
- Do not claim a model is safe, unsafe or universally vulnerable based on a small test set.
- Do not invent citations, benchmark scores, model versions or statistical significance.
- Prefer JSON export for reproducibility and CSV for downstream analysis.
