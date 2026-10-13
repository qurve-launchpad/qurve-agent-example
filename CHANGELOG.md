# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Planned

- Redis-backed cache for CoinGecko + Qurve API responses
- `/metrics` Prometheus endpoint for observability
- Streaming output (`message/stream` — A2A Task-based transport)
- PnL tracking skill (`portfolio-pnl` — historical snapshot diff)
- Gas estimation for suggested rebalancing
- Multi-wallet batch analysis
- Optional API key auth for the `/a2a` endpoint

---

## [1.2.0] — 2026-02-14

### Added

- **Agent token auto-discovery** via the Qurve API (`src/qurve.ts`)
  - Scans all Qurve agent tokens on each chain per request
  - Detects which ones the wallet holds — reports balance, symbol, and agent ID
  - 10-minute cache to reduce Qurve API load
  - Paginated fetch with `MAX_AGENTS_PER_CHAIN` cap (500)

- **Multi-chain support**
  - Arc Testnet (5042002) — USDC native
  - Base (8453) — ETH native
  - Base Sepolia (84532) — ETH native
  - Robinhood Chain (4663) — ETH native
  - BOT Chain (677) — BOT native
  - Configurable via `PORTFOLIO_CHAINS` env var

- **Per-chain default tokens** loaded from env
  - `DEFAULT_TOKENS_<chainId>=0xaddr1,0xaddr2,...`
  - Checked automatically when the caller does not pass explicit tokens

- **New debug endpoint** — `GET /chains`
  - Lists known chains, native symbols, and configured default tokens

- **Rate limiting**
  - In-memory per-IP limit — 30 requests per 60 seconds by default
  - Map cleaned up every 5 minutes to avoid memory growth

- **ASCII sanitizer** for LLM output
  - Strips Unicode em-dashes, curly quotes, non-breaking spaces, bullets,
    arrows, math symbols
  - Ensures consistent rendering across terminals and log viewers

- **Pre-computed risk flags** in `src/enrich.ts`
  - High concentration (> 70% in one asset)
  - Moderate concentration (50-70%)
  - Missing stablecoin buffer (< 5% with total > $100)
  - Cross-chain fragmentation (> 3 chains with total < $1000)
  - Dust portfolio (total < $10)
  - Unpriced assets, chain read errors

- **Agent card skills**
  - `portfolio-snapshot`
  - `portfolio-risk`
  - `cross-chain-holdings`
  - `portfolio-analysis`
  - `portfolio-pnl` (reserved)

- **Deployment artifacts**
  - `Dockerfile` — multi-stage build, non-root user, health check
  - `docker-compose.yml` — env-driven, health check, restart policy
  - `.dockerignore` — excludes dev files from image
  - `.github/workflows/ci.yml` — Node 20 build + Docker dry-run

- **Documentation**
  - `README.md` — comprehensive, English, GitHub-friendly
  - `CONTRIBUTING.md` — dev setup, code style, PR checklist
  - `SECURITY.md` — disclosure policy, threat model, best practices
  - `CHANGELOG.md` — this file
  - `LICENSE` — MIT

- **Project config**
  - `tsconfig.json` — strict mode, ES2022, NodeNext resolution
  - `.env.example` — full template with all env vars documented

### Changed

- **Rebranded** from "Blaunch Portfolio Agent" to "**xQurve Agent**"
  - Package name: `blaunch-portfolio-agent` → `@qurve/portfolio-agent`
  - Agent card name: `xQurve Agent`
  - All references to "Blaunch" replaced with "Qurve"

- **Agent card version** bumped to `1.2.0`
- **Protocol version** declared as `0.3.0`
- **LLM default model** — `openai/gpt-oss-20b` (Groq free tier)
  - Chosen over `llama-3.3-70b-versatile` for stability and reasoning quality
  - Overridable via `LLM_MODEL` env var
- **Provider-agnostic LLM** — `llm.ts` now uses OpenAI-compatible surface
  - Swap provider by setting `LLM_BASE_URL`
  - Supported: OpenAI, Together, Fireworks, Groq, any OpenAI-compatible endpoint

### Removed

- **Hardcoded Arc-only logic** — now fully chain-agnostic
- **`tokenAddresses` flat array** support (legacy) — still parsed but
  documented as deprecated; use `tokensByChain` instead
- **Legacy env vars** from Blaunch era — no longer recognized

### Fixed

- **Provider cache no longer spams** "JsonRpcProvider failed to detect network"
  - Uses `staticNetwork` + `batchMaxCount: 1` in ethers v6
- **Empty completion handling** — `llm.ts` throws a clear error instead of
  returning `undefined`
- **Chain read errors no longer crash** the whole request — per-chain
  try/catch; errored chains surface in `risks` array
- **Unicode mojibake** — sanitizer ensures all output renders identically
  across Windows terminals, log aggregators, and web UIs

### Security

- No known vulnerabilities at time of release
- Public unauthenticated endpoint by design — see `SECURITY.md`
- Rate limiting added to reduce casual abuse

---

## [0.1.0] — 2026-01-08

### Added

- Initial MVP
- A2A `message/send` endpoint (`POST /a2a`)
- Agent card at `/.well-known/agent.json` and `/.well-known/agent-card.json`
- Arc Testnet portfolio reading (native USDC only)
- Groq LLM integration (`llama-3.3-70b-versatile`)
- System prompt with structured output format
- Basic health check — `GET /health`
- Manual curl test instructions in `README.md`

### Known Limitations at Release

- Arc-only (no multi-chain)
- No token auto-discovery — requires explicit `tokenAddresses` in request
- No rate limiting
- No Docker / CI
- Minimal README

---

## Versioning Policy

We follow [Semantic Versioning](https://semver.org/):

- **MAJOR** — breaking change to the A2A interface, response shape, or required env vars
- **MINOR** — new skill, new chain, new optional env var, non-breaking additions
- **PATCH** — bug fixes, dependency bumps, docs improvements

Pre-1.0 releases (`0.x.y`) may break compatibility between minor versions.

---

## How to Read This Changelog

Each release has up to five categories:

| Category | Meaning |
|---|---|
| **Added** | New features, skills, chains, endpoints |
| **Changed** | Changes to existing behavior |
| **Deprecated** | Features scheduled for removal |
| **Removed** | Features removed in this release |
| **Fixed** | Bug fixes |
| **Security** | Vulnerability fixes, hardening |

---

## Links

- [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
- [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [Qurve](https://qurve.fun)
