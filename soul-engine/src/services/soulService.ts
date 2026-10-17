import { useEffect, useState } from 'react';
import type { AskEvent, AskRequest, Inventory, ProjectDetail, Snapshot } from '../types';

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
