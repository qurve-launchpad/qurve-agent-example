// src/enrich.ts
import { WalletPortfolio, ChainPortfolio, TokenHolding } from "./portfolio";
import { getNativePricesUsd, getTokenPricesUsd } from "./prices";

// ─────────────────────────────────────────── Types ───

export interface EnrichedHolding {
  chainId: number;
  chainName: string;
  asset: string;          // symbol
  type: "native" | "token";
  amount: string;         // human-readable
  amountRaw: string;      // wei string
  priceUsd: number | null;
  valueUsd: number | null;
  percentOfTotal: number | null; // 0-100
  tokenAddress?: string;
  agentId?: number;       // set if this is a Qurve agent token
}

export interface EnrichedChain {
  chainId: number;
  chainName: string;
  nativeSymbol: string;
  nativeBalance: string;
  nativeValueUsd: number | null;
  tokens: Array<{
    address: string;
    symbol: string;
    name: string;
    decimals: number;
    balance: string;
    priceUsd: number | null;
    valueUsd: number | null;
    agentId?: number;
    source?: "user" | "static" | "qurve";
  }>;
  chainValueUsd: number | null;
  agentsScanned?: number;   // number of Qurve agent tokens scanned on this chain
  error?: string;
}

export interface RiskFlag {
  severity: "low" | "medium" | "high";
  code: string;
  message: string;
}

export interface EnrichedPortfolio {
  wallet: string;
  queriedAt: string;

  totalUsdValue: number;
  pricedCount: number;    // holdings with a price
  unpricedCount: number;  // holdings without a price

  stablecoinRatio: number; // 0-1
  chainCount: number;
  assetCount: number;

  chains: EnrichedChain[];
  topHoldings: EnrichedHolding[];   // max 10, sorted by USD value

  risks: RiskFlag[];
  hasAnyBalance: boolean;
}

// ─────────────────────────────────────────── Helpers ───

function isStablecoin(symbol: string): boolean {
  const s = symbol.toUpperCase();
  return ["USDC", "USDT", "DAI", "USDE", "USDS"].includes(s);
}

function isLikelyEmpty(amount: string): boolean {
  const n = Number(amount);
  return !Number.isFinite(n) || n === 0;
}

function addRisk(
  risks: RiskFlag[],
  severity: RiskFlag["severity"],
  code: string,
  message: string
): void {
  risks.push({ severity, code, message });
}

// ─────────────────────────────────────────── Main ───

export async function enrichPortfolio(
  portfolio: WalletPortfolio
): Promise<EnrichedPortfolio> {
  // ── 1. Collect unique native symbols ──
  const nativeSymbols = Array.from(
    new Set(portfolio.chains.map((c) => c.nativeSymbol))
  );
  const nativePrices = await getNativePricesUsd(nativeSymbols);

  // ── 2. Fetch token prices per chain (parallel) ──
  const tokenPricesByChain = new Map<number, Record<string, number>>();
  await Promise.all(
    portfolio.chains.map(async (chain) => {
      if (chain.tokens.length === 0) return;
      const addresses = chain.tokens.map((t) => t.address);
      const prices = await getTokenPricesUsd(chain.chainId, addresses);
      tokenPricesByChain.set(chain.chainId, prices);
    })
  );

  // ── 3. Build enriched chains ──
  const enrichedChains: EnrichedChain[] = [];
  let totalUsdValue = 0;
  let stablecoinUsd = 0;
  let pricedCount = 0;
  let unpricedCount = 0;

  for (const chain of portfolio.chains) {
    const nativePrice = nativePrices[chain.nativeSymbol] ?? null;
    const nativeValueUsd =
      nativePrice !== null && !isLikelyEmpty(chain.nativeBalance)
        ? Number(chain.nativeBalance) * nativePrice
        : nativePrice !== null
        ? 0
        : null;

    if (nativeValueUsd !== null) {
      totalUsdValue += nativeValueUsd;
      pricedCount++;
      if (isStablecoin(chain.nativeSymbol)) stablecoinUsd += nativeValueUsd;
    } else if (!isLikelyEmpty(chain.nativeBalance)) {
      unpricedCount++;
    }

    const tokenPrices = tokenPricesByChain.get(chain.chainId) ?? {};

    const enrichedTokens = chain.tokens.map((t) => {
      const price = tokenPrices[t.address.toLowerCase()] ?? null;
      const valueUsd =
        price !== null && !isLikelyEmpty(t.balanceFormatted)
          ? Number(t.balanceFormatted) * price
          : price !== null
          ? 0
          : null;

      if (valueUsd !== null) {
        totalUsdValue += valueUsd;
        pricedCount++;
        if (isStablecoin(t.symbol)) stablecoinUsd += valueUsd;
      } else if (!isLikelyEmpty(t.balanceFormatted)) {
        unpricedCount++;
      }

      return {
        address: t.address,
        symbol: t.symbol,
        name: t.name,
        decimals: t.decimals,
        balance: t.balanceFormatted,
        priceUsd: price,
        valueUsd,
        agentId: t.agentId,
        source: t.source,
      };
    });

    const chainValueUsd =
      nativeValueUsd !== null
        ? nativeValueUsd +
          enrichedTokens.reduce((s, t) => s + (t.valueUsd ?? 0), 0)
        : null;

    enrichedChains.push({
      chainId: chain.chainId,
      chainName: chain.chainName,
      nativeSymbol: chain.nativeSymbol,
      nativeBalance: chain.nativeBalance,
      nativeValueUsd,
      tokens: enrichedTokens,
      chainValueUsd,
      agentsScanned: chain.agentsScanned,
      error: chain.error,
    });
  }

  // ── 4. Build flat holdings list for top-holdings + asset count ──
  const allHoldings: EnrichedHolding[] = [];

  for (const c of enrichedChains) {
    if (!isLikelyEmpty(c.nativeBalance)) {
      allHoldings.push({
        chainId: c.chainId,
        chainName: c.chainName,
        asset: c.nativeSymbol,
        type: "native",
        amount: c.nativeBalance,
        amountRaw: "0",
        priceUsd: nativePrices[c.nativeSymbol] ?? null,
        valueUsd: c.nativeValueUsd,
        percentOfTotal: null,
      });
    }
    for (const t of c.tokens) {
      if (isLikelyEmpty(t.balance)) continue;
      allHoldings.push({
        chainId: c.chainId,
        chainName: c.chainName,
        asset: t.symbol,
        type: "token",
        amount: t.balance,
        amountRaw: "0",
        priceUsd: t.priceUsd,
        valueUsd: t.valueUsd,
        percentOfTotal: null,
        tokenAddress: t.address,
        agentId: t.agentId,
      });
    }
  }

  // ── 5. Fill percentOfTotal (where valueUsd is known) ──
  if (totalUsdValue > 0) {
    for (const h of allHoldings) {
      if (h.valueUsd !== null) {
        h.percentOfTotal = (h.valueUsd / totalUsdValue) * 100;
      }
    }
  }

  // ── 6. Top holdings (max 10, priced only, sorted) ──
  const topHoldings = allHoldings
    .filter((h) => h.valueUsd !== null && h.valueUsd > 0)
    .sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0))
    .slice(0, 10);

  // ── 7. Risk flags ──
  const risks: RiskFlag[] = [];
  const assetCount = allHoldings.length;
  const chainCount = enrichedChains.filter(
    (c) =>
      !isLikelyEmpty(c.nativeBalance) ||
      c.tokens.some((t) => !isLikelyEmpty(t.balance))
  ).length;
  const stablecoinRatio =
    totalUsdValue > 0 ? stablecoinUsd / totalUsdValue : 0;

  if (assetCount === 0) {
    addRisk(
      risks,
      "low",
      "empty_wallet",
      "Wallet has no balance on any scanned chain"
    );
  }

  if (totalUsdValue > 0) {
    // Concentration risk
    const top = topHoldings[0];
    if (top?.percentOfTotal !== undefined && top.percentOfTotal !== null) {
      if (top.percentOfTotal > 70) {
        addRisk(
          risks,
          "high",
          "high_concentration",
          `${top.percentOfTotal.toFixed(0)}% of portfolio in ${top.asset} (${top.chainName}) - high concentration risk`
        );
      } else if (top.percentOfTotal > 50) {
        addRisk(
          risks,
          "medium",
          "concentration",
          `${top.percentOfTotal.toFixed(0)}% of portfolio in ${top.asset} (${top.chainName}) - moderate concentration`
        );
      }
    }

    // Stablecoin buffer
    if (stablecoinRatio < 0.05 && totalUsdValue > 100) {
      addRisk(
        risks,
        "medium",
        "no_stablecoin_buffer",
        "Stablecoin buffer below 5% - limited flexibility to buy dips or cover gas"
      );
    }

    // Cross-chain fragmentation
    if (chainCount > 3 && totalUsdValue < 1000) {
      addRisk(
        risks,
        "low",
        "cross_chain_fragmentation",
        `Spread across ${chainCount} chains with total under $1000 - rebalancing gas may not be worth it`
      );
    }

    // Dust-only portfolio
    if (totalUsdValue < 10 && assetCount > 0) {
      addRisk(
        risks,
        "low",
        "dust_portfolio",
        `Total value $${totalUsdValue.toFixed(2)} - dust portfolio`
      );
    }
  }

  // Data quality warnings
  if (unpricedCount > 0) {
    addRisk(
      risks,
      "low",
      "unpriced_assets",
      `${unpricedCount} asset(s) could not be priced (chain or token not supported by price feed)`
    );
  }

  const erroredChains = enrichedChains.filter((c) => c.error);
  if (erroredChains.length > 0) {
    addRisk(
      risks,
      "low",
      "chain_errors",
      `${erroredChains.length} chain(s) failed to read: ${erroredChains
        .map((c) => c.chainName)
        .join(", ")}`
    );
  }

  return {
    wallet: portfolio.wallet,
    queriedAt: portfolio.queriedAt,
    totalUsdValue: Number(totalUsdValue.toFixed(2)),
    pricedCount,
    unpricedCount,
    stablecoinRatio,
    chainCount,
    assetCount,
    chains: enrichedChains,
    topHoldings,
    risks,
    hasAnyBalance: assetCount > 0,
  };
}
