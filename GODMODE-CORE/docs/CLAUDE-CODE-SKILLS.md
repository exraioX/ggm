# Claude Code skills integration

The repository includes project-scoped Claude Code Skills under .claude/skills/. Claude Code discovers the folders when launched from the repository root. Each skill uses a SKILL.md with YAML frontmatter containing name and description.

Included skills:
- /research-design
- /red-team-evaluation
- /benchmark-authoring
- /analyze-model-results
- /research-report

## Use
1. Open a terminal at the root of ggm.
2. Run claude.
3. Invoke a skill by its slash command or ask Claude Code to use the skill that best matches the task.

No API key or runtime integration is required for these filesystem-based skills. They instruct Claude Code; the Research Lab itself remains a separate local application and stores its experiment data under ~/.godmode.

Official documentation: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview

## Relationship to ECC
The workflow emphasizes research-first planning, explicit validation, security review, reproducibility and result analysis. It is a project-specific skill set compatible with Claude Code's native skill layout; it is not a bundled copy of the complete Everything Claude Code repository.
