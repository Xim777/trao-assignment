import { GoogleGenAI } from "@google/genai";
import type { JsonGenerator } from "@prepkit/core";

const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const MAX_ATTEMPTS = 3;
const INITIAL_RETRY_DELAY_MS = 500;

// The JSON structure Gemini must return for JD extraction.
const JD_EXTRACTION_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    seniority: { type: "string" },
    responsibilities: {
      type: "array",
      items: { type: "string" }
    },
    requirements: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          kind: {
            type: "string",
            enum: ["technical", "behavioural", "domain"]
          },
          priority: {
            type: "string",
            enum: ["must", "nice"]
          }
        },
        required: ["text", "kind", "priority"],
        additionalProperties: false
      }
    }
  },
  required: ["title", "seniority", "responsibilities", "requirements"],
  additionalProperties: false
};

let geminiClient: GoogleGenAI | undefined;

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  if (!geminiClient) {
    geminiClient = new GoogleGenAI({ apiKey });
  }
  return geminiClient;
}

function getHttpStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  if ("status" in error && typeof error.status === "number") return error.status;
  if ("statusCode" in error && typeof error.statusCode === "number") return error.statusCode;
  return undefined;
}

function isRetryable(error: unknown): boolean {
  const status = getHttpStatus(error);
  if (status !== undefined) {
    return [408, 429, 500, 502, 503, 504].includes(status);
  }

  const message = error instanceof Error ? error.message : String(error);
  return /fetch failed|timeout|timed out|ECONNRESET|ETIMEDOUT|temporarily unavailable|overloaded|rate.?limit|invalid JSON|empty response/i.test(message);
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Implements the JsonGenerator interface with bounded exponential retry for
 * transient provider failures and rate limits.
 */
export const generateWithGemini: JsonGenerator = async ({
  systemPrompt,
  userPrompt,
  responseSchema
}) => {
  const model = process.env.LLM_MODEL?.trim() || DEFAULT_MODEL;
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const response = await getGeminiClient().models.generateContent({
        model,
        contents: userPrompt,
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: "application/json",
          responseJsonSchema: (
            responseSchema ?? JD_EXTRACTION_RESPONSE_SCHEMA
          ) as typeof JD_EXTRACTION_RESPONSE_SCHEMA,
          maxOutputTokens: 4096
        }
      });

      const responseText = response.text;
      if (!responseText || !responseText.trim()) {
        throw new Error("Gemini returned an empty response.");
      }

      try {
        return JSON.parse(responseText) as unknown;
      } catch {
        throw new Error("Gemini returned invalid JSON.");
      }
    } catch (error) {
      lastError = error;
      if (attempt >= MAX_ATTEMPTS - 1 || !isRetryable(error)) {
        throw error;
      }

      const delay = INITIAL_RETRY_DELAY_MS * 2 ** attempt;
      await wait(delay);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Gemini request failed after retries.");
};
