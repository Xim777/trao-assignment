import {
  checkRobotsAccess,
  fetchAndExtractPage
} from "./page-extractor.js";

import type {
  ExtractedPage,
  PageLink
} from "./page-extractor.js";

export type SitePolicyStatus =
  | "allowed"
  | "blocked"
  | "unknown"
  | "unavailable";

export type TermsPolicyStatus =
  | "not_found"
  | "restricted"
  | "no_restriction_found"
  | "ambiguous"
  | "unavailable";

export interface SitePolicyReport {
  websiteUrl: string;
  checkedAt: string;
  status: SitePolicyStatus;
  requiresManualReview: boolean;

  robots: {
    status: "allowed" | "blocked" | "unavailable";
    url?: string;
    crawlDelayMs?: number;
    message?: string;
  };

  terms: {
    status: TermsPolicyStatus;
    url?: string;
    title?: string;
    evidence: string[];
    message?: string;
  };
}

interface RankedTermsLink {
  link: PageLink;
  score: number;
}

interface TermsAssessment {
  status:
    | "restricted"
    | "no_restriction_found"
    | "ambiguous";
  evidence: string[];
}

const MAX_TERMS_LINKS_TO_CHECK = 3;

// These patterns identify likely Terms of Service links.
// Privacy-policy links are deliberately not treated as terms links.
function getTermsLinkScore(link: PageLink): number {
  let url: URL;

  try {
    url = new URL(link.url);
  } catch {
    return 0;
  }

  const label = link.text.toLowerCase();
  const path = url.pathname.toLowerCase();

  const hasTermsReference =
    /\bterms?\b|\bacceptable\s+use\b|\buser\s+agreement\b/i
      .test(`${label} ${path}`);

  if (
    /\bprivacy\b|\bcookie\s+policy\b/i.test(label) &&
    !hasTermsReference
  ) {
    return 0;
  }

  // Most reliable candidates: explicit terms or acceptable-use links.
  if (
    /\bterms?\s+(?:of\s+)?(?:service|use|website)\b/i.test(label) ||
    /\bterms?\s*(?:&|and)\s*conditions\b/i.test(label) ||
    /\bacceptable\s+use\b|\buser\s+agreement\b/i.test(label) ||
    /acceptable[-_/]?use|user[-_/]?agreement/i.test(path)
  ) {
    return 100;
  }

  // A generic "Terms" label is still a strong candidate.
  if (/\bterms?\b/i.test(label)) {
    return 85;
  }

  // Terms may be discoverable from the URL even if the link label is vague.
  if (/\bterms?\b/i.test(path)) {
    return 80;
  }

  // A generic Legal link is a fallback candidate.
  if (
    /\blegal\b/i.test(label) ||
    /(?:^|\/)legal(?:\/|$)/i.test(path)
  ) {
    return 40;
  }

  return 0;
}

function findTermsLinks(links: PageLink[]): RankedTermsLink[] {
  return links
    .map(link => ({
      link,
      score: getTermsLinkScore(link)
    }))
    .filter(candidate => candidate.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_TERMS_LINKS_TO_CHECK);
}

function isTermsDocument(
  page: ExtractedPage,
  candidateScore: number
): boolean {
  // Explicit Terms links are accepted as terms documents.
  if (candidateScore >= 80) {
    return true;
  }

  // A generic Legal link must be confirmed by its page content.
  const identityText = [
    page.title,
    page.description,
    page.text.slice(0, 2500)
  ].join(" ");

  return (
    /\bterms?\s+(?:of\s+)?(?:service|use|website)\b/i.test(identityText) ||
    /\bterms?\s*(?:&|and)\s*conditions\b/i.test(identityText) ||
    /\bacceptable\s+use\b|\buser\s+agreement\b/i.test(identityText)
  );
}

// These patterns identify references to automated collection.
const AUTOMATION_PATTERN =
  /\b(?:scrap(?:e|ing|ed)|crawl(?:er|ing)?|bots?|spiders?|robots?|automated\s+(?:access|means|tools?|systems?|requests?|queries|collection|data|purpose)|data\s+min(?:e|ing)|harvest(?:ing|ed)?)\b/i;

// These patterns identify restrictive or prohibitive language.
const RESTRICTION_PATTERN =
  /\b(?:prohibit(?:s|ed|ion)?|forbid(?:s|den)?|ban(?:s|ned)?|disallow(?:s|ed)?|restrict(?:s|ed|ion)?|may\s+not|must\s+not|shall\s+not|cannot|can't|not\s+permitted|not\s+allowed|not\s+authorized|unauthori[sz]ed|do\s+not\s+permit|does\s+not\s+permit|not\s+to\s+use|no\s+(?:automated|robot|bot|spider|scrap)|only\s+(?:with|after)\s+(?:our\s+)?(?:prior\s+)?(?:written\s+)?consent|without.{0,40}consent)\b/i;

function assessTermsText(text: string): TermsAssessment {
  const normalizedText = text
    .replace(/\s+/g, " ")
    .trim();

  // Inspect individual sentences so unrelated restrictions elsewhere
  // in the document are less likely to be mistaken for scraping rules.
  const sentences = normalizedText
    .split(/(?<=[.!?])\s+/)
    .map(sentence => sentence.trim())
    .filter(Boolean);

  const automationSentences = sentences.filter(sentence =>
    AUTOMATION_PATTERN.test(sentence)
  );

  const restrictiveSentences = automationSentences.filter(sentence =>
    RESTRICTION_PATTERN.test(sentence)
  );

  if (restrictiveSentences.length > 0) {
    return {
      status: "restricted",
      evidence: restrictiveSentences
        .slice(0, 3)
        .map(sentence => sentence.slice(0, 400))
    };
  }

  if (automationSentences.length > 0) {
    return {
      status: "ambiguous",
      evidence: automationSentences
        .slice(0, 3)
        .map(sentence => sentence.slice(0, 400))
    };
  }

  return {
    status: "no_restriction_found",
    evidence: []
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "An unknown error occurred.";
}

function createReport(
  websiteUrl: string,
  status: SitePolicyStatus,
  robots: SitePolicyReport["robots"],
  terms: SitePolicyReport["terms"]
): SitePolicyReport {
  return {
    websiteUrl,
    checkedAt: new Date().toISOString(),
    status,
    requiresManualReview:
      status === "unknown" || status === "unavailable",
    robots,
    terms
  };
}

export async function evaluateSitePolicy(
  inputUrl: string
): Promise<SitePolicyReport> {
  // First, check whether the supplied website URL is accessible
  // according to its robots.txt policy.
  let homepageRobots: Awaited<
    ReturnType<typeof checkRobotsAccess>
  >;

  try {
    homepageRobots = await checkRobotsAccess(inputUrl);
  } catch (error) {
    return createReport(
      inputUrl,
      "unavailable",
      {
        status: "unavailable",
        message: getErrorMessage(error)
      },
      {
        status: "not_found",
        evidence: []
      }
    );
  }

  if (!homepageRobots.allowed) {
    return createReport(
      inputUrl,
      "blocked",
      {
        status: "blocked",
        url: homepageRobots.robotsUrl,
        crawlDelayMs: homepageRobots.crawlDelayMs,
        message: "The website disallows access to the supplied URL."
      },
      {
        status: "not_found",
        evidence: []
      }
    );
  }

  // Fetch the homepage to discover its published legal links.
  let homepage: ExtractedPage;

  try {
    homepage = await fetchAndExtractPage(inputUrl);
  } catch (error) {
    return createReport(
      inputUrl,
      "unavailable",
      {
        status: "allowed",
        url: homepageRobots.robotsUrl,
        crawlDelayMs: homepageRobots.crawlDelayMs
      },
      {
        status: "unavailable",
        evidence: [],
        message: `Could not inspect the homepage: ${getErrorMessage(error)}`
      }
    );
  }

  const candidates = findTermsLinks(homepage.links);

  if (candidates.length === 0) {
    return createReport(
      homepage.url,
      "unknown",
      {
        status: "allowed",
        url: homepageRobots.robotsUrl,
        crawlDelayMs: homepageRobots.crawlDelayMs
      },
      {
        status: "not_found",
        evidence: [],
        message: "No Terms of Service link was discovered on the homepage."
      }
    );
  }

  let ambiguousResult:
    | SitePolicyReport["terms"]
    | undefined;

  let unavailableResult:
    | SitePolicyReport["terms"]
    | undefined;

  // Inspect only the most relevant legal links. This does not crawl
  // arbitrary external links from the company's website.
  for (const candidate of candidates) {
    const termsUrl = candidate.link.url;

    let termsRobots: Awaited<
      ReturnType<typeof checkRobotsAccess>
    >;

    try {
      termsRobots = await checkRobotsAccess(termsUrl);
    } catch (error) {
      unavailableResult = {
        status: "unavailable",
        url: termsUrl,
        evidence: [],
        message: `Could not check robots.txt for the terms page: ${getErrorMessage(error)}`
      };

      continue;
    }

    if (!termsRobots.allowed) {
      unavailableResult = {
        status: "unavailable",
        url: termsUrl,
        evidence: [],
        message: "The terms page is disallowed by robots.txt."
      };

      continue;
    }

    let termsPage: ExtractedPage;

    try {
      termsPage = await fetchAndExtractPage(termsUrl);
    } catch (error) {
      unavailableResult = {
        status: "unavailable",
        url: termsUrl,
        evidence: [],
        message: `Could not retrieve the terms page: ${getErrorMessage(error)}`
      };

      continue;
    }

    if (!isTermsDocument(termsPage, candidate.score)) {
      ambiguousResult = {
        status: "ambiguous",
        url: termsPage.url,
        title: termsPage.title,
        evidence: [],
        message: "A legal page was found, but it could not be confirmed as the website's Terms of Service."
      };

      continue;
    }

    const assessment = assessTermsText(termsPage.text);

    if (assessment.status === "restricted") {
      return createReport(
        homepage.url,
        "blocked",
        {
          status: "allowed",
          url: homepageRobots.robotsUrl,
          crawlDelayMs: homepageRobots.crawlDelayMs
        },
        {
          status: "restricted",
          url: termsPage.url,
          title: termsPage.title,
          evidence: assessment.evidence,
          message: "The terms contain language restricting automated access or data collection."
        }
      );
    }

    if (assessment.status === "no_restriction_found") {
      return createReport(
        homepage.url,
        "allowed",
        {
          status: "allowed",
          url: homepageRobots.robotsUrl,
          crawlDelayMs: homepageRobots.crawlDelayMs
        },
        {
          status: "no_restriction_found",
          url: termsPage.url,
          title: termsPage.title,
          evidence: [],
          message: "No explicit restriction on automated collection was detected. This is not legal clearance."
        }
      );
    }

    ambiguousResult = {
      status: "ambiguous",
      url: termsPage.url,
      title: termsPage.title,
      evidence: assessment.evidence,
      message: "The terms mention automated access or data collection, but the restriction is unclear."
    };
  }

  if (ambiguousResult) {
    return createReport(
      homepage.url,
      "unknown",
      {
        status: "allowed",
        url: homepageRobots.robotsUrl,
        crawlDelayMs: homepageRobots.crawlDelayMs
      },
      ambiguousResult
    );
  }

  return createReport(
    homepage.url,
    "unavailable",
    {
      status: "allowed",
      url: homepageRobots.robotsUrl,
      crawlDelayMs: homepageRobots.crawlDelayMs
    },
    unavailableResult ?? {
      status: "not_found",
      evidence: [],
      message: "The terms could not be evaluated."
    }
  );
}
