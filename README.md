# econ315-simplecalculator

A Telegram bot for the ECON315 group chat that calculates each student's 30% component:

```
component = min(100, (1/3 × midterm + 2/3 × final) × (1 + bonus%))
```

Midterm and final are out of 100. A bonus of 10 means ×1.10. The bot also shows the component's points out of 30, and an estimated course total, assuming 30% midterm + 40% final + 30% component.

## How students use it

| Where | Type | Who sees the answer |
|---|---|---|
| Group | `/score 72 85 10` | Only the sender (ephemeral message, Bot API 10.2+) |
| Any chat | `@YourBot 72 85 10` (don't send it; read the popup) | Only you, until you tap the result to post it |
| Private chat with the bot | `/score 72 85 10` | Only you |

The bonus is optional (`/score 72 85`). Decimal commas work.

If an ephemeral reply isn't possible, the bot doesn't post marks in the group. It tries to delete the visible command, sends the answer by DM instead, and if that fails too, posts a hint about how to get a private answer. As a safety net, any reply Telegram posts as a normal message is deleted immediately.

## Setup

1. In Telegram, open **@BotFather**:
   - `/newbot` → pick a name. Copy the token.
   - `/setinline` → choose the bot → enter a placeholder such as `midterm final bonus`. This enables `@YourBot 72 85 10`.
2. Add the bot to the group and **make it an admin** with the "Delete messages" right. The admin role lets it send ephemeral messages reliably. The delete right lets it remove commands that people typed visibly.
3. Run it on any machine with Python 3.9+ (no dependencies):

   ```bash
   BOT_TOKEN=123456:ABC... python3 bot.py
   ```

   The bot uses long polling, so it needs no public URL. Keep it running on a small always-on server, such as a VPS, a Raspberry Pi, or a free-tier cloud VM.

## Tests

```bash
python3 -m unittest -v
```
