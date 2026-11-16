import { load } from "cheerio";
import robotsParser from "robots-parser";
import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";

const USER_AGENT = "TraoInterviewPrepBot/1.0";

const DEFAULT_DELAY_MS = 1000;
const REQUEST_TIMEOUT_MS = 10000;
const MAX_PAGE_BYTES = 1_000_000;
const MAX_ROBOTS_BYTES = 512_000;
const MAX_TEXT_CHARS = 20000;
const MAX_REDIRECTS = 4;
const MAX_RETRIES = 3;

export interface PageLink {
  url: string;
  text: string;
  sameOrigin: boolean;
}

export interface RobotsAccess {
  robotsUrl: string;
  allowed: boolean;
  crawlDelayMs: number;
}

export interface ExtractedPage {
  url: string;
  title: string;
  description: string;
  text: string;
  links: PageLink[];
}

type RobotsPolicy = ReturnType<typeof robotsParser>;

const robotsCache = new Map<string, Promise<RobotsPolicy>>();
const lastRequestAt = new Map<string, number>();
const requestQueues = new Map<string, Promise<void>>();

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ----------------------------------
// URL validation
// ----------------------------------

function parseHttpUrl(input: string): URL {
  const url = new URL(input);

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only HTTP and HTTPS URLs are supported.");
  }

  if (url.username || url.password) {
    throw new Error("URLs containing credentials are not allowed.");
  }

  url.hash = "";

  return url;
}

async function assertSafeUrl(url: URL): Promise<void> {
  // Local addresses are permitted during development and
  // local evaluation, but not in production.
  if (process.env.NODE_ENV !== "production") {
    return;
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");

  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  ) {
    throw new Error("Private and local hosts are not allowed.");
  }

  if (
    url.port &&
    !(
      (url.protocol === "http:" && url.port === "80") ||
      (url.protocol === "https:" && url.port === "443")
    )
  ) {
    throw new Error("Non-standard ports are not allowed in production.");
  }

  const addresses = await lookup(hostname, {
    all: true,
    verbatim: true
  });

  if (!addresses.length) {
    throw new Error("Unable to resolve the company website.");
  }

  for (const entry of addresses) {
    if (ipaddr.process(entry.address).range() !== "unicast") {
      throw new Error("Private or non-public IP addresses are not allowed.");
    }
  }
}

// ----------------------------------
// Per-host rate limiting
// ----------------------------------

async function rateLimitedRequest<T>(
  url: URL,
  delayMs: number,
  operation: () => Promise<T>
): Promise<T> {
  const host = url.host;

  const previous = requestQueues.get(host) ?? Promise.resolve();

  let release!: () => void;

  const gate = new Promise<void>(resolve => {
    release = resolve;
  });

  const queued = previous.then(() => gate);

  requestQueues.set(host, queued);

  await previous;

  try {
    const last = lastRequestAt.get(host) ?? 0;
    const elapsed = Date.now() - last;

    if (elapsed < delayMs) {
      await sleep(delayMs - elapsed);
    }

    lastRequestAt.set(host, Date.now());

    return await operation();
  } finally {
    release();

    if (requestQueues.get(host) === queued) {
      requestQueues.delete(host);
    }
  }
}

// ----------------------------------
// HTTP fetching with retries
// ----------------------------------

function getRetryDelay(
  response: Response,
  attempt: number
): number {
  const retryAfter = response.headers.get("retry-after");

  if (retryAfter) {
    const seconds = Number(retryAfter);

    if (Number.isFinite(seconds)) {
      return Math.min(10000, Math.max(0, seconds * 1000));
    }

    const date = Date.parse(retryAfter);

    if (Number.isFinite(date)) {
      return Math.min(10000, Math.max(0, date - Date.now()));
    }
  }

  return Math.min(8000, 500 * 2 ** attempt);
}

async function fetchWithRetry(
  url: URL,
  delayMs: number
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await rateLimitedRequest(
        url,
        delayMs,
        () =>
          fetch(url, {
            method: "GET",
            redirect: "manual",
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            headers: {
              "User-Agent": USER_AGENT,
              Accept: "text/html,application/xhtml+xml,text/plain"
            }
          })
      );

      if (
        response.status === 429 ||
        response.status >= 500
      ) {
        if (attempt < MAX_RETRIES - 1) {
          const wait = getRetryDelay(response, attempt);

          if (response.body) {
            await response.body.cancel();
          }

          await sleep(wait);
          continue;
        }
      }

      return response;
    } catch (error) {
      lastError = error;

      if (attempt < MAX_RETRIES - 1) {
        await sleep(500 * 2 ** attempt);
      }
    }
  }

  throw lastError ?? new Error("Website request failed.");
}

// ----------------------------------
// Safe redirect handling
// ----------------------------------

async function fetchFollowingRedirects(
  initialUrl: URL,
  delayMs: number,
  enforceRobots = false
): Promise<{ response: Response; finalUrl: URL }> {
  let currentUrl = new URL(initialUrl);

  for (let count = 0; count <= MAX_REDIRECTS; count++) {
  if (enforceRobots) {
      const access = await checkRobotsAccess(currentUrl.href);

      if (!access.allowed) {
        throw new Error(
          "Page or redirect target is disallowed by robots.txt."
        );
      }
      delayMs = Math.max(delayMs, access.crawlDelayMs);

    } else {
      await assertSafeUrl(currentUrl);
    }

    const response = await fetchWithRetry(currentUrl, delayMs);

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");

      if (!location) {
        throw new Error("Redirect response has no location.");
      }

      const nextUrl = new URL(location, currentUrl);

      // Do not follow redirects to another origin.
      if (nextUrl.origin !== initialUrl.origin) {
        throw new Error("Cross-origin redirects are not followed.");
      }

      currentUrl = nextUrl;
      continue;
    }

    return {
      response,
      finalUrl: currentUrl
    };
  }

  throw new Error("Too many redirects.");
}

// ----------------------------------
// Read response with a size limit
// ----------------------------------

async function readLimitedText(
  response: Response,
  maxBytes: number
): Promise<string> {
  const declaredLength = Number(
    response.headers.get("content-length")
  );

  if (
    Number.isFinite(declaredLength) &&
    declaredLength > maxBytes
  ) {
    throw new Error("Response exceeds the allowed size.");
  }

  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) break;

    totalBytes += value.byteLength;

    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new Error("Response exceeds the allowed size.");
    }

    chunks.push(value);
  }

  const buffer = new Uint8Array(totalBytes);

  let offset = 0;

  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(buffer);
}

// ----------------------------------
// Robots.txt
// ----------------------------------

async function getRobotsPolicy(
  url: URL
): Promise<RobotsPolicy> {
  const cacheKey = url.origin;

  const cached = robotsCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const robotsUrl = new URL("/robots.txt", url.origin);

  const policyPromise = (async () => {
    const { response } = await fetchFollowingRedirects(
      robotsUrl,
      DEFAULT_DELAY_MS
    );

    // A missing robots.txt means no robots rules were published.
    if (
      response.status === 404 ||
      response.status === 410
    ) {
      return robotsParser(robotsUrl.href, "");
    }

    // If robots.txt cannot be retrieved reliably,
    // do not crawl the website.
    if (!response.ok) {
      throw new Error(
        `Unable to retrieve robots.txt: HTTP ${response.status}`
      );
    }

    const content = await readLimitedText(
      response,
      MAX_ROBOTS_BYTES
    );

    return robotsParser(robotsUrl.href, content);
  })();

  robotsCache.set(cacheKey, policyPromise);

  try {
    return await policyPromise;
  } catch (error) {
    robotsCache.delete(cacheKey);
    throw error;
  }
}


export async function checkRobotsAccess(
  inputUrl: string
): Promise<RobotsAccess> {
  const url = parseHttpUrl(inputUrl);

  await assertSafeUrl(url);

  const robots = await getRobotsPolicy(url);

  const specifiedDelay = robots.getCrawlDelay(USER_AGENT);

  return {
    robotsUrl: new URL("/robots.txt", url.origin).href,
    allowed: robots.isAllowed(url.href, USER_AGENT) !== false,
    crawlDelayMs: Math.max(
      DEFAULT_DELAY_MS,
      (specifiedDelay ?? 0) * 1000
    )
  };
}


// ----------------------------------
// Extract links from HTML
// ----------------------------------

function extractLinks(
  $: ReturnType<typeof load>,
  baseUrl: URL
): PageLink[] {
  const links = new Map<string, PageLink>();

  $("a[href]").each((_, element) => {
    const anchor = $(element);

    const href = anchor.attr("href");

    if (!href) return;

    try {
      const url = new URL(href, baseUrl);

      if (!["http:", "https:"].includes(url.protocol)) {
        return;
      }

      const sameOrigin = url.origin === baseUrl.origin;

      url.hash = "";

      if (
        /\.(pdf|png|jpg|jpeg|gif|svg|css|js|zip|woff2?)$/i
          .test(url.pathname)
      ) {
        return;
      }

      const normalizedUrl = url.toString();

      if (links.has(normalizedUrl)) return;

      const text =
        anchor.text().replace(/\s+/g, " ").trim() ||
        anchor.attr("aria-label") ||
        anchor.attr("title") ||
        "";

      links.set(normalizedUrl, {
        url: normalizedUrl,
        text: text.trim(),
        sameOrigin
      });
    } catch {
      // Ignore malformed links.
    }
  });

  return Array.from(links.values());
}

// ----------------------------------
// Public page extraction function
// ----------------------------------


export async function fetchAndExtractPage(
  inputUrl: string
): Promise<ExtractedPage> {
  const url = parseHttpUrl(inputUrl);

  // Check whether robots.txt permits access.
  const robotsAccess = await checkRobotsAccess(url.href);

  if (!robotsAccess.allowed) {
    throw new Error("Page is disallowed by robots.txt.");
  }

  // Fetch the page while checking robots.txt
  // before following every redirect.
  const { response, finalUrl } =
    await fetchFollowingRedirects(
      url,
      DEFAULT_DELAY_MS,
      true
    );

  if (!response.ok) {
    throw new Error(
      `Website returned HTTP ${response.status}.`
    );
  }

  const contentType =
    response.headers.get("content-type")?.toLowerCase() ?? "";

  if (
    !contentType.includes("text/html") &&
    !contentType.includes("application/xhtml+xml")
  ) {
    throw new Error("Website did not return an HTML page.");
  }

  const html = await readLimitedText(
    response,
    MAX_PAGE_BYTES
  );

  const $ = load(html);

  // Extract links before removing navigation elements.
  const links = extractLinks($, finalUrl);

  const title =
    $("title").first().text().trim() ||
    $("h1").first().text().trim();

  const description =
    $('meta[name="description"]').attr("content")?.trim() ||
    $('meta[property="og:description"]').attr("content")?.trim() ||
    "";

  // Remove elements that do not contain useful page content.
  $(
    "script, style, noscript, svg, iframe, canvas, nav, footer, header, form"
  ).remove();

  const text = $("body")
    .text()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXT_CHARS);

  return {
    url: finalUrl.href,
    title,
    description,
    text,
    links
  };
}
