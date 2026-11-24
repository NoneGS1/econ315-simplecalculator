# econ315-simplecalculator

A Telegram bot for the ECON315 group chat that calculates each student's 30% component. It runs on Cloudflare Workers.

```
component = min(100, (1/3 × midterm + 2/3 × final) × (1 + bonus%))
```

Midterm and final are out of 100. A bonus of 10 means ×1.10. The bot also shows the component's points out of 30, and the course total: 30% midterm + 40% final + 30% component. `/score` also gives the letter grade (A+ 93+, A 85+, B+ 75+, B 65+, C+ 60+, C 50+, D 40+, F below 40). `/need` gives the lowest final exam score for a grade.

## How students use it

| Where | Type | Who sees the answer |
|---|---|---|
| Group | `/score 72 85 10`, `/need A 70 20` or `/need 70 20` (every grade) | Only the sender (ephemeral message, Bot API 10.2+) |
| Any chat | `@YourBot 72 85 10` or `@YourBot need A 70 20` (don't send it; read the popup) | Only you, until you tap the result to post it |
| Private chat with the bot | `/score 72 85 10` | Only you |

`/calc` opens a calculator mini app with sliders (served from `public/app/`; all math runs on the phone).

**Deadlines.** Group admins add them with `/deadline 05.12 23:59 Game Theory HW3`, inside the topic where reminders should go. The bot announces the deadline, then reminds that topic 3 days, 1 day and 3 hours before. Anyone can see the list privately with `/deadlines`. Admins can remove one with `/deadline_delete <id>`. Times use `TIMEZONE` in `wrangler.toml` (Asia/Tashkent).

The bonus is optional (`/score 72 85`). Decimal commas work.

If an ephemeral reply isn't possible, the bot doesn't post marks in the group. It tries to delete the visible command, sends the answer by DM instead, and if that fails too, posts a hint about how to get a private answer. As a safety net, any reply Telegram posts as a normal message is deleted immediately.

## Setup

1. In Telegram, open **@BotFather**:
   - `/newbot` → pick a name. Copy the token.
   - `/setinline` → choose the bot → enter a placeholder such as `midterm final bonus`. This enables `@YourBot 72 85 10`.
2. Deploy the Worker. Either connect this repo in the dashboard (**Workers & Pages → Create → Import a repository**), which redeploys on every push to `main`, or run:

   ```bash
   npm install
   npx wrangler deploy
   ```

3. Add the bot token as a secret named `BOT_TOKEN`. In the Cloudflare dashboard, go to **Workers & Pages → econ315-score-bot → Settings → Variables and Secrets → Add → Secret**. Or run:

   ```bash
   npx wrangler secret put BOT_TOKEN
   ```

4. Open `https://econ315-score-bot.<your-subdomain>.workers.dev/setup` once. This registers the Telegram webhook and the `/score`, `/need` and `/help` commands. Repeat this step whenever the token or the command list changes.
5. Mini app: in @BotFather, open your bot → **Bot Settings** → **Configure Mini App** → enable it with the URL `https://econ315-score-bot.<your-subdomain>.workers.dev/app/`. This makes the `/calc` button work in groups. In private chats, `/setup` already adds a **Calculator** menu button.
6. Add the bot to the group and **make it an admin** with the "Delete messages" right. The admin role lets it send ephemeral messages reliably. The delete right lets it remove commands that people typed visibly.

Deadlines live in a SQLite Durable Object (`Store`), and a cron trigger checks for reminders every 15 minutes. Both are declared in `wrangler.toml`, so a deploy creates them.

Logs: `npx wrangler tail`, or the Worker's **Logs** tab in the dashboard.

## Tests

```bash
npm test
```
