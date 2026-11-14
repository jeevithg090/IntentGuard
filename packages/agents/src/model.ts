import { z } from "zod";

/** Typed errors so a malformed or blocked model response fails loudly. */
export class AgentRefusalError extends Error {
  constructor(readonly finishReason: string) {
    super(`agent refused: ${finishReason}`);
    this.name = "AgentRefusalError";
  }
}

export class AgentTruncatedError extends Error {
  constructor() {
    super("agent response truncated (MAX_TOKENS)");
    this.name = "AgentTruncatedError";
  }
}

export class AgentMalformedError extends Error {
  constructor(readonly cause_: unknown) {
    super(`agent returned malformed output: ${String(cause_)}`);
    this.name = "AgentMalformedError";
  }
}

/**
 * The seam every agent role calls. The real implementation wraps Gemini
 * (`@google/genai`); tests inject a deterministic stub. Only the interface is
 * load-bearing — swap the provider without touching the roles.
 */
export interface ModelClient {
  generateJson<T>(input: { system: string; user: string; schema: z.ZodType<T> }): Promise<T>;
}

export const parseModelJson = <T>(text: string, schema: z.ZodType<T>): T => {
  try {
    return schema.parse(JSON.parse(text));
  } catch (e) {
    throw new AgentMalformedError(e);
  }
};
