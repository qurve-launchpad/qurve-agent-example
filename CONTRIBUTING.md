# Contributing to xQurve Agent

Thanks for your interest. This agent is a reference implementation for the
Qurve ecosystem — contributions that improve A2A compliance, chain coverage,
or output quality are very welcome.

---

## Table of Contents

- [Development Setup](#development-setup)
- [Code Style](#code-style)
- [Project Layout](#project-layout)
- [Pull Request Checklist](#pull-request-checklist)
- [Adding a New Chain](#adding-a-new-chain)
- [Adding a New Skill](#adding-a-new-skill)
- [Adding a New LLM Provider](#adding-a-new-llm-provider)
- [Reporting Bugs](#reporting-bugs)
- [Commit Messages](#commit-messages)
- [License](#license)

---

## Development Setup

```bash
# 1. Fork and clone
git clone https://github.com/qurve-launchpad/qurve-agent-example.git
cd qurve-agent-example

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env and set at minimum:
#   LLM_API_KEY=<your Groq key>    (https://console.groq.com/keys)
#   QURVE_API_URL=https://qurve.online

# 4. Start dev server (hot reload)
npm run dev
```

Server runs at `http://localhost:4000`.

### Verify the setup

```bash
curl -s http://localhost:4000/health | jq
curl -s http://localhost:4000/chains | jq
curl -s http://localhost:4000/.well-known/agent-card.json | jq
```

---

## Code Style

### General

- **TypeScript strict mode** is enabled — no `any` without a comment explaining why
- **Prefer pure functions** in `enrich.ts`, `prices.ts`, `chains.ts`, `qurve.ts`
- **Keep `index.ts` thin** — server glue, input parsing, orchestration only
- **All user-facing output must be ASCII-clean** (see `sanitizeOutput()` in `index.ts`)

### Naming

| Element | Convention | Example |
|---|---|---|
| Files | `kebab-case` or single-word | `portfolio.ts`, `enrich.ts` |
| Functions | `camelCase` | `fetchWalletPortfolio()` |
| Types / Interfaces | `PascalCase` | `EnrichedPortfolio` |
| Constants | `SCREAMING_SNAKE_CASE` | `RATE_LIMIT_MAX` |
| Env vars | `SCREAMING_SNAKE_CASE` | `LLM_API_KEY` |

### Formatting

- 2-space indentation
- Double quotes for strings
- Semicolons on
- Trailing commas in multi-line objects/arrays
- Line length soft-limit 100 chars

### Comments

- Explain **why**, not **what**
- Non-obvious constants get a one-line "why this value" comment
- Section dividers use `// === TITLE ===` (matching existing files)

### Error Handling

- Never swallow errors silently
- Wrap external calls (`fetch`, RPC, LLM) in `try/catch` with a fallback
- User-facing error text must be **friendly and ASCII-only** (e.g. use `-` not `—`)

---

## Project Layout

```
src/
├── index.ts       # Express server, A2A endpoint, rate limiter, sanitizer
├── llm.ts         # LLM client abstraction (OpenAI-compatible surface)
├── prompts.ts     # System prompt + user message builder (few-shot ready)
├── portfolio.ts   # On-chain multi-chain reader (ethers v6)
├── enrich.ts      # USD enrichment + risk flag engine
├── prices.ts      # CoinGecko price fetcher with in-memory cache
├── chains.ts      # Chain registry + default tokens from env
└── qurve.ts       # Qurve API client for agent token discovery
```

**Responsibility boundaries:**

- `chains.ts` — knows **which** chains and **which** default tokens; knows **nothing** about pricing
- `prices.ts` — knows **how** to price; knows **nothing** about chains' business logic
- `portfolio.ts` — knows **how** to read on-chain; does not compute USD
- `enrich.ts` — combines raw + prices -> USD-valued + risks; pure, deterministic
- `prompts.ts` — text only; never contains data-fetching logic
- `llm.ts` — LLM client only; no prompt construction
- `index.ts` — HTTP glue; delegates everything else

---

## Pull Request Checklist

Before opening a PR, make sure:

- [ ] `npm run build` passes with no errors
- [ ] No new `any` types without an explaining comment
- [ ] No hardcoded RPC URLs, API keys, or chain data outside `chains.ts`
- [ ] If adding a chain -> updated `chains.ts` **and** `prices.ts` CoinGecko map
- [ ] If adding a skill -> updated `AGENT_CARD.skills` **and** `KNOWN_CAPABILITIES` in `index.ts`
- [ ] If changing output format -> updated `README.md` "Output Format" section
- [ ] If adding an env var -> updated `.env.example` **and** `README.md` env table
- [ ] Tested manually with at least one real wallet address
- [ ] No new `console.log` calls in the happy path (use structured JSON logs like existing `a2a_success` / `a2a_error`)

---

## Adding a New Chain

1. **Register the chain** in `src/chains.ts`:

   ```ts
   CHAINS[<chainId>] = {
     chainId: <chainId>,
     name: "Chain Name",
     rpcUrl: process.env.<CHAIN>_RPC_URL || "https://default-rpc.example",
     nativeSymbol: "ETH",       // or USDC, BOT, etc.
     nativeDecimals: 18,        // almost always 18
   };
   ```

2. **Add CoinGecko platform slug** in `src/prices.ts` (only if ERC-20 token pricing is supported):

   ```ts
   const COINGECKO_PLATFORM: Record<number, string> = {
     // ...
     <chainId>: "chain-slug",
   };
   ```

3. **Add CoinGecko native ID** in `src/prices.ts` (only if native price is supported):

   ```ts
   const COINGECKO_NATIVE_ID: Record<string, string> = {
     // ...
     MYNATIVE: "my-native-coingecko-id",
   };
   ```

4. **Update `.env.example`** — add `<CHAIN>_RPC_URL` override.

5. **Update `README.md`** "Supported Chains" table.

6. **Test** with a wallet holding:
   - Native balance > 0 on that chain
   - At least one ERC-20 (if pricing is supported)

7. **PR** with the sample request + response in the description.

---

## Adding a New Skill

Skills are exposed to A2A clients via two places that must stay in sync:

1. **`AGENT_CARD.skills`** in `src/index.ts` — human-readable description
2. **`KNOWN_CAPABILITIES`** in `src/index.ts` — accepted JSON-RPC `method` values

To add a skill:

1. Add entry to `AGENT_CARD.skills`:

   ```ts
   {
     id: "my-skill",
     name: "My Skill",
     description: "What it does in one sentence.",
     tags: ["defi", "your-tag"],
     examples: [
       "Example user prompt 1",
       "Example user prompt 2",
     ],
   }
   ```

2. Add `"my-skill"` to `KNOWN_CAPABILITIES` set.

3. If the skill has different input shape — extend `extractInput()`.

4. If the skill needs different pipeline logic — branch inside `POST /a2a` handler.

5. If the skill needs a different LLM prompt — extend `prompts.ts` or add a new export.

6. **Test** with a curl request using the new `method` value.

---

## Adding a New LLM Provider

Because `llm.ts` uses the **OpenAI-compatible chat completion** surface, most providers can be swapped with **zero code changes** — just set `LLM_BASE_URL` in `.env`:

```bash
LLM_PROVIDER=openai
LLM_API_KEY=sk-...
LLM_MODEL=gpt-4o-mini
LLM_BASE_URL=https://api.openai.com/v1
```

Compatible providers include:

- OpenAI (`https://api.openai.com/v1`)
- Together (`https://api.together.xyz/v1`)
- Fireworks (`https://api.fireworks.ai/inference/v1`)
- Groq (`https://api.groq.com/openai/v1` — default when unset)
- Any self-hosted vLLM / Ollama with OpenAI shim

If your provider is **not** OpenAI-compatible (e.g. Anthropic native API, Gemini native), extend `llm.ts` with a provider branch:

```ts
if (LLM_PROVIDER === "anthropic") {
  // use @anthropic-ai/sdk
}
```

Then:

1. Add the SDK to `package.json`
2. Add a `CHANGELOG.md` entry under `### Added`
3. Update `README.md` env table with provider-specific vars
4. PR with a working test request

---

## Reporting Bugs

Open a GitHub issue with:

1. **`GET /health`** output (JSON)
2. **The exact A2A request body** — redact real wallet addresses if needed
3. **The full JSON-RPC response** — including `error` field if present
4. **Node version and OS**
5. **Steps to reproduce** — minimal if possible

For **security vulnerabilities**, do **not** open a public issue — see [`SECURITY.md`](./SECURITY.md).

---

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

Common types:

| Type | When to use |
|---|---|
| `feat` | New feature or skill |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `test` | Adding or updating tests |
| `chore` | Build scripts, deps, config |
| `perf` | Performance improvement |

Examples:

```
feat(chains): add Polygon support with native MATIC pricing

fix(prices): handle CoinGecko 429 with exponential backoff

docs(readme): document QURVE_API_URL behavior
```

---

## License

By contributing, you agree your contributions are licensed under the
[MIT License](./LICENSE.md).
