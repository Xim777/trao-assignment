
import { describe, expect, it, vi } from "vitest";

import {
  generateCompanyBrief
} from "./company-brief.js";

import type {
  CompanyCrawlResult
} from "./website-crawler.js";

import type {
  DiscussionSearchReport
} from "./discussion-search.js";

const researchInput = {
  company: "Example Technologies",
  company_url: "https://example.com",
  role: "Backend Software Engineer",
  location: "Bangalore",
  jd_chars: 2000
};

const officialPage = {
  url: "https://example.com/about",
  title: "About Example Technologies",
  description: "Example Technologies builds cloud software.",
  text: "Example Technologies develops cloud infrastructure products.",
  links: []
};

const officialSource = {
  title: "About Example Technologies",
  url: "https://example.com/about",
  category: "company_info" as const,
  text: "Example Technologies builds cloud software."
};

const discussion = {
  title: "Example Technologies Interview Experience",
  url: "https://www.reddit.com/r/cscareerquestions/example",
  domain: "reddit.com",
  snippet: "A candidate describes a backend interview.",
  sourceType: "reddit" as const,
  provider: "Tavily",
  matchedQueries: ["Example Technologies interview"]
};

const crawl = {
  websiteUrl: "https://example.com/",
  status: "completed",
  policy: { status: "allowed" },
  pages: [officialPage],
  pagesUsed: ["https://example.com/about"],
  pageRecords: [
    {
      url: "https://example.com/about",
      status: "fetched"
    }
  ],
  discoveredLinks: [
    {
      ...officialSource,
      score: 10,
      reasons: ["company information"]
    }
  ]
} as unknown as CompanyCrawlResult;

const discussions = {
  company: "Example Technologies",
  role: "Backend Software Engineer",
  searchedAt: "2026-11-15T10:00:00.000Z",
  status: "completed",
  queries: ["Example Technologies interview"],
  results: [discussion],
  failures: []
} as DiscussionSearchReport;

const validGeneratedBrief = {
  summary: "Example Technologies develops cloud software.",
  what_they_do:
    "The company builds cloud infrastructure products for businesses.",
  sources: [
    {
      title: officialSource.title,
      url: officialSource.url,
      source_type: "official",
      description: "Official company overview."
    },
    {
      title: discussion.title,
      url: discussion.url,
      source_type: "discussion",
      description: "Candidate-reported interview experience."
    }
  ]
};

describe("generateCompanyBrief", () => {
  it("generates a valid company brief using collected evidence", async () => {
    const generateJson = vi.fn().mockResolvedValue(
      validGeneratedBrief
    );

    const result = await generateCompanyBrief(
      { researchInput, crawl, discussions },
      generateJson
    );

    expect(result.company_brief.summary).toBe(
      validGeneratedBrief.summary
    );

    expect(result.company_brief.sources).toHaveLength(2);
    expect(result.research.official_sources).toHaveLength(1);
    expect(result.research.discussion_sources).toHaveLength(1);

    expect(generateJson).toHaveBeenCalledOnce();
  });

  it("passes official and discussion evidence to the generator", async () => {
    const generateJson = vi.fn().mockResolvedValue(
      validGeneratedBrief
    );

    await generateCompanyBrief(
      { researchInput, crawl, discussions },
      generateJson
    );

    const prompt = generateJson.mock.calls[0][0].userPrompt;

    expect(prompt).toContain("Example Technologies");
    expect(prompt).toContain("https://example.com/about");
    expect(prompt).toContain(discussion.url);
  });

  it("rejects a citation URL that was never collected", async () => {
    const generateJson = vi.fn().mockResolvedValue({
      ...validGeneratedBrief,
      sources: [
        {
          title: "Unknown page",
          url: "https://unknown.example/article",
          source_type: "official"
        }
      ]
    });

    await expect(
      generateCompanyBrief(
        { researchInput, crawl, discussions },
        generateJson
      )
    ).rejects.toThrow("uncollected official source");
  });

  it("rejects a citation with a mismatched title", async () => {
    const generateJson = vi.fn().mockResolvedValue({
      ...validGeneratedBrief,
      sources: [
        {
          title: "Incorrect title",
          url: officialSource.url,
          source_type: "official"
        }
      ]
    });

    await expect(
      generateCompanyBrief(
        { researchInput, crawl, discussions },
        generateJson
      )
    ).rejects.toThrow("title does not match");
  });

  it("does not call the LLM when no official pages were collected", async () => {
    const generateJson = vi.fn();

    const emptyCrawl = {
      ...crawl,
      pages: [],
      pagesUsed: [],
      pageRecords: [],
      discoveredLinks: [],
      status: "manual_review"
    } as unknown as CompanyCrawlResult;

    const result = await generateCompanyBrief(
      {
        researchInput,
        crawl: emptyCrawl,
        discussions
      },
      generateJson
    );

    expect(generateJson).not.toHaveBeenCalled();

    expect(result.company_brief.summary).toContain(
      "could not be retrieved"
    );

    expect(result.research.limitations).toContain(
      "No usable official company pages were collected. Company details cannot be independently verified."
    );
  });

  it("records failed crawler pages", async () => {
    const generateJson = vi.fn().mockResolvedValue(
      validGeneratedBrief
    );

    const partialCrawl = {
      ...crawl,
      status: "partial",
      pageRecords: [
        ...crawl.pageRecords,
        {
          url: "https://example.com/careers",
          status: "failed",
          error: "HTTP 503"
        }
      ]
    } as unknown as CompanyCrawlResult;

    const result = await generateCompanyBrief(
      {
        researchInput,
        crawl: partialCrawl,
        discussions
      },
      generateJson
    );

    expect(result.research.failures).toHaveLength(1);
    expect(result.research.failures[0].stage).toBe(
      "website_crawl"
    );
  });

  it("records discussion search failures", async () => {
    const generateJson = vi.fn().mockResolvedValue(
      validGeneratedBrief
    );

    const partialDiscussions = {
      ...discussions,
      status: "partial",
      failures: [
        {
          query: "Example Technologies interview",
          error: "Search provider unavailable"
        }
      ]
    };

    const result = await generateCompanyBrief(
      {
        researchInput,
        crawl,
        discussions: partialDiscussions
      },
      generateJson
    );

    expect(result.research.failures).toHaveLength(1);
    expect(result.research.failures[0].stage).toBe(
      "discussion_search"
    );
  });

  it("rejects invalid generated brief structure", async () => {
    const generateJson = vi.fn().mockResolvedValue({
      summary: "",
      what_they_do: "",
      sources: []
    });

    await expect(
      generateCompanyBrief(
        { researchInput, crawl, discussions },
        generateJson
      )
    ).rejects.toThrow("failed validation");
  });

  it("deduplicates repeated collected pages", async () => {
    const generateJson = vi.fn().mockResolvedValue(
      validGeneratedBrief
    );

    const duplicateCrawl = {
      ...crawl,
      pages: [officialPage, officialPage]
    } as unknown as CompanyCrawlResult;

    const result = await generateCompanyBrief(
      {
        researchInput,
        crawl: duplicateCrawl,
        discussions
      },
      generateJson
    );

    expect(result.research.official_sources).toHaveLength(1);
  });
});
