import { Router } from "express";
import { z } from "zod";
import {
  createStudySchedule,
  ExtractedRoleSchema,
  generateQuestionBank,
  CompanyResearchResultSchema,
  type JsonGenerator
} from "@prepkit/core";

const GenerateKitInputSchema = z.object({
  role: ExtractedRoleSchema,
  companyResearch: CompanyResearchResultSchema,
  daysAvailable: z.number().int().min(1).max(60)
}).strict().superRefine((input, ctx) => {
  if (input.role.title !== input.companyResearch.source.role) {
    ctx.addIssue({
      code: "custom",
      path: ["role", "title"],
      message: "Role title must match the role used during company research."
    });
  }
});

export interface KitGenerationRouterDependencies {
  generateJson: JsonGenerator;
}

export function createKitGenerationRouter(
  dependencies: KitGenerationRouterDependencies
): Router {
  const router = Router();

  router.post("/generate", async (req, res) => {
    const parsed = GenerateKitInputSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: "INVALID_INPUT",
        details: parsed.error.flatten()
      });
    }

    const { role, companyResearch, daysAvailable } = parsed.data;

    try {
      const generation = await generateQuestionBank({
        roleTitle: role.title,
        requirements: role.requirements,
        companyBrief: {
          summary: companyResearch.company_brief.summary,
          what_they_do: companyResearch.company_brief.what_they_do
        },
        generateJson: dependencies.generateJson
      });

      const schedule = createStudySchedule({
        requirements: role.requirements,
        questions: generation.questions,
        daysAvailable
      });

      return res.status(200).json({
        success: true,
        questions: generation.questions,
        schedule,
        coverage: {
          uncovered_requirement_ids: generation.uncoveredRequirementIds,
          passes: generation.passes
        }
      });
    } catch (error) {
      console.error("Interview kit generation failed:", error);

      return res.status(502).json({
        success: false,
        error: "GENERATION_FAILED",
        message: error instanceof Error
          ? error.message
          : "Interview kit generation failed."
      });
    }
  });

  return router;
}
