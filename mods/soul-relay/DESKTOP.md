# soul-relay with several Claude desktop chats

Each chat in the Claude desktop app's **Code** tab is its own local Claude Code session. All of them read the same `~/.claude` folder. This means:

- A plugin installed at user scope is available in every chat.
- `$.store`, which the mod uses for its worker list, is shared by every session on the machine.
- Chats on the same computer can message each other over a private local socket. Those messages never go through Anthropic's servers.

soul-relay is built on these three facts.

```
 ┌──── Chat A · Opus · payments-api ────┐          ┌──── Chat W · Haiku · payments-api ────┐
 │ /delegate @haiku-1 run the tests …   │──task──▶ │ /soul-worker  → "haiku-1"             │
 │                                      │          │ runs it with its own tools            │
 │ ◀── report arrives as a message ─────│◀─result──│ final reply is sent back on turn end  │
 └──────────────────────────────────────┘          └───────────────────────────────────────┘
          ▲                                                  ▲
          └──────── shared worker list in ~/.claude (plugin store) ┘
```

## Set it up (one time)

1. **Install the mod at user scope** from a terminal so every chat gets it. The desktop **+ › Plugins** menu adds plugins, but a marketplace has to be added from the CLI.
   ```bash
   cd path/to/claude-experiments
   claude plugin marketplace add "$(pwd)"
   claude plugin install soul-relay@claude-experiments
   ```
2. In any desktop chat that was already open, type `/reload-plugins`.
3. Check the version: type `/status` in a Code-tab chat. Mods need the desktop app's built-in Claude Code to be **2.1.286 or newer**. Cross-session messages need 2.1.224 or newer (2.1.234 on Windows).

## Use it with several chats

1. **Main chat:** open a Code-tab chat on your project and pick **Opus** in the model dropdown next to the send button (`⌘⇧I` on Mac).
2. **Worker chat:** open a second chat, on the same folder or another one. Pick **Haiku** (or Sonnet), then type:
   ```
   /soul-worker
   ```
   It answers `This session is now worker "haiku-1"…`.
3. **Check the link:** in the main chat, type `/soul-workers` and you should see `haiku-1`. `/peers` (also `/list-agents`) lists every session this chat can message.
4. **Hand off work**, in either of these ways:
   - Type it: `/delegate @haiku-1 run the test suite and summarize failures`
   - Or ask Claude: "hand the test run to the haiku worker". Claude calls the `delegate` tool with `worker: "haiku-1"`.

   Keep working in the main chat. When the worker's turn ends, its report shows up in your main chat as a message from another session, and Claude carries on with it.
5. **Watch it:** `/soul-relay` shows what's out and what was saved. The Soul Engine dashboard (`soul-engine/`) shows the savings across every chat.
6. **Done:** type `/soul-worker off` in the worker chat, or close it. A worker that hasn't checked in for 90 seconds drops off the list.

### Layouts that work well

| Layout | When |
| --- | --- |
| One Opus chat + one Haiku worker per repo | Day-to-day work: tests, searches, mechanical edits go to the worker |
| Several Opus chats + one shared Sonnet worker | Several projects at once. Tasks from different chats are all answered: one turn can handle several, and each chat gets the report |
| Opus chat + a Haiku worker in another repo | "Go check how the other service does X". The worker runs in its own folder with its own `CLAUDE.md` |

## What has been verified, and how

This was tested in a cloud container with two real Claude Code processes: the cloud session as the main chat, and a separate long-running Haiku session as the worker.

| Step | Result |
| --- | --- |
| `/soul-worker haiku-1` in the worker | Registered in the shared store; the status showed `⇄ worker haiku-1` |
| `delegate` tool with `worker: "haiku-1"` from the main session | `Sent to haiku-1 (haiku, task …)` |
| Worker receives the task | The task started a new turn there. Toast `Task … from claude-experiments`; status went to `busy` |
| Worker does the task | Haiku 5.5 used Glob and Grep and answered correctly |
| Report comes back | Delivered into the main session as a cross-session message with the usage header (`model=claude-haiku-5-5 in=… out=… cr=… cw=…`) |

Two bugs turned up and are fixed, with tests:

- Claude Code wraps every delivery in a `<cross-session-message from="…">` envelope. The mod now finds its header anywhere in the text, and replies to the envelope's `from` address, which is the sender's own inbox.
- Several chats sending to one busy worker: every task handled in a turn now gets the report, not just the last one. The turn's token usage is counted once.

## Gotchas

- **Open workers as normal chats.** A `claude` process started from inside another session (for example, from a chat's Bash tool) inherits that session's `CLAUDE_CODE_SESSION_ID`, so both look like the same session to the mod. Desktop chats and separate terminals don't have this problem. If you must script one, start it with `env -u CLAUDE_CODE_SESSION_ID claude …`.
- **Load the mod the same way in every chat.** Install it once at user scope, as above, rather than mixing `--plugin-dir` in some sessions with an installed copy in others. That way every chat shares one worker list.
- **Incoming-message setting:** `crossSessionInbound` can be `accept`, `hold` or `refuse`. A desktop chat can't show the approval dialog, so with `hold` a task waits up to `dialogExpiry` (5 minutes by default) before it is dropped. For worker chats you want `accept`. See the cross-session messaging docs.
- **Permissions stay per chat.** A worker runs tasks with its own tools and permission mode. If it needs approval for a command, the prompt appears in the worker chat, not the main one. Pick a permission mode for workers that you're comfortable with.
- **Same machine only.** Sessions in a container, in WSL, and on native Windows can't reach each other, and cloud sessions can't reach your desktop chats.
- **Status text in the desktop app isn't documented.** The mod's `⇄ …` status line and its toasts definitely show in a terminal. In desktop chats, use `/soul-relay` and `/soul-workers`, or the dashboard, if you don't see them.
- **Reports are whole replies.** The worker's entire final message is sent back, so ask for a short report.

## Not yet confirmed in the desktop app

These follow from the docs and the cloud test, but haven't been checked in the desktop app itself:

1. That every Code-tab chat binds an inbox socket. Check with `/peers` in a desktop chat, or the **Peer address** row in `/status`.
2. That plugin slash commands appear in the desktop `/` menu. Typing them works in local sessions.
3. How `$.ui.status` and `$.ui.toast` look in the desktop app.

If any of these behave differently, note it here.
