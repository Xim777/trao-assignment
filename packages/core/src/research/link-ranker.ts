export interface PageLink {
  url: string;
  text: string;
  sameOrigin: boolean;
}

export type ResearchLinkCategory =
  | "hiring"
  | "interview_process"
  | "engineering"
  | "culture"
  | "company_info";

export interface RankedPageLink extends PageLink {
  category: ResearchLinkCategory;
  score: number;
  reasons: string[];
}

export interface LinkRankingOptions {
  role?: string;
  requirements?: string[];
}

interface CategorySignals {
  textStrong: RegExp[];
  pathStrong: RegExp[];
  textWeak: RegExp[];
  pathWeak: RegExp[];
}

const CATEGORY_PRIORITY: ResearchLinkCategory[] = [
  "interview_process",
  "hiring",
  "engineering",
  "culture",
  "company_info",
];

const CATEGORY_SIGNALS: Record<
  ResearchLinkCategory,
  CategorySignals
> = {
  interview_process: {
    textStrong: [
      /\binterview process\b/i,
      /\bhiring process\b/i,
      /\bcandidate journey\b/i,
      /\btechnical assessment\b/i,
    ],
    pathStrong: [
      /interview/i,
      /hiring-process/i,
      /recruitment/i,
      /selection/i,
      /candidate/i,
      /assessment/i,
    ],
    textWeak: [
      /\binterviews?\b/i,
      /\btechnical round\b/i,
      /\bselection process\b/i,
    ],
    pathWeak: [/careers/i, /jobs/i],
  },

  hiring: {
    textStrong: [
      /\bcareers\b/i,
      /\bjob openings\b/i,
      /\bopen positions\b/i,
      /\bjoin our team\b/i,
      /\bopen roles\b/i,
    ],
    pathStrong: [
      /careers/i,
      /jobs/i,
      /openings/i,
      /opportunities/i,
    ],
    textWeak: [
      /\bhiring\b/i,
      /\bwork with us\b/i,
      /\bjoin us\b/i,
      /\btalent\b/i,
      /\bvacancies\b/i,
    ],
    pathWeak: [/work-with-us/i, /talent/i, /join/i],
  },

  engineering: {
    textStrong: [
      /\bengineering\b/i,
      /\bengineering blog\b/i,
      /\bdeveloper blog\b/i,
      /\btechnical blog\b/i,
      /\binfrastructure\b/i,
      /\bsoftware architecture\b/i,
    ],
    pathStrong: [
      /engineering/i,
      /tech-blog/i,
      /developer/i,
      /infrastructure/i,
      /architecture/i,
      /research/i,
    ],
    textWeak: [
      /\btechnology\b/i,
      /\bsoftware\b/i,
      /\bdevelopers?\b/i,
      /\bplatform\b/i,
    ],
    pathWeak: [/technology/i, /tech/i, /software/i, /platform/i],
  },

  culture: {
    textStrong: [
      /\bemployee handbook\b/i,
      /\bcompany handbook\b/i,
      /\bcompany culture\b/i,
      /\bworking at\b/i,
      /\blife at\b/i,
    ],
    pathStrong: [
      /handbook/i,
      /culture/i,
      /values/i,
      /benefits/i,
    ],
    textWeak: [
      /\bcompany values\b/i,
      /\bremote work\b/i,
      /\bwork environment\b/i,
      /\bteam culture\b/i,
    ],
    pathWeak: [/people/i, /team/i, /about-us/i],
  },

  company_info: {
    textStrong: [
      /\babout us\b/i,
      /\bwho we are\b/i,
      /\bwhat we do\b/i,
      /\bour company\b/i,
      /\bour products\b/i,
    ],
    pathStrong: [
      /about/i,
      /company/i,
      /products/i,
      /services/i,
      /solutions/i,
      /mission/i,
    ],
    textWeak: [
      /\bcompany overview\b/i,
      /\bour mission\b/i,
      /\bour story\b/i,
    ],
    pathWeak: [/overview/i, /story/i],
  },
};

const IRRELEVANT_LINK_PATTERN =
  /\b(privacy policy|cookie policy|terms of service|terms and conditions|sign in|log in|logout|unsubscribe|contact us|customer support)\b/i;

const GENERIC_ROLE_WORDS = new Set([
  "senior",
  "junior",
  "lead",
  "staff",
  "principal",
  "associate",
  "intern",
  "internship",
  "engineer",
  "engineering",
  "developer",
  "development",
  "software",
  "professional",
  "specialist",
  "manager",
  "architect",
  "analyst",
  "the",
  "and",
  "for",
  "with",
  "of",
  "in",
  "on",
]);

const GENERIC_REQUIREMENT_WORDS = new Set([
  ...GENERIC_ROLE_WORDS,
  "experience",
  "years",
  "year",
  "knowledge",
  "understanding",
  "ability",
  "strong",
  "good",
  "excellent",
  "working",
  "work",
  "familiarity",
  "proficiency",
  "skills",
  "skill",
  "including",
  "using",
  "used",
  "build",
  "building",
  "develop",
  "developing",
  "design",
  "designing",
  "maintain",
  "maintaining",
  "systems",
  "system",
  "applications",
  "application",
  "services",
  "service",
  "solutions",
  "solution",
  "tools",
  "tool",
  "team",
  "teams",
  "responsibilities",
  "responsibility",
]);

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9.+#/\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(/[\s/-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

function getCategoryScore(
  category: ResearchLinkCategory,
  text: string,
  path: string
): { score: number; reasons: string[] } {
  const signals = CATEGORY_SIGNALS[category];
  let score = 0;
  const reasons: string[] = [];

  if (signals.textStrong.some((pattern) => pattern.test(text))) {
    score += 12;
    reasons.push("Strong category match in link text");
  }

  if (signals.pathStrong.some((pattern) => pattern.test(path))) {
    score += 10;
    reasons.push("Strong category match in URL path");
  }

  if (signals.textWeak.some((pattern) => pattern.test(text))) {
    score += 7;
    reasons.push("Related category wording in link text");
  }

  if (signals.pathWeak.some((pattern) => pattern.test(path))) {
    score += 5;
    reasons.push("Related category wording in URL path");
  }

  return { score, reasons };
}

function getRoleRelevance(
  text: string,
  path: string,
  options: LinkRankingOptions
): { score: number; reasons: string[] } {
  const searchableText = normalizeText(`${text} ${path}`);
  const searchableTokens = new Set(tokenize(searchableText));

  const roleTerms = [
    ...new Set(
      tokenize(options.role ?? "").filter(
        (token) => !GENERIC_ROLE_WORDS.has(token)
      )
    ),
  ];

  const requirementPhrases = (options.requirements ?? [])
    .map((requirement) => normalizeText(requirement))
    .filter(Boolean);

  const requirementTerms = [
    ...new Set(
      requirementPhrases.flatMap((phrase) =>
        tokenize(phrase).filter(
          (token) => !GENERIC_REQUIREMENT_WORDS.has(token)
        )
      )
    ),
  ];

  const matchedRoleTerms = roleTerms.filter((term) =>
    searchableTokens.has(term)
  );

  const matchedRequirementTerms = requirementTerms.filter((term) =>
    searchableTokens.has(term)
  );

  const matchedPhrases = requirementPhrases.filter((phrase) => {
    const meaningfulTerms = tokenize(phrase).filter(
      (token) => !GENERIC_REQUIREMENT_WORDS.has(token)
    );

    return (
      meaningfulTerms.length >= 2 &&
      searchableText.includes(phrase)
    );
  });

  // Cap each contribution so long job descriptions cannot dominate ranking.
   const roleScore = Math.min(matchedRoleTerms.length * 4, 12);
   const requirementScore = Math.min(
     matchedRequirementTerms.length * 4,
     20
   );
   const phraseScore = Math.min(matchedPhrases.length * 6, 18);

   const score = Math.min(
     roleScore + requirementScore + phraseScore,
     30
   );

  const reasons: string[] = [];

  if (matchedRoleTerms.length > 0) {
    reasons.push(
      `Matches role terms: ${matchedRoleTerms.slice(0, 5).join(", ")}`
    );
  }

  if (matchedRequirementTerms.length > 0) {
    reasons.push(
      `Matches job requirements: ${matchedRequirementTerms
        .slice(0, 5)
        .join(", ")}`
    );
  }

  if (matchedPhrases.length > 0) {
    reasons.push(
      `Matches requirement phrases: ${matchedPhrases
        .slice(0, 3)
        .join("; ")}`
    );
  }

  return { score, reasons };
}

function getCategoryPriority(
  category: ResearchLinkCategory
): number {
  return CATEGORY_PRIORITY.indexOf(category);
}

function normalizeUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    url.hash = "";

    // Remove common tracking parameters before deduplication.
    for (const key of [...url.searchParams.keys()]) {
      if (
        key.toLowerCase().startsWith("utm_") ||
        ["fbclid", "gclid", "ref"].includes(key.toLowerCase())
      ) {
        url.searchParams.delete(key);
      }
    }

    if (url.pathname.length > 1) {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }

    return url.toString();
  } catch {
    return null;
  }
}

export function rankCompanyLinks(
  links: PageLink[],
  maxResults = 30,
  options: LinkRankingOptions = {}
): RankedPageLink[] {
  const safeMaxResults = Math.max(
    0,
    Math.min(Math.floor(maxResults), 100)
  );

  if (safeMaxResults === 0) {
    return [];
  }

  // Keep the highest-scoring entry for each normalized URL.
  const rankedByUrl = new Map<string, RankedPageLink>();

  for (const link of links) {
    const normalizedUrl = normalizeUrl(link.url);

    if (!normalizedUrl) {
      continue;
    }

    const text = normalizeText(link.text);
    const path = normalizeText(
      new URL(normalizedUrl).pathname
    );

    if (IRRELEVANT_LINK_PATTERN.test(text)) {
      continue;
    }

    let bestCategory: ResearchLinkCategory | null = null;
    let bestCategoryScore = -1;
    let bestReasons: string[] = [];

    for (const category of CATEGORY_PRIORITY) {
      const result = getCategoryScore(category, text, path);

      if (result.score > bestCategoryScore) {
        bestCategory = category;
        bestCategoryScore = result.score;
        bestReasons = result.reasons;
      }
    }

    if (!bestCategory || bestCategoryScore <= 0) {
      continue;
    }

    const roleRelevance = getRoleRelevance(
      text,
      path,
      options
    );

    const score =
      bestCategoryScore +
      roleRelevance.score +
      (link.sameOrigin ? 5 : 0);

    const reasons = [
      ...bestReasons,
      ...roleRelevance.reasons,
    ];

    if (link.sameOrigin) {
      reasons.push("Official company website link");
    }

    const candidate: RankedPageLink = {
      ...link,
      url: normalizedUrl,
      category: bestCategory,
      score,
      reasons,
    };

    const existing = rankedByUrl.get(normalizedUrl);

    if (!existing || candidate.score > existing.score) {
      rankedByUrl.set(normalizedUrl, candidate);
    }
  }

  return [...rankedByUrl.values()]
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      if (a.sameOrigin !== b.sameOrigin) {
        return a.sameOrigin ? -1 : 1;
      }

      return (
        getCategoryPriority(a.category) -
        getCategoryPriority(b.category)
      );
    })
    .slice(0, safeMaxResults);
}
