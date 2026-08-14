# IntentGuard — Risk-Aware Autonomous Cross-Chain Treasury

**IntentGuard is an AI-powered cross-chain treasury agent that lets users express financial goals instead of manually specifying routes, bridges, and chains. The agent converts goals into standardized cross-chain intents, evaluates competing solver opportunities, analyzes the security assumptions behind each route, and selects the best route that satisfies the user's constraints.**

Instead of giving an AI agent unrestricted control over funds, IntentGuard separates **decision-making from execution** — and enforces that separation **on-chain**, so it holds even when the agent itself is compromised:

- **The AI does not control the bridge.**
- **The AI controls the decision.**
- **The chain controls the AI.** …the chain enforces it.

---

## 1. The sabotage demo

The single most important thing to show a judge. You attack your own agent — and it holds.

```bash
# 1. Deploy locally (or use the testnet deployment below)
anvil --port 8545 &
cd packages/contracts
forge create src/mocks/MockUSDC.sol:MockUSDC --rpc-url http://127.0.0.1:8545 --private-key $DEPLOYER_KEY --broadcast
forge create src/PolicyVault.sol:PolicyVault --rpc-url http://127.0.0.1:8545 \
  --private-key $DEPLOYER_KEY --broadcast \
  --constructor-args <USDC_ADDRESS> <ATTESTOR_ADDRESS>

# 2. Attack your own agent: a forged tier-4 attestation, signed by the REAL attestor key
RPC_URL=http://127.0.0.1:8545 \
VAULT_ADDRESS=<VAULT_ADDRESS> \
ATTESTOR_PRIVATE_KEY=<throwaway-demo-key> \
pnpm tsx scripts/sabotage.mts
```

Expected output:

```
REVERTED — RiskTierExceedsPolicy. The chain enforced the policy.
A fully compromised attestor still cannot exceed the mandate.
```

The attestation is perfectly valid: correct EIP-712 domain, signed by the real attestor key, fresh, non-replayed. The vault **still reverts**, because it independently re-checks every field against the user's committed policy. This is the guarantee the whole system rests on, and it does not depend on the attestor being honest. The test `test_CompromisedAgent_CannotExceedPolicy` in `packages/contracts/test/PolicyVault.t.sol` proves the same property.

## 2. Deployed contract

Testnet deployment (Base Sepolia) — set `VAULT_ADDRESS` in `.env`:

```
VAULT_ADDRESS=           # ← fill after `forge script script/Deploy.s.sol --broadcast`
```

Deploy with:

```bash
cd packages/contracts
forge script script/Deploy.s.sol --rpc-url $BASE_SEPOLIA_RPC --broadcast
# then verify on https://sepolia.basescan.org
```

## 3. Architecture

```
USER ──natural language──▶ INTENTGUARD AGENT
                             │
        ┌────────────────────┼─────────────────────┐
        ▼                    ▼                     ▼
  Intent Parser        Policy Engine         Context Engine
        └────────────────────┼─────────────────────┘
                             ▼
                     ERC-7683 Order
                             ▼
                     Solver Network
              ┌──────────┼──────────┐
              ▼          ▼          ▼
          Solver A   Solver B   Solver C
              └──────────┼──────────┘
                         ▼
          ★ EVIDENCE-GROUNDED RISK ORACLE
          (upgradeability / liquidity / incidents / solver history —
           every number carries a clickable provenance card)
                         ▼
          ★ ADVERSARIAL REVIEW
          Proposer ──▶ Red Team ──▶ Arbiter  (injection screening)
                         ▼
          ★ FORK SIMULATION (Anvil)
          (balance delta, fee-on-transfer, honeypot, approval scope)
                         ▼
              EXECUTE / ASK / REFUSE
                         ▼
          ★ ON-CHAIN POLICY VAULT
          (independently re-checks; reverts if out of policy)
                         ▼
                 Solver Executes
                         ▼
          ★ CONTINUOUS DRIFT MONITOR
          (re-scores open positions; kill switch pauses the vault)
                         ▼
                 Decision Journal
```

## 4. Trust assumptions

**The attestor key is a single EOA in this prototype.** If it leaks, an attacker can *recommend* anything — but cannot exceed the on-chain policy (see the sabotage demo). The production path for the attestor is:

- an **m-of-n attestor committee** with a threshold signature, or
- a **TEE with remote attestation**, or
- an **optimistic model** with a challenge window and slashing.

Volunteering this limitation is intentional: the system's guarantee is the vault's independent re-check, not the attestor's honesty.

## 5. What is real vs. simulated

| Layer | Real or mocked |
|---|---|
| Solver quote generation | **Mocked** (3 simulated solvers) |
| Contract upgradeability / admin / timelock reads | **Real** — live RPC against testnet + mainnet forks |
| TVL, TVL trend, incident feed | **Real** — DefiLlama API |
| Adversarial multi-agent review | **Real** — Google Gemini (free tier); deterministic offline fallback included |
| Prompt-injection screening | **Real** |
| Fork simulation and assertions | **Real** — Anvil mainnet fork (honeypot / fee-on-transfer against real token bytecode) |
| Policy Vault enforcement | **Real** — deployed Solidity on testnet |
| Drift monitoring | **Real** — live re-scoring |

ERC-7683 is described as an **emerging standard with live implementations** (Across, UniswapX, CoW Protocol, Eco), not a ratified one — verify the EIP page on submission day.

## 6. Test it

```bash
pnpm test && cd packages/contracts && forge test
```

Expected output:

```
# Vitest (pnpm test)
 Test Files  7 passed (7)
      Tests  66 passed (66)

# Foundry (forge test)
Ran 3 test suites: 44 tests passed, 0 failed, 0 skipped
```

Coverage: `forge coverage` → PolicyVault.sol 99% line / 100% function coverage.

### What each suite proves

| Suite | Proves |
|---|---|
| `packages/contracts/test/PolicyVault.t.sol` | Every policy bound reverts; EIP-712 chain binding; `test_CompromisedAgent_CannotExceedPolicy` |
| `packages/contracts/test/PolicyVault.fuzz.t.sol` | 256-run fuzzing: no tier/fee/notional/deadline/budget edge escapes |
| `packages/contracts/test/PolicyVault.invariant.t.sol` | Arbitrary call sequences never breach budget, open while paused, replay, or retain funds |
| `packages/oracle/test/oracle.test.ts` | EIP-1967 detection, Safe/timelock parsing, fail-closed on RPC/API errors, provenance |
| `packages/agents/test/agents.test.ts` | Injection screening, adversarial orchestration, local policy override, malformed model output |
| `packages/simulator/test/simulator.test.ts` | Honeypot detection, fee-on-transfer detection, approval scope, deterministic simHash (real bytecode on local Anvil) |
| `packages/attestor/test/sign.test.ts` | TS EIP-712 signature verified by the deployed Solidity vault |
| `packages/monitor/test/monitor.test.ts` | Drift detection, escalation policy, transient-failure resilience |
| `packages/api/test/api.test.ts` + `e2e/flows.test.ts` | Happy path, refusal paths, injection path, **sabotage reverts on-chain**, drift pause |

## 7. Run the demo

```bash
cp .env.example .env            # add GEMINI_API_KEY, MAINNET_RPC, keys
pnpm install
pnpm --filter @intentguard/api dev   # API on :4000
pnpm --filter @intentguard/web dev   # UI on :5173
```

Four views: **Mandate** (natural language input), **Evidence** (provenance cards, click to see the literal query), **Debate** (Proposer vs Red Team vs Arbiter), **Journal + Sabotage** (decision record + the dev-only sabotage button).

## 8. Project layout

```
packages/
├── contracts/     # Foundry: PolicyVault, mocks (Honeypot, FeeOnTransfer), 44 tests
├── core/          # shared types + zod schemas
├── oracle/        # Feature 2: evidence-grounded risk signals
├── agents/        # Feature 3: sanitizer + Proposer/Red Team/Arbiter + orchestrator
├── simulator/     # Feature 4: Anvil fork + assertions + simHash
├── attestor/      # EIP-712 attestation signing
├── monitor/       # Feature 5: drift detection + kill switch
├── api/           # Hono server wiring it all together
└── web/           # Vite + React + Tailwind frontend
scripts/sabotage.mts  # the demo moment
e2e/flows.test.ts     # the eight end-to-end flows
```
