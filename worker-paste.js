// ECON315 score bot - paste this whole file into the Cloudflare Worker editor.
// Generated from src/ (npx wrangler deploy --dry-run). Edit src/, not this file.

var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/calc.js
var USAGE = "Usage: /score <midterm> <final> [bonus]\nExample: /score 72 85 10\nMidterm and final are out of 100; bonus is in % (10 means x1.10).";
var CAP = 100;
var COMPONENT_WEIGHT = 0.3;
var MIDTERM_WEIGHT = 0.3;
var FINAL_WEIGHT = 0.4;
var InputError = class extends Error {
  static {
    __name(this, "InputError");
  }
};
var fmt = /* @__PURE__ */ __name((x) => String(Number(x.toFixed(2))), "fmt");
function compute(midterm, final, bonus = 0) {
  for (const [name, v] of [["Midterm", midterm], ["Final", final]]) {
    if (!(v >= 0 && v <= 100)) throw new InputError(`${name} must be between 0 and 100 (got ${fmt(v)}).`);
  }
  if (!(bonus >= 0 && bonus <= 100)) throw new InputError(`Bonus must be between 0 and 100 % (got ${fmt(bonus)}).`);
  const weighted = midterm / 3 + 2 * final / 3;
  const boosted = weighted * (1 + bonus / 100);
  const component = Math.min(CAP, boosted);
  const componentPoints = component * COMPONENT_WEIGHT;
  return {
    midterm,
    final,
    bonus,
    weighted,
    boosted,
    component,
    componentPoints,
    capped: boosted > CAP,
    courseTotal: midterm * MIDTERM_WEIGHT + final * FINAL_WEIGHT + componentPoints
  };
}
__name(compute, "compute");
var NUMBER = /^[+-]?(\d+([.,]\d*)?|[.,]\d+)%?$/;
function parseArgs(text) {
  const parts = text.replace(/;/g, " ").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2 || parts.length > 3) throw new InputError(USAGE);
  const nums = parts.map((p) => {
    if (!NUMBER.test(p)) throw new InputError(`'${p}' is not a number.

${USAGE}`);
    return parseFloat(p.replace(/%$/, "").replace(",", "."));
  });
  if (nums.length === 2) nums.push(0);
  return nums;
}
__name(parseArgs, "parseArgs");
function formatResult(r) {
  const lines = [
    `Midterm ${fmt(r.midterm)}, final ${fmt(r.final)}, bonus ${fmt(r.bonus)}%`,
    `1/3 x midterm + 2/3 x final = ${fmt(r.weighted)}`
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
    "(30% midterm + 40% final + 30% component)"
  );
  return lines.join("\n");
}
__name(formatResult, "formatResult");
function answer(text) {
  try {
    return formatResult(compute(...parseArgs(text)));
  } catch (e) {
    if (e instanceof InputError) return e.message;
    throw e;
  }
}
__name(answer, "answer");

// src/bot.js
var TelegramError = class extends Error {
  static {
    __name(this, "TelegramError");
  }
};
var COMMANDS = [
  { command: "score", description: "Calculate your 30% component (only you see it)" },
  { command: "help", description: "How to use the calculator" }
];
var help = /* @__PURE__ */ __name((username) => "I calculate the 30% component of the ECON315 grade:\nmin(100, (1/3 x midterm + 2/3 x final) x (1 + bonus%))\n\n" + USAGE + `

In the group only you see my answer. You can also type @${username} 72 85 10 in any chat for a private preview.`, "help");
function makeApi(token, fetchFn = fetch) {
  return async (method, params = {}) => {
    const res = await fetchFn(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params)
    });
    const body = await res.json();
    if (!body.ok) throw new TelegramError(`${method}: ${body.description ?? res.status}`);
    return body.result;
  };
}
__name(makeApi, "makeApi");
async function tryCall(api, method, params) {
  try {
    return await api(method, params);
  } catch (e) {
    console.log(String(e));
    return null;
  }
}
__name(tryCall, "tryCall");
async function registerCommands(api) {
  try {
    await api("setMyCommands", { commands: COMMANDS.map((c) => ({ ...c, is_ephemeral: true })) });
    return "ephemeral";
  } catch (e) {
    console.log(`Ephemeral commands not accepted (${e.message}); registering plain ones`);
    await api("setMyCommands", { commands: COMMANDS });
    return "plain";
  }
}
__name(registerCommands, "registerCommands");
async function handleUpdate(api, username, update) {
  if (update.inline_query) return onInline(api, username, update.inline_query);
  const msg = update.message ?? Object.values(update).find((v) => v && typeof v === "object" && v.chat && typeof v.text === "string");
  if (msg?.text?.startsWith("/")) return onCommand(api, username, msg);
}
__name(handleUpdate, "handleUpdate");
function parseCommand(text, username) {
  const space = text.indexOf(" ");
  const head = space < 0 ? text : text.slice(0, space);
  const args = space < 0 ? "" : text.slice(space + 1);
  const [cmd, target] = head.slice(1).split("@");
  if (target && target.toLowerCase() !== username.toLowerCase()) return null;
  return [cmd.toLowerCase(), args];
}
__name(parseCommand, "parseCommand");
async function onCommand(api, username, msg) {
  const parsed = parseCommand(msg.text, username);
  if (!parsed) return;
  const [cmd, args] = parsed;
  let reply;
  if (cmd === "score") reply = args.trim() ? answer(args) : USAGE;
  else if (cmd === "help" || cmd === "start") reply = help(username);
  else return;
  if (msg.chat.type === "private") return api("sendMessage", { chat_id: msg.chat.id, text: reply });
  return replyPrivatelyInGroup(api, username, msg, reply);
}
__name(onCommand, "onCommand");
async function replyPrivatelyInGroup(api, username, msg, reply) {
  const chatId = msg.chat.id;
  const user = msg.from;
  const ephId = msg.ephemeral_message_id;
  let sent = false;
  try {
    await sendEphemeral(api, chatId, user.id, reply, ephId);
    sent = true;
  } catch (e) {
    console.log(`Ephemeral reply failed: ${e.message}`);
  }
  if (!ephId) {
    await tryCall(api, "deleteMessage", { chat_id: chatId, message_id: msg.message_id });
  }
  if (sent) return;
  if (await tryCall(api, "sendMessage", { chat_id: user.id, text: reply })) return;
  await tryCall(api, "sendMessage", {
    chat_id: chatId,
    text: `${user.first_name ?? "Hi"}, I couldn't answer you privately here. Either message me at @${username} (press Start once), or type @${username} 72 85 10 in the message box for a private preview.`
  });
}
__name(replyPrivatelyInGroup, "replyPrivatelyInGroup");
async function sendEphemeral(api, chatId, userId, text, ephId) {
  const params = {
    chat_id: chatId,
    text,
    ephemeral_message_parameters: { receiver_user_id: userId }
  };
  if (ephId) params.reply_parameters = { ephemeral_message_id: ephId };
  const sent = await api("sendMessage", params);
  if (sent?.message_id) {
    await tryCall(api, "deleteMessage", { chat_id: chatId, message_id: sent.message_id });
    throw new TelegramError("message was not sent as ephemeral");
  }
}
__name(sendEphemeral, "sendEphemeral");
async function onInline(api, username, query) {
  const q = (query.query ?? "").trim();
  let title, body;
  if (!q) {
    title = "Type: midterm final [bonus]";
    body = USAGE.replace("/score", `@${username}`);
  } else {
    try {
      const r = compute(...parseArgs(q));
      title = `30% component: ${fmt(r.component)}/100 (${fmt(r.componentPoints)}/30)`;
      body = formatResult(r);
    } catch (e) {
      if (!(e instanceof InputError)) throw e;
      title = "Can't calculate";
      body = e.message;
    }
  }
  return api("answerInlineQuery", {
    inline_query_id: query.id,
    is_personal: true,
    cache_time: 0,
    results: [
      {
        type: "article",
        id: "score",
        title,
        description: "Only you see this preview. Tap to post it to the chat.",
        input_message_content: { message_text: body }
      }
    ]
  });
}
__name(onInline, "onInline");

// src/index.js
var cachedUsername;
async function webhookSecret(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`webhook:${token}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 64);
}
__name(webhookSecret, "webhookSecret");
var index_default = {
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
      return new Response("ok");
    }
    if (url.pathname === "/setup") {
      try {
        const me = await api("getMe");
        await api("setWebhook", {
          url: `${url.origin}/webhook`,
          secret_token: await webhookSecret(env.BOT_TOKEN),
          drop_pending_updates: true
        });
        const commands = await registerCommands(api);
        return Response.json({ ok: true, bot: `@${me.username}`, webhook: `${url.origin}/webhook`, commands });
      } catch (e) {
        return Response.json({ ok: false, error: e.message }, { status: 502 });
      }
    }
    return new Response("ECON315 score bot is running. Open /setup once after deploying.");
  }
};
export {
  index_default as default
};
