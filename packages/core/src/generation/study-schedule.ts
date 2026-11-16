
import type { InterviewKit } from "../schemas/interview-kit.js";

type Requirement = InterviewKit["role"]["requirements"][number];
type Question = InterviewKit["questions"][number];

export interface StudyScheduleInput {
  requirements: Requirement[];
  questions: Question[];
  daysAvailable: number;
}

/**
 * Allocates interview questions across the requested number of days.
 *
 * Allocation is deterministic:
 * 1. Must-have requirements come first.
 * 2. Higher-difficulty questions come first.
 * 3. Questions are distributed across days to balance workload.
 */
export function createStudySchedule({
  requirements,
  questions,
  daysAvailable
}: StudyScheduleInput): InterviewKit["schedule"] {

  if (
    !Number.isInteger(daysAvailable) ||
    daysAvailable < 1 ||
    daysAvailable > 60
  ) {
    throw new Error(
      "daysAvailable must be an integer between 1 and 60."
    );
  }

  const priorityByRequirement = new Map(
    requirements.map(requirement => [
      requirement.id,
      requirement.priority
    ])
  );

  // Sort questions by requirement priority and difficulty.
  const orderedQuestions = [...questions].sort((a, b) => {
    const getPriority = (question: Question) =>
      question.requirement_ids.some(
        id => priorityByRequirement.get(id) === "must"
      ) ? 0 : 1;

    return (
      getPriority(a) - getPriority(b) ||
      b.difficulty - a.difficulty ||
      a.id.localeCompare(b.id)
    );
  });

  // Create exactly the requested number of days.
  const dayQuestions: Question[][] = Array.from(
    { length: daysAvailable },
    () => []
  );

  // Round-robin allocation balances the workload.
  orderedQuestions.forEach((question, index) => {
    dayQuestions[index % daysAvailable]!.push(question);
  });

  const days = dayQuestions.map((dayItems, index) => {

    const topics = [
      ...new Set(
        dayItems.flatMap(question => question.requirement_ids)
          .map(id =>
            requirements.find(
              requirement => requirement.id === id
            )?.text
          )
          .filter((value): value is string => Boolean(value))
      )
    ];

    const focus = topics.length > 0
      ? topics.slice(0, 3).join(", ")
      : "Review role requirements and preparation notes";

    // 15 minutes per difficulty point, rounded to 5-minute blocks.
    // Empty days receive a minimum 30-minute review session.
    const estimatedMinutes = dayItems.reduce(
      (total, question) => total + question.difficulty * 15,
      0
    );

    const minutes = Math.max(
      30,
      Math.ceil(estimatedMinutes / 5) * 5
    );

    return {
      day: index + 1,
      focus,
      question_ids: dayItems.map(question => question.id),
      minutes
    };
  });

  // Verify that every must-have requirement has a scheduled question.
  const scheduledQuestionIds = new Set(
    days.flatMap(day => day.question_ids)
  );

  for (
    const requirement of requirements.filter(
      item => item.priority === "must"
    )
  ) {
    const isCovered = questions.some(
      question =>
        question.requirement_ids.includes(requirement.id) &&
        scheduledQuestionIds.has(question.id)
    );

    if (!isCovered) {
      throw new Error(
        `Must-have requirement ${requirement.id} has no scheduled question.`
      );
    }
  }

  return {
    days_available: daysAvailable,
    days
  };
}
