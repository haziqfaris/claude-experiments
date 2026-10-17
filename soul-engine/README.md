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

## Delegation savings

The [soul-relay mod](../mods/soul-relay/README.md) reports each hand-off to a cheaper model to `POST /api/delegations`. The dashboard then shows the total saved today in the top bar, the latest hand-offs in the Relay box, and the Soul Engine can answer questions about them. The hub keeps the last 300 reports in memory, so they reset when it restarts.

## Personal and community editions

- **Personal (default): subscription only.** Nothing in the hub calls the Anthropic API. Ask the soul inside Claude Code with `/soul` or in plain words; the soul-relay plugin's `soul_*` tools fetch from this hub, and the chat's own model answers on your subscription. The dashboard's ask box answers offline from the inventory and stats. An `ANTHROPIC_API_KEY` elsewhere on your machine is ignored.
- **Community (opt-in): API.** Set `SOUL_ASK_API=on` and `ANTHROPIC_API_KEY` in `.env`, and the dashboard's ask box answers through the API with its own read-only tools (billed per token). This is for people who run the dashboard without Claude Code.

`GET /api/config` reports which one is active.

## Relay: what each chat is doing

`GET /api/flow` reads every chat from the last 24 hours from its transcript: its model, what it is doing now, its latest plan (plan mode or a to-do list), and every hand-off it made (sub-agents, `delegate` calls, workflows) with the model, cost and whether it returned. For each plan it suggests a model and a chat per step, using rules in `server/routes.ts`. It also flags read-only sub-agents run on Opus, long runs of mechanical tool calls, chats with a nearly full context, and two chats working in one folder. Suggestions only; nothing is sent.

Open it in the dashboard with the **RELAY** button (`#/relay`, or `#/relay/<project>` from a project soul). Chats are on the left. The selected chat's work is laid out in three lanes, Opus, Sonnet and Haiku: the chat itself with its to-do list, every hand-off (solid cards, breathing while they run, with cost and a return marker when they come back), and the soul's suggested routes for its plan (dashed cards, each with an instruction to copy). Suggestions across chats are on the right.

The soul-relay plugin reads the same through `/api/soul/*`: `scope` (which project a folder is in), `inventory`, `plan`, `routes` and `overview`.

## Souls: one main soul, one per project

- **Main soul** (`#/`, the landing page): answers across every project. Left, every project as a card (grouped by kind, with repos, live sessions, tokens and cost, key and API counts); right, the most recent activity. Projects orbit the core; click one to open its soul.
- **Project soul** (`#/p/<project>`): its own colour and shape, its repos orbiting it, and a conversation of its own. It only answers about that project: the hub limits its context, its inventory and every tool to the project's repos, and refuses anything outside them. Left: stats, repos, and the project's Inventory, Changes and Access Register. Right: its sessions, recent files and commits.
- Projects come from `projects.local.json`. A folder Claude worked in that belongs to no project shows as its own card.
- The hub takes `?project=<name>` on `/api/inventory` (with or without `q`) and `/api/inventory/changes`.

## Asking questions

This is the community edition's ask box (`SOUL_ASK_API=on`); in the personal edition it answers offline. `POST /api/ask` picks the projects your question names, or the focused project, or the most recently active ones. It builds a context block from the stats table, recent prompts and replies, files touched, git state and the first part of `CLAUDE.md`/`README.md`, then streams Claude's answer back.

- Model: `claude-opus-5-5` at `low` effort, with server-side refusal fallback turned on. Override with `SOUL_MODEL` and `SOUL_EFFORT`.
- **Privacy:** asking a question sends that context, including excerpts of your recent prompts and replies, to the Claude API. Stats on their own never leave your machine. The hub listens on `127.0.0.1` only.

## Project inventory

Press **INVENTORY** in the top bar, or type `/find <text>` in the terminal, to search what every project runs on:

| Category | What it lists | Read from |
| --- | --- | --- |
| Tools and services | Frameworks, databases, SDKs and outside services | `package.json`, `requirements.txt`, `.env.example` names |
| API keys | Every key, token or secret **by name**, the API it is for, and the files that use it. Never the value | `.env.example`, `process.env.*`, `Deno.env.get`, CI `secrets.*` |
| APIs called | Outside APIs the code calls over HTTP, and the API behind each SDK | `https://api.…` in source, `package.json` |
| Hosting | Workers, routes and bindings, Vercel, Netlify, Docker, Supabase functions, deploy workflows | `wrangler.*`, `vercel.json`, `netlify.toml`, compose files, `.github/workflows` |
| Domains | Custom domains and platform addresses on your own domains | config files and docs |
| E-mail addresses | Senders (`noreply@…`), support, account owners and admins, demo accounts, service accounts | every text file except unit tests |
| Sign-in | Google or other OAuth, e-mail links, passwords, two-factor, personas, API keys | source files |
| Jobs and CI | GitHub workflows and schedules, Cloudflare and Vercel crons, `pg_cron` | workflows, configs, migrations |
| Defaults | Ports, Node version, regions, time zone, currency, AI models referenced | scripts, configs, source |
| Access Register | Rows of `ACCESS-REGISTER.md` where a repo keeps one (REKA Handover kit) | `docs/continuity/` |

The inventory is organised **by project, then repo**: list your projects and their repos in `projects.local.json` (copy `projects.example.json`; it is git-ignored, so client names stay on your machine). Repos nobody grouped become their own project. With the `gh` CLI signed in, your GitHub repos that are not cloned on this machine are listed under their project as "not cloned".

Every fact shows the file and line it came from. Ask the core in plain words ("which projects send e-mail from noreply@…?", "where is the Stripe key used?") and it answers from the inventory; without Claude credentials it answers with the closest matches.

### What the core can do with Claude credentials

With `SOUL_ASK_API=on` and `ANTHROPIC_API_KEY` set, the terminal answers with Claude and can use **read-only tools** when the context is not enough. It shows each step under the answer (⚙ read api/wrangler.jsonc):

| Tool | Does |
| --- | --- |
| `search_inventory`, `project_inventory` | Search the inventory, or open one project's or repo's |
| `list_files`, `search_code`, `read_file` | Look inside a repo (git-tracked files only; `.env` files refused; paths outside the repo refused; secret-looking values hidden) |
| `rescan_repo` | Re-read one repo when it changed |
| `continuity_check` | Run the REKA continuity check (the repo's own `tools/reka-handover-kit` copy, else `SOUL_CONTINUITY_CHECK`) |
| `change_report` | What changed over the last N days |
| `access_register_draft`, `rotation_checklist` | The two documents below |

Every answer shows its cost underneath (calls, tokens in and out, estimated dollars from `server/pricing.ts`), and the terminal header keeps a running total for the window.

### One-click documents and the change report

- **Access Register draft** (button on each project): services, keys by name with their API, domains, addresses found, scheduled jobs, in the shape of the REKA S13 register, with `[CONFIRM]` where a person must fill in.
- **Rotation checklist** (button on each API key): every repo, CI secret, host and file to update when that key is rotated, in order.
- **Changes** (panel header): what was added or removed in keys, APIs, services, hosting, domains, addresses, sign-in and jobs over 7, 30 or 90 days. A snapshot is saved each day the hub runs, and once a week a Markdown report is written next to them (`SOUL_DATA_DIR`, default `~/.claude/soul-engine/inventory-history`), never into this repo.

These work without Claude credentials; "Ask the core to check it" hands the draft to Claude to verify with its tools.

**Safety.** The scan is read-only and runs on your machine. It never opens `.env` files (only `.env.example` and similar, names only), and anything that looks like a password, key or token in a line is replaced with `[hidden]`. Addresses on your own domains (`SOUL_OWN_DOMAINS`) and role addresses (`noreply@`, `support@`) are shown in full; personal and client addresses are masked (`a•••@client.com`). Copies and worktrees of one repo are shown as one project. The inventory is kept in memory, rebuilt every 15 minutes or on **Rescan**, and never written into this repo. Asking a question sends the relevant part to the Claude API, like any other question.

## Config

| Variable | Default | |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | — | Claude credentials (an `ant auth login` profile also works) |
| `SOUL_MODEL` | `claude-opus-5-5` | Model for the Soul Protocol |
| `SOUL_EFFORT` | `low` | `low` … `max` |
| `SOUL_PORT` | `7777` | Hub port (the Vite dev server proxies `/api` to it) |
| `SOUL_DAYS` | `30` | Skip transcripts untouched for longer than this |
| `SOUL_DEMO` | — | `1` forces the simulated projects |
| `SOUL_INVENTORY_ROOTS` | — | Folders whose sub-folders are projects to inventory, besides those Claude Code worked in (`;` or `,` separated) |
| `SOUL_OWN_DOMAINS` | — | Your domains: addresses on them are shown in full |
| `SOUL_INVENTORY_EXCLUDE` | — | Regular expression of folders to leave out |
| `SOUL_CONTINUITY_CHECK` | — | Path to the REKA continuity check script for the `continuity_check` tool |
| `SOUL_DATA_DIR` | `~/.claude/soul-engine/inventory-history` | Where daily snapshots and weekly reports are kept |

## Layout

```
server/        hub: transcripts.ts (stats), git.ts, context.ts, ask.ts (Claude + tool loop), tools.ts (read-only tools), inventory.ts (infra, keys, tools), docs.ts (register, rotation), history.ts (snapshots, changes), demo.ts, index.ts (HTTP + SSE)
src/           UI: SoulCore (d3), DataOrbits, Terminal, ProjectsPanel, FocusPanel, InventoryPanel
src/types.ts   types shared by both sides
```
