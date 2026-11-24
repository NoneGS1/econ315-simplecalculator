// Telegram update handling. `api(method, params)` calls the Bot API and
// throws TelegramError on failure; it is injected so the logic can be tested.

import { USAGE, InputError, answer, compute, fmt, formatResult, parseArgs } from "./calc.js";

export class TelegramError extends Error {}

export const COMMANDS = [
  { command: "score", description: "Calculate your 30% component (only you see it)" },
  { command: "help", description: "How to use the calculator" },
];

const help = (username) =>
  "I calculate the 30% component of the ECON315 grade:\n" +
  "min(100, (1/3 x midterm + 2/3 x final) x (1 + bonus%))\n\n" +
  USAGE +
  "\n\nIn the group only you see my answer. You can also type " +
  `@${username} 72 85 10 in any chat for a private preview.`;

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
  const space = text.indexOf(" ");
  const head = space < 0 ? text : text.slice(0, space);
  const args = space < 0 ? "" : text.slice(space + 1);
  const [cmd, target] = head.slice(1).split("@");
  if (target && target.toLowerCase() !== username.toLowerCase()) return null; // another bot's command
  return [cmd.toLowerCase(), args];
}

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
  if (await tryCall(api, "sendMessage", { chat_id: user.id, text: reply })) return;
  // Fallback 2: explain how to get a private answer, without echoing any marks.
  await tryCall(api, "sendMessage", {
    chat_id: chatId,
    text:
      `${user.first_name ?? "Hi"}, I couldn't answer you privately here. Either message me at ` +
      `@${username} (press Start once), or type @${username} 72 85 10 in the message box ` +
      "for a private preview.",
  });
}

async function sendEphemeral(api, chatId, userId, text, ephId) {
  const params = {
    chat_id: chatId,
    text,
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
        input_message_content: { message_text: body },
      },
    ],
  });
}
