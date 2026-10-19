import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register } from 'claude-code'

import type {
  Feature,
  Level,
  NewWord,
  Practice,
  Quiz,
  Strictness,
  Tip,
  TranslateMode,
  Translation,
  Word,
} from '../types'
import {
  addWords,
  clip,
  COACH_MODEL,
  coachSystem,
  DEFAULT_SETTINGS,
  FEATURES,
  harvestWords,
  isActive,
  isWorthChecking,
  learnSection,
  looksForeign,
  maskCode,
  parseCoach,
  parseSettings,
  parseTranslation,
  parseWords,
  proseOf,
  quizOrder,
  restoreCode,
  sameText,
  translateSystem,
} from './coach'
import { ENGLISH, findLanguage, LANGUAGES, languageOf } from './languages'

const settings = atom({ plugin: 'languagemod', key: 'settings' } as const, null)
const setup = atom({ plugin: 'languagemod', key: 'setup' } as const, null)
const tip = atom({ plugin: 'languagemod', key: 'tip' } as const, null)
const showNative = atom({ plugin: 'languagemod', key: 'showNative' } as const, false)
const newWords = atom({ plugin: 'languagemod', key: 'newWords' } as const, [])
const words = atom({ plugin: 'languagemod', key: 'words' } as const, [])
const quiz = atom({ plugin: 'languagemod', key: 'quiz' } as const, null)
const lastPrompt = atom({ plugin: 'languagemod', key: 'lastPrompt' } as const, '')
const streak = atom({ plugin: 'languagemod', key: 'streak' } as const, 0)
const translations = atom({ plugin: 'languagemod', key: 'translations' } as const, [])
const pending = atom({ plugin: 'languagemod', key: 'pending' } as const, null)

const SETTINGS_PANE = 'languagemod-settings'
const WORDS_PANE = 'languagemod-words'

// Prompts the person typed or sent, as opposed to ones a task, a peer or a plugin queued.
const PERSON = new Set(['composer', 'bridge', 'sdk', 'unclassified'])

const LEVELS: readonly { level: Level; label: string; hint: string }[] = [
  { level: 'beginner', label: 'Beginner', hint: 'short, easy sentences' },
  { level: 'middle', label: 'Middle', hint: 'plain sentences' },
  { level: 'advanced', label: 'Advanced', hint: 'normal technical English' },
]

const STRICTNESS: readonly { strictness: Strictness; label: string }[] = [
  { strictness: 'big', label: 'Big mistakes' },
  { strictness: 'all', label: 'Every mistake' },
]

const TRANSLATE_MODES: readonly { mode: TranslateMode; label: string }[] = [
  { mode: 'send', label: 'Send in English' },
  { mode: 'review', label: 'Let me check first' },
]

const FEATURE_TEXT: Record<Feature, { name: string; hint: string }> = {
  translate: { name: 'Translate', hint: 'write in your language, Claude reads English' },
  simple: { name: 'Simple English', hint: 'Claude writes at your level' },
  glossary: { name: 'Word help', hint: 'hard words come with a translation' },
  coach: { name: 'Corrections', hint: 'a tip when your message has a mistake' },
  collect: { name: 'Collect words', hint: 'save the words Word help explains' },
}

type Ui = Pick<Elements['mobile'], 'Box' | 'Text' | 'Button'>
type CheckResult = 'tip' | 'ok' | 'skipped' | 'failed'

// Only the newest check may show its tip, so a slow answer never replaces a newer one.
let checkCount = 0

/** Whether a surface that draws the band above the input (terminal, desktop) is attached. */
async function hasBand($: EngineInterface): Promise<boolean> {
  try {
    return (await $.session.surfaces()).some(surface => surface === 'terminal' || surface === 'desktop')
  } catch {
    return true
  }
}

function openPractice($: EngineInterface) {
  return $.ui.open({ id: SETTINGS_PANE, title: 'English practice' })
}

async function changeSettings($: EngineInterface, change: (s: Practice) => Practice): Promise<Practice> {
  await update($, settings, s => change(s ?? DEFAULT_SETTINGS))
  const saved = (await read($, settings)) ?? DEFAULT_SETTINGS
  await $.store.set('settings', saved)
  return saved
}

async function saveWords($: EngineInterface, add: readonly NewWord[]): Promise<number> {
  const before = new Set((await read($, words)).map(word => word.word.toLowerCase()))
  const now = await $.clock.now()
  await update($, words, list => addWords(list, add, now))
  await $.store.set('words', await read($, words))
  return new Set(add.map(word => word.word.toLowerCase()).filter(key => !before.has(key))).size
}

async function runCheck($: EngineInterface, text: string, isAsked: boolean): Promise<CheckResult> {
  const s = await read($, settings)
  const prose = proseOf(text)
  if (s === null || prose === '' || (!isAsked && !isWorthChecking(prose))) return 'skipped'

  const count = ++checkCount
  $.ui.status('English: checking…')
  try {
    const reply = await $.model.complete({
      model: COACH_MODEL,
      system: coachSystem(s),
      prompt: prose,
      maxTokens: 700,
      timeoutMs: 45_000,
    })
    const verdict = reply.isAnswered ? parseCoach(reply.text) : null
    if (count !== checkCount) return 'skipped'
    if (verdict === null) {
      $.ui.status(undefined)
      return 'failed'
    }
    if (verdict.ok || sameText(verdict.better, prose)) {
      await update($, streak, n => n + 1)
      $.ui.status(`English ✓ ${await read($, streak)} in a row`)
      return 'ok'
    }
    const next: Tip = {
      original: prose,
      better: verdict.better,
      why: verdict.why,
      whyNative: verdict.whyNative,
      words: verdict.words,
    }
    await update($, streak, () => 0)
    await update($, showNative, () => false)
    await update($, tip, () => next)
    if (await hasBand($)) {
      $.ui.status('English: a tip is waiting above the input')
    } else {
      $.ui.status('English: a tip is waiting in /learn')
      $.ui.toast(`English tip. Better: ${clip(next.better, 300)}`, { timeoutMs: 12_000 })
    }
    return 'tip'
  } catch {
    if (count === checkCount) $.ui.status(undefined)
    return 'failed'
  }
}

/** The message in English, or null when it already is English or the translation failed: then the original goes. */
async function translate(
  $: EngineInterface,
  text: string,
  s: Practice,
  signal?: AbortSignal,
): Promise<Translation | null> {
  const { masked, blocks } = maskCode(text)
  if (masked.length > 6000) return null
  $.ui.status('Translating to English…')
  try {
    const reply = await $.model.complete(
      { model: COACH_MODEL, system: translateSystem(s), prompt: masked, maxTokens: 4000, timeoutMs: 30_000 },
      { signal },
    )
    const parsed = reply.isAnswered ? parseTranslation(reply.text) : null
    if (parsed === null || parsed === 'same') return null
    const english = restoreCode(parsed.english, blocks)
    return english === null ? null : { original: text, english, language: parsed.language, words: parsed.words }
  } catch {
    return null
  } finally {
    $.ui.status(undefined)
  }
}

async function rememberTranslation($: EngineInterface, translation: Translation): Promise<void> {
  await update($, translations, list => [...list, translation].slice(-30))
  if (isActive(await read($, settings), 'collect') && translation.words.length > 0) {
    const have = new Set((await read($, words)).map(word => word.word.toLowerCase()))
    await update($, newWords, () => translation.words.filter(word => !have.has(word.word.toLowerCase())))
  }
}

async function pickNative($: EngineInterface, code: string): Promise<void> {
  const isFirstTime = (await read($, settings)) === null
  await changeSettings($, s => ({ ...s, native: code }))
  await update($, setup, () => (isFirstTime ? 'level' : null))
}

async function pickLevel($: EngineInterface, level: Level): Promise<void> {
  const isFirstTime = (await read($, setup)) !== null
  await changeSettings($, s => ({ ...s, level }))
  await update($, setup, () => null)
  if (isFirstTime) {
    $.ui.toast('Practice mode is on. Type /learn to switch each part on or off.', { timeoutMs: 8000 })
  }
}

async function notNow($: EngineInterface): Promise<void> {
  await update($, setup, () => null)
  await $.store.set('dismissed', true)
  $.ui.toast('OK. Type /learn any time to start practicing.')
}

async function answerQuiz($: EngineInterface, word: string, knew: boolean): Promise<void> {
  await update($, words, list =>
    list.map(one => (one.word === word ? { ...one, known: knew ? one.known + 1 : 0 } : one)),
  )
  await $.store.set('words', await read($, words))
  await update($, quiz, q =>
    q === null ? null : { ...q, index: q.index + 1, isRevealed: false, right: q.right + (knew ? 1 : 0) },
  )
}

function newQuiz(list: readonly Word[]): Quiz {
  return { order: quizOrder(list), index: 0, isRevealed: false, right: 0 }
}

function setupBand(ui: Ui, $: EngineInterface, step: 'native' | 'level') {
  const { Box, Text, Button } = ui
  if (step === 'native') {
    return (
      <Box flexDirection="column">
        <Text bold>Practice English while you code. Which language do you know best?</Text>
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          {LANGUAGES.map(lang => (
            <Button key={`lang:${lang.code}`} label={lang.native} onPress={() => pickNative($, lang.code)} />
          ))}
          <Button key="lang:en" label={ENGLISH.native} onPress={() => pickNative($, ENGLISH.code)} />
        </Box>
        <Box flexDirection="row">
          <Button key="setup:later" label="Not now" plain dimColor onPress={() => notNow($)} />
        </Box>
      </Box>
    )
  }
  return (
    <Box flexDirection="column">
      <Text bold>What is your English level?</Text>
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        {LEVELS.map(one => (
          <Button key={`level:${one.level}`} label={`${one.label}: ${one.hint}`} onPress={() => pickLevel($, one.level)} />
        ))}
      </Box>
    </Box>
  )
}

function tipBand(ui: Ui, $: EngineInterface, t: Tip, s: Practice, isNative: boolean) {
  const { Box, Text, Button } = ui
  const lang = languageOf(s.native)
  const canTranslate = lang.code !== ENGLISH.code && t.whyNative !== ''
  return (
    <Box flexDirection="column">
      <Text>
        <Text bold color="suggestion">English tip</Text>
        <Text dimColor> · you wrote: “{clip(t.original, 80)}”</Text>
      </Text>
      <Text>
        Better: <Text bold>{t.better}</Text>
      </Text>
      {t.why !== '' && <Text dimColor>Why: {t.why}</Text>}
      {isNative && canTranslate && <Text dimColor>{t.whyNative}</Text>}
      {t.words.length > 0 && (
        <Text dimColor>New words: {t.words.map(word => `${word.word} = ${word.meaning}`).join(' · ')}</Text>
      )}
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        <Button key="tip:ok" label="Got it" variant="primary" onPress={() => update($, tip, () => null)} />
        {canTranslate && (
          <Button
            key="tip:native"
            label={isNative ? 'Hide' : `In ${lang.native}`}
            onPress={() => update($, showNative, shown => !shown)}
          />
        )}
        {t.words.length > 0 && (
          <Button
            key="tip:save"
            label={t.words.length === 1 ? 'Save word' : 'Save words'}
            onPress={async () => {
              const saved = await saveWords($, t.words)
              await update($, tip, current => (current === null ? null : { ...current, words: [] }))
              $.ui.toast(saved === 0 ? 'You already have these words.' : `Saved. Type /words to see your words.`)
            }}
          />
        )}
      </Box>
    </Box>
  )
}

function pendingBand(ui: Ui, $: EngineInterface, p: Translation) {
  const { Box, Text, Button } = ui
  const from = p.language === '' ? '' : ` (from ${p.language})`
  return (
    <Box flexDirection="column">
      <Text>
        <Text bold color="suggestion">Your message in English</Text>
        <Text dimColor>{from}</Text>
      </Text>
      <Text>{p.english}</Text>
      {p.words.length > 0 && (
        <Text dimColor>New words: {p.words.map(word => `${word.word} = ${word.meaning}`).join(' · ')}</Text>
      )}
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        <Button
          key="pending:send"
          label="Send"
          variant="primary"
          onPress={async () => {
            await update($, pending, () => null)
            await rememberTranslation($, p)
            await $.prompt.submit({ text: p.english, asUser: true })
          }}
        />
        <Button
          key="pending:edit"
          label="Edit"
          onPress={async () => {
            const { isFilled } = await $.prompt.fill({ text: p.english })
            if (isFilled) await update($, pending, () => null)
            else $.ui.toast('Editing is not available here. Press Send, or Cancel and type it again.')
          }}
        />
        <Button
          key="pending:original"
          label="Send my original"
          onPress={async () => {
            await update($, pending, () => null)
            await $.prompt.submit({ text: p.original, asUser: true })
          }}
        />
        <Button key="pending:cancel" label="Cancel" plain dimColor onPress={() => update($, pending, () => null)} />
      </Box>
    </Box>
  )
}

function wordsBand(ui: Ui, $: EngineInterface, fresh: readonly NewWord[]) {
  const { Box, Text, Button } = ui
  return (
    <Box flexDirection="column">
      <Text>
        <Text bold color="suggestion">New words: </Text>
        {fresh.map(word => `${word.word} = ${word.meaning}`).join(' · ')}
      </Text>
      <Box flexDirection="row" columnGap={1}>
        <Button
          key="new:save"
          label="Save to my words"
          variant="primary"
          onPress={async () => {
            const saved = await saveWords($, fresh)
            await update($, newWords, () => [])
            $.ui.toast(saved === 0 ? 'You already have these words.' : `Saved ${saved}. Type /quiz to practice.`)
          }}
        />
        <Button key="new:skip" label="Skip" onPress={() => update($, newWords, () => [])} />
      </Box>
    </Box>
  )
}

/** What waits for the person now: the setup, a translation to check, a tip, or new words; null for nothing. */
async function nowView(ui: Ui, $: EngineInterface) {
  const step = await read($, setup)
  if (step !== null) return setupBand(ui, $, step)
  const s = await read($, settings)
  if (s === null || !s.isOn) return null
  const p = await read($, pending)
  if (p !== null) return pendingBand(ui, $, p)
  const t = await read($, tip)
  // A tip comes from Corrections or from /check, which works with Corrections off.
  if (t !== null) return tipBand(ui, $, t, s, await read($, showNative))
  const fresh = await read($, newWords)
  if (fresh.length > 0 && isActive(s, 'collect')) return wordsBand(ui, $, fresh)
  return null
}

function settingsView(ui: Ui, $: EngineInterface, s: Practice | null, wordCount: number) {
  const { Box, Text, Button } = ui
  if (s === null) {
    return (
      <Box flexDirection="column">
        <Text>Practice mode is not set up yet.</Text>
        <Box flexDirection="row">
          <Button key="set:start" label="Start setup" variant="primary" onPress={() => update($, setup, () => 'native')} />
        </Box>
      </Box>
    )
  }
  const lang = languageOf(s.native)
  return (
    <Box flexDirection="column" rowGap={1}>
      <Box flexDirection="row" columnGap={1} flexWrap="wrap">
        <Text bold>{s.isOn ? 'Practice mode is on' : 'Practice mode is off'}</Text>
        <Button
          key="set:master"
          label={s.isOn ? 'Turn off' : 'Turn on'}
          variant={s.isOn ? 'secondary' : 'primary'}
          onPress={() => changeSettings($, current => ({ ...current, isOn: !current.isOn }))}
        />
      </Box>
      <Box flexDirection="column">
        <Box flexDirection="row" columnGap={1} flexWrap="wrap">
          <Text>Help language: {lang.native}</Text>
          <Button key="set:language" label="Change" plain onPress={() => update($, setup, () => 'native')} />
        </Box>
        <Box flexDirection="row" columnGap={1} flexWrap="wrap">
          <Text>Level:</Text>
          {LEVELS.map(one => (
            <Button
              key={`set:level:${one.level}`}
              label={one.label}
              variant={s.level === one.level ? 'primary' : 'secondary'}
              onPress={() => changeSettings($, current => ({ ...current, level: one.level }))}
            />
          ))}
        </Box>
      </Box>
      <Box flexDirection="column">
        {FEATURES.map(feature => (
          <Box key={`row:${feature}`} flexDirection="row" columnGap={1} flexWrap="wrap">
            <Button
              key={`set:feature:${feature}`}
              label={s.features[feature] ? 'On ' : 'Off'}
              variant={s.features[feature] ? 'primary' : 'secondary'}
              onPress={() =>
                changeSettings($, current => ({
                  ...current,
                  features: { ...current.features, [feature]: !current.features[feature] },
                }))
              }
            />
            <Text bold={s.features[feature]} dimColor={!s.isOn || !s.features[feature]}>
              {FEATURE_TEXT[feature].name}
            </Text>
            <Text dimColor>{FEATURE_TEXT[feature].hint}</Text>
          </Box>
        ))}
        {s.features.translate && (
          <Box flexDirection="row" columnGap={1} flexWrap="wrap" marginLeft={6}>
            <Text dimColor>Then:</Text>
            {TRANSLATE_MODES.map(one => (
              <Button
                key={`set:translate:${one.mode}`}
                label={one.label}
                variant={s.translateMode === one.mode ? 'primary' : 'secondary'}
                onPress={() => changeSettings($, current => ({ ...current, translateMode: one.mode }))}
              />
            ))}
          </Box>
        )}
        {s.features.coach && (
          <Box flexDirection="row" columnGap={1} flexWrap="wrap" marginLeft={6}>
            <Text dimColor>Show:</Text>
            {STRICTNESS.map(one => (
              <Button
                key={`set:strict:${one.strictness}`}
                label={one.label}
                variant={s.strictness === one.strictness ? 'primary' : 'secondary'}
                onPress={() => changeSettings($, current => ({ ...current, strictness: one.strictness }))}
              />
            ))}
          </Box>
        )}
      </Box>
      <Box flexDirection="row" columnGap={1} flexWrap="wrap">
        <Button
          key="set:words"
          label={`My words (${wordCount})`}
          onPress={async () => {
            await update($, quiz, () => null)
            await $.ui.open({ id: WORDS_PANE, title: 'My words' })
          }}
        />
      </Box>
    </Box>
  )
}

function notebookView(ui: Ui, $: EngineInterface, list: readonly Word[], room: number) {
  const { Box, Text, Button } = ui
  if (list.length === 0) {
    return (
      <Text dimColor>
        No words yet. Save words from an English tip or from Claude’s replies, and they will show here.
      </Text>
    )
  }
  const shown = [...list].reverse().slice(0, room)
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" columnGap={1} flexWrap="wrap">
        <Text bold>{list.length === 1 ? '1 word' : `${list.length} words`}</Text>
        <Button key="words:quiz" label="Start quiz" variant="primary" onPress={() => update($, quiz, () => newQuiz(list))} />
      </Box>
      {shown.map(word => (
        <Box key={`word:${word.word}`} flexDirection="row" columnGap={1}>
          <Text bold>{word.word}</Text>
          <Text>= {word.meaning}</Text>
          {word.known > 0 && <Text dimColor>✓{word.known}</Text>}
          <Button
            key={`words:remove:${word.word}`}
            label="Remove"
            plain
            dimColor
            onPress={async () => {
              await update($, words, all => all.filter(one => one.word !== word.word))
              await $.store.set('words', await read($, words))
            }}
          />
        </Box>
      ))}
      {list.length > shown.length && <Text dimColor>and {list.length - shown.length} more</Text>}
    </Box>
  )
}

function quizView(ui: Ui, $: EngineInterface, list: readonly Word[], q: NonNullable<Quiz>) {
  const { Box, Text, Button } = ui
  const stop = <Button key="quiz:stop" label="Back to my words" plain onPress={() => update($, quiz, () => null)} />
  const remaining = q.order.slice(q.index).filter(name => list.some(word => word.word === name))
  const current = list.find(word => word.word === remaining[0])
  if (current === undefined) {
    return (
      <Box flexDirection="column" rowGap={1}>
        <Text bold>
          Done! You knew {q.right} of {q.order.length}.
        </Text>
        <Box flexDirection="row" columnGap={1}>
          <Button key="quiz:again" label="Again" variant="primary" onPress={() => update($, quiz, () => newQuiz(list))} />
          {stop}
        </Box>
      </Box>
    )
  }
  return (
    <Box flexDirection="column" rowGap={1}>
      <Text dimColor>
        Word {q.order.length - remaining.length + 1} of {q.order.length} · right so far: {q.right}
      </Text>
      <Text bold size="heading">
        {current.word}
      </Text>
      {q.isRevealed ? (
        <Box flexDirection="column" rowGap={1}>
          <Text>= {current.meaning}</Text>
          <Box flexDirection="row" columnGap={1}>
            <Button key="quiz:knew" label="I knew it" variant="primary" onPress={() => answerQuiz($, current.word, true)} />
            <Button key="quiz:again-later" label="Not yet" onPress={() => answerQuiz($, current.word, false)} />
          </Box>
        </Box>
      ) : (
        <Box flexDirection="row">
          <Button
            key="quiz:show"
            label="Show meaning"
            variant="primary"
            onPress={() => update($, quiz, now => (now === null ? null : { ...now, isRevealed: true }))}
          />
        </Box>
      )}
      {stop}
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const saved = parseSettings(await $.store.get('settings'))
    const notebook = parseWords(await $.store.get('words'))
    const isDismissed = (await $.store.get('dismissed')) === true
    await update($, settings, () => saved)
    await update($, words, () => notebook)
    await update($, setup, current => (saved === null && !isDismissed ? (current ?? 'native') : current))

    await $.command.register({
      name: 'learn',
      description: 'English practice: settings, and switch each part on or off',
      argumentHint: '[on|off|language|level]',
    })
    await $.command.register({ name: 'words', description: 'English practice: open your word notebook' })
    await $.command.register({ name: 'quiz', description: 'English practice: quiz yourself on your saved words' })
    await $.command.register({
      name: 'explain',
      description: 'English practice: explain Claude’s last reply in your language',
      argumentHint: '[text]',
    })
    await $.command.register({ name: 'check', description: 'English practice: check the English of your last message' })
    if (saved === null && !isDismissed && !(await hasBand($))) {
      $.ui.toast('English practice is ready. Type /learn to start.', { timeoutMs: 12_000 })
    }
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const s = await read($, settings)
    const text = s === null ? null : learnSection(s)
    if (text === null) return composed
    return { sections: [...composed.sections, { id: 'languagemod:learn', text, scope: 'session' as const }] }
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.command !== undefined || e.isMeta === true || !PERSON.has(e.origin.kind)) return next(e)
    const text = e.text
    await update($, lastPrompt, () => text)
    await update($, tip, () => null)

    const s = await read($, settings)
    if (isActive(s, 'translate') && looksForeign(proseOf(text), s.native)) {
      const translation = await translate($, text, s, next.signal)
      if (translation !== null && s.translateMode === 'review') {
        await update($, pending, () => translation)
        if (await hasBand($)) return { drop: 'Check the English version above the input box.' }
        await openPractice($)
        return { drop: 'Check the English version in the English practice panel.' }
      }
      if (translation !== null) {
        await rememberTranslation($, translation)
        return next({ ...e, text: translation.english })
      }
    }
    if (isActive(s, 'coach')) {
      $.clock.after(0, () => void runCheck($, text, false))
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const s = await read($, settings)
    if (e.agentId === undefined && e.reason === 'answer' && isActive(s, 'collect') && isActive(s, 'glossary')) {
      const have = new Set((await read($, words)).map(word => word.word.toLowerCase()))
      const found = harvestWords(e.answer).filter(word => !have.has(word.word.toLowerCase()))
      await update($, newWords, () => found)
    }
    return next(e)
  })

  // Drawn on the terminal and desktop only; the English practice panel shows the same on every surface.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    return (await nowView($.ui.resolve(e), $)) ?? next(e)
  })

  // A translated message shows the English that Claude read, with what the person wrote under it.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.props.isExpanded) return next(e)
    const shown = e.props.text.trim()
    const found = (await read($, translations)).find(one => one.english.trim() === shown)
    if (found === undefined) return next(e)
    return next({ ...e, props: { ...e.props, text: `${e.props.text}\n(you wrote: ${found.original})` } })
  })

  on('ui.render', { component: 'Pane', requestId: SETTINGS_PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const step = await read($, setup)
    if (step !== null) return setupBand(ui, $, step)
    const now = await nowView(ui, $)
    const view = settingsView(ui, $, await read($, settings), (await read($, words)).length)
    if (now === null) return view
    const { Box } = ui
    return (
      <Box flexDirection="column" rowGap={1}>
        {now}
        {view}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: WORDS_PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const list = await read($, words)
    const q = await read($, quiz)
    if (q !== null) return quizView(ui, $, list, q)
    return notebookView(ui, $, list, Math.max(3, (e.viewport?.rows ?? 24) - 6))
  })

  on('command.run', { command: 'learn' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if ((arg === 'on' || arg === 'off') && (await read($, settings)) !== null) {
      await changeSettings($, s => ({ ...s, isOn: arg === 'on' }))
      return { text: arg === 'on' ? 'Practice mode is on.' : 'Practice mode is off. Type /learn on to start again.' }
    }
    // Typing the choice works where the panel's buttons cannot be pressed.
    const lang = findLanguage(arg)
    if (lang !== undefined) {
      const isFirstTime = (await read($, settings)) === null
      const saved = await changeSettings($, s => ({ ...s, native: lang.code }))
      await update($, setup, () => null)
      if (!isFirstTime) return { text: `Help language: ${lang.native}.` }
      const level = LEVELS.find(one => one.level === saved.level)?.label ?? saved.level
      return {
        text: `Practice mode is on. Help language: ${lang.native}. Level: ${level}. To change the level, type /learn middle or /learn advanced.`,
      }
    }
    const level = LEVELS.find(one => one.level === arg)
    if (level !== undefined) {
      if ((await read($, settings)) === null) return { text: 'Choose your language first, like /learn japanese.' }
      await changeSettings($, s => ({ ...s, level: level.level }))
      await update($, setup, step => (step === 'level' ? null : step))
      return { text: `Level: ${level.label} (${level.hint}).` }
    }
    if (arg !== '' && arg !== 'on' && arg !== 'off') {
      return {
        text: `I don’t know “${e.args.trim()}”. Type a language, like /learn japanese, or a level, like /learn beginner.`,
      }
    }
    const isNew = (await read($, settings)) === null
    if (isNew) await update($, setup, current => current ?? 'native')
    await openPractice($)
    return {
      text: isNew
        ? 'Choose your language in the English practice panel, or type it, like /learn japanese.'
        : 'Opened English practice.',
    }
  })

  on('command.run', { command: 'words' }, async $ => {
    await update($, quiz, () => null)
    await $.ui.open({ id: WORDS_PANE, title: 'My words' })
    const count = (await read($, words)).length
    return { text: `Opened your word notebook (${count === 1 ? '1 word' : `${count} words`}).` }
  })

  on('command.run', { command: 'quiz' }, async $ => {
    const list = await read($, words)
    if (list.length === 0) return { text: 'You have no saved words yet. Save words from an English tip first.' }
    await update($, quiz, () => newQuiz(list))
    await $.ui.open({ id: WORDS_PANE, title: 'My words' })
    return { text: 'Quiz started in the “My words” panel.' }
  })

  on('command.run', { command: 'explain' }, async ($, e) => {
    const lang = languageOf((await read($, settings))?.native ?? ENGLISH.code)
    const language = lang.code === ENGLISH.code ? 'very simple English' : lang.english
    const target = e.args.trim()
    const prompt =
      target === ''
        ? `Explain your last reply again in ${language}, for someone learning English. Use simple words and keep it short. Keep code, commands, and file names unchanged.`
        : `Explain this in ${language}, for someone learning English. Keep it short: ${target}`
    const reply = await $.model.fork({ prompt })
    if (reply.isAnswered) return { text: reply.text }
    return {
      text: reply.reason === 'nothing-to-fork' ? 'There is no reply to explain yet.' : 'The explanation did not work this time. Try again.',
    }
  })

  on('command.run', { command: 'check' }, async $ => {
    const text = await read($, lastPrompt)
    if (text === '') return { text: 'Send a message first, then type /check.' }
    if ((await read($, settings)) === null) return { text: 'Type /learn first to choose your language and level.' }
    const result = await runCheck($, text, true)
    const answers: Record<CheckResult, string> = {
      tip: 'I found something to improve. See the English tip above the input.',
      ok: 'Your last message has no big mistakes. Nice!',
      skipped: 'Your last message was too short to check.',
      failed: 'The check did not work this time. Try again later.',
    }
    return { text: answers[result] }
  })
}
