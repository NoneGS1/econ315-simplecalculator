import { test } from "node:test";
import assert from "node:assert/strict";

import { InputError, compute, letterFor, parseNumbers, requiredFinal } from "../src/calc.js";
import { needReply, parseNeed, scoreReply } from "../src/messages.js";
import { TelegramError, handleUpdate } from "../src/bot.js";
import worker from "../src/index.js";

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test("formula", () => {
  close(compute(60, 90).component, 80);
  close(compute(60, 90).componentPoints, 24);
  close(compute(60, 90, 10).component, 88); // 80 * 1.1
  const capped = compute(95, 97, 20);
  assert.equal(capped.component, 100);
  assert.ok(capped.capped);
  close(compute(60, 90, 10).courseTotal, 0.3 * 60 + 0.4 * 90 + 0.3 * 88);
});

test("parsing", () => {
  assert.deepEqual(parseNumbers("72 85", 2, 3, "u"), [72, 85]);
  assert.deepEqual(parseNumbers("72,5 85 10%", 2, 3, "u"), [72.5, 85, 10]);
  for (const bad of ["", "72", "a b", "1 2 3 4"]) assert.throws(() => parseNumbers(bad, 2, 3, "u"), InputError);
  assert.throws(() => compute(120, 50), InputError);
});

test("required final for a D", () => {
  // midterm 72, bonus 10: total(f) = 21.6 + 0.4f + 0.3*(24 + 2f/3)*1.1 = 29.52 + 0.62f
  const r = requiredFinal(72, 10);
  assert.equal(r.final, 16.91); // (40 - 29.52) / 0.62 = 16.903... -> rounded up
  assert.ok(compute(72, r.final, 10).courseTotal >= 40);
  assert.ok(compute(72, r.final - 0.01, 10).courseTotal < 40);
  assert.equal(requiredFinal(100, 50).final, 0); // passes even with 0
  assert.equal(requiredFinal(0, 0, 90).final, null); // unreachable
});

test("letter grades", () => {
  assert.equal(letterFor(93).letter, "A+");
  assert.equal(letterFor(92.9).letter, "A");
  assert.equal(letterFor(40).letter, "D");
  assert.equal(letterFor(39.9).letter, "F");
  assert.equal(parseNeed("a+ 70 20").grade.letter, "A+");
  assert.equal(parseNeed("70 20").grade, null);
  assert.throws(() => parseNeed("Z 70"), InputError);
  // midterm 70, bonus 20: 30% part = (70/3 + 2f/3) * 1.2 = 28 + 0.8f (below the cap),
  // total = 21 + 0.4f + 0.3 * (28 + 0.8f) = 29.4 + 0.64f >= 85  ->  f = 86.875 -> 86.88
  assert.equal(requiredFinal(70, 20, 85).final, 86.88);
  assert.match(needReply("A 70 20"), /<b>86\.88 \/ 100<\/b>/);
  // above final 90 the part is capped: 51 + 0.4f >= 93 needs f = 105
  assert.match(needReply("A+ 70 20"), /out of reach/);
  assert.match(needReply("A+ 10"), /out of reach/);
});

test("messages are valid HTML and show the key numbers", () => {
  const s = scoreReply("72 85 10");
  assert.match(s, /<b>26\.62 \/ 30<\/b>/);
  assert.match(s, /<b>82\.22 \/ 100<\/b>/);
  assert.match(needReply("D 72 10"), /<b>16\.91 \/ 100<\/b>/);
  assert.match(needReply("72 10"), /<pre>[\s\S]*D     40\+   16\.91/);
  assert.match(s, /Grade: <b>B\+<\/b>/);
  assert.match(scoreReply("<b> 1"), /&lt;b&gt;/); // user input is escaped
});

function fakeApi(override = () => undefined) {
  const calls = [];
  const api = async (method, params = {}) => {
    calls.push([method, params]);
    const r = override(method, params);
    if (r instanceof Error) throw r;
    if (r !== undefined) return r;
    if (method === "sendMessage" && params.ephemeral_message_parameters) return { message_id: 0 };
    return { message_id: 99 };
  };
  return { api, calls };
}

const groupMsg = (text, extra = {}) => ({
  message_id: "ephemeral_message_id" in extra ? 0 : 5,
  chat: { id: -100, type: "supergroup" },
  from: { id: 42, first_name: "Ann" },
  text,
  ...extra,
});

test("ephemeral reply to an ephemeral command", async () => {
  const { api, calls } = fakeApi();
  await handleUpdate(api, "Econ315Bot", { message: groupMsg("/score 60 90 10", { ephemeral_message_id: 7 }) });
  const [method, p] = calls.at(-1);
  assert.equal(method, "sendMessage");
  assert.equal(p.parse_mode, "HTML");
  assert.deepEqual(p.ephemeral_message_parameters, { receiver_user_id: 42 });
  assert.deepEqual(p.reply_parameters, { ephemeral_message_id: 7 });
  assert.match(p.text, /26\.4 \/ 30/);
});

test("/need works in the group", async () => {
  const { api, calls } = fakeApi();
  await handleUpdate(api, "Econ315Bot", { message: groupMsg("/need@Econ315Bot A 70 20", { ephemeral_message_id: 7 }) });
  assert.match(calls.at(-1)[1].text, /86\.88 \/ 100/);
});

test("replies in the same forum topic", async () => {
  const { api, calls } = fakeApi();
  const msg = groupMsg("/score 60 90", { ephemeral_message_id: 7, message_thread_id: 55, is_topic_message: true });
  msg.chat = { ...msg.chat, is_forum: true };
  await handleUpdate(api, "Econ315Bot", { message: msg });
  assert.equal(calls.at(-1)[1].message_thread_id, 55);
  // not in groups without topics
  const plain = fakeApi();
  await handleUpdate(plain.api, "Econ315Bot", { message: groupMsg("/score 60 90", { ephemeral_message_id: 7, message_thread_id: 9 }) });
  assert.equal(plain.calls.at(-1)[1].message_thread_id, undefined);
});

test("falls back to DM and deletes the visible command", async () => {
  const { api, calls } = fakeApi((m, p) => (p.ephemeral_message_parameters ? new TelegramError("no") : undefined));
  await handleUpdate(api, "Econ315Bot", { message: groupMsg("/score 60 90") });
  assert.ok(calls.some(([m, p]) => m === "deleteMessage" && p.message_id === 5));
  assert.equal(calls.at(-1)[1].chat_id, 42);
});

test("public hint never contains marks", async () => {
  const { api, calls } = fakeApi((m, p) =>
    p.ephemeral_message_parameters || (m === "sendMessage" && p.chat_id !== -100) ? new TelegramError("no") : undefined,
  );
  await handleUpdate(api, "Econ315Bot", { message: groupMsg("/score 60 90") });
  const [, p] = calls.at(-1);
  assert.equal(p.chat_id, -100);
  assert.doesNotMatch(p.text, /80|24/);
});

test("a reply posted publicly by mistake is deleted", async () => {
  const { api, calls } = fakeApi((m, p) => (m === "sendMessage" && p.chat_id === -100 ? { message_id: 123 } : undefined));
  await handleUpdate(api, "Econ315Bot", { message: groupMsg("/score 60 90", { ephemeral_message_id: 7 }) });
  assert.ok(calls.some(([m, p]) => m === "deleteMessage" && p.message_id === 123));
});

test("ignores commands for other bots", async () => {
  const { api, calls } = fakeApi();
  await handleUpdate(api, "Econ315Bot", { message: groupMsg("/score@OtherBot 60 90") });
  assert.equal(calls.length, 0);
});

test("inline query: score and need", async () => {
  const { api, calls } = fakeApi();
  await handleUpdate(api, "Econ315Bot", { inline_query: { id: "q", query: "60 90 10" } });
  let [method, p] = calls.at(-1);
  assert.equal(method, "answerInlineQuery");
  assert.ok(p.is_personal);
  assert.match(p.results[0].title, /^B\+ .*26\.4 \/ 30/);
  await handleUpdate(api, "Econ315Bot", { inline_query: { id: "q", query: "need A 70 20" } });
  [, p] = calls.at(-1);
  assert.match(p.results[0].title, /A: you need 86\.88/);
});

test("worker rejects webhooks without the secret header", async () => {
  const res = await worker.fetch(
    new Request("https://x.workers.dev/webhook", { method: "POST", body: "{}" }),
    { BOT_TOKEN: "1:abc" },
  );
  assert.equal(res.status, 403);
});
