// The soul's home: one Claude Code chat you chose with /soul-home. Questions typed in the dashboard's ask bar go
// there as prompts (through the outbox), it answers with the soul_* tools on your subscription, and the hub reads
// the answer back from that chat's transcript.
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FlowChat } from '../src/types';
import { outboxGet, queueMessage } from './board';

const FILE = path.join(path.dirname(process.env.SOUL_DATA_DIR ?? path.join(os.homedir(), '.claude', 'soul-engine', 'inventory-history')), 'home.json');

export interface SoulHome { session: string; cwd: string | null; at: number }
let home: SoulHome | null = null;
let loaded = false;

export async function getHome(): Promise<SoulHome | null> {
  if (!loaded) {
    loaded = true;
    try { home = JSON.parse(await fs.readFile(FILE, 'utf8')) as SoulHome; } catch { home = null; }
  }
  return home;
}

export async function setHome(h: SoulHome | null): Promise<void> {
  home = h;
  loaded = true;
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  if (h) await fs.writeFile(FILE, JSON.stringify(h));
  else await fs.unlink(FILE).catch(() => {});
}

/** The prompt the home chat receives: the question, which soul answers, and how. */
export function questionPrompt(question: string, scope: string | null): string {
  return [
    `Question for the ${scope ? `soul of ${scope}` : 'main REKA soul'}, asked from the Soul Engine dashboard:`,
    '',
    question,
    '',
    `Answer as the soul${scope ? ` of ${scope}, about ${scope} only` : ', across every project'}. Use the soul_* tools (soul_status, soul_overview, soul_roadmap, soul_inventory, soul_changes) for facts${scope ? `, passing project "${scope}"` : ''}. ` +
      'Keep it short: under 150 words, plain sentences, a few "-" bullets at most. Your reply is shown in the dashboard as written. Do not edit files for this question.',
  ].join('\n');
}

interface Asked { id: string; outboxId: string; question: string; scope: string | null; at: number }
const asked = new Map<string, Asked>();

export async function askHome(question: string, scope: string | null): Promise<{ id: string } | { error: string }> {
  const h = await getHome();
  if (!h) return { error: 'no-home' };
  const m = queueMessage(h.session, questionPrompt(question, scope));
  asked.set(m.id, { id: m.id, outboxId: m.id, question, scope, at: m.at });
  return { id: m.id };
}

export type AskStatus = { status: 'queued' | 'delivered' | 'started' | 'thinking' | 'answered' | 'failed'; answer: string | null; chat: string | null; reason: string | null };

/** Where an asked question stands, and the home chat's reply once its turn has finished. */
export function askStatus(id: string, chats: FlowChat[], homeSession: string | null): AskStatus | null {
  const a = asked.get(id);
  const m = outboxGet(id);
  if (!a || !m) return null;
  const chat = chats.find((c) => c.id === homeSession) ?? null;
  const name = chat ? chat.name ?? chat.title : null;
  if (m.status === 'failed') return { status: 'failed', answer: null, chat: name, reason: m.reason };
  if (m.status !== 'started' || !m.startedAt) return { status: m.status, answer: null, chat: name, reason: null };
  // Answered once the home chat has written a reply after the question started and its turn is over.
  if (chat && chat.lastActivity > m.startedAt && chat.phase !== 'working' && chat.lastReply) {
    return { status: 'answered', answer: chat.lastReply, chat: name, reason: null };
  }
  return { status: 'thinking', answer: null, chat: name, reason: null };
}
