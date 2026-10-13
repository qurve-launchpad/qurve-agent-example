// src/qurve.ts

/**
 * Qurve API client — used for agent token auto-discovery.
 *
 * Every agent launched on Qurve has its own ERC-20 token. This module
 * fetches the full list of agent tokens per chain so the portfolio
 * reader can check the user's balance for each, without requiring
 * them to specify addresses manually.
 *
 * 10-minute cache — the agent list changes rarely, and Qurve already
 * has its own rate limiting.
 */

const QURVE_API_URL = (process.env.QURVE_API_URL || "").replace(/\/$/, "");
const CACHE_TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_AGENTS_PER_CHAIN = 500;
const PAGE_SIZE = 100;

export interface QurveAgentToken {
  chainId: number;
  agentId: number;
  name: string | null;
  symbol: string | null;
  tokenAddress: string; // lowercase
  owner: string;
}

interface CacheEntry {
  tokens: QurveAgentToken[];
  expiresAt: number;
}

const cache = new Map<number, CacheEntry>();

/**
 * True when the Qurve API URL is configured. If false, auto-discovery
 * is skipped (the agent still reads native + static tokens).
 */
export function isQurveEnabled(): boolean {
  return QURVE_API_URL.length > 0;
}

/**
 * Fetch the list of all agent tokens on a single chain from the Qurve API.
 * Paginated — follows `hasMore` until exhausted or MAX_AGENTS_PER_CHAIN.
 */
export async function fetchQurveAgentTokens(
  chainId: number
): Promise<QurveAgentToken[]> {
  if (!isQurveEnabled()) return [];

  // ── Cache check ──
  const cached = cache.get(chainId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.tokens;
  }

  const out: QurveAgentToken[] = [];
  let page = 1;

  while (out.length < MAX_AGENTS_PER_CHAIN) {
    const url = `${QURVE_API_URL}/api/agents?chainId=${chainId}&limit=${PAGE_SIZE}&page=${page}`;

    let data: any;
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { Accept: "application/json" },
      });
      if (!res.ok) break;
      data = await res.json();
    } catch {
      break; // Qurve API down — return whatever we have so far
    }

    const items: any[] = Array.isArray(data?.data) ? data.data : [];
    if (items.length === 0) break;

    for (const item of items) {
      if (
        typeof item?.tokenAddress === "string" &&
        /^0x[a-fA-F0-9]{40}$/.test(item.tokenAddress)
      ) {
        out.push({
          chainId: Number(item.chainId) || chainId,
          agentId: Number(item.agentId) || 0,
          name: typeof item.name === "string" ? item.name : null,
          symbol: typeof item.symbol === "string" ? item.symbol : null,
          tokenAddress: item.tokenAddress.toLowerCase(),
          owner:
            typeof item.owner === "string"
              ? item.owner.toLowerCase()
              : "0x0000000000000000000000000000000000000000",
        });
      }
    }

    if (!data?.hasMore || items.length < PAGE_SIZE) break;
    page++;
  }

  // ── Update cache ──
  cache.set(chainId, {
    tokens: out,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return out;
}

/**
 * Force-clear the cache (called from an admin endpoint or tests).
 */
export function clearQurveCache(): void {
  cache.clear();
}

/**
 * Startup log helper — summary of the cache state per chain.
 */
export function qurveInfo() {
  return {
    enabled: isQurveEnabled(),
    apiUrl: QURVE_API_URL || null,
    cachedChains: Array.from(cache.keys()),
  };
}
