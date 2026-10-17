// Who may talk to the hub. It listens on 127.0.0.1 only, so the risk is not the network: it is web pages in your
// browser reaching http://127.0.0.1:7777. Programs on this machine can read ~/.claude directly, so a token
// would add nothing against them. The guard therefore checks two things:
//   1. Host must be this hub's own address (blocks DNS rebinding, where a site's name is pointed at 127.0.0.1).
//   2. A browser request (it carries Origin or Sec-Fetch-Site) must come from the dashboard itself or from the
//      REKA Soul Engine browser extension. Requests from any other site are refused before any work is done.
// Requests with neither header come from programs, such as the soul-relay plugin or curl, and are allowed.
import type http from 'node:http';

/** The extension's fixed ID (from the "key" in extension/manifest.json), plus any you add. */
const EXTENSION_IDS = new Set(['kkhomdliihbkacghhfdaglopaabkgfml',...(process.env.SOUL_EXTENSION_IDS ?? '').split(/[,;\s]+/).filter(Boolean)]);

export function guard(req: http.IncomingMessage, port: number): { ok: true; cors: string | null } | { ok: false; why: string } {
  const host = (req.headers.host ?? '').toLowerCase();
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`, '127.0.0.1:3000', 'localhost:3000'];
  if (!hosts.includes(host)) return { ok: false, why: `host ${host || '(none)'} is not this hub` };

  const origin = req.headers.origin;
  const site = req.headers['sec-fetch-site'];
  if (!origin && !site) return { ok: true, cors: null }; // a program, not a browser page
  if (origin) {
    const o = origin.toLowerCase();
    if (hosts.some((h) => o === `http://${h}`)) return { ok: true, cors: null };
    const id = /^chrome-extension:\/\/([a-p]{32})$/.exec(o)?.[1]; // Edge and Chrome both use this scheme
    if (id && EXTENSION_IDS.has(id)) return { ok: true, cors: origin };
    return { ok: false, why: `origin ${origin} may not use the hub` };
  }
  // No Origin: same-origin GETs and typed addresses ("none") are fine; anything cross-site is not.
  return site === 'same-origin' || site === 'none' ? { ok: true, cors: null } : { ok: false, why: `cross-site request (${site})` };
}
