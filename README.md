# IntentGuard

**A risk-aware, autonomous cross-chain treasury agent — the AI decides, the chain enforces.**

IntentGuard lets a user state a financial goal ("move $5,000 USDC to the best safe yield") instead of hand-picking bridges, routes and chains. The agent turns the goal into an ERC-7683-style cross-chain order, scores every competing solver route on cited on-chain and off-chain evidence, puts the choice through an adversarial multi-agent review, simulates it on a forked chain, and only then signs an EIP-712 risk attestation.

The key design decision: **the agent never has unchecked control of funds.** Execution goes through an on-chain `PolicyVault` that independently re-checks every attested field against the user's committed policy. Even a fully compromised agent — holding the real attestor key — cannot push an order past the mandate.

- The AI does not control the bridge.
- The AI controls the decision.
- The chain controls the AI.

---

## Features

| Capability                        | What it does                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Evidence-grounded risk oracle** | Scores each settler on four signals — upgradeability/admin control (EIP-1967 slots, Safe threshold, timelock), liquidity (DefiLlama TVL and 30-day trend), incident history (DefiLlama hacks feed) and solver track record (on-chain open/fill events). The route tier is the **max** of the signals, and any failed fetch scores tier 4 (fail-closed). Every number carries a provenance card with its source query. |
| **Adversarial review**            | A Proposer argues for a route, a Red Team attacks it, an Arbiter rules (Google Gemini with JSON-schema output, validated with Zod). Untrusted solver metadata is screened for prompt injection and fenced in a labelled data block. A local policy check overrides any model `EXECUTE` that breaks the policy. Without an API key, a deterministic offline review picks the best in-policy route.                     |
| **Fork simulation**               | Before signing, the selected route runs on an Anvil mainnet fork with assertions for balance delta, fee-on-transfer, honeypot (blocked transfers) and approval scope. The result is hashed into a `simHash` bound into the attestation.                                                                                                                                                                               |
| **EIP-712 attestations**          | The attestor signs `RiskAttestation(orderId, riskTier, feeBps, simHash, expiry, nonce)`, bound to the vault address and chain id.                                                                                                                                                                                                                                                                                     |
| **On-chain PolicyVault**          | Custodies user deposits and opens orders only if: not paused, attestation fresh, not replayed, signed by the attestor, describes exactly this order, and tier / fee / notional / fill deadline / settler allow-list (Merkle root) / rolling daily budget are all within the user's policy.                                                                                                                            |
| **Drift monitor + kill switch**   | A library that re-scores open positions with the same oracle and can pause the vault when a position drifts above the policy tier.                                                                                                                                                                                                                                                                                    |
| **Web console**                   | Mandate, Evidence, Debate and Journal views, plus a dev-only "sabotage" control. A built-in Demo Mode walks the whole pipeline on mock data so the static build works without a backend.                                                                                                                                                                                                                              |

## Tech stack

- **Contracts:** Solidity 0.8.24, Foundry (unit, fuzz and invariant tests), vendored `forge-std`
- **Backend:** TypeScript (ESM, strict), Node.js ≥ 20.12, [Hono](https://hono.dev) on `@hono/node-server`, [viem](https://viem.sh), Zod, `@google/genai`
- **Frontend:** React 18, Vite 6, Tailwind CSS 3
- **Tooling:** pnpm workspaces, Vitest, ESLint (typescript-eslint), Prettier, `forge fmt`, GitHub Actions

## Architecture

```
USER ──natural-language mandate──▶ API  (packages/api, POST /decide)
                                    │
                                    ▼
                   ERC-7683 quotes from solvers (mocked: 3 demo routes)
                                    │
                                    ▼
          ① RISK ORACLE (packages/oracle)
             upgradeability · liquidity · incidents · solver history
             → RiskProfile per route, provenance for every signal
                                    │
                                    ▼
          ② ADVERSARIAL REVIEW (packages/agents)
             injection screening → Proposer → Red Team → Arbiter
             → local policy override → EXECUTE / ASK / REFUSE
                                    │  EXECUTE
                                    ▼
          ③ FORK SIMULATION (packages/simulator)
             Anvil fork: balance delta · fee-on-transfer · honeypot · approval scope
             → simHash
                                    │  all assertions pass
                                    ▼
          ④ ATTESTATION (packages/attestor)
             ERC-7683 order + EIP-712 RiskAttestation signed by the attestor
                                    │
                                    ▼
          ⑤ POLICY VAULT (packages/contracts, PolicyVault.sol)
             re-checks every field against the user's policy; reverts otherwise
                                    │
                                    ▼
                         Origin settler opens the order
                                    │
                                    ▼
          ⑥ DRIFT MONITOR (packages/monitor) — re-score, pause on escalation

   Every decision is recorded in a Decision Journal (GET /journal/:id, GET /journals).
```

The API keeps journals in memory (bounded to the 500 most recent) and never submits transactions itself: it returns the attestation, and the user (or a relayer) calls `openWithPolicy`.

### Trust assumptions

**The attestor key is a single EOA in this prototype.** If it leaks, an attacker can _recommend_ anything — but cannot exceed the on-chain policy (see the sabotage demo below). Production options for the attestor:

- an **m-of-n attestor committee** with a threshold signature,
- a **TEE with remote attestation**, or
- an **optimistic model** with a challenge window and slashing.

The system's guarantee is the vault's independent re-check, not the attestor's honesty.

### What is real vs. simulated

| Layer                                   | Status                                                                                                               |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Solver quotes                           | **Mocked** — three demo routes (`packages/api/src/demoQuotes.ts`); route C is a honeypot with an injected annotation |
| Upgradeability / admin / timelock reads | **Real** — JSON-RPC against whatever `BASE_SEPOLIA_RPC` points at                                                    |
| TVL, TVL trend, incident feed           | **Real** — DefiLlama public API                                                                                      |
| Adversarial review                      | **Real** with `GEMINI_API_KEY`; deterministic offline fallback otherwise                                             |
| Prompt-injection screening              | **Real** (pattern-based)                                                                                             |
| Fork simulation                         | **Real** when `MAINNET_RPC` is set (requires `anvil`); otherwise recorded as skipped                                 |
| Attestation signing                     | **Real** when `ATTESTOR_PRIVATE_KEY` and `VAULT_ADDRESS` are set; otherwise returned unsigned                        |
| PolicyVault enforcement                 | **Real** Solidity, exercised against local Anvil in tests. No public testnet deployment is published yet             |
| Drift monitor                           | Library implemented and tested; not yet wired into the API server                                                    |

ERC-7683 is an emerging standard with live implementations (Across, UniswapX and others), not a finalized one; the vault uses a minimal ERC-7683-inspired interface (`IOriginSettler`).

## Getting started

### Prerequisites

- Node.js **20.12+** (22 recommended — see `.nvmrc`) and pnpm **10** (`corepack enable`)
- [Foundry](https://book.getfoundry.sh/getting-started/installation) (`forge`, `anvil`, `cast`) — required for the contracts and for the attestor, simulator, API and e2e test suites

### Install

```bash
pnpm install
cp .env.example .env   # optional — everything runs offline without it
```

### Run locally

```bash
pnpm dev:api   # API on http://127.0.0.1:4000 (reads ../../.env automatically)
pnpm dev:web   # UI on http://localhost:5173, proxies /api → :4000
```

With no environment variables the API runs fully offline: deterministic review, skipped simulation, unsigned attestations. Note that the oracle is fail-closed, so if it cannot reach an RPC node or DefiLlama, every route scores tier 4 and the decision is `REFUSE` — that is intended behaviour.

Open the UI and use **Run the pipeline** (needs the API) or **Demo Mode** (no backend needed).

### Environment variables

All are optional. See [`.env.example`](.env.example).

| Variable                                                        | Used by              | Purpose                                                                                             |
| --------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------- |
| `GEMINI_API_KEY`                                                | API                  | Enables the live Gemini Proposer / Red Team / Arbiter review                                        |
| `BASE_SEPOLIA_RPC`                                              | API                  | RPC the risk oracle reads settler contracts from (default `http://127.0.0.1:8545`)                  |
| `MAINNET_RPC`                                                   | API                  | Mainnet RPC to fork with Anvil for pre-sign simulation                                              |
| `ATTESTOR_PRIVATE_KEY`                                          | API, sabotage script | Throwaway demo key that signs attestations. **Never a real key**                                    |
| `VAULT_ADDRESS`                                                 | API, sabotage script | Deployed `PolicyVault` that attestations are bound to                                               |
| `CORS_ORIGINS`                                                  | API                  | Comma-separated origins allowed cross-origin (default: none; the Vite dev server uses a proxy)      |
| `ENABLE_SABOTAGE`                                               | API                  | `POST /sabotage` is on by default except when `NODE_ENV=production`; set `true`/`false` to override |
| `HOST`, `PORT`                                                  | API                  | Listen address (default `127.0.0.1:4000`)                                                           |
| `RPC_URL`                                                       | sabotage script      | Chain to run the sabotage demo against                                                              |
| `DEPLOYER_PRIVATE_KEY`, `ATTESTOR_ADDRESS`, `DEMO_USER_ADDRESS` | `Deploy.s.sol`       | Contract deployment                                                                                 |

### API

| Method | Path                   | Description                                                                                                                                                                        |
| ------ | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/health`              | Liveness check                                                                                                                                                                     |
| `POST` | `/decide`              | Run the full pipeline. Body (all optional): `{ mandate: string, notionalUsd: number, quotes: Quote[] }`. Returns the Decision Journal. Invalid bodies return `400` with Zod issues |
| `POST` | `/sabotage`            | Dev-only: record a forged `EXECUTE` decision that bypasses the agents. Body: `{ routeId?: string, tier?: 1-4 }`                                                                    |
| `GET`  | `/journal/:id`         | One journal                                                                                                                                                                        |
| `GET`  | `/journals`            | All journals, newest first                                                                                                                                                         |
| `GET`  | `/provenance/:settler` | Risk profile and provenance cards for a settler address                                                                                                                            |

## The sabotage demo

Attack your own agent and watch the chain hold:

```bash
anvil &                                   # local chain on :8545
cd packages/contracts
DEPLOYER=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80   # anvil's public test key #0
USDC=$(forge create src/mocks/MockUSDC.sol:MockUSDC --rpc-url http://127.0.0.1:8545 \
  --private-key $DEPLOYER --broadcast | awk '/Deployed to/ {print $3}')
VAULT=$(forge create src/PolicyVault.sol:PolicyVault --rpc-url http://127.0.0.1:8545 \
  --private-key $DEPLOYER --broadcast \
  --constructor-args $USDC 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 | awk '/Deployed to/ {print $3}')
cd ../..

# anvil's public test key #1 is the attestor
RPC_URL=http://127.0.0.1:8545 VAULT_ADDRESS=$VAULT \
ATTESTOR_PRIVATE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d \
pnpm sabotage
```

The script commits a tier-2 policy for the demo user, then submits an order with a **tier-4 attestation signed by the real attestor key**. The attestation is valid in every respect — correct EIP-712 domain, real signer, fresh, never used. The vault still reverts:

```
REVERTED — RiskTierExceedsPolicy. The chain enforced the policy.
A fully compromised attestor still cannot exceed the mandate.
```

The script decodes the actual custom error and exits non-zero if the vault reverts for any other reason. The same property is covered by `test_CompromisedAgent_CannotExceedPolicy` (Foundry) and the e2e suite.

## Testing

```bash
pnpm test             # every package's Vitest suite + the e2e suite
pnpm test:contracts   # forge test — unit, fuzz and invariant tests
pnpm lint             # ESLint
pnpm format:check     # Prettier (use `pnpm format` to fix)
pnpm typecheck        # tsc for all packages + the web app
pnpm build            # tsc per package + Vite production build
```

The attestor, simulator, API and e2e suites start their own `anvil` instances on fixed local ports and deploy contracts with `forge create`, so Foundry must be on your `PATH`. Two agent tests run against the live Gemini API and are skipped unless `GEMINI_API_KEY` is set.

| Suite                                                 | Covers                                                                                                               |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/test/PolicyVault.t.sol`           | Every policy bound reverts; EIP-712 chain binding; replay; pause; `test_CompromisedAgent_CannotExceedPolicy`         |
| `packages/contracts/test/PolicyVault.fuzz.t.sol`      | Fuzzed tier / fee / notional / deadline / budget edges                                                               |
| `packages/contracts/test/PolicyVault.invariant.t.sol` | Arbitrary call sequences never breach budget, open while paused, replay, or strand funds                             |
| `packages/core/test`                                  | Zod schemas (policy, quotes, attestation byte lengths), BigInt-safe JSON                                             |
| `packages/oracle/test`                                | EIP-1967 detection, Safe/timelock parsing, settlers without code, fail-closed on RPC/API errors, provenance          |
| `packages/agents/test`                                | Injection screening, orchestration, local policy override, malformed model output                                    |
| `packages/simulator/test`                             | Honeypot, fee-on-transfer, approval scope, deterministic `simHash` (real bytecode on local Anvil)                    |
| `packages/attestor/test`                              | Order encoding matches Solidity `abi.encode`; TS signature recovered by the deployed vault                           |
| `packages/monitor/test`                               | Drift detection, escalation policy, transient-failure handling                                                       |
| `packages/api/test`                                   | Pipeline, request validation, offline review selection, signed attestations verified on-chain, CORS, sabotage gating |
| `e2e/flows.test.ts`                                   | In-policy order opens on-chain; forged tier-4 reverts `RiskTierExceedsPolicy`; notional limit; kill switch           |

CI (`.github/workflows/ci.yml`) runs Foundry format/build/test and the TypeScript lint, format, typecheck, test, e2e and build steps on every push to `main` and every pull request.

## Deployment

**Frontend (static).** `vercel.json` builds `packages/web` and serves `packages/web/dist`. Any static host works:

```bash
pnpm --filter @intentguard/web build   # → packages/web/dist
```

The static build has no backend; its `/api/*` calls fail with an explanatory message and Demo Mode stays fully usable. To serve live decisions, put the API behind the same origin under `/api` (reverse proxy stripping the prefix) or set `CORS_ORIGINS` and adjust the frontend's base path.

**API.** Runs from TypeScript source with `tsx`:

```bash
NODE_ENV=production HOST=0.0.0.0 PORT=4000 pnpm --filter @intentguard/api start
```

Install Foundry on the host if you enable fork simulation (`MAINNET_RPC`). Journals are in memory, so they reset on restart.

**Contracts.**

```bash
cd packages/contracts
DEPLOYER_PRIVATE_KEY=... ATTESTOR_ADDRESS=... DEMO_USER_ADDRESS=... \
  forge script script/Deploy.s.sol --rpc-url $BASE_SEPOLIA_RPC --broadcast
```

This deploys `MockUSDC`, `MockOriginSettler` and `PolicyVault`, commits a demo policy for the deployer and mints test USDC to the demo user. Put the vault address in `VAULT_ADDRESS`.

## Project structure

```
.
├── packages/
│   ├── contracts/   Foundry project: PolicyVault, ERC-7683 interface, mocks (USDC, settler,
│   │                honeypot, fee-on-transfer), deploy script, unit/fuzz/invariant tests
│   ├── core/        Shared types, Zod schemas, BigInt-safe JSON helpers
│   ├── oracle/      Risk signals (upgradeability, liquidity, incidents, solver history) + scoring
│   ├── agents/      Injection screening, Proposer / Red Team / Arbiter, Gemini adapter, orchestrator
│   ├── simulator/   Anvil fork management, simulation assertions, simHash
│   ├── attestor/    ERC-7683 order encoding, EIP-712 attestation signing
│   ├── monitor/     Drift detection and vault kill switch
│   ├── api/         Hono server wiring the pipeline together (+ offline review, validation)
│   └── web/         Vite + React + Tailwind console with Demo Mode
├── e2e/             End-to-end flows against local Anvil and a deployed vault
├── scripts/         sabotage.mts — the compromised-attestor demo
└── .github/         CI workflow
```
