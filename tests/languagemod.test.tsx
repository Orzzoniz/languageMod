import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import {
  DEFAULT_SETTINGS,
  harvestWords,
  isWorthChecking,
  learnSection,
  parseCoach,
  proseOf,
} from '../hooks/coach'

const SAVED = { ...DEFAULT_SETTINGS, native: 'zh-CN' }
const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const COMPOSE = { model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] }
const SCROLL = { offset: 0, bodyRows: 20 }
const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: SCROLL, view: {} },
} as const
const SETTINGS_PANE = {
  component: 'Pane',
  requestId: 'languagemod-settings',
  props: {
    title: 'English practice',
    isFocused: true,
    bodyColumns: 100,
    placement: 'dock',
    scroll: SCROLL,
    view: {},
  },
} as const

const CORRECTION = JSON.stringify({
  ok: false,
  better: 'Do you think the result will affect this page?',
  why: 'Use "affect" for the verb.',
  whyNative: '动词要用 affect。',
  words: [{ word: 'affect', meaning: '影响' }],
})

/** Stands for Claude Code beneath the mod, with the coach answering `coachReply`. */
function engine(on: On, coachReply = '{"ok": true}', onCheck = () => {}) {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'You are Claude Code.', scope: 'shared' as const }] }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('model.complete', () => {
    onCheck()
    return { value: { isAnswered: true as const, text: coachReply, usage: USAGE } }
  })
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
}

const START = { cwd: '/work', surface: 'terminal', isInteractive: true } as const

test('the coach reply is read, and junk is ignored', () => {
  const verdict = parseCoach(`Here you go:\n${CORRECTION}`)
  expect(verdict).toEqual({
    ok: false,
    better: 'Do you think the result will affect this page?',
    why: 'Use "affect" for the verb.',
    whyNative: '动词要用 affect。',
    words: [{ word: 'affect', meaning: '影响' }],
  })
  expect(parseCoach('{"ok": true}')).toEqual({ ok: true })
  expect(parseCoach('no json here')).toBe(null)
  expect(parseCoach('{"ok": false}')).toBe(null)
})

test('code and links are left out of what the coach reads', () => {
  expect(proseOf('fix this `npm test` please\n```js\nconst a = 1\n```\nsee https://x.dev/a')).toBe(
    'fix this please see',
  )
  expect(isWorthChecking('ok')).toBe(false)
  expect(isWorthChecking('could u fix the bug')).toBe(true)
  expect(isWorthChecking('请帮我修复这个错误吧')).toBe(true)
})

test('glossed words are collected from a reply, but not from code', () => {
  const reply = 'This is **deprecated** (已弃用). We should **refactor** (重构) it.\n```\n**nope** (no)\n```'
  expect(harvestWords(reply)).toEqual([
    { word: 'deprecated', meaning: '已弃用' },
    { word: 'refactor', meaning: '重构' },
  ])
})

test('each switch changes what Claude is told', () => {
  expect(learnSection(SAVED)).toContain('CEFR level A2')
  expect(learnSection(SAVED)).toContain('Simplified Chinese translation')
  const noGlossary = learnSection({ ...SAVED, features: { ...SAVED.features, glossary: false } })
  expect(noGlossary).not.toContain('translation')
  expect(learnSection({ ...SAVED, features: { ...SAVED.features, simple: false, glossary: false } })).toBe(null)
  expect(learnSection({ ...SAVED, isOn: false })).toBe(null)
})

test('the system prompt gets the practice section only while practice mode is on', async ($, on) => {
  engine(on)
  mock.store(on, { settings: SAVED })
  await $.session.start(START)

  const on1 = await $.prompt.compose(COMPOSE)
  expect(on1.sections.map(section => section.id)).toEqual(['intro', 'languagemod:learn'])

  await $.command.run({ command: 'learn', args: 'off', origin: { kind: 'composer' }, presentation: undefined as never })
  const off = await $.prompt.compose(COMPOSE)
  expect(off.sections.map(section => section.id)).toEqual(['intro'])
})

for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
  test(`first-time setup picks a language and a level on ${surface}`, async ($, on) => {
    engine(on)
    mock.store(on)
    mock.clock(on)
    await $.session.start(START)

    const ui = await $.ui.mount({ plugin: 'languagemod', surface, ...BAND })
    await ui.press({ key: 'lang:ja' })
    expect(await ui.find({ key: 'level:middle' })).toBeDefined()
    await ui.press({ key: 'level:middle' })
    expect(await ui.find({ key: 'level:middle' })).toBeUndefined()
    await ui.unmount()

    const prompt = await $.prompt.compose(COMPOSE)
    const section = prompt.sections.find(one => one.id === 'languagemod:learn')
    expect(section?.text).toContain('Japanese')
    expect(section?.text).toContain('CEFR level B1')
  })
}

test('changing the language later skips the level question', async ($, on) => {
  engine(on)
  mock.store(on, { settings: SAVED })
  await $.session.start(START)

  const pane = await $.ui.mount({ plugin: 'languagemod', surface: 'desktop', ...SETTINGS_PANE })
  await pane.press({ key: 'set:language' })
  await pane.unmount()

  const band = await $.ui.mount({ plugin: 'languagemod', surface: 'desktop', ...BAND })
  await band.press({ key: 'lang:ko' })
  expect(await band.find({ key: 'level:middle' })).toBeUndefined()
  await band.unmount()

  const prompt = await $.prompt.compose(COMPOSE)
  expect(prompt.sections.find(one => one.id === 'languagemod:learn')?.text).toContain('Korean')
})

test('Not now hides the setup until /learn', async ($, on) => {
  engine(on)
  mock.store(on)
  await $.session.start(START)

  const band = await $.ui.mount({ plugin: 'languagemod', surface: 'terminal', ...BAND })
  await band.press({ key: 'setup:later' })
  expect(await band.find({ key: 'lang:ja' })).toBeUndefined()
  await $.command.run({ command: 'learn', args: '', origin: { kind: 'composer' }, presentation: undefined as never })
  expect(await band.find({ key: 'lang:ja' })).toBeDefined()
  await band.unmount()
})

test('a feature switch in the settings panel turns that feature off', async ($, on) => {
  engine(on)
  mock.store(on, { settings: SAVED })
  await $.session.start(START)

  const pane = await $.ui.mount({ plugin: 'languagemod', surface: 'desktop', ...SETTINGS_PANE })
  expect((await pane.find({ key: 'set:feature:glossary' }))?.text).toContain('On')
  await pane.press({ key: 'set:feature:glossary' })
  expect((await pane.find({ key: 'set:feature:glossary' }))?.text).toContain('Off')
  await pane.unmount()

  const prompt = await $.prompt.compose(COMPOSE)
  expect(prompt.sections.find(one => one.id === 'languagemod:learn')?.text).not.toContain('translation')
})

test('a message with a mistake shows a tip, and its word can be saved', async ($, on) => {
  engine(on, CORRECTION)
  mock.store(on, { settings: SAVED })
  const clock = mock.clock(on)
  await $.session.start(START)

  await $.prompt.submit({ text: 'could u think the result will effect now page?', wait: false, origin: { kind: 'composer' } })
  await clock.settle()

  const band = await $.ui.mount({ plugin: 'languagemod', surface: 'terminal', ...BAND })
  expect((await band.find({ text: /affect this page/ }))).toBeDefined()
  await band.press({ key: 'tip:native' })
  expect(await band.find({ text: /动词要用/ })).toBeDefined()
  await band.press({ key: 'tip:save' })
  await band.press({ key: 'tip:ok' })
  expect(await band.find({ key: 'tip:ok' })).toBeUndefined()
  await band.unmount()

  const result = await $.command.run({ command: 'words', args: '', origin: { kind: 'composer' }, presentation: undefined as never })
  expect(result.text).toContain('1 word')
})

test('with Corrections off, no check runs until /check', async ($, on) => {
  let checks = 0
  engine(on, CORRECTION, () => {
    checks += 1
  })
  mock.store(on, { settings: { ...SAVED, features: { ...SAVED.features, coach: false } } })
  const clock = mock.clock(on)
  await $.session.start(START)

  await $.prompt.submit({ text: 'could u think the result will effect now page?', wait: false, origin: { kind: 'composer' } })
  await clock.settle()
  expect(checks).toBe(0)

  const result = await $.command.run({ command: 'check', args: '', origin: { kind: 'composer' }, presentation: undefined as never })
  expect(checks).toBe(1)
  expect(result.text).toContain('English tip')
})

test('the quiz asks each saved word and counts what you knew', async ($, on) => {
  engine(on)
  mock.store(on, {
    settings: SAVED,
    words: [
      { word: 'affect', meaning: '影响', addedAt: 1, known: 0 },
      { word: 'refactor', meaning: '重构', addedAt: 2, known: 3 },
    ],
  })
  await $.session.start(START)
  await $.command.run({ command: 'quiz', args: '', origin: { kind: 'composer' }, presentation: undefined as never })

  const pane = await $.ui.mount({
    plugin: 'languagemod',
    surface: 'mobile',
    ...SETTINGS_PANE,
    requestId: 'languagemod-words',
    props: { ...SETTINGS_PANE.props, title: 'My words' },
  })
  expect(await pane.find({ text: 'affect' })).toBeDefined()
  await pane.press({ key: 'quiz:show' })
  expect(await pane.find({ text: /影响/ })).toBeDefined()
  await pane.press({ key: 'quiz:knew' })
  expect(await pane.find({ text: 'refactor' })).toBeDefined()
  await pane.press({ key: 'quiz:show' })
  await pane.press({ key: 'quiz:again-later' })
  expect(await pane.find({ text: /You knew 1 of 2/ })).toBeDefined()
  await pane.press({ key: 'quiz:stop' })
  expect(await pane.find({ key: 'words:quiz' })).toBeDefined()
  await pane.unmount()
})
