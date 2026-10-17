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

export interface FlowGraph {
  generatedAt: number;
  chats: FlowChat[];
  suggestions: FlowSuggestion[];
  delegations: Delegation[];
  totals: { liveChats: number; running: number; returnedToday: number; handoffCostToday: number; possibleSaving: number };
}
