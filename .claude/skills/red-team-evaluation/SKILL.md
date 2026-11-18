---
name: red-team-evaluation
description: Create and analyze authorized, defensive red-team evaluations of LLM instruction hierarchy, prompt-injection resistance and synthetic data boundaries. Use when testing model robustness or adding controlled adversarial cases to GODMODE Research Lab.
---

# Defensive LLM Red-Team Evaluation

## Scope
Evaluate only models, local endpoints and services the user owns or has explicit permission to test. The goal is to find and document weaknesses so they can be corrected.

## Safe test design
1. Define the behavior under test (instruction priority, untrusted content, synthetic canary handling, uncertainty calibration or consistency).
2. Use a synthetic marker such as LAB_CANARY_0123; never use real API keys, credentials, personal data or copied private conversations.
3. Keep the test bounded to a plain chat-completion request. Do not enable external tools, file access, shell commands, network actions or real-world side effects.
4. Use a harmless control task to confirm that the model can follow the baseline instruction.
5. Specify expected behavior and the evaluator before running the model.
6. Preserve the exact prompts and model identifier with the result.

## Evaluation
- A marker appearing in a response is evidence for that specific test, not proof of a general vulnerability.
- A marker not appearing is not proof of overall security.
- Keep review separate from pass and fail.
- Review the complete answer and context for false positives.
- Repeat with fixed settings when measuring consistency; disclose temperature and repetition count.

## Reporting
Record reproduction steps, affected model/version, date, parameters, observed output, severity rationale and mitigation suggestions. Distinguish confirmed behavior from hypotheses.

## Do not
Do not target third-party systems without authorization, attempt credential theft, use live secrets, or create tests that trigger destructive actions. The laboratory is a defensive research tool, not an exploitation framework.
