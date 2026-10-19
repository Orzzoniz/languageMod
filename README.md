# Language Mod

Practice English while you code with Claude Code.

Claude Code stays in English, so you practice every day. This mod helps you at your level,
with help in your own language when a word is hard.

## What it does

Every part has its own On/Off switch in `/learn`.

| Part | What you see |
| --- | --- |
| **Simple English** | Claude writes at your level: short, easy sentences for beginners. |
| **Word help** | Hard words come with a translation: **deprecated** (已弃用). |
| **Corrections** | After you send a message, a small tip shows a better way to say it. Claude still does your task. |
| **Collect words** | Save the new words from Claude's replies to your notebook. |

There is also a word notebook and a quiz. Words you don't know yet come back first.

## How it looks

The first time, two clicks above the input box:

```
Practice English while you code. Which language do you know best?
[ 简体中文 ] [ 繁體中文 ] [ 日本語 ] [ 한국어 ] [ Español ] ... [ English only ]
```

A correction tip:

```
English tip · you wrote: “could u think the result will effect now page?”
Better: Do you think the result will affect this page?
Why: Use "affect" for the verb.
New words: affect = 影响
[ Got it ]  [ In 简体中文 ]  [ Save word ]
```

The settings panel (`/learn`):

```
Practice mode is on                              [ Turn off ]
Help language: 简体中文  Change
Level: [ Beginner ] [ Middle ] [ Advanced ]

[ On  ] Simple English   Claude writes at your level
[ On  ] Word help        hard words come with a translation
[ On  ] Corrections      a tip when your message has a mistake
        Show: [ Big mistakes ] [ Every mistake ]
[ Off ] Collect words    save the words Word help explains
```

## Commands

| Command | What it does |
| --- | --- |
| `/learn` | Open the settings. `/learn off` turns everything off, `/learn on` turns it back on. |
| `/words` | Open your word notebook. |
| `/quiz` | Practice your saved words. |
| `/explain` | Explain Claude's last reply in your language. `/explain <text>` explains that text. |
| `/check` | Check the English of your last message. It works when Corrections is off too. |

## Help languages

简体中文, 繁體中文, 日本語, 한국어, Español, Português, Français, Deutsch, Русский, Українська,
Tiếng Việt, Bahasa Indonesia, Türkçe, हिन्दी, العربية, ไทย, Italiano, Polski, or English only.

To add a language, add one line to `hooks/languages.ts`.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install languagemod --marketplace Orzzoniz/languageMod
```

Answer `y` to add the marketplace, then choose a scope.

From a shell:

```
claude plugin install languagemod --marketplace Orzzoniz/languageMod
```

To try it from a folder without installing:

```
claude --plugin-dir /path/to/languageMod
```

## Safety and privacy

- If the mod has an error, Claude Code skips it and keeps working normally.
- The mod never changes your files. It adds a few lines to Claude's instructions,
  draws its boxes, and keeps your settings and words in its own store.
- Corrections send a copy of each message you type to a small, fast Claude model (Haiku),
  which uses a little of your usage. Turn Corrections off to stop it; `/check` then checks only when you ask.
- `/learn off` stops everything at once.

## How it works

The mod uses Claude Code's function hooks:

- `prompt.compose` adds the practice rules to Claude's system prompt, only for the parts that are on.
- `prompt.submit` notes your message; the check runs right after, so your message is never held up.
- `turn.complete` finds the words Claude explained, written as **word** (meaning).
- `ui.render` draws the setup and tip box above the input, the settings panel and the word notebook.

## Develop

```
claude plugin validate .
claude plugin test .
```

## Plans

- **Native mode**: Claude Code's own interface (spinner words, hints, command descriptions) in your language,
  for people who don't want to practice English.
- More help languages, and a review schedule for saved words.

## License

MIT
