import { z } from "zod";

export const RequirementSchema = z.object({
  id: z.string().min(1),

  text: z.string().min(1),

  kind: z.enum([
    "technical",
    "behavioural",
    "domain"
  ]),

  priority: z.enum([
    "must",
    "nice"
  ])
}).strict();


const QuestionSchema = z.object({
  id: z.string().min(1),

  requirement_ids: z.array(z.string()).min(1).min(1),

  category: z.enum([
    "technical",
    "behavioural",
    "system-design",
    "company-fit"
  ]),

  prompt: z.string().min(1),

  answer_outline: z.string(),

  difficulty: z.number().int().min(1).max(3)
}).strict();


const FlashcardSchema = z.object({
  id: z.string().min(1),

  front: z.string().min(1),

  back: z.string().min(1),

  requirement_ids: z.array(z.string())
}).strict();


const ScheduleDaySchema = z.object({
  day: z.number().int().min(1),

  focus: z.string().min(1),

  question_ids: z.array(z.string()),

  minutes: z.number().int().min(1)
}).strict();

const ScheduleSchema = z.object({
  days_available: z.number().int().min(1),

  days: z.array(ScheduleDaySchema)
}).strict();

const SourceSchema = z.object({
    company: z.string(),

    company_url: z.string().url(),

    role: z.string(),

    location: z.string(),

    jd_chars: z.number().int().min(0),

    researched_at: z.string(),

    pages_used: z.array(z.string().url())
  }).strict()

const CompanyBriefSchema = z.object({
    summary: z.string(),

    what_they_do: z.string(),

    sources: z.array(z.string().url())
  }).strict()

const RoleSchema = z.object({
        title: z.string(),

        seniority: z.string(),

        responsibilities: z.array(z.string()),

        requirements: z.array(RequirementSchema)
  }).strict()

const InterviewKitBaseSchema = z.object({

  source: SourceSchema,

  role: RoleSchema,

  company_brief:CompanyBriefSchema,

  questions: z.array(QuestionSchema),

  flashcards: z.array(FlashcardSchema),

  schedule: ScheduleSchema,

  coverage: z.object({
    uncovered_requirement_ids: z.array(z.string()),

    passes: z.number().int().min(1)
  }).strict()

}).strict();

export const InterviewKitSchema =
  InterviewKitBaseSchema.superRefine((kit, ctx) => {

    const requirements = kit.role.requirements;
    const questions = kit.questions;

    const requirementIds = new Set(
      requirements.map(r => r.id)
    );

    const questionIds = new Set(
      questions.map(q => q.id)
    );

    // Check unique IDs

    const checkUnique = <T>(
      ids: T[],
      path: (string | number)[]
    ) => {

      if (new Set(ids).size !== ids.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path,
          message: "Duplicate IDs found"
        });
      }
    };

    checkUnique(
      requirements.map(r => r.id),
      ["role", "requirements"]
    );

    checkUnique(
      questions.map(q => q.id),
      ["questions"]
    );

    checkUnique(
      kit.flashcards.map(f => f.id),
      ["flashcards"]
    );


    // Every question must reference valid requirements

    questions.forEach((question, index) => {

      question.requirement_ids.forEach(id => {

        if (!requirementIds.has(id)) {

          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["questions", index, "requirement_ids"],
            message: `Unknown requirement ID: ${id}`
          });

        }

      });

    });

    // Flashcards must reference valid requirements

    kit.flashcards.forEach((card, index) => {

      card.requirement_ids.forEach(id => {

        if (!requirementIds.has(id)) {

          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["flashcards", index, "requirement_ids"],
            message: `Unknown requirement ID: ${id}`
          });

        }

      });

    });

    // Check schedule length

    if (
      kit.schedule.days.length !==
      kit.schedule.days_available
    ) {

      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["schedule", "days"],
        message: "Schedule must contain exactly days_available days"
      });

    }

    // Check that days are numbered 1 through N

    const dayNumbers = kit.schedule.days.map(d => d.day);

    checkUnique(dayNumbers, ["schedule", "days"]);

    for (
      let day = 1;
      day <= kit.schedule.days_available;
      day++
    ) {

      if (!dayNumbers.includes(day)) {

        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["schedule", "days"],
          message: `Missing schedule day ${day}`
        });

      }

    }

    // Every generated question must appear exactly once in the schedule.
    const scheduledQuestionList = kit.schedule.days.flatMap(d => d.question_ids);
    const scheduledQuestionIds = new Set(scheduledQuestionList);

    checkUnique(scheduledQuestionList, ["schedule", "days"]);

    if (
      scheduledQuestionList.length !== questions.length ||
      questions.some(question => !scheduledQuestionIds.has(question.id))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["schedule", "days"],
        message: "Every question must appear exactly once in the study schedule"
      });
    }

    kit.schedule.days.forEach((day, index) => {

      day.question_ids.forEach(id => {

        if (!questionIds.has(id)) {

          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["schedule", "days", index, "question_ids"],
            message: `Unknown question ID: ${id}`
          });

        }

      });

    });

    // Calculate actual uncovered requirements

    const actualUncovered = requirements
      .filter(requirement =>
        !questions.some(question =>
          question.requirement_ids.includes(requirement.id)
        )
      )
      .map(r => r.id)
      .sort();

    const declaredUncovered = [
      ...kit.coverage.uncovered_requirement_ids
    ].sort();

    if (
      JSON.stringify(actualUncovered) !==
      JSON.stringify(declaredUncovered)
    ) {

      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["coverage", "uncovered_requirement_ids"],
        message: "Coverage report does not match actual question coverage"
      });

    }


    // Every MUST requirement must have a scheduled question

    requirements
      .filter(r => r.priority === "must")
      .forEach(requirement => {

        const hasScheduledQuestion = questions.some(
          question =>
            question.requirement_ids.includes(requirement.id) &&
            scheduledQuestionIds.has(question.id)
        );

        if (!hasScheduledQuestion) {

          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["role", "requirements"],
            message: `Must-have requirement ${requirement.id} is not covered in the schedule`
          });

        }

      });

  });


// Export inferred TypeScript type

export type InterviewKit = z.infer< typeof InterviewKitSchema >;
