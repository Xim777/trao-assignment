import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";

import {
  checkRobotsAccess,
  fetchAndExtractPage
} from "./page-extractor.js";

import {
  evaluateSitePolicy
} from "./site-policy.js";

import type {
  ExtractedPage
} from "./page-extractor.js";

vi.mock("./page-extractor.js", () => ({
  checkRobotsAccess: vi.fn(),
  fetchAndExtractPage: vi.fn()
}));

const mockCheckRobotsAccess = vi.mocked(checkRobotsAccess);
const mockFetchAndExtractPage = vi.mocked(fetchAndExtractPage);

const homepageUrl = "https://acme.example/";
const termsUrl = "https://acme.example/terms-of-service";

function makePage(
  overrides: Partial<ExtractedPage> = {}
): ExtractedPage {
  return {
    url: homepageUrl,
    title: "Acme",
    description: "",
    text: "",
    links: [],
    ...overrides
  };
}

describe("evaluateSitePolicy", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mockCheckRobotsAccess.mockResolvedValue({
      robotsUrl: "https://acme.example/robots.txt",
      allowed: true,
      crawlDelayMs: 1000
    });
  });

  it("blocks a website when robots.txt disallows access", async () => {
    mockCheckRobotsAccess.mockResolvedValueOnce({
      robotsUrl: "https://acme.example/robots.txt",
      allowed: false,
      crawlDelayMs: 1000
    });

    const result = await evaluateSitePolicy(homepageUrl);

    expect(result.status).toBe("blocked");
    expect(result.robots.status).toBe("blocked");
    expect(mockFetchAndExtractPage).not.toHaveBeenCalled();
  });

  it("returns unknown when no terms link is found", async () => {
    mockFetchAndExtractPage.mockResolvedValueOnce(makePage());

    const result = await evaluateSitePolicy(homepageUrl);

    expect(result.status).toBe("unknown");
    expect(result.terms.status).toBe("not_found");
    expect(result.requiresManualReview).toBe(true);
  });

  it("blocks a website when its terms prohibit automated collection", async () => {
    mockFetchAndExtractPage
      .mockResolvedValueOnce(
        makePage({
          links: [{
            url: termsUrl,
            text: "Terms of Service",
            sameOrigin: true
          }]
        })
      )
      .mockResolvedValueOnce(
        makePage({
          url: termsUrl,
          title: "Terms of Service",
          text: "You may not use bots or other automated means to collect data from this website."
        })
      );

    const result = await evaluateSitePolicy(homepageUrl);

    expect(result.status).toBe("blocked");
    expect(result.terms.status).toBe("restricted");
    expect(result.terms.evidence.length).toBeGreaterThan(0);
  });

  it("allows crawling when no explicit restriction is detected", async () => {
    mockFetchAndExtractPage
      .mockResolvedValueOnce(
        makePage({
          links: [{
            url: termsUrl,
            text: "Terms of Service",
            sameOrigin: true
          }]
        })
      )
      .mockResolvedValueOnce(
        makePage({
          url: termsUrl,
          title: "Terms of Service",
          text: "These terms describe the use of the website and the services provided by Acme."
        })
      );

    const result = await evaluateSitePolicy(homepageUrl);

    expect(result.status).toBe("allowed");
    expect(result.terms.status).toBe("no_restriction_found");
  });

  it("requires manual review when the terms are ambiguous", async () => {
    mockFetchAndExtractPage
      .mockResolvedValueOnce(
        makePage({
          links: [{
            url: termsUrl,
            text: "Terms of Service",
            sameOrigin: true
          }]
        })
      )
      .mockResolvedValueOnce(
        makePage({
          url: termsUrl,
          title: "Terms of Service",
          text: "We use automated tools to monitor website activity."
        })
      );

    const result = await evaluateSitePolicy(homepageUrl);

    expect(result.status).toBe("unknown");
    expect(result.terms.status).toBe("ambiguous");
    expect(result.requiresManualReview).toBe(true);
  });

  it("reports unavailable when the terms page cannot be retrieved", async () => {
    mockFetchAndExtractPage
      .mockResolvedValueOnce(
        makePage({
          links: [{
            url: termsUrl,
            text: "Terms of Service",
            sameOrigin: true
          }]
        })
      )
      .mockRejectedValueOnce(new Error("Request timed out"));

    const result = await evaluateSitePolicy(homepageUrl);

    expect(result.status).toBe("unavailable");
    expect(result.terms.status).toBe("unavailable");
  });
});
