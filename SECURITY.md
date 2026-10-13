# Security Policy

We take security seriously — this agent is a reference implementation for the
Qurve ecosystem and may be deployed by third parties. This document explains
how to report vulnerabilities and what protections exist by design.

---

## Table of Contents

- [Supported Versions](#supported-versions)
- [Reporting a Vulnerability](#reporting-a-vulnerability)
- [What We Commit To](#what-we-commit-to)
- [Scope](#scope)
- [Design Notes on Security](#design-notes-on-security)
- [Best Practices for Deployers](#best-practices-for-deployers)
- [Known Non-Issues](#known-non-issues)
- [Credit](#credit)

---

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.2.x   | ✅        |
| 1.1.x   | ❌        |
| 1.0.x   | ❌        |
| < 1.0   | ❌        |

We support the latest minor release and one minor back. Only the latest
release on `main` receives security patches.

---

## Reporting a Vulnerability

**Do not open a public GitHub issue for security issues.**

Email **security@qurve.fun** with the following information:

- **Description** — what the issue is and why it matters
- **Impact** — what an attacker could achieve
- **Reproduction** — exact steps, including any request bodies
- **Proof of concept** — code, screenshots, or a minimal repo (if applicable)
- **Suggested fix** — if you have one (optional but very helpful)
- **Your contact** — so we can credit you and coordinate disclosure

### Optional: PGP encryption

If you prefer encrypted email, request our PGP key first via the same address
with the subject `PGP KEY REQUEST`. We will respond with the public key.

### Please do NOT

- Open a public GitHub issue
- Post on social media / Discord / Telegram
- Exploit the vulnerability beyond the minimum needed to demonstrate it
- Access, modify, or delete data that is not yours
- Attempt denial-of-service against production infrastructure

---

## What We Commit To

- **Acknowledgement** within **72 hours** of your report
- **Status update** within **7 days** — triaged, in progress, or will-not-fix
- **Fix or mitigation plan** communicated within **14 days** for valid reports
- **Public disclosure** coordinated with you, after a fix has shipped
- **Credit** in the `CHANGELOG.md` release notes (unless you prefer to stay anonymous)

If we cannot reproduce the issue or disagree on its severity, we will explain
our reasoning clearly and let you respond.

---

## Scope

### In scope

- Server code in `src/` — routing, input parsing, sanitization, rate limiting
- Docker configuration (`Dockerfile`, `docker-compose.yml`)
- Dependency vulnerabilities with a clear, exploitable path from this code
- Logic flaws in risk assessment, USD calculation, or output sanitization
- Information disclosure via `/health`, `/chains`, or the A2A endpoint

### Out of scope

- Third-party RPC providers (Arc, Base, BOT Chain, Robinhood)
- CoinGecko API availability, correctness, or rate limiting
- Groq / OpenAI / any LLM provider — report to the respective provider
- Qurve's backend API — report separately to Qurve security team
- Denial-of-service via volume (see [Known Non-Issues](#known-non-issues))
- Issues requiring a compromised deployer machine or leaked `.env`
- Social engineering against Qurve team members

---

## Design Notes on Security

The agent is intentionally built with a **minimal attack surface**:

### What this agent does

- **Reads on-chain state** only — never writes, never signs transactions
- **Calls external HTTP APIs** (CoinGecko, Qurve backend) — no privileged credentials
- **Calls an LLM** with data derived from on-chain reads — no user secrets are sent
- **Serves a public JSON-RPC endpoint** — no authentication by design (reference implementation)

### What this agent does NOT do

- Holds **no private keys**, no wallet, no signing capability
- Holds **no funds** of any kind
- Stores **no user data** — everything is stateless per request (except in-memory cache)
- Persists **no logs** to disk — logs go to stdout only
- Manages **no database**
- Trusts **no user input** without validation

### Trust boundaries

| Boundary | Trust level | Mitigation |
|---|---|---|
| A2A request body | **Untrusted** | Validated: address format, chain ID whitelist, token address regex |
| RPC responses | **Semi-trusted** | Timeout, non-crashing error handling, no code execution |
| CoinGecko response | **Semi-trusted** | Validated type (`number`), bounded, cached |
| Qurve API response | **Semi-trusted** | Filtered: only valid addresses accepted |
| LLM output | **Untrusted** | Sanitized to ASCII, rendered as text only, never executed |
| Env vars | **Trusted** | Set by deployer; validated on startup where feasible |

### Data flow

```
User request
  → extractInput()    (validate wallet, chains, tokens)
  → fetchWalletPortfolio()  (RPC reads only)
  → enrichPortfolio() (pure computation, no side effects)
  → chat()            (LLM call, data-only input)
  → sanitizeOutput()  (ASCII-only, bounded length)
  → JSON response
```

Nothing from the request touches the filesystem, spawns a process, or issues
a write RPC.

---

## Best Practices for Deployers

If you deploy this agent, please follow these guidelines:

### 1. Never commit `.env`

Add to `.gitignore` (already included). If you've committed one by mistake:

```bash
git rm --cached .env
git commit -m "chore: remove accidentally committed .env"
```

Then rotate every key in it.

### 2. Rotate `LLM_API_KEY` if leaked

- Revoke at your LLM provider's console immediately
- Generate a new key
- Update `.env` and redeploy

### 3. Run behind a reverse proxy with TLS

Use **Cloudflare**, **nginx**, **Caddy**, or **Traefik** in front of the
Node process. Benefits:

- Automatic HTTPS (Let's Encrypt)
- DDoS / bot filtering
- Request logging for forensics
- Additional rate limiting at the edge

Example Caddy config:

```caddy
agent.example.com {
  reverse_proxy localhost:4000
  encode gzip
  header {
    Strict-Transport-Security "max-age=31536000; includeSubDomains"
    X-Content-Type-Options "nosniff"
    X-Frame-Options "DENY"
  }
}
```

### 4. Set `PUBLIC_URL` to the real HTTPS domain

The agent card advertises this URL. If you leave it as `http://localhost:4000`
in production, clients will fail to reach you.

### 5. Monitor `GET /health`

Set up your uptime monitor (UptimeRobot, BetterStack, etc.) to ping:

```
https://your-domain.com/health
```

Alert on:
- Non-200 response
- `ok: false`
- Response time > 5s

### 6. Cap LLM provider spend

Set a hard monthly spend limit in your LLM provider's dashboard. A
misconfigured or abused endpoint can burn through quota fast.

### 7. Restrict outbound network access (optional, advanced)

The agent needs to reach:
- RPC providers (Arc, Base, BOT Chain, Robinhood)
- `api.coingecko.com`
- Your LLM provider
- Your `QURVE_API_URL`

If your infrastructure supports egress filtering, whitelist only these.

### 8. Run as non-root

The provided `Dockerfile` already drops to a non-root `app` user. If running
outside Docker, create a dedicated system user.

### 9. Keep dependencies updated

- Enable **Dependabot** on your fork
- Run `npm audit` before each deploy
- Subscribe to security advisories for: `express`, `ethers`, `groq-sdk`

### 10. Log responsibly

The agent logs structured JSON to stdout. If you ship logs to a service
(Datadog, Loki, CloudWatch), ensure:

- Logs do not contain API keys (they don't, by design)
- Wallet addresses are treated as PII in your jurisdiction (they are public
  on-chain, but correlate to users)
- Log retention complies with your privacy policy

---

## Known Non-Issues

The following are **by design** and will not be treated as security issues:

### Public unauthenticated endpoint

The `POST /a2a` endpoint accepts requests from anyone. This is intentional —
A2A agents are meant to be publicly discoverable and callable. Add
authentication at your reverse proxy layer if needed.

### Rate limiting is per-IP only

Simple per-IP counter, easily bypassed by IP rotation. Not designed to stop a
determined attacker. Use edge protection (Cloudflare, AWS WAF) for that.

### Denial-of-service via expensive requests

A request for a wallet with thousands of Qurve agent tokens can be slow. This
is bounded by `MAX_AGENTS_PER_CHAIN` (500) and `AGENT_BALANCE_CONCURRENCY`
(20), but a burst of such requests can still strain the server. Deploy with
CPU/memory limits.

### In-memory cache is not shared across instances

If you run multiple instances behind a load balancer, each instance has its
own cache. This is a performance concern, not a security concern.

### LLM output is non-deterministic

The same input can produce slightly different output across calls. This is
expected with language models. Sanitization guarantees the output is
**safe to render** — not that it is **factually correct**.

### CoinGecko prices can be stale up to 5 minutes

Cache TTL is 5 minutes. Not a security issue. If you need fresher prices,
lower the TTL (increases rate-limit risk).

---

## Credit

Security researchers who responsibly disclose valid vulnerabilities will be
credited in the `CHANGELOG.md` release notes (unless they prefer to remain
anonymous). Thank you for helping keep the Qurve ecosystem safe.

---

## Contact

- **Security reports:** security@qurve.fun
- **General issues:** https://github.com/qurve-launchpad/qurve-agent-example/issues
- **Qurve:** https://qurve.fun
