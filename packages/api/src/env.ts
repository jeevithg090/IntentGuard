/**
 * Runtime configuration for the API. Values are read from `process.env` by the
 * Node entrypoint (`server.ts`) and can be injected directly in tests via
 * `app.request(path, init, env)`.
 */
export interface ApiEnv {
  /** Mainnet RPC used to start an Anvil fork for pre-sign simulation. */
  MAINNET_RPC?: string;
  /** RPC the risk oracle reads settler contracts from. */
  BASE_SEPOLIA_RPC?: string;
  /** Enables the live Gemini Proposer / Red Team / Arbiter review. */
  GEMINI_API_KEY?: string;
  /** Throwaway demo key used to sign EIP-712 risk attestations. */
  ATTESTOR_PRIVATE_KEY?: string;
  /** Deployed PolicyVault the attestation is bound to (EIP-712 verifyingContract). */
  VAULT_ADDRESS?: string;
  /** Set to "true" to expose POST /sabotage outside development. */
  ENABLE_SABOTAGE?: string;
  /** Comma-separated list of origins allowed by CORS (defaults to none). */
  CORS_ORIGINS?: string;
  NODE_ENV?: string;
}

export const DEFAULT_RPC = "http://127.0.0.1:8545";

const KEYS: (keyof ApiEnv)[] = [
  "MAINNET_RPC",
  "BASE_SEPOLIA_RPC",
  "GEMINI_API_KEY",
  "ATTESTOR_PRIVATE_KEY",
  "VAULT_ADDRESS",
  "ENABLE_SABOTAGE",
  "CORS_ORIGINS",
  "NODE_ENV",
];

/** Pick the API's known variables out of a process environment (empty strings are dropped). */
export function envFromProcess(source: NodeJS.ProcessEnv = process.env): ApiEnv {
  const env: ApiEnv = {};
  for (const key of KEYS) {
    const value = source[key]?.trim();
    if (value) env[key] = value;
  }
  return env;
}

/** The sabotage endpoint is a dev-only demo; it is off in production unless explicitly enabled. */
export function sabotageEnabled(env: ApiEnv): boolean {
  if (env.ENABLE_SABOTAGE === "true") return true;
  if (env.ENABLE_SABOTAGE === "false") return false;
  return env.NODE_ENV !== "production";
}
