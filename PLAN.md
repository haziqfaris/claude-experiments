# J.A.R.V.I.S. for Claude Code: plan

A mod plus a local hub plus a HUD dashboard to **track, monitor and manage** every Claude Code session you run. You can see token and cost burn live, and you can send work from an expensive session (Opus) to a cheaper one (Sonnet or Haiku). The cheaper session does the work and sends the result back.

> **Update:** the dashboard is now built on the REKA Soul Engine UI in [`soul-engine/`](soul-engine/README.md). It has its own hub that reads Claude Code transcripts directly, so it shows real stats before the mod exists. You can also ask it about any project; Claude answers from that project's live context. The JARVIS look in §5 is kept as an alternative design.

---

## 1. What we're building

| Piece | What it is | Runs where |
| --- | --- | --- |
| **`jarvis-relay` mod** | A Claude Code mod (function-hooks plugin) loaded into every session. It reports usage and events, adds `/jarvis` + `/delegate`, gives the model a `delegate` tool and shows an in-terminal mini HUD. | Inside each Claude Code session |
| **Hub (`jarvisd`)** | A small local daemon. It collects reports from sessions, stores history in SQLite, runs the routing policy, queues commands for sessions and streams live data to the dashboard over WebSocket. | `localhost:7777` |
| **Dashboard** | An Iron Man-style JARVIS HUD in the browser: animated arc-reactor core, a "constellation" of sessions, token-flux charts and a delegation console. | Browser, served by the hub |

```
 ┌──────────── Claude Code session A (Opus) ────────────┐
 │  jarvis-relay mod                                     │
 │   turn.complete ─► usage ──┐        ◄── result back ─┐│
 │   /delegate, delegate tool ─┼─► task ─┐               ││
 └─────────────────────────────┼─────────┼───────────────┼┘
                               ▼         ▼               │
                       ┌──────────── jarvisd hub ────────────┐
                       │ ingest API · SQLite · router policy  │──WS──► JARVIS HUD
                       │ command queue · transcript backfill  │◄─cmds─ (browser)
                       └──────────────────┬──────────────────┘
                                          ▼ task         ▲ result
                 ┌──── Claude Code session B (Haiku worker) ────┐
                 │  jarvis-relay mod: picks up task, runs it,     │
                 │  posts turn.complete text back to hub          │
                 └────────────────────────────────────────────────┘
```

---

## 2. Grounding: what the mod API gives us

These hooks and calls are confirmed in the current Claude Code mod types (build 2.1.302). The API is early access and changes between releases, so the types file is the source of truth.

| Need | Mod API |
| --- | --- |
| Per-turn token usage | `on('turn.complete')`: `next(e)` resolves `{ text, usage }` |
| Context %, rate-limit windows, session cost | `$.session.usage()`: `{ startedAt, context, rateLimits, cost }` |
| Which model the session is on | `$.session.model()` |
| Session lifecycle | `session.start`, `session.end`, `turn.start`, `tool.call` |
| Run work on a cheaper model, **no tools** | `$.model.complete({ model: 'haiku', prompt, system })`: returns `text` + `usage` |
| Run work on a cheaper model, **with tools** | `$.agent.spawn({ prompt, model: 'haiku' })`: background subagent, answer arrives on its `turn.complete` |
| Classify a prompt cheaply (for auto-routing) | `$.model.classify(text, labels, { model: 'haiku' })` |
| Message another session | `$.session.send({ to: { sessionId }, text })` |
| Put a result into a chat | `$.session.append({ message })` |
| Talk to the hub | `$.http.fetch(url, init)` (mods have no Node or sockets, so they can't host a server; the hub is a separate process) |
| Timers and polling | `$.clock` |
| Persistent per-mod data | `$.store` (≤ 4 MiB JSON) and `$.state` for live UI values |
| In-terminal UI | `$.ui.open` pane, `AbovePrompt` band, `$.ui.status`, `$.ui.toast` |
| Commands and model-callable tools | `$.command.register`, `$.tool.register`, `$.agent.register` (a `jarvis:haiku-worker` agent type) |

**Things Phase 0 has to check (not yet proven):**
1. Does `$.http.fetch` reach `http://localhost`? It goes through the host, so it may be blocked by policy.
2. Can `$.session.send({ to: { sessionId } })` reach a session in a *different* process, or only peers/teammates? If not, use the hub queue plus polling as the fallback.
3. Is there a supported way for a mod to switch the session's own model (a `$.config.set` row for model)? If not, keep `/model` manual and have the HUD recommend it.

---

## 3. Delegation: three modes

"Use a lower model for the parts that don't need a big one, then hand the result back." We build all three, from cheapest to most powerful.

### Mode 1: In-session offload (simplest, build first)
The Opus session calls the `delegate` tool, or you type `/delegate haiku <task>`.
- Text-only work (summarize, rewrite, extract, write a commit message, boilerplate) goes to `$.model.complete({ model: 'haiku' })`, and the result comes back as the tool result.
- Work that needs tools (search the repo, run tests, read files) goes to `$.agent.spawn({ model: 'haiku', subagentType: 'jarvis:haiku-worker' })`, and the subagent's answer returns to the parent.
- Cost: the Opus session pays only for the short request and the reply it reads back.

### Mode 2: Cross-session worker pool (the "switch between chats" feature)
You keep long-lived **worker sessions** pinned to cheaper models (`claude --model haiku`, `claude --model sonnet`), each with the mod loaded and registered in the hub as `role: worker`.
1. Session A sends a task with `/delegate @haiku-1 <task>`, the `delegate` tool, or by dragging it to a worker in the HUD.
2. The hub queues it. Worker B's mod polls (`$.clock`, every ~2 s) or receives it via `$.session.send`, then injects it as a prompt.
3. When B finishes, its `turn.complete` hook posts `{ taskId, text, usage }` to the hub.
4. The hub delivers the result to A via `$.session.send` / `$.session.append` (the result shows up in A's chat as a peer message) and logs the tokens it saved.
5. The HUD animates a beam from A to B and back, then shows "Saved ≈ N tokens".

Context hand-off: the task package carries the instruction plus selected context (files, the last N messages from `$.session.messages()`, or a summary written by `$.model.complete` with Haiku), so the worker doesn't need A's full history.

### Mode 3: Auto-router (opt-in)
A `prompt.submit` hook runs `$.model.classify(prompt, ['trivial','standard','deep'])` on Haiku, which costs about a cent.
- `trivial`: show a band above the prompt saying "Looks like Haiku work: route to haiku-1? [Enter] / [Esc]".
- The policy comes from `jarvis.config.json` and can be edited in the HUD: rules by keyword, file type, max tokens, and "never delegate when the context is above X%".
- **Never silent by default.** It always asks, unless you turn on per-rule auto-routing.

---

## 4. Tracking and monitoring

**Collected per session:** id, cwd/repo, git branch, model, start/last-seen time, status (`idle`, `thinking`, `tool:<name>`, `waiting-for-you`, `ended`), per-turn input/output/cache-read/cache-write tokens, cost, context %, rate-limit windows, tools used, and delegations sent and received.

**Sources:**
- **Live:** the mod pushes events to `POST /ingest` (batched every 1–2 s, with a heartbeat every 10 s).
- **Backfill:** the hub tails `~/.claude/projects/**/*.jsonl` transcripts, which record usage for each message. That gives history for sessions started before the mod existed, and for sessions without it.
- **Cloud sessions** (claude.ai/code): these can't reach your localhost. Later options are a hosted hub with a token, or reading them through the remote-sessions API.

**Budgets and alerts:** daily and per-session token and cost budgets, plus alerts when the context is above 85%, when a rate-limit window is above 80%, or when a session has been stuck in `waiting-for-you` for more than N minutes. Alerts appear as a HUD alarm, a `$.ui.toast` in the session and optionally an OS notification.

**Prices:** keep a `prices.json` keyed by model id and update it from the Anthropic pricing page. Don't hardcode prices in code. The cost of a session's own turns comes straight from `$.session.usage().cost`; the hub computes the cost of delegated `$.model.complete` calls from their `usage`.

---

## 5. The JARVIS HUD (dashboard design)

### Look and feel
- **Palette:** a near-black blue base `#02060d`, holographic cyan `#00e5ff` / `#38f3ff` as the primary color, amber `#ffb000` for warnings, red-orange `#ff3b30` for alarms, and a faint grid and scanline overlay. Everything glows (layered `box-shadow` / `drop-shadow` plus additive blending in WebGL).
- **Type:** *Orbitron* or *Rajdhani* for labels, *JetBrains Mono* for numbers, all-caps letter-spaced micro-labels ("SYS.TOKENS // LIVE").
- **Motion language:** everything assembles itself. Panels draw their border corners first, text decodes in with a scramble effect, rings spin up and numbers count up. Idle elements keep breathing slowly (a 4–6 s pulse). Respect `prefers-reduced-motion`.

### Boot sequence (≈2.5 s, skippable)
A black screen, then one cyan line sweeps across. The arc-reactor core ignites, the radial rings unfold and "J.A.R.V.I.S. ONLINE · 7 SESSIONS DETECTED" types out. Panels then slide in from the edges with a hologram flicker.

### Layout
```
┌───────────────────────────────────────────────────────────────────────┐
│ J.A.R.V.I.S.  ◢ SYS NOMINAL ◣        14:32:07  ▮▮▮▯ 5h window 62%     │
├──────────────┬────────────────────────────────────┬───────────────────┤
│ SESSIONS     │                                    │ TOKEN FLUX        │
│ ◉ api-refac  │         ╭─── orbit ring ───╮        │ ▁▂▅▇▅▃▂▁ live/min │
│   OPUS ▮▮▮▯  │     ◯ ·      ARC REACTOR     · ◯    │                   │
│ ◉ docs-fix   │   ◯   ·   [ 1.84M tok today ]  ·  ◯ │ COST TODAY        │
│   HAIKU ▮▯▯  │     ◯ ·    $ cost · ctx %    · ◯    │  ◔ $12.40 / $30   │
│ ◌ tests      │         ╰─ sessions orbit ─╯        │                   │
│   SONNET     │   ═══ beams = live delegations ═══  │ RATE LIMITS       │
├──────────────┴────────────────────────────────────┴───────────────────┤
│ DELEGATION CONSOLE  > route "write changelog" from api-refac → haiku-1 │
│ [A]──────────▶[haiku-1] ✓ 2.1k tok · saved ≈ 38k · returned 4s ago    │
└───────────────────────────────────────────────────────────────────────┘
```

### Key widgets
1. **Arc-reactor core (center, Three.js):** concentric rotating rings with segmented ticks and a glowing core whose brightness and pulse rate follow the current token burn rate. The total for today counts up in the middle.
2. **Session constellation:** each session is a node orbiting the core. The orbit radius reflects how recently it was active, node size reflects tokens used, and color reflects the model (Opus violet-white, Sonnet cyan, Haiku teal-green). A thinking session pulses, one waiting on you blinks amber, and one that ended fades and drifts outward. Click a node to zoom in for a detail panel with its transcript tail, per-turn token bars and context gauge.
3. **Delegation beams:** when a task is routed, an animated particle beam travels from the source node to the worker node. While the worker runs, it orbits the beam, and when it finishes a golden pulse returns to the source. You can drag a session onto a worker to delegate.
4. **Gauges:** radial arc gauges for context %, the 5-hour and weekly rate-limit windows, and the daily budget, with sweep animations and redline ticks.
5. **Token flux:** a streaming area chart (input / output / cache), an hour-by-day heatmap and a "tokens saved by delegation" counter.
6. **Command console:** a terminal-style bar with JARVIS-like commands (`route <task> to haiku`, `pause tests`, `budget 30`). Optional voice input with the Web Speech API ("Jarvis, send this to Haiku") and voice responses with speech synthesis.
7. **Alerts:** an edge glow plus a hex-shaped alert card that slides in; red alarms add a soft shake.

### Tech stack
- **Vite + React + TypeScript**, **react-three-fiber + drei + postprocessing** (bloom, chromatic aberration, noise) for the core and the constellation.
- **Framer Motion** for panel and layout animation, **GSAP** for the boot timeline and number count-ups.
- **SVG** for the gauges and HUD frames (crisp lines, cheap to animate), **visx** or hand-written SVG for the charts.
- **Zustand** for the store, fed by the hub WebSocket.
- Performance budget: 60 fps on a laptop iGPU, with WebGL drawing paused when the tab is hidden and a "low-power HUD" toggle.

---

## 6. Repo layout

```
claude-experiments/
  PLAN.md
  mods/jarvis-relay/
    .claude-plugin/plugin.json
    hooks/hooks.json
    hooks/register.tsx         # hooks: turn.complete, session.*, prompt.submit, command.run …
    hooks/delegate.ts          # Mode 1/2 delegation logic
    hooks/hub.ts               # batched $.http.fetch client + command polling
    hooks/hud.tsx              # in-terminal pane + AbovePrompt band
    types/index.d.ts           # $.state contract
    hooks/*.test.ts
  hub/                         # Bun or Node + Hono + better-sqlite3 + ws
    src/ingest.ts  src/queue.ts  src/router.ts  src/backfill.ts  src/ws.ts
    jarvis.config.json  prices.json
  dashboard/                   # Vite + React + r3f
    src/boot/  src/core/  src/constellation/  src/panels/  src/console/
  shared/protocol.ts           # event & command types shared by mod/hub/dashboard
```

---

## 7. Phases

| Phase | Goal | Done when |
| --- | --- | --- |
| **0. Spikes (½ day)** | Answer the three open questions in §2 | A throwaway mod proves localhost fetch, cross-session send and the model-switch path, or we pick the fallbacks |
| **1. Telemetry MVP** | The mod reports usage; the hub stores it; a plain table UI shows it | 3 concurrent sessions are visible with live tokens, cost, context % and status |
| **2. Mode 1 delegation** | `/delegate` + `delegate` tool via `$.model.complete` / `$.agent.spawn` | The Opus session delegates a summary to Haiku and gets it back inline; savings are logged |
| **3. JARVIS HUD v1** | Boot sequence, arc core, constellation, gauges, flux chart | Looks the part, 60 fps, reduced-motion fallback works |
| **4. Mode 2 worker pool** | Hub task queue, worker sessions, round trip back into the source chat, delegation beams in the HUD | A task drag-and-dropped in the HUD runs on the Haiku worker and lands in the Opus chat |
| **5. Auto-router + budgets** | `prompt.submit` classifier, policy editor, alerts | Suggestions appear in-session; budget alarms fire |
| **6. Polish** | Voice console, transcript backfill, cloud-session view, packaging (`marketplace.json`, one-command `jarvis up`) | Installs with `/plugin install jarvis-relay --marketplace haziqfaris/claude-experiments` |

---

## 8. Risks and decisions

- **Mod API is early access:** pin the Claude Code version, keep all `$` calls in `hub.ts` / `delegate.ts` so a breaking change only touches two files, and run `claude plugin validate` + `claude plugin test` in CI.
- **Quality loss when delegating:** delegation is opt-in, the HUD shows the worker's output before it is "accepted" in Mode 2, and there's a one-key "redo on Opus" option.
- **Context hand-off cost:** sending a big context to a worker can cost more than it saves. The router estimates both sides and skips delegation when savings are under ~30%.
- **Security:** the hub binds to `127.0.0.1` only, with a random token in `~/.jarvis/token` that the mod sends with every request. Transcripts stay local, and nothing leaves the machine unless you set up a hosted hub.
- **Local vs cloud sessions:** v1 targets local CLI sessions. Cloud sessions come in Phase 6.
