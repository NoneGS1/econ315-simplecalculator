import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { InputError } from "../public/calc.js";
import { handleUpdate } from "../src/bot.js";
import { Store } from "../src/index.js";
import { DeadlineStore } from "../src/store.js";
import { parseDeadline } from "../src/time.js";

const TZ = "Asia/Tashkent"; // UTC+5
const NOW = Date.parse("2026-11-24T10:00:00Z");
const H = 3600e3, D = 24 * H;

// Same shape as Durable Object SQL storage: exec(query, ...params).toArray()
function sqlite() {
  const db = new DatabaseSync(":memory:");
  return { exec: (q, ...p) => { const rows = db.prepare(q).all(...p); return { toArray: () => rows }; } };
}

test("parsing deadlines in the group's time zone", () => {
  assert.deepEqual(parseDeadline("05.12 18:00 Game Theory HW3", TZ, NOW),
    { due: Date.parse("2026-12-05T13:00:00Z"), title: "Game Theory HW3" });
  assert.equal(parseDeadline("2026-12-05 Exam", TZ, NOW).due, Date.parse("2026-12-05T18:59:00Z")); // 23:59 default
  assert.equal(parseDeadline("05/12/26 9:30 X", TZ, NOW).due, Date.parse("2026-12-05T04:30:00Z"));
  assert.equal(parseDeadline("10.01 Spring kickoff", TZ, NOW).due, Date.parse("2027-01-10T18:59:00Z")); // next year
  for (const bad of ["", "tomorrow HW", "05.12", "31.02 HW", "2026-01-01 Old", "05.12 25:00 HW"]) {
    assert.throws(() => parseDeadline(bad, TZ, NOW), InputError, bad);
  }
});

test("reminders: 3 days, 1 day, 3 hours, each once", () => {
  const s = new DeadlineStore(sqlite());
  const due = NOW + 5 * D;
  s.add({ chatId: -1, threadId: 7, title: "HW3", due, now: NOW });
  assert.equal(s.takeDue(NOW).length, 0);
  const r1 = s.takeDue(due - 3 * D + 60e3);
  assert.deepEqual(r1.map((r) => [r.title, r.label, r.thread_id]), [["HW3", "in 3 days", 7]]);
  assert.equal(s.takeDue(due - 3 * D + 120e3).length, 0); // not twice
  assert.deepEqual(s.takeDue(due - 2 * H).map((r) => r.label), ["in 3 hours"]); // missed "tomorrow" is skipped
  assert.equal(s.takeDue(due - H).length, 0);
});

test("a deadline added 2 days ahead skips the 3-day reminder", () => {
  const s = new DeadlineStore(sqlite());
  s.add({ chatId: -1, title: "Quiz", due: NOW + 2 * D, now: NOW });
  assert.equal(s.takeDue(NOW + 60e3).length, 0);
  assert.deepEqual(s.takeDue(NOW + D + 60e3).map((r) => r.label), ["tomorrow"]);
});

test("list and remove are per group", () => {
  const s = new DeadlineStore(sqlite());
  const a = s.add({ chatId: -1, title: "A", due: NOW + 2 * D, now: NOW });
  s.add({ chatId: -1, title: "B", due: NOW + D, now: NOW });
  s.add({ chatId: -2, title: "Other group", due: NOW + D, now: NOW });
  assert.deepEqual(s.upcoming(-1, NOW).map((d) => d.title), ["B", "A"]);
  assert.equal(s.remove(-2, a), null);
  assert.equal(s.remove(-1, a).title, "A");
  assert.deepEqual(s.upcoming(-1, NOW).map((d) => d.title), ["B"]);
});

test("Durable Object wrapper runs store methods", async () => {
  const obj = new Store({ storage: { sql: sqlite() } });
  const call = async (method, ...args) =>
    (await obj.fetch(new Request("https://store/", { method: "POST", body: JSON.stringify({ method, args }) }))).json();
  const id = await call("add", { chatId: -1, title: "HW", due: NOW + D, now: NOW });
  assert.equal((await call("upcoming", -1, NOW))[0].id, id);
  const bad = await obj.fetch(new Request("https://store/", { method: "POST", body: JSON.stringify({ method: "constructor", args: [] }) }));
  assert.equal(bad.status, 400);
});

function fakeApi(status = "administrator") {
  const calls = [];
  const api = async (method, params = {}) => {
    calls.push([method, params]);
    if (method === "getChatMember") return { status };
    if (method === "sendMessage" && params.ephemeral_message_parameters) return { message_id: 0 };
    return { message_id: 99 };
  };
  return { api, calls };
}

const forumMsg = (text, extra = {}) => ({
  message_id: 5, message_thread_id: 77, is_topic_message: true,
  chat: { id: -100, type: "supergroup", is_forum: true },
  from: { id: 42, first_name: "Ann" }, text, ...extra,
});

test("admin adds a deadline: announced in the topic, then listed privately", async () => {
  const store = new DeadlineStore(sqlite());
  const opts = { store, tz: TZ, now: NOW };
  const { api, calls } = fakeApi();
  await handleUpdate(api, "Econ315Bot", { message: forumMsg("/deadline 05.12 23:59 Game Theory HW3") }, opts);
  const [, post] = calls.at(-1);
  assert.equal(post.message_thread_id, 77);
  assert.equal(post.ephemeral_message_parameters, undefined); // public
  assert.match(post.text, /Game Theory HW3[\s\S]*Sat 5 Dec, 23:59 \(Tashkent time\)/);

  await handleUpdate(api, "Econ315Bot", { message: forumMsg("/deadlines", { ephemeral_message_id: 3 }) }, opts);
  const [, list] = calls.at(-1);
  assert.deepEqual(list.ephemeral_message_parameters, { receiver_user_id: 42 });
  assert.match(list.text, /Game Theory HW3/);
});

test("non-admins can't add deadlines", async () => {
  const store = new DeadlineStore(sqlite());
  const { api, calls } = fakeApi("member");
  await handleUpdate(api, "Econ315Bot", { message: forumMsg("/deadline 05.12 HW") }, { store, tz: TZ, now: NOW });
  assert.match(calls.find(([m, p]) => m === "sendMessage")[1].text, /Only group admins/);
  assert.equal(store.upcoming(-100, NOW).length, 0);
});

test("/calc links to the mini app", async () => {
  const { api, calls } = fakeApi();
  await handleUpdate(api, "Econ315Bot", { message: forumMsg("/calc", { ephemeral_message_id: 3 }) }, { appUrl: "https://x/app/" });
  assert.equal(calls.at(-1)[1].reply_markup.inline_keyboard[0][0].url, "https://t.me/Econ315Bot?startapp");
  await handleUpdate(api, "Econ315Bot", { message: { ...forumMsg("/calc"), chat: { id: 42, type: "private" } } }, { appUrl: "https://x/app/" });
  assert.equal(calls.at(-1)[1].reply_markup.inline_keyboard[0][0].web_app.url, "https://x/app/");
});

test("/materials: a Drive and a syllabus button per course, answered privately", async () => {
  const { api, calls } = fakeApi();
  await handleUpdate(api, "Econ315Bot", { message: forumMsg("/materials", { ephemeral_message_id: 3 }) }, {});
  const [, p] = calls.at(-1);
  assert.deepEqual(p.ephemeral_message_parameters, { receiver_user_id: 42 });
  assert.equal(p.message_thread_id, 77);
  const rows = p.reply_markup.inline_keyboard;
  const courseRows = rows.filter((r) => r[0].text.startsWith("📁"));
  assert.equal(courseRows.length, 5);
  for (const [drive, syl] of courseRows) {
    assert.match(drive.url, /^https:\/\/drive\.google\.com\/drive\/folders\//);
    assert.match(syl.url, /^https:\/\/t\.me\/c\/3803621408\/5\/\d+$/);
  }
  // Game Theory's bonus sheets get their own row
  assert.ok(rows.some((r) => r.length === 2 && r.every((b) => b.text.startsWith("📊 GT bonus"))));
  assert.ok(rows.flat().every((b) => b.url && !/ouid=|authuser=/.test(b.url)));
  assert.equal(new Set(courseRows.map(([d]) => d.url)).size, 5); // no two courses share a folder
});
