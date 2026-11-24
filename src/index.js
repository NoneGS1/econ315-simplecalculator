// Cloudflare Worker entry point.
//
//   POST /webhook  Telegram sends updates here (checked with a secret header).
//   GET  /setup    Registers the webhook and the bot's commands. Open it once
//                  after deploying and whenever BOT_TOKEN changes.
//
// Required secret: BOT_TOKEN (from @BotFather).

import { handleUpdate, makeApi, registerCommands } from "./bot.js";

let cachedUsername;

// Derive the webhook secret from the bot token so only one secret is needed.
async function webhookSecret(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`webhook:${token}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 64);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!env.BOT_TOKEN) return new Response("BOT_TOKEN secret is not set", { status: 500 });
    const api = makeApi(env.BOT_TOKEN);

    if (url.pathname === "/webhook" && request.method === "POST") {
      const secret = await webhookSecret(env.BOT_TOKEN);
      if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== secret) {
        return new Response("forbidden", { status: 403 });
      }
      const update = await request.json();
      try {
        cachedUsername ??= (await api("getMe")).username;
        await handleUpdate(api, cachedUsername, update);
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
        return Response.json({ ok: true, bot: `@${me.username}`, webhook: `${url.origin}/webhook`, commands });
      } catch (e) {
        return Response.json({ ok: false, error: e.message }, { status: 502 });
      }
    }

    return new Response("ECON315 score bot is running. Open /setup once after deploying.");
  },
};
