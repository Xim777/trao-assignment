import {
  CompanyResearchResultSchema,
  ExtractedRoleSchema,
  InterviewKitSchema,
  type CompanyResearchResult,
  type ExtractedRole,
  type InterviewKit,
  type JsonGenerator
} from "../index.js";
import { createStudySchedule } from "./study-schedule.js";
import { generateQuestionBank } from "./question-generator.js";
import { generateFlashcards } from "./flashcard-generator.js";
import { z } from "zod";

export interface GenerateInterviewKitInput {
  role: ExtractedRole;
  companyResearch: CompanyResearchResult;
  daysAvailable: number;
  generateJson: JsonGenerator;
}

/**
 * Runs the shared question, flashcard, scheduling and Appendix A validation
 * pipeline. The HTTP API and batch evaluator both call this function.
 */
export async function generateInterviewKit(
  input: GenerateInterviewKitInput
): Promise<InterviewKit> {
  const role = ExtractedRoleSchema.parse(input.role);
  const companyResearch = CompanyResearchResultSchema.parse(input.companyResearch);

  if (role.title !== companyResearch.source.role) {
    throw new Error("Role title must match the role used during company research.");
  }

  if (!Number.isInteger(input.daysAvailable) ||
      input.daysAvailable < 1 ||
      input.daysAvailable > 60) {
    throw new Error("daysAvailable must be an integer between 1 and 60.");
  }

  const companyBrief = {
    summary: companyResearch.company_brief.summary,
    what_they_do: companyResearch.company_brief.what_they_do
  };

  const generation = await generateQuestionBank({
    roleTitle: role.title,
    requirements: role.requirements,
    companyBrief,
    generateJson: input.generateJson
  });

  const flashcardGeneration = await generateFlashcards({
    roleTitle: role.title,
    requirements: role.requirements,
    questions: generation.questions,
    companyBrief,
    generateJson: input.generateJson
  });

  const schedule = createStudySchedule({
    requirements: role.requirements,
    questions: generation.questions,
    daysAvailable: input.daysAvailable
  });

  const candidate = {
    source: companyResearch.source,
    company_brief: {
      summary: companyResearch.company_brief.summary,
      what_they_do: companyResearch.company_brief.what_they_do,
      sources: companyResearch.company_brief.sources.map(source => source.url)
    },
    role,
    questions: generation.questions,
    flashcards: flashcardGeneration.flashcards,
    schedule,
    coverage: {
      uncovered_requirement_ids: generation.uncoveredRequirementIds,
      passes: generation.passes
    }
  };

  const parsed = InterviewKitSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(`Generated interview kit failed Appendix A validation: ${parsed.error.message}`);
  }

  return parsed.data;
}
