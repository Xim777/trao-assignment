import { describe, expect, it } from "vitest";

import {
  rankCompanyLinks
} from "./link-ranker.js";

import type {
  PageLink
} from "./page-extractor.js";

function makeLink(
  url: string,
  text: string,
  sameOrigin = true
): PageLink {
  return { url, text, sameOrigin };
}

describe("rankCompanyLinks", () => {
  it("prioritizes interview, hiring and company information links", () => {
    const links = [
      makeLink(
        "https://acme.example/about",
        "About Us"
      ),
      makeLink(
        "https://acme.example/careers",
        "Careers"
      ),
      makeLink(
        "https://acme.example/candidate/interview-process",
        "Interview Process"
      )
    ];

    const result = rankCompanyLinks(links);

    expect(result).toHaveLength(3);
    expect(result[0].category).toBe("interview_process");
    expect(result[1].category).toBe("hiring");
    expect(result[2].category).toBe("company_info");
  });

  it("discovers employee handbooks from URL paths", () => {
    const links = [
      makeLink(
        "https://acme.example/employee-handbook",
        "Read more"
      )
    ];

    const result = rankCompanyLinks(links);

    expect(result).toHaveLength(1);
    expect(result[0].category).toBe("culture");
  });

  it("recognizes engineering blogs", () => {
    const links = [
      makeLink(
        "https://acme.example/engineering/blog",
        "Engineering Blog"
      )
    ];

    const result = rankCompanyLinks(links);

    expect(result).toHaveLength(1);
    expect(result[0].category).toBe("engineering");
  });

  it("retains relevant external hiring links", () => {
    const links = [
      makeLink(
        "https://jobs.example.com/acme",
        "Careers",
        false
      )
    ];

    const result = rankCompanyLinks(links);

    expect(result).toHaveLength(1);
    expect(result[0].category).toBe("hiring");
    expect(result[0].sameOrigin).toBe(false);
  });

  it("ignores privacy, terms and login links", () => {
    const links = [
      makeLink(
        "https://acme.example/privacy",
        "Privacy Policy"
      ),
      makeLink(
        "https://acme.example/terms",
        "Terms of Service"
      ),
      makeLink(
        "https://acme.example/login",
        "Sign in"
      )
    ];

    expect(rankCompanyLinks(links)).toHaveLength(0);
  });

  it("ignores invalid URLs and unsupported protocols", () => {
    const links = [
      makeLink("not-a-url", "Careers"),
      makeLink("javascript:alert(1)", "Careers")
    ];

    expect(rankCompanyLinks(links)).toHaveLength(0);
  });

  it("respects the maximum result limit", () => {
    const links = [
      makeLink("https://acme.example/careers", "Careers"),
      makeLink("https://acme.example/about", "About Us"),
      makeLink(
        "https://acme.example/engineering",
        "Engineering"
      )
    ];

    expect(rankCompanyLinks(links, 2)).toHaveLength(2);
  });

  it("removes duplicate URLs", () => {
    const links = [
      makeLink("https://acme.example/careers", "Careers"),
      makeLink("https://acme.example/careers", "Jobs")
    ];

    expect(rankCompanyLinks(links)).toHaveLength(1);
  });

    it("keeps the more informative anchor for duplicate URLs", () => {
      const links = [
        makeLink(
          "https://acme.example/engineering",
          "Learn more"
        ),
        makeLink(
          "https://acme.example/engineering",
          "Engineering Blog"
        )
      ];

      const result = rankCompanyLinks(links);

      expect(result).toHaveLength(1);
      expect(result[0].category).toBe("engineering");
      expect(result[0].text).toBe("Engineering Blog");
    });
});

describe("role-aware ranking", () => {
  it("prioritizes links matching the extracted job requirements", () => {
    const links: PageLink[] = [
      {
        url: "https://example.com/engineering",
        text: "Engineering Blog",
        sameOrigin: true,
      },
      {
        url: "https://example.com/engineering/database-optimization",
        text: "PostgreSQL Database Optimization Guide",
        sameOrigin: true,
      },
    ];

    const ranked = rankCompanyLinks(links, 10, {
      role: "Backend Software Engineer",
      requirements: [
        "PostgreSQL",
        "Database optimization",
        "REST APIs",
      ],
    });

    expect(ranked[0].text).toBe(
      "PostgreSQL Database Optimization Guide"
    );
    expect(ranked[0].reasons.join(" ")).toContain(
      "Matches job requirements"
    );
  });

  it("works with a different role and different requirements", () => {
    const links: PageLink[] = [
      {
        url: "https://example.com/engineering/api",
        text: "REST API Engineering Guide",
        sameOrigin: true,
      },
      {
        url: "https://example.com/engineering/ml-model-training",
        text: "PyTorch Model Training Guide",
        sameOrigin: true,
      },
    ];

    const ranked = rankCompanyLinks(links, 10, {
      role: "Machine Learning Engineer",
      requirements: [
        "PyTorch",
        "Model training",
        "Computer vision",
      ],
    });

    expect(ranked[0].text).toBe("PyTorch Model Training Guide");
    expect(ranked[0].reasons.join(" ")).toContain(
      "Matches job requirements"
    );
  });

   it("remains compatible when role options are not provided", () => {
     const links: PageLink[] = [
        {
          url: "https://example.com/engineering",
          text: "Engineering Blog",
          sameOrigin: true,
        },
        {
          url: "https://example.com/careers",
          text: "Careers",
          sameOrigin: true,
        },
      ];

      const ranked = rankCompanyLinks(links, 10);

      expect(ranked).toHaveLength(2);
      expect(ranked.some((link) => link.category === "engineering")).toBe(true);
      expect(ranked.some((link) => link.category === "hiring")).toBe(true);

      for (const link of ranked) {
        expect(
          link.reasons.some((reason) =>
            reason.startsWith("Matches role terms")
          )
        ).toBe(false);
      }
    });

  it("does not add role relevance reasons when no role is supplied", () => {
    const links: PageLink[] = [
      {
        url: "https://example.com/engineering",
        text: "Engineering Blog",
        sameOrigin: true,
      },
    ];

    const ranked = rankCompanyLinks(links);

    expect(
      ranked[0].reasons.some((reason) =>
        reason.startsWith("Matches role terms")
      )
    ).toBe(false);
  });
});
