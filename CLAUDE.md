# Project instructions for Claude Code

## Project layout
- GODMODE-CORE/ is the independent local application and its API.
- GODMODE-CORE/src/research.ts exposes the local Research Lab API.
- GODMODE-CORE/src/research-evaluation.ts contains transparent deterministic evaluators.
- GODMODE-CORE/ui/research.html, research.css and research.js implement the Research Lab page.
- G0DM0D3/ is the upstream project submodule; do not rewrite or remove it unless explicitly requested.
- .claude/skills/ contains project skills. Invoke them when their descriptions match the task.

## Development workflow
1. Inspect the current implementation before changing it.
2. Write a short plan for changes spanning multiple files.
3. Keep Research Lab isolated from chat and MCP agent execution.
4. Run npm test and npm run typecheck from GODMODE-CORE/ after backend changes.
5. Test API behavior and the browser UI with a configured test provider; do not claim an end-to-end provider test without one.
6. Keep the API bound to loopback and preserve the existing CORS and local-request protections.
7. Do not log provider secrets. Do not persist API keys in research runs.
8. Keep test prompts synthetic. Never use real credentials, private records or personal data in test cases.
9. Separate automatic verdicts, manual verdicts, errors and inconclusive outcomes.
10. Do not treat heuristic scores as security certification.

## Research safety
Research runs may send prompts to configured model providers. Only execute tests against models/endpoints that the user owns or is authorized to evaluate. Research runs do not need MCP tools, filesystem access, shell commands or external side effects.
