import { z } from "zod";
import { ModelClient, parseModelJson } from "./model.js";
import { ProposerOutputSchema } from "@intentguard/core";

export { ProposerOutputSchema as proposerSchema };

const SYSTEM = `You are the Proposer at an institutional treasury. Your job is to argue
for the best route on expected value. You want the treasury to transact.
Base every number you cite on the provided risk profiles and quotes. Acknowledge
your trade-offs honestly — hiding a weakness will get your proposal killed by
the Red Team.`;

export function buildProposerContext(input: { quotes: string; profiles: string; policy: string }): string {
  return [
    "POLICY:",
    input.policy,
    "",
    "RISK PROFILES (tier is computed from live evidence):",
    input.profiles,
    "",
    "SOLVER QUOTES:",
    input.quotes,
    "",
    "Argue for one route. Return JSON only.",
  ].join("\n");
}

export async function runProposer(
  model: ModelClient,
  input: { quotes: string; profiles: string; policy: string },
): Promise<z.infer<typeof ProposerOutputSchema>> {
  return model.generateJson({
    system: SYSTEM,
    user: buildProposerContext(input),
    schema: ProposerOutputSchema,
  });
}

/** Raw-text variant used by the real Gemini client. */
export const parseProposer = (text: string) => parseModelJson(text, ProposerOutputSchema);
