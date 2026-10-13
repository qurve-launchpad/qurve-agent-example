// src/portfolio.ts
import { ethers, Network } from "ethers";
import {
  ChainConfig,
  DEFAULT_CHAIN_IDS,
  getChainConfig,
} from "./chains";
import { fetchQurveAgentTokens, isQurveEnabled } from "./qurve";

const ERC20_MINIMAL_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
];

const RPC_TIMEOUT_MS = Number(process.env.RPC_TIMEOUT_MS ?? "8000");

// ── Concurrency for agent token discovery ──
// 20 parallel balanceOf calls. Raise this if your RPC is powerful.
const AGENT_BALANCE_CONCURRENCY = Number(
  process.env.AGENT_BALANCE_CONCURRENCY ?? "20"
);

// ═══════════════════════════════════════════════════════════════
// Provider cache
//
// staticNetwork: ethers v6 does not detect the network via eth_chainId
// when staticNetwork is set, so there is no retry spam of
// "JsonRpcProvider failed to detect network".
// ═══════════════════════════════════════════════════════════════

const providerCache = new Map<number, ethers.JsonRpcProvider>();

function getProvider(chain: ChainConfig): ethers.JsonRpcProvider {
  const cached = providerCache.get(chain.chainId);
  if (cached) return cached;

  const network = new Network(chain.name, chain.chainId);
  const provider = new ethers.JsonRpcProvider(chain.rpcUrl, network, {
    staticNetwork: network,
    batchMaxCount: 1,
  });

  providerCache.set(chain.chainId, provider);
  return provider;
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} timeout after ${ms}ms`)),
        ms
      )
    ),
  ]);
}

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface TokenHolding {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  balanceRaw: string;
  balanceFormatted: string;
  /** Set if this token is a Qurve agent token. */
  agentId?: number;
  /** Source: 'user' (from request), 'static' (env), 'qurve' (agent token). */
  source?: "user" | "static" | "qurve";
}

export interface ChainPortfolio {
  chainId: number;
  chainName: string;
  nativeSymbol: string;
  nativeBalanceRaw: string;
  nativeBalance: string;
  tokens: TokenHolding[];
  /** Number of Qurve agent tokens scanned on this chain (informational). */
  agentsScanned?: number;
  error?: string;
}

export interface WalletPortfolio {
  wallet: string;
  chains: ChainPortfolio[];
  queriedAt: string;
}

// ═══════════════════════════════════════════════════════════════
// Per-token reader
// ═══════════════════════════════════════════════════════════════

async function readToken(
  provider: ethers.JsonRpcProvider,
  wallet: string,
  tokenAddress: string
): Promise<TokenHolding> {
  if (!ethers.isAddress(tokenAddress)) {
    throw new Error(`invalid token address: ${tokenAddress}`);
  }

  const contract = new ethers.Contract(
    tokenAddress,
    ERC20_MINIMAL_ABI,
    provider
  );

  const [balanceRaw, decimals, symbol, name] = await Promise.all([
    withTimeout(
      contract.balanceOf(wallet) as Promise<bigint>,
      RPC_TIMEOUT_MS,
      `balanceOf(${tokenAddress})`
    ),
    withTimeout(
      contract.decimals() as Promise<number | bigint>,
      RPC_TIMEOUT_MS,
      `decimals(${tokenAddress})`
    ),
    (contract.symbol() as Promise<string>).catch(() => "???"),
    (contract.name() as Promise<string>).catch(() => ""),
  ]);

  const dec = Number(decimals);
  return {
    address: tokenAddress,
    symbol,
    name: name || symbol,
    decimals: dec,
    balanceRaw: balanceRaw.toString(),
    balanceFormatted: ethers.formatUnits(balanceRaw, dec),
  };
}

// ═══════════════════════════════════════════════════════════════
// Agent token discovery
//
// Fetch the list of all agent tokens on the chain (from the Qurve API,
// cached), then check the user's balance for each. Filter to those
// with balance > 0. Metadata is only fetched when balance > 0 — saves
// RPC calls for wallets that hold few agents.
// ═══════════════════════════════════════════════════════════════

async function discoverAgentHoldings(
  wallet: string,
  chain: ChainConfig
): Promise<{ holdings: TokenHolding[]; scanned: number }> {
  if (!isQurveEnabled()) {
    return { holdings: [], scanned: 0 };
  }

  const agents = await fetchQurveAgentTokens(chain.chainId);
  if (agents.length === 0) {
    return { holdings: [], scanned: 0 };
  }

  const provider = getProvider(chain);
  const holdings: TokenHolding[] = [];

  // Chunk parallel calls to avoid RPC overload.
  for (let i = 0; i < agents.length; i += AGENT_BALANCE_CONCURRENCY) {
    const batch = agents.slice(i, i + AGENT_BALANCE_CONCURRENCY);

    const results = await Promise.allSettled(
      batch.map(async (agent) => {
        // Step 1: balance check (cheap — one call).
        const contract = new ethers.Contract(
          agent.tokenAddress,
          ERC20_MINIMAL_ABI,
          provider
        );

        let balance: bigint;
        try {
          balance = (await withTimeout(
            contract.balanceOf(wallet) as Promise<bigint>,
            RPC_TIMEOUT_MS,
            `balanceOf(${agent.tokenAddress})`
          )) as bigint;
        } catch {
          return null; // skip this token, do not crash the batch
        }

        if (balance === 0n) return null; // not held — skip metadata

        // Step 2: metadata (only if balance > 0).
        const [decimals, symbol, name] = await Promise.all([
          withTimeout(
            contract.decimals() as Promise<number | bigint>,
            RPC_TIMEOUT_MS,
            "decimals"
          ).catch(() => 18),
          (contract.symbol() as Promise<string>).catch(
            () => agent.symbol ?? "???"
          ),
          (contract.name() as Promise<string>).catch(
            () => agent.name ?? ""
          ),
        ]);

        const dec = Number(decimals);
        const holding: TokenHolding = {
          address: agent.tokenAddress,
          symbol,
          name: name || symbol,
          decimals: dec,
          balanceRaw: balance.toString(),
          balanceFormatted: ethers.formatUnits(balance, dec),
          agentId: agent.agentId,
          source: "qurve",
        };
        return holding;
      })
    );

    for (const r of results) {
      if (r.status === "fulfilled" && r.value !== null) {
        holdings.push(r.value);
      }
    }
  }

  return { holdings, scanned: agents.length };
}

// ═══════════════════════════════════════════════════════════════
// Per-chain reader
// ═══════════════════════════════════════════════════════════════

async function fetchChainPortfolio(
  wallet: string,
  chain: ChainConfig,
  requestedTokens: string[]
): Promise<ChainPortfolio> {
  const base: ChainPortfolio = {
    chainId: chain.chainId,
    chainName: chain.name,
    nativeSymbol: chain.nativeSymbol,
    nativeBalanceRaw: "0",
    nativeBalance: "0",
    tokens: [],
  };

  // ── 1. Native balance ──
  try {
    const provider = getProvider(chain);
    const nativeRaw = await withTimeout(
      provider.getBalance(wallet),
      RPC_TIMEOUT_MS,
      `getBalance(${chain.name})`
    );
    base.nativeBalanceRaw = nativeRaw.toString();
    base.nativeBalance = ethers.formatUnits(nativeRaw, chain.nativeDecimals);
  } catch (err: any) {
    base.error = `native: ${err?.message ?? "unknown error"}`;
    return base;
  }

  const provider = getProvider(chain);

  // ── 2. User-specified tokens + static tokens (from env) ──
  const explicitTokens = Array.from(
    new Set(requestedTokens.map((t) => t.toLowerCase()))
  );

  if (explicitTokens.length > 0) {
    const results = await Promise.allSettled(
      explicitTokens.map((addr) => readToken(provider, wallet, addr))
    );
    for (const r of results) {
      if (r.status === "fulfilled") {
        r.value.source = "user";
        base.tokens.push(r.value);
      }
    }
  }

  // ── 3. Agent token discovery ──
  try {
    const { holdings, scanned } = await discoverAgentHoldings(wallet, chain);
    base.agentsScanned = scanned;

    // Dedupe — do not double-count tokens already scanned in step 2.
    const existing = new Set(
      base.tokens.map((t) => t.address.toLowerCase())
    );
    for (const h of holdings) {
      if (!existing.has(h.address.toLowerCase())) {
        base.tokens.push(h);
      }
    }
  } catch (err: any) {
    // Discovery failure should not crash the whole chain read.
    base.error = base.error
      ? `${base.error}; discovery: ${err?.message}`
      : `discovery: ${err?.message}`;
  }

  return base;
}

// ═══════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════

export async function fetchWalletPortfolio(
  wallet: string,
  tokensByChain: Record<number, string[]> = {},
  chainIds?: number[]
): Promise<WalletPortfolio> {
  if (!ethers.isAddress(wallet)) {
    throw new Error(`Invalid wallet address: ${wallet}`);
  }

  const ids =
    chainIds && chainIds.length > 0 ? chainIds : DEFAULT_CHAIN_IDS;

  const targets: Array<{ chain: ChainConfig; tokens: string[] }> = [];
  for (const id of ids) {
    const chain = getChainConfig(id);
    if (!chain) continue;
    targets.push({ chain, tokens: tokensByChain[id] ?? [] });
  }

  const results = await Promise.all(
    targets.map(({ chain, tokens }) =>
      fetchChainPortfolio(wallet, chain, tokens)
    )
  );

  return {
    wallet,
    chains: results,
    queriedAt: new Date().toISOString(),
  };
}
