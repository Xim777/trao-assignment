import { describe, expect, it, vi } from "vitest";
import { extractJobDescription } from "./jd-extractor.js";

describe("extractJobDescription", () => {
  it("extracts role information and assigns requirement IDs", async () => {
    const generateJson = vi.fn(async () => ({
      title: "Backend Engineer",
      seniority: "Entry Level",
      responsibilities: [
        "Develop backend APIs",
        "Work with databases",
        "Develop backend APIs"
      ],
      requirements: [
        {
          text: "Experience with Node.js",
          kind: "technical",
          priority: "must"
        },
        {
          text: "Good communication skills",
          kind: "behavioural",
          priority: "nice"
        }
      ]
    }));

    const result = await extractJobDescription(
      "Backend Engineer job description",
      generateJson
    );

    expect(result.title).toBe("Backend Engineer");
    expect(result.requirements).toHaveLength(2);
    expect(result.requirements[0].id).toBe("r1");
    expect(result.requirements[1].id).toBe("r2");
    expect(result.responsibilities).toHaveLength(2);
  });

  it("rejects an empty job description", async () => {
    const generateJson = vi.fn();

    await expect(
      extractJobDescription("   ", generateJson)
    ).rejects.toThrow("Job description cannot be empty.");

    expect(generateJson).not.toHaveBeenCalled();
  });

  it("rejects invalid generated output", async () => {
    const generateJson = vi.fn(async () => ({
      title: "Backend Engineer",
      seniority: "Entry Level",
      responsibilities: [],
      requirements: [
        {
          text: "Node.js",
          kind: "invalid-kind",
          priority: "must"
        }
      ]
    }));

    await expect(
      extractJobDescription("Backend Engineer JD", generateJson)
    ).rejects.toThrow();
  });
});
