// Fall 2026 courses and their grading, from the course syllabuses.
// Used by the mini app (all calculations run on the student's device).

import { GRADES, letterFor } from "./calc.js";

// A part is one graded item. `count` makes it a group of equal items
// (e.g. 6 quizzes); `best` keeps only the best N of them.
export const COURSES = [
  {
    id: "gt", name: "Game Theory for Economics", short: "Game Theory", code: "ECON315", credits: 6,
    finalWeight: 40,
    parts: [
      { key: "midterm", label: "Midterm", weight: 30 },
      { key: "bonus", label: "Bonus", unit: "%", bonus: true },
    ],
    // Assignments & oral tests (30%) = min(100, (1/3 midterm + 2/3 final) × (1 + bonus%)).
    formula: "gt",
    note: "Assignments (30%) = min(100, (⅓ midterm + ⅔ final) × (1 + bonus%))",
  },
  {
    id: "cp2", name: "Computer Programming 2", short: "Programming 2", code: "CS210", credits: 8,
    finalWeight: 40,
    parts: [
      { key: "midterm", label: "Midterm", weight: 30 },
      { key: "quiz", label: "Quiz", weight: 30, count: 6, best: 5 },
    ],
    note: "Quizzes: the best 5 of 6 count",
  },
  {
    id: "ce", name: "Circular Economy", short: "Circular Economy", code: "ECON330", credits: 6,
    finalWeight: 40,
    parts: [
      { key: "participation", label: "Tutorial participation", weight: 11 },
      { key: "project", label: "Group project", weight: 24, count: 4 },
      { key: "midterm", label: "Midterm", weight: 25 },
    ],
    note: "Group projects are 6% each",
  },
  {
    id: "mgt", name: "Principles of Management", short: "Management", code: "MGT101", credits: 6,
    finalWeight: 40,
    parts: [
      { key: "midterm", label: "Midterm", weight: 30 },
      { key: "report", label: "Management analysis report", weight: 20 },
      { key: "participation", label: "Participation & activities", weight: 10 },
    ],
  },
  {
    id: "em", name: "Econometrics", short: "Econometrics", code: "ECON301", credits: 6,
    finalWeight: 60,
    parts: [{ key: "midterm", label: "Midterm", weight: 40 }],
  },
];

const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

// Score of one part (0-100). Empty items count as `ungraded`.
function partScore(part, value, ungraded) {
  if (!part.count) return value ?? ungraded;
  const items = Array.from({ length: part.count }, (_, i) => value?.[i] ?? ungraded);
  if (part.best) items.sort((a, b) => b - a).splice(part.best);
  return avg(items);
}

// Course total out of 100 for a given final exam score.
export function courseTotal(course, values = {}, final, ungraded = 100) {
  let total = (final * course.finalWeight) / 100;
  for (const part of course.parts) {
    if (part.bonus) continue;
    total += (partScore(part, values[part.key], ungraded) * part.weight) / 100;
  }
  if (course.formula === "gt") {
    const midterm = values.midterm ?? ungraded;
    const bonus = values.bonus ?? 0;
    total += Math.min(100, (midterm / 3 + (2 * final) / 3) * (1 + bonus / 100)) * 0.3;
  }
  return total;
}

// Lowest final (rounded up to 0.01) that reaches `target`; 0 if any final
// does, null if even 100 doesn't. courseTotal is increasing in the final.
export function finalNeeded(course, values, target, ungraded = 100) {
  const total = (f) => courseTotal(course, values, f, ungraded);
  if (total(0) >= target) return 0;
  if (total(100) < target) return null;
  let lo = 0, hi = 100;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (total(mid) >= target) hi = mid;
    else lo = mid;
  }
  let f = Math.ceil(hi * 100 - 1e-9) / 100;
  if (total(f) < target) f = Math.min(100, f + 0.01);
  return f;
}

// Credit-weighted GPA from { courseId: total }.
export function gpa(totals) {
  let points = 0, credits = 0;
  for (const c of COURSES) {
    if (totals[c.id] === undefined) continue;
    points += letterFor(totals[c.id]).points * c.credits;
    credits += c.credits;
  }
  return credits ? points / credits : null;
}

export { GRADES, letterFor };
