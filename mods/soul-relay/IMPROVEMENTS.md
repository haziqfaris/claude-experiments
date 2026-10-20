# soul-relay: notes for future improvements

What real use has shown, and what to do about it. Newest first.

## 20 October 2026: the TOTO cloud session could not use soul-relay

**What happened.** The user asked a cloud session on `haziqfaris/toto-quality-inspection` to use soul-relay and to stay under 0.5% of the token budget. The session answered:

- *soul-relay:* "the plugin is enabled in `.claude/settings.json`, but it gave this session no skill or tool I could call". It handed the work to a single background agent with a fresh context instead.
- *Token budget:* "loading the session (system prompt and CLAUDE.md) took about 1% of the budget before any work began, so staying under 0.5% wasn't possible."

### 1. Repo settings do not install plugins in cloud sessions

**Cause.** The docs say so directly: *"A cloud session doesn't install the plugins a repository turns on under `enabledPlugins`, including ones from the marketplaces it lists under `extraKnownMarketplaces`"* ([cloud environments](https://code.claude.com/docs/en/cloud-environments.md)). Cloud sessions never show the workspace-trust dialog, so a project's marketplaces are never added ([plugin loading](https://code.claude.com/docs/en/plugins/loading.md)).

The entries added to TOTO's `.claude/settings.json` therefore do nothing in the cloud. They are not wasted: a **local** session opened on that repo offers the plugin once its folder is trusted.

**Ways to try, none confirmed yet:**
- [ ] An environment **setup script** that runs `claude plugin marketplace add haziqfaris/claude-experiments` and then `claude plugin install soul-relay@claude-experiments`. The docs don't say whether this works. Test it in one cloud environment first.
- [ ] Publishing soul-relay in the claude.ai **plugin catalog** for the account or organisation, if that reaches cloud sessions. Check the docs first.
- [ ] Otherwise, run work that should use soul-relay as a **local** session (desktop Code tab set to Local, or a terminal). Every soul-relay feature works there.

**To do in the docs:** say in `README.md` and `DESKTOP.md` that repo settings don't install plugins in cloud sessions, and give whichever of the routes above works.

### 2. A session told to "use soul-relay" needs to know how

Even when the mod loads, nothing tells the model **when** to delegate or which route to take. All it has is the `delegate` tool's description and the agent types' descriptions. When those are missing, as in the cloud, the session can only say that it found nothing.

- [ ] Ship a **skill** with the plugin (`skills/soul-relay/SKILL.md`): when to use `delegate` (text-only work), when to use `soul-relay:haiku-worker` or `soul-relay:sonnet-worker` (work needing tools), when to send work to a worker session, and how to report what was delegated.
- [ ] Or add a short `prompt.compose` section in sessions where the mod is loaded, so the model always has these rules.
- [ ] Have `/soul-relay` print the mod's version and which routes are available in this session (tool, agent types, workers), so "is it loaded?" has a one-command answer.

### 3. The real budget floor is CLAUDE.md, not the work

TOTO's `CLAUDE.md` is about **187 KB, roughly 45,000 tokens**. It loads into every session and every fresh-context agent before any work starts. That is why 0.5% was out of reach. No routing to cheaper models can save tokens that are spent before the first message.

- [ ] Soul Engine: show each project's **CLAUDE.md size** (bytes and estimated tokens) on the inventory, and flag anything over a threshold, say 25 KB.
- [ ] `/soul-relay`: show this session's **starting context** (from `$.session.usage()` at `session.start`), so a requested budget can be checked against what the session already spent loading.
- [ ] When a task's budget is below that floor, say so up front and suggest what would help: trimming `CLAUDE.md` (move history and long tables into `docs/` and link to them), or running the task in a session or agent that skips `CLAUDE.md`.
- [ ] Offer TOTO a trimmed `CLAUDE.md`: keep the rules and hard stops, and move the build log (steps 1–83) to `docs/Build_Log.md`. That is the user's decision, not something to do unasked.

### 4. What the session did instead is roughly what soul-relay offers

It handed the whole job to one fresh-context background agent. With the mod loaded, the same split would have run on `soul-relay:sonnet-worker` (or Haiku for the mechanical parts), cheaper than an Opus agent, and the saving would have been counted. That confirms the routes are the right shape; the gap is getting them into the session (points 1 and 2).
