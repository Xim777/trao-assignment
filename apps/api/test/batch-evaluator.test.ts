import { describe, expect, it, vi } from "vitest";
import {
  BatchInputSchema,
  evaluateBatchCases
} from "../src/services/batch-evaluator.js";

describe("batch evaluator", () => {
  it("validates the Appendix B input fields", () => {
    expect(BatchInputSchema.parse([
      {
        id: "case-01",
        jd: "Backend engineer role",
        company_url: "http://localhost:8099/acme/",
        days: 5
      }
    ])).toHaveLength(1);

    expect(() => BatchInputSchema.parse({ id: "case-01" })).toThrow();
  });

  it("continues after a failed case and preserves one result per input", async () => {
    const evaluateCase = vi.fn(async (input: { id: string }) => {
      if (input.id === "case-02") {
        throw new Error("Company website research failed: HTTP 404");
      }
      return { role: input.id };
    });
    const progress = vi.fn();

    const results = await evaluateBatchCases([
      {
        id: "case-01",
        jd: "First role",
        company_url: "https://one.example",
        days: 2
      },
      {
        id: "case-02",
        jd: "Second role",
        company_url: "https://two.example",
        days: 3
      },
      {
        id: "case-03",
        jd: "Third role",
        company_url: "https://three.example",
        days: 4
      }
    ], evaluateCase, progress);

    expect(evaluateCase).toHaveBeenCalledTimes(3);
    expect(results).toEqual([
      { id: "case-01", status: "ok", kit: { role: "case-01" }, error: null },
      {
        id: "case-02",
        status: "failed",
        kit: null,
        error: {
          code: "COMPANY_UNREACHABLE",
          message: "Company website research failed: HTTP 404"
        }
      },
      { id: "case-03", status: "ok", kit: { role: "case-03" }, error: null }
    ]);
    expect(progress).toHaveBeenCalledTimes(3);
  });

  it("records malformed individual cases instead of aborting the batch", async () => {
    const evaluateCase = vi.fn(async () => ({ ok: true }));
    const results = await evaluateBatchCases([
      { id: "bad-case", jd: "", company_url: "not-a-url", days: 0 },
      {
        id: "good-case",
        jd: "A real job description",
        company_url: "https://example.com",
        days: 1
      }
    ], evaluateCase);

    expect(results[0]).toMatchObject({
      id: "bad-case",
      status: "failed",
      kit: null,
      error: { code: "INVALID_CASE" }
    });
    expect(results[1]).toMatchObject({
      id: "good-case",
      status: "ok",
      kit: { ok: true }
    });
    expect(evaluateCase).toHaveBeenCalledTimes(1);
  });
});
