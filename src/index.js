// Cloudflare Worker entry point.
//
//   POST /webhook  Telegram sends updates here (checked with a secret header).
//   GET  /setup    Registers the webhook, commands and the mini app menu button.
//                  Open it once after deploying, and when commands change.
//   GET  /app/     The mini app (static files in public/, served by Cloudflare).
//   cron           Every 15 minutes: sends deadline reminders.
//
// Secret: BOT_TOKEN (from @BotFather). Variable: TIMEZONE (wrangler.toml).

import { handleUpdate, makeApi, registerCommands, registerMenuButton } from "./bot.js";
import { reminderText } from "./deadlines.js";
import { DeadlineStore } from "./store.js";

let cachedUsername;

// Derive the webhook secret from the bot token so only one secret is needed.
async function webhookSecret(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`webhook:${token}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 64);
}

// The deadlines database: one SQLite-backed Durable Object for the whole bot.
// Each call is a POST {method, args} that runs the DeadlineStore method.
export class Store {
  constructor(state) {
    this.db = new DeadlineStore(state.storage.sql);
  }

  async fetch(request) {
    const { method, args } = await request.json();
    if (!["add", "upcoming", "remove", "takeDue"].includes(method)) return new Response("bad method", { status: 400 });
    return Response.json(this.db[method](...args) ?? null);
  }
}

function storeClient(env) {
  if (!env.STORE) return null;
  const stub = env.STORE.get(env.STORE.idFromName("main"));
  const call = async (method, ...args) => {
    const res = await stub.fetch("https://store/", { method: "POST", body: JSON.stringify({ method, args }) });
    if (!res.ok) throw new Error(`store.${method}: ${res.status}`);
    return res.json();
  };
  return {
    add: (d) => call("add", d),
    upcoming: (chatId, now) => call("upcoming", chatId, now),
    remove: (chatId, id) => call("remove", chatId, id),
    takeDue: (now) => call("takeDue", now),
  };
}

const tzOf = (env) => env.TIMEZONE || "Asia/Tashkent";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!env.BOT_TOKEN) return new Response("BOT_TOKEN secret is not set", { status: 500 });
    const api = makeApi(env.BOT_TOKEN);
    const appUrl = `${url.origin}/app/`;

    if (url.pathname === "/webhook" && request.method === "POST") {
      const secret = await webhookSecret(env.BOT_TOKEN);
      if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== secret) {
        return new Response("forbidden", { status: 403 });
      }
      const update = await request.json();
      try {
        cachedUsername ??= (await api("getMe")).username;
        await handleUpdate(api, cachedUsername, update, { store: storeClient(env), tz: tzOf(env), appUrl });
      } catch (e) {
        console.error(`update ${update.update_id}: ${e.stack ?? e}`);
      }
      return new Response("ok"); // always 200 so Telegram doesn't resend
    }

    if (url.pathname === "/setup") {
      try {
        const me = await api("getMe");
        await api("setWebhook", {
          url: `${url.origin}/webhook`,
          secret_token: await webhookSecret(env.BOT_TOKEN),
          drop_pending_updates: true,
        });
        const commands = await registerCommands(api);
        await registerMenuButton(api, appUrl);
        return Response.json({ ok: true, bot: `@${me.username}`, webhook: `${url.origin}/webhook`, app: appUrl, commands });
      } catch (e) {
        return Response.json({ ok: false, error: e.message }, { status: 502 });
      }
    }

    return new Response("ECON315 score bot is running. Open /setup once after deploying.");
  },

  async scheduled(event, env) {
    const store = storeClient(env);
    if (!env.BOT_TOKEN || !store) return;
    const api = makeApi(env.BOT_TOKEN);
    for (const d of await store.takeDue(Date.now())) {
      try {
        await api("sendMessage", {
          chat_id: d.chat_id,
          ...(d.thread_id ? { message_thread_id: d.thread_id } : {}),
          text: reminderText(d, tzOf(env)),
          parse_mode: "HTML",
        });
      } catch (e) {
        console.error(`reminder #${d.id}: ${e.message}`);
      }
    }
  },
};
