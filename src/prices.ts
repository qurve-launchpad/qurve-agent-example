// src/prices.ts

/**
 * CoinGecko price fetcher with an in-memory cache.
 *
 * Free-tier rate limit: ~10-30 req/min. A 5-minute cache keeps us safe.
 * When volume grows, switch to Redis + paid tier, or use DEX price feeds.
 *
 * Supported:
 * - Native: ETH (CoinGecko), BOT (CoinGecko via wrapped-bot), USDC ($1)
 * - ERC-20: Base via CoinGecko contract lookup; other chains best-effort
 *
 * Chain -> CoinGecko platform mapping is only defined for chains we support.
 * Chains without mapping do not get token prices (amount is still shown).
 */

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const FETCH_TIMEOUT_MS = 8_000;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const priceCache = new Map<string, CacheEntry<number>>();

// ── Chain -> CoinGecko platform slug ──
const COINGECKO_PLATFORM: Record<number, string> = {
  1: "ethereum",
  8453: "base",
  84532: "base", // treat Sepolia as Base (same token set)
  // Arc, Robinhood, BOT — not covered by CoinGecko free tier for ERC-20s.
};

// ── Native symbol -> CoinGecko ID ──
// USDC is always $1 (stablecoin) — no fetch needed.
const COINGECKO_NATIVE_ID: Record<string, string> = {
  ETH: "ethereum",
  BOT: "wrapped-bot",
};

// ─────────────────────────────────────────── Cache helper ───

function getCached(key: string): number | null {
  const entry = priceCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    priceCache.delete(key);
    return null;
  }
  return entry.value;
}

function setCached(key: string, value: number): void {
  priceCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ─────────────────────────────────────────── Fetch helper ───

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────── Native prices ───

/**
 * Fetch native USD prices for multiple symbols in one call.
 * Symbol "USDC" always resolves to $1.
 */
export async function getNativePricesUsd(
  symbols: string[]
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};

  const idsToFetch: string[] = [];
  const symbolById: Record<string, string> = {};

  for (const sym of symbols) {
    if (sym === "USDC") {
      out.USDC = 1;
      continue;
    }

    const cgId = COINGECKO_NATIVE_ID[sym];
    if (!cgId) continue;

    const cacheKey = `native:${sym}`;
    const cached = getCached(cacheKey);
    if (cached !== null) {
      out[sym] = cached;
      continue;
    }

    idsToFetch.push(cgId);
    symbolById[cgId] = sym;
  }

  if (idsToFetch.length === 0) return out;

  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${idsToFetch.join(",")}&vs_currencies=usd`;
  const data = await fetchJson<Record<string, { usd: number }>>(url);

  if (!data) {
    // Fetch failed — use fallback values (never crash).
    for (const cgId of idsToFetch) {
      const sym = symbolById[cgId];
      const fallback = sym === "BOT" ? 1.0 : 3000; // rough fallback
      out[sym] = fallback;
      setCached(`native:${sym}`, fallback);
    }
    return out;
  }

  for (const [cgId, priceData] of Object.entries(data)) {
    const sym = symbolById[cgId];
    if (!sym || typeof priceData?.usd !== "number") continue;
    out[sym] = priceData.usd;
    setCached(`native:${sym}`, priceData.usd);
  }

  return out;
}

// ─────────────────────────────────────────── ERC-20 prices ───

/**
 * Fetch ERC-20 token prices on a single chain.
 * Chains without CoinGecko support return {} (token is not priced).
 *
 * @param chainId  Chain ID
 * @param tokens   Array of token addresses (lowercase)
 * @returns Map of address (lowercase) -> USD price
 */
export async function getTokenPricesUsd(
  chainId: number,
  tokens: string[]
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};

  if (tokens.length === 0) return out;

  const platform = COINGECKO_PLATFORM[chainId];
  if (!platform) return out; // chain does not support token pricing

  // Normalize + dedupe.
  const unique = Array.from(new Set(tokens.map((t) => t.toLowerCase())));

  // Check per-token cache.
  const uncached: string[] = [];
  for (const addr of unique) {
    const cacheKey = `token:${chainId}:${addr}`;
    const cached = getCached(cacheKey);
    if (cached !== null) {
      out[addr] = cached;
    } else {
      uncached.push(addr);
    }
  }

  if (uncached.length === 0) return out;

  // Batch fetch (CoinGecko limits ~100 addresses per call).
  const batchSize = 50;
  for (let i = 0; i < uncached.length; i += batchSize) {
    const batch = uncached.slice(i, i + batchSize);
    const url = `https://api.coingecko.com/api/v3/simple/token_price/${platform}?contract_addresses=${batch.join(",")}&vs_currencies=usd`;

    const data = await fetchJson<
      Record<string, { usd: number }>
    >(url);

    if (!data) continue;

    for (const [addr, priceData] of Object.entries(data)) {
      if (typeof priceData?.usd !== "number") continue;
      const lower = addr.toLowerCase();
      out[lower] = priceData.usd;
      setCached(`token:${chainId}:${lower}`, priceData.usd);
    }
  }

  return out;
}
