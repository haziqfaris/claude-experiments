// Project inventory: what each project runs on and who it talks to. Tools and services, hosting,
// domains, e-mail addresses (senders, account owners, support, demo accounts), sign-in methods,
// scheduled jobs, defaults and environment variable names.
//
// Read-only. Never reads .env files (only .env.example and similar, names only), never returns a
// secret value: anything that looks like a password, key or token is replaced with [hidden].
// Personal and client addresses are masked unless their domain is one of SOUL_OWN_DOMAINS.
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Inventory, InventoryCategory, InventoryFact, ProjectInventory } from '../src/types';

const run = promisify(execFile);
const OWN = (process.env.SOUL_OWN_DOMAINS ?? '').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
const EXCLUDE = process.env.SOUL_INVENTORY_EXCLUDE ? new RegExp(process.env.SOUL_INVENTORY_EXCLUDE, 'i') : null;
const ROOTS = (process.env.SOUL_INVENTORY_ROOTS ?? '').split(path.delimiter === ';' ? /[;,]/ : /[:,]/).map((r) => r.trim()).filter(Boolean);
const MAX_FILES = 4000;
const MAX_BYTES = 400_000;
const RESCAN_MS = 15 * 60_000;

const TEXT = /\.(md|mdx|txt|ts|tsx|js|jsx|mjs|cjs|json|jsonc|toml|ya?ml|sql|html|astro|vue|svelte|py|sh|ps1|ini|cfg|conf)$|(^|\/)(\.env\.(example|sample|template)|Dockerfile|Procfile|CNAME|_redirects|_headers)$/i;
const SKIP = /(^|\/)(node_modules|dist|build|\.next|\.nuxt|\.svelte-kit|\.output|\.vercel|\.wrangler|\.turbo|coverage|vendor|venv|__pycache__|\.git)\/|(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$|\.min\.(js|css)$|(^|\/)supabase\/functions\/[^/]+\/index\.ts$/i;
const ENV_FILE = /(^|\/)\.env(\.|$)/i;

// ---------- safety ----------
const SECRET_SHAPES = /(sk-(ant-)?[A-Za-z0-9_-]{16,}|sbp_[A-Za-z0-9]{20,}|sb_secret_[A-Za-z0-9_-]{10,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|xox[abp]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+|re_[A-Za-z0-9]{20,}|whsec_[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|[A-Za-z0-9+/_-]{40,})/g;
const SECRET_ASSIGN = /\b(pass(word|wd)?|secret|token|api[_-]?key|private[_-]?key|client[_-]?secret|credential)s?\b(\s*["']?\s*[:=]\s*)(["']?)[^"'\s,;)]+\4/gi;
export function scrub(line: string): string {
  return line.replace(SECRET_ASSIGN, (_m, k, _a, sep, q) => `${k}${sep}${q}[hidden]${q}`).replace(SECRET_SHAPES, '[hidden]').trim().slice(0, 220);
}

// ---------- classifiers ----------
const FREE_MAIL = /@(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|icloud|me|mac|proton|protonmail|aol|gmx|yandex|zoho)\.[a-z.]+$/i;
const ROLE = /^(no-?reply|do-?not-?reply|notifications?|notify|alerts?|mailer|postmaster|bounce[s]?|bot|hello|holla|hi|info|contact|support|help|care|helpdesk|admin|administrator|root|ops|devops|it|security|billing|finance|accounts?|invoices?|sales|team|hr|careers|jobs|legal|privacy|dpo|abuse|webmaster|host[a-z-]*|system|status|feedback|demo|test|qa|staging|dev|marketing|news|newsletter|press|partners?|inbox|mail|office|enquir(y|ies))([._+-].*)?$/i;
const IGNORE_EMAIL = /@([a-z0-9-]+\.)*(example|invalid|test|localhost)$|@(example\.(com|org|net)|example|test\.com|domain\.com|email\.com|yourdomain\.com|company\.com|acme\.com|sentry\.io|users\.noreply\.github\.com|noreply\.github\.com|anthropic\.com|github\.com|npmjs\.com|w3\.org|localhost)$|^(user|name|you|your-?email|someone|john|jane|foo|bar|test)@|\.(png|jpe?g|svg|webp|gif)$|@[0-9]+(\.[0-9]+)*x?$/i;

function ownDomain(domain: string): boolean {
  return OWN.some((d) => domain === d || domain.endsWith('.' + d));
}
function maskEmail(addr: string): { value: string; masked: boolean } {
  const [local, domain] = addr.toLowerCase().split('@');
  if (/gserviceaccount\.com$/.test(domain)) return { value: addr.toLowerCase(), masked: false };
  if (ownDomain(domain) || (ROLE.test(local) && !FREE_MAIL.test(addr))) return { value: addr.toLowerCase(), masked: false };
  return { value: `${local[0]}${'•'.repeat(Math.min(6, Math.max(3, local.length - 1)))}@${FREE_MAIL.test(addr) ? domain : domain}`, masked: true };
}
function emailKind(addr: string, line: string, file: string): string {
  const local = addr.split('@')[0].toLowerCase();
  const l = line.toLowerCase();
  if (/dmarc|rua=|ruf=|spf|mx record/.test(l)) return 'DNS and mail records';
  if (/gserviceaccount\.com$/.test(addr.toLowerCase())) return 'Google service account';
  if (/(^|\/)(seed|seeds|fixtures?|demo|e2e|tests?|__tests__|spec|playwright)[^/]*\/|\.(test|spec)\.|seed|fixture/i.test(file) || /^(demo|test|qa)/.test(local) || /\b(demo|test) (account|user|login)|persona/.test(l)) return 'Demo or test account';
  if (/\b(from|sender|send(s|ing)? (as|from)|reply-?to|smtp|mail_from|email_from|resend_from|from_email|from_address)\b/.test(l) || /^(no-?reply|do-?not-?reply|notifications?|notify|alerts?|mailer|bounces?)$/.test(local)) return 'Sends e-mail';
  if (/^(support|help|care|helpdesk|feedback)/.test(local) || /\bsupport\b/.test(l)) return 'Support address';
  if (/\b(account|owner|admin|sign(ed)? ?in|log(ged)? ?in|console|registrar|billing|organi[sz]ation|workspace|superuser|super admin|platform_admins|team member|invite[ds]?)\b/.test(l)) return 'Account, owner or admin';
  if (/\b(contact|enquir|hello|holla|info)\b/.test(l) || /^(hello|holla|info|contact|enquir)/.test(local)) return 'Public contact';
  return 'Mentioned';
}

const SERVICES: [RegExp, string][] = [
  [/@supabase\/(supabase-js|ssr)|"supabase"/, 'Supabase'], [/"appwrite"|node-appwrite/, 'Appwrite'], [/"firebase"|firebase-admin/, 'Firebase'],
  [/"@prisma\/client"|"prisma"/, 'Prisma'], [/"drizzle-orm"/, 'Drizzle ORM'], [/"pg"|"postgres"|psycopg/, 'Postgres client'], [/"mongoose"|"mongodb"/, 'MongoDB'],
  [/"redis"|"ioredis"|@upstash\/redis/, 'Redis'], [/@anthropic-ai\/sdk|"anthropic"/, 'Anthropic API'], [/"openai"/, 'OpenAI API'],
  [/@google\/genai|@google\/generative-ai|google-generativeai/, 'Google Gemini API'], [/"groq-sdk"|"@ai-sdk\/xai"|x\.ai/, 'xAI or Groq'], [/"ai"\s*:/, 'Vercel AI SDK'],
  [/"stripe"|@stripe\//, 'Stripe'], [/"resend"/, 'Resend (e-mail)'], [/"nodemailer"/, 'Nodemailer (SMTP)'], [/@sendgrid|"postmark"|"mailgun/, 'E-mail API'],
  [/@sentry\//, 'Sentry'], [/"posthog-js"|"posthog-node"/, 'PostHog'], [/"twilio"/, 'Twilio'], [/"telegraf"|"grammy"|node-telegram-bot-api/, 'Telegram bot'],
  [/"googleapis"|google-auth-library/, 'Google APIs'], [/@aws-sdk\/|"aws-sdk"|boto3/, 'AWS'], [/"wrangler"|@cloudflare\/workers-types/, 'Cloudflare Workers'],
  [/"@vercel\//, 'Vercel'], [/"next"\s*:/, 'Next.js'], [/"vite"\s*:/, 'Vite'], [/"astro"\s*:/, 'Astro'], [/"react"\s*:/, 'React'], [/"expo"\s*:/, 'Expo'],
  [/"playwright"|@playwright\/test/, 'Playwright'], [/"vitest"/, 'Vitest'], [/"mqtt"/, 'MQTT'], [/"socket\.io|"ws"\s*:/, 'WebSockets'],
  [/"mapbox-gl"|"leaflet"|"maplibre-gl"/, 'Maps'], [/"three"\s*:/, 'Three.js'], [/"docx"|"pdfkit"|"pdf-lib"|"jspdf"/, 'Document generation'],
];
const ENV_HINTS: [RegExp, string][] = [
  [/^RESEND_/, 'Resend (e-mail)'], [/^STRIPE_/, 'Stripe'], [/^(GEMINI|GOOGLE_GENAI|GOOGLE_AI)_/, 'Google Gemini API'], [/^ANTHROPIC_/, 'Anthropic API'],
  [/^OPENAI_/, 'OpenAI API'], [/^(XAI|GROK)_/, 'xAI'], [/^TELEGRAM_/, 'Telegram bot'], [/^SENTRY_/, 'Sentry'], [/^(SUPABASE|NEXT_PUBLIC_SUPABASE|VITE_SUPABASE)_/, 'Supabase'],
  [/^(SMTP|MAIL)_/, 'SMTP'], [/^(R2|CLOUDFLARE|CF)_/, 'Cloudflare'], [/^(GOOGLE_OAUTH|GOOGLE_CLIENT)_/, 'Google OAuth'], [/^APPWRITE_/, 'Appwrite'], [/^(TWILIO|WHATSAPP)_/, 'Messaging'],
];
// API keys: which API or service a key, token or secret variable is for (by its name), never its value.
const KEY_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PASS|DSN|CREDENTIALS?|WEBHOOK|PAT|SERVICE_ROLE|PRIVATE)/;
const KEY_API: [RegExp, string][] = [
  [/ANTHROPIC|CLAUDE/, 'Anthropic API (Claude)'], [/GEMINI|GOOGLE_(GENAI|AI|GENERATIVE)/, 'Google Gemini API'], [/OPENAI/, 'OpenAI API'], [/XAI|GROK/, 'xAI API (Grok)'],
  [/GROQ/, 'Groq API'], [/MISTRAL/, 'Mistral API'], [/DEEPSEEK/, 'DeepSeek API'], [/OPENROUTER/, 'OpenRouter API'], [/ELEVENLABS/, 'ElevenLabs API'], [/REPLICATE/, 'Replicate API'],
  [/SUPABASE.*SERVICE_ROLE|SERVICE_ROLE/, 'Supabase (service role: full database access)'], [/SUPABASE.*ANON|SUPABASE.*PUBLISHABLE/, 'Supabase (public client key)'],
  [/SUPABASE_ACCESS_TOKEN|SBP_|SUPABASE.*(PAT|MANAGEMENT)/, 'Supabase Management API'], [/SUPABASE/, 'Supabase'],
  [/STRIPE.*WEBHOOK/, 'Stripe webhooks'], [/STRIPE/, 'Stripe API'], [/RESEND/, 'Resend e-mail API'], [/SENDGRID/, 'SendGrid API'], [/POSTMARK/, 'Postmark API'], [/MAILGUN/, 'Mailgun API'],
  [/SMTP|MAIL_PASS|EMAIL_PASS/, 'SMTP mail server'], [/TELEGRAM/, 'Telegram Bot API'], [/WHATSAPP|META_|FACEBOOK|FB_/, 'Meta / WhatsApp API'], [/TWILIO/, 'Twilio API'],
  [/GOOGLE.*(OAUTH|CLIENT)/, 'Google OAuth'], [/GOOGLE_(SERVICE_ACCOUNT|APPLICATION_CREDENTIALS)|GCP_|DRIVE/, 'Google APIs (service account: Drive, Sheets)'], [/GOOGLE.*MAPS|MAPS_API/, 'Google Maps API'],
  [/CLOUDFLARE|CF_API|R2_/, 'Cloudflare API / R2 storage'], [/VERCEL/, 'Vercel API'], [/NETLIFY/, 'Netlify API'], [/GITHUB|GH_/, 'GitHub API'], [/APPWRITE/, 'Appwrite API'],
  [/FIREBASE/, 'Firebase'], [/AWS|S3_/, 'AWS'], [/SENTRY/, 'Sentry'], [/POSTHOG/, 'PostHog'], [/MAPBOX/, 'Mapbox API'], [/QUICKBOOKS|INTUIT/, 'QuickBooks API'], [/XERO/, 'Xero API'],
  [/BUKKU/, 'Bukku API'], [/MYINVOIS|LHDN/, 'MyInvois (LHDN) API'], [/HUBSPOT/, 'HubSpot API'], [/NOTION/, 'Notion API'], [/SLACK/, 'Slack API'], [/DISCORD/, 'Discord API'],
  [/SCREENSHOTONE|BROWSERLESS/, 'Screenshot API'], [/UPSTASH|REDIS/, 'Redis'], [/GPG|PGP|AGE_/, 'Backup encryption key'], [/DATABASE_URL|POSTGRES|^PG_|_PG_/, 'Database connection'],
  [/PAGESPEED|LIGHTHOUSE|CRUX/, 'Google PageSpeed / CrUX API'], [/_ARN$|SECRETS_MANAGER/, 'AWS Secrets Manager'], [/ROLE_PASSWORD|DB_PASS|DATABASE_PASS/, 'Database connection'],
  [/DEMO|ADMIN_PASS|BASIC_AUTH|ACCESS_PASSWORD|PREVIEW_PASS/, 'Login to the app itself (demo, admin or preview gate)'],
  [/JWT|SESSION|AUTH_SECRET|NEXTAUTH|ENCRYPTION|SIGNING|CRON_SECRET|INTERNAL|PEPPER|SALT|HMAC|INGEST|SWEEP|WORKER_SECRET|SHARED_SECRET|_SECRET$/, 'App-internal secret (signing, sessions or internal calls)'],
];
function keyApi(name: string): string {
  for (const [re, api] of KEY_API) if (re.test(name)) return api;
  return 'Unknown: check where it is used';
}
// APIs the code calls directly over HTTP, and the API behind each SDK.
const API_HOST = /^(api\.|.*\.googleapis\.com$|.*\.openai\.azure\.com$|graph\.facebook\.com$|hooks\.slack\.com$|discord\.com$|.*\.supabase\.co$|.*\.appwrite\.(io|global)$|.*\.workers\.dev$|.*\.r2\.cloudflarestorage\.com$|oauth2\.googleapis\.com$|accounts\.google\.com$|sandbox\.|.*rdap.*|dns\.google$|cloudflare-dns\.com$|.*\.upstash\.io$|.*\.ingest\.sentry\.io$)/i;
const SDK_API: [RegExp, string][] = [
  [/@anthropic-ai\/sdk/, 'Anthropic API'], [/"openai"/, 'OpenAI API'], [/@google\/genai|@google\/generative-ai/, 'Google Gemini API'], [/"resend"/, 'Resend e-mail API'],
  [/"stripe"/, 'Stripe API'], [/@supabase\/supabase-js/, 'Supabase API'], [/"googleapis"/, 'Google APIs'], [/"twilio"/, 'Twilio API'], [/"appwrite"|node-appwrite/, 'Appwrite API'],
  [/"telegraf"|"grammy"|node-telegram-bot-api/, 'Telegram Bot API'], [/@aws-sdk\//, 'AWS APIs'], [/@sentry\//, 'Sentry'],
];

const SIGNIN: [RegExp, (m: RegExpExecArray) => string][] = [
  [/signInWithOAuth\(\s*\{[^}]*provider:\s*['"`](\w+)/g, (m) => `${cap(m[1])} sign-in (Supabase OAuth)`],
  [/signInWithOtp\(|magic ?link|signInWithEmail\(/gi, () => 'E-mail link or code (passwordless)'],
  [/signInWithPassword\(|createEmailPasswordSession\(|credentialsprovider/gi, () => 'E-mail and password'],
  [/createOAuth2(Session|Token)\(\s*(?:OAuthProvider\.)?['"`]?(\w+)/g, (m) => `${cap(m[2])} sign-in (Appwrite OAuth)`],
  [/(Google|GitHub|Azure|Apple|Microsoft)Provider\(/g, (m) => `${m[1]} sign-in (NextAuth)`],
  [/@clerk\//g, () => 'Clerk'], [/auth0/gi, () => 'Auth0'], [/signInWithPopup\(|GoogleAuthProvider/g, () => 'Google sign-in (Firebase)'],
  [/\b(totp|otpauth|authenticator app|mfa\.enroll)\b/gi, () => 'Two-factor (authenticator app)'], [/webauthn|passkey/gi, () => 'Passkeys'],
  [/\bsaml\b|samlp|sso_provider/gi, () => 'SAML single sign-on'], [/cf-access-jwt|Cloudflare Access/g, () => 'Cloudflare Access'],
  [/x-api-key|Authorization: Bearer|bearer token/gi, () => 'API keys or bearer tokens (machine access)'],
];
function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(); }

const OWN_HOST_SUFFIX = /\.(workers\.dev|pages\.dev|vercel\.app|netlify\.app|fly\.dev|onrender\.com|appwrite\.global|web\.app|firebaseapp\.com|herokuapp\.com|railway\.app)$/i;
const HOST_RE = /\b((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,24}))\b/gi;
const MODEL_RE = /\b(claude-(?:opus|sonnet|haiku|fable)-[0-9][a-z0-9.-]*|gemini-[0-9][a-z0-9.-]*|gpt-[0-9][a-z0-9.-]*|grok-[0-9][a-z0-9.-]*|o[34]-mini)\b/gi;

// ---------- scanning ----------
async function gitFiles(dir: string): Promise<string[] | null> {
  try {
    const { stdout } = await run('git', ['-C', dir, 'ls-files'], { maxBuffer: 64 * 1024 * 1024 });
    return stdout.split('\n').filter(Boolean);
  } catch { return null; }
}
async function walk(dir: string, rel = '', out: string[] = []): Promise<string[]> {
  if (out.length > MAX_FILES) return out;
  let entries: import('node:fs').Dirent[] = [];
  try { entries = await fs.readdir(path.join(dir, rel), { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (SKIP.test(r + (e.isDirectory() ? '/' : ''))) continue;
    if (e.isDirectory()) await walk(dir, r, out); else out.push(r);
  }
  return out;
}
async function git(dir: string, args: string[]): Promise<string> {
  try { return (await run('git', ['-C', dir, ...args])).stdout.trim(); } catch { return ''; }
}

class Facts {
  private map = new Map<string, InventoryFact>();
  add(category: InventoryCategory, label: string, value: string, evidence?: string, masked?: boolean) {
    value = value.trim(); if (!value) return;
    const key = `${category}|${label}|${value}`.toLowerCase();
    const f = this.map.get(key) ?? { category, label, value, evidence: [], ...(masked ? { masked: true } : {}) };
    if (evidence && !f.evidence.includes(evidence) && f.evidence.length < 4) f.evidence.push(evidence);
    this.map.set(key, f);
  }
  list(): InventoryFact[] {
    const order: InventoryCategory[] = ['service', 'apikey', 'api', 'hosting', 'domain', 'email', 'signin', 'job', 'default', 'register', 'env'];
    return [...this.map.values()].sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category) || a.label.localeCompare(b.label) || a.value.localeCompare(b.value));
  }
}

export async function scanProject(dir: string, name = path.basename(dir)): Promise<ProjectInventory> {
  const facts = new Facts();
  const all = (await gitFiles(dir)) ?? (await walk(dir));
  const files = all.filter((f) => !SKIP.test(f) && (TEXT.test(f) || ENV_FILE.test(f))).slice(0, MAX_FILES);
  const hostCount = new Map<string, { n: number; ev: string }>();
  const keyUse = new Map<string, Set<string>>();
  const noteKey = (name: string, where: string) => { if (!KEY_NAME.test(name)) return; const s = keyUse.get(name) ?? new Set<string>(); if (s.size < 3) s.add(where); keyUse.set(name, s); };
  const modelCount = new Map<string, { n: number; ev: string }>();
  let scanned = 0;

  for (const rel of files) {
    if (ENV_FILE.test(rel) && !/\.env\.(example|sample|template)$/i.test(rel)) {
      facts.add('env', 'Local secrets file (values never read)', rel, rel);
      continue;
    }
    let text: string;
    try {
      const st = await fs.stat(path.join(dir, rel));
      if (st.size > MAX_BYTES) continue;
      text = await fs.readFile(path.join(dir, rel), 'utf8');
    } catch { continue; }
    scanned++;
    const base = path.basename(rel).toLowerCase();
    const isConfig = /^(wrangler\.(toml|jsonc?)|vercel\.json|netlify\.toml|fly\.toml|firebase\.json|appwrite\.json|docker-compose\.ya?ml|compose\.ya?ml|dockerfile|cname|config\.toml)$/i.test(base) || /^\.github\/workflows\//.test(rel);
    const isDoc = /\.(md|mdx|txt)$/i.test(rel);
    const lines = text.split(/\r?\n/);

    // services from manifests
    if (base === 'package.json' && !rel.includes('node_modules')) {
      for (const [re, svc] of SERVICES) if (re.test(text)) facts.add('service', svc, svc, rel);
      for (const [re, api] of SDK_API) if (re.test(text)) facts.add('api', 'Through its SDK', api, rel);
      try {
        const pj = JSON.parse(text);
        for (const [k, v] of Object.entries<string>(pj.scripts ?? {})) {
          const m = /(?:--port|-p)\s+(\d{2,5})/.exec(v); if (m) facts.add('default', 'Local port', `${m[1]} (npm run ${k})`, rel);
        }
        if (pj.engines?.node) facts.add('default', 'Node version', String(pj.engines.node), rel);
      } catch { /* not JSON */ }
    }
    if (/^(requirements\.txt|pyproject\.toml)$/.test(base)) for (const [re, svc] of SERVICES) if (re.test(text)) facts.add('service', svc, svc, rel);
    if (base === '.nvmrc' || base === '.node-version') facts.add('default', 'Node version', text.trim(), rel);

    // env names (never values)
    if (/\.env\.(example|sample|template)$/i.test(rel)) {
      for (const l of lines) {
        const m = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]{2,})\s*=/.exec(l);
        if (m) {
          facts.add('env', 'Variable', m[1], rel);
          noteKey(m[1], rel);
          for (const [re, svc] of ENV_HINTS) if (re.test(m[1])) facts.add('service', svc, svc, `${rel} (${m[1]})`);
        }
      }
    }

    // hosting
    if (/^wrangler\.(toml|jsonc?)$/i.test(base)) {
      const nm = /(?:^|\n)\s*"?name"?\s*[=:]\s*"([^"]+)"/.exec(text); if (nm) facts.add('hosting', 'Cloudflare Worker', nm[1], rel);
      for (const m of text.matchAll(/"?pattern"?\s*[=:]\s*"([^"]+)"/g)) facts.add('hosting', 'Cloudflare route', m[1], rel);
      for (const m of text.matchAll(/custom_domain"?\s*[=:]\s*true[^\n]*|"?pattern"?\s*[=:]\s*"([^"]+)"\s*,\s*"?custom_domain/g)) if (m[1]) facts.add('domain', 'Custom domain', m[1], rel);
      for (const m of text.matchAll(/"?(d1_databases|r2_buckets|kv_namespaces|queues|durable_objects|ai|browser|vectorize)"?\s*[=:]/g)) facts.add('hosting', 'Cloudflare binding', m[1].replace(/_/g, ' '), rel);
      for (const m of text.matchAll(/"?crons"?\s*[=:]\s*\[([^\]]*)\]/g)) for (const c of m[1].match(/"[^"]+"/g) ?? []) facts.add('job', 'Cloudflare cron', c.replace(/"/g, ''), rel);
      if (/assets/.test(text)) facts.add('hosting', 'Cloudflare static assets', 'yes', rel);
    }
    if (base === 'vercel.json') {
      facts.add('hosting', 'Vercel', 'vercel.json', rel);
      for (const m of text.matchAll(/"path"\s*:\s*"([^"]+)"\s*,\s*"schedule"\s*:\s*"([^"]+)"/g)) facts.add('job', 'Vercel cron', `${m[2]} → ${m[1]}`, rel);
    }
    if (base === 'netlify.toml') facts.add('hosting', 'Netlify', 'netlify.toml', rel);
    if (base === 'fly.toml') { const a = /app\s*=\s*"([^"]+)"/.exec(text); facts.add('hosting', 'Fly.io app', a ? a[1] : 'fly.toml', rel); }
    if (/^(docker-compose|compose)\.ya?ml$/.test(base)) for (const m of text.matchAll(/^\s{2}([a-z0-9_-]+):\s*$/gm)) facts.add('hosting', 'Docker Compose service', m[1], rel);
    if (base === 'dockerfile') { const f = /^FROM\s+(\S+)/m.exec(text); facts.add('hosting', 'Docker image base', f ? f[1] : 'Dockerfile', rel); }
    if (rel === 'supabase/config.toml') { const p = /project_id\s*=\s*"([^"]+)"/.exec(text); facts.add('hosting', 'Supabase local project', p ? p[1] : 'supabase/config.toml', rel); }
    if (/^supabase\/functions\/[^/]+\//.test(rel)) facts.add('hosting', 'Supabase Edge Function', rel.split('/')[2], rel.split('/').slice(0, 3).join('/'));
    if (/^supabase\/migrations\//.test(rel)) for (const m of text.matchAll(/cron\.schedule\(\s*'([^']+)'\s*,\s*'([^']+)'/g)) facts.add('job', 'Postgres cron (pg_cron)', `${m[1]}: ${m[2]}`, rel);
    if (base === 'appwrite.json') facts.add('hosting', 'Appwrite project', 'appwrite.json', rel);
    if (base === 'cname') facts.add('domain', 'Custom domain', text.trim(), rel);
    if (/^\.github\/workflows\//.test(rel)) {
      const wn = /^name:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? path.basename(rel);
      facts.add('job', 'GitHub workflow', wn, rel);
      for (const m of text.matchAll(/cron:\s*['"]([^'"]+)['"]/g)) facts.add('job', 'Scheduled workflow', `${wn}: ${m[1]}`, rel);
      if (/wrangler|cloudflare\/wrangler-action/.test(text)) facts.add('hosting', 'Deploys to Cloudflare', wn, rel);
      if (/vercel/.test(text)) facts.add('hosting', 'Deploys to Vercel', wn, rel);
      if (/supabase (db push|functions deploy)/.test(text)) facts.add('hosting', 'Deploys Supabase', wn, rel);
      for (const m of text.matchAll(/\b(?:secrets|vars)\.([A-Z][A-Z0-9_]+)/g)) { facts.add('env', 'CI secret or variable (name only)', m[1], rel); noteKey(m[1], `${rel} (CI)`); }
    }

    // per line: e-mails, hosts, sign-in, models, regions
    const isSource = /\.(ts|tsx|js|jsx|mjs|cjs|py|astro|vue|svelte|sql)$/i.test(rel);
    // unit tests are full of made-up addresses and mocked URLs: they say nothing about real infrastructure
    const isUnitTest = /\.(test|spec)\.[a-z]+$|(^|\/)(__tests__|__mocks__)\//i.test(rel);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.length > 2000) continue;
      if (line.includes('@') && !isUnitTest) {
        for (const m of line.matchAll(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g)) {
          const addr = m[0];
          if (IGNORE_EMAIL.test(addr) || /\.(ts|js|tsx|json|css|scss|map)$/i.test(addr)) continue;
          if (/@[0-9]/.test(addr) || /^[0-9.]+@/.test(addr)) continue; // package@version, not an address
          const { value, masked } = maskEmail(addr);
          facts.add('email', emailKind(addr, line, rel), value, `${rel}:${i + 1}`, masked);
        }
      }
      if (isConfig || isDoc || /redirect|domain|origin|site_url|base_url|allowed/i.test(line)) {
        for (const m of line.matchAll(HOST_RE)) {
          const h = m[1].toLowerCase();
          if (!(ownDomain(h) || OWN_HOST_SUFFIX.test(h)) || h.includes('@')) continue;
          const c = hostCount.get(h) ?? { n: 0, ev: `${rel}:${i + 1}` }; c.n++; hostCount.set(h, c);
        }
      }
      if (isSource) {
        for (const m of line.matchAll(/(?:process\.env|import\.meta\.env|env)\.([A-Z][A-Z0-9_]{2,})|process\.env\[['"]([A-Z][A-Z0-9_]{2,})['"]\]|Deno\.env\.get\(\s*['"]([A-Z][A-Z0-9_]{2,})['"]|os\.environ(?:\.get)?[\[(]\s*['"]([A-Z][A-Z0-9_]{2,})['"]|getenv\(\s*['"]([A-Z][A-Z0-9_]{2,})['"]/g)) noteKey(m[1] || m[2] || m[3] || m[4] || m[5], `${rel}:${i + 1}`);
        if (!isUnitTest) for (const m of line.matchAll(/https:\/\/([a-z0-9.-]+\.[a-z]{2,})(\/[^\s'"`)]*)?/gi)) {
          const h = m[1].toLowerCase();
          if (API_HOST.test(h) && !/localhost|example|fonts\.googleapis/.test(h)) facts.add('api', 'Calls over HTTP', h + (m[2] ? m[2].split(/[?$#{]/)[0].replace(/\/$/, '').slice(0, 48) : ''), `${rel}:${i + 1}`);
        }
        for (const [re, label] of SIGNIN) { re.lastIndex = 0; const m = re.exec(line); if (m) facts.add('signin', 'Sign-in method', label(m), `${rel}:${i + 1}`); }
        if (/\bsetup|login|sign/i.test(rel) && /\bpersonas?\b/i.test(line)) facts.add('signin', 'Sign-in method', 'Persona picker (local demo mode)', `${rel}:${i + 1}`);
      }
      if (isSource || isConfig) {
        for (const m of line.matchAll(MODEL_RE)) { const k = m[1].toLowerCase(); const c = modelCount.get(k) ?? { n: 0, ev: `${rel}:${i + 1}` }; c.n++; modelCount.set(k, c); }
        const rg = /\b(ap-southeast-[0-9]|asia-southeast[0-9]|sin1|eu-west-[0-9]|us-east-[0-9])\b/.exec(line); if (rg) facts.add('default', 'Region', rg[1], `${rel}:${i + 1}`);
        const tz = /\b(Asia\/Kuala_Lumpur|Asia\/Singapore|UTC\+0?8)\b/.exec(line); if (tz) facts.add('default', 'Time zone', tz[1], `${rel}:${i + 1}`);
        const cur = /\bcurrency\s*[:=]\s*['"]([A-Z]{3})['"]/.exec(line); if (cur) facts.add('default', 'Currency', cur[1], `${rel}:${i + 1}`);
      }
    }

    // the Access Register, when the repo keeps one
    if (/access[-_ ]?register[^/]*\.md$/i.test(rel)) {
      for (const l of lines) {
        const c = l.split('|').map((x) => x.trim());
        if (c.length > 4 && c[1] && !/^-+$/.test(c[1]) && !/^service$/i.test(c[1]) && !/\{\{/.test(c[1])) facts.add('register', 'Access Register', scrub(c.slice(1, 5).filter(Boolean).join(' · ')), rel);
      }
    }
  }

  for (const [name, where] of [...keyUse.entries()].sort()) facts.add('apikey', keyApi(name), name, [...where].join(', '));
  for (const [h, c] of [...hostCount.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 25)) facts.add('domain', OWN_HOST_SUFFIX.test(h) ? 'Platform address' : 'Domain', h, c.ev);
  for (const [k, c] of [...modelCount.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 8)) facts.add('default', 'AI model referenced', k, c.ev);

  const remote = (await git(dir, ['remote', 'get-url', 'origin'])).replace(/\/\/[^@/]+@/, '//').replace(/\.git$/, '') || null;
  return {
    id: dir.toLowerCase(), name, path: dir, repo: remote, branch: (await git(dir, ['branch', '--show-current'])) || null,
    scannedAt: Date.now(), filesScanned: scanned, facts: facts.list(),
  };
}

// ---------- the index the hub keeps ----------
export class InventoryIndex {
  private inv: Inventory = { scannedAt: 0, scanning: false, projects: [] };
  private dirs = new Set<string>();

  get(): Inventory { return this.inv; }

  /** Folders to scan: every project Claude Code worked in, plus the repos under SOUL_INVENTORY_ROOTS. */
  async discover(projectPaths: string[]): Promise<string[]> {
    const found = new Set<string>();
    for (const p of projectPaths) found.add(path.resolve(p));
    for (const root of ROOTS) {
      try {
        for (const e of await fs.readdir(root, { withFileTypes: true })) {
          if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue;
          const d = path.join(root, e.name);
          try { await fs.access(path.join(d, '.git')); found.add(path.resolve(d)); } catch {
            try { await fs.access(path.join(d, 'package.json')); found.add(path.resolve(d)); } catch { /* not a project */ }
          }
        }
      } catch { /* root missing */ }
    }
    const homes = new Set([process.env.HOME, process.env.USERPROFILE].filter(Boolean).map((h) => path.resolve(h as string).toLowerCase()));
    const rootSet = new Set(ROOTS.map((r) => path.resolve(r).toLowerCase()));
    const list = [...found].filter((d) => !homes.has(d.toLowerCase()) && !rootSet.has(d.toLowerCase()) && !(EXCLUDE && EXCLUDE.test(d)));
    // A folder that holds other projects (a workspace like ~/Dev) is not a project itself.
    return list.filter((d) => !list.some((o) => o !== d && o.toLowerCase().startsWith(d.toLowerCase() + path.sep)));
  }

  async scan(projectPaths: string[]): Promise<void> {
    if (this.inv.scanning) return;
    this.inv = { ...this.inv, scanning: true };
    try {
      const dirs = await this.discover(projectPaths);
      dirs.forEach((d) => this.dirs.add(d));
      const out: ProjectInventory[] = [];
      for (const d of dirs) {
        try { await fs.access(d); out.push(await scanProject(d)); } catch { /* folder gone */ }
      }
      // Copies and worktrees of one repo become one project: keep the folder named like the repo, else the busiest.
      const byRepo = new Map<string, ProjectInventory[]>();
      for (const p of out) { const k = (p.repo ?? p.path).toLowerCase(); byRepo.set(k, [...(byRepo.get(k) ?? []), p]); }
      const merged: ProjectInventory[] = [];
      for (const group of byRepo.values()) {
        const repoName = group[0].repo ? group[0].repo.split('/').pop()!.toLowerCase() : '';
        group.sort((a, b) => Number(b.name.toLowerCase() === repoName) - Number(a.name.toLowerCase() === repoName) || b.filesScanned - a.filesScanned);
        const [main, ...copies] = group;
        merged.push(copies.length ? { ...main, alsoAt: copies.map((c) => c.path) } : main);
      }
      this.inv = { scannedAt: Date.now(), scanning: false, projects: merged.sort((a, b) => a.name.localeCompare(b.name)) };
    } catch (err) {
      this.inv = { ...this.inv, scanning: false };
      throw err;
    }
  }

  stale(): boolean { return !this.inv.scanning && Date.now() - this.inv.scannedAt > RESCAN_MS; }
}

// ---------- search and context ----------
export const CATEGORY_LABEL: Record<InventoryCategory, string> = {
  service: 'Tools and services', apikey: 'API keys (names only)', api: 'APIs called', hosting: 'Hosting', domain: 'Domains and addresses', email: 'E-mail addresses', signin: 'Sign-in',
  job: 'Scheduled jobs and CI', default: 'Defaults', env: 'Environment variable names', register: 'Access Register',
};

export function searchInventory(inv: Inventory, q: string, limit = 60): { project: string; fact: InventoryFact }[] {
  const words = q.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const out: { project: string; fact: InventoryFact }[] = [];
  for (const p of inv.projects) for (const f of p.facts) {
    const hay = `${p.name} ${CATEGORY_LABEL[f.category]} ${f.category} ${f.label} ${f.value} ${f.evidence.join(' ')}`.toLowerCase();
    if (words.every((w) => hay.includes(w))) out.push({ project: p.name, fact: f });
    if (out.length >= limit) return out;
  }
  return out;
}

/** Inventory questions: accounts, e-mails, hosting, tools, jobs, defaults. */
export const INVENTORY_QUESTION = /\b(apis?|sdks?|e-?mails?|mail|sender|smtp|login|log ?in|sign[- ]?in|accounts?|admins?|owners?|domains?|dns|host(ed|ing)?|deploy(ed|s)?|tools?|services?|providers?|infra(structure)?|stack|cron|jobs?|schedule[ds]?|defaults?|ports?|models?|env|variables?|secrets?|keys?|passwords?|oauth|auth|regions?|workers?|vercel|cloudflare|supabase|appwrite|stripe|resend|gemini|openai|anthropic|telegram|register|credentials?)\b/i;

export function inventoryContext(inv: Inventory, projectNames: string[] | null, maxChars = 45_000): string {
  const list = projectNames?.length ? inv.projects.filter((p) => projectNames.some((n) => p.name.toLowerCase() === n.toLowerCase() || p.path.toLowerCase().endsWith(n.toLowerCase()))) : inv.projects;
  const head = [`Project inventory (scanned ${new Date(inv.scannedAt).toString()}; ${inv.projects.length} project folders). Facts were read from each repo's files; "evidence" is the file and line. Secret values are never collected; masked addresses (•••) are personal or client addresses.`];
  let used = head[0].length;
  const blocks: string[] = [];
  for (const p of list) {
    const lines = [`### ${p.name}${p.repo ? ` (${p.repo})` : ''}`];
    for (const f of p.facts) {
      if (f.category === 'env' && !projectNames?.length) continue; // keep the all-projects view short
      lines.push(`- [${CATEGORY_LABEL[f.category]}] ${f.label}: ${f.value}${f.evidence.length ? ` (${f.evidence.slice(0, 2).join(', ')})` : ''}`);
    }
    const block = lines.join('\n');
    if (used + block.length > maxChars) { blocks.push(`… ${list.length - blocks.length} more project(s) cut for length.`); break; }
    used += block.length; blocks.push(block);
  }
  return [...head, ...blocks].join('\n\n');
}

export function offlineInventoryAnswer(inv: Inventory, question: string): string {
  const stop = /^(what|which|where|who|how|is|are|the|a|an|do|does|for|of|in|on|to|and|or|with|my|our|all|any|each|every|project|projects|use|uses|used|list|show|me|tell|about|there|have|has)$/i;
  const words = question.toLowerCase().replace(/[?.,!]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !stop.test(w));
  const hits = new Map<string, { project: string; fact: InventoryFact; score: number }>();
  const all = inv.projects.flatMap((p) => p.facts.map((f) => ({ p, f, hay: `${p.name} ${CATEGORY_LABEL[f.category]} ${f.label} ${f.value}`.toLowerCase() })));
  // Rare words decide: "stripe" in "which projects use the Stripe API" matters, "api" barely does.
  const weight = new Map(words.map((w) => { const n = all.filter((x) => x.hay.includes(w.replace(/s$/, ''))).length; return [w, n ? Math.log(1 + all.length / n) : 0]; }));
  const key = [...weight.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  for (const { p, f, hay } of all) {
    if (key && !hay.includes(key.replace(/s$/, ''))) continue;
    const score = words.reduce((n, w) => n + (hay.includes(w.replace(/s$/, '')) ? weight.get(w) ?? 0 : 0), 0);
    if (score) hits.set(`${p.name}|${f.value}|${f.label}`, { project: p.name, fact: f, score });
  }
  const top = [...hits.values()].sort((a, b) => b.score - a.score).slice(0, 15);
  if (!top.length) return 'No inventory fact matches that. Try a service, domain or address, for example "resend", "antarax.ai" or "noreply".';
  return ['Closest inventory matches:', ...top.map((h) => `• ${h.project} · ${h.fact.label}: ${h.fact.value}${h.fact.evidence[0] ? ` (${h.fact.evidence[0]})` : ''}`)].join('\n');
}
