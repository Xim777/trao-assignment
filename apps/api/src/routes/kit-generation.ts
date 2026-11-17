import { Router } from "express";
import { z } from "zod";
import {
  ExtractedRoleSchema,
  CompanyResearchResultSchema,
  generateInterviewKit,
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

    try {
      const kit = await generateInterviewKit({
        ...parsed.data,
        generateJson: dependencies.generateJson
      });

      return res.status(200).json({
        success: true,
        kit,
        // Keep the existing top-level response fields for current API clients.
        ...kit
      });
    } catch (error) {
      console.error("Interview kit generation failed:", error);

      const isValidationError = error instanceof Error &&
        error.message.includes("Appendix A validation");

      return res.status(502).json({
        success: false,
        error: isValidationError ? "INVALID_GENERATED_KIT" : "GENERATION_FAILED",
        message: error instanceof Error
          ? error.message
          : "Interview kit generation failed."
      });
    }
  });

  return router;
}
