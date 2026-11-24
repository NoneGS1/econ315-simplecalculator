// Grade formula for the ECON315 game theory course.
//
//   component = min(100, (1/3 * midterm + 2/3 * final) * (1 + bonus / 100))
//
// Midterm and final are out of 100; bonus is a percentage (10 -> x1.10).

export const USAGE =
  "Usage: /score <midterm> <final> [bonus]\n" +
  "Example: /score 72 85 10\n" +
  "Midterm and final are out of 100; bonus is in % (10 means x1.10).";

const CAP = 100;
const COMPONENT_WEIGHT = 0.3;
const MIDTERM_WEIGHT = 0.3;
const FINAL_WEIGHT = 0.4;

export class InputError extends Error {}

export const fmt = (x) => String(Number(x.toFixed(2)));

export function compute(midterm, final, bonus = 0) {
  for (const [name, v] of [["Midterm", midterm], ["Final", final]]) {
    if (!(v >= 0 && v <= 100)) throw new InputError(`${name} must be between 0 and 100 (got ${fmt(v)}).`);
  }
  if (!(bonus >= 0 && bonus <= 100)) throw new InputError(`Bonus must be between 0 and 100 % (got ${fmt(bonus)}).`);

  const weighted = midterm / 3 + (2 * final) / 3;
  const boosted = weighted * (1 + bonus / 100);
  const component = Math.min(CAP, boosted);
  const componentPoints = component * COMPONENT_WEIGHT;
  return {
    midterm, final, bonus, weighted, boosted, component, componentPoints,
    capped: boosted > CAP,
    courseTotal: midterm * MIDTERM_WEIGHT + final * FINAL_WEIGHT + componentPoints,
  };
}

const NUMBER = /^[+-]?(\d+([.,]\d*)?|[.,]\d+)%?$/;

export function parseArgs(text) {
  const parts = text.replace(/;/g, " ").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2 || parts.length > 3) throw new InputError(USAGE);
  const nums = parts.map((p) => {
    if (!NUMBER.test(p)) throw new InputError(`'${p}' is not a number.\n\n${USAGE}`);
    return parseFloat(p.replace(/%$/, "").replace(",", "."));
  });
  if (nums.length === 2) nums.push(0);
  return nums;
}

export function formatResult(r) {
  const lines = [
    `Midterm ${fmt(r.midterm)}, final ${fmt(r.final)}, bonus ${fmt(r.bonus)}%`,
    `1/3 x midterm + 2/3 x final = ${fmt(r.weighted)}`,
  ];
  if (r.bonus) {
    lines.push(`x ${fmt(1 + r.bonus / 100)} (bonus) = ${fmt(r.boosted)}` + (r.capped ? " -> capped at 100" : ""));
  }
  lines.push(
    "",
    `30% component: ${fmt(r.component)} / 100`,
    `= ${fmt(r.componentPoints)} / 30 points of the course grade`,
    "",
    `Estimated course total: ${fmt(r.courseTotal)} / 100`,
    "(30% midterm + 40% final + 30% component)",
  );
  return lines.join("\n");
}

export function answer(text) {
  try {
    return formatResult(compute(...parseArgs(text)));
  } catch (e) {
    if (e instanceof InputError) return e.message;
    throw e;
  }
}
