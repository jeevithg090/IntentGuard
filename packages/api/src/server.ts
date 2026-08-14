import { serve } from "@hono/node-server";
import app from "./index.js";

const port = Number(process.env.PORT ?? 4000);
console.log(`IntentGuard API listening on http://127.0.0.1:${port}`);
serve({ fetch: app.fetch, port });
