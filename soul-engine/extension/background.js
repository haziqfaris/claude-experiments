// REKA Soul Engine extension: reads the hub on this machine (never anything else) once a minute and shows on
// the toolbar icon how many chats are waiting for you, or that one of your sites stopped answering.
const HUBS = ['http://localhost:7777', 'http://127.0.0.1:7777'];

async function hubFetch(path) {
  for (const base of HUBS) {
    try {
      const res = await fetch(base + path, { cache: 'no-store' });
      if (res.ok) return { base, data: await res.json() };
    } catch { /* try the next address */ }
  }
  return null;
}

async function refresh() {
  const [flow, status] = await Promise.all([hubFetch('/api/flow'), hubFetch('/api/status')]);
  if (!flow && !status) {
    await chrome.storage.session.set({ hub: null, at: Date.now() });
    await chrome.action.setBadgeText({ text: '' });
    await chrome.action.setTitle({ title: 'REKA Soul Engine: the hub is not running' });
    return;
  }
  const chats = flow?.data.chats ?? [];
  const waiting = chats.filter((c) => c.phase === 'waiting').length;
  const working = chats.filter((c) => c.phase === 'working').length;
  const down = (status?.data ?? []).filter((p) => p.live.some((l) => !l.ok && !l.staging && l.source !== 'platform address')).length;
  await chrome.storage.session.set({ hub: (flow ?? status).base, flow: flow?.data ?? null, status: status?.data ?? null, at: Date.now() });
  // A site that stopped answering outranks chats waiting.
  if (down) {
    await chrome.action.setBadgeBackgroundColor({ color: '#ff6b6b' });
    await chrome.action.setBadgeText({ text: '!' });
  } else if (waiting) {
    await chrome.action.setBadgeBackgroundColor({ color: '#ffd700' });
    await chrome.action.setBadgeText({ text: String(waiting) });
  } else {
    await chrome.action.setBadgeText({ text: '' });
  }
  await chrome.action.setTitle({ title: `REKA Soul Engine: ${working} working · ${waiting} waiting for you${down ? ` · ${down} site${down === 1 ? '' : 's'} not answering` : ''}` });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  chrome.alarms.create('refresh', { periodInMinutes: 1 });
  refresh();
});
chrome.runtime.onStartup.addListener(() => { chrome.alarms.create('refresh', { periodInMinutes: 1 }); refresh(); });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'refresh') refresh(); });
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg === 'refresh') { refresh().then(() => reply(true)); return true; }
  return false;
});
