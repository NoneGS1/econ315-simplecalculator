// Deadline storage on SQLite. `sql.exec(query, ...params)` must return an
// object with toArray() (Durable Object SQL storage has exactly this shape;
// the tests use node:sqlite through a small adapter).

// Reminders go out this long before the deadline, in this order.
export const REMINDER_OFFSETS = [
  { ms: 3 * 24 * 3600e3, label: "in 3 days" },
  { ms: 24 * 3600e3, label: "tomorrow" },
  { ms: 3 * 3600e3, label: "in 3 hours" },
];

// Index of the next reminder that has not yet become due at `now`.
export function nextStage(due, now) {
  let stage = 0;
  while (stage < REMINDER_OFFSETS.length && due - REMINDER_OFFSETS[stage].ms <= now) stage++;
  return stage;
}

export class DeadlineStore {
  constructor(sql) {
    this.sql = sql;
    this.rows(`CREATE TABLE IF NOT EXISTS deadlines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      thread_id INTEGER,
      title TEXT NOT NULL,
      due INTEGER NOT NULL,
      stage INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER
    )`);
  }

  rows(query, ...params) {
    return this.sql.exec(query, ...params).toArray();
  }

  add({ chatId, threadId = null, title, due, createdBy = null, now = Date.now() }) {
    // Reminders whose time has already passed are skipped, not sent at once.
    const [row] = this.rows(
      "INSERT INTO deadlines (chat_id, thread_id, title, due, stage, created_by) VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
      chatId, threadId, title, due, nextStage(due, now), createdBy,
    );
    return row.id;
  }

  upcoming(chatId, now = Date.now()) {
    return this.rows("SELECT * FROM deadlines WHERE chat_id = ? AND due > ? ORDER BY due", chatId, now);
  }

  remove(chatId, id) {
    return this.rows("DELETE FROM deadlines WHERE chat_id = ? AND id = ? RETURNING id, title", chatId, id)[0] ?? null;
  }

  // Reminders to send now. Each deadline gets at most one (the latest due
  // stage) per run, and is marked so it is never sent twice.
  takeDue(now = Date.now()) {
    const out = [];
    const open = this.rows("SELECT * FROM deadlines WHERE due > ? AND stage < ?", now, REMINDER_OFFSETS.length);
    for (const d of open) {
      const stage = nextStage(d.due, now);
      if (stage > d.stage) {
        this.rows("UPDATE deadlines SET stage = ? WHERE id = ?", stage, d.id);
        out.push({ ...d, label: REMINDER_OFFSETS[stage - 1].label });
      }
    }
    // Forget deadlines that ended more than a week ago.
    this.rows("DELETE FROM deadlines WHERE due < ?", now - 7 * 24 * 3600e3);
    return out;
  }
}
