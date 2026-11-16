import { describe, expect, it, vi } from "vitest";
import {
  buildDiscussionQueries,
  searchCompanyDiscussions,
  type SearchProvider,
  type SearchProviderResult
} from "./discussion-search.js";

const noDelay = { delayBetweenQueriesMs: 0, sleep: async (_ms: number) => {} };

function createProvider(search: SearchProvider["search"]): SearchProvider {
  return { name: "test-provider", search };
}

describe("buildDiscussionQueries", () => {
  it("generates targeted company interview queries", () => {
    const queries = buildDiscussionQueries("Google", "Backend Engineer");
    expect(queries).toHaveLength(6);
    expect(queries[0]).toContain("Google");
    expect(queries[0]).toContain("Backend Engineer");
    expect(queries.some(query => query.includes("site:reddit.com"))).toBe(true);
    expect(queries.some(query => query.includes("site:glassdoor.com"))).toBe(true);
    expect(queries.some(query => query.includes("site:teamblind.com"))).toBe(true);
  });

  it.each([["", "Backend Engineer"], ["Google", ""]])(
    "rejects missing company or role",
    (company, role) => {
      expect(() => buildDiscussionQueries(company, role)).toThrow("Company name and role are required.");
    }
  );
});

describe("searchCompanyDiscussions", () => {
  it("normalizes URLs and classifies sources", async () => {
    const results: SearchProviderResult[] = [
      {
        title: " Google Interview Experience ",
        url: "https://www.reddit.com/r/cscareerquestions/comments/12345/?utm_source=test",
        snippet: "My interview experience",
        publishedAt: "2025-01-01"
      },
      { title: "Invalid URL", url: "javascript:alert(1)" },
      { title: "Unsupported protocol", url: "ftp://example.com/file" }
    ];
    let calls = 0;
    const provider = createProvider(async () => calls++ === 0 ? results : []);
    const report = await searchCompanyDiscussions({ company: "Google", role: "Backend Engineer" }, provider, noDelay);

    expect(report.status).toBe("completed");
    expect(report.results).toHaveLength(1);
    expect(report.results[0]).toMatchObject({
      title: "Google Interview Experience",
      domain: "reddit.com",
      sourceType: "reddit",
      snippet: "My interview experience",
      publishedAt: "2025-01-01T00:00:00.000Z"
    });
    expect(report.results[0].url).not.toContain("utm_source");
    expect(report.results[0].url).not.toContain("www.");
  });

  it("deduplicates canonical URLs and tracks matched queries", async () => {
    let calls = 0;
    const provider = createProvider(async () => {
      calls++;
      if (calls === 1) return [{
        title: "Interview Experience", url: "https://www.reddit.com/r/jobs/123/?utm_source=test", snippet: "First result"
      }];
      if (calls === 2) return [{
        title: "Interview Experience", url: "https://reddit.com/r/jobs/123/", snippet: "Duplicate result"
      }];
      return [];
    });
    const report = await searchCompanyDiscussions({ company: "Google", role: "Software Engineer" }, provider, noDelay);
    expect(report.results).toHaveLength(1);
    expect(report.results[0].matchedQueries).toHaveLength(2);
    expect(report.results[0].snippet).toBe("First result");
  });

  it("ranks exact-role experiences above unrelated roles", async () => {
    const provider = createProvider(async () => [
      {
        title: "Stripe Product Manager Interview Experience",
        url: "https://example.com/pm",
        snippet: "My interview for the product manager role included strategy rounds."
      },
      {
        title: "Stripe Backend Engineer Interview Experience",
        url: "https://example.com/backend",
        snippet: "I interviewed for the Backend Engineer role. The coding round covered API design."
      }
    ]);
    const report = await searchCompanyDiscussions(
      { company: "Stripe", role: "Backend Engineer", requirements: ["API design"] },
      provider,
      noDelay
    );
    expect(report.results[0].url).toBe("https://example.com/backend");
  });

  it("keeps related engineering and general company results after exact-role results", async () => {
    const provider = createProvider(async () => [
      { title: "Stripe company interview process", url: "https://example.com/general", snippet: "Overview of the hiring process." },
      { title: "Stripe Software Engineer Interview Experience", url: "https://example.com/software", snippet: "My software engineer interview included coding rounds." },
      { title: "Stripe Backend Engineer Interview Experience", url: "https://example.com/backend", snippet: "My backend engineer interview included API design." }
    ]);
    const report = await searchCompanyDiscussions({ company: "Stripe", role: "Backend Engineer" }, provider, noDelay);
    expect(report.results.map(result => result.url)).toEqual([
      "https://example.com/backend",
      "https://example.com/software",
      "https://example.com/general"
    ]);
  });

  it("prefers firsthand interview accounts over generic preparation guides", async () => {
    const provider = createProvider(async () => [
      { title: "Stripe Backend Engineer Interview Guide", url: "https://example.com/guide", snippet: "How to prepare for the hiring process and common interview questions." },
      { title: "My Stripe Backend Engineer Interview Experience", url: "https://example.com/experience", snippet: "I interviewed at Stripe. They asked me to design an API in the technical round." }
    ]);
    const report = await searchCompanyDiscussions({ company: "Stripe", role: "Backend Engineer" }, provider, noDelay);
    expect(report.results[0].url).toBe("https://example.com/experience");
  });

  it("penalizes clearly unrelated job families such as Operations Analyst", async () => {
    const provider = createProvider(async () => [
      {
        title: "Stripe Operations Analyst Interview Experience",
        url: "https://example.com/operations",
        snippet: "My interview included business operations and reporting."
      },
      {
        title: "Stripe Backend Engineer Interview Experience",
        url: "https://example.com/backend",
        snippet: "My interview included API design and distributed systems."
      }
    ]);
    const report = await searchCompanyDiscussions(
      { company: "Stripe", role: "Backend Engineer", requirements: ["API design"] },
      provider,
      noDelay
    );
    expect(report.results[0].url).toBe("https://example.com/backend");
    expect(report.results[1].url).toBe("https://example.com/operations");
  });

  it("does not mark a generic article mismatched just because its snippet mentions another role", async () => {
    const provider = createProvider(async () => [
      {
        title: "Stripe Interview Process",
        url: "https://example.com/process",
        snippet: "The article mentions product manager and operations analyst interviews as examples."
      },
      {
        title: "Stripe Backend Engineer Interview Experience",
        url: "https://example.com/backend",
        snippet: "My backend engineer interview included API design."
      }
    ]);
    const report = await searchCompanyDiscussions(
      { company: "Stripe", role: "Backend Engineer" },
      provider,
      noDelay
    );
    expect(report.results[0].url).toBe("https://example.com/backend");
    expect(report.results).toHaveLength(2);
  });

  it("prefers matching seniority when the target role specifies internship", async () => {
    const provider = createProvider(async () => [
      {
        title: "Stripe Senior Backend Engineer Interview Experience",
        url: "https://example.com/senior",
        snippet: "My interview covered system design."
      },
      {
        title: "Stripe Backend Engineer Intern Interview Experience",
        url: "https://example.com/intern",
        snippet: "My internship interview covered coding and APIs."
      }
    ]);
    const report = await searchCompanyDiscussions(
      { company: "Stripe", role: "Backend Engineer Intern" },
      provider,
      noDelay
    );
    expect(report.results[0].url).toBe("https://example.com/intern");
  });

  it("ranks firsthand exact-role accounts above generic exact-role guides", async () => {
    const provider = createProvider(async () => [
      {
        title: "Stripe Backend Engineer Interview Guide",
        url: "https://example.com/guide",
        snippet: "A preparation guide with common interview questions."
      },
      {
        title: "My Stripe Backend Engineer Interview Experience",
        url: "https://example.com/experience",
        snippet: "I interviewed at Stripe. They asked me to design an API."
      }
    ]);
    const report = await searchCompanyDiscussions(
      { company: "Stripe", role: "Backend Engineer" },
      provider,
      noDelay
    );
    expect(report.results[0].url).toBe("https://example.com/experience");
  });

  it("retries temporary failures with exponential backoff", async () => {
    let calls = 0;
    const sleep = vi.fn(async (_ms: number) => {});
    const provider = createProvider(async () => {
      calls++;
      if (calls <= 2) throw Object.assign(new Error("Temporary server failure"), { status: 503 });
      return [];
    });
    const report = await searchCompanyDiscussions(
      { company: "Google", role: "Backend Engineer" },
      provider,
      { maxRetries: 2, baseDelayMs: 100, delayBetweenQueriesMs: 0, sleep }
    );
    expect(calls).toBe(8);
    expect(sleep).toHaveBeenNthCalledWith(1, 100);
    expect(sleep).toHaveBeenNthCalledWith(2, 200);
    expect(report.status).toBe("completed");
  });

  it("continues searching when one query fails", async () => {
    let calls = 0;
    const provider = createProvider(async () => {
      calls++;
      if (calls === 1) throw new Error("Invalid search request");
      return [{ title: "Interview Experience", url: "https://www.reddit.com/r/jobs/123/" }];
    });
    const report = await searchCompanyDiscussions(
      { company: "Google", role: "Backend Engineer" },
      provider,
      { ...noDelay, maxRetries: 3 }
    );
    expect(calls).toBe(6);
    expect(report.status).toBe("partial");
    expect(report.failures).toHaveLength(1);
    expect(report.results.length).toBeGreaterThan(0);
  });

  it("returns unavailable when every query fails", async () => {
    const provider = createProvider(async () => { throw new Error("Search service unavailable"); });
    const report = await searchCompanyDiscussions(
      { company: "Google", role: "Backend Engineer" },
      provider,
      { ...noDelay, maxRetries: 0 }
    );
    expect(report.status).toBe("unavailable");
    expect(report.results).toHaveLength(0);
    expect(report.failures).toHaveLength(6);
  });

  it("respects the maximum total result limit", async () => {
    const provider = createProvider(async ({ query }) => [1, 2, 3].map(index => ({
      title: `Result ${index} - ${query}`,
      url: `https://example.com/${encodeURIComponent(query)}/${index}`
    })));
    const report = await searchCompanyDiscussions(
      { company: "Google", role: "Backend Engineer" },
      provider,
      { ...noDelay, maxTotalResults: 2 }
    );
    expect(report.results).toHaveLength(2);
  });

  it("returns completed when searches succeed but find no results", async () => {
    const provider = createProvider(async () => []);
    const report = await searchCompanyDiscussions({ company: "Google", role: "Backend Engineer" }, provider, noDelay);
    expect(report.status).toBe("completed");
    expect(report.results).toHaveLength(0);
    expect(report.failures).toHaveLength(0);
  });
});
