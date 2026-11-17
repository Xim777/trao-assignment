import { describe, expect, it, vi } from "vitest";
import { generateFlashcards } from "./flashcard-generator.js";
import type { JsonGenerator } from "../extraction/jd-extractor.js";
import type { InterviewKit } from "../schemas/interview-kit.js";

type Requirement = InterviewKit["role"]["requirements"][number];
type Question = InterviewKit["questions"][number];

const requirements: Requirement[] = [
  {
    id: "r1",
    text: "Experience with TypeScript",
    kind: "technical",
    priority: "must"
  },
  {
    id: "r2",
    text: "Experience with databases",
    kind: "technical",
    priority: "nice"
  },
  {
    id: "r3",
    text: "Strong communication skills",
    kind: "behavioural",
    priority: "must"
  }
];

const questions: Question[] = [
  {
    id: "q1",
    requirement_ids: ["r1"],
    category: "technical",
    prompt: "How do you use TypeScript to make API contracts safer?",
    answer_outline: "Discuss types, validation, and runtime boundaries.",
    difficulty: 2
  },
  {
    id: "q2",
    requirement_ids: ["r3"],
    category: "behavioural",
    prompt: "Tell me about a time you resolved a disagreement.",
    answer_outline: "Explain context, actions, and outcome.",
    difficulty: 2
  }
];

const companyBrief = {
  summary: "A software company building cloud products.",
  what_they_do: "Develops cloud-based business software."
};

function createGenerator(implementation: Parameters<typeof vi.fn>[0]): JsonGenerator {
  return implementation as JsonGenerator;
}

describe("generateFlashcards", () => {
  it("generates locally identified cards with must-have coverage", async () => {
    const generateJson = vi.fn(async () => ({
      flashcards: [
        {
          requirement_ids: ["r1"],
          front: "What problem do TypeScript types solve?",
          back: "They make data contracts explicit and catch many errors during development."
        },
        {
          requirement_ids: ["r3"],
          front: "What should a strong conflict-resolution example include?",
          back: "Context, your specific actions, the result, and what you learned."
        }
      ]
    }));

    const result = await generateFlashcards({
      roleTitle: "Backend Engineer",
      requirements,
      questions,
      companyBrief,
      generateJson: createGenerator(generateJson)
    });

    expect(generateJson).toHaveBeenCalledTimes(1);
    expect(result.flashcards).toHaveLength(2);
    expect(result.flashcards.map(card => card.id)).toEqual(["f1", "f2"]);
    expect(result.flashcards.map(card => card.requirement_ids)).toEqual([["r1"], ["r3"]]);
  });

  it("merges duplicate cards and preserves requirement coverage", async () => {
    const generateJson = vi.fn(async () => ({
      flashcards: [
        {
          requirement_ids: ["r1"],
          front: "What problem do TypeScript types solve?",
          back: "They make data contracts explicit."
        },
        {
          requirement_ids: ["r2"],
          front: "  WHAT problem do TypeScript types solve? ",
          back: "They make data contracts explicit."
        },
        {
          requirement_ids: ["r3"],
          front: "How do you demonstrate good communication?",
          back: "Give a specific example and explain the outcome."
        }
      ]
    }));

    const result = await generateFlashcards({
      roleTitle: "Backend Engineer",
      requirements,
      questions,
      companyBrief,
      generateJson: createGenerator(generateJson)
    });

    expect(result.flashcards).toHaveLength(2);
    expect(result.flashcards[0]?.requirement_ids).toEqual(["r1", "r2"]);
  });

  it("rejects unknown requirement references and fails uncovered must-have requirements", async () => {
    const generateJson = vi.fn(async () => ({
      flashcards: [
        {
          requirement_ids: ["not-a-real-id"],
          front: "What is this?",
          back: "Not grounded in the role."
        }
      ]
    }));

    await expect(generateFlashcards({
      roleTitle: "Backend Engineer",
      requirements,
      questions,
      companyBrief,
      generateJson: createGenerator(generateJson)
    })).rejects.toThrow(/Unable to generate flashcards for must-have requirements/);
  });

  it("rejects malformed model output", async () => {
    const generateJson = vi.fn(async () => ({
      flashcards: [{ requirement_ids: ["r1"], front: "Question only" }]
    }));

    await expect(generateFlashcards({
      roleTitle: "Backend Engineer",
      requirements,
      questions,
      companyBrief,
      generateJson: createGenerator(generateJson)
    })).rejects.toThrow();
  });

  it("rejects empty titles and missing requirements before calling the model", async () => {
    const generateJson = vi.fn();

    await expect(generateFlashcards({
      roleTitle: " ",
      requirements,
      questions,
      companyBrief,
      generateJson: createGenerator(generateJson)
    })).rejects.toThrow(/Role title cannot be empty/);

    await expect(generateFlashcards({
      roleTitle: "Backend Engineer",
      requirements: [],
      questions,
      companyBrief,
      generateJson: createGenerator(generateJson)
    })).rejects.toThrow(/At least one role requirement/);

    expect(generateJson).not.toHaveBeenCalled();
  });
});
