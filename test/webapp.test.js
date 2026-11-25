import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import worker from "../src/index.js";
import { DeadlineStore } from "../src/store.js";
import { deadlinesForUser, topicLink, validateInitData } from "../src/webapp.js";

const TOKEN = "123456:TEST-token";
const NOW = Date.parse("2026-11-25T10:00:00Z");

// Sign init data the way Telegram does.
function sign(fields, token = TOKEN) {
  const check = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const hash = createHmac("sha256", secret).update(check).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}
const fields = (extra = {}) => ({
  auth_date: String(Math.floor(NOW / 1000) - 60),
  query_id: "AAE",
  user: JSON.stringify({ id: 42, first_name: "Ann" }),
  ...extra,
});

test("accepts Telegram-signed init data", async () => {
  const user = await validateInitData(sign(fields()), TOKEN, { now: NOW });
  assert.equal(user.id, 42);
});

test("rejects tampered, foreign, expired or missing init data", async () => {
  const forged = sign(fields()).replace("%22id%22%3A42", "%22id%22%3A43");
  assert.equal(await validateInitData(forged, TOKEN, { now: NOW }), null);
  assert.equal(await validateInitData(sign(fields(), "999:other-bot"), TOKEN, { now: NOW }), null);
  const old = sign(fields({ auth_date: String(Math.floor(NOW / 1000) - 2 * 86400) }));
  assert.equal(await validateInitData(old, TOKEN, { now: NOW }), null);
  assert.equal(await validateInitData("", TOKEN, { now: NOW }), null);
  assert.equal(await validateInitData("user=%7B%7D", TOKEN, { now: NOW }), null);
});

test("only deadlines from groups the user is in", async () => {
  const db = new DatabaseSync(":memory:");
  const store = new DeadlineStore({ exec: (q, ...p) => { const r = db.prepare(q).all(...p); return { toArray: () => r }; } });
  store.add({ chatId: -1001, threadId: 7, title: "Our HW", due: NOW + 86400e3, now: NOW });
  store.add({ chatId: -1002, title: "Other group's exam", due: NOW + 86400e3, now: NOW });
  store.add({ chatId: -1001, title: "Past", due: NOW - 60e3, now: NOW - 86400e3 });
  const api = async (method, p) => ({ status: p.chat_id === -1001 ? "member" : "left" });
  const list = await deadlinesForUser(api, store, 42, NOW);
  assert.deepEqual(list.map((d) => d.title), ["Our HW"]);
  assert.equal(list[0].link, "https://t.me/c/1/7");
  assert.equal(topicLink(-1003803621408, null), "https://t.me/c/3803621408");
});

test("/api/deadlines refuses requests without valid init data", async () => {
  const res = await worker.fetch(new Request("https://x.workers.dev/api/deadlines"), { BOT_TOKEN: TOKEN });
  assert.equal(res.status, 401);
});
