
import { GoogleGenAI } from "@google/genai";
import type { JsonGenerator } from "@prepkit/core";

const DEFAULT_MODEL = "gemini-3.5-flash-lite";

// The JSON structure Gemini must return for JD extraction.
const JD_EXTRACTION_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    title: {
      type: "string",
    },
    seniority: {
      type: "string",
    },
    responsibilities: {
      type: "array",
      items: {
        type: "string",
      },
    },
    requirements: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: {
            type: "string",
          },
          kind: {
            type: "string",
            enum: ["technical", "behavioural", "domain"],
          },
          priority: {
            type: "string",
            enum: ["must", "nice"],
          },
        },
        required: ["text", "kind", "priority"],
        additionalProperties: false,
      },
    },
  },
  required: ["title", "seniority", "responsibilities", "requirements"],
  additionalProperties: false,
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

/**
 * Implements the JsonGenerator interface expected by @prepkit/core.
 */
export const generateWithGemini: JsonGenerator = async ({
  systemPrompt,
  userPrompt,
}) => {
  const model = process.env.LLM_MODEL?.trim() || DEFAULT_MODEL;

  const response = await getGeminiClient().models.generateContent({
    model,
    contents: userPrompt,
    config: {
      systemInstruction: systemPrompt,
      responseMimeType: "application/json",
      responseJsonSchema: JD_EXTRACTION_RESPONSE_SCHEMA,
      maxOutputTokens: 4096,
    },
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
};
