
import { describe, expect, it, vi } from "vitest";
import {
  generateQuestionBank
} from "./question-generator.js";

import type { JsonGenerator } from "../extraction/jd-extractor.js";
import type { InterviewKit } from "../schemas/interview-kit.js";

type Requirement = InterviewKit["role"]["requirements"][number];

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

const companyBrief = {
  summary: "A software company building cloud products.",
  what_they_do: "Develops cloud-based business software."
};

function createQuestion(
  requirementId: string,
  prompt: string
) {
  return {
    requirement_ids: [requirementId],
    prompt,
    answer_outline: "Explain the concept and give a practical example.",
    difficulty: 2
  };
}

function createGenerator(
  implementation: Parameters<typeof vi.fn>[0]
): JsonGenerator {
  return implementation as JsonGenerator;
}

describe("generateQuestionBank", () => {
  it("generates questions using separate category calls", async () => {
    const generateJson = vi.fn(async ({ systemPrompt }) => {
      if (systemPrompt.includes("technical")) {
        return {
          questions: [
            createQuestion("r1", "Explain TypeScript generics.")
          ]
        };
      }

      if (systemPrompt.includes("behavioural")) {
        return {
          questions: [
            createQuestion("r3", "Describe a team conflict.")
          ]
        };
      }

      return { questions: [] };
    });

    const result = await generateQuestionBank({
      roleTitle: "Backend Engineer",
      requirements,
      companyBrief,
      generateJson: createGenerator(generateJson)
    });

    expect(generateJson).toHaveBeenCalledTimes(4);
    expect(result.questions).toHaveLength(2);
    expect(result.passes).toBe(1);
    expect(result.questions.map(question => question.id)).toEqual([
      "q1",
      "q2"
    ]);
  });

  it("runs a second pass for uncovered must-have requirements", async () => {
    const generateJson = vi.fn(async ({ systemPrompt, userPrompt }) => {
      const input = JSON.parse(userPrompt);

      const targetIds = input.requirements.map(
        (requirement: Requirement) => requirement.id
      );

      if (
        systemPrompt.includes("technical") &&
        targetIds.includes("r1")
      ) {
        return {
          questions: [
            createQuestion("r1", "Explain TypeScript generics.")
          ]
        };
      }

      if (
        systemPrompt.includes("behavioural") &&
        targetIds.includes("r3")
      ) {
        return {
          questions: [
            createQuestion("r3", "Describe a team conflict.")
          ]
        };
      }

      return { questions: [] };
    });

    const result = await generateQuestionBank({
      roleTitle: "Backend Engineer",
      requirements,
      companyBrief,
      generateJson: createGenerator(generateJson)
    });

    expect(result.passes).toBe(1);
    expect(result.questions).toHaveLength(2);
  });

  it("fails when a must-have requirement remains uncovered", async () => {
    const generateJson = vi.fn(async () => ({
      questions: []
    }));

    await expect(
      generateQuestionBank({
        roleTitle: "Backend Engineer",
        requirements,
        companyBrief,
        generateJson: createGenerator(generateJson)
      })
    ).rejects.toThrow(
      /Unable to generate questions for must-have requirements/
    );

    // Four category calls in each of the two passes.
    expect(generateJson).toHaveBeenCalledTimes(8);
  });

  it("rejects invalid LLM output", async () => {
    const generateJson = vi.fn(async () => ({
      questions: [
        {
          requirement_ids: ["r1"],
          prompt: "Explain TypeScript.",
          answer_outline: "Explain types.",
          difficulty: 5
        }
      ]
    }));

    await expect(
      generateQuestionBank({
        roleTitle: "Backend Engineer",
        requirements,
        companyBrief,
        generateJson: createGenerator(generateJson)
      })
    ).rejects.toThrow();
  });

  it("ignores questions containing unknown requirement IDs", async () => {
    const generateJson = vi.fn(async ({ systemPrompt }) => {
      if (systemPrompt.includes("technical")) {
        return {
          questions: [
            createQuestion("unknown-id", "Explain a made-up skill.")
          ]
        };
      }

      return { questions: [] };
    });

    await expect(
      generateQuestionBank({
        roleTitle: "Backend Engineer",
        requirements,
        companyBrief,
        generateJson: createGenerator(generateJson)
      })
    ).rejects.toThrow(/Unable to generate questions/);
  });

  it("removes duplicate questions and assigns stable sequential IDs", async () => {
    const generateJson = vi.fn(async ({ systemPrompt }) => {
      if (systemPrompt.includes("technical")) {
        return {
          questions: [
            createQuestion("r1", "Explain TypeScript generics."),
            createQuestion("r1", "  EXPLAIN   TypeScript generics.  ")
          ]
        };
      }

      if (systemPrompt.includes("behavioural")) {
        return {
          questions: [
            createQuestion("r3", "Describe a team conflict.")
          ]
        };
      }

      return { questions: [] };
    });

    const result = await generateQuestionBank({
      roleTitle: "Backend Engineer",
      requirements,
      companyBrief,
      generateJson: createGenerator(generateJson)
    });

    expect(result.questions).toHaveLength(2);
    expect(result.questions.map(question => question.id)).toEqual([
      "q1",
      "q2"
    ]);
  });

  it("rejects empty role titles and missing requirements", async () => {
    const generateJson = vi.fn();

    await expect(
      generateQuestionBank({
        roleTitle: " ",
        requirements,
        companyBrief,
        generateJson: createGenerator(generateJson)
      })
    ).rejects.toThrow(/Role title cannot be empty/);

    await expect(
      generateQuestionBank({
        roleTitle: "Backend Engineer",
        requirements: [],
        companyBrief,
        generateJson: createGenerator(generateJson)
      })
    ).rejects.toThrow(/At least one role requirement/);

    expect(generateJson).not.toHaveBeenCalled();
  });
});
