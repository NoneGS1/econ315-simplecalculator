# Changelog

All notable changes to the Economics & Data Science, Class of 2028 helper bot.
Newest first. Each entry links to its pull request.

## 2026-11-25

### Added
- **`/pin_app`** (admins): posts an "Open app" button in the current topic and pins it. This is the quickest way into the app from the group, because Telegram only offers bots a menu button in private chats ([#11](https://github.com/NoneGS1/econ315-simplecalculator/pull/11)).
- **Professors' official links** for each course ([#9](https://github.com/NoneGS1/econ315-simplecalculator/pull/9)):
  - Game Theory: the professor's course page, plus the bonus-points sheets for the 13:30–15:30 and 15:30–17:30 tutorials.
  - Programming 2, Circular Economy and Econometrics: the professor's Telegram channel.
  - Principles of Management: the class participation sheet. Its Drive is the professor's own.
- **Course materials** ([#8](https://github.com/NoneGS1/econ315-simplecalculator/pull/8)): every course tab in the app has a Materials card with the class Drive folder and the syllabus post. New `/materials` command gives the same links as buttons.
- **All five Fall 2026 courses in the calculator app** ([#7](https://github.com/NoneGS1/econ315-simplecalculator/pull/7)), using the grading weights from each syllabus:
  - Each course tab has score inputs and an expected-final slider, and shows your grade, the points you have before the final, and the final score needed for every letter grade.
  - The Overview tab shows each course's predicted grade, the final needed for an A and an A+, and a credit-weighted GPA.
  - A switch sets whether ungraded items count as 100 or 0.
  - Everything is calculated and saved only on your own device.

### Changed
- `/calc` is now **`/app`**, since the app also has course materials. `/calc` still works. The menu button in private chats is now called **App** ([#11](https://github.com/NoneGS1/econ315-simplecalculator/pull/11)).

### Removed
- Tracking parameters (`authuser`, `ouid`) from the shared links ([#9](https://github.com/NoneGS1/econ315-simplecalculator/pull/9)).

## 2026-11-24

### Added
- **Deadline reminders** ([#6](https://github.com/NoneGS1/econ315-simplecalculator/pull/6)):
  - Admins add a deadline with `/deadline 05.12 23:59 Title` in a topic.
  - The bot announces it in that topic, then reminds the topic 3 days, 1 day and 3 hours before. Times are Tashkent time.
  - `/deadlines` lists upcoming deadlines privately. `/deadline_delete` removes one.
- **Calculator mini app** (`/calc`) with sliders, the letter grade and a final-needed table ([#6](https://github.com/NoneGS1/econ315-simplecalculator/pull/6)).
- **Letter grades** from the university scale: A+ 93, A 85, B+ 75, B 65, C+ 60, C 50, D 40 ([#3](https://github.com/NoneGS1/econ315-simplecalculator/pull/3)):
  - `/need A 70 20` gives the final needed for one grade.
  - `/need 70 20` gives a table for every grade.
  - `/score` now shows the letter grade.
- **`/need`** and nicer formatted replies, with the working in a collapsible block ([#2](https://github.com/NoneGS1/econ315-simplecalculator/pull/2)).
- **First version** on Cloudflare Workers ([#1](https://github.com/NoneGS1/econ315-simplecalculator/pull/1)):
  - `/score` calculates the Game Theory 30% component.
  - In the group, answers are private to the person who asked (ephemeral messages).
  - Inline mode: type `@bot 72 85 10` in any chat.

### Changed
- `/start` is a short introduction, and `/help` lists the commands ([#3](https://github.com/NoneGS1/econ315-simplecalculator/pull/3)).
- Examples use made-up scores ([#4](https://github.com/NoneGS1/econ315-simplecalculator/pull/4)).

### Fixed
- In groups with topics, replies now appear in the topic where the command was typed, not in General ([#5](https://github.com/NoneGS1/econ315-simplecalculator/pull/5)).
- The bot's web address stays switched on after every deploy ([#2](https://github.com/NoneGS1/econ315-simplecalculator/pull/2)).
