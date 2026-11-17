import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { z } from "zod";
import {
  createResearchServiceDependencies,
  runResearchPipeline,
  generateInterviewKit
} from "@prepkit/core";
import { generateWithGemini } from "../services/llm/gemini-provider.js";
import { createTavilySearchProvider } from "../services/search/tavily-provider.js";

const BatchCaseSchema = z.object({
  id: z.string().trim().min(1),
  jd: z.string().trim().min(1).max(50000),
  company_url: z.string().url(),
  days: z.number().int().min(1).max(60)
}).strict();

const BatchInputSchema = z.array(z.unknown()).min(1);

type BatchResult =
  | { id: string; status: "ok"; kit: Awaited<ReturnType<typeof generateInterviewKit>>; error: null }
  | { id: string; status: "failed"; kit: null; error: { code: string; message: string } };

function parseArguments(args: string[]): { input: string; output: string } {
  let input: string | undefined;
  let output: string | undefined;

  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--input") input = args[++index];
    else if (argument === "--output") output = args[++index];
    else throw new Error(`Unknown or incomplete argument: ${argument}`);
  }

  if (!input || !output) {
    throw new Error(
      "Usage: npm run evaluate -- --input <cases.json> --output <kits.json>"
    );
  }

  return { input: resolve(input), output: resolve(output) };
}

function companyNameFromUrl(value: string): string {
  const hostname = new URL(value).hostname;
  return hostname.replace(/^www\./i, "") || hostname;
}

function failureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/company website research failed|website returned HTTP|unable to resolve|timed out/i.test(message)) {
    return "COMPANY_UNREACHABLE";
  }
  if (/invalid|must be|is required/i.test(message)) {
    return "INVALID_CASE";
  }
  return "PIPELINE_FAILED";
}

async function runCase(
  rawCase: unknown,
  index: number,
  dependencies: ReturnType<typeof createResearchServiceDependencies>
): Promise<BatchResult> {
  const fallbackId = `case-${String(index + 1).padStart(2, "0")}`;
  const candidateId =
    typeof rawCase === "object" && rawCase !== null &&
    "id" in rawCase && typeof rawCase.id === "string" && rawCase.id.trim()
      ? rawCase.id.trim()
      : fallbackId;

  try {
    const parsed = BatchCaseSchema.parse(rawCase);
    const company = companyNameFromUrl(parsed.company_url);

    const research = await runResearchPipeline({
      company,
      company_url: parsed.company_url,
      jd: parsed.jd
    }, dependencies);

    const kit = await generateInterviewKit({
      role: research.role,
      companyResearch: research.companyResearch,
      daysAvailable: parsed.days,
      generateJson: generateWithGemini
    });

    return {
      id: parsed.id,
      status: "ok",
      kit,
      error: null
    };
  } catch (error) {
    return {
      id: candidateId,
      status: "failed",
      kit: null,
      error: {
        code: failureCode(error),
        message: error instanceof Error ? error.message.slice(0, 500) : "Unknown case failure."
      }
    };
  }
}

async function main(): Promise<void> {
  const { input, output } = parseArguments(process.argv.slice(2));
  const inputText = await readFile(input, "utf8");
  const rawInput: unknown = JSON.parse(inputText);
  const cases = BatchInputSchema.parse(rawInput);

  const dependencies = createResearchServiceDependencies(
    generateWithGemini,
    createTavilySearchProvider()
  );

  const results: BatchResult[] = [];

  // Sequential execution respects provider and per-host rate limits.
  for (let index = 0; index < cases.length; index++) {
    const result = await runCase(cases[index], index, dependencies);
    results.push(result);
    process.stdout.write(
      `[${index + 1}/${cases.length}] ${result.id}: ${result.status}\n`
    );
  }

  const document = {
    version: "1.0",
    generated_at: new Date().toISOString(),
    kits: results
  };

  await writeFile(output, `${JSON.stringify(document, null, 2)}\n`, "utf8");

  const succeeded = results.filter(result => result.status === "ok").length;
  const failed = results.length - succeeded;
  process.stdout.write(
    `Wrote ${results.length} cases (${succeeded} ok, ${failed} failed) to ${basename(output)}\n`
  );
}

main().catch(error => {
  process.stderr.write(
    `Batch evaluation failed: ${error instanceof Error ? error.message : "Unknown error"}\n`
  );
  process.exitCode = 1;
});
