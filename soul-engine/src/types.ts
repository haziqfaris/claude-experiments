export enum SoulMood {
  IDLE = 'IDLE',
  PROCESSING = 'PROCESSING',
  CONNECTED = 'CONNECTED',
  ANALYZING = 'ANALYZING',
  HARMONIC = 'HARMONIC',
}

export interface Message {
  role: 'user' | 'system' | 'model';
  content: string;
  timestamp: number;
  meta?: string;
  /** Tools the core used for this answer, in order. */
  tools?: string[];
}

export interface OrbitNode {
  id: string;
  angle: number;
  radius: number;
  speed: number;
  type: 'data' | 'sensor' | 'interface';
  label: string;
  value: string | number;
}

// ---- Shared with the server (server/*.ts imports these) ----

export type ActivityStatus = 'active' | 'recent' | 'idle';

export interface SessionSummary {
  id: string;
  title: string;
  branch: string | null;
  model: string | null;
  entrypoint: string | null;
  status: ActivityStatus;
  startedAt: number;
  lastActivity: number;
  tokensTotal: number;
  tokensToday: number;
  outputToday: number;
  costTotal: number | null;
  costToday: number | null;
  contextTokens: number;
  contextPct: number | null;
}

export interface ProjectSnapshot {
  id: string;
  name: string;
  path: string;
  status: ActivityStatus;
  branch: string | null;
  lastActivity: number;
  sessionCount: number;
  liveSessions: number;
  tokensToday: number;
  tokensTotal: number;
  outputToday: number;
  costToday: number | null;
  costTotal: number | null;
  models: string[];
  contextPct: number | null;
  lastPrompt: string | null;
  sessions: SessionSummary[];
}

export interface Delegation {
  at: number;
  sessionId: string;
  cwd: string;
  mainModel: string;
  route: 'model' | 'subagent' | 'worker';
  target: string;
  model: string;
  task: string;
  tokens: number;
  cost: number;
  saved: number;
}

export interface RelayStats {
  countToday: number;
  costToday: number;
  savedToday: number;
  recent: Delegation[];
}

export interface Snapshot {
  generatedAt: number;
  source: 'transcripts' | 'demo';
  root: string;
  projects: ProjectSnapshot[];
  totals: {
    tokensToday: number;
    outputToday: number;
    costToday: number | null;
    liveSessions: number;
    sessions: number;
    projects: number;
    burnPerMin: number;
  };
  /** Tokens processed per minute, oldest first, last 30 minutes. */
  burn: number[];
  /** Work handed to cheaper models, as reported by the soul-relay mod. */
  relay: RelayStats;
}

export interface GitInfo {
  branch: string | null;
  dirty: string[];
  commits: { hash: string; subject: string; when: string }[];
}

export interface SessionDetail extends SessionSummary {
  prompts: { ts: number; text: string }[];
  replies: { ts: number; text: string }[];
  tools: { name: string; count: number }[];
  files: { path: string; ts: number }[];
}

export interface ProjectDetail {
  project: ProjectSnapshot;
  sessions: SessionDetail[];
  git: GitInfo | null;
  notes: { file: string; excerpt: string } | null;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AskRequest {
  question: string;
  focusId?: string | null;
  /** A project soul: answer only about this project (its repos, sessions and inventory). Empty for the main soul. */
  scope?: string | null;
  history?: ChatTurn[];
}

export type AskEvent =
  | { type: 'meta'; projects: string[]; model: string; offline: boolean }
  | { type: 'delta'; text: string }
  | { type: 'tool'; label: string }
  | { type: 'done'; usage?: { input: number; output: number; cost?: number | null; calls?: number } }
  | { type: 'error'; message: string };

// ---- Project inventory (server/inventory.ts) ----

export type InventoryCategory = 'service' | 'apikey' | 'api' | 'hosting' | 'domain' | 'email' | 'signin' | 'job' | 'default' | 'env' | 'register';

/** One fact about a project's tools or infrastructure, with where it was found. Never a secret value. */
export interface InventoryFact {
  category: InventoryCategory;
  label: string;
  value: string;
  /** Repo-relative file that shows it, for example "wrangler.jsonc:12". */
  evidence: string[];
  /** A personal or client address with the name hidden. */
  masked?: boolean;
}

export interface ProjectInventory {
  id: string;
  /** Repo or folder name. */
  name: string;
  /** The project it belongs to (projects.local.json), or its own name. */
  project: string;
  kind: string;
  path: string;
  repo: string | null;
  branch: string | null;
  scannedAt: number;
  filesScanned: number;
  /** Other folders holding a copy or worktree of the same repo. */
  alsoAt?: string[];
  facts: InventoryFact[];
}

/** A project and its repos, in display order. */
export interface InventoryGroup {
  name: string;
  kind: string;
  /** ProjectInventory ids of the repos scanned on this machine. */
  repos: string[];
  /** Repos of this project on GitHub (or in projects.local.json) that are not cloned here. */
  missing: { name: string; url: string | null }[];
}

export interface Inventory {
  scannedAt: number;
  scanning: boolean;
  /** One entry per repo (copies and worktrees merged). */
  projects: ProjectInventory[];
  groups: InventoryGroup[];
}

// ---- Relay: what each chat is doing, and where its work went ----

export type FlowAgentStatus = 'running' | 'returned' | 'failed' | 'stopped';

/** Work a chat handed off: a sub-agent, a delegate() call to a cheaper model, or a workflow. */
export interface FlowAgent {
  id: string;
  kind: 'subagent' | 'delegate' | 'workflow';
  label: string;
  agentType: string | null;
  model: string | null;
  task: string;
  status: FlowAgentStatus;
  background: boolean;
  startedAt: number;
  endedAt: number | null;
  lastActivity: number;
  tokens: number;
  cost: number | null;
  toolCalls: number;
}

export interface FlowChat {
  id: string;
  title: string;
  cwd: string;
  folder: string;
  model: string | null;
  status: ActivityStatus;
  /** 'working' while it calls tools, 'waiting' when its turn ended and it waits for you. */
  phase: 'working' | 'waiting' | 'idle';
  lastActivity: number;
  prompt: string | null;
  doing: { tool: string; detail: string; ts: number } | null;
  todos: { content: string; status: string }[];
  /** The latest plan the chat wrote (plan mode or a to-do list): the soul splits it across models and chats. */
  plan: { ts: number; steps: string[] } | null;
  contextPct: number | null;
  costToday: number | null;
  recentTools: string[];
  agents: FlowAgent[];
  /** The chat's name in Claude Code (null when it has none). */
  name: string | null;
  /** Its first ask: what it set out to do. */
  goal: string | null;
  lastReply: string | null;
  turns: number;
  filesTouched: number;
  costTotal: number | null;
  tokensToday: number;
}

export interface FlowSuggestion {
  id: string;
  chatId: string;
  kind: 'downshift' | 'mechanical' | 'fresh-chat' | 'text-task' | 'same-folder';
  title: string;
  why: string;
  to: string;
  saving: number | null;
  /** Text to paste into that chat. Nothing is sent for you. */
  instruction: string;
}

export type RouteTarget = 'this chat' | 'haiku delegate' | 'haiku worker' | 'sonnet worker' | 'second chat';

/** One plan step and where the soul suggests it runs. */
export interface StepRoute {
  step: string;
  model: 'opus' | 'sonnet' | 'haiku';
  where: RouteTarget;
  why: string;
  instruction: string | null;
}

export interface FlowGraph {
  generatedAt: number;
  chats: FlowChat[];
  /** Suggested routes for each chat's latest plan, by chat id. */
  planRoutes: Record<string, StepRoute[]>;
  suggestions: FlowSuggestion[];
  delegations: Delegation[];
  totals: { liveChats: number; running: number; returnedToday: number; handoffCostToday: number; possibleSaving: number };
}

// ---- Project status: stage in the REKA Build Flow, tasks left, live and published ----

export interface LiveCheck {
  url: string;
  /** Where the address came from: a Cloudflare route, a custom domain, a platform address, or set by you. */
  source: string;
  staging: boolean;
  status: number | null;
  ok: boolean;
  ms: number | null;
  checkedAt: number;
  /** What the page is: the app, a sign-in page, a placeholder or an error page. */
  page: { kind: 'app' | 'sign-in' | 'placeholder' | 'error' | 'none'; title: string | null };
}

export interface PhaseProgress {
  name: string;
  done: number;
  total: number;
  file: string;
}

export interface ProjectStatus {
  name: string;
  kind: string;
  /** Build Flow step 01 to 09, or null when nothing in the repos shows it. */
  stage: { step: string; name: string; nextGate: string | null; source: 'set' | 'estimated'; evidence: string[] } | null;
  tasks: { done: number; total: number; files: string[] };
  phases: PhaseProgress[];
  live: LiveCheck[];
  published: { tag: string; date: number; repo: string } | null;
  lastCommit: { date: number; subject: string; repo: string } | null;
  commits30d: number;
  repos: {
    name: string;
    path: string;
    url: string | null;
    branch: string | null;
    dirty: number;
    ahead: number | null;
    step: string | null;
    commits: number;
    commits30d: number;
    lastCommit: { date: number; subject: string } | null;
    tag: { tag: string; date: number } | null;
    tasks: { done: number; total: number };
  }[];
  note: string | null;
  next: string;
  readiness: Readiness;
  roadmap: Roadmap | null;
}

export type RoadmapItemState = 'done' | 'in progress' | 'blocked' | 'planned';

export interface RoadmapItem {
  key: string;
  id: string | null;
  title: string;
  state: RoadmapItemState;
  /** The status as the roadmap writes it ("Needs decision", "Ready", "Done 2026-10-12"). */
  status: string | null;
  owner: string | null;
  due: string | null;
  section: string;
}

export interface RoadmapSection {
  title: string;
  horizon: 'done' | 'now' | 'next' | 'later' | 'future' | 'step' | 'other';
  date: string | null;
  gate: string | null;
  state: RoadmapItemState;
  items: RoadmapItem[];
  order: number;
}

export interface Roadmap {
  repo: string;
  file: string;
  /** 'roadmap' when the project keeps one; 'plan' when the hub fell back to a build plan. */
  kind: 'roadmap' | 'plan';
  title: string | null;
  sections: RoadmapSection[];
  updated: number | null;
  history: { ts: number; hash: string; author: string; subject: string }[];
  counts: { done: number; inProgress: number; blocked: number; planned: number };
}

export interface RoadmapChanges {
  from: number | null;
  to: number;
  firstRun: boolean;
  projects: {
    project: string;
    file: string;
    commits: { ts: number; hash: string; author: string; subject: string }[];
    added: { title: string; section: string }[];
    removed: { title: string; section: string }[];
    changed: { title: string; what: 'state' | 'moved' | 'date'; from: string; to: string }[];
    gone: boolean;
  }[];
}

export type ReadinessLevel = 'not live' | 'up, not the app' | 'preview' | 'internal testing' | 'pilot / UAT' | 'ready to use' | 'in use';

export interface Readiness {
  level: ReadinessLevel;
  /** 0 to 6, for the ladder. */
  rank: number;
  source: 'set' | 'verdict' | 'stage' | 'live check';
  why: string;
  verdict: { text: string; file: string; date: number | null } | null;
  /** What the project would be at if its live address answered. */
  wouldBe: ReadinessLevel | null;
}

// ---- v4: chats, the Today feed, tasks, and messages you send into a chat ----

export type ChatState = 'working' | 'waiting' | 'idle';

export interface ChatItem extends FlowChat {
  /** The project (projects.local.json group) the chat's folder belongs to, or the folder name. */
  project: string;
  state: ChatState;
  /** The question it asked, when its last reply asks you something. */
  asked: string | null;
  steps: { text: string; done: boolean; now: boolean }[];
}

export interface FeedItem {
  at: number;
  kind: 'split' | 'merge' | 'ask' | 'commit' | 'site' | 'roadmap';
  text: string;
  project: string | null;
  chat: string | null;
}

export interface TaskItem {
  id: string;
  title: string;
  project: string;
  src: 'roadmap' | 'plan' | 'soul';
  ref: string | null;
  status: 'todo' | 'doing' | 'blocked' | 'done';
  chat: string | null;
  model: 'opus' | 'sonnet' | 'haiku';
  where: string;
  why: string | null;
  instruction: string | null;
  owner: string | null;
  due: string | null;
  saving: number | null;
}

export interface OutboxItem {
  id: string;
  session: string;
  text: string;
  at: number;
  status: 'queued' | 'delivered';
  deliveredAt: number | null;
}
