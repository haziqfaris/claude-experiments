// Side panel: the project behind the page you are on, the chats that need you, and every project at a glance.
const LADDER = ['#6b7280', '#ff6b6b', '#c792ff', '#ffb347', '#ffe14d', '#7cff6b', '#4dffe1'];
const PALETTE = ['#ff6ad5', '#ffb347', '#7cff6b', '#6ba8ff', '#c792ff', '#ff6b6b', '#4dffe1', '#ffe14d', '#ff9f6b', '#9dff4d', '#ff4d9d', '#6bffb8'];
const STATE = { done: ['✓', '#4dffe1'], 'in progress': ['▸', '#ffe14d'], blocked: ['!', '#ff6b6b'], planned: ['·', '#9ca3af'] };

// Same colours as the dashboard: a stable hue per project name.
function hueOf(name) {
  let h = 2166136261;
  for (const ch of name) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return PALETTE[((h >>> 0) || 1) % PALETTE.length];
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function ago(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  return s < 60 ? 'now' : s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`;
}
const norm = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

/** The project whose live address is this page (host, and path for routes such as example.com/app). */
function projectForUrl(status, url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const here = (u.host + u.pathname).toLowerCase();
  let best = null;
  for (const p of status ?? []) {
    for (const l of p.live) {
      const a = l.url.toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
      if ((here === a || here === `${a}/` || here.startsWith(`${a}/`)) && (!best || a.length > best.len)) best = { p, len: a.length };
    }
  }
  return best?.p ?? null;
}

function projectCard(p, open) {
  const hue = hueOf(p.name);
  const r = p.readiness;
  const rm = p.roadmap && p.roadmap.kind === 'roadmap' ? p.roadmap : null;
  const now = rm?.sections.find((s) => s.state !== 'done' && s.items.some((i) => i.state !== 'done'));
  const up = p.live.filter((l) => !l.staging && l.ok).length;
  return `<div class="card" style="border-left-color:${hue}">
    <div class="row"><span class="name">${esc(p.name)}</span><span class="right small" style="color:${hue}">${esc(p.stage ? `${p.stage.step} ${p.stage.name}` : '')}</span></div>
    <div class="row small"><span class="dot" style="background:${LADDER[r.rank]}"></span><span style="color:${LADDER[r.rank]}">${esc(r.level)}</span><span class="muted">· ${up ? `${up} live` : p.live.length ? 'not answering' : 'no address'}</span></div>
    ${r.verdict ? `<div class="small muted clip">“${esc(r.verdict.text)}”</div>` : ''}
    ${open && now ? `<div class="small" style="margin-top:6px;color:${hue}">${esc(now.title)}</div><ul class="items">${now.items.filter((i) => i.state !== 'done').slice(0, 6).map((i) => `<li><span style="color:${STATE[i.state][1]}">${STATE[i.state][0]}</span><span class="clip">${esc(i.id ? `${i.id} ` : '')}${esc(i.title)}</span></li>`).join('')}</ul>` : ''}
    <div class="small clip" style="margin-top:4px">${esc(p.next)}</div>
  </div>`;
}

async function render() {
  const main = document.getElementById('main');
  const { hub, flow, status, at } = await chrome.storage.session.get(['hub', 'flow', 'status', 'at']);
  if (!hub) {
    main.innerHTML = `<p>The Soul Engine hub is not running.</p><p class="muted small">Start it with <code>npm run start</code> in soul-engine, or turn on auto-start with <code>npm run autostart</code>.</p>`;
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const here = tab?.url ? projectForUrl(status, tab.url) : null;
  const chats = (flow?.chats ?? []).filter((c) => c.phase !== 'idle');
  const parts = [];
  if (here) parts.push(`<section><h2>This site</h2>${projectCard(here, true)}</section>`);
  parts.push(`<section><h2>Chats · ${chats.filter((c) => c.phase === 'waiting').length} waiting for you</h2>${chats.length ? chats.map((c) => `
    <div class="card" style="border-left-color:${c.phase === 'waiting' ? '#ffd700' : '#00f2ff'}">
      <div class="row small"><span class="dot" style="background:${c.phase === 'waiting' ? '#ffd700' : '#00f2ff'}"></span><span>${c.phase === 'waiting' ? 'waiting for you' : 'working'}</span><span class="right muted">${esc(c.folder)} · ${ago(c.lastActivity)}</span></div>
      <div class="clip">${esc(c.title)}</div>
      ${c.doing && c.phase === 'working' ? `<div class="small muted clip">${esc(c.doing.tool)}${c.doing.detail ? ` · ${esc(c.doing.detail)}` : ''}</div>` : ''}
    </div>`).join('') : '<p class="muted small">No chat is working or waiting.</p>'}</section>`);
  const list = [...(status ?? [])].sort((a, b) => b.readiness.rank - a.readiness.rank);
  parts.push(`<section><h2>Projects · ${list.length}</h2>${list.filter((p) => p !== here).map((p) => projectCard(p, false)).join('')}</section>`);
  parts.push(`<p class="muted small">Updated ${ago(at) === 'now' ? 'just now' : `${ago(at)} ago`} from ${esc(hub)}</p>`);
  main.innerHTML = parts.join('');
}

document.getElementById('open').addEventListener('click', async () => {
  const { hub } = await chrome.storage.session.get('hub');
  chrome.tabs.create({ url: `${hub || 'http://localhost:7777'}/#/status` });
});
document.getElementById('refresh').addEventListener('click', () => chrome.runtime.sendMessage('refresh').then(render));
chrome.storage.session.onChanged.addListener(render);
chrome.tabs.onActivated.addListener(render);
chrome.tabs.onUpdated.addListener((_id, info) => { if (info.url || info.status === 'complete') render(); });
chrome.runtime.sendMessage('refresh').catch(() => {});
render();
