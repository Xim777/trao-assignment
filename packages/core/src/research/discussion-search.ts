export type DiscussionSourceType =
  | "reddit"
  | "forum"
  | "review_site"
  | "blog"
  | "other";

export type DiscussionSearchStatus = "completed" | "partial" | "unavailable";

export interface SearchProviderResult {
  title: string;
  url: string;
  snippet?: string;
  publishedAt?: string;
}

export interface SearchProvider {
  name: string;
  search(input: { query: string; limit: number }): Promise<SearchProviderResult[]>;
}

export interface CompanyDiscussion {
  title: string;
  url: string;
  domain: string;
  snippet?: string;
  publishedAt?: string;
  sourceType: DiscussionSourceType;
  provider: string;
  matchedQueries: string[];
}

export interface SearchFailure {
  query: string;
  error: string;
}

export interface DiscussionSearchReport {
  company: string;
  role: string;
  searchedAt: string;
  status: DiscussionSearchStatus;
  queries: string[];
  results: CompanyDiscussion[];
  failures: SearchFailure[];
}

export interface DiscussionSearchOptions {
  maxResultsPerQuery?: number;
  maxTotalResults?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  delayBetweenQueriesMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_RESULTS_PER_QUERY = 5;
const DEFAULT_MAX_RESULTS = 20;
const DEFAULT_RETRIES = 2;
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_QUERY_DELAY_MS = 500;

function normalizeSearchTerm(value: string): string {
  return value.replace(/["\r\n]/g, " ").replace(/\s+/g, " ").trim();
}

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from",
  "in", "into", "is", "it", "of", "on", "or", "the", "to", "with",
  "years", "year", "experience", "experienced", "knowledge", "strong",
  "good", "working", "work", "using", "use"
]);

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9+#.]/g, " ")
    .split(/\s+/)
    .filter(token => token.length > 1 && !STOP_WORDS.has(token));
}

function containsToken(text: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, "i").test(text);
}

function normalizeUrl(input: string): URL | null {
  try {
    const url = new URL(input);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password
    ) return null;

    url.hash = "";
    // www is normally an alias of the apex host; canonicalise it for deduplication.
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");

    for (const key of [...url.searchParams.keys()]) {
      const normalizedKey = key.toLowerCase();
      if (
        normalizedKey.startsWith("utm_") ||
        ["fbclid", "gclid", "ref", "source", "mc_cid", "mc_eid"].includes(normalizedKey)
      ) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url;
  } catch {
    return null;
  }
}

function classifySource(domain: string): DiscussionSourceType {
  if (domain === "reddit.com" || domain.endsWith(".reddit.com")) return "reddit";
  if (domain === "teamblind.com" || domain.endsWith(".teamblind.com")) return "forum";
  if (
    domain === "glassdoor.com" || domain.endsWith(".glassdoor.com") ||
    domain === "fishbowlapp.com" || domain.endsWith(".fishbowlapp.com")
  ) return "review_site";
  if (
    domain === "medium.com" || domain.endsWith(".medium.com") ||
    domain === "dev.to" || domain === "substack.com" || domain.endsWith(".substack.com")
  ) return "blog";
  return "other";
}

function normalizePublishedAt(value?: string): string | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString();
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 300) : "Unknown search provider error.";
}

function isRetryableError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const details = error as { status?: unknown; statusCode?: unknown; code?: unknown };
  const status = Number(details.status ?? details.statusCode);
  if (status === 429 || status >= 500) return true;
  return ["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN"].includes(String(details.code));
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

async function searchWithRetry(
  provider: SearchProvider,
  query: string,
  limit: number,
  maxRetries: number,
  baseDelayMs: number,
  sleep: (ms: number) => Promise<void>
): Promise<SearchProviderResult[]> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await provider.search({ query, limit });
    } catch (error) {
      lastError = error;
      if (attempt === maxRetries || !isRetryableError(error)) break;
      await sleep(baseDelayMs * 2 ** attempt);
    }
  }
  throw lastError;
}

export function buildDiscussionQueries(company: string, role: string): string[] {
  const companyName = normalizeSearchTerm(company);
  const roleName = normalizeSearchTerm(role);
  if (!companyName || !roleName) throw new Error("Company name and role are required.");
  return [
    `"${companyName}" "${roleName}" interview experience`,
    `"${companyName}" interview process hiring`,
    `site:reddit.com "${companyName}" interview experience`,
    `site:teamblind.com "${companyName}" interview`,
    `site:glassdoor.com "${companyName}" interview experience`,
    `site:fishbowlapp.com "${companyName}" interview`
  ];
}

type RoleRelevance = "exact" | "related" | "general" | "mismatched";

/**
 * Role families are intentionally broad. They are used to identify clearly
 * different occupations, not to claim that every role in a family is identical.
 */
const ROLE_FAMILIES: Record<string, string[]> = {
  engineering: [
    "software engineer", "software developer", "backend engineer", "backend developer",
    "back end engineer", "back end developer", "frontend engineer", "frontend developer",
    "front end engineer", "front end developer", "full stack engineer", "full stack developer",
    "platform engineer", "site reliability engineer", "sre", "devops engineer",
    "data engineer", "machine learning engineer", "ml engineer", "ai engineer",
    "systems engineer", "mobile engineer", "android developer", "ios developer",
    "qa engineer", "quality assurance engineer", "test engineer", "security engineer",
    "cloud engineer", "infrastructure engineer", "embedded engineer"
  ],
  product: ["product manager", "product owner", "product analyst"],
  sales: ["sales representative", "account executive", "business development", "sales manager", "account manager"],
  design: ["product designer", "ux designer", "ui designer", "graphic designer", "interaction designer"],
  data: ["data scientist", "data analyst", "business analyst", "operations analyst", "financial analyst", "research analyst"],
  support: ["customer support", "customer service", "technical support", "support engineer"],
  operations: ["operations manager", "operations associate", "operations specialist", "operations analyst"],
  marketing: ["marketing manager", "marketing analyst", "growth marketer", "content strategist", "brand manager"],
  finance: ["financial analyst", "accountant", "investment analyst", "finance manager"],
  hr: ["human resources", "recruiter", "talent acquisition", "hr manager"],
  legal: ["legal counsel", "lawyer", "paralegal", "compliance analyst"]
};

function normalizedPhrase(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9+#]+/g, " ").replace(/\s+/g, " ").trim();
}

function phraseOccurs(text: string, phrase: string): boolean {
  return ` ${normalizedPhrase(text)} `.includes(` ${normalizedPhrase(phrase)} `);
}

function getRoleFamily(role: string): string | undefined {
  const normalizedRole = normalizedPhrase(role);
  for (const [family, phrases] of Object.entries(ROLE_FAMILIES)) {
    if (phrases.some(phrase => phraseOccurs(normalizedRole, phrase))) return family;
  }
  return undefined;
}

function getRoleRelevance(title: string, snippet: string, role: string): RoleRelevance {
  const normalizedRole = normalizedPhrase(role);
  const normalizedTitle = normalizedPhrase(title);
  const normalizedCombined = normalizedPhrase(`${title} ${snippet}`);

  // Exact role in the title is the strongest possible match. A mention only
  // in the snippet is weaker because snippets often describe several roles.
  if (normalizedRole && phraseOccurs(normalizedTitle, normalizedRole)) return "exact";
  if (normalizedRole && phraseOccurs(normalizedCombined, normalizedRole)) return "exact";

  const targetFamily = getRoleFamily(role);
  if (!targetFamily) return "general";

  // Only classify a result as a different occupation when its TITLE clearly
  // names another role. Incidental mentions in a snippet are not enough.
  const titleFamilies = new Set<string>();
  for (const [family, phrases] of Object.entries(ROLE_FAMILIES)) {
    if (phrases.some(phrase => phraseOccurs(normalizedTitle, phrase))) {
      titleFamilies.add(family);
    }
  }

  if (titleFamilies.has(targetFamily)) return "related";
  if (titleFamilies.size > 0 && !titleFamilies.has(targetFamily)) return "mismatched";

  // If the title is generic but the snippet clearly describes the target
  // occupational family, retain it as related rather than excluding it.
  const combinedHasTargetFamily = ROLE_FAMILIES[targetFamily].some(
    phrase => phraseOccurs(normalizedCombined, phrase)
  );
  if (combinedHasTargetFamily) return "related";

  // A generic company interview/process result remains useful background.
  return "general";
}

function getSenioritySignal(text: string): "intern" | "junior" | "senior" | "none" {
  const value = normalizedPhrase(text);
  if (/\b(intern|internship|summer intern|graduate trainee)\b/.test(value)) return "intern";
  if (/\b(staff|principal|director|head of|vice president|vp|distinguished)\b/.test(value)) return "senior";
  if (/\b(junior|entry level|entrylevel|new grad|new graduate|graduate)\b/.test(value)) return "junior";
  return "none";
}

function getSeniorityScore(title: string, role: string): number {
  const target = getSenioritySignal(role);
  const result = getSenioritySignal(title);
  if (target === "none" || result === "none" || target === result) return 0;

  // Seniority is a relevance adjustment, not a hard exclusion. Interview
  // formats and technical questions can still transfer across levels.
  if (target === "intern" && result === "senior") return -5;
  if (target === "senior" && result === "intern") return -5;
  return -3;
}

function getSourceQualityScore(title: string, snippet: string, sourceType: DiscussionSourceType): number {
  const text = `${title} ${snippet}`.toLowerCase();
  let score = 0;

  // Firsthand evidence is more useful than SEO-style preparation material.
  if (/\b(my|my own|personal)\b/.test(text)) score += 2;
  if (/\b(interview experience|interviewed at|i interviewed|my interview|candidate experience)\b/.test(text)) score += 5;
  if (/\b(asked me|they asked|round 1|round 2|onsite round|technical round|coding round|system design round)\b/.test(text)) score += 3;

  if (/\b(interview guide|interview questions|how to prepare|preparation guide|top questions)\b/.test(text)) score -= 3;
  if (/\b(company interview process|hiring process overview)\b/.test(text)) score -= 1;

  if (sourceType === "reddit" || sourceType === "forum") score += 1;
  if (sourceType === "review_site") score += 1;
  return score;
}

function calculateRelevanceScore(
  result: SearchProviderResult,
  role: string,
  requirements: string[],
  sourceType: DiscussionSourceType
): number {
  const title = result.title ?? "";
  const snippet = result.snippet ?? "";
  const url = result.url ?? "";
  const titleText = title.toLowerCase();
  const combinedText = `${title} ${snippet} ${url}`.toLowerCase();
  const roleRelevance = getRoleRelevance(title, snippet, role);

  let score = 0;

  // Role fit is deliberately dominant. A clearly unrelated occupation should
  // not beat an exact-role result merely because it shares technical keywords.
  if (roleRelevance === "exact") score += 40;
  else if (roleRelevance === "related") score += 22;
  else if (roleRelevance === "general") score += 7;
  else score -= 35;

  // Additional exact-role title signal, while avoiding repeated token bonuses
  // overwhelming the role-fit tier.
  if (phraseOccurs(titleText, role)) score += 8;
  else if (phraseOccurs(combinedText, role)) score += 3;

  // Requirements are supporting evidence only. Cap their contribution so
  // broad technology terms cannot overpower occupational relevance.
  let requirementScore = 0;
  for (const requirement of requirements) {
    const normalizedRequirement = normalizedPhrase(requirement);
    if (!normalizedRequirement) continue;
    if (phraseOccurs(titleText, normalizedRequirement)) {
      requirementScore += 2;
      continue;
    }
    if (phraseOccurs(combinedText, normalizedRequirement)) {
      requirementScore += 1;
      continue;
    }

    const requirementTokens = [...new Set(tokenize(requirement))];
    const matchingTokens = requirementTokens.filter(token => containsToken(combinedText, token));
    if (requirementTokens.length >= 2 && matchingTokens.length / requirementTokens.length >= 0.75) {
      requirementScore += 0.5;
    }
  }
  score += Math.min(6, requirementScore);

  if (/\b(interview|hiring process|technical round|coding round)\b/i.test(`${title} ${snippet}`)) score += 2;
  score += getSourceQualityScore(title, snippet, sourceType);
  score += getSeniorityScore(title, role);

  return score;
}

export async function searchCompanyDiscussions(
  input: { company: string; role: string; requirements?: string[] },
  provider: SearchProvider,
  options: DiscussionSearchOptions = {}
): Promise<DiscussionSearchReport> {
  const company = normalizeSearchTerm(input.company);
  const role = normalizeSearchTerm(input.role);
  const requirements = (input.requirements ?? []).map(normalizeSearchTerm).filter(Boolean).slice(0, 30);
  const queries = buildDiscussionQueries(company, role);

  const maxResultsPerQuery = boundedInteger(options.maxResultsPerQuery, DEFAULT_RESULTS_PER_QUERY, 1, 10);
  const maxTotalResults = boundedInteger(options.maxTotalResults, DEFAULT_MAX_RESULTS, 1, 100);
  const maxRetries = boundedInteger(options.maxRetries, DEFAULT_RETRIES, 0, 5);
  const baseDelayMs = boundedInteger(options.baseDelayMs, DEFAULT_BASE_DELAY_MS, 100, 10000);
  const queryDelayMs = boundedInteger(options.delayBetweenQueriesMs, DEFAULT_QUERY_DELAY_MS, 0, 10000);
  const sleep = options.sleep ?? defaultSleep;

  const resultsByUrl = new Map<string, CompanyDiscussion>();
  const failures: SearchFailure[] = [];

  for (let index = 0; index < queries.length; index++) {
    const query = queries[index];
    try {
      const providerResults = await searchWithRetry(provider, query, maxResultsPerQuery, maxRetries, baseDelayMs, sleep);
      for (const item of providerResults) {
        const url = normalizeUrl(item.url);
        if (!url) continue;

        const normalizedUrl = url.toString();
        const domain = url.hostname.toLowerCase();
        const title = item.title?.trim() || domain;
        const existing = resultsByUrl.get(normalizedUrl);

        if (existing) {
          if (!existing.snippet && item.snippet) existing.snippet = item.snippet.slice(0, 1200);
          if (!existing.publishedAt) existing.publishedAt = normalizePublishedAt(item.publishedAt);
          if (!existing.matchedQueries.includes(query)) existing.matchedQueries.push(query);
          continue;
        }

        resultsByUrl.set(normalizedUrl, {
          title: title.slice(0, 300),
          url: normalizedUrl,
          domain,
          snippet: item.snippet?.slice(0, 1200),
          publishedAt: normalizePublishedAt(item.publishedAt),
          sourceType: classifySource(domain),
          provider: provider.name,
          matchedQueries: [query]
        });
      }
    } catch (error) {
      failures.push({ query, error: getErrorMessage(error) });
    }

    if (index < queries.length - 1 && queryDelayMs > 0) await sleep(queryDelayMs);
  }

  const rankedResults = [...resultsByUrl.values()]
    .map((result, index) => ({
      result,
      index,
      score: calculateRelevanceScore(
        { title: result.title, url: result.url, snippet: result.snippet },
        role,
        requirements,
        result.sourceType
      )
    }))
    .sort((a, b) =>
      b.score - a.score ||
      (Date.parse(b.result.publishedAt ?? "") || 0) - (Date.parse(a.result.publishedAt ?? "") || 0) ||
      a.index - b.index
    )
    .map(item => item.result);

  let status: DiscussionSearchStatus = "completed";
  if (failures.length === queries.length) status = "unavailable";
  else if (failures.length > 0) status = "partial";

  return {
    company,
    role,
    searchedAt: new Date().toISOString(),
    status,
    queries,
    results: rankedResults.slice(0, maxTotalResults),
    failures
  };
}
