import { describe, it, expect } from "vitest";

import { InterviewKitSchema } from "./interview-kit.js";

const validKit = {
  source: {
    company: "Acme Technologies",
    company_url: "https://example.com",
    role: "Backend Engineer",
    location: "India",
    jd_chars: 1500,
    researched_at: "2026-11-13T10:00:00Z",
    pages_used: ["https://example.com"]
  },
  company_brief: {
    summary: "A technology company.",
    what_they_do: "Develop software products.",
    sources: ["https://example.com"]
  },
  role: {
    title: "Backend Engineer",
    seniority: "Mid-level",
    responsibilities: ["Develop backend APIs"],
    requirements: [{
      id: "r1",
      text: "Experience with Node.js",
      kind: "technical",
      priority: "must"
    }]
  },
  questions: [{
    id: "q1",
    requirement_ids: ["r1"],
    category: "technical",
    prompt: "Explain the Node.js event loop.",
    answer_outline: "Discuss event loop phases.",
    difficulty: 2
  }],
  flashcards: [{
    id: "f1",
    front: "What is the Node.js event loop?",
    back: "The mechanism that handles asynchronous operations.",
    requirement_ids: ["r1"]
  }],
  schedule: {
    days_available: 1,
    days: [{
      day: 1,
      focus: "Node.js fundamentals",
      question_ids: ["q1"],
      minutes: 60
    }]
  },
  coverage: {
    uncovered_requirement_ids: [],
    passes: 1
  }
};

describe("InterviewKitSchema", () => {
  it("accepts a valid interview kit", () => {
    expect(InterviewKitSchema.safeParse(validKit).success).toBe(true);
  });

  it("rejects an uncovered must-have requirement", () => {
    const invalidKit = structuredClone(validKit);
    invalidKit.questions = [];
    invalidKit.schedule.days[0].question_ids = [];
    invalidKit.coverage.uncovered_requirement_ids = ["r1"];
    expect(InterviewKitSchema.safeParse(invalidKit).success).toBe(false);
  });

  it("rejects an invalid question difficulty", () => {
    const invalidKit = structuredClone(validKit);
    invalidKit.questions[0].difficulty = 5;
    expect(InterviewKitSchema.safeParse(invalidKit).success).toBe(false);
  });

  it("rejects a question omitted from the schedule", () => {
    const invalidKit = structuredClone(validKit);
    invalidKit.schedule.days[0].question_ids = [];
    expect(InterviewKitSchema.safeParse(invalidKit).success).toBe(false);
  });

  it("rejects a question scheduled more than once", () => {
    const invalidKit = structuredClone(validKit);
    invalidKit.schedule.days_available = 2;
    invalidKit.schedule.days.push({
      day: 2,
      focus: "Revision",
      question_ids: ["q1"],
      minutes: 30
    });
    expect(InterviewKitSchema.safeParse(invalidKit).success).toBe(false);
  });
});
