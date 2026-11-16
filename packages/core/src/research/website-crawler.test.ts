import { describe, expect, it, vi } from "vitest";

import { crawlCompanyWebsite } from "./website-crawler.js";

import type {
  ExtractedPage,
  PageLink
} from "./page-extractor.js";

import type {
  RankedPageLink
} from "./link-ranker.js";

import type {
  SitePolicyReport
} from "./site-policy.js";

const ROOT = "https://example.com/";

function makePolicy(
  status: SitePolicyReport["status"]
): SitePolicyReport {
  return { status } as SitePolicyReport;
}

function makeLink(
  url: string,
  sameOrigin = true,
  text = "Careers"
): PageLink {
  return {
    url,
    text,
    sameOrigin
  };
}

function makeRankedLink(
  link: PageLink,
  score = 10,
  category: RankedPageLink["category"] = "hiring"
): RankedPageLink {
  return {
    ...link,
    score,
    category,
    reasons: ["Matched test keyword"]
  };
}

function makePage(
  url: string,
  links: PageLink[] = []
): ExtractedPage {
  return {
    url,
    title: "Example Company",
    description: "Example company website",
    text: "Company information",
    links
  };
}

const allowedDependencies = {
  evaluatePolicy: async () => makePolicy("allowed")
};

describe("crawlCompanyWebsite", () => {
  it("does not crawl a website when its policy is blocked", async () => {
    const fetchPage = vi.fn(async (url: string) => makePage(url));

    const result = await crawlCompanyWebsite(ROOT, {
      dependencies: {
        evaluatePolicy: async () => makePolicy("blocked"),
        fetchPage
      }
    });

    expect(result.status).toBe("blocked");
    expect(result.pages).toHaveLength(0);
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it.each(["unknown", "unavailable"] as const)(
    "requires manual review when policy status is %s",
    async policyStatus => {
      const fetchPage = vi.fn(async (url: string) => makePage(url));

      const result = await crawlCompanyWebsite(ROOT, {
        dependencies: {
          evaluatePolicy: async () => makePolicy(policyStatus),
          fetchPage
        }
      });

      expect(result.status).toBe("manual_review");
      expect(result.pages).toHaveLength(0);
      expect(fetchPage).not.toHaveBeenCalled();
    }
  );

  it("discovers external links but does not crawl them", async () => {
    const externalLink = makeLink(
      "https://jobs.example-careers.com/company",
      false,
      "View open positions"
    );

    const fetchPage = vi.fn(async (url: string) =>
      makePage(url, [externalLink])
    );

    const rankLinks = vi.fn((links: PageLink[]) =>
      links.map(link => makeRankedLink(link))
    );

    const result = await crawlCompanyWebsite(ROOT, {
      dependencies: {
        evaluatePolicy: allowedDependencies.evaluatePolicy,
        fetchPage,
        rankLinks
      }
    });

    expect(result.status).toBe("completed");
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith(ROOT);
    expect(result.discoveredLinks).toHaveLength(1);
    expect(result.discoveredLinks[0].url).toBe(externalLink.url);
  });

  it("continues crawling when an individual page fails", async () => {
    const careersLink = makeLink(
      "https://example.com/careers",
      true,
      "Careers"
    );

    const engineeringLink = makeLink(
      "https://example.com/engineering",
      true,
      "Engineering"
    );

    const fetchPage = vi.fn(async (url: string) => {
      if (url === ROOT) {
        return makePage(url, [careersLink, engineeringLink]);
      }

      if (url === careersLink.url) {
        throw new Error("Careers page unavailable");
      }

      return makePage(url);
    });

    const rankLinks = vi.fn((links: PageLink[]) =>
      links.map(link =>
        makeRankedLink(
          link,
          link.url === careersLink.url ? 20 : 10,
          link.url === careersLink.url ? "hiring" : "engineering"
        )
      )
    );

    const result = await crawlCompanyWebsite(ROOT, {
      dependencies: {
        evaluatePolicy: allowedDependencies.evaluatePolicy,
        fetchPage,
        rankLinks
      }
    });

    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(result.pagesUsed).toContain(ROOT);
    expect(result.pagesUsed).toContain(engineeringLink.url);

    expect(result.pageRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: careersLink.url,
          status: "failed",
          error: "Careers page unavailable"
        })
      ])
    );

    expect(result.status).toBe("partial");
  });

  it("does not exceed the configured maximum page count", async () => {
    const linkA = makeLink(
      "https://example.com/a",
      true,
      "Careers"
    );

    const linkB = makeLink(
      "https://example.com/b",
      true,
      "Engineering"
    );

    const fetchPage = vi.fn(async (url: string) => {
      if (url === ROOT) {
        return makePage(url, [linkA, linkB]);
      }

      return makePage(url);
    });

    const rankLinks = vi.fn((links: PageLink[]) =>
      links.map(link => makeRankedLink(link))
    );

    const result = await crawlCompanyWebsite(ROOT, {
      maxPages: 2,
      dependencies: {
        evaluatePolicy: allowedDependencies.evaluatePolicy,
        fetchPage,
        rankLinks
      }
    });

    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(result.pages).toHaveLength(2);
    expect(result.status).toBe("partial");
  });

  it("returns completed when all discovered pages are crawled successfully", async () => {
    const fetchPage = vi.fn(async (url: string) => makePage(url));

    const result = await crawlCompanyWebsite(ROOT, {
      dependencies: {
        evaluatePolicy: allowedDependencies.evaluatePolicy,
        fetchPage
      }
    });

    expect(result.status).toBe("completed");
    expect(result.pages).toHaveLength(1);
    expect(result.pageRecords).toHaveLength(1);
    expect(result.pageRecords[0].status).toBe("fetched");
  });

  it("passes extracted role and requirements to the link ranker", async () => {
    const rankLinks = vi.fn(() => []);

    await crawlCompanyWebsite("https://example.com", {
      role: "Backend Software Engineer",
      requirements: [
        "Node.js",
        "PostgreSQL",
        "Distributed systems"
      ],
      dependencies: {
        evaluatePolicy: allowedDependencies.evaluatePolicy,
        fetchPage: async () =>
          makePage("https://example.com", [
            makeLink("https://example.com/engineering", true, "Engineering Blog")
          ]),
        rankLinks
      }
    });

    expect(rankLinks).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Number),
      {
        role: "Backend Software Engineer",
        requirements: [
          "Node.js",
          "PostgreSQL",
          "Distributed systems"
        ]
      }
    );
  });

  it("normalizes trailing slashes and tracking parameters before queueing", async () => {
    const canonical = makeLink(
      "https://example.com/careers",
      true,
      "Careers"
    );
    const alias = makeLink(
      "https://example.com/careers/?utm_source=newsletter",
      true,
      "Careers"
    );

    const fetchPage = vi.fn(async (url: string) => {
      if (url === ROOT) {
        return makePage(url, [canonical, alias]);
      }
      return makePage(url);
    });

    const result = await crawlCompanyWebsite(ROOT, {
      dependencies: {
        evaluatePolicy: allowedDependencies.evaluatePolicy,
        fetchPage,
        rankLinks: links => links.map(link => makeRankedLink(link))
      }
    });

    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage).toHaveBeenNthCalledWith(
      2,
      "https://example.com/careers"
    );
    expect(result.pagesUsed).toEqual([
      "https://example.com/",
      "https://example.com/careers"
    ]);
  });

  it("preserves meaningful query parameters when normalizing URLs", async () => {
    const engineering = makeLink(
      "https://example.com/jobs?department=engineering",
      true,
      "Careers"
    );
    const design = makeLink(
      "https://example.com/jobs?department=design",
      true,
      "Careers"
    );

    const fetchPage = vi.fn(async (url: string) => {
      if (url === ROOT) {
        return makePage(url, [engineering, design]);
      }
      return makePage(url);
    });

    const result = await crawlCompanyWebsite(ROOT, {
      dependencies: {
        evaluatePolicy: allowedDependencies.evaluatePolicy,
        fetchPage,
        rankLinks: links => links.map(link => makeRankedLink(link))
      }
    });

    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(result.pagesUsed).toContain(
      "https://example.com/jobs?department=engineering"
    );
    expect(result.pagesUsed).toContain(
      "https://example.com/jobs?department=design"
    );
  });

  it("does not store duplicate page content when different URLs redirect to the same final URL", async () => {
    const aliasA = makeLink(
      "https://example.com/careers",
      true,
      "Careers"
    );
    const aliasB = makeLink(
      "https://example.com/jobs",
      true,
      "Careers"
    );

    const fetchPage = vi.fn(async (url: string) => {
      if (url === ROOT) {
        return makePage(url, [aliasA, aliasB]);
      }
      return makePage("https://example.com/careers/");
    });

    const result = await crawlCompanyWebsite(ROOT, {
      dependencies: {
        evaluatePolicy: allowedDependencies.evaluatePolicy,
        fetchPage,
        rankLinks: links => links.map(link => makeRankedLink(link))
      }
    });

    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(result.pages).toHaveLength(2);
    expect(result.pagesUsed).toEqual([
      "https://example.com/",
      "https://example.com/careers"
    ]);
    expect(new Set(result.pagesUsed).size).toBe(result.pagesUsed.length);
  });

  it("normalizes the initial URL and returns unique pagesUsed URLs", async () => {
    const fetchPage = vi.fn(async (url: string) => makePage(url));

    const result = await crawlCompanyWebsite(
      "https://EXAMPLE.com:443/?utm_source=test#top",
      {
        dependencies: {
          evaluatePolicy: allowedDependencies.evaluatePolicy,
          fetchPage
        }
      }
    );

    expect(result.websiteUrl).toBe("https://example.com/");
    expect(fetchPage).toHaveBeenCalledWith("https://example.com/");
    expect(result.pagesUsed).toEqual(["https://example.com/"]);
  });
});
