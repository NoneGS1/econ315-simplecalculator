import { test } from "node:test";
import assert from "node:assert/strict";

import { InputError, compute, parseArgs } from "../src/calc.js";
import { TelegramError, handleUpdate } from "../src/bot.js";
import worker from "../src/index.js";

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test("formula", () => {
  close(compute(60, 90).component, 80);
  close(compute(60, 90).componentPoints, 24);
  close(compute(60, 90, 10).component, 88); // 80 * 1.1
  const capped = compute(95, 98, 20);
  assert.equal(capped.component, 100);
  assert.ok(capped.capped);
  close(compute(60, 90, 10).courseTotal, 0.3 * 60 + 0.4 * 90 + 0.3 * 88);
});

test("parsing", () => {
  assert.deepEqual(parseArgs("72 85"), [72, 85, 0]);
  assert.deepEqual(parseArgs("72,5 85 10%"), [72.5, 85, 10]);
  for (const bad of ["", "72", "a b", "1 2 3 4"]) assert.throws(() => parseArgs(bad), InputError);
  assert.throws(() => compute(120, 50), InputError);
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
  assert.deepEqual(p.ephemeral_message_parameters, { receiver_user_id: 42 });
  assert.deepEqual(p.reply_parameters, { ephemeral_message_id: 7 });
  assert.match(p.text, /88/);
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
  assert.doesNotMatch(p.text, /80/);
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

test("inline query is personal", async () => {
  const { api, calls } = fakeApi();
  await handleUpdate(api, "Econ315Bot", { inline_query: { id: "q", query: "60 90 10" } });
  const [method, p] = calls.at(-1);
  assert.equal(method, "answerInlineQuery");
  assert.ok(p.is_personal);
  assert.match(p.results[0].title, /88/);
});

test("worker rejects webhooks without the secret header", async () => {
  const res = await worker.fetch(
    new Request("https://x.workers.dev/webhook", { method: "POST", body: "{}" }),
    { BOT_TOKEN: "1:abc" },
  );
  assert.equal(res.status, 403);
});
