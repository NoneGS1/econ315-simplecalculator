// Grade math for the ECON315 game theory course.
//
//   component    = min(100, (1/3 * midterm + 2/3 * final) * (1 + bonus / 100))
//   course total = 30% midterm + 40% final + 30% component
//
// Midterm and final are out of 100; bonus is a percentage (10 -> x1.10).

export const PASS = 40; // D
const CAP = 100;

export class InputError extends Error {}

export const fmt = (x) => String(Number(x.toFixed(2)));

function check(name, v, max = 100) {
  if (!(v >= 0 && v <= max)) throw new InputError(`${name} must be between 0 and ${max} (you wrote ${fmt(v)}).`);
}

export function compute(midterm, final, bonus = 0) {
  check("Midterm", midterm);
  check("Final", final);
  check("Bonus", bonus);
  const weighted = midterm / 3 + (2 * final) / 3;
  const multiplier = 1 + bonus / 100;
  const boosted = weighted * multiplier;
  const component = Math.min(CAP, boosted);
  const componentPoints = component * 0.3;
  return {
    midterm, final, bonus, weighted, multiplier, boosted, component, componentPoints,
    capped: boosted > CAP,
    courseTotal: midterm * 0.3 + final * 0.4 + componentPoints,
  };
}

// Lowest final score (rounded up to 0.01) that gives a course total >= target.
// Returns { final: 0 } if the target is reached even with 0, or
// { final: null, best } if even 100 is not enough.
export function requiredFinal(midterm, bonus = 0, target = PASS) {
  check("Midterm", midterm);
  check("Bonus", bonus);
  check("Target", target);
  const total = (f) => compute(midterm, f, bonus).courseTotal;
  if (total(0) >= target) return { final: 0, atZero: total(0) };
  if (total(100) < target) return { final: null, best: total(100) };
  let lo = 0, hi = 100; // total() is increasing in the final score
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (total(mid) >= target) hi = mid;
    else lo = mid;
  }
  let f = Math.ceil(hi * 100 - 1e-9) / 100;
  if (total(f) < target) f = Math.min(100, f + 0.01);
  return { final: f };
}

const NUMBER = /^[+-]?(\d+([.,]\d*)?|[.,]\d+)%?$/;

// Parse between `min` and `max` numbers ("72,5 85 10%" -> [72.5, 85, 10]).
export function parseNumbers(text, min, max, usage) {
  const parts = text.replace(/;/g, " ").trim().split(/\s+/).filter(Boolean);
  if (parts.length < min || parts.length > max) throw new InputError(usage);
  return parts.map((p) => {
    if (!NUMBER.test(p)) throw new InputError(`"${p}" is not a number.\n\n${usage}`);
    return parseFloat(p.replace(/%$/, "").replace(",", "."));
  });
}
