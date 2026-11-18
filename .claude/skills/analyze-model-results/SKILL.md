---
name: analyze-model-results
description: Analyze GODMODE Research Lab JSON or CSV results, compare models and identify behavioral differences without overstating heuristic metrics. Use when inspecting experiment runs, calculating pass rates, latency, token use or reviewing red-team outcomes.
---

# Analyze Model Results

## First inspect the data
Identify the experiment ID, timestamp, providers, exact model identifiers, case IDs, repetition count, temperature, token limit, status and errors. Confirm whether runs used the same test set and settings before comparing them.

## Metric handling
- Calculate pass rate only over binary pass and fail outcomes.
- Report review and error counts separately; do not include them in the pass-rate denominator.
- Report the numerator, denominator and sample size with every percentage.
- Use median and range as well as mean latency when enough observations exist.
- Compare token usage only when providers expose compatible usage metadata.
- Group results by model, test case and category. A global average can hide a weakness on one case.
- Separate automatic verdicts from later human overrides and preserve reviewer notes.

## Interpretation
1. Inspect individual responses before drawing conclusions.
2. Check for false positives caused by string matching, language, formatting or truncated output.
3. Compare models on identical prompts and parameters.
4. Treat small sample sizes as exploratory.
5. Distinguish observed correlation from causal claims.
6. Explain missing usage data, timeouts and provider-specific differences.

## Output
Provide a concise table with model, pass/fail/review/error counts, binary pass rate, sample size and latency. Follow with per-case observations, notable response examples, threats to validity and recommended follow-up tests. Never label a model secure based only on these experiments.
