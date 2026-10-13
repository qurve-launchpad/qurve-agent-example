// src/chains.ts

/**
 * Registry of all chains the portfolio agent can read.
 * RPC URLs are overridable via .env so you can use private RPCs
 * (Arc/BOT public RPCs rate-limit aggressively when hit from a server).
 */
export interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  nativeSymbol: string;
  nativeDecimals: number;
}

export const CHAINS: Record<number, ChainConfig> = {
  // ─────────────────────────────────────────── Arc Testnet ───
  5042002: {
    chainId: 5042002,
    name: "Arc Testnet",
    rpcUrl: process.env.ARC_RPC_URL || "https://rpc.testnet.arc.io",
    nativeSymbol: "USDC",
    // Native Arc uses 18 decimals (not 6 — the ERC-20 USDC precompile
    // uses 6; these are two different representations of the same asset).
    nativeDecimals: 18,
  },

  // ─────────────────────────────────────────── Base ───
  8453: {
    chainId: 8453,
    name: "Base",
    rpcUrl: process.env.BASE_RPC_URL || "https://mainnet.base.org",
    nativeSymbol: "ETH",
    nativeDecimals: 18,
  },

  // ─────────────────────────────────────────── Base Sepolia ───
  84532: {
    chainId: 84532,
    name: "Base Sepolia",
    rpcUrl: process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
    nativeSymbol: "ETH",
    nativeDecimals: 18,
  },

  // ─────────────────────────────────────────── Robinhood ───
  4663: {
    chainId: 4663,
    name: "Robinhood Chain",
    rpcUrl:
      process.env.ROBINHOOD_RPC_URL ||
      "https://rpc.mainnet.chain.robinhood.com",
    nativeSymbol: "ETH",
    nativeDecimals: 18,
  },

  // ─────────────────────────────────────────── BOT Chain ───
  677: {
    chainId: 677,
    name: "BOT Chain",
    rpcUrl: process.env.BOT_RPC_URL || "https://rpc.botchain.ai",
    nativeSymbol: "BOT",
    nativeDecimals: 18,
  },
};

/**
 * Which chains are queried by default when a request does not specify.
 * Override via env: PORTFOLIO_CHAINS="677,8453,4663,5042002".
 */
function parseChainIds(raw: string | undefined, fallback: number[]): number[] {
  if (!raw) return fallback;
  const ids = raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  return ids.length > 0 ? ids : fallback;
}

export const DEFAULT_CHAIN_IDS: number[] = parseChainIds(
  process.env.PORTFOLIO_CHAINS,
  [677, 8453, 4663, 5042002]
);

export function getChainConfig(chainId: number): ChainConfig | null {
  return CHAINS[chainId] ?? null;
}

export function listKnownChains(): ChainConfig[] {
  return Object.values(CHAINS);
}

/**
 * Default ERC-20 tokens per chain, loaded from env.
 *
 * Env format: DEFAULT_TOKENS_<chainId>=0xaddr1,0xaddr2,...
 * Example:    DEFAULT_TOKENS_84532=0x036CbD53842c5426634e7929541eC2318f3dCF7e
 *
 * These tokens are checked automatically when the request does not
 * specify tokens for that chain. Useful so the agent always checks
 * at least stablecoins / standard tokens without requiring the user
 * to pass addresses explicitly.
 */
export function getDefaultTokens(chainId: number): string[] {
  const raw = process.env[`DEFAULT_TOKENS_${chainId}`];
  if (!raw) return [];

  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^0x[a-f0-9]{40}$/.test(s));
}
