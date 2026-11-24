// /deadline, /deadlines, /deadline_delete and the reminder messages.

import { InputError } from "../public/calc.js";
import { DEADLINE_USAGE, formatDate, parseDeadline, timeLeft } from "./time.js";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const tzName = (tz) => tz.split("/").pop().replace(/_/g, " ");

async function isAdmin(api, msg) {
  if (msg.sender_chat && msg.sender_chat.id === msg.chat.id) return true; // anonymous admin
  try {
    const m = await api("getChatMember", { chat_id: msg.chat.id, user_id: msg.from.id });
    return m.status === "creator" || m.status === "administrator";
  } catch {
    return false;
  }
}

// Returns { public: text } to post in the topic, or { private: text } to show
// only to the sender.
export async function deadlineCommand(cmd, args, msg, { api, store, tz, now = Date.now() }) {
  const inGroup = msg.chat.type !== "private";

  if (cmd === "deadlines") {
    if (!inGroup) return { private: "Use /deadlines in the group to see its deadlines." };
    const list = await store.upcoming(msg.chat.id, now);
    if (!list.length) return { private: "🗓 No upcoming deadlines. 🎉" };
    return {
      private: [
        "🗓 <b>Upcoming deadlines</b>",
        ...list.map((d) => `\n<b>${esc(d.title)}</b>\n${formatDate(tz, d.due)} · ${timeLeft(d.due, now)} · <code>#${d.id}</code>`),
        `\n<i>Times are ${esc(tzName(tz))} time.</i>`,
      ].join("\n"),
    };
  }

  // Adding and removing are for group admins only.
  if (!inGroup) return { private: "Add deadlines in the group, inside the topic where the reminders should go." };
  if (!(await isAdmin(api, msg))) return { private: "Only group admins can add or remove deadlines." };

  if (cmd === "deadline") {
    try {
      const { due, title } = parseDeadline(args, tz, now);
      const id = await store.add({
        chatId: msg.chat.id,
        threadId: msg.chat.is_forum && msg.message_thread_id ? msg.message_thread_id : null,
        title, due, createdBy: msg.from?.id ?? null, now,
      });
      return {
        public: [
          "📌 <b>New deadline</b>",
          `<b>${esc(title)}</b>`,
          `🗓 ${formatDate(tz, due)} (${esc(tzName(tz))} time) · ${timeLeft(due, now)}`,
          "",
          `<i>I'll remind you 3 days, 1 day and 3 hours before. All deadlines: /deadlines · id <code>#${id}</code></i>`,
        ].join("\n"),
      };
    } catch (e) {
      if (e instanceof InputError) return { private: `⚠️ ${esc(e.message)}` };
      throw e;
    }
  }

  if (cmd === "deadline_delete") {
    const id = parseInt(args.replace("#", ""), 10);
    if (!id) return { private: "Usage: /deadline_delete id\nThe ids are shown in /deadlines." };
    const removed = await store.remove(msg.chat.id, id);
    return { private: removed ? `🗑 Removed: <b>${esc(removed.title)}</b>` : `No deadline with id #${id} in this group.` };
  }
  return null;
}

export const reminderText = (d, tz) =>
  `⏰ <b>${esc(d.title)}</b> is due ${d.label}\n🗓 ${formatDate(tz, d.due)} (${esc(tzName(tz))} time)`;

export { DEADLINE_USAGE };
