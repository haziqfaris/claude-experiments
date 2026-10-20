# Token-saver kit

Spend fewer tokens in Claude Code without installing anything. The kit is plain Claude Code files. It works on any account and in local chats, and when copied into a repo it works in cloud chats too.

| File | What it does |
|---|---|
| `.claude/agents/haiku-worker.md` | A worker on **Haiku** for mechanical work: finding things, reading to answer a narrow question, running tests and summarising, renames |
| `.claude/agents/sonnet-worker.md` | A worker on **Sonnet** for contained work that needs judgement: a focused refactor, tests, one bug |
| `.claude/skills/save-tokens/SKILL.md` | The rules Claude follows: what goes to which worker, read less, say less, when to `/clear` or `/compact` |
| `settings.snippet.json` | Optional: `opusplan` (Opus plans, Sonnet does the work) and Sonnet as the default model for helper agents |

It is the token-saving part of [soul-relay](../../mods/soul-relay/README.md) without the platform: no plugin, no hub, no dashboard. What you don't get: worker chats, savings tracking, and the `delegate` tool.

## Install

Pick one. The commands assume this repo is cloned to `~/claude-experiments`.

### A. In one repo: works in cloud chats too

Copy the agents and the skill into the repo's `.claude/` folder and commit them. Every chat on that repo, local or cloud, gets them.

PowerShell:
```powershell
$kit  = "$HOME\claude-experiments\kits\token-saver\.claude"
$repo = "C:\path\to\your-repo"
New-Item -ItemType Directory -Force "$repo\.claude\agents", "$repo\.claude\skills\save-tokens" | Out-Null
Copy-Item "$kit\agents\*.md" "$repo\.claude\agents\"
Copy-Item "$kit\skills\save-tokens\SKILL.md" "$repo\.claude\skills\save-tokens\"
```

macOS / Linux:
```bash
kit=~/claude-experiments/kits/token-saver/.claude
repo=/path/to/your-repo
mkdir -p "$repo/.claude/agents" "$repo/.claude/skills/save-tokens"
cp "$kit"/agents/*.md "$repo/.claude/agents/"
cp "$kit/skills/save-tokens/SKILL.md" "$repo/.claude/skills/save-tokens/"
```

Then commit `.claude/agents/` and `.claude/skills/` in that repo. Start a **new** chat for them to load.

### B. For every local chat of one account

Copy the same files into your own `.claude` folder instead of a repo's. Use the commands above with `$repo = "$HOME"` (PowerShell) or `repo=~` (macOS / Linux). This covers every project on that computer, but not cloud chats.

### C. The skill for an account, including its cloud chats

Upload the skill on claude.ai, in the settings section for skills. Skills enabled there also reach that account's cloud chats. It needs the skill as a zip:

```powershell
Compress-Archive -Path "$HOME\claude-experiments\kits\token-saver\.claude\skills\save-tokens" -DestinationPath "$HOME\save-tokens.zip"
```

Agents can't be uploaded this way. Without them, the skill tells Claude to use its own agents with `model: "haiku"` or `model: "sonnet"`, which gets you most of the same saving.

### Optional: the settings

Add the two keys from `settings.snippet.json` to a `settings.json`. **Add them to the file, don't replace it**, because it may hold other settings.

- In `~/.claude/settings.json` they apply to every local chat of that account. This is the recommended place.
- In a repo's `.claude/settings.json` they apply to every chat on that repo. A `model` set there wins over `/model` at every launch, so put it there only if everyone on the repo wants `opusplan`.
- The docs don't say whether either key is honoured in cloud chats. There, use `/model opusplan` in the chat.

## Use it

- **Just work.** Claude reaches for `haiku-worker` and `sonnet-worker` when a task fits their descriptions.
- **Turn the rules on for a task:** type `/save-tokens`, or tell Claude "save tokens on this" or "stay within a small budget".
- **Check it loaded:** type `/agents` to see the two workers. Or ask "which agents and skills do you have?"

## The biggest saving: a short CLAUDE.md

`CLAUDE.md` is loaded into every chat, and into every helper agent, before any work starts. Claude Code's own guidance is to keep it under about 200 lines. Move history, long tables and step-by-step workflows into `docs/` or into skills, which load only when needed. For example, TOTO's `CLAUDE.md` is about 187 KB, roughly 45,000 tokens per chat, which is more than most whole tasks cost.

## Good habits that cost nothing

- `/clear` when you switch to an unrelated task.
- `/compact keep the plan and open questions` when a long task continues.
- `/effort low` (or a lower effort) for routine work.
- Turn off MCP servers you don't use in that repo (`/mcp`).
- Check where the tokens go with `/usage`.

Source: Claude Code docs on [costs](https://code.claude.com/docs/en/costs.md), [subagents](https://code.claude.com/docs/en/sub-agents.md), [skills](https://code.claude.com/docs/en/skills.md) and [model configuration](https://code.claude.com/docs/en/model-config.md).
