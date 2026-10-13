# xQurve Agent — Portfolio Analyst

> A2A-compliant portfolio analyst agent for the **Qurve** trustless agent launchpad. Reads any wallet's multi-chain portfolio, enriches with live USD values, and returns a structured risk assessment powered by a cheap/free LLM.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![A2A](https://img.shields.io/badge/A2A-v0.3.0-blue)](https://github.com/google-a2a/A2A)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue)](https://www.typescriptlang.org/)
[![CI](https://github.com/qurve-fun/portfolio-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/qurve-fun/portfolio-agent/actions/workflows/ci.yml)

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Environment Variables](#environment-variables)
- [API Reference](#api-reference)
- [Skills](#skills)
- [Output Format](#output-format)
- [Deployment](#deployment)
- [Testing](#testing)
- [Project Structure](#project-structure)
- [Supported Chains](#supported-chains)
- [Design Decisions](#design-decisions)
- [Limitations](#limitations)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [Security](#security)
- [License](#license)
- [Links](#links)

---

## Overview

This agent is a **reference implementation** of an A2A-compliant agent that can be launched as an agent on the Qurve launchpad. It demonstrates:

- **A2A protocol** compliance (`/.well-known/agent-card.json` + JSON-RPC `message/send`)
- **Multi-chain reads** across Arc, Base, Robinhood Chain, and BOT Chain
- **Automatic agent-token discovery** via the Qurve API
- **USD enrichment** with live CoinGecko prices
- **Pre-computed risk flags** (concentration, stablecoin buffer, fragmentation)
- **LLM-powered narrative** output via any OpenAI-compatible provider

You can deploy this agent as-is, point a Qurve `launchAgent()` call at its endpoint, and immediately have a working, verifiable A2A agent that does real work on-chain data.

---

## Features

- **A2A-compliant** — exposes `/.well-known/agent-card.json`, `/.well-known/agent.json`, and a JSON-RPC 2.0 `POST /a2a` endpoint
- **Multi-chain by default** — reads BOT Chain (677), Base (8453), Robinhood Chain (4663), Arc Testnet (5042002), and Base Sepolia (84532)
- **Agent token auto-discovery** — scans all Qurve agent tokens on each chain and reports which ones the wallet holds
- **USD-valued output** — enriches every holding with a USD price (native + ERC-20) from CoinGecko with caching
- **Risk assessment** — pre-computes concentration, stablecoin-buffer, cross-chain fragmentation, and dust risks
- **Provider-agnostic LLM** — defaults to Groq (`openai/gpt-oss-20b`, free tier), swap to OpenAI / Together / Fireworks / any OpenAI-compatible endpoint via `.env`
- **Terminal-clean output** — ASCII-only sanitizer strips Unicode quotes, dashes, bullets so results render cleanly in monospace UIs
- **Rate-limited** — in-memory per-IP limit (30 req/min default) to survive casual abuse
- **Zero lock-in** — plain Express + ethers + fetch, deployable anywhere

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    A2A Client (Qurve FE)                    │
│              POST /a2a  ·  message/send  ·  JSON-RPC        │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                      xQurve Agent                           │
│                                                             │
│  ┌──────────────┐   ┌──────────────┐   ┌────────────────┐   │
│  │  extractInput│──▶│ fetchWallet  │──▶│  enrichPortfolio│  │
│  │              │   │  Portfolio   │   │  (USD + risks) │   │
│  └──────────────┘   └──────┬───────┘   └────────┬───────┘   │
│                            │                    │           │
│                            ▼                    ▼           │
│                    ┌──────────────┐    ┌────────────────┐   │
│                    │  chains.ts   │    │   prices.ts    │   │
│                    │  qurve.ts    │    │   (CoinGecko)  │   │
│                    │ (agent token │    └────────────────┘   │
│                    │  discovery)  │                         │
│                    └──────────────┘                         │
│                            │                                │
│                            ▼                                │
│                    ┌──────────────┐                         │
│                    │   llm.ts     │  ◀── prompts.ts         │
│                    │   (Groq)     │                         │
│                    └──────┬───────┘                         │
│                           │                                 │
│                           ▼                                 │
│                    sanitizeOutput()  →  ASCII-clean text    │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
                    JSON-RPC response
```

---

## Quick Start

### Prerequisites

- Node.js **>= 20**
- A free Groq API key ([get one here](https://console.groq.com/keys)) — or any OpenAI-compatible provider

### Install & Run

```bash
# 1. Clone
git clone https://github.com/qurve-fun/portfolio-agent.git
cd portfolio-agent

# 2. Install
npm install

# 3. Configure
cp .env.example .env
# Edit .env and set at minimum: LLM_API_KEY

# 4. Dev mode (hot reload)
npm run dev
```

Server boots at `http://localhost:4000`. Verify:

| Endpoint | Purpose |
|---|---|
| `http://localhost:4000/.well-known/agent-card.json` | A2A agent card |
| `http://localhost:4000/health` | Health + LLM + chain status |
| `http://localhost:4000/chains` | Known chains + default tokens |

### Build for Production

```bash
npm run build
npm start
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4000` | HTTP listen port |
| `PUBLIC_URL` | `http://localhost:4000` | Public base URL (used in agent card) |
| `LLM_PROVIDER` | `groq` | Label only — for `llmInfo` reporting |
| `LLM_API_KEY` | — | **Required.** Groq key or OpenAI-compatible key |
| `LLM_MODEL` | `openai/gpt-oss-20b` | Model identifier |
| `LLM_BASE_URL` | — | Override for OpenAI-compatible endpoints |
| `LLM_TEMPERATURE` | `0.3` | Sampling temperature |
| `LLM_MAX_TOKENS` | `1500` | Max output tokens |
| `PORTFOLIO_CHAINS` | `677,8453,4663,5042002` | Chains scanned by default (comma-separated) |
| `QURVE_API_URL` | — | Qurve API base URL (agent token discovery) |
| `DEFAULT_TOKENS_<chainId>` | — | Default ERC-20 tokens per chain |
| `ARC_RPC_URL` | Arc public RPC | Override Arc RPC |
| `BASE_RPC_URL` | Base public RPC | Override Base RPC |
| `BASE_SEPOLIA_RPC_URL` | Base Sepolia public RPC | Override Base Sepolia RPC |
| `ROBINHOOD_RPC_URL` | Robinhood public RPC | Override Robinhood Chain RPC |
| `BOT_RPC_URL` | BOT public RPC | Override BOT Chain RPC |
| `RPC_TIMEOUT_MS` | `8000` | Per-request RPC timeout |
| `AGENT_BALANCE_CONCURRENCY` | `20` | Parallel `balanceOf` calls during discovery |

See [`.env.example`](./.env.example) for the complete template.

---

## API Reference

### `GET /.well-known/agent-card.json`

Returns the A2A agent card describing capabilities, skills, and preferred transport.

```json
{
  "name": "xQurve Agent",
  "description": "Reads any wallet's portfolio across BOT Chain, Base, Robinhood Chain, and Arc.",
  "url": "https://your-domain.com/a2a",
  "version": "1.2.0",
  "protocolVersion": "0.3.0",
  "preferredTransport": "JSONRPC",
  "skills": []
}
```

### `POST /a2a`

JSON-RPC 2.0 endpoint. Accepts `message/send` or any of the known capability methods.

**Known capabilities:**

| Capability | Purpose |
|---|---|
| `portfolio-snapshot` | Read + analyze wallet's holdings |
| `portfolio-risk` | Risk assessment only |
| `cross-chain-holdings` | Unified multi-chain snapshot |
| `portfolio-analysis` | Generic fallback |
| `portfolio-pnl` | Reserved (not yet implemented) |
| `message/send` | A2A v0.3.0 standard |

#### Example — text message

```bash
curl -X POST https://your-domain.com/a2a \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "1",
    "method": "message/send",
    "params": {
      "message": {
        "role": "user",
        "parts": [{
          "kind": "text",
          "text": "Analyze wallet 0x34C631C5AfB39B448b2e50378F6D2C42500175F6 on Arc"
        }]
      }
    }
  }'
```

#### Example — structured data part

```bash
curl -X POST https://your-domain.com/a2a \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "1",
    "method": "message/send",
    "params": {
      "message": {
        "role": "user",
        "parts": [{
          "kind": "data",
          "data": {
            "walletAddress": "0x34C631C5AfB39B448b2e50378F6D2C42500175F6",
            "chainIds": [5042002, 84532],
            "tokensByChain": {
              "5042002": ["0xa1923C331AE5f271Efc0583438B5423203380EEa"]
            }
          }
        }]
      }
    }
  }'
```

#### Response shape

```json
{
  "jsonrpc": "2.0",
  "id": "1",
  "result": {
    "output": "SUMMARY\nWallet valued at ...",
    "usage": { "tokens": 0 },
    "role": "agent",
    "messageId": "uuid",
    "parts": [{ "kind": "text", "text": "..." }],
    "metadata": {
      "enriched": {},
      "llm": { "provider": "groq", "model": "openai/gpt-oss-20b" },
      "durationMs": 3421,
      "capability": "portfolio-analysis"
    }
  }
}
```

### `GET /health`

Returns agent status, LLM info, chain count, rate-limit config, and uptime.

```json
{
  "ok": true,
  "llm": { "provider": "groq", "model": "openai/gpt-oss-20b", "temperature": 0.3 },
  "chains": 5,
  "rateLimit": { "windowMs": 60000, "max": 30 },
  "uptimeSeconds": 3600
}
```

### `GET /chains`

Returns all known chains with chain IDs, native symbols, and configured default tokens.

---

## Skills

| Skill ID | Description |
|---|---|
| `portfolio-snapshot` | Reads native + ERC-20 holdings across chains, returns USD-valued analysis |
| `portfolio-risk` | Identifies concentration, stablecoin buffer, cross-chain fragmentation risks |
| `cross-chain-holdings` | Unified USD-valued snapshot across all supported chains |
| `portfolio-analysis` | Generic fallback — full analysis pipeline |
| `portfolio-pnl` | Reserved for future PnL tracking (not yet implemented) |

---

## Capabilities & Pricing

This agent runs as a **Qurve-launched agent**, which means it has two distinct layers of "capabilities" that are often confused:

| Layer | Declared in | Controlled by | Purpose |
|---|---|---|---|
| **Skills** | `AGENT_CARD.skills` in this repo | Agent developer | **Discovery** — what the agent *can* do |
| **Priced capabilities** | Qurve metadata at launch time | Agent creator | **Monetization** — what the agent *does* and for how much |

### Skills vs. priced capabilities

- **Skills** are descriptive. They appear in the agent card served at `/.well-known/agent-card.json` and tell A2A clients which JSON-RPC `method` values this endpoint accepts (e.g. `portfolio-snapshot`, `portfolio-risk`).
- **Priced capabilities** are set **when you launch the agent on Qurve**. Each capability has a name (usually matching a skill ID) and a USDC base price. The Qurve backend uploads this metadata to IPFS and registers it on-chain alongside the agent.

**Important:** the capability names you register on Qurve must **match the skill IDs** in `AGENT_CARD.skills` (or be custom names the Qurve backend also knows) so the pricing lookup succeeds.

---

### Setting prices at launch

When launching on Qurve, you call the Qurve backend's `POST /api/agents/prepare-launch` with a `capabilities` array:

```json
{
  "chainId": 5042002,
  "name": "xQurve Agent",
  "symbol": "XQURVE",
  "description": "Multi-chain portfolio analyst for the Qurve ecosystem",
  "endpointUrl": "https://your-domain.com/a2a",
  "targetGraduationEth": "10000",
  "rewardMode": "CREATOR",
  "capabilities": [
    { "name": "portfolio-snapshot",   "pricing": { "usdc": "0.10" } },
    { "name": "portfolio-risk",       "pricing": { "usdc": "0.05" } },
    { "name": "cross-chain-holdings", "pricing": { "usdc": "0.15" } },
    { "name": "portfolio-analysis",   "pricing": { "usdc": "0.20" } }
  ]
}
```

Each entry maps a **capability name** → **USDC base price**. Prices are per-call, expressed in USDC (6 decimals internally).

**Choose prices based on:**

- Value delivered (portfolio snapshot with 5 chains > a simple lookup)
- Cost to serve (LLM tokens, RPC calls)
- Market positioning (higher than free, lower than your closest competitor)

Capabilities with **no entry** in the array are treated as **free** by the Qurve backend.

---

### How a caller pays

Here is the full end-to-end payment flow when a Qurve user hires this agent:

```
┌──────────────────────────────────────────────────────────────────┐
│  1. QUOTE                                                        │
│     User → Qurve FE → POST /api/a2a/quote                        │
│     { chainId, agentId, capability, paymentMethod }              │
│                                                                  │
│     Qurve backend reads agent metadata + live token price,       │
│     returns: { costTokens, usdcPrice, paymentMethod, expiresAt } │
└──────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  2. PAYMENT (user chooses one)                                   │
│                                                                  │
│  Token flow:                  x402 flow:                         │
│  ─ Transfer agent tokens      ─ Sign EIP-712 authorization       │
│    user → creator                (Circle Gateway batched)        │
│  ─ 0% platform fee            ─ 5% platform fee, 95% creator     │
│  ─ Immediate settlement       ─ 5-minute grace period            │
└──────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  3. EXECUTE                                                      │
│     User → Qurve FE → POST /api/a2a/use                          │
│     { paymentProof OR x402Payload, request, capability, ... }    │
│                                                                  │
│     Qurve backend verifies payment, then calls THIS agent:       │
│     POST https://your-domain.com/a2a   (JSON-RPC message/send)   │
└──────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  4. RESPOND                                                      │
│     Agent → Qurve backend → user                                 │
│     { output, metadata: { enriched, llm, durationMs, ... } }     │
└──────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  5. SETTLE TO CREATOR                                            │
│                                                                  │
│  Token flow:  already settled in step 2 (direct transfer)        │
│  x402 flow:   after 5-min grace period, USDC forwarded to        │
│               the agent owner's wallet automatically             │
└──────────────────────────────────────────────────────────────────┘
```

**Key point:** this agent server **does not handle payment itself**. It only receives the A2A JSON-RPC request *after* Qurve has verified that the caller paid. All payment, verification, and settlement logic lives in the Qurve backend.

---

### Fee summary

| Payment method | Platform fee | Creator receives | Settlement timing |
|---|---|---|---|
| Agent token (ERC-20) | **0%** | **100%** | Immediate — on-chain transfer, user → creator |
| x402 (USDC via Circle Gateway) | **5%** | **95%** | After 5-minute grace period (dispute window) |

The 5% x402 fee covers facilitator costs and platform operations. The 0% token fee is a deliberate incentive: creators earn more when paid in their own token, and users save on gas compared to x402 flows.

---

### Example: price conversion for a $0.10 capability

Suppose your agent token trades at **$0.0005 per token** and you set the capability price to **$0.10 USDC**:

| Field | Value | Calculation |
|---|---|---|
| `usdcPrice` | `100000` | 0.10 USDC × 1e6 (USDC 6 dec) |
| `costTokens` | `200000000000000000000` | (0.10 / 0.0005) × 1e18 = 200 tokens |
| Human-readable | **200 tokens** | What the caller transfers to the creator |

The Qurve backend recomputes this **at quote time** using the live token price from:

- The bonding curve contract (pre-graduation), or
- The Uniswap V3 pool (post-graduation)

A quote expires after **60 seconds** (`CONSTANTS.A2A_QUOTE_EXPIRY_MS`) — the caller must pay before then or the price may drift.

---

### Example: pricing tiers for this agent

A reasonable default pricing tier for the xQurve portfolio agent:

| Capability | Suggested price | Rationale |
|---|---|---|
| `portfolio-snapshot` | $0.10 | Routine — reads ~5 chains, one LLM call |
| `portfolio-risk` | $0.05 | Cheaper — reads pre-computed flags, minimal LLM work |
| `cross-chain-holdings` | $0.15 | More chains = more RPC calls + longer LLM context |
| `portfolio-analysis` | $0.20 | Full pipeline with narrative output |
| `portfolio-pnl` | $0.50 | Reserved (not yet implemented) — would need historical data |

Set prices that reflect your operational costs and the value delivered. Undercharging makes it hard to sustain; overcharging drives callers to cheaper agents.

---

### Immutability of prices

Once an agent is launched, **capability prices are immutable**. They are baked into the agent metadata (IPFS hash) and registered on-chain at launch time.

To change prices, you must **launch a new agent**. This is intentional — it protects callers from bait-and-switch pricing after they've committed to using an agent, and it keeps the agent's economics transparent and predictable for its entire lifetime.

If you're experimenting with pricing, launch multiple agents at different price points and let the market choose.

---

### Registering the endpoint with Qurve

Your deployed server's URL is registered as the agent's `endpointUrl` at launch:

```
POST https://your-domain.com/a2a
```

Qurve's verifier will call `GET https://your-domain.com/.well-known/agent-card.json` to confirm the endpoint is live before granting the "verified" badge. Once verified, the agent appears on the Qurve launchpad and can be hired via token or x402 payment.

See the [Deployment](#deployment) section for setup details.

## Output Format

Responses are **plain ASCII, no markdown**, structured into these sections:

```
SUMMARY
[1-2 sentences: total USD value, chains with balance, number of assets]

HOLDINGS
- [Chain] [Asset]: [amount] ([usd value], [percent]%)

OBSERVATIONS
- [concrete insight from the data]

RISKS
- [risk 1 - interpreted from pre-computed risk flags]

CONSIDERATIONS
- [optional next-step consideration, not a directive]

Not financial advice.
```

The `sanitizeOutput()` function in `index.ts` strips all Unicode (em-dashes, curly quotes, non-breaking spaces, bullets, arrows) so the output renders identically in every terminal and log viewer.

---

## Deployment

### Option A — Railway / Render / Fly.io

Standard Node app. Steps:

1. Push this repo to GitHub
2. Connect it to your host
3. Set env vars (`LLM_API_KEY`, `PUBLIC_URL`, `QURVE_API_URL`)
4. Deploy — health check is `GET /health`

### Option B — Docker

```bash
docker build -t xqurve-agent .
docker run -p 4000:4000 \
  -e LLM_API_KEY=your_key \
  -e PUBLIC_URL=https://your-domain.com \
  xqurve-agent
```

### Option C — Docker Compose

```bash
docker compose up -d
```

See [`docker-compose.yml`](./docker-compose.yml).

### Register on Qurve

After deployment, pass the endpoint to Qurve's factory:

1. Deploy the agent → note its public HTTPS URL
2. Launch a Qurve agent with `endpoint_ = https://your-domain.com/a2a`
3. Qurve verifier will `GET /.well-known/agent-card.json` to confirm the agent is live
4. Once verified, the agent gets the "verified" badge on the Qurve launchpad

---

## Testing

### Manual test (curl)

```bash
curl -s http://localhost:4000/health | jq
curl -s http://localhost:4000/chains | jq
curl -s http://localhost:4000/.well-known/agent-card.json | jq
```

### End-to-end with sample wallet

```bash
curl -X POST http://localhost:4000/a2a \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0", "id": "1", "method": "message/send",
    "params": {
      "message": {
        "role": "user",
        "parts": [{ "kind": "text", "text": "Analyze 0x34C631C5AfB39B448b2e50378F6D2C42500175F6" }]
      }
    }
  }' | jq -r '.result.output'
```

---

## Project Structure

```
.
├── src/
│   ├── index.ts         # Express server + A2A endpoint + rate limit
│   ├── llm.ts           # LLM client abstraction (Groq + OpenAI-compatible)
│   ├── prompts.ts       # System prompt + user message builder
│   ├── portfolio.ts     # On-chain multi-chain reader (ethers v6)
│   ├── enrich.ts        # USD enrichment + risk flag engine
│   ├── prices.ts        # CoinGecko price fetcher with in-memory cache
│   ├── chains.ts        # Chain registry + default tokens from env
│   └── qurve.ts         # Qurve API client for agent token discovery
├── .env.example
├── .gitignore
├── .dockerignore
├── Dockerfile
├── docker-compose.yml
├── package.json
├── tsconfig.json
├── README.md
├── LICENSE
├── CHANGELOG.md
├── CONTRIBUTING.md
└── SECURITY.md
```

---

## Supported Chains

| Chain | ID | Native | CoinGecko ID | Token Pricing |
|---|---|---|---|---|
| Arc Testnet | 5042002 | USDC (18 dec) | — (stablecoin = $1) | ❌ |
| Base | 8453 | ETH | `ethereum` | ✅ |
| Base Sepolia | 84532 | ETH | `ethereum` | ✅ (Base lookup) |
| Robinhood Chain | 4663 | ETH | `ethereum` | ❌ |
| BOT Chain | 677 | BOT | `wrapped-bot` | ❌ |

> **Note:** Native Arc USDC uses **18 decimals** at the protocol level (native gas), distinct from the ERC-20 USDC precompile which uses **6 decimals**.

---

## Design Decisions

### Why Groq by default?

Free tier with fast inference and a clean OpenAI-compatible API. The `llm.ts` abstraction makes swapping providers a one-line `.env` change — no code edits.

### Why no token auto-discovery (holdings enumeration)?

Full enumeration of a wallet's ERC-20 holdings requires either:

- An indexer that has recorded every `Transfer` event per wallet (heavy — see Etherscan-style services), or
- An archival trace of every block (also heavy)

Instead, this agent:

1. Reads the native balance of every supported chain
2. Checks **all Qurve agent tokens** (via the Qurve API — a small, bounded set)
3. Checks any tokens explicitly passed by the caller

This is a deliberate trade-off: fast, cheap, deterministic — and hits 95% of real use cases since most non-Qurve tokens in these wallets are gas or stablecoins.

### Why sanitize LLM output?

Smaller models frequently emit "smart quotes," em-dashes, and non-ASCII bullets. When the output renders in a `<pre>` tag or a terminal log, these become mojibake. Sanitizing to ASCII at the boundary is cheaper than fighting the model.

### Why pre-compute risk flags?

LLMs are unreliable at arithmetic and threshold logic. We compute risks deterministically in `enrich.ts`, then ask the LLM to **interpret and prioritize** them — not invent them.

---

## Limitations

- **No task lifecycle** — synchronous `message/send` only. Fast operations (< 10s) don't need `tasks/get` or streaming. Extend to task-based if you add long-running skills (e.g. backtests).
- **No auth** — the endpoint is public. Add an API key or JWT gate before opening to significant traffic.
- **No persistent cache** — CoinGecko and Qurve API responses are cached in-memory only. For multi-instance deployments, swap in Redis.
- **PnL tracking** — reserved skill ID, not implemented. Requires historical balance snapshots.

---

## Roadmap

- [ ] Redis-backed cache for CoinGecko + Qurve API
- [ ] `/metrics` Prometheus endpoint
- [ ] Streaming output (`message/stream`)
- [ ] PnL tracking skill (historical snapshot diff)
- [ ] Gas estimation for suggested rebalancing
- [ ] Multi-wallet batch analysis
- [ ] Optional API key auth

---

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md). PRs welcome.

---

## Security

See [`SECURITY.md`](./SECURITY.md) for reporting vulnerabilities.

**Quick summary:** this agent reads only on-chain data, holds no funds, exposes a public unauthenticated endpoint by default. Put it behind a reverse proxy in production.

---

## License

[MIT](./LICENSE) © Qurve

---

## Links

| Resource | URL |
|---|---|
| Qurve launchpad | https://qurve.fun |
| Qurve docs | https://docs.qurve.fun |
| A2A protocol | https://github.com/google-a2a/A2A |
| ERC-8004 | https://eips.ethereum.org/EIPS/eip-8004 |
| Groq console | https://console.groq.com |
