import {
  evaluateSitePolicy,
  type SitePolicyReport
} from "./site-policy.js";

import {
  fetchAndExtractPage,
  type ExtractedPage,
  type PageLink
} from "./page-extractor.js";

import {
  rankCompanyLinks,
  type LinkRankingOptions,
  type RankedPageLink
} from "./link-ranker.js";

export type CrawlStatus =
  | "completed"
  | "partial"
  | "blocked"
  | "manual_review";

export interface CrawledPageRecord {
  url: string;
  status: "fetched" | "failed";
  category?: RankedPageLink["category"];
  error?: string;
}

export interface CompanyCrawlResult {
  websiteUrl: string;
  status: CrawlStatus;
  policy: SitePolicyReport;
  pages: ExtractedPage[];
  pagesUsed: string[];
  pageRecords: CrawledPageRecord[];
  discoveredLinks: RankedPageLink[];
}

export interface CrawlerDependencies {
  evaluatePolicy: (
    url: string
  ) => Promise<SitePolicyReport>;

  fetchPage: (
    url: string
  ) => Promise<ExtractedPage>;

  rankLinks: (
    links: PageLink[],
    maxResults?: number,
    options?: LinkRankingOptions
  ) => RankedPageLink[];

}

export interface CrawlOptions {
  maxPages?: number;

  // Extracted from the submitted job description.
  role?: string;
  requirements?: string[];

  dependencies?: Partial<CrawlerDependencies>;
}

interface QueueItem {
  url: string;
  category?: RankedPageLink["category"];
  score: number;
}

const DEFAULT_MAX_PAGES = 12;
const MAX_ALLOWED_PAGES = 30;

function normalizeUrl(input: string): string {
  const url = new URL(input);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS URLs are supported.");
  }

  url.hash = "";

  return url.toString();
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.slice(0, 300);
  }

  return "Unknown page retrieval error.";
}

function isSameOrigin(
  candidate: string,
  originalOrigin: string
): boolean {
  try {
    return new URL(candidate).origin === originalOrigin;
  } catch {
    return false;
  }
}

export async function crawlCompanyWebsite(
  inputUrl: string,
  options: CrawlOptions = {}
): Promise<CompanyCrawlResult> {
  const websiteUrl = normalizeUrl(inputUrl);
  const originalOrigin = new URL(websiteUrl).origin;

  const maxPages = Math.min(
    MAX_ALLOWED_PAGES,
    Math.max(1, Math.floor(options.maxPages ?? DEFAULT_MAX_PAGES))
  );

  const dependencies: CrawlerDependencies = {
    evaluatePolicy: evaluateSitePolicy,
    fetchPage: fetchAndExtractPage,
    rankLinks: rankCompanyLinks,
    ...options.dependencies
  };

  const policy = await dependencies.evaluatePolicy(websiteUrl);

  const pages: ExtractedPage[] = [];
  const pageRecords: CrawledPageRecord[] = [];
  const discoveredLinks = new Map<string, RankedPageLink>();

  if (policy.status === "blocked") {
    return {
      websiteUrl,
      status: "blocked",
      policy,
      pages,
      pagesUsed: [],
      pageRecords,
      discoveredLinks: []
    };
  }

  if (policy.status !== "allowed") {
    return {
      websiteUrl,
      status: "manual_review",
      policy,
      pages,
      pagesUsed: [],
      pageRecords,
      discoveredLinks: []
    };
  }

  const queue: QueueItem[] = [
    {
      url: websiteUrl,
      score: Number.POSITIVE_INFINITY
    }
  ];

  const queued = new Set<string>([websiteUrl]);
  const visited = new Set<string>();
  let attemptedPages = 0;

  while (queue.length > 0 && attemptedPages < maxPages) {
    queue.sort((a, b) => b.score - a.score);

    const current = queue.shift()!;

    if (visited.has(current.url)) {
      continue;
    }

    visited.add(current.url);
    attemptedPages++;

    try {
      const page = await dependencies.fetchPage(current.url);

      pages.push(page);

      pageRecords.push({
        url: page.url,
        status: "fetched",
        category: current.category
      });

      const rankingOptions: LinkRankingOptions = {
        role: options.role,
        requirements: options.requirements
      };

      const rankedLinks = dependencies.rankLinks(
        page.links,
        maxPages * 5,
        rankingOptions
      );

      for (const link of rankedLinks) {
        let normalizedLink: string;

        try {
          normalizedLink = normalizeUrl(link.url);
        } catch {
          continue;
        }

        const existing = discoveredLinks.get(normalizedLink);

        if (!existing || link.score > existing.score) {
          discoveredLinks.set(normalizedLink, {
            ...link,
            url: normalizedLink
          });
        }

        // External links are retained as discoveries,
        // but are not fetched by this crawler.
        if (!isSameOrigin(normalizedLink, originalOrigin)) {
          continue;
        }

        if (queued.has(normalizedLink) || visited.has(normalizedLink)) {
          continue;
        }

        queued.add(normalizedLink);

        queue.push({
          url: normalizedLink,
          category: link.category,
          score: link.score
        });
      }
    } catch (error) {
      pageRecords.push({
        url: current.url,
        status: "failed",
        category: current.category,
        error: getErrorMessage(error)
      });

      // Continue processing other discovered pages.
    }
  }

  const hasFailures = pageRecords.some(
    record => record.status === "failed"
  );

  const hasRemainingPages = queue.length > 0;

  return {
    websiteUrl,
    status: hasFailures || hasRemainingPages
      ? "partial"
      : "completed",
    policy,
    pages,
    pagesUsed: pages.map(page => page.url),
    pageRecords,
    discoveredLinks: [...discoveredLinks.values()].sort(
      (a, b) => b.score - a.score
    )
  };
}
