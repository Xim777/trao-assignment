import { z } from "zod";

export const BatchCaseSchema = z.object({
  id: z.string().trim().min(1),
  jd: z.string().trim().min(1).max(50000),
  company_url: z.string().url(),
  days: z.number().int().min(1).max(60)
}).strict();

export const BatchInputSchema = z.array(z.unknown()).min(1);

export type BatchCase = z.infer<typeof BatchCaseSchema>;

export type BatchResult<TKit> =
  | { id: string; status: "ok"; kit: TKit; error: null }
  | { id: string; status: "failed"; kit: null; error: { code: string; message: string } };

function fallbackId(index: number): string {
  return `case-${String(index + 1).padStart(2, "0")}`;
}

function getCandidateId(value: unknown, index: number): string {
  if (
    typeof value === "object" && value !== null &&
    "id" in value && typeof value.id === "string" && value.id.trim()
  ) {
    return value.id.trim();
  }
  return fallbackId(index);
}

function getFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/company website research failed|website returned HTTP|unable to resolve|timed out/i.test(message)) {
    return "COMPANY_UNREACHABLE";
  }
  if (/invalid|must be|is required/i.test(message)) {
    return "INVALID_CASE";
  }
  return "PIPELINE_FAILED";
}

/**
 * Runs cases sequentially and records failures independently so one bad case
 * never prevents later cases from being evaluated.
 */
export async function evaluateBatchCases<TKit>(
  rawCases: unknown[],
  evaluateCase: (input: BatchCase) => Promise<TKit>,
  onProgress?: (completed: number, total: number, result: BatchResult<TKit>) => void
): Promise<BatchResult<TKit>[]> {
  const results: BatchResult<TKit>[] = [];

  for (let index = 0; index < rawCases.length; index++) {
    const candidateId = getCandidateId(rawCases[index], index);
    let result: BatchResult<TKit>;

    try {
      const input = BatchCaseSchema.parse(rawCases[index]);
      const kit = await evaluateCase(input);
      result = {
        id: input.id,
        status: "ok",
        kit,
        error: null
      };
    } catch (error) {
      result = {
        id: candidateId,
        status: "failed",
        kit: null,
        error: {
          code: getFailureCode(error),
          message: error instanceof Error
            ? error.message.slice(0, 500)
            : "Unknown case failure."
        }
      };
    }

    results.push(result);
    onProgress?.(index + 1, rawCases.length, result);
  }

  return results;
}
