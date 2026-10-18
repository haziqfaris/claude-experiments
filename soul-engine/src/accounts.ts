// Which provider an inventory fact belongs to, and which account, e-mail and cloud project it runs under.
// Shared by the hub (what repos show) and the dashboard (merging that with what you noted in accounts.local.json).
import type { AccountNote, AccountsConfig, InventoryFact, RepoAccount } from './types';

const PROVIDERS: [RegExp, string][] = [
  [/gemini|generativelanguage|google ai/i, 'Google AI (Gemini)'],
  [/cloudflare|wrangler|workers\.dev|pages\.dev|\bd1\b|\br2\b|durable objects|\bkv\b/i, 'Cloudflare'],
  [/vercel/i, 'Vercel'],
  [/supabase/i, 'Supabase'],
  [/firebase|firestore/i, 'Firebase'],
  [/appwrite/i, 'Appwrite'],
  [/netlify/i, 'Netlify'],
  [/fly\.io|fly app|fly\.dev/i, 'Fly.io'],
  [/github/i, 'GitHub'],
  [/google|gcp|gserviceaccount|googleapis|drive|sheets|gmail/i, 'Google Cloud'],
  [/\baws\b|amazon|\bs3\b|\bses\b|lambda/i, 'AWS'],
  [/stripe/i, 'Stripe'],
  [/resend/i, 'Resend'],
  [/sendgrid/i, 'SendGrid'], [/postmark/i, 'Postmark'], [/mailgun/i, 'Mailgun'],
  [/openai|\bgpt-|azure openai/i, 'OpenAI'],
  [/anthropic|claude/i, 'Anthropic'],
  [/telegram/i, 'Telegram'],
  [/twilio/i, 'Twilio'],
  [/sentry/i, 'Sentry'],
  [/upstash|redis/i, 'Upstash'],
  [/mapbox/i, 'Mapbox'],
  [/neon\.tech|\bneon\b/i, 'Neon'],
  [/railway/i, 'Railway'], [/render\.com|onrender/i, 'Render'],
  [/slack/i, 'Slack'], [/discord/i, 'Discord'],
  [/whatsapp|meta graph|graph\.facebook/i, 'Meta'],
];

/** The provider a fact is about, or null for facts that are not an outside account (a port, a Node version). */
export function providerOf(f: Pick<InventoryFact, 'category' | 'label' | 'value'>): string | null {
  if (f.category === 'default' && !/model/i.test(f.label)) return null;
  if (f.category === 'default') return /gemini/i.test(f.value) ? 'Google AI (Gemini)' : /gpt|o\d/i.test(f.value) ? 'OpenAI' : /claude/i.test(f.value) ? 'Anthropic' : null;
  if (f.category === 'email' || f.category === 'register' || f.category === 'env') return null;
  const text = `${f.label} ${f.value}`;
  if (/^(React|Vite|Next\.js|Astro|Expo|Node|TypeScript|Tailwind)/.test(f.value) && f.category === 'service') return null;
  for (const [re, name] of PROVIDERS) if (re.test(text)) return name;
  return null;
}

export interface AccountView extends AccountNote {
  provider: string;
  /** Where each part came from: what a repo file shows, or what you noted. */
  from: { account?: 'repo' | 'you'; email?: 'repo' | 'you'; project?: 'repo' | 'you' };
  evidence: string[];
}

/** One provider's account for one project: your note for the project, then your note for every project, then what the repos show. */
export function accountFor(provider: string, project: string, detected: RepoAccount[], cfg: AccountsConfig | null): AccountView {
  const v: AccountView = { provider, from: {}, evidence: [] };
  const layers: [AccountNote | undefined, 'repo' | 'you'][] = [
    [cfg?.projects?.[project]?.[provider], 'you'],
    [cfg?.providers?.[provider], 'you'],
    ...detected.filter((d) => d.provider === provider).map((d) => [d, 'repo'] as [AccountNote, 'repo']),
  ];
  for (const [n, src] of layers) {
    if (!n) continue;
    for (const k of ['account', 'email', 'project'] as const) if (!v[k] && n[k]) { v[k] = n[k]!; v.from[k] = src; }
  }
  v.evidence = detected.filter((d) => d.provider === provider).map((d) => d.evidence);
  return v;
}
