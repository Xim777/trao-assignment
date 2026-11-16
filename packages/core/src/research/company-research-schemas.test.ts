
import { describe, expect, it } from "vitest";

import {
  CompanyResearchInputSchema,
  CompanyBriefSchema,
  CompanyResearchResultSchema,
  ResearchMetadataSchema
} from "./company-research-schemas.js";

// --------------------------------------------------
// Reusable valid test data
// --------------------------------------------------

const validInput = {
  company: "Google",
  company_url: "https://www.google.com",
  role: "Backend Software Engineer",
  location: "Bangalore",
  jd_chars: 2500
};

const officialSource = {
  title: "Google Engineering",
  url: "https://engineering.googleblog.com/",
  category: "engineering" as const,
  text: "Engineering articles and technical information."
};

const discussionSource = {
  title: "Google Interview Experience",
  url: "https://www.reddit.com/r/cscareerquestions/example",
  source_type: "reddit" as const,
  snippet: "Discussion about the interview process."
};

const validResearchResult = {
  source: {
    company: "Google",
    company_url: "https://www.google.com",
    role: "Backend Software Engineer",
    location: "Bangalore",
    jd_chars: 2500,
    researched_at: "2026-11-15T10:00:00.000Z",
    pages_used: [
      "https://engineering.googleblog.com/"
    ]
  },

  company_brief: {
    summary: "Google develops technology products and services.",
    what_they_do: "Google works across search, cloud, advertising and other technology areas.",
    sources: [
      {
        title: "Google Engineering",
        url: "https://engineering.googleblog.com/",
        source_type: "official" as const,
        description: "Official engineering publication."
      },
      {
        title: "Google Interview Experience",
        url: "https://www.reddit.com/r/cscareerquestions/example",
        source_type: "discussion" as const,
        description: "Candidate discussion."
      }
    ]
  },

  research: {
    crawl_status: "completed" as const,
    discussion_status: "completed" as const,
    official_sources: [officialSource],
    discussion_sources: [discussionSource],
    failures: [],
    limitations: []
  }
};

// --------------------------------------------------
// Company research input
// --------------------------------------------------

describe("CompanyResearchInputSchema", () => {
  it("accepts valid company research input", () => {
    const result = CompanyResearchInputSchema.safeParse(validInput);

    expect(result.success).toBe(true);
  });

  it("rejects an empty company name", () => {
    const result = CompanyResearchInputSchema.safeParse({
      ...validInput,
      company: " "
    });

    expect(result.success).toBe(false);
  });

  it("rejects invalid company URLs", () => {
    const result = CompanyResearchInputSchema.safeParse({
      ...validInput,
      company_url: "not-a-url"
    });

    expect(result.success).toBe(false);
  });

  it("rejects non-HTTP protocols", () => {
    const result = CompanyResearchInputSchema.safeParse({
      ...validInput,
      company_url: "ftp://example.com"
    });

    expect(result.success).toBe(false);
  });

  it("rejects negative JD character counts", () => {
    const result = CompanyResearchInputSchema.safeParse({
      ...validInput,
      jd_chars: -1
    });

    expect(result.success).toBe(false);
  });

  it("defaults location when it is omitted", () => {
    const result = CompanyResearchInputSchema.safeParse({
      company: "Google",
      company_url: "https://www.google.com",
      role: "Backend Software Engineer",
      jd_chars: 2500
    });

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.location).toBe("Not specified");
    }
  });
});

// --------------------------------------------------
// Company brief
// --------------------------------------------------

describe("CompanyBriefSchema", () => {
  const validBrief = validResearchResult.company_brief;

  it("accepts a valid company brief", () => {
    expect(CompanyBriefSchema.safeParse(validBrief).success).toBe(true);
  });

  it("rejects an empty summary", () => {
    const result = CompanyBriefSchema.safeParse({
      ...validBrief,
      summary: ""
    });

    expect(result.success).toBe(false);
  });

  it("rejects an unsupported source type", () => {
    const result = CompanyBriefSchema.safeParse({
      ...validBrief,
      sources: [
        {
          title: "Example",
          url: "https://example.com",
          source_type: "unknown"
        }
      ]
    });

    expect(result.success).toBe(false);
  });

  it("rejects more than 30 sources", () => {
    const result = CompanyBriefSchema.safeParse({
      ...validBrief,
      sources: Array.from({ length: 31 }, (_, index) => ({
        title: `Source ${index}`,
        url: `https://example.com/${index}`,
        source_type: "official"
      }))
    });

    expect(result.success).toBe(false);
  });
});

// --------------------------------------------------
// Research metadata
// --------------------------------------------------

describe("ResearchMetadataSchema", () => {
  it("accepts valid research metadata", () => {
    expect(
      ResearchMetadataSchema.safeParse(
        validResearchResult.research
      ).success
    ).toBe(true);
  });

  it("rejects an invalid crawl status", () => {
    const result = ResearchMetadataSchema.safeParse({
      ...validResearchResult.research,
      crawl_status: "failed"
    });

    expect(result.success).toBe(false);
  });

  it("rejects an invalid discussion status", () => {
    const result = ResearchMetadataSchema.safeParse({
      ...validResearchResult.research,
      discussion_status: "failed"
    });

    expect(result.success).toBe(false);
  });

  it("rejects malformed source URLs", () => {
    const result = ResearchMetadataSchema.safeParse({
      ...validResearchResult.research,
      official_sources: [
        {
          ...officialSource,
          url: "invalid-url"
        }
      ]
    });

    expect(result.success).toBe(false);
  });
});

// --------------------------------------------------
// Complete company research result
// --------------------------------------------------

describe("CompanyResearchResultSchema", () => {
  it("accepts a valid aggregated research result", () => {
    const result = CompanyResearchResultSchema.safeParse(
      validResearchResult
    );

    expect(result.success).toBe(true);
  });

  it("rejects a citation that was never collected", () => {
    const invalidResult = {
      ...validResearchResult,
      company_brief: {
        ...validResearchResult.company_brief,
        sources: [
          {
            title: "Unknown source",
            url: "https://unknown-source.com/article",
            source_type: "official"
          }
        ]
      }
    };

    const result = CompanyResearchResultSchema.safeParse(
      invalidResult
    );

    expect(result.success).toBe(false);
  });

  it("rejects an official citation pointing to a discussion source", () => {
    const invalidResult = {
      ...validResearchResult,
      company_brief: {
        ...validResearchResult.company_brief,
        sources: [
          {
            title: "Reddit discussion",
            url: discussionSource.url,
            source_type: "official"
          }
        ]
      }
    };

    const result = CompanyResearchResultSchema.safeParse(
      invalidResult
    );

    expect(result.success).toBe(false);
  });

  it("rejects a discussion citation pointing to an official source", () => {
    const invalidResult = {
      ...validResearchResult,
      company_brief: {
        ...validResearchResult.company_brief,
        sources: [
          {
            title: "Engineering article",
            url: officialSource.url,
            source_type: "discussion"
          }
        ]
      }
    };

    const result = CompanyResearchResultSchema.safeParse(
      invalidResult
    );

    expect(result.success).toBe(false);
  });

  it("rejects an invalid research timestamp", () => {
    const invalidResult = {
      ...validResearchResult,
      source: {
        ...validResearchResult.source,
        researched_at: "not-a-date"
      }
    };

    const result = CompanyResearchResultSchema.safeParse(
      invalidResult
    );

    expect(result.success).toBe(false);
  });

  it("rejects a non-HTTP company URL", () => {
    const invalidResult = {
      ...validResearchResult,
      source: {
        ...validResearchResult.source,
        company_url: "ftp://example.com"
      }
    };

    const result = CompanyResearchResultSchema.safeParse(
      invalidResult
    );

    expect(result.success).toBe(false);
  });
});
