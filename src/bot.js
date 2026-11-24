// Telegram update handling. `api(method, params)` calls the Bot API and
// throws TelegramError on failure; it is injected so the logic can be tested.

import { InputError, compute, fmt, letterFor, parseNumbers, requiredFinal } from "../public/calc.js";
import { deadlineCommand } from "./deadlines.js";
import { NEED_USAGE, SCORE_USAGE, esc, helpMessage, needReply, parseNeed, scoreReply, startMessage } from "./messages.js";

export class TelegramError extends Error {}

// Commands everyone sees in the menu; all answered privately.
export const COMMANDS = [
  { command: "score", description: "Your grade: /score midterm final [bonus]" },
  { command: "need", description: "Final needed: /need [grade] midterm [bonus]" },
  { command: "calc", description: "Open the grade calculator app" },
  { command: "deadlines", description: "Upcoming deadlines" },
  { command: "help", description: "How to use the bot" },
];

// Extra commands shown only to group admins.
export const ADMIN_COMMANDS = [
  { command: "deadline", description: "Add a deadline: /deadline 05.12 23:59 Title", public: true },
  { command: "deadline_delete", description: "Remove a deadline: /deadline_delete id" },
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
  const ephemeral = (list) => list.map(({ public: pub, ...c }) => ({ ...c, is_ephemeral: !pub }));
  const plain = (list) => list.map(({ public: _, ...c }) => c);
  const admins = { type: "all_chat_administrators" };
  try {
    await api("setMyCommands", { commands: ephemeral(COMMANDS) });
    await api("setMyCommands", { commands: ephemeral([...COMMANDS, ...ADMIN_COMMANDS]), scope: admins });
    return "ephemeral";
  } catch (e) {
    console.log(`Ephemeral commands not accepted (${e.message}); registering plain ones`);
    await api("setMyCommands", { commands: plain(COMMANDS) });
    await api("setMyCommands", { commands: plain([...COMMANDS, ...ADMIN_COMMANDS]), scope: admins });
    return "plain";
  }
}

// Mini app: menu button in private chats with the bot.
export async function registerMenuButton(api, appUrl) {
  await api("setChatMenuButton", { menu_button: { type: "web_app", text: "Calculator", web_app: { url: appUrl } } });
}

// opts: { store, tz, appUrl, now } — store and tz are needed for deadlines.
export async function handleUpdate(api, username, update, opts = {}) {
  if (update.inline_query) return onInline(api, username, update.inline_query);
  const msg =
    update.message ??
    Object.values(update).find((v) => v && typeof v === "object" && v.chat && typeof v.text === "string");
  if (msg?.text?.startsWith("/")) return onCommand(api, username, msg, opts);
}

function parseCommand(text, username) {
  const space = text.search(/\s/);
  const head = space < 0 ? text : text.slice(0, space);
  const args = space < 0 ? "" : text.slice(space + 1);
  const [cmd, target] = head.slice(1).split("@");
  if (target && target.toLowerCase() !== username.toLowerCase()) return null; // another bot's command
  return [cmd.toLowerCase(), args];
}

function replyFor(cmd, args) {
  if (cmd === "score") return args.trim() ? scoreReply(args) : esc(SCORE_USAGE);
  if (cmd === "need") return args.trim() ? needReply(args) : esc(NEED_USAGE);
  if (cmd === "help") return helpMessage();
  if (cmd === "start") return startMessage();
  return null;
}

function calcReply(msg, username, appUrl) {
  // web_app buttons only work in private chats; in groups, link to the bot's
  // main mini app instead (set up once in @BotFather).
  const button =
    msg.chat.type === "private" && appUrl
      ? { text: "🧮 Open calculator", web_app: { url: appUrl } }
      : { text: "🧮 Open calculator", url: `https://t.me/${username}?startapp` };
  return {
    text: "🧮 <b>Grade calculator</b>\nDrag the sliders to see your grade and what you need on the final. Nothing you enter leaves your phone.",
    markup: { inline_keyboard: [[button]] },
  };
}

async function onCommand(api, username, msg, opts) {
  const parsed = parseCommand(msg.text, username);
  if (!parsed) return;
  const [cmd, args] = parsed;

  let reply;
  if (["deadline", "deadlines", "deadline_delete"].includes(cmd)) {
    if (!opts.store) return;
    const out = await deadlineCommand(cmd, args, msg, { api, store: opts.store, tz: opts.tz, now: opts.now });
    if (!out) return;
    if (out.public) return api("sendMessage", { chat_id: msg.chat.id, ...topicOf(msg), text: out.public, ...HTML });
    reply = { text: out.private };
  } else if (cmd === "calc") {
    reply = calcReply(msg, username, opts.appUrl);
  } else {
    const text = replyFor(cmd, args);
    if (text === null) return;
    reply = { text };
  }

  if (msg.chat.type === "private") {
    return api("sendMessage", { chat_id: msg.chat.id, text: reply.text, ...HTML, ...markup(reply) });
  }
  return replyPrivatelyInGroup(api, username, msg, reply);
}

const markup = (reply) => (reply.markup ? { reply_markup: reply.markup } : {});

// In groups with topics, answer in the topic the command was sent from
// (otherwise Telegram puts the reply in "General").
const topicOf = (msg) =>
  msg.chat.is_forum && msg.message_thread_id ? { message_thread_id: msg.message_thread_id } : {};

async function replyPrivatelyInGroup(api, username, msg, reply) {
  const chatId = msg.chat.id;
  const user = msg.from;
  const ephId = msg.ephemeral_message_id;
  const topic = topicOf(msg);

  let sent = false;
  try {
    await sendEphemeral(api, chatId, user.id, reply, ephId, topic);
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
  if (await tryCall(api, "sendMessage", { chat_id: user.id, text: reply.text, ...HTML, ...markup(reply) })) return;
  // Fallback 2: explain how to get a private answer, without echoing any marks.
  await tryCall(api, "sendMessage", {
    chat_id: chatId,
    ...topic,
    text:
      `${esc(user.first_name ?? "Hi")}, I couldn't answer you privately here. Either message me at ` +
      `@${esc(username)} (press Start once), or type <code>@${esc(username)} 72 85 10</code> ` +
      "in the message box for a private preview.",
    ...HTML,
  });
}

async function sendEphemeral(api, chatId, userId, reply, ephId, topic = {}) {
  const params = {
    chat_id: chatId,
    ...topic,
    text: reply.text,
    ...HTML,
    ...markup(reply),
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
      title: need ? "Type: need [grade] midterm [bonus]" : "Type: midterm final [bonus]",
      description: need ? "e.g. need A 70 20" : "e.g. 72 85 10  ·  or: need A 70 20",
      body: helpMessage(),
    };
  }
  try {
    if (need) {
      const { grade, midterm, bonus } = parseNeed(args);
      let title = "Final exam needed for each grade";
      if (grade) {
        const r = requiredFinal(midterm, bonus, grade.min);
        title =
          r.final === null ? `${grade.letter} is out of reach`
          : r.final === 0 ? `You get ${grade.letter} even with 0 on the final`
          : `${grade.letter}: you need ${fmt(r.final)} / 100 on the final`;
      }
      return { title, body: needReply(args) };
    }
    const [m, f, b = 0] = parseNumbers(args, 2, 3, SCORE_USAGE);
    const r = compute(m, f, b);
    return {
      title: `${letterFor(r.courseTotal).letter} · total ${fmt(r.courseTotal)} / 100 · 30% part ${fmt(r.componentPoints)} / 30`,
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
