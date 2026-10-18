import { useEffect, useState } from 'react';
import type { AskEvent, AskRequest, ChatItem, FeedItem, FlowGraph, TaskItem, Inventory, ProjectDetail, ProjectStatus, Snapshot } from '../types';

export type LinkState = 'linking' | 'online' | 'lost';

/** Live snapshot pushed by the hub every couple of seconds. */
export function useSnapshot(): { snapshot: Snapshot | null; link: LinkState } {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [link, setLink] = useState<LinkState>('linking');

  useEffect(() => {
    const es = new EventSource('/api/events');
    es.onmessage = (e) => {
      setSnapshot(JSON.parse(e.data) as Snapshot);
      setLink('online');
    };
    es.onerror = () => setLink('lost'); // EventSource reconnects on its own
    return () => es.close();
  }, []);

  return { snapshot, link };
}

/** Detail for one project, refreshed while it stays in focus. */
export function useProjectDetail(id: string | null, every = 5000): ProjectDetail | null {
  const [detail, setDetail] = useState<ProjectDetail | null>(null);

  useEffect(() => {
    if (!id) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/project?id=${encodeURIComponent(id)}`);
        if (res.ok && !cancelled) setDetail((await res.json()) as ProjectDetail);
      } catch {
        /* hub restarting; next tick retries */
      }
    };
    load();
    const t = setInterval(load, every);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [id, every]);

  return detail;
}

/** Asks the Soul Engine; events stream back as they arrive. */
export async function querySoulEngine(
  req: AskRequest,
  onEvent: (e: AskEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch('/api/ask', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
    signal,
  });
  if (!res.ok || !res.body) {
    onEvent({ type: 'error', message: `The hub answered ${res.status}.` });
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut: number;
    while ((cut = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      for (const line of chunk.split('\n')) {
        if (line.startsWith('data: ')) onEvent(JSON.parse(line.slice(6)) as AskEvent);
      }
    }
  }
}

/** The project inventory, refreshed every 15 seconds (it changes only on a scan). */
export function useInventory(every = 15000): Inventory | null {
  const [inv, setInv] = useState<Inventory | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/inventory');
        if (res.ok && !cancelled) setInv((await res.json()) as Inventory);
      } catch { /* hub restarting */ }
    };
    load();
    const t = setInterval(load, every);
    return () => { cancelled = true; clearInterval(t); };
  }, [every]);
  return inv;
}

/** Relay: live chats, their plans and hand-offs, and routing suggestions. Refreshed every 4 seconds. */
export function useFlow(every = 4000): FlowGraph | null {
  const [flow, setFlow] = useState<FlowGraph | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/flow');
        if (res.ok && !cancelled) setFlow((await res.json()) as FlowGraph);
      } catch { /* hub restarting */ }
    };
    load();
    const t = setInterval(load, every);
    return () => { cancelled = true; clearInterval(t); };
  }, [every]);
  return flow;
}

/** Project status (stage, tasks, live, published). The hub caches it for five minutes. */
export function useStatus(every = 60000): { status: ProjectStatus[] | null; refresh: () => void } {
  const [status, setStatus] = useState<ProjectStatus[] | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const load = async (force = false) => {
      try {
        const res = await fetch(`/api/status${force ? '?refresh=1' : ''}`);
        if (res.ok && !cancelled) setStatus((await res.json()) as ProjectStatus[]);
      } catch { /* hub restarting */ }
    };
    load(tick > 0);
    const t = setInterval(() => load(), every);
    return () => { cancelled = true; clearInterval(t); };
  }, [every, tick]);
  return { status, refresh: () => setTick(n => n + 1) };
}

/** True once the hub serves a newer build than the one this page loaded (checked every 15 seconds). */
export function useNewBuild(every = 15000): boolean {
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    let first: number | null = null;
    let cancelled = false;
    const check = async () => {
      try {
        const v = (await (await fetch('/api/version', { cache: 'no-store' })).json()) as { build: number };
        if (!v.build || cancelled) return;
        if (first == null) first = v.build;
        else if (v.build !== first) setFresh(true);
      } catch { /* hub restarting: try again next time */ }
    };
    check();
    const t = setInterval(check, every);
    return () => { cancelled = true; clearInterval(t); };
  }, [every]);
  return fresh;
}

/** Polls a hub endpoint and keeps the last good answer (the hub may restart while you work). */
export function usePoll<T>(url: string, every: number): T | null {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (res.ok && !cancelled) setData((await res.json()) as T);
      } catch { /* hub restarting */ }
    };
    load();
    const t = setInterval(load, every);
    return () => { cancelled = true; clearInterval(t); };
  }, [url, every]);
  return data;
}

export const useChats = (every = 3000) => usePoll<ChatItem[]>('/api/chats', every);
export const useFeed = (every = 5000) => usePoll<FeedItem[]>('/api/feed', every);
export const useTasks = (every = 15000) => usePoll<TaskItem[]>('/api/tasks', every);

/** Sends a message into one chat through the outbox; the soul-relay plugin in that chat delivers it. */
export async function sendToChat(session: string, text: string): Promise<boolean> {
  try {
    const res = await fetch('/api/outbox', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session, text }) });
    return res.ok;
  } catch {
    return false;
  }
}
