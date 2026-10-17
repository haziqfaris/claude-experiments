# REKA Soul Engine

A live dashboard for every Claude Code project on your machine, built on the REKA Soul Engine UI: the morphing soul core, orbiting project nodes and the Soul Protocol terminal. You can ask the terminal about any project, and it answers with Claude using that project's current context and stats.

## Run it

```bash
cd soul-engine
npm install
cp .env.example .env    # optional; or export ANTHROPIC_API_KEY yourself
export ANTHROPIC_API_KEY=sk-ant-...   # or run `ant auth login` once
npm run dev                            # hub on :7777, UI on http://localhost:3000
```

For a single process, run `npm run build && npm start`, then open http://localhost:7777.

Without Claude credentials everything still works, except that the terminal replies with a plain stats summary instead of a Claude answer. If there are no Claude Code transcripts yet, or you set `SOUL_DEMO=1`, the hub shows three simulated projects.

## Where the numbers come from

The hub (`server/`) reads Claude Code's own session transcripts in `~/.claude/projects/**/*.jsonl` (or `$CLAUDE_CONFIG_DIR/projects`). It reads them incrementally every 2 seconds and needs no setup inside Claude Code.

| Shown | Source |
| --- | --- |
| Projects | Sessions grouped by the folder they started in |
| Tokens | Each API response's `usage`: input + output + cache read + cache write, counted once per message id |
| Cost | Estimated from list prices in `server/pricing.ts`. Claude Code's own `cost-state` figure is used when it is higher |
| Context % | Tokens in the latest request ÷ the model's context window |
| Status | `active` if the last activity was under 90 s ago, `recent` if under 15 min, otherwise `idle` |
| Prompts, replies, tools, files | The newest entries in each session's transcript |
| Branch, uncommitted files, commits | `git` in the project folder, cached for 20 s |

## Asking questions

`POST /api/ask` picks the projects your question names, or the focused project, or the most recently active ones. It builds a context block from the stats table, recent prompts and replies, files touched, git state and the first part of `CLAUDE.md`/`README.md`, then streams Claude's answer back.

- Model: `claude-opus-5-5` at `low` effort, with server-side refusal fallback turned on. Override with `SOUL_MODEL` and `SOUL_EFFORT`.
- **Privacy:** asking a question sends that context, including excerpts of your recent prompts and replies, to the Claude API. Stats on their own never leave your machine. The hub listens on `127.0.0.1` only.

## Config

| Variable | Default | |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | — | Claude credentials (an `ant auth login` profile also works) |
| `SOUL_MODEL` | `claude-opus-5-5` | Model for the Soul Protocol |
| `SOUL_EFFORT` | `low` | `low` … `max` |
| `SOUL_PORT` | `7777` | Hub port (the Vite dev server proxies `/api` to it) |
| `SOUL_DAYS` | `30` | Skip transcripts untouched for longer than this |
| `SOUL_DEMO` | — | `1` forces the simulated projects |

## Layout

```
server/        hub: transcripts.ts (stats), git.ts, context.ts, ask.ts (Claude), demo.ts, index.ts (HTTP + SSE)
src/           UI: SoulCore (d3), DataOrbits, Terminal, ProjectsPanel, FocusPanel
src/types.ts   types shared by both sides
```
