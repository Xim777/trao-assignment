import { describe, expect, it } from "vitest";
import { createStudySchedule } from "./study-schedule.js";

import type { InterviewKit } from "../schemas/interview-kit.js";

type Requirement = InterviewKit["role"]["requirements"][number];
type Question = InterviewKit["questions"][number];

const requirements: Requirement[] = [
  {
    id: "r1",
    text: "Experience with TypeScript",
    kind: "technical",
    priority: "must"
  },
  {
    id: "r2",
    text: "Experience with databases",
    kind: "technical",
    priority: "nice"
  }
];

const questions: Question[] = [
  {
    id: "q1",
    requirement_ids: ["r1"],
    category: "technical",
    prompt: "Explain TypeScript generics.",
    answer_outline: "Discuss type parameters and constraints.",
    difficulty: 3
  },
  {
    id: "q2",
    requirement_ids: ["r2"],
    category: "technical",
    prompt: "Explain database indexing.",
    answer_outline: "Discuss indexes and query performance.",
    difficulty: 2
  },
  {
    id: "q3",
    requirement_ids: ["r1"],
    category: "technical",
    prompt: "What is type narrowing?",
    answer_outline: "Discuss control flow analysis.",
    difficulty: 1
  }
];

describe("createStudySchedule", () => {
  it("creates exactly the requested number of days", () => {
    const schedule = createStudySchedule({
      requirements,
      questions,
      daysAvailable: 5
    });

    expect(schedule.days).toHaveLength(5);
    expect(schedule.days_available).toBe(5);
  });

  it("schedules every generated question exactly once", () => {
    const schedule = createStudySchedule({
      requirements,
      questions,
      daysAvailable: 2
    });

    const scheduledIds = schedule.days.flatMap(
      day => day.question_ids
    );

    expect(scheduledIds.sort()).toEqual(
      ["q1", "q2", "q3"].sort()
    );

    expect(new Set(scheduledIds).size).toBe(3);
  });

  it("prioritizes must-have and harder questions", () => {
    const schedule = createStudySchedule({
      requirements,
      questions,
      daysAvailable: 2
    });

    // The hardest must-have question should be allocated first.
    expect(schedule.days[0].question_ids[0]).toBe("q1");
  });

  it("rejects a schedule without coverage for a must-have requirement", () => {
    expect(() =>
      createStudySchedule({
        requirements,
        questions: [],
        daysAvailable: 3
      })
    ).toThrow(/Must-have requirement r1/);
  });

  it("rejects invalid day counts", () => {
    for (const daysAvailable of [0, -1, 1.5, 61]) {
      expect(() =>
        createStudySchedule({
          requirements,
          questions,
          daysAvailable
        })
      ).toThrow(/between 1 and 60/);
    }
  });

  it("uses integer durations and numbers days sequentially", () => {
    const schedule = createStudySchedule({
      requirements,
      questions,
      daysAvailable: 3
    });

    expect(schedule.days.map(day => day.day)).toEqual([1, 2, 3]);

    for (const day of schedule.days) {
      expect(Number.isInteger(day.minutes)).toBe(true);
      expect(day.minutes).toBeGreaterThan(0);
    }
  });
});
