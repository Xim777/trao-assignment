
import { z } from "zod";

// --------------------------------------------------
// Shared validation
// --------------------------------------------------

const HttpUrlSchema = z
  .string()
  .url()
  .refine(
    value => {
      try {
        const protocol = new URL(value).protocol;
        return protocol === "http:" || protocol === "https:";
      } catch {
        return false;
      }
    },
    "Only HTTP and HTTPS URLs are allowed."
  );

const NonEmptyTextSchema = z.string().trim().min(1);

// --------------------------------------------------
// Input metadata
// --------------------------------------------------

export const CompanyResearchInputSchema = z.object({
  company: NonEmptyTextSchema.max(150),
  company_url: HttpUrlSchema,
  role: NonEmptyTextSchema.max(150),
  location: z.string().trim().max(150).default("Not specified"),
  jd_chars: z.number().int().nonnegative()
});

export type CompanyResearchInput = z.infer<
  typeof CompanyResearchInputSchema
>;

// --------------------------------------------------
// Source references used in the company brief
// --------------------------------------------------

export const CompanyBriefSourceSchema = z.object({
  title: NonEmptyTextSchema.max(300),
  url: HttpUrlSchema,

  source_type: z.enum([
    "official",
    "discussion"
  ]),

  description: z.string().trim().max(1000).optional()
});

export type CompanyBriefSource = z.infer<
  typeof CompanyBriefSourceSchema
>;

// --------------------------------------------------
// Company brief
// --------------------------------------------------

export const CompanyBriefSchema = z.object({
  summary: NonEmptyTextSchema.max(3000),

  what_they_do: NonEmptyTextSchema.max(3000),

  sources: z.array(CompanyBriefSourceSchema).max(30)
});

export type CompanyBrief = z.infer<
  typeof CompanyBriefSchema
>;

// --------------------------------------------------
// Research source records
// --------------------------------------------------

export const OfficialResearchSourceSchema = z.object({
  title: NonEmptyTextSchema.max(300),
  url: HttpUrlSchema,

  category: z.enum([
    "hiring",
    "interview_process",
    "engineering",
    "culture",
    "company_info"
  ]),

  text: z.string().max(20000)
});

export type OfficialResearchSource = z.infer<
  typeof OfficialResearchSourceSchema
>;

export const DiscussionResearchSourceSchema = z.object({
  title: NonEmptyTextSchema.max(300),
  url: HttpUrlSchema,

  source_type: z.enum([
    "reddit",
    "forum",
    "review_site",
    "blog",
    "other"
  ]),

  snippet: z.string().max(1200).optional(),
  published_at: z.string().datetime().optional()
});

export type DiscussionResearchSource = z.infer<
  typeof DiscussionResearchSourceSchema
>;

// --------------------------------------------------
// Research failures and status
// --------------------------------------------------

export const ResearchFailureSchema = z.object({
  stage: z.enum([
    "website_crawl",
    "discussion_search",
    "company_brief"
  ]),

  source_url: HttpUrlSchema.optional(),

  message: NonEmptyTextSchema.max(500)
});

export type ResearchFailure = z.infer<
  typeof ResearchFailureSchema
>;

export const ResearchMetadataSchema = z.object({
  crawl_status: z.enum([
    "completed",
    "partial",
    "blocked",
    "manual_review"
  ]),

  discussion_status: z.enum([
    "completed",
    "partial",
    "unavailable"
  ]),

  official_sources: z.array(
    OfficialResearchSourceSchema
  ),

  discussion_sources: z.array(
    DiscussionResearchSourceSchema
  ),

  failures: z.array(ResearchFailureSchema),

  limitations: z.array(
    z.string().trim().max(500)
  )
});

export type ResearchMetadata = z.infer<
  typeof ResearchMetadataSchema
>;

// --------------------------------------------------
// Required source object (Appendix A)
// --------------------------------------------------

export const CompanyResearchSourceSchema = z.object({
  company: NonEmptyTextSchema.max(150),
  company_url: HttpUrlSchema,
  role: NonEmptyTextSchema.max(150),
  location: z.string().trim().max(150),

  jd_chars: z.number().int().nonnegative(),

  researched_at: z.string().datetime(),

  pages_used: z.array(HttpUrlSchema)
});

export type CompanyResearchSource = z.infer<
  typeof CompanyResearchSourceSchema
>;

// --------------------------------------------------
// Complete aggregated company research result
// --------------------------------------------------

export const CompanyResearchResultSchema = z.object({
  source: CompanyResearchSourceSchema,

  company_brief: CompanyBriefSchema,

  research: ResearchMetadataSchema
}).superRefine((result, ctx) => {
  const collectedUrls = new Set([
    ...result.source.pages_used,
    ...result.research.official_sources.map(
      source => source.url
    ),
    ...result.research.discussion_sources.map(
      source => source.url
    )
  ]);

  result.company_brief.sources.forEach((source, index) => {
    if (!collectedUrls.has(source.url)) {
      ctx.addIssue({
        code: "custom",
        path: ["company_brief", "sources", index, "url"],
        message: "This citation does not exist in the collected research sources."
      });
    }

    const officialExists = result.research.official_sources
      .some(item => item.url === source.url);

    const discussionExists = result.research.discussion_sources
      .some(item => item.url === source.url);

    if (
      source.source_type === "official" &&
      !officialExists
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["company_brief", "sources", index, "source_type"],
        message: "Official citation must reference an official research source."
      });
    }

    if (
      source.source_type === "discussion" &&
      !discussionExists
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["company_brief", "sources", index, "source_type"],
        message: "Discussion citation must reference a discussion research source."
      });
    }
  });
});

export type CompanyResearchResult = z.infer<
  typeof CompanyResearchResultSchema
>;
