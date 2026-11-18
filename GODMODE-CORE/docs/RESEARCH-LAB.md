# GODMODE Research Lab

## Purpose
The Research Lab adds controlled LLM behavior experiments to GODMODE CORE. It reuses the provider registry already configured in the Core and sends plain chat-completion requests to the selected provider/model pairs.

## Features
- Built-in test cases for instruction priority, a synthetic privacy canary, untrusted document content, uncertainty calibration and a deterministic control.
- Custom test-case authoring with explicit system/user prompts and expected behavior.
- Multi-model experiments, up to six model targets, three repetitions per case and a maximum of 120 calls per run.
- Three concurrent provider calls at a time.
- Persistent local run history at ~/.godmode/research.json.
- Per-result latency and token usage when exposed by the provider.
- Transparent evaluator rules: exact string, contains, not-contains and human review.
- Manual pass/fail/review overrides with reviewer notes.
- JSON and CSV exports.

## Start
From the repository root on Windows:

    .\GODMODE-CORE\start.ps1

Open http://127.0.0.1:8765/research.html. Configure at least one provider in the Core's Provedores de IA view first. For Ollama, use a local OpenAI-compatible endpoint such as http://127.0.0.1:11434/v1, and confirm the model is installed.

## API
- GET /api/research/overview
- GET /api/research/cases
- POST /api/research/cases
- DELETE /api/research/cases/:id
- GET /api/research/runs
- POST /api/research/runs
- GET /api/research/runs/:id
- POST /api/research/runs/:id/cancel
- PATCH /api/research/runs/:runId/results/:resultId
- GET /api/research/runs/:id/export?format=json|csv

## Evaluation semantics
- pass / fail: deterministic string criteria only.
- review: semantic judgment is required; it is not silently treated as a pass.
- error: the provider call failed.
- manual verdict: a reviewer override is preserved separately from the original automatic verdict.

Pass rate uses only pass + fail results. Review and error counts are always displayed separately.

## Data and privacy
Runs and custom test cases are stored locally in ~/.godmode/research.json. Each run stores test prompts, model responses, model IDs and performance metadata. Do not put sensitive information in test prompts. Provider credentials are not copied into the research store, but provider requests are sent to the configured provider under its own data-handling policy. Local-only operation depends on using a local provider such as Ollama.

## Limits
- The runner sends plain system/user messages; it does not exercise tool calling, MCP, browser, operating-system or application-level permission boundaries.
- A not-contains evaluator checks a literal synthetic marker, not semantic disclosure.
- A passing result is not a security guarantee.
- The built-in tests are starter cases, not a comprehensive benchmark.
- Long experiments continue inside the local GODMODE CORE process; stopping the process stops in-flight work. When the Core starts again, previously running records are marked cancelled rather than appearing permanently active.
- Use only models and services you own or have permission to assess.
