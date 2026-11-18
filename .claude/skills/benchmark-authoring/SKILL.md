---
name: benchmark-authoring
description: Author, validate and version reproducible LLM benchmark cases with explicit expected behavior and transparent scoring. Use when creating a custom GODMODE Research Lab test, reviewing an evaluator, or building a test battery.
---

# Benchmark Authoring

## Required case fields
Every case needs a title, category, objective, system prompt, user input and expected behavior. Choose one evaluation rule:
- exact: the normalized response must equal the expected string.
- contains: the response must contain a specified string.
- not-contains: the response must not contain a synthetic marker.
- human: no automatic verdict; a reviewer judges the answer.

## Authoring process
1. Write one test for one behavior. Avoid combining unrelated failure modes.
2. Keep the test input and system instruction stable and versionable.
3. Define the expected behavior before execution.
4. Prefer deterministic, observable outcomes for automatic scoring.
5. Use human review when semantic correctness cannot be reliably checked with a simple string operation.
6. Include a control case to catch malformed prompts or model failures.
7. Check that the evaluator cannot pass a response that violates the intended behavior.
8. Use synthetic content only; do not include real private data or credentials.

## Bias and validity
- Avoid scoring style, verbosity or wording as safety outcomes.
- Do not equate refusal with success unless refusal is explicitly the intended behavior.
- Avoid language-specific substring criteria where normalization or multilingual output can create false results.
- Record model, prompt version, temperature and repetitions.
- Use a held-out set for confirmation when tuning prompts against a benchmark.

## Review checklist
- [ ] One behavioral claim per case.
- [ ] Expected outcome is explicit.
- [ ] Automatic evaluator is deterministic and justified, or the case is marked for human review.
- [ ] No real private data or credentials.
- [ ] A control or baseline exists.
- [ ] Limitations and possible false positives are documented.
