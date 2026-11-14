import { serve } from "@hono/node-server";
import app from "./index.js";
import { envFromProcess } from "./env.js";

// Load the repo-root .env for local development, if present (real env vars win).
try {
  process.loadEnvFile(new URL("../../../.env", import.meta.url));
} catch {
  // no .env file — rely on the process environment
}

// Hono's Node adapter passes the raw request/response objects as `c.env`, so the
// API's configuration is read from process.env once and injected per request.
const env = envFromProcess();
const port = Number(process.env.PORT || 4000);
const hostname = process.env.HOST || "127.0.0.1";

const server = serve({ fetch: (req) => app.fetch(req, env), port, hostname }, (info) => {
  console.log(`IntentGuard API listening on http://${hostname}:${info.port}`);
  console.log(
    `  review: ${env.GEMINI_API_KEY ? "Gemini" : "offline deterministic"} · ` +
      `simulation: ${env.MAINNET_RPC ? "Anvil fork" : "skipped"} · ` +
      `attestation: ${env.ATTESTOR_PRIVATE_KEY && env.VAULT_ADDRESS ? "signed" : "unsigned"}`,
  );
});

const shutdown = () => server.close(() => process.exit(0));
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
