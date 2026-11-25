import { test } from "node:test";
import assert from "node:assert/strict";

import { compute } from "../public/calc.js";
import { COURSES, courseTotal, finalNeeded, gpa } from "../public/courses.js";

const course = (id) => COURSES.find((c) => c.id === id);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test("weights add up to 100 for every course", () => {
  for (const c of COURSES) {
    const sum = c.finalWeight + c.parts.reduce((s, p) => s + (p.weight ?? 0), 0) + (c.formula === "gt" ? 30 : 0);
    assert.equal(sum, 100, c.id);
  }
});

test("Game Theory matches the bot's formula", () => {
  for (const [m, f, b] of [[60, 70, 0], [72, 85, 10], [95, 97, 20]]) {
    close(courseTotal(course("gt"), { midterm: m, bonus: b }, f), compute(m, f, b).courseTotal);
  }
});

test("Programming 2: best 5 of 6 quizzes", () => {
  const c = course("cp2");
  // quizzes 100, 40, 80, 90, 70, 60 -> best five average 80 -> 24 points
  const v = { midterm: 70, quiz: [100, 40, 80, 90, 70, 60] };
  close(courseTotal(c, v, 0), 0.3 * 70 + 24);
  close(courseTotal(c, v, 50), 0.3 * 70 + 24 + 20);
  // ungraded quizzes count as 100 by default, or 0 if asked
  close(courseTotal(c, { midterm: 70, quiz: [80] }, 0), 21 + 30); // five 100s are the best five
  close(courseTotal(c, { midterm: 70, quiz: [80] }, 0, 0), 21 + 0.3 * 80 / 5);
});

test("Circular Economy and Econometrics", () => {
  close(courseTotal(course("ce"), { participation: 90, project: [80, 70, 100, 90], midterm: 60 }, 50),
    0.11 * 90 + 0.06 * (80 + 70 + 100 + 90) + 0.25 * 60 + 0.4 * 50);
  close(courseTotal(course("em"), { midterm: 50 }, 80), 0.4 * 50 + 0.6 * 80);
  close(courseTotal(course("mgt"), { midterm: 80, report: 70, participation: 100 }, 60), 24 + 14 + 10 + 24);
  assert.equal(COURSES.length, 5);
});

test("final needed", () => {
  // Econometrics, midterm 50: 20 + 0.6f >= 85 -> f = 108.33 (out of reach); >= 65 -> 75
  assert.equal(finalNeeded(course("em"), { midterm: 50 }, 85), null);
  assert.equal(finalNeeded(course("em"), { midterm: 50 }, 65), 75);
  assert.equal(finalNeeded(course("em"), { midterm: 100 }, 40), 0);
  const f = finalNeeded(course("cp2"), { midterm: 70, quiz: [100, 40, 80, 90, 70, 60] }, 85);
  assert.equal(f, 100); // 45 + 0.4f >= 85
});

test("credit-weighted GPA", () => {
  // A (4.0) in an 8-credit course, B (3.0) in a 6-credit one
  close(gpa({ cp2: 86, em: 70 }), (4 * 8 + 3 * 6) / 14);
  assert.equal(gpa({}), null);
});
