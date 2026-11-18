---
name: research-design
description: Design controlled, reproducible experiments for LLM behavior, robustness and safety. Use when planning a research question, defining a hypothesis, selecting model baselines, or preparing a GODMODE Research Lab experiment.
---

# Research Design

## Objective
Turn a broad question about model behavior into a small, reproducible protocol with observable outcomes.

## Workflow
1. Restate the research question in one sentence.
2. Form a falsifiable hypothesis and state what result would contradict it.
3. Identify independent variables (model, provider, prompt, temperature, repetition) and dependent variables (verdict, latency, tokens, response characteristics).
4. Define a control case and a baseline before adding adversarial variants.
5. Keep model, prompt, system instruction, decoding settings and dataset version fixed when comparing one variable.
6. Select a small initial sample. Increase repetitions only when response variability is part of the question.
7. Record the exact model identifier, provider, date, parameters, test-case IDs and known limitations.
8. Separate exploratory runs from confirmatory runs. Do not silently change a test case after seeing its result.

## GODMODE Research Lab
- Use the Research Lab to select configured providers and models.
- Start with instruction-priority, synthetic-canary and deterministic-control cases.
- Use custom cases for a narrowly scoped hypothesis.
- Keep total calls within the interface limit and explain the call budget before large runs.
- Export JSON for provenance or CSV for statistical analysis.

## Quality rules
- Use only models and endpoints the user controls or is authorized to evaluate.
- Use synthetic markers, never real credentials, private records or personal data.
- Do not treat an automatic string check as a complete measure of model safety.
- Mark ambiguous criteria for human review.
- Report failures, timeouts and missing results; never discard them silently.
- Do not infer causality from a simple comparison.
