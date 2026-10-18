# soul-relay

A Claude Code mod that hands work from an expensive session (Opus) to cheaper models (Haiku, Sonnet) and puts the result back into your chat. It records what each hand-off saved and reports it to the REKA Soul Engine dashboard.

## What it adds

| Route | How you use it | Runs on | Result comes back as |
| --- | --- | --- | --- |
| `delegate` tool | Claude calls it by itself for summaries, drafts, rewrites, extraction and boilerplate | One Haiku/Sonnet call, no tools | The tool result, in the same turn |
| `/delegate [haiku\|sonnet] <task>` | You type it | One Haiku/Sonnet call that also sees your last few messages | Command output, which Claude also reads |
| `soul-relay:haiku-worker`, `soul-relay:sonnet-worker` | Claude picks them in the Agent tool for tasks that need files or commands | A subagent on Haiku/Sonnet, with tools | The subagent's report |
| Worker sessions: `/delegate @haiku-1 <task>` | Another terminal running a cheap model, started with `/soul-worker` | That session, with its own tools and context | A message delivered into your chat when it finishes |

Commands:
- `/soul-worker [name|off]` makes the current session a worker, or stops it.
- `/soul-workers` lists running workers.
- `/soul-relay` shows what this session delegated and saved.

The status line shows something like `⇄ 3 delegated · saved ≈ $0.42`.

## The soul: ask about your projects inside Claude Code

When the Soul Engine hub is running (see [soul-engine](../../soul-engine/README.md)), every chat gets the soul of the project it is in. The project comes from `projects.local.json`, matched by the chat's folder. Answers run on the chat's own model, so they use your Claude subscription and no API credits. The hub does its part locally, from your transcripts and repos.

| You type or ask | What happens |
| --- | --- |
| `/soul` | Says which project's soul this chat talks to, and what every live chat is doing |
| `/soul <question>` | Hands this project's inventory to the chat, which answers here |
| "Which API keys does this project use?" | Claude calls `soul_inventory` (keys by name and the API each calls, never secret values) |
| "What changed this week?", "Draft the Access Register", "What breaks if I rotate RESEND_API_KEY?" | `soul_changes`, `soul_access_register`, `soul_rotation_checklist` |
| "Where is each project? Is it live? How much is left?" | `soul_status` (Build Flow stage, tasks and phases left, live checks, latest release) |
| "What's on our roadmap? What changed in it this month?" | `soul_roadmap` (horizons and items; with `days`, what was added, finished, moved or re-dated) |
| `/soul-roadmap` | Gives this chat the REKA roadmap format and what the soul sees now, so Claude drafts or updates `docs/ROADMAP.md` from the project's plans |
| "What are my other chats doing?" | `soul_overview` |
| The chat writes a plan (plan mode or a to-do list) | The soul suggests a model and a chat for each step, shown in the status line and a toast |
| `/soul-routes` | Shows those suggestions, with an instruction to paste for each step |

Routing is show and suggest: nothing is sent to another chat or model unless you, or Claude at your request, act on it.

## Run it, step by step

You need Claude Code 2.1.302 or newer (mods are an early-access feature), git, and, for the dashboard, Node.js 20 or newer.

1. **Get the code**
   ```bash
   git clone https://github.com/haziqfaris/claude-experiments.git
   cd claude-experiments
   git checkout claude/serene-carson-4223gc   # until it's merged
   ```

2. **Install the mod**, from that folder:
   ```bash
   claude plugin marketplace add "$(pwd)"
   claude plugin install soul-relay@claude-experiments
   ```
   Every new Claude Code session now loads it. In a session that's already open, run `/reload-plugins`. Because the install reads straight from this folder, a `git pull` followed by `/reload-plugins` picks up updates.

   To try it in one session without installing, run `claude --plugin-dir ./mods/soul-relay`.

3. **Optional: start the dashboard** in a second terminal so you can watch the savings:
   ```bash
   cd soul-engine && npm install && npm run dev   # open http://localhost:3000
   ```
   The mod reports to `http://127.0.0.1:7777` by default. Change that with `/plugin configure soul-relay@claude-experiments`, or set it to empty to turn reporting off.

4. **Use it in your main session** (for example `claude --model opus`):
   - Just work. Claude reaches for `delegate` and the worker agents when a task is simple enough.
   - Or delegate yourself: `/delegate haiku write a commit message for the staged changes`.
   - Check the tally with `/soul-relay`.

5. **Optional: add a worker session** for bigger jobs that need tools:
   ```bash
   # new terminal, same or another repo
   claude --model haiku
   > /soul-worker          # becomes "haiku-1"
   ```
   Back in the main session:
   ```
   /delegate @haiku-1 run the test suite and summarize any failures
   ```
   Claude can do the same through the `delegate` tool with `worker: "haiku-1"`, or `"any"` for the first idle worker. When the worker's turn ends, its report is sent back automatically and shows up in your main chat. Keep working in the meantime.

6. **Stop a worker** with `/soul-worker off`, or just close that session. Workers that haven't been seen for 90 seconds drop off the list.

Using several Claude desktop chats at once (an Opus chat plus Haiku worker chats)? See [DESKTOP.md](DESKTOP.md).

## How savings are counted

For every hand-off, the mod takes the cheaper model's token usage and prices it twice: at the cheaper model's list price, and at your session's model's list price. The saving is the difference. This is an estimate: it assumes the main model would have used the same tokens. It ignores the tokens the main model spends writing the hand-off and reading the result back.

## Good to know

- Workers act on tasks sent by your own Claude Code sessions on the same machine. A worker can run tools, so give it tasks you'd be happy to run in that folder, and keep its permission mode at what you're comfortable with.
- The worker's whole final reply goes back to the asking session, so ask for a concise report.
- The `delegate` tool's model has no tools and no history. Claude is told to pass everything it needs in `task` and `context`.
- Check what comes back. Cheaper models are fast and good at well-specified work, but they can be wrong.

## Develop

```bash
claude plugin validate mods/soul-relay
claude plugin test mods/soul-relay
```
