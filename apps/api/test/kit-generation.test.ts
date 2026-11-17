import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import {
  createKitGenerationRouter
} from "../src/routes/kit-generation.js";
import type { JsonGenerator } from "@prepkit/core";

const role = {
  title: "Backend Engineer",
  seniority: "Mid-level",
  responsibilities: ["Build scalable backend services."],
  requirements: [
    {
      id: "r1",
      text: "Experience with TypeScript",
      kind: "technical" as const,
      priority: "must" as const
    },
    {
      id: "r2",
      text: "Strong communication skills",
      kind: "behavioural" as const,
      priority: "must" as const
    }
  ]
};

const companyResearch = {
  source: {
    company: "Stripe",
    company_url: "https://stripe.com",
    role: "Backend Engineer",
    location: "Remote",
    jd_chars: 250,
    researched_at: "2026-11-16T08:00:00.000Z",
    pages_used: ["https://stripe.com"]
  },
  company_brief: {
    summary: "Stripe builds financial infrastructure.",
    what_they_do: "Provides payments and financial infrastructure.",
    sources: []
  },
  research: {
    crawl_status: "completed" as const,
    discussion_status: "unavailable" as const,
    official_sources: [],
    discussion_sources: [],
    failures: [],
    limitations: []
  }
};

function createGenerator(): JsonGenerator {
  return vi.fn(async ({ systemPrompt }) => {
    if (systemPrompt.includes("You create concise, high-quality interview preparation flashcards.")) {
      return {
        flashcards: [
          {
            requirement_ids: ["r1"],
            front: "What makes a TypeScript API contract safe?",
            back: "Use explicit types and validate untrusted runtime input."
          },
          {
            requirement_ids: ["r2"],
            front: "How do you demonstrate effective communication?",
            back: "Describe the context, your actions, and the outcome."
          }
        ]
      };
    }

    if (systemPrompt.includes("REQUESTED_CATEGORY: technical")) {
      return {
        questions: [{
          requirement_ids: ["r1"],
          prompt: "How would you design a typed REST API?",
          answer_outline: "Discuss contracts, validation, and error handling.",
          difficulty: 2
        }]
      };
    }

    if (systemPrompt.includes("REQUESTED_CATEGORY: behavioural")) {
      return {
        questions: [{
          requirement_ids: ["r2"],
          prompt: "Describe a time you resolved a team disagreement.",
          answer_outline: "Explain context, actions, and outcome.",
          difficulty: 2
        }]
      };
    }

    return { questions: [] };
  }) as JsonGenerator;
}

describe("POST /api/kits/generate", () => {
  let server: Server | undefined;
  let baseUrl: string;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server!.close(error => error ? reject(error) : resolve());
      });
      server = undefined;
    }
  });

  async function startServer(generateJson: JsonGenerator) {
    const app = express();
    app.use(express.json());
    app.use("/api/kits", createKitGenerationRouter({ generateJson }));

    server = await new Promise<Server>(resolve => {
      const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Test server did not bind to a TCP port.");
    }

    baseUrl = `http://127.0.0.1:${address.port}`;
  }

  it("generates questions and a schedule from a research result", async () => {
    const generateJson = createGenerator();
    await startServer(generateJson);

    const response = await fetch(`${baseUrl}/api/kits/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        role,
        companyResearch,
        daysAvailable: 3
      })
    });

    const body = await response.json() as {
      success: boolean;
      questions: Array<{ id: string; requirement_ids: string[] }>;
      flashcards: Array<{ id: string; requirement_ids: string[]; front: string; back: string }>;
      schedule: { days_available: number; days: Array<{ question_ids: string[] }> };
      coverage: { uncovered_requirement_ids: string[]; passes: number };
    };

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.questions).toHaveLength(2);
    expect(body.flashcards).toHaveLength(2);
    expect(body.flashcards.map(card => card.id)).toEqual(["f1", "f2"]);
    expect(body.flashcards.map(card => card.requirement_ids)).toEqual([["r1"], ["r2"]]);
    expect(body.schedule.days_available).toBe(3);
    expect(body.schedule.days).toHaveLength(3);
    expect(body.schedule.days.flatMap(day => day.question_ids).sort())
      .toEqual(["q1", "q2"]);
    expect(body.coverage.uncovered_requirement_ids).toEqual([]);
    expect(body.coverage.passes).toBe(1);
    expect(generateJson).toHaveBeenCalledTimes(5);
  });

  it("rejects an invalid day count before calling the LLM", async () => {
    const generateJson = createGenerator();
    await startServer(generateJson);

    const response = await fetch(`${baseUrl}/api/kits/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        role,
        companyResearch,
        daysAvailable: 0
      })
    });

    expect(response.status).toBe(400);
    expect(generateJson).not.toHaveBeenCalled();
  });

  it("rejects malformed research input", async () => {
    const generateJson = createGenerator();
    await startServer(generateJson);

    const response = await fetch(`${baseUrl}/api/kits/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        role,
        companyResearch: { company_brief: {} },
        daysAvailable: 5
      })
    });

    expect(response.status).toBe(400);
    expect(generateJson).not.toHaveBeenCalled();
  });

  it("returns a generation error when must-have coverage cannot be achieved", async () => {
    const generateJson = vi.fn(async () => ({ questions: [] })) as JsonGenerator;
    await startServer(generateJson);

    const response = await fetch(`${baseUrl}/api/kits/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        role,
        companyResearch,
        daysAvailable: 5
      })
    });

    const body = await response.json() as { error: string };
    expect(response.status).toBe(502);
    expect(body.error).toBe("GENERATION_FAILED");
    expect(generateJson).toHaveBeenCalledTimes(8);
  });

  it("rejects a role title that differs from the research role", async () => {
    const generateJson = createGenerator();
    await startServer(generateJson);

    const response = await fetch(`${baseUrl}/api/kits/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        role: { ...role, title: "Frontend Engineer" },
        companyResearch,
        daysAvailable: 5
      })
    });

    expect(response.status).toBe(400);
    expect(generateJson).not.toHaveBeenCalled();
  });
});
