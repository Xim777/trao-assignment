import { describe, expect, it, vi } from "vitest";

import {
  runResearchPipeline,
  type ResearchServiceDependencies
} from "./research-service.js";

import type { CompanyCrawlResult } from "./website-crawler.js";
import type { DiscussionSearchReport } from "./discussion-search.js";

const input = {
  company: "Example Corp",
  company_url: "https://example.com",
  jd: "We are hiring a Backend Engineer with Node.js and PostgreSQL experience.",
  location: "Remote"
};

const extractedRole = {
  title: "Backend Engineer",
  seniority: "Mid-level",
  responsibilities: [
    "Build backend APIs"
  ],
  requirements: [
    {
      text: "Node.js experience",
      kind: "technical" as const,
      priority: "must" as const
    },
    {
      text: "PostgreSQL experience",
      kind: "technical" as const,
      priority: "must" as const
    }
  ]
};
function createDependencies(
  overrides: Partial<ResearchServiceDependencies> = {}
): ResearchServiceDependencies {
  const crawl = {
    websiteUrl: "https://example.com/",
    status: "manual_review",
    policy: {},
    pages: [],
    pagesUsed: [],
    pageRecords: [],
    discoveredLinks: []
  } as unknown as CompanyCrawlResult;

  const discussions: DiscussionSearchReport = {
    company: "Example Corp",
    role: "Backend Engineer",
    searchedAt: new Date().toISOString(),
    status: "completed",
    queries: [],
    results: [],
    failures: []
  };

  return {
    generateJson: vi.fn().mockResolvedValue(extractedRole),
    searchProvider: {
      name: "test-provider",
      search: vi.fn().mockResolvedValue([])
    },
    crawlWebsite: vi.fn().mockResolvedValue(crawl),
    searchDiscussions: vi.fn().mockResolvedValue(discussions),
    ...overrides
  };
}

describe("runResearchPipeline", () => {
  it("extracts the role before starting company research", async () => {
    const dependencies = createDependencies();

    const result = await runResearchPipeline(
      input,
      dependencies
    );

    expect(result.role.title).toBe("Backend Engineer");

    expect(dependencies.crawlWebsite).toHaveBeenCalledWith(
      input.company_url,
      {
        role: "Backend Engineer",
        requirements: [
          "Node.js experience",
          "PostgreSQL experience"
        ]
      }
    );

    expect(dependencies.searchDiscussions).toHaveBeenCalledWith(
      {
        company: "Example Corp",
        role: "Backend Engineer",
        requirements: [
          "Node.js experience",
          "PostgreSQL experience"
        ]
      },
      dependencies.searchProvider
    );

    expect(result.companyResearch.source.company).toBe(
      "Example Corp"
    );

    expect(result.companyResearch.source.role).toBe(
      "Backend Engineer"
    );
  });

  it("preserves company research when discussion search fails", async () => {
    const dependencies = createDependencies({
      searchDiscussions: vi.fn().mockRejectedValue(
        new Error("Tavily unavailable")
      )
    });

    const result = await runResearchPipeline(
      input,
      dependencies
    );

    expect(result.companyResearch.research.discussion_status)
      .toBe("unavailable");

    expect(
      result.companyResearch.research.failures.some(
        failure => failure.stage === "discussion_search"
      )
    ).toBe(true);
  });

  it("fails clearly when the crawler itself fails", async () => {
    const dependencies = createDependencies({
      crawlWebsite: vi.fn().mockRejectedValue(
        new Error("Website unavailable")
      )
    });

    await expect(
      runResearchPipeline(input, dependencies)
    ).rejects.toThrow("Company website research failed");
  });

  it("rejects invalid input before calling dependencies", async () => {
    const dependencies = createDependencies();

    await expect(
      runResearchPipeline(
        { ...input, company_url: "javascript:alert(1)" },
        dependencies
      )
    ).rejects.toThrow();

    expect(dependencies.generateJson).not.toHaveBeenCalled();
    expect(dependencies.crawlWebsite).not.toHaveBeenCalled();
  });
});

