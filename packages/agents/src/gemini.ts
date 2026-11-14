import { z } from "zod";
import { ModelClient, AgentRefusalError, AgentTruncatedError, AgentMalformedError } from "./model.js";

/**
 * Real Gemini adapter. Requires `@google/genai`. Uses native JSON structured
 * output and validates the parsed JSON with the Zod schema on the way back in.
 *
 * Free-tier notes: quota-limited (RPM/RPD), so keep an eye out for 429s and
 * pass a backoff at the call site. Model IDs shift — verify the current
 * free-tier ID at ai.google.dev.
 */
export function geminiClient(opts: {
  apiKey: string;
  model?: string;
  apiModule?: unknown;
  maxOutputTokens?: number;
}): ModelClient {
  return {
    async generateJson<T>(input: { system: string; user: string; schema: z.ZodType<T> }): Promise<T> {
      const { GoogleGenAI, Type, SchemaType } = (opts.apiModule ?? (await import("@google/genai"))) as unknown as {
        GoogleGenAI: new (cfg: { apiKey: string }) => {
          models: {
            generateContent: (req: {
              model: string;
              contents: string;
              config?: {
                systemInstruction?: string;
                responseMimeType?: string;
                responseSchema?: unknown;
                maxOutputTokens?: number;
              };
            }) => Promise<GenAiResponse>;
          };
        };
        Type: Record<string, string>;
        SchemaType: Record<string, string>;
      };

      const ai = new GoogleGenAI({ apiKey: opts.apiKey });
      const modelName = opts.model ?? "gemini-2.5-flash";

      const response = await ai.models.generateContent({
        model: modelName,
        contents: input.user,
        config: {
          systemInstruction: input.system,
          responseMimeType: "application/json",
          responseSchema: zodToGeminiSchema(input.schema, { Type, SchemaType }),
          maxOutputTokens: opts.maxOutputTokens,
        },
      });

      const candidate = response.candidates?.[0];
      if (!candidate || candidate.finishReason === "SAFETY" || candidate.finishReason === "PROHIBITED_CONTENT") {
        throw new AgentRefusalError(candidate?.finishReason ?? "no_candidate");
      }
      if (candidate.finishReason === "MAX_TOKENS") throw new AgentTruncatedError();

      const text = candidate.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
      try {
        return input.schema.parse(JSON.parse(text));
      } catch (e) {
        throw new AgentMalformedError(e);
      }
    },
  };
}

interface GenAiResponse {
  candidates?: {
    finishReason?: string;
    content?: { parts?: { text?: string }[] };
  }[];
}

/**
 * Zod schema → Gemini responseSchema (Type enum) converter. Handles the subset
 * the agent roles need: objects, arrays, strings (+enum), numbers, booleans,
 * nullable and optional fields.
 */
export function zodToGeminiSchema(
  schema: z.ZodType<unknown>,
  T: { Type: Record<string, string>; SchemaType: Record<string, string> },
): unknown {
  const s = schema as z.ZodTypeAny;
  const def = s._def;
  const typeName = def.typeName;

  if (typeName === "ZodObject") {
    const shape = def.shape() as Record<string, z.ZodTypeAny>;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      const inner = value as z.ZodTypeAny;
      if (inner._def.typeName === "ZodOptional") {
        properties[key] = convert(inner._def.innerType, T);
      } else if (inner._def.typeName === "ZodNullable") {
        const converted = convert(inner._def.innerType, T);
        properties[key] = { ...(converted as Record<string, unknown>), nullable: true };
      } else {
        properties[key] = convert(inner, T);
        required.push(key);
      }
    }
    return { type: T.Type.OBJECT, properties, required };
  }
  if (typeName === "ZodArray") {
    return { type: T.Type.ARRAY, items: convert(def.type, T) };
  }
  if (typeName === "ZodString") {
    const base: Record<string, unknown> = { type: T.Type.STRING };
    if (def.values) base.enum = def.values;
    return base;
  }
  if (typeName === "ZodEnum") {
    return { type: T.Type.STRING, enum: [...def.values] };
  }
  if (typeName === "ZodNumber") return { type: T.Type.NUMBER };
  if (typeName === "ZodBoolean") return { type: T.Type.BOOLEAN };
  if (typeName === "ZodLiteral") return { type: T.Type.STRING, enum: [String(def.value)] };
  if (typeName === "ZodUnion") {
    // e.g. z.union([z.literal(1), z.literal(2)]) — treat as number enum
    const options = def.options as z.ZodTypeAny[];
    const nums = options.filter((o) => o._def.typeName === "ZodLiteral" && typeof o._def.value === "number");
    if (nums.length === options.length) return { type: T.Type.NUMBER, enum: nums.map((o) => o._def.value) };
    return { type: T.Type.STRING };
  }
  if (typeName === "ZodOptional" || typeName === "ZodNullable") return convert(def.innerType, T);
  // Fallback: string — the Zod re-parse will catch any mismatch loudly.
  return { type: T.Type.STRING };
}

const convert = zodToGeminiSchema;
