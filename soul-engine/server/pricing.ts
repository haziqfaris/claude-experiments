// USD per million tokens, Anthropic first-party API rates. Cache writes are
// billed at 1.25x input (5-minute TTL) or 2x input (1-hour TTL).
// Update when prices change; unknown models are reported as "no estimate".
interface Price {
  input: number;
  output: number;
  cacheRead: number;
}

const PRICES: Record<string, Price> = {
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25 },
  'claude-fable-5': { input: 10, output: 50, cacheRead: 1.0 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-7': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-6': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1 },
};

export interface RawUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_creation?: { ephemeral_5m_input_tokens?: number | null; ephemeral_1h_input_tokens?: number | null } | null;
}

function priceFor(model: string): Price | undefined {
  if (PRICES[model]) return PRICES[model];
  // Tolerate suffixes such as "[1m]" or date stamps.
  const key = Object.keys(PRICES)
    .sort((a, b) => b.length - a.length)
    .find((k) => model.startsWith(k));
  return key ? PRICES[key] : undefined;
}

/** Estimated cost of one API call in USD, or null when the model is unknown. */
export function estimateCost(model: string, u: RawUsage): number | null {
  const p = priceFor(model);
  if (!p) return null;
  const write = u.cache_creation_input_tokens ?? 0;
  const w1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const w5m = u.cache_creation ? (u.cache_creation.ephemeral_5m_input_tokens ?? 0) : write;
  const dollars =
    (u.input_tokens ?? 0) * p.input +
    (u.output_tokens ?? 0) * p.output +
    (u.cache_read_input_tokens ?? 0) * p.cacheRead +
    w5m * p.input * 1.25 +
    w1h * p.input * 2;
  return dollars / 1e6;
}

/** Context window size used for the "context %" gauge. */
export function contextWindow(model: string | null): number {
  if (model && model.startsWith('claude-haiku-4-5')) return 200_000;
  return 1_000_000;
}
