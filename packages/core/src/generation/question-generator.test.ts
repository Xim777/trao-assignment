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
      if (systemPrompt.includes("REQUESTED_CATEGORY: technical")) {
        return {
          questions: [
            createQuestion("r1", "Explain TypeScript generics."),
            createQuestion("r2", "Explain database indexing.")
          ]
        };
      }

      if (systemPrompt.includes("REQUESTED_CATEGORY: behavioural")) {
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
    expect(result.questions).toHaveLength(3);
    // All requirements were covered during the first pass.
    expect(result.passes).toBe(1);
    expect(result.questions.map(question => question.id)).toEqual([
      "q1",
      "q2",
      "q3"
    ]);
  });

  it("runs a second pass for uncovered requirements", async () => {
    const generateJson = vi.fn(async ({ systemPrompt, userPrompt }) => {
      const input = JSON.parse(userPrompt);
      const targetIds = input.requirements.map(
        (requirement: Requirement) => requirement.id
      );

      if (
        systemPrompt.includes("REQUESTED_CATEGORY: technical") &&
        targetIds.length === 3 &&
        targetIds.includes("r1")
      ) {
        return {
          questions: [
            createQuestion("r1", "Explain TypeScript generics.")
          ]
        };
      }

      if (
        systemPrompt.includes("REQUESTED_CATEGORY: technical") &&
        targetIds.length === 2 &&
        targetIds.includes("r2")
      ) {
        return {
          questions: [
            createQuestion("r2", "Explain database indexing.")
          ]
        };
      }

      // The initial pass omits the behavioural question; the second pass
      // receives only the still-uncovered requirements.
      if (
        systemPrompt.includes("REQUESTED_CATEGORY: behavioural") &&
        targetIds.length === 2 &&
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

    expect(result.passes).toBe(2);
    expect(generateJson).toHaveBeenCalledTimes(8);
    expect(result.questions).toHaveLength(3);
    expect(result.uncoveredRequirementIds).toEqual([]);
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
      if (systemPrompt.includes("REQUESTED_CATEGORY: technical")) {
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

  it("merges requirement coverage for duplicate questions and assigns stable IDs", async () => {
    const generateJson = vi.fn(async ({ systemPrompt, userPrompt }) => {
      const input = JSON.parse(userPrompt);
      const targetIds = input.requirements.map(
        (requirement: Requirement) => requirement.id
      );

      if (systemPrompt.includes("REQUESTED_CATEGORY: technical")) {
        return {
          questions: [
            createQuestion("r1", "Explain TypeScript generics."),
            createQuestion("r2", "  EXPLAIN   TypeScript generics.  ")
          ]
        };
      }

      if (
        systemPrompt.includes("REQUESTED_CATEGORY: behavioural") &&
        targetIds.length === 1 &&
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

    expect(result.passes).toBe(2);
    expect(result.questions).toHaveLength(2);
    expect(result.questions.map(question => question.id)).toEqual([
      "q1",
      "q2"
    ]);
    expect(result.questions[0]?.requirement_ids).toEqual(["r1", "r2"]);
  });


  it("merges near-duplicate prompts within the same category", async () => {
    const generateJson = vi.fn(async ({ systemPrompt }) => {
      if (systemPrompt.includes("REQUESTED_CATEGORY: technical")) {
        return {
          questions: [
            createQuestion("r1", "How would you design and implement reliable TypeScript validation for incoming API request payloads?"),
            createQuestion("r2", "How would you implement and design reliable TypeScript validation for incoming API request payloads?")
          ]
        };
      }

      if (systemPrompt.includes("REQUESTED_CATEGORY: behavioural")) {
        return {
          questions: [
            createQuestion("r3", "Tell me about a time you communicated a difficult decision.")
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
    expect(result.questions[0]?.requirement_ids).toEqual(["r1", "r2"]);
  });

  it("includes specific guidance for behavioural and company-fit categories", async () => {
    const generateJson = vi.fn(async () => ({ questions: [] }));

    await expect(
      generateQuestionBank({
        roleTitle: "Backend Engineer",
        requirements,
        companyBrief,
        generateJson: createGenerator(generateJson)
      })
    ).rejects.toThrow(/Unable to generate questions/);

    const calls = generateJson.mock.calls;
    const behaviouralCall = calls.find(([args]) =>
      args.systemPrompt.includes("REQUESTED_CATEGORY: behavioural")
    );
    const companyFitCall = calls.find(([args]) =>
      args.systemPrompt.includes("REQUESTED_CATEGORY: company-fit")
    );

    expect(behaviouralCall?.[0].systemPrompt).toContain("specific real past experience");
    expect(behaviouralCall?.[0].userPrompt).toContain("candidate's actions and outcome");
    expect(companyFitCall?.[0].systemPrompt).toContain("supplied company brief");
    expect(companyFitCall?.[0].userPrompt).toContain(companyBrief.what_they_do);
  });

  it("rejects empty role titles and returns a thin result for missing requirements", async () => {
    const generateJson = vi.fn();

    await expect(
      generateQuestionBank({
        roleTitle: " ",
        requirements,
        companyBrief,
        generateJson: createGenerator(generateJson)
      })
    ).rejects.toThrow(/Role title cannot be empty/);

    const thinResult = await generateQuestionBank({
      roleTitle: "Backend Engineer",
      requirements: [],
      companyBrief,
      generateJson: createGenerator(generateJson)
    });

    expect(thinResult).toEqual({
      questions: [],
      passes: 1,
      uncoveredRequirementIds: []
    });
    expect(generateJson).not.toHaveBeenCalled();
  });
});
