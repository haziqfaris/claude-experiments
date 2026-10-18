// A quick check of the crossing rules on made-up chats: `npx tsx server/crossings.check.ts`.
import assert from 'node:assert/strict';
import { buildCrossings } from './crossings';
import type { ChatItem, Inventory } from '../src/types';

process.env.SOUL_FETCH = 'off';
const now = Date.now(), min = 60_000;
const chat = (id: string, cwd: string, project: string, state: ChatItem['state'] = 'working'): ChatItem =>
  ({ id, name: id, title: id, cwd, folder: cwd, project, state, lastActivity: now - min, phase: 'working', agents: [], steps: [] } as unknown as ChatItem);
const inv = {
  scannedAt: now, scanning: false,
  projects: [
    { id: 'grid', name: 'plexyz-grid', project: 'PLExyz', kind: 'product', path: 'C:/Dev/plexyz-grid', repo: null, branch: 'main', scannedAt: now, filesScanned: 0, facts: [], alsoAt: ['C:/Dev/plexyz-grid-wt'] },
    { id: 'ax', name: 'axframe', project: 'AX Frame', kind: 'product', path: 'C:/Dev/axframe', repo: null, branch: 'main', scannedAt: now, filesScanned: 0, facts: [] },
  ],
  groups: [{ name: 'PLExyz', kind: 'product', repos: ['grid'], missing: [] }, { name: 'AX Frame', kind: 'product', repos: ['ax'], missing: [] }],
} as Inventory;
const chats = [chat('AX', 'C:/Dev/axframe', 'AX Frame'), chat('GRID', 'C:/Dev/plexyz-grid-wt', 'PLExyz'), chat('GRID2', 'C:/Dev/plexyz-grid', 'PLExyz')];
const work = new Map([
  ['AX', { writes: [{ path: 'C:/Dev/plexyz-grid/src/a.ts', ts: now - 20 * min }], git: [{ ts: now - 10 * min, op: 'push' as const, dir: 'C:/Dev/plexyz-grid', detail: 'main', failed: false }] }],
  ['GRID', { writes: [{ path: 'C:/Dev/plexyz-grid-wt/src/b.ts', ts: now - 30 * min }], git: [] }],
  ['GRID2', { writes: [{ path: 'C:/Dev/plexyz-grid/src/a.ts', ts: now - 25 * min }], git: [{ ts: now - 5 * min, op: 'pull' as const, dir: 'C:/Dev/plexyz-grid', detail: '', failed: false }] }],
]);
const x = await buildCrossings(chats, work, inv, [], now);
const kinds = x.alerts.map((a) => `${a.kind}:${a.from}->${a.to}`);
console.log(kinds);
assert.ok(kinds.includes('pushed-under:AX->GRID'), 'GRID works in a copy of the repo AX pushed to');
assert.ok(!kinds.includes('pushed-under:AX->GRID2'), 'GRID2 pulled after the push');
assert.ok(kinds.includes('foreign:AX->null'), 'AX wrote into another project');
assert.ok(kinds.some((k) => k.startsWith('same-time:')), 'AX and GRID2 edited the same file within half an hour');
assert.equal(x.repos.find((r) => r.id === 'grid')?.hot, true);
console.log('crossings ok');
