---
name: save-tokens
description: Rules for keeping token use and cost low in this session - which work to hand to cheaper Haiku or Sonnet agents, how to read code without loading whole files, and when to clear or compact. Use whenever the user asks to save tokens, stay within a budget, work cheaply or efficiently, or names this skill.
---

# Save tokens

Work as the lead: plan, decide, and check. Hand the rest to cheaper models.

## Hand work to cheaper agents

| Work | Agent |
|---|---|
| Find files, callers or usages; answer a narrow question about the code; run tests or commands and summarise; mechanical edits and renames | `haiku-worker` |
| A focused refactor, writing or fixing tests, debugging one issue, a small well-described change | `sonnet-worker` |
| Design decisions, unclear requirements, reviewing the workers' results, anything risky | Yourself |

- If `haiku-worker` or `sonnet-worker` is not available, use the Agent tool with `model: "haiku"` or `model: "sonnet"`.
- Give each agent a complete, self-contained task. It does not see this conversation. Ask for a short report.
- Run independent agents in parallel. Do not repeat their work: read their report, then check only what matters.

## Read less

- Search (Grep, Glob) before opening files. Read the lines you need with an offset and limit, not whole files.
- Do not re-read a file you just edited or already have in context.
- Keep command output short: filter with `head`, `tail` or `grep`, and run quiet modes of tests and builds.

## Say less

- Keep replies short. Report results, not narration. No long summaries of what you just did.

## Keep the context small

- Suggest `/clear` when the user moves to an unrelated task, and `/compact` with a focus when a long task continues.
- If the user sets a budget below what the session has already used just to load (system prompt and CLAUDE.md), say so at the start and say what would help: a smaller `CLAUDE.md`, or a fresh session for the task.
