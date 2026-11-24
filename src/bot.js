// Telegram update handling. `api(method, params)` calls the Bot API and
// throws TelegramError on failure; it is injected so the logic can be tested.

import { InputError, compute, fmt, parseNumbers, requiredFinal } from "./calc.js";
import { NEED_USAGE, SCORE_USAGE, esc, helpMessage, needReply, scoreReply } from "./messages.js";

export class TelegramError extends Error {}

export const COMMANDS = [
  { command: "score", description: "Your 30% part and course total (only you see it)" },
  { command: "need", description: "Final exam score you need to pass (only you see it)" },
  { command: "help", description: "How to use the calculator" },
];

const HTML = { parse_mode: "HTML", link_preview_options: { is_disabled: true } };

export function makeApi(token, fetchFn = fetch) {
  return async (method, params = {}) => {
    const res = await fetchFn(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    const body = await res.json();
    if (!body.ok) throw new TelegramError(`${method}: ${body.description ?? res.status}`);
    return body.result;
  };
}

async function tryCall(api, method, params) {
  try {
    return await api(method, params);
  } catch (e) {
    console.log(String(e));
    return null;
  }
}

export async function registerCommands(api) {
  try {
    await api("setMyCommands", { commands: COMMANDS.map((c) => ({ ...c, is_ephemeral: true })) });
    return "ephemeral";
  } catch (e) {
    console.log(`Ephemeral commands not accepted (${e.message}); registering plain ones`);
    await api("setMyCommands", { commands: COMMANDS });
    return "plain";
  }
}

export async function handleUpdate(api, username, update) {
  if (update.inline_query) return onInline(api, username, update.inline_query);
  const msg =
    update.message ??
    Object.values(update).find((v) => v && typeof v === "object" && v.chat && typeof v.text === "string");
  if (msg?.text?.startsWith("/")) return onCommand(api, username, msg);
}

function parseCommand(text, username) {
  const space = text.search(/\s/);
  const head = space < 0 ? text : text.slice(0, space);
  const args = space < 0 ? "" : text.slice(space + 1);
  const [cmd, target] = head.slice(1).split("@");
  if (target && target.toLowerCase() !== username.toLowerCase()) return null; // another bot's command
  return [cmd.toLowerCase(), args];
}

function replyFor(cmd, args, username) {
  if (cmd === "score") return args.trim() ? scoreReply(args) : esc(SCORE_USAGE);
  if (cmd === "need") return args.trim() ? needReply(args) : esc(NEED_USAGE);
  if (cmd === "help" || cmd === "start") return helpMessage(username);
  return null;
}

async function onCommand(api, username, msg) {
  const parsed = parseCommand(msg.text, username);
  if (!parsed) return;
  const reply = replyFor(...parsed, username);
  if (reply === null) return;

  if (msg.chat.type === "private") return api("sendMessage", { chat_id: msg.chat.id, text: reply, ...HTML });
  return replyPrivatelyInGroup(api, username, msg, reply);
}

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
    // A visible command may contain someone's marks; remove it if we are
    // allowed to (needs the "Delete messages" admin right).
    await tryCall(api, "deleteMessage", { chat_id: chatId, message_id: msg.message_id });
  }
  if (sent) return;

  // Fallback 1: direct message (works once the user has pressed Start in DM).
  if (await tryCall(api, "sendMessage", { chat_id: user.id, text: reply, ...HTML })) return;
  // Fallback 2: explain how to get a private answer, without echoing any marks.
  await tryCall(api, "sendMessage", {
    chat_id: chatId,
    text:
      `${esc(user.first_name ?? "Hi")}, I couldn't answer you privately here. Either message me at ` +
      `@${esc(username)} (press Start once), or type <code>@${esc(username)} 72 85 10</code> ` +
      "in the message box for a private preview.",
    ...HTML,
  });
}

async function sendEphemeral(api, chatId, userId, text, ephId) {
  const params = {
    chat_id: chatId,
    text,
    ...HTML,
    ephemeral_message_parameters: { receiver_user_id: userId },
  };
  if (ephId) params.reply_parameters = { ephemeral_message_id: ephId };
  const sent = await api("sendMessage", params);
  // Safety net: ephemeral messages come back with message_id 0. If Telegram
  // ignored the parameters and posted a normal message, delete it at once.
  if (sent?.message_id) {
    await tryCall(api, "deleteMessage", { chat_id: chatId, message_id: sent.message_id });
    throw new TelegramError("message was not sent as ephemeral");
  }
}

// Inline mode: "@bot 72 85 10" or "@bot need 72 10".
function inlineResult(q, username) {
  const need = /^need\b/i.test(q);
  const args = need ? q.replace(/^need\b/i, "") : q;
  if (!args.trim()) {
    return {
      title: need ? "Type: need midterm [bonus]" : "Type: midterm final [bonus]",
      description: need ? "e.g. need 72 10" : "e.g. 72 85 10  ·  or: need 72 10",
      body: helpMessage(username),
    };
  }
  try {
    if (need) {
      const [m, b = 0, t] = parseNumbers(args, 1, 3, NEED_USAGE);
      const r = requiredFinal(m, b, t);
      const title =
        r.final === null ? "Not reachable, even with 100 on the final"
        : r.final === 0 ? "You pass even with 0 on the final"
        : `You need ${fmt(r.final)} / 100 on the final`;
      return { title, body: needReply(args) };
    }
    const [m, f, b = 0] = parseNumbers(args, 2, 3, SCORE_USAGE);
    const r = compute(m, f, b);
    return {
      title: `30% part: ${fmt(r.componentPoints)} / 30 · total ${fmt(r.courseTotal)} / 100`,
      body: scoreReply(args),
    };
  } catch (e) {
    if (!(e instanceof InputError)) throw e;
    return { title: "Can't calculate", description: e.message.split("\n")[0], body: `⚠️ ${esc(e.message)}` };
  }
}

async function onInline(api, username, query) {
  const { title, description, body } = inlineResult((query.query ?? "").trim(), username);
  return api("answerInlineQuery", {
    inline_query_id: query.id,
    is_personal: true,
    cache_time: 0,
    results: [
      {
        type: "article",
        id: "result",
        title,
        description: description ?? "Only you see this preview. Tap to post it to the chat.",
        input_message_content: { message_text: body, ...HTML },
      },
    ],
  });
}
