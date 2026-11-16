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
    async (policyStatus) => {
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
        evaluatePolicy: async () => makePolicy("allowed"),
        fetchPage,
        rankLinks
      }
    });

    expect(result.status).toBe("completed");

    // Only the original website should be fetched.
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith(ROOT);

    // External hiring link should still be recorded.
    expect(result.discoveredLinks).toHaveLength(1);
    expect(result.discoveredLinks[0].url).toBe(
      externalLink.url
    );
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
        return makePage(url, [
          careersLink,
          engineeringLink
        ]);
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
          link.url === careersLink.url
            ? "hiring"
            : "engineering"
        )
      )
    );

    const result = await crawlCompanyWebsite(ROOT, {
      dependencies: {
        evaluatePolicy: async () => makePolicy("allowed"),
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
        evaluatePolicy: async () => makePolicy("allowed"),
        fetchPage,
        rankLinks
      }
    });

    // Homepage + one additional page.
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(result.pages).toHaveLength(2);

    // One page remains in the queue.
    expect(result.status).toBe("partial");
  });

  it("returns completed when all discovered pages are crawled successfully", async () => {
    const fetchPage = vi.fn(async (url: string) =>
      makePage(url)
    );

    const result = await crawlCompanyWebsite(ROOT, {
      dependencies: {
        evaluatePolicy: async () => makePolicy("allowed"),
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

      await crawlCompanyWebsite(
        "https://example.com",
        {
          role: "Backend Software Engineer",
          requirements: [
            "Node.js",
            "PostgreSQL",
            "Distributed systems"
          ],
          dependencies: {
            evaluatePolicy: async () => ({
              status: "allowed"
            }) as SitePolicyReport,

            fetchPage: async () => ({
              url: "https://example.com",
              title: "Example",
              description: "",
              text: "Example company",
              links: [
                {
                  url: "https://example.com/engineering",
                  text: "Engineering Blog",
                  sameOrigin: true
                }
              ]
            }) as ExtractedPage,

            rankLinks
          }
        }
      );

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
});

