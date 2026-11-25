// Reply texts, formatted with Telegram's HTML parse mode.

import { GRADES, InputError, compute, findGrade, fmt, letterFor, parseNumbers, requiredFinal } from "../public/calc.js";

export const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const SCORE_USAGE =
  "Usage: /score midterm final [bonus]\n" +
  "Example: /score 72 85 10\n" +
  "Scores are out of 100; bonus is in % (10 means ×1.10).";

export const NEED_USAGE =
  "Usage: /need [grade] midterm [bonus]\n" +
  "Example: /need A 70 20 — final needed for an A\n" +
  "Example: /need 70 20 — final needed for every grade\n" +
  "Grades: A+, A, B+, B, C+, C, D.";

const bonusText = (b) => (b ? `+${fmt(b)}%` : "none");

export function scoreMessage(r) {
  const g = letterFor(r.courseTotal);
  return [
    "📊 <b>Your ECON315 score</b>",
    `Midterm <b>${fmt(r.midterm)}</b> · Final <b>${fmt(r.final)}</b> · Bonus <b>${bonusText(r.bonus)}</b>`,
    "",
    `🎯 30% part: <b>${fmt(r.componentPoints)} / 30</b>`,
    `🎓 Course total: <b>${fmt(r.courseTotal)} / 100</b>`,
    g.letter === "F" ? "❌ Grade: <b>F</b> (below 40)" : `🏅 Grade: <b>${g.letter}</b> (${fmt(g.points)})`,
    "",
    "<blockquote expandable>🧮 <b>How it's calculated</b>",
    `1/3 × ${fmt(r.midterm)} + 2/3 × ${fmt(r.final)} = ${fmt(r.weighted)}`,
    r.bonus ? `${fmt(r.weighted)} × ${fmt(r.multiplier)} (bonus) = ${fmt(r.boosted)}` : null,
    r.capped ? "Capped at 100" : null,
    `30% part: ${fmt(r.component)} × 0.3 = ${fmt(r.componentPoints)}`,
    `Total: ${fmt(r.midterm)} × 0.3 + ${fmt(r.final)} × 0.4 + ${fmt(r.componentPoints)} = ${fmt(r.courseTotal)}</blockquote>`,
  ]
    .filter((l) => l !== null)
    .join("\n");
}

// Final needed for one grade.
export function needGradeMessage(grade, midterm, bonus) {
  const head = [
    `🎯 <b>Final exam needed for ${grade.letter}</b> (total ${grade.min}+)`,
    `Midterm <b>${fmt(midterm)}</b> · Bonus <b>${bonusText(bonus)}</b>`,
    "",
  ];
  const r = requiredFinal(midterm, bonus, grade.min);
  if (r.final === null) {
    return [...head,
      `❌ ${grade.letter} is out of reach.`,
      `Even 100 on the final gives <b>${fmt(r.best)} / 100</b> (${letterFor(r.best).letter}).`].join("\n");
  }
  if (r.final === 0) {
    return [...head, `🎉 You get ${grade.letter} even with <b>0</b> on the final.`].join("\n");
  }
  const s = compute(midterm, r.final, bonus);
  return [...head,
    `You need at least <b>${fmt(r.final)} / 100</b> on the final.`,
    "",
    `<blockquote expandable>With exactly ${fmt(r.final)} on the final:`,
    `30% part: ${fmt(s.componentPoints)} / 30`,
    `Course total: ${fmt(s.courseTotal)} / 100</blockquote>`].join("\n");
}

// Final needed for every grade, as an aligned table.
export function needTableMessage(midterm, bonus) {
  const rows = GRADES.filter((g) => g.letter !== "F").map((g) => {
    const r = requiredFinal(midterm, bonus, g.min);
    const need = r.final === null ? "out of reach" : r.final === 0 ? "any score" : fmt(r.final);
    return `${g.letter.padEnd(6)}${`${g.min}+`.padEnd(6)}${need}`;
  });
  return [
    "🎯 <b>Final exam needed for each grade</b>",
    `Midterm <b>${fmt(midterm)}</b> · Bonus <b>${bonusText(bonus)}</b>`,
    "",
    "<pre>Grade Total Final needed",
    ...rows,
    "</pre>",
    "For one grade: <code>/need A+ " + fmt(midterm) + (bonus ? " " + fmt(bonus) : "") + "</code>",
  ].join("\n");
}

const errorText = (e) => `⚠️ ${esc(e.message)}`;

function guard(fn) {
  try {
    return fn();
  } catch (e) {
    if (e instanceof InputError) return errorText(e);
    throw e;
  }
}

export const scoreReply = (args) =>
  guard(() => {
    const [m, f, b = 0] = parseNumbers(args, 2, 3, SCORE_USAGE);
    return scoreMessage(compute(m, f, b));
  });

// "/need A 70 20" or "/need 70 20". Returns { grade, midterm, bonus }.
export function parseNeed(args) {
  const text = args.trim();
  const first = text.split(/\s+/)[0] ?? "";
  if (/^[a-z]/i.test(first)) {
    const grade = findGrade(first);
    if (!grade) throw new InputError(`"${first}" is not a grade.\n\n${NEED_USAGE}`);
    const [midterm, bonus = 0] = parseNumbers(text.slice(first.length), 1, 2, NEED_USAGE);
    return { grade, midterm, bonus };
  }
  const [midterm, bonus = 0] = parseNumbers(text, 1, 2, NEED_USAGE);
  return { grade: null, midterm, bonus };
}

export const needReply = (args) =>
  guard(() => {
    const { grade, midterm, bonus } = parseNeed(args);
    return grade ? needGradeMessage(grade, midterm, bonus) : needTableMessage(midterm, bonus);
  });

export const startMessage = () =>
  "👋 I'm a helper bot for the <b>Economics &amp; Data Science — Class of 2028</b> group chat.\n\n" +
  "Send /help to see what I can do.";

export const helpMessage = () =>
  [
    "🧮 <b>Commands</b>",
    "",
    "<b>/score</b> midterm final [bonus]",
    "Your 30% part, course total and letter grade.",
    "<code>/score 72 85 10</code>",
    "",
    "<b>/need</b> [grade] midterm [bonus]",
    "Final exam score you need for a grade.",
    "<code>/need A 70 20</code> — for an A",
    "<code>/need 70 20</code> — for every grade",
    "",
    "<b>/app</b> — class app: grades, GPA and materials for all courses",
    "<b>/materials</b> — course materials and syllabuses",
    "<b>/deadlines</b> — upcoming deadlines",
    "",
    "In the group, only you see my answers.",
    "",
    "<i>Admins: /deadline 05.12 23:59 Title adds a deadline in the current topic; " +
      "I remind the topic 3 days, 1 day and 3 hours before. /deadline_delete id removes one. " +
      "/pin_app pins an Open app button in the current topic.</i>",
  ].join("\n");
