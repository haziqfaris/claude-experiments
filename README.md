# claude-experiments

Tools for running many Claude Code sessions without losing track of them or overspending.

| Folder | What it is |
| --- | --- |
| [`soul-engine/`](soul-engine/README.md) | REKA Soul Engine: an animated live dashboard of every Claude Code project on your machine (tokens, cost, context, git). You can ask it about any project. |
| [`mods/soul-relay/`](mods/soul-relay/README.md) | A Claude Code mod that hands work to cheaper models (Haiku/Sonnet), in-session or to worker sessions, and returns the result to your chat. |
| [`kits/token-saver/`](kits/token-saver/README.md) | The token-saving part on its own: two cheap worker agents (Haiku, Sonnet) and a save-tokens skill, as plain files. No install; works on any account, and in cloud chats when copied into a repo. |
| [`PLAN.md`](PLAN.md) | The overall plan |

Quick start: see [mods/soul-relay/README.md → Run it, step by step](mods/soul-relay/README.md#run-it-step-by-step).
