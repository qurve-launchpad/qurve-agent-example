// src/index.ts
import "dotenv/config";
import express, { Request, Response } from "express";
import cors from "cors";
import { randomUUID } from "crypto";
import { ethers } from "ethers";
import { chat, llmInfo } from "./llm";
import { fetchWalletPortfolio } from "./portfolio";
import { enrichPortfolio } from "./enrich";
import { listKnownChains, getDefaultTokens } from "./chains";
import {
  PORTFOLIO_AGENT_SYSTEM_PROMPT,
  buildPortfolioUserMessage,
} from "./prompts";

const PORT = Number(process.env.PORT || 4000);
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;

const app = express();
app.use(cors());
app.use(express.json({ limit: "100kb" }));

// ═══════════════════════════════════════════════════════════════════════
// OUTPUT SANITIZER
//
// LLMs occasionally emit "smart" Unicode characters (em-dash, curly
// quotes, non-breaking spaces, bullets) that:
//   - Render as mojibake in Windows terminals (ΓÇæ)
//   - Break log aggregation tools
//   - Are inconsistent with the Qurve terminal style (ASCII-only)
//
// This sanitizer normalizes them to ASCII equivalents.
// ═══════════════════════════════════════════════════════════════════════

function sanitizeOutput(text: string): string {
  return (
    text
      // ── Dashes ──
      .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015]/g, "-")
      // ── Quotes ──
      .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
      .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
      // ── Spaces ──
      .replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, " ")
      // ── Ellipsis ──
      .replace(/\u2026/g, "...")
      // ── Bullets ──
      .replace(/[\u2022\u2023\u2043\u2219]/g, "-")
      // ── Arrows ──
      .replace(/[\u2192\u27A1]/g, "->")
      .replace(/[\u2190\u2B05]/g, "<-")
      // ── Math symbols ──
      .replace(/\u00D7/g, "x")
      .replace(/\u00F7/g, "/")
      // ── Trailing whitespace per line ──
      .replace(/[ \t]+$/gm, "")
      // ── Multiple blank lines ──
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

// ═══════════════════════════════════════════════════════════════════════
// RATE LIMIT (in-memory)
// ═══════════════════════════════════════════════════════════════════════

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || entry.resetAt < now) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

// Cleanup map every 5 minutes — avoids memory leak in long-running instances.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateLimitMap) {
    if (v.resetAt < now) rateLimitMap.delete(k);
  }
}, 5 * 60_000).unref();

// ═══════════════════════════════════════════════════════════════════════
// AGENT CARD
// ═══════════════════════════════════════════════════════════════════════

const AGENT_CARD = {
  name: "xQurve Agent",
  description:
    "Reads any wallet's portfolio across BOT Chain, Base, Robinhood Chain, and Arc. Returns USD-valued analysis with risk assessment and actionable observations.",
  url: `${PUBLIC_URL}/a2a`,
  version: "1.2.0",
  protocolVersion: "0.3.0",
  preferredTransport: "JSONRPC",
  capabilities: {
    streaming: false,
    pushNotifications: false,
  },
  defaultInputModes: ["text/plain", "application/json"],
  defaultOutputModes: ["text/plain"],
  skills: [
    {
      id: "portfolio-snapshot",
      name: "Portfolio Snapshot",
      description:
        "Reads a wallet's native + ERC-20 holdings across chains and returns USD-valued analysis with risk assessment.",
      tags: ["defi", "portfolio", "multi-chain", "analysis"],
      examples: [
        "Read portfolio for wallet 0x... across all chains",
        "Analyze wallet 0x... with USDC and WETH",
      ],
    },
    {
      id: "portfolio-risk",
      name: "Portfolio Risk Assessment",
      description:
        "Identifies concentration, stablecoin buffer, cross-chain fragmentation risks.",
      tags: ["defi", "portfolio", "risk"],
      examples: ["What are the risks in my wallet 0x..."],
    },
    {
      id: "cross-chain-holdings",
      name: "Cross-Chain Holdings",
      description:
        "Unified USD-valued snapshot across BOT Chain, Base, Robinhood Chain, and Arc.",
      tags: ["defi", "portfolio", "cross-chain"],
    },
  ],
};

app.get("/.well-known/agent.json", (_req, res) => res.json(AGENT_CARD));
app.get("/.well-known/agent-card.json", (_req, res) => res.json(AGENT_CARD));

// ═══════════════════════════════════════════════════════════════════════
// INPUT EXTRACTION
//
// Handles multiple request shapes so the agent works with:
//   - Qurve backend (params.userId + optional tokensByChain)
//   - Direct A2A JSON-RPC (message/send with parts)
//   - Ad-hoc curl (params.request with wallet in text)
//   - FE custom (params.wallet / walletAddress / address + tokens arrays)
// ═══════════════════════════════════════════════════════════════════════

const KNOWN_CAPABILITIES = new Set([
  "portfolio-snapshot",
  "portfolio-pnl",
  "portfolio-risk",
  "cross-chain-holdings",
  "portfolio-analysis",
]);

interface ExtractedInput {
  wallet?: string;
  chainIds?: number[];
  tokensByChain: Record<number, string[]>;
}

function isAddress(s: unknown): s is string {
  return typeof s === "string" && ethers.isAddress(s);
}

function extractWalletFromText(text: string): string | undefined {
  const m = text.match(/0x[a-fA-F0-9]{40}/);
  return m ? m[0] : undefined;
}

function collectTokens(source: unknown): string[] {
  if (!Array.isArray(source)) return [];
  return source.filter(isAddress);
}

function extractInput(body: any): ExtractedInput {
  const params = body?.params ?? {};
  const out: ExtractedInput = { tokensByChain: {} };

  // ═══════════════════════════════════════════════════════════════
  // WALLET — try multiple field names
  // ═══════════════════════════════════════════════════════════════
  const walletCandidates = [
    params.userId,
    params.wallet,
    params.walletAddress,
    params.address,
    params.user,
  ];
  for (const c of walletCandidates) {
    if (isAddress(c)) {
      out.wallet = c;
      break;
    }
  }

  // Fallback: extract from the request text.
  if (!out.wallet && typeof params.request === "string") {
    out.wallet = extractWalletFromText(params.request);
  }

  // ═══════════════════════════════════════════════════════════════
  // CHAINS — try multiple field names
  // ═══════════════════════════════════════════════════════════════
  const chainCandidates = [params.chainIds, params.chains];
  for (const c of chainCandidates) {
    if (Array.isArray(c)) {
      const f = c
        .map((x) => Number(x))
        .filter((n) => Number.isFinite(n) && n > 0);
      if (f.length > 0) {
        out.chainIds = f;
        break;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // TOKENS — multiple shapes
  // ═══════════════════════════════════════════════════════════════

  // Shape 1: tokensByChain = { 84532: ["0x...", "0x..."], 677: [...] }
  if (params.tokensByChain && typeof params.tokensByChain === "object") {
    for (const [k, v] of Object.entries(params.tokensByChain)) {
      const cid = Number(k);
      if (!Number.isFinite(cid) || cid <= 0) continue;
      const arr = collectTokens(v);
      if (arr.length > 0) {
        out.tokensByChain[cid] = [
          ...(out.tokensByChain[cid] ?? []),
          ...arr,
        ];
      }
    }
  }

  // Shape 2: tokens = { 84532: [...] } (alias)
  if (
    params.tokens &&
    typeof params.tokens === "object" &&
    !Array.isArray(params.tokens)
  ) {
    for (const [k, v] of Object.entries(params.tokens)) {
      const cid = Number(k);
      if (!Number.isFinite(cid) || cid <= 0) continue;
      const arr = collectTokens(v);
      if (arr.length > 0) {
        out.tokensByChain[cid] = [
          ...(out.tokensByChain[cid] ?? []),
          ...arr,
        ];
      }
    }
  }

  // Shape 3: tokenAddresses (flat array) — legacy, assume Arc.
  const legacy = collectTokens(params.tokenAddresses);
  if (legacy.length > 0) {
    const ARC_ID = 5042002;
    out.tokensByChain[ARC_ID] = [
      ...(out.tokensByChain[ARC_ID] ?? []),
      ...legacy,
    ];
  }

  // Shape 4: tokenAddress (single string) — assume Arc.
  if (isAddress(params.tokenAddress)) {
    const ARC_ID = 5042002;
    out.tokensByChain[ARC_ID] = [
      ...(out.tokensByChain[ARC_ID] ?? []),
      params.tokenAddress,
    ];
  }

  // ═══════════════════════════════════════════════════════════════
  // A2A v0.3.0 Message parts
  // ═══════════════════════════════════════════════════════════════
  const parts = params?.message?.parts;
  if (Array.isArray(parts)) {
    const textPart = parts.find(
      (p: any) => p.kind === "text" || p.type === "text"
    );
    const dataPart = parts.find(
      (p: any) => p.kind === "data" || p.type === "data"
    );

    // Wallet from parts
    if (!out.wallet) {
      const candidates = [
        dataPart?.data?.wallet,
        dataPart?.data?.walletAddress,
        dataPart?.data?.address,
      ];
      for (const c of candidates) {
        if (isAddress(c)) {
          out.wallet = c;
          break;
        }
      }
    }
    if (!out.wallet && typeof textPart?.text === "string") {
      out.wallet = extractWalletFromText(textPart.text);
    }

    // Chains from parts
    if (!out.chainIds && Array.isArray(dataPart?.data?.chainIds)) {
      const f = dataPart.data.chainIds
        .map((x: any) => Number(x))
        .filter((n: number) => Number.isFinite(n) && n > 0);
      if (f.length > 0) out.chainIds = f;
    }

    // Tokens from parts
    if (
      dataPart?.data?.tokensByChain &&
      typeof dataPart.data.tokensByChain === "object"
    ) {
      for (const [k, v] of Object.entries(dataPart.data.tokensByChain)) {
        const cid = Number(k);
        if (!Number.isFinite(cid) || cid <= 0) continue;
        const arr = collectTokens(v);
        if (arr.length > 0) {
          out.tokensByChain[cid] = [
            ...(out.tokensByChain[cid] ?? []),
            ...arr,
          ];
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // DEFAULT TOKENS — inject per chain from env
  //
  // If the user did not specify tokens for a chain, the agent still
  // checks the default token set (e.g. USDC) so the output is not
  // empty merely because the user forgot to send token addresses.
  // ═══════════════════════════════════════════════════════════════
  const chainsToScan = out.chainIds ?? listKnownChains().map((c) => c.chainId);
  for (const cid of chainsToScan) {
    const defaults = getDefaultTokens(cid);
    if (defaults.length === 0) continue;
    out.tokensByChain[cid] = [
      ...(out.tokensByChain[cid] ?? []),
      ...defaults,
    ];
  }

  // Dedupe tokens per chain.
  for (const cid of Object.keys(out.tokensByChain)) {
    const key = Number(cid);
    out.tokensByChain[key] = Array.from(
      new Set(out.tokensByChain[key].map((a) => a.toLowerCase()))
    );
  }

  return out;
}

// ═══════════════════════════════════════════════════════════════════════
// A2A ENDPOINT
// ═══════════════════════════════════════════════════════════════════════

app.post("/a2a", async (req: Request, res: Response) => {
  const ip = req.ip ?? "unknown";

  if (!checkRateLimit(ip)) {
    return res.status(429).json({
      jsonrpc: "2.0",
      id: req.body?.id ?? null,
      error: {
        code: -32429,
        message: "Rate limit exceeded. Try again in a minute.",
      },
    });
  }

  const { id, method, params } = req.body ?? {};
  const rpcId = id ?? randomUUID();

  const isKnownCapability =
    typeof method === "string" && KNOWN_CAPABILITIES.has(method);
  const isMessageSend = method === "message/send";

  if (!isKnownCapability && !isMessageSend) {
    return res.json({
      jsonrpc: "2.0",
      id: rpcId,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  }

  const startMs = Date.now();

  try {
    const { wallet, chainIds, tokensByChain } = extractInput(req.body);

    // ── Friendly responses ──
    if (!wallet) {
      const friendly =
        "Please provide a wallet address (0x..., 42 characters) so I can read the portfolio across chains.";
      return res.json({
        jsonrpc: "2.0",
        id: rpcId,
        result: {
          output: friendly,
          usage: { tokens: 0 },
          role: "agent",
          messageId: randomUUID(),
          parts: [{ kind: "text", text: friendly }],
        },
      });
    }

    if (!ethers.isAddress(wallet)) {
      const friendly = `The address "${wallet}" is malformed - expected 42 characters starting with 0x.`;
      return res.json({
        jsonrpc: "2.0",
        id: rpcId,
        result: {
          output: friendly,
          usage: { tokens: 0 },
          role: "agent",
          messageId: randomUUID(),
          parts: [{ kind: "text", text: friendly }],
        },
      });
    }

    // ═══════════════════════════════════════════════════════════════
    // PIPELINE: fetch -> enrich -> LLM -> sanitize
    // ═══════════════════════════════════════════════════════════════

    const portfolio = await fetchWalletPortfolio(
      wallet,
      tokensByChain,
      chainIds
    );

    const enriched = await enrichPortfolio(portfolio);

    const rawAnalysis = await chat([
      { role: "system", content: PORTFOLIO_AGENT_SYSTEM_PROMPT },
      { role: "user", content: buildPortfolioUserMessage(enriched) },
    ]);

    const analysis = sanitizeOutput(rawAnalysis);

    const durationMs = Date.now() - startMs;

    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        event: "a2a_success",
        requestId: params?.requestId,
        wallet,
        chainCount: enriched.chainCount,
        assetCount: enriched.assetCount,
        totalUsd: enriched.totalUsdValue,
        riskCount: enriched.risks.length,
        tokensScanned: Object.fromEntries(
          Object.entries(tokensByChain).map(([k, v]) => [k, v.length])
        ),
        durationMs,
      })
    );

    return res.json({
      jsonrpc: "2.0",
      id: rpcId,
      result: {
        output: analysis,
        usage: { tokens: 0 },
        role: "agent",
        messageId: randomUUID(),
        parts: [{ kind: "text", text: analysis }],
        metadata: {
          enriched,
          llm: llmInfo,
          durationMs,
          capability: isKnownCapability ? method : "portfolio-analysis",
        },
      },
    });
  } catch (err: any) {
    const durationMs = Date.now() - startMs;
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        event: "a2a_error",
        requestId: params?.requestId,
        error: err?.message,
        durationMs,
      })
    );

    return res.json({
      jsonrpc: "2.0",
      id: rpcId,
      error: {
        code: -32000,
        message: err?.message ?? "Internal agent error",
      },
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// HEALTH / DEBUG
// ═══════════════════════════════════════════════════════════════════════

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    llm: llmInfo,
    chains: listKnownChains().length,
    rateLimit: {
      windowMs: RATE_LIMIT_WINDOW_MS,
      max: RATE_LIMIT_MAX,
    },
    uptimeSeconds: Math.floor(process.uptime()),
  });
});

app.get("/chains", (_req, res) => {
  res.json({
    known: listKnownChains().map((c) => ({
      chainId: c.chainId,
      name: c.name,
      nativeSymbol: c.nativeSymbol,
      defaultTokens: getDefaultTokens(c.chainId),
    })),
  });
});

// ═══════════════════════════════════════════════════════════════════════
// LISTEN
// ═══════════════════════════════════════════════════════════════════════

app.listen(PORT, () => {
  console.log(`\nxQurve Agent v1.2.0 running at ${PUBLIC_URL}`);
  console.log(`   Agent Card (A2A)  : ${PUBLIC_URL}/.well-known/agent-card.json`);
  console.log(`   Agent Card (Qurve): ${PUBLIC_URL}/.well-known/agent.json`);
  console.log(`   A2A JSON-RPC      : ${PUBLIC_URL}/a2a`);
  console.log(`   Chains            : ${listKnownChains().map((c) => c.name).join(", ")}`);
  console.log(`   LLM               : ${llmInfo.provider} (${llmInfo.model})`);
  console.log(`   Rate limit        : ${RATE_LIMIT_MAX}/${RATE_LIMIT_WINDOW_MS / 1000}s per IP`);
  console.log(`\n   Default tokens per chain:`);
  for (const c of listKnownChains()) {
    const tokens = getDefaultTokens(c.chainId);
    console.log(
      `   - ${c.name.padEnd(20)}: ${tokens.length > 0 ? tokens.join(", ") : "(none configured)"}`
    );
  }
  console.log("");
});
