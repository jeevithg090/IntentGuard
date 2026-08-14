import { z } from "zod";
import { ModelClient, parseModelJson } from "./model.js";
import { ArbiterOutputSchema } from "@intentguard/core";

export { ArbiterOutputSchema as arbiterSchema };

const SYSTEM = `You are the Arbiter (CIO) of an institutional treasury. The Proposer has argued
for a route; the Red Team has attacked it. Weigh both against the user's committed
on-chain policy and issue one of:

EXECUTE — the route satisfies all constraints; proceed.
ASK     — potentially acceptable but needs human approval.
REFUSE  — the route violates the user's policy.

Preserve the dissent: list the objections you uphold and the ones you dismiss,
with one line of reasoning each. Be decisive. Return JSON only.`;

export function buildArbiterContext(input: {
  proposerArgument: string;
  redTeamCase: string;
  untrustedBlock: string;
  policy: string;
}): string {
  return [
    "POLICY (enforced on-chain, you cannot override it):",
    input.policy,
    "",
    "PROPOSER CASE:",
    input.proposerArgument,
    "",
    "RED TEAM CASE:",
    input.redTeamCase,
    "",
    input.untrustedBlock,
    "",
    "Issue your verdict. Return JSON only.",
  ].join("\n");
}

export async function runArbiter(
  model: ModelClient,
  input: {
    proposerArgument: string;
    redTeamCase: string;
    untrustedBlock: string;
    policy: string;
  },
): Promise<z.infer<typeof ArbiterOutputSchema>> {
  return model.generateJson({
    system: SYSTEM,
    user: buildArbiterContext(input),
    schema: ArbiterOutputSchema,
  });
}

export const parseArbiter = (text: string) => parseModelJson(text, ArbiterOutputSchema);
