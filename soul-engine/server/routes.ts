// Relay: suggest which model and which chat each step of a plan should run on.
// Rules only: free, instant, and run on this machine. They suggest; nothing is sent.
import type { FlowChat, FlowSuggestion, RouteTarget, StepRoute } from '../src/types';

const RULES: { test: RegExp; model: StepRoute['model']; where: RouteTarget; why: string }[] = [
  // Judgment stays with you, in the main chat.
  { test: /\b(design|architect|decide|choose|plan|review|approve|merge|deploy|release|security|migrat|trade-?off|ux|api shape|schema)\w*/i, model: 'opus', where: 'this chat', why: 'needs judgment; keep it in the main chat' },
  // Plain writing needs no tools: one Haiku call.
  { test: /\b(changelog|release notes|commit message|readme|docs?|documentation|summar\w*|rewrite|translate|draft|e-?mail|announce\w*|copy ?edit)\b/i, model: 'haiku', where: 'haiku delegate', why: 'plain writing, no tools needed' },
  // Read-only digging: a Haiku sub-agent with tools.
  { test: /\b(find|search|locate|list|inventory|grep|read|scan|audit|look up|explore|map|collect|check where|identify)\w*/i, model: 'haiku', where: 'haiku worker', why: 'read-only search; Haiku is enough' },
  // A contained build that touches files: its own chat and branch.
  { test: /\b(build|implement|add|create|endpoint|component|page|feature|wire|integrat)\w*/i, model: 'sonnet', where: 'second chat', why: 'a focused build; run it in its own chat and worktree branch' },
  // Tests, fixes and refactors: a Sonnet sub-agent.
  { test: /\b(test|spec|fix|debug|refactor|rename|lint|type ?check|format|update dep)\w*/i, model: 'sonnet', where: 'sonnet worker', why: 'contained work with some judgment' },
];

function instructionFor(step: string, where: RouteTarget, project: string | null): string | null {
  switch (where) {
    case 'this chat': return null;
    case 'haiku delegate': return `Use the delegate tool (model haiku) for: ${step}. Pass it everything it needs in context, then check the result.`;
    case 'haiku worker': return `Use the Agent tool with subagent_type "soul-relay:haiku-worker" to: ${step}. Ask for a short report with file paths.`;
    case 'sonnet worker': return `Use the Agent tool with subagent_type "soul-relay:sonnet-worker" to: ${step}. Ask it to report what it changed.`;
    case 'second chat': return `Open a second chat${project ? ` on ${project}` : ''} with Sonnet, in its own worktree branch, and paste: "${step}. Follow the design agreed in the main chat. Commit on this branch and report back when done."`;
  }
}

export function routeStep(step: string, project: string | null = null): StepRoute {
  const rule = RULES.find((r) => r.test.test(step));
  const r = rule ?? { model: 'opus' as const, where: 'this chat' as const, why: 'no clear pattern; keep it in the main chat' };
  return { step, model: r.model, where: r.where, why: r.why, instruction: instructionFor(step, r.where, project) };
}

export function routePlan(steps: string[], project: string | null = null): StepRoute[] {
  return steps.map((s) => routeStep(s, project));
}

export function routesMarkdown(routes: StepRoute[], title: string): string {
  if (!routes.length) return `${title}\n\nNo plan found yet. Plans are read from plan mode and from to-do lists.`;
  const n = (m: string) => routes.filter((r) => r.model === m).length;
  const lines = [title, '', `${routes.length} steps: ${n('opus')} stay on Opus, ${n('sonnet')} fit Sonnet, ${n('haiku')} fit Haiku. These are suggestions; nothing is sent.`, ''];
  routes.forEach((r, i) => {
    lines.push(`${i + 1}. ${r.step}`, `   → ${r.model} · ${r.where} · ${r.why}`);
    if (r.instruction) lines.push(`   paste: ${r.instruction}`);
  });
  return lines.join('\n');
}

const EXPENSIVE = /opus|fable/;
const READ_ONLY = /\b(find|search|list|read|scan|audit|explore|summar\w*|extract|inventory|look)\b/i;

/** Suggestions across live chats: cheaper models for read-only work, fresh chats, same-folder clashes. */
export function suggestRoutes(chats: FlowChat[]): FlowSuggestion[] {
  const out: FlowSuggestion[] = [];
  const live = chats.filter((c) => c.status !== 'idle');
  for (const c of live) {
    const heavy = c.agents.filter((a) => a.kind === 'subagent' && a.model && EXPENSIVE.test(a.model) && (a.agentType === 'Explore' || READ_ONLY.test(a.label)) && a.cost);
    if (heavy.length) {
      const cost = heavy.reduce((n, a) => n + (a.cost ?? 0), 0);
      out.push({
        id: `downshift:${c.id}`, chatId: c.id, kind: 'downshift', to: 'haiku worker',
        title: `${heavy.length} read-only sub-agent${heavy.length === 1 ? '' : 's'} ran on ${heavy[0].model?.includes('fable') ? 'Fable' : 'Opus'}`,
        why: `${heavy.map((a) => a.label).slice(0, 3).join('; ')}. Haiku workers handle searching and reading well.`,
        // Haiku 4.5 output is a quarter of Opus 5.5's price; a conservative estimate.
        saving: Math.round(cost * 0.75 * 100) / 100,
        instruction: 'For read-only searching and reading, use the Agent tool with subagent_type "soul-relay:haiku-worker" instead of a general-purpose agent.',
      });
    }
    const tools = c.recentTools.slice(-30);
    const mech = tools.filter((t) => /^(Read|Grep|Glob|Bash|PowerShell)$/.test(t)).length;
    if (c.model && EXPENSIVE.test(c.model) && c.phase === 'working' && tools.length >= 20 && mech / tools.length > 0.8) {
      out.push({
        id: `mechanical:${c.id}`, chatId: c.id, kind: 'mechanical', to: 'haiku worker', saving: null,
        title: 'Long run of searching and commands on Opus',
        why: `${mech} of the last ${tools.length} tool calls were reads, searches or commands.`,
        instruction: 'Hand the remaining searching and command runs to the Agent tool with subagent_type "soul-relay:haiku-worker", and keep the decisions here.',
      });
    }
    if ((c.contextPct ?? 0) >= 80) {
      out.push({
        id: `fresh:${c.id}`, chatId: c.id, kind: 'fresh-chat', to: 'new chat', saving: null,
        title: `Context is ${Math.round(c.contextPct ?? 0)}% full`,
        why: 'Every turn now re-reads a large context. A fresh chat with a short handover is cheaper and sharper.',
        instruction: 'Write a short handover: the goal, what is done, open decisions, and the next three steps. I will start a fresh chat with it.',
      });
    }
    const prompt = c.prompt ?? '';
    if (c.model && EXPENSIVE.test(c.model) && /\b(commit message|changelog|release notes|summari[sz]e|draft (an? )?(e-?mail|message|reply|post)|rewrite|translate)\b/i.test(prompt)) {
      out.push({
        id: `text:${c.id}`, chatId: c.id, kind: 'text-task', to: 'haiku delegate', saving: null,
        title: 'A writing task on Opus',
        why: `"${prompt.slice(0, 80)}" needs no tools.`,
        instruction: 'Use the delegate tool (model haiku) for this writing task, then check the result.',
      });
    }
  }
  const byFolder = new Map<string, FlowChat[]>();
  for (const c of live.filter((x) => x.phase === 'working')) byFolder.set(c.cwd.toLowerCase(), [...(byFolder.get(c.cwd.toLowerCase()) ?? []), c]);
  for (const [, list] of byFolder) {
    if (list.length < 2) continue;
    out.push({
      id: `folder:${list[0].cwd}`, chatId: list[0].id, kind: 'same-folder', to: 'worktree', saving: null,
      title: `${list.length} chats are working in ${list[0].folder}`,
      why: 'They can edit the same files at once. Give the second one its own worktree branch.',
      instruction: 'Before editing, move this work to its own git worktree branch so it does not clash with the other chat in this folder.',
    });
  }
  return out;
}
