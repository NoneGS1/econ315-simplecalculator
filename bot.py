"""Telegram bot that calculates the ECON315 30% component privately.

In a group, `/score 72 85 10` is answered with an *ephemeral* message
(Bot API 10.2+), which only the sender can see. Inline mode
(`@YourBot 72 85 10`) and private chat work too.

Run:  BOT_TOKEN=123:abc python3 bot.py
Uses only the Python standard library.
"""

from __future__ import annotations

import json
import logging
import os
import time
import urllib.error
import urllib.request

import calc

log = logging.getLogger("econ315bot")

HELP = (
    "I calculate the 30% component of the ECON315 grade:\n"
    "min(100, (1/3 x midterm + 2/3 x final) x (1 + bonus%))\n\n"
    + calc.USAGE
    + "\n\nIn the group only you see my answer. You can also type "
    "@{username} 72 85 10 in any chat for a private preview."
)

COMMANDS = [
    {"command": "score", "description": "Calculate your 30% component (only you see it)"},
    {"command": "help", "description": "How to use the calculator"},
]


class TelegramError(Exception):
    pass


class Api:
    def __init__(self, token: str, base: str = "https://api.telegram.org"):
        self.url = f"{base}/bot{token}/"

    def __call__(self, method: str, **params):
        data = json.dumps(params).encode()
        req = urllib.request.Request(
            self.url + method, data=data, headers={"Content-Type": "application/json"}
        )
        try:
            with urllib.request.urlopen(req, timeout=70) as resp:
                body = json.load(resp)
        except urllib.error.HTTPError as e:
            body = json.load(e)
        if not body.get("ok"):
            raise TelegramError(f"{method}: {body.get('description', body)}")
        return body["result"]


class Bot:
    def __init__(self, api):
        self.api = api
        self.username = api("getMe")["username"]

    # --- setup -----------------------------------------------------------

    def register_commands(self) -> None:
        ephemeral = [dict(c, is_ephemeral=True) for c in COMMANDS]
        try:
            self.api("setMyCommands", commands=ephemeral)
        except TelegramError as e:
            log.warning("Ephemeral commands not accepted (%s); registering plain ones", e)
            self.api("setMyCommands", commands=COMMANDS)

    # --- update handling -------------------------------------------------

    def handle(self, update: dict) -> None:
        if "inline_query" in update:
            self.on_inline(update["inline_query"])
            return
        msg = update.get("message")
        if msg is None:  # tolerate other message-like update keys
            msg = next(
                (v for v in update.values() if isinstance(v, dict) and "chat" in v and "text" in v),
                None,
            )
        if msg and msg.get("text", "").startswith("/"):
            self.on_command(msg)

    def parse_command(self, text: str) -> tuple[str, str] | None:
        head, _, args = text.partition(" ")
        cmd, _, target = head[1:].partition("@")
        if target and target.lower() != self.username.lower():
            return None  # addressed to another bot
        return cmd.lower(), args

    def on_command(self, msg: dict) -> None:
        parsed = self.parse_command(msg["text"])
        if not parsed:
            return
        cmd, args = parsed
        if cmd == "score":
            reply = calc.answer(args) if args.strip() else calc.USAGE
        elif cmd in ("help", "start"):
            reply = HELP.format(username=self.username)
        else:
            return

        chat = msg["chat"]
        if chat["type"] == "private":
            self.api("sendMessage", chat_id=chat["id"], text=reply)
        else:
            self.reply_privately_in_group(msg, reply)

    def reply_privately_in_group(self, msg: dict, reply: str) -> None:
        chat_id, user = msg["chat"]["id"], msg["from"]
        eph_id = msg.get("ephemeral_message_id")
        try:
            self.send_ephemeral(chat_id, user["id"], reply, eph_id)
            return
        except TelegramError as e:
            log.info("Ephemeral reply failed: %s", e)
        finally:
            if not eph_id:
                # A normal (visible) command may contain someone's marks; remove it
                # if we are allowed to. Needs "delete messages" admin right.
                self.try_call("deleteMessage", chat_id=chat_id, message_id=msg["message_id"])

        # Fallback 1: direct message (works once the user has pressed Start in DM).
        if self.try_call("sendMessage", chat_id=user["id"], text=reply):
            return
        # Fallback 2: tell them how to get a private answer, without echoing marks.
        name = user.get("first_name", "there")
        self.try_call(
            "sendMessage",
            chat_id=chat_id,
            text=(
                f"{name}, I couldn't answer you privately here. Either message me at "
                f"@{self.username} (press Start once), or type @{self.username} 72 85 10 "
                "in the message box for a private preview."
            ),
        )

    def send_ephemeral(self, chat_id: int, user_id: int, text: str, eph_id: int | None) -> None:
        params = {
            "chat_id": chat_id,
            "text": text,
            "ephemeral_message_parameters": {"receiver_user_id": user_id},
        }
        if eph_id:
            params["reply_parameters"] = {"ephemeral_message_id": eph_id}
        sent = self.api("sendMessage", **params)
        # Safety net: ephemeral messages come back with message_id 0. If Telegram
        # ignored the parameters and posted a normal message, delete it at once
        # so nobody's grade stays visible in the group.
        if sent.get("message_id"):
            self.try_call("deleteMessage", chat_id=chat_id, message_id=sent["message_id"])
            raise TelegramError("message was not sent as ephemeral")

    def on_inline(self, query: dict) -> None:
        q = query.get("query", "").strip()
        if q:
            try:
                r = calc.compute(*calc.parse_args(q))
                title = f"30% component: {calc.fmt(r.component)}/100 ({calc.fmt(r.component_points)}/30)"
                body = calc.format_result(r)
            except calc.InputError as e:
                title, body = "Can't calculate", str(e)
        else:
            title, body = "Type: midterm final [bonus]", calc.USAGE.replace("/score", f"@{self.username}")
        self.api(
            "answerInlineQuery",
            inline_query_id=query["id"],
            is_personal=True,
            cache_time=0,
            results=[
                {
                    "type": "article",
                    "id": "score",
                    "title": title,
                    "description": "Only you see this preview. Tap to post it to the chat.",
                    "input_message_content": {"message_text": body},
                }
            ],
        )

    def try_call(self, method: str, **params):
        try:
            return self.api(method, **params)
        except TelegramError as e:
            log.info("%s", e)
            return None

    # --- main loop -------------------------------------------------------

    def run(self) -> None:
        self.register_commands()
        log.info("Running as @%s", self.username)
        offset = 0
        while True:
            try:
                updates = self.api("getUpdates", offset=offset, timeout=50)
            except (TelegramError, OSError) as e:
                log.warning("getUpdates failed: %s", e)
                time.sleep(5)
                continue
            for update in updates:
                offset = update["update_id"] + 1
                try:
                    self.handle(update)
                except Exception:
                    log.exception("Failed to handle update %s", update.get("update_id"))


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    token = os.environ.get("BOT_TOKEN")
    if not token:
        raise SystemExit("Set the BOT_TOKEN environment variable (from @BotFather).")
    Bot(Api(token)).run()


if __name__ == "__main__":
    main()
