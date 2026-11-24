// Reply texts, formatted with Telegram's HTML parse mode.

import { InputError, PASS, compute, fmt, parseNumbers, requiredFinal } from "./calc.js";

export const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const SCORE_USAGE =
  "Usage: /score midterm final [bonus]\n" +
  "Example: /score 72 85 10\n" +
  "Scores are out of 100; bonus is in % (10 means ×1.10).";

export const NEED_USAGE =
  "Usage: /need midterm [bonus] [target]\n" +
  "Example: /need 72 10\n" +
  `Shows the final exam score you need for a D (${PASS}/100), or for the target you give.`;

const bonusText = (b) => (b ? `+${fmt(b)}%` : "none");

export function scoreMessage(r) {
  const passed = r.courseTotal >= PASS;
  return [
    "📊 <b>Your ECON315 score</b>",
    `Midterm <b>${fmt(r.midterm)}</b> · Final <b>${fmt(r.final)}</b> · Bonus <b>${bonusText(r.bonus)}</b>`,
    "",
    `🎯 30% part: <b>${fmt(r.componentPoints)} / 30</b>`,
    `🎓 Course total: <b>${fmt(r.courseTotal)} / 100</b>`,
    passed ? `✅ Passing (D is ${PASS})` : `⚠️ Below the D line (${PASS})`,
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

export function needMessage(midterm, bonus, target) {
  const goal = target === PASS ? `a D (${PASS}/100)` : `${fmt(target)}/100`;
  const head = [
    `🎯 <b>Final exam needed for ${goal}</b>`,
    `Midterm <b>${fmt(midterm)}</b> · Bonus <b>${bonusText(bonus)}</b>`,
    "",
  ];
  const r = requiredFinal(midterm, bonus, target);
  if (r.final === null) {
    return [...head,
      "❌ Not reachable this way.",
      `Even 100 on the final gives <b>${fmt(r.best)} / 100</b>.`].join("\n");
  }
  if (r.final === 0) {
    return [...head,
      "🎉 You reach it even with <b>0</b> on the final",
      `(that would give ${fmt(r.atZero)} / 100).`].join("\n");
  }
  const s = compute(midterm, r.final, bonus);
  return [...head,
    `You need at least <b>${fmt(r.final)} / 100</b> on the final.`,
    "",
    `<blockquote expandable>With exactly ${fmt(r.final)} on the final:`,
    `30% part: ${fmt(s.componentPoints)} / 30`,
    `Course total: ${fmt(s.courseTotal)} / 100</blockquote>`].join("\n");
}

const errorText = (e) => `⚠️ ${esc(e.message)}`;

export function scoreReply(args) {
  try {
    const [m, f, b = 0] = parseNumbers(args, 2, 3, SCORE_USAGE);
    return scoreMessage(compute(m, f, b));
  } catch (e) {
    if (e instanceof InputError) return errorText(e);
    throw e;
  }
}

export function needReply(args) {
  try {
    const [m, b = 0, t = PASS] = parseNumbers(args, 1, 3, NEED_USAGE);
    return needMessage(m, b, t);
  } catch (e) {
    if (e instanceof InputError) return errorText(e);
    throw e;
  }
}

export const helpMessage = () =>
  [
    "👋 I'm a helper bot for the <b>Economics &amp; Data Science — Class of 2028</b> group chat.",
    "",
    "/score — your grade, e.g. <code>/score 72 85 10</code>",
    "/need — final exam score you need to pass, e.g. <code>/need 72 10</code>",
  ].join("\n");
