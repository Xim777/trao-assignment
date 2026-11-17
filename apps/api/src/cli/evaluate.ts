import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import {
  createResearchServiceDependencies,
  runResearchPipeline,
  generateInterviewKit
} from "@prepkit/core";
import { generateWithGemini } from "../services/llm/gemini-provider.js";
import { createTavilySearchProvider } from "../services/search/tavily-provider.js";
import {
  BatchInputSchema,
  evaluateBatchCases
} from "../services/batch-evaluator.js";

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

async function main(): Promise<void> {
  const { input, output } = parseArguments(process.argv.slice(2));
  const inputText = await readFile(input, "utf8");
  const cases = BatchInputSchema.parse(JSON.parse(inputText));

  const dependencies = createResearchServiceDependencies(
    generateWithGemini,
    createTavilySearchProvider()
  );

  const results = await evaluateBatchCases(cases, async batchCase => {
    const research = await runResearchPipeline({
      company: companyNameFromUrl(batchCase.company_url),
      company_url: batchCase.company_url,
      jd: batchCase.jd
    }, dependencies);

    return generateInterviewKit({
      role: research.role,
      companyResearch: research.companyResearch,
      daysAvailable: batchCase.days,
      generateJson: generateWithGemini
    });
  }, (completed, total, result) => {
    process.stdout.write(
      `[${completed}/${total}] ${result.id}: ${result.status}\n`
    );
  });

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
