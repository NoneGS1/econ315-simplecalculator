import unittest

import calc
from bot import Bot, TelegramError


class CalcTests(unittest.TestCase):
    def test_no_bonus(self):
        r = calc.compute(60, 90)
        self.assertAlmostEqual(r.component, 80)
        self.assertAlmostEqual(r.component_points, 24)
        self.assertFalse(r.capped)

    def test_bonus_multiplies(self):
        r = calc.compute(60, 90, 10)  # 80 * 1.1
        self.assertAlmostEqual(r.component, 88)

    def test_capped_at_100(self):
        r = calc.compute(95, 98, 20)
        self.assertEqual(r.component, 100)
        self.assertTrue(r.capped)

    def test_course_total(self):
        r = calc.compute(60, 90, 10)
        self.assertAlmostEqual(r.course_total, 0.3 * 60 + 0.4 * 90 + 0.3 * 88)

    def test_parse(self):
        self.assertEqual(calc.parse_args("72 85"), (72, 85, 0))
        self.assertEqual(calc.parse_args("72,5 85 10%"), (72.5, 85, 10))

    def test_bad_input(self):
        for text in ("", "72", "a b", "1 2 3 4"):
            with self.assertRaises(calc.InputError):
                calc.parse_args(text)
        with self.assertRaises(calc.InputError):
            calc.compute(120, 50)


class FakeApi:
    def __init__(self, fail=()):
        self.calls = []
        self.fail = set(fail)

    def __call__(self, method, **params):
        self.calls.append((method, params))
        if method == "getMe":
            return {"username": "Econ315Bot"}
        if method in self.fail:
            raise TelegramError(method)
        if method == "sendMessage" and "ephemeral_message_parameters" in params:
            return {"message_id": 0}
        return {"message_id": 99}


def group_msg(text, **extra):
    return {
        "message_id": 0 if "ephemeral_message_id" in extra else 5,
        "chat": {"id": -100, "type": "supergroup"},
        "from": {"id": 42, "first_name": "Ann"},
        "text": text,
        **extra,
    }


class BotTests(unittest.TestCase):
    def test_ephemeral_reply_to_ephemeral_command(self):
        api = FakeApi()
        Bot(api).handle({"message": group_msg("/score 60 90 10", ephemeral_message_id=7)})
        method, params = api.calls[-1]
        self.assertEqual(method, "sendMessage")
        self.assertEqual(params["ephemeral_message_parameters"], {"receiver_user_id": 42})
        self.assertEqual(params["reply_parameters"], {"ephemeral_message_id": 7})
        self.assertIn("88", params["text"])

    def test_falls_back_to_dm_without_leaking_marks(self):
        class NoEphemeral(FakeApi):
            def __call__(self, method, **params):
                if "ephemeral_message_parameters" in params:
                    self.calls.append((method, params))
                    raise TelegramError("not allowed")
                return super().__call__(method, **params)

        api = NoEphemeral()
        Bot(api).handle({"message": group_msg("/score 60 90")})
        methods = [(m, p.get("chat_id")) for m, p in api.calls]
        self.assertIn(("deleteMessage", -100), methods)
        self.assertEqual(api.calls[-1][0], "sendMessage")
        self.assertEqual(api.calls[-1][1]["chat_id"], 42)  # DM, not the group

    def test_public_hint_has_no_marks_when_dm_impossible(self):
        class Nothing(FakeApi):
            def __call__(self, method, **params):
                if method == "sendMessage" and params.get("chat_id") != -100:
                    raise TelegramError("blocked")
                if "ephemeral_message_parameters" in params:
                    raise TelegramError("not allowed")
                return super().__call__(method, **params)

        api = Nothing()
        Bot(api).handle({"message": group_msg("/score 60 90")})
        method, params = api.calls[-1]
        self.assertEqual(params["chat_id"], -100)
        self.assertNotIn("80", params["text"])

    def test_non_ephemeral_result_is_deleted(self):
        class Ignores(FakeApi):
            def __call__(self, method, **params):
                if method == "sendMessage" and params.get("chat_id") == -100:
                    self.calls.append((method, params))
                    return {"message_id": 123}  # posted publicly by mistake
                return super().__call__(method, **params)

        api = Ignores()
        Bot(api).handle({"message": group_msg("/score 60 90", ephemeral_message_id=7)})
        self.assertIn(("deleteMessage", {"chat_id": -100, "message_id": 123}), api.calls)

    def test_ignores_commands_for_other_bots(self):
        api = FakeApi()
        Bot(api).handle({"message": group_msg("/score@OtherBot 60 90")})
        self.assertEqual([m for m, _ in api.calls], ["getMe"])

    def test_inline_query(self):
        api = FakeApi()
        Bot(api).handle({"inline_query": {"id": "q1", "query": "60 90 10"}})
        method, params = api.calls[-1]
        self.assertEqual(method, "answerInlineQuery")
        self.assertTrue(params["is_personal"])
        self.assertIn("88", params["results"][0]["title"])


if __name__ == "__main__":
    unittest.main()
