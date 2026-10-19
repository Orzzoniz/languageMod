# Language Mod

Practice English while you code with Claude Code.

Claude Code stays in English, so you practice every day. This mod helps you at your level,
with help in your own language when a word is hard.

## What it does

Every part has its own On/Off switch in `/learn`.

| Part | What you see |
| --- | --- |
| **Translate** | Don't know how to say it? Write in your language, or half and half. Claude gets it in clear English, and you see the English with your words under it. |
| **Simple English** | Claude writes at your level: short, easy sentences for beginners. |
| **Word help** | Hard words come with a translation: **deprecated** (已弃用). |
| **Corrections** | After you send a message, a small tip shows a better way to say it. Claude still does your task. |
| **Collect words** | Save the new words from Claude's replies to your notebook. |

Translate has two ways to work: **Send in English** sends the English at once, and
**Let me check first** shows you the English above the input, so you can send it, edit it, or send your original.
Code, file paths and commands are never translated.

There is also a word notebook and a quiz. Words you don't know yet come back first.

## How it looks

Type `/learn` to open the **English practice** panel. It works in the terminal, the desktop app, the web and the phone app.
In the terminal and the desktop app, the same things also show in a box above the input.

The first time, two clicks:

```
Practice English while you code. Which language do you know best?
[ 简体中文 ] [ 繁體中文 ] [ 日本語 ] [ 한국어 ] [ Español ] ... [ English only ]
```

A message you wrote in your language, as Claude reads it:

```
> Please fix `app.js` so the page works.
  (you wrote: 请修复 `app.js` 让页面能用)
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

[ On  ] Translate        write in your language, Claude reads English
        Then: [ Send in English ] [ Let me check first ]
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

### Claude Code on the web and the phone app

Cloud sessions start fresh each time and can't run `/plugin install`, so the mod is turned on by the
environment's **Setup script**, which runs when each new session starts:

1. Open the cloud environment menu in the session's title bar, then **Edit**.
2. Paste the contents of [`scripts/cloud-setup.sh`](scripts/cloud-setup.sh) into **Setup script** and save.
3. Start a new session and type `/learn`.

The script downloads the mod and names its folder in `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json`.
If the download fails, the session starts as usual without the mod.

To try it from a folder without installing:

```
claude --plugin-dir /path/to/languageMod
```

## Safety and privacy

- If the mod has an error, Claude Code skips it and keeps working normally.
- The mod never changes your files. It adds a few lines to Claude's instructions,
  draws its boxes, and keeps your settings and words in its own store.
- Corrections and Translate send a copy of your message to a small, fast Claude model (Haiku),
  which uses a little of your usage. Turn them off to stop it; `/check` then checks only when you ask.
- If a translation fails, your original message is sent. The mod never holds your message back.
- `/learn off` stops everything at once.

## How it works

The mod uses Claude Code's function hooks:

- `prompt.compose` adds the practice rules to Claude's system prompt, only for the parts that are on.
- `prompt.submit` sends a message written in another language to Claude in English (code kept as it is),
  and starts the English check right after, so your message is never held up by it.
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
