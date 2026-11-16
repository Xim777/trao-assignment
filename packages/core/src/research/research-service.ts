import { z } from "zod";

import {
  extractJobDescription,
  type JsonGenerator
} from "../extraction/jd-extractor.js";

import {
  crawlCompanyWebsite,
  type CompanyCrawlResult,
  type CrawlOptions
} from "./website-crawler.js";

import {
  searchCompanyDiscussions,
  type SearchProvider,
  type DiscussionSearchReport
} from "./discussion-search.js";

import {
  generateCompanyBrief
} from "./company-brief.js";

import {
  CompanyResearchInputSchema,
  type CompanyResearchResult
} from "./company-research-schemas.js";

// --------------------------------------------------
// Input validation
// --------------------------------------------------

export const RunResearchInputSchema = z.object({
  company: z.string().trim().min(1).max(150),
  company_url: z.string().url(),
  jd: z.string().trim().min(1).max(50000),
  location: z.string().trim().max(150).optional()
}).superRefine((input, ctx) => {
  try {
    const url = new URL(input.company_url);

    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["company_url"],
        message: "A valid HTTP or HTTPS company URL is required."
      });
    }
  } catch {
    ctx.addIssue({
      code: "custom",
      path: ["company_url"],
      message: "A valid company URL is required."
    });
  }
});

export type RunResearchInput = z.infer<
  typeof RunResearchInputSchema
>;

// --------------------------------------------------
// Dependencies
// --------------------------------------------------

export interface ResearchServiceDependencies {
  generateJson: JsonGenerator;

  searchProvider: SearchProvider;

  crawlWebsite: (
    url: string,
    options?: CrawlOptions
  ) => Promise<CompanyCrawlResult>;

  searchDiscussions: (
    input: {
      company: string;
      role: string;
      requirements?: string[];
    },
    provider: SearchProvider
  ) => Promise<DiscussionSearchReport>;
}

export interface RunResearchResult {
  role: Awaited<ReturnType<typeof extractJobDescription>>;
  companyResearch: CompanyResearchResult;
}

// --------------------------------------------------
// Helpers
// --------------------------------------------------

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.slice(0, 500);
  }

  return "An unexpected research error occurred.";
}

function createUnavailableDiscussionReport(
  company: string,
  role: string,
  error: unknown
): DiscussionSearchReport {
  return {
    company,
    role,
    searchedAt: new Date().toISOString(),
    status: "unavailable",
    queries: [],
    results: [],
    failures: [{
      query: "Discussion search",
      error: getErrorMessage(error)
    }]
  };
}

// --------------------------------------------------
// Main orchestration service
// --------------------------------------------------

export async function runResearchPipeline(
  rawInput: RunResearchInput,
  dependencies: ResearchServiceDependencies
): Promise<RunResearchResult> {
  const input = RunResearchInputSchema.parse(rawInput);

  // Stage 1: Extract the role and requirements from the JD.
  const role = await extractJobDescription(
    input.jd,
    dependencies.generateJson
  );

  // Stage 2: Run website crawling and discussion search
  // concurrently because both now have the information
  // they need.
  const [crawlResult, discussionResult] = await Promise.allSettled([
    dependencies.crawlWebsite(input.company_url, {
      role: role.title,
      requirements: role.requirements.map(
        requirement => requirement.text
      )
    }),

    dependencies.searchDiscussions(
      {
        company: input.company,
        role: role.title,
        requirements: role.requirements.map(
            requirement => requirement.text
        )
      },
      dependencies.searchProvider
    )
  ]);

  // A top-level crawler failure is different from an
  // individual page failure. The crawler already handles
  // individual page failures and returns partial results.
  if (crawlResult.status === "rejected") {
    throw new Error(
      `Company website research failed: ${getErrorMessage(
        crawlResult.reason
      )}`
    );
  }

  const crawl = crawlResult.value;

  // Search failures should not discard successful website
  // research. Preserve them as an unavailable report.
  const discussions =
    discussionResult.status === "fulfilled"
      ? discussionResult.value
      : createUnavailableDiscussionReport(
          input.company,
          role.title,
          discussionResult.reason
        );

  // Stage 3: Aggregate official and discussion evidence
  // into a company brief.
  const researchInput = CompanyResearchInputSchema.parse({
    company: input.company,
    company_url: input.company_url,
    role: role.title,
    location: input.location ?? "Not specified",
    jd_chars: input.jd.length
  });

  const companyResearch = await generateCompanyBrief(
    {
      researchInput,
      crawl,
      discussions
    },
    dependencies.generateJson
  );

  return {
    role,
    companyResearch
  };
}

// --------------------------------------------------
// Production dependency factory
// --------------------------------------------------

export function createResearchServiceDependencies(
  generateJson: JsonGenerator,
  searchProvider: SearchProvider
): ResearchServiceDependencies {
  return {
    generateJson,
    searchProvider,
    crawlWebsite: (url, options) =>
      crawlCompanyWebsite(url, options),
    searchDiscussions: searchCompanyDiscussions
  };
}
