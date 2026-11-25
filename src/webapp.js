// Backend for the mini app: checks Telegram's signed init data and returns
// the deadlines of the groups the user belongs to.

const enc = new TextEncoder();

async function hmac(key, data) {
  const k = await crypto.subtle.importKey("raw", typeof key === "string" ? enc.encode(key) : key,
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
}

const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

// Validates Telegram.WebApp.initData as described in the Bot API docs
// ("Validating data received via the Mini App"). Returns the user, or null.
export async function validateInitData(initData, botToken, { now = Date.now(), maxAgeSec = 24 * 3600 } = {}) {
  if (!initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const checkString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = await hmac("WebAppData", botToken);
  const expected = hex(await hmac(secret, checkString));
  if (expected.length !== hash.length) return null;
  let diff = 0; // constant-time comparison
  for (let i = 0; i < hash.length; i++) diff |= expected.charCodeAt(i) ^ hash.charCodeAt(i);
  if (diff) return null;
  const authDate = Number(params.get("auth_date"));
  if (!authDate || now / 1000 - authDate > maxAgeSec) return null;
  try {
    return JSON.parse(params.get("user"));
  } catch {
    return null;
  }
}

const MEMBER = new Set(["creator", "administrator", "member"]);

// Link to a topic (or the group) for members: t.me/c/<id without -100>/<topic>
export function topicLink(chatId, threadId) {
  const internal = String(chatId).replace(/^-100/, "");
  return threadId ? `https://t.me/c/${internal}/${threadId}` : `https://t.me/c/${internal}`;
}

// Upcoming deadlines from every group the user is a member of.
export async function deadlinesForUser(api, store, userId, now = Date.now()) {
  const all = await store.allUpcoming(now);
  const allowed = new Map();
  for (const chatId of new Set(all.map((d) => d.chat_id))) {
    try {
      const m = await api("getChatMember", { chat_id: chatId, user_id: userId });
      allowed.set(chatId, MEMBER.has(m.status) || (m.status === "restricted" && m.is_member));
    } catch {
      allowed.set(chatId, false);
    }
  }
  return all
    .filter((d) => allowed.get(d.chat_id))
    .map((d) => ({ id: d.id, title: d.title, due: d.due, link: topicLink(d.chat_id, d.thread_id) }));
}
