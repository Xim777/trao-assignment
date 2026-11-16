
import { describe, it, expect, vi } from "vitest";
import {
  createTavilySearchProvider,
  TavilyApiError
} from "../src/services/search/tavily-provider.js";

describe("Tavily Search Provider", () => {
  it("sends a search request and maps results correctly", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              title: "Backend Engineer Interview",
              url: "https://example.com/interview",
              content: "Candidates reported three technical rounds.",
              published_date: "2026-10-10"
            }
          ]
        }),
        { status: 200 }
      )
    );

    const provider = createTavilySearchProvider({
      apiKey: "test-api-key",
      fetchImpl: fetchMock
    });

    const results = await provider.search({
      query: "Example company backend interview",
      limit: 5
    });

    expect(results).toEqual([
      {
        title: "Backend Engineer Interview",
        url: "https://example.com/interview",
        snippet: "Candidates reported three technical rounds.",
        publishedAt: "2026-10-10"
      }
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchMock.mock.calls[0]!;

    expect(url).toBe("https://api.tavily.com/search");
    expect(options?.method).toBe("POST");
    expect(options?.headers).toMatchObject({
      Authorization: "Bearer test-api-key",
      "Content-Type": "application/json"
    });

    const body = JSON.parse(options?.body as string);

    expect(body.query).toBe("Example company backend interview");
    expect(body.search_depth).toBe("basic");
    expect(body.max_results).toBe(5);
  });

  it("throws when the API key is missing", async () => {
    const provider = createTavilySearchProvider({
      apiKey: " "
    });

    await expect(
      provider.search({ query: "test", limit: 5 })
    ).rejects.toThrow("TAVILY_API_KEY is not configured.");
  });

  it("throws when Tavily returns an API error", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          message: "Rate limit exceeded"
        }),
        { status: 429 }
      )
    );

    const provider = createTavilySearchProvider({
      apiKey: "test-api-key",
      fetchImpl: fetchMock
    });

    await expect(
      provider.search({ query: "test", limit: 5 })
    ).rejects.toMatchObject({
      name: "TavilyApiError",
      status: 429
    });
  });

  it("throws when Tavily returns an invalid response format", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ results: "invalid" }),
        { status: 200 }
      )
    );

    const provider = createTavilySearchProvider({
      apiKey: "test-api-key",
      fetchImpl: fetchMock
    });

    await expect(
      provider.search({ query: "test", limit: 5 })
    ).rejects.toThrow("Tavily returned an invalid response format.");
  });

  it("ignores malformed individual results", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            null,
            { title: "Invalid result" },
            {
              title: "Valid result",
              url: "https://example.com",
              content: "A valid result."
            }
          ]
        }),
        { status: 200 }
      )
    );

    const provider = createTavilySearchProvider({
      apiKey: "test-api-key",
      fetchImpl: fetchMock
    });

    const results = await provider.search({
      query: "test",
      limit: 5
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe("Valid result");
  });
});
