
import type {
  SearchProvider,
  SearchProviderResult
} from "@prepkit/core";

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const DEFAULT_TIMEOUT_MS = 15000;

interface TavilyProviderOptions {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class TavilyApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = "TavilyApiError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function getApiErrorMessage(payload: unknown): string {
  if (!isRecord(payload)) {
    return "Tavily API request failed.";
  }

  const detail = payload.detail;

  if (isRecord(detail) && typeof detail.error === "string") {
    return detail.error;
  }

  if (Array.isArray(detail)) {
    const firstError = detail.find(isRecord);

    if (firstError && typeof firstError.msg === "string") {
      return firstError.msg;
    }
  }

  if (typeof payload.message === "string") {
    return payload.message;
  }

  return "Tavily API request failed.";
}

function mapResults(payload: unknown): SearchProviderResult[] {
  if (!isRecord(payload) || !Array.isArray(payload.results)) {
    throw new TavilyApiError(
      "Tavily returned an invalid response format."
    );
  }
  return payload.results.flatMap((item): SearchProviderResult[] => {
      if (
        !isRecord(item) ||
        typeof item.url !== "string" ||
        typeof item.title !== "string"
      ) {
        return [];
      }

      return [{
        title: item.title,
        url: item.url,
        snippet:
          typeof item.content === "string"
            ? item.content
            : undefined,
        publishedAt:
          typeof item.published_date === "string"
            ? item.published_date
            : undefined
      }];
    });
}

export function createTavilySearchProvider(
  options: TavilyProviderOptions = {}
): SearchProvider {
  const fetchImpl = options.fetchImpl ?? fetch;

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    name: "tavily",

    async search({ query, limit }) {
      const apiKey = (
        options.apiKey ?? process.env.TAVILY_API_KEY
      )?.trim();

      if (!apiKey) {
        throw new TavilyApiError(
          "TAVILY_API_KEY is not configured.",
          undefined,
          "MISSING_API_KEY"
        );
      }

      if (!query.trim() || query.length > 400) {
        throw new Error(
          "Search query must contain 1–400 characters."
        );
      }

      const maxResults = Math.min(
        20,
        Math.max(1, Math.floor(limit))
      );

      const controller = new AbortController();

      const timeout = setTimeout(
        () => controller.abort(),
        timeoutMs
      );

      let response: Response;

      try {
        response = await fetchImpl(TAVILY_SEARCH_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            query,
            search_depth: "basic",
            topic: "general",
            max_results: maxResults,
            include_answer: false,
            include_raw_content: false,
            include_published_date: true
          }),
          signal: controller.signal
        });
      } catch (error) {
        if (controller.signal.aborted) {
          throw new TavilyApiError(
            "Tavily search request timed out.",
            undefined,
            "ETIMEDOUT"
          );
        }

        throw error;
      } finally {
        clearTimeout(timeout);
      }

      let payload: unknown;

      try {
        payload = await response.json();
      } catch {
        throw new TavilyApiError(
          "Tavily returned an invalid JSON response.",
          response.status
        );
      }

      if (!response.ok) {
        throw new TavilyApiError(
          getApiErrorMessage(payload),
          response.status
        );
      }

      return mapResults(payload);
    }
  };
}
