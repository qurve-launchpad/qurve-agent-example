# Agent Activation Guide

Step-by-step guide to get the xQurve Agent running — either locally for testing or deployed on Railway for production. Follow the path that matches your goal.

---

## Table of Contents

- [Before You Start](#before-you-start)
- [Path A — Run Locally (5 minutes)](#path-a--run-locally-5-minutes)
  - [Step 1: Clone the Repository](#step-1-clone-the-repository)
  - [Step 2: Get a Free Groq API Key](#step-2-get-a-free-groq-api-key)
  - [Step 3: Configure the Environment](#step-3-configure-the-environment)
  - [Step 4: Install and Run](#step-4-install-and-run)
  - [Step 5: Verify It Works](#step-5-verify-it-works)
- [Path B — Deploy to Railway (10 minutes)](#path-b--deploy-to-railway-10-minutes)
  - [Step 1: Push to Your GitHub](#step-1-push-to-your-github)
  - [Step 2: Create a Railway Account](#step-2-create-a-railway-account)
  - [Step 3: Deploy from GitHub](#step-3-deploy-from-github)
  - [Step 4: Set Environment Variables](#step-4-set-environment-variables)
  - [Step 5: Generate a Public URL](#step-5-generate-a-public-url)
  - [Step 6: Verify the Deployment](#step-6-verify-the-deployment)
- [Register the Agent on Qurve](#register-the-agent-on-qurve)
- [Configuration Reference](#configuration-reference)
- [Troubleshooting](#troubleshooting)
- [Next Steps](#next-steps)

---

## Before You Start

You need:

| Requirement | Why | Where |
|---|---|---|
| **Node.js >= 20** | Runtime | [nodejs.org](https://nodejs.org) |
| **Git** | Clone + push | [git-scm.com](https://git-scm.com) |
| **Groq API key** | LLM provider (free) | [console.groq.com/keys](https://console.groq.com/keys) |
| **GitHub account** | For Railway deployment | [github.com](https://github.com) |
| **Railway account** | For hosting (only Path B) | [railway.app](https://railway.app) |

Check your Node version:

```bash
node --version
# Should print v20.x.x or higher
```

If you're on an older version, install Node 20 via [nvm](https://github.com/nvm-sh/nvm):

```bash
nvm install 20
nvm use 20
```

---

## Path A — Run Locally (5 minutes)

Best for: testing, developing, or verifying the agent works before deploying.

### Step 1: Clone the Repository

```bash
git clone https://github.com/qurve-launchpad/qurve-agent-example.git
cd portfolio-agent
```

If you forked the repo, use your fork's URL instead.

### Step 2: Get a Free Groq API Key

Groq provides free LLM inference — no credit card required, and the free tier gives you 30 requests per minute (enough for development and light production use)[reference:0].

**Steps:**

1. Go to [console.groq.com/keys](https://console.groq.com/keys)
2. Sign up with your **Google** or **GitHub** account — no credit card needed[reference:1]
3. Once logged in, click **"Create API Key"**
4. Give it a name (e.g. `xqurve-agent-local`)
5. **Copy the key immediately** — it starts with `gsk_` and is only shown once
6. Paste it somewhere safe temporarily (you'll use it in the next step)

> **Security note:** Never commit this key to git. If you ever leak it, revoke it at the same page and generate a new one.

### Step 3: Configure the Environment

Copy the template:

```bash
cp .env.example .env
```

Open `.env` in your editor and set at minimum:

```bash
# Required — paste your Groq key from Step 2
LLM_API_KEY=gsk_your_actual_key_here

# Required — the Qurve backend your agent will talk to
QURVE_API_URL=https://qurve.online

# Fine for local dev
PUBLIC_URL=http://localhost:4000
PORT=4000
```

The rest of the defaults work out of the box. See [Configuration Reference](#configuration-reference) for every variable.

### Step 4: Install and Run

```bash
# Install dependencies
npm install

# Start in dev mode (hot reload on file changes)
npm run dev
```

You should see output like:

```
xQurve Agent v1.2.0 running at http://localhost:4000
   Agent Card (A2A)  : http://localhost:4000/.well-known/agent-card.json
   Agent Card (Qurve): http://localhost:4000/.well-known/agent.json
   A2A JSON-RPC      : http://localhost:4000/a2a
   Chains            : Arc Testnet, Base, Base Sepolia, Robinhood Chain, BOT Chain
   LLM               : groq (openai/gpt-oss-120b)
   Rate limit        : 30/60s per IP
```

### Step 5: Verify It Works

Open a **second terminal** and hit the health endpoint:

```bash
curl -s http://localhost:4000/health | jq
```

Expected response:

```json
{
  "ok": true,
  "llm": { "provider": "groq", "model": "openai/gpt-oss-120b", "temperature": 0.3 },
  "chains": 5,
  "rateLimit": { "windowMs": 60000, "max": 30 },
  "uptimeSeconds": 12
}
```

If `ok: true` — the agent is healthy.

Now test an actual portfolio read. Replace the wallet address with any address that has on-chain activity:

```bash
curl -X POST http://localhost:4000/a2a \
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
          "text": "Analyze wallet 0x34C631C5AfB39B448b2e50378F6D2C42500175F6"
        }]
      }
    }
  }' | jq -r '.result.output'
```

You should get a structured analysis like:

```
SUMMARY
Wallet valued at $12,450 across 3 chains with balance (BOT Chain, Base, Arc) - 3 main assets with 71% concentrated in BOT.

HOLDINGS
- BOT Chain BOT: 1,000 BOT ($8,800, 70.7%)
- Base ETH: 0.5 ETH ($1,500, 12.0%)
- Arc USDC: 1,000 USDC ($1,000, 8.0%)

OBSERVATIONS
- Heavy BOT allocation despite low activity on Base and Arc suggests an early BOT adopter who has not rebalanced.

RISKS
- High concentration: a -30% move in BOT would wipe roughly $2,640 in value.
- Thin stablecoin buffer (8%) limits ability to buy dips or cover gas across chains.

CONSIDERATIONS
- Consider whether the BOT thesis still justifies 70% allocation.

Not financial advice.
```

If you got a real analysis — **Path A is done.** You can now [register the agent on Qurve](#register-the-agent-on-qurve), or continue to Path B for deployment.

---

## Path B — Deploy to Railway (10 minutes)

Best for: production deployment. Railway auto-detects Node.js projects, installs dependencies, and starts the app automatically[reference:2].

### Step 1: Push to Your GitHub

If you cloned the original repo (not a fork), create your own GitHub repository first:

1. Go to [github.com/new](https://github.com/new)
2. Name it `portfolio-agent` (or any name you like)
3. **Do not** initialize with README or .gitignore (we already have them)
4. Click **"Create repository"**
5. Back in your terminal, point the remote to your new repo:

```bash
cd portfolio-agent
git remote set-url origin https://github.com/YOUR_USERNAME/portfolio-agent.git
git push -u origin main
```

**Critical check before pushing — make sure `.env` is NOT in the repo:**

```bash
git check-ignore -v .env
# Should output something like: .gitignore:XX:.env
# If nothing is output, .env is NOT ignored — fix .gitignore first
```

If you accidentally committed `.env`, remove it and rotate the key:

```bash
git rm --cached .env
git commit -m "chore: remove accidentally committed .env"
git push
# Then revoke the leaked key at console.groq.com/keys and create a new one
```

### Step 2: Create a Railway Account

Go to [railway.app](https://railway.app) and sign up with your GitHub account. Railway's free tier gives you $5 of credit per month — enough to run this agent continuously for testing[reference:3].

### Step 3: Deploy from GitHub

1. Go to the [Railway Dashboard](https://railway.com/dashboard)
2. Click **+ New** → **GitHub repo**[reference:4]
3. Authorize Railway to access your GitHub repositories
4. Select your `portfolio-agent` repo
5. Railway will auto-detect the Node.js project and start building

The first build takes about 2-3 minutes. Watch the **Deploy Logs** tab for progress. When done, you'll see your service running but **without a public URL yet** — that comes next.

### Step 4: Set Environment Variables

Railway does **not** read your `.env` file from the repo (that would defeat the purpose of gitignoring it). You must set every variable in the Railway dashboard[reference:5].

1. Click your service in the Railway project canvas
2. Go to the **Variables** tab
3. Click **+ New Variable** for each of these:

| Variable | Value | Required? |
|---|---|---|
| `LLM_API_KEY` | Your `gsk_...` key from Step 2 | ✅ **Yes** |
| `LLM_PROVIDER` | `groq` | ✅ Yes |
| `LLM_MODEL` | `openai/gpt-oss-120b` | ✅ Yes |
| `QURVE_API_URL` | `https://qurve.online` | ✅ Yes |
| `PUBLIC_URL` | *(leave empty — set in Step 5)* | ⏳ Later |
| `PORT` | *(leave empty — Railway injects this automatically)* | ❌ No |
| `LLM_TEMPERATURE` | `0.3` | Optional |
| `LLM_MAX_TOKENS` | `1500` | Optional |
| `PORTFOLIO_CHAINS` | `677,8453,4663,5042002` | Optional |

**Optional RPC overrides** (only if public RPCs are rate-limiting you):

| Variable | Value |
|---|---|
| `ARC_RPC_URL` | Your private Arc RPC |
| `BASE_RPC_URL` | Your private Base RPC |
| `BOT_RPC_URL` | Your private BOT RPC |

**Optional default tokens** (checked automatically when caller passes none):

| Variable | Value |
|---|---|
| `DEFAULT_TOKENS_5042002` | `0x3600000000000000000000000000000000000000` |
| `DEFAULT_TOKENS_84532` | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |

After adding variables, Railway will automatically redeploy.

> **Important:** Railway injects `PORT` into `process.env` automatically. Never set it manually unless you have a specific reason — the agent reads `process.env.PORT` and binds to it[reference:6].

### Step 5: Generate a Public URL

1. Click your service in the Railway canvas
2. Go to the **Settings** tab
3. Under **Networking**, click **Generate Domain**[reference:7]
4. Railway gives you a URL like `https://portfolio-agent-production-xxxx.up.railway.app`
5. **Copy this URL** — you need it for `PUBLIC_URL`

Now go back to the **Variables** tab and set:

```
PUBLIC_URL=https://your-generated-domain.up.railway.app
```

Railway redeploys one more time. When done, your agent is live.

### Step 6: Verify the Deployment

Test the public endpoint from your local terminal:

```bash
# Replace with your actual Railway URL
RAILWAY_URL=https://your-domain.up.railway.app

curl -s $RAILWAY_URL/health | jq
```

Expected: `"ok": true` and no errors.

Check the agent card — this is what Qurve's verifier will fetch:

```bash
curl -s $RAILWAY_URL/.well-known/agent-card.json | jq
```

Expected: JSON with `name`, `url`, `version`, `skills`, and `preferredTransport` fields. **Verify that `url` matches your Railway domain + `/a2a`.**

Run the same portfolio test you ran locally, but against the public URL:

```bash
curl -X POST $RAILWAY_URL/a2a \
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

If you got a real analysis — **Path B is done.** Your agent is live on the public internet.

---

## Register the Agent on Qurve

Now that your agent has a public HTTPS endpoint, register it on Qurve so it can be discovered and hired.

### 1. Launch a Qurve Agent with Your Endpoint

Use the Qurve launchpad's `launchAgent()` call (via the frontend or backend API), passing your agent's public URL as the `endpoint_` parameter:

```
endpoint_ = https://your-domain.up.railway.app/a2a
```

Note: it's `/a2a`, **not** `/.well-known/agent-card.json`. The agent card is fetched separately for verification — the endpoint is where JSON-RPC requests go.

### 2. Qurve Verifier Runs

Once launched, Qurve's verifier will:

1. `GET https://your-domain.up.railway.app/.well-known/agent-card.json`
2. Validate the response shape (must have `name`, `capabilities`, `skills`)
3. If valid → mark the agent as **verified**

### 3. Configure Capabilities and Pricing

During launch, you also specify the **priced capabilities** for your agent. These must match your `AGENT_CARD.skills` IDs:

```json
"capabilities": [
  { "name": "portfolio-snapshot",   "pricing": { "usdc": "0.10" } },
  { "name": "portfolio-risk",       "pricing": { "usdc": "0.05" } },
  { "name": "cross-chain-holdings", "pricing": { "usdc": "0.15" } },
  { "name": "portfolio-analysis",   "pricing": { "usdc": "0.20" } }
]
```

See the [Capabilities & Pricing](README.md#capabilities--pricing) section in the README for details on how pricing works.

### 4. Monitor Your Agent

Once live, watch:

- **Railway logs** — `railway logs` or the Railway dashboard
- **`GET /health`** — set up an uptime monitor (UptimeRobot, BetterStack)
- **Qurve dashboard** — track hires and earnings per capability

---

## Configuration Reference

Every environment variable the agent reads:

### Required

| Variable | Example | Notes |
|---|---|---|
| `LLM_API_KEY` | `gsk_abc123...` | Your Groq (or OpenAI-compatible) key |
| `LLM_PROVIDER` | `groq` | Label only — shown in logs |
| `LLM_MODEL` | `openai/gpt-oss-120b` | Model to use |
| `QURVE_API_URL` | `https://qurve.online` | Qurve backend for agent token discovery |
| `PUBLIC_URL` | `https://your-domain.com` | Used in the agent card |

### Optional — LLM tuning

| Variable | Default | Notes |
|---|---|---|
| `LLM_BASE_URL` | — | Set to swap to OpenAI, Together, Fireworks, etc. |
| `LLM_TEMPERATURE` | `0.3` | Lower = more deterministic |
| `LLM_MAX_TOKENS` | `1500` | Output length cap |

### Optional — chains

| Variable | Default | Notes |
|---|---|---|
| `PORTFOLIO_CHAINS` | `677,8453,4663,5042002` | Chains scanned by default |
| `ARC_RPC_URL` | public | Override Arc RPC |
| `BASE_RPC_URL` | public | Override Base RPC |
| `BASE_SEPOLIA_RPC_URL` | public | Override Base Sepolia RPC |
| `ROBINHOOD_RPC_URL` | public | Override Robinhood Chain RPC |
| `BOT_RPC_URL` | public | Override BOT Chain RPC |
| `RPC_TIMEOUT_MS` | `8000` | Per-request timeout |
| `AGENT_BALANCE_CONCURRENCY` | `20` | Parallel balance checks |

### Optional — default tokens

Format: `DEFAULT_TOKENS_<chainId>=0xaddr1,0xaddr2,...`

| Variable | Example |
|---|---|
| `DEFAULT_TOKENS_5042002` | `0x3600000000000000000000000000000000000000` |
| `DEFAULT_TOKENS_84532` | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |

---

## Troubleshooting

### `LLM_API_KEY (atau GROQ_API_KEY) belum di-set`

The agent can't find your LLM key. Check:

- `.env` exists in the project root (not inside `src/`)
- `LLM_API_KEY` is spelled correctly
- The value starts with `gsk_` (for Groq)

### `ok: false` on `/health`

Something is failing. Check the logs:

```bash
# Local
# Look at the terminal running npm run dev

# Railway
railway logs
# Or: Railway dashboard → Deploy Logs tab
```

Common causes:

- LLM API key is invalid or expired
- `QURVE_API_URL` is unreachable
- A required env var is missing

### `Railway build failed`

Check the **Deploy Logs** tab in Railway. Common causes:

- `package.json` scripts are wrong (`build` and `start` must exist)
- `tsconfig.json` is missing from the repo
- Node version in `package.json` engines doesn't match Railway's

Railway auto-detects Node.js from `package.json`. If you see "nixpacks couldn't detect" errors, add to `package.json`:

```json
"engines": { "node": ">=20" }
```

### `Rate limit exceeded` when testing

You hit the 30 req/min per-IP limit. Wait 60 seconds, or change the limit in `src/index.ts`:

```ts
const RATE_LIMIT_MAX = 30;  // increase this
```

### Agent returns "Please provide a wallet address"

The request didn't contain a valid wallet. The agent accepts:

- `params.userId`
- `params.wallet`
- `params.walletAddress`
- `params.address`
- Text in `params.request` containing a 42-character hex address

Any one of these works.

### Agent times out on wallets with many tokens

Large wallets with hundreds of Qurve agent tokens take longer. Reduce the cap:

```
AGENT_BALANCE_CONCURRENCY=10
```

Or reduce `MAX_AGENTS_PER_CHAIN` in `src/qurve.ts`.

### Railway shows "Application failed to respond"

Your app might be binding to the wrong port. **Never hardcode the port** — always read `process.env.PORT`, which Railway injects automatically. The current code does this correctly; if you modified it, revert.

---

## Next Steps

- **Customize the LLM prompt** — edit `src/prompts.ts` to change the analysis tone or add sections
- **Add a new chain** — see `CONTRIBUTING.md` → "Adding a New Chain"
- **Add a new skill** — see `CONTRIBUTING.md` → "Adding a New Skill"
- **Set up monitoring** — point UptimeRobot at `https://your-domain/health`
- **Watch your earnings** — Qurve dashboard shows hires and payouts per capability

---

## Getting Help

- **Issues** — [github.com/qurve-launchpad/qurve-agent-example/issues](https://github.com/qurve-launchpad/qurve-agent-example/issues)
- **Security** — security@qurve.fun (see `SECURITY.md`)
- **Qurve** — [qurve.fun](https://qurve.fun)
