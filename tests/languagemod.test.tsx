import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import {
  DEFAULT_SETTINGS,
  harvestWords,
  isWorthChecking,
  learnSection,
  looksForeign,
  maskCode,
  parseCoach,
  parseTranslation,
  proseOf,
  restoreCode,
} from '../hooks/coach'
import { findLanguage } from '../hooks/languages'

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

type Beneath = {
  /** What the coach answers. */
  coach?: string
  /** What the translator answers. */
  translation?: string
  /** Called with each model request: its system prompt and prompt. */
  onModel?: (system: string, prompt: string) => void
  /** Called with each prompt that reaches Claude Code. */
  onPrompt?: (text: string) => void
  /** The surfaces drawing the session; the terminal when not given. */
  surfaces?: readonly ('terminal' | 'desktop' | 'mobile' | 'vscode')[]
  /** Called with each toast. */
  onToast?: (text: string) => void
}

/** Stands for Claude Code beneath the mod. */
function engine(on: On, beneath: Beneath = {}) {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'You are Claude Code.', scope: 'shared' as const }] }))
  on('prompt.submit', ($, e) => {
    beneath.onPrompt?.(e.text)
    return { text: e.text }
  })
  on('prompt.fill', () => ({ isFilled: true }))
  on('model.complete', ($, e) => {
    const system = e.system ?? ''
    beneath.onModel?.(system, e.prompt)
    const isTranslator = system.includes('You translate')
    const text = isTranslator ? (beneath.translation ?? '<same/>') : (beneath.coach ?? '{"ok": true}')
    return { value: { isAnswered: true as const, text, usage: USAGE } }
  })
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.toast', ($, e) => {
    beneath.onToast?.(e.text)
    return { value: undefined }
  })
  on('session.surfaces', () => ({ value: beneath.surfaces ?? ['terminal'] }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.render', ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    if (e.component === 'UserMessage') return <Text>{e.props.text}</Text>
    return <Box key="engine" />
  })
}

const TRANSLATION = [
  '<english>Please fix ⟦0⟧ so the page works.</english>',
  '<language>Chinese</language>',
  '<words>',
  'fix = 修复',
  '</words>',
].join('\n')

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

test('a language is found by its code, English name or own name', () => {
  expect(findLanguage('ja')?.code).toBe('ja')
  expect(findLanguage(' Japanese ')?.code).toBe('ja')
  expect(findLanguage('日本語')?.code).toBe('ja')
  expect(findLanguage('español')?.code).toBe('es')
  expect(findLanguage('english')?.code).toBe('en')
  expect(findLanguage('chinese')).toBeUndefined()
  expect(findLanguage('')).toBeUndefined()
})

test('typing /learn japanese chooses the language without the panel', async ($, on) => {
  engine(on)
  mock.store(on)
  await $.session.start(START)
  const learn = (args: string) =>
    $.command.run({ command: 'learn', args, origin: { kind: 'bridge' }, presentation: undefined as never })

  expect((await learn('middle')).text).toContain('Choose your language first')
  expect((await learn('Japanese')).text).toContain('Help language: 日本語. Level: Beginner.')
  const band = await $.ui.mount({ plugin: 'languagemod', surface: 'terminal', ...BAND })
  expect(await band.find({ key: 'lang:ja' })).toBeUndefined()
  expect(await band.find({ key: 'level:middle' })).toBeUndefined()
  await band.unmount()

  expect((await learn('middle')).text).toBe('Level: Middle (plain sentences).')
  const prompt = await $.prompt.compose(COMPOSE)
  const section = prompt.sections.find(one => one.id === 'languagemod:learn')
  expect(section?.text).toContain('Japanese')
  expect(section?.text).toContain('CEFR level B1')

  expect((await learn('한국어')).text).toBe('Help language: 한국어.')
  expect((await learn('klingon')).text).toContain('/learn japanese')
})

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
  engine(on, { coach: CORRECTION })
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
  engine(on, {
    coach: CORRECTION,
    onModel: () => {
      checks += 1
    },
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

test('messages in another language are told from English', () => {
  expect(looksForeign('帮我修复这个错误', 'zh-CN')).toBe(true)
  expect(looksForeign('help me 修复 this bug', 'zh-CN')).toBe(true)
  expect(looksForeign('please fix the bug in this file', 'zh-CN')).toBe(false)
  expect(looksForeign('por favor arregla el error en este archivo', 'es')).toBe(true)
  expect(looksForeign('please fix the error in this file', 'es')).toBe(false)
  expect(looksForeign('ok', 'es')).toBe(false)
})

test('code is kept out of the translation and put back after', () => {
  const { masked, blocks } = maskCode('修复 `npm test` 和\n```js\nconst a = 1\n```')
  expect(masked).toBe('修复 ⟦0⟧ 和\n⟦1⟧')
  expect(restoreCode('Fix ⟦0⟧ and\n⟦1⟧', blocks)).toBe('Fix `npm test` and\n```js\nconst a = 1\n```')
  expect(restoreCode('Fix it', blocks)).toBe(null)
  expect(parseTranslation('<same/>')).toBe('same')
  expect(parseTranslation(TRANSLATION)).toEqual({
    english: 'Please fix ⟦0⟧ so the page works.',
    language: 'Chinese',
    words: [{ word: 'fix', meaning: '修复' }],
  })
})

test('a message in your language reaches Claude in English, with your words under it', async ($, on) => {
  const prompts: string[] = []
  const sent: string[] = []
  engine(on, { translation: TRANSLATION, onModel: (system, prompt) => prompts.push(prompt), onPrompt: text => sent.push(text) })
  mock.store(on, { settings: SAVED })
  mock.clock(on)
  await $.session.start(START)

  const result = await $.prompt.submit({ text: '请修复 `app.js` 让页面能用', wait: false, origin: { kind: 'composer' } })
  expect(prompts[0]).toBe('请修复 ⟦0⟧ 让页面能用')
  expect(result.text).toBe('Please fix `app.js` so the page works.')
  expect(sent).toEqual(['Please fix `app.js` so the page works.'])

  const row = await $.ui.mount({
    plugin: 'languagemod',
    surface: 'terminal',
    component: 'UserMessage',
    props: { text: 'Please fix `app.js` so the page works.', origin: { kind: 'composer' }, isExpanded: false },
  })
  expect(await row.find({ text: /you wrote: 请修复/ })).toBeDefined()
  await row.unmount()

  const band = await $.ui.mount({ plugin: 'languagemod', surface: 'terminal', ...BAND })
  expect(await band.find({ text: /fix = 修复/ })).toBeDefined()
  await band.unmount()
})

test('with "Let me check first", the English waits above the input until you send it', async ($, on) => {
  const sent: string[] = []
  engine(on, { translation: TRANSLATION, onPrompt: text => sent.push(text) })
  mock.store(on, { settings: { ...SAVED, translateMode: 'review' } })
  mock.clock(on)
  await $.session.start(START)

  const result = await $.prompt.submit({ text: '请修复 `app.js` 让页面能用', wait: false, origin: { kind: 'composer' } })
  expect('drop' in result && result.drop).toBeTruthy()
  expect(sent).toEqual([])

  const band = await $.ui.mount({ plugin: 'languagemod', surface: 'mobile', ...BAND })
  expect(await band.find({ text: /Please fix `app.js`/ })).toBeDefined()
  await band.press({ key: 'pending:send' })
  expect(sent).toEqual(['Please fix `app.js` so the page works.'])
  expect(await band.find({ key: 'pending:send' })).toBeUndefined()
  await band.unmount()
})

test('English messages and Translate off are sent as written', async ($, on) => {
  const sent: string[] = []
  let translations = 0
  engine(on, {
    onModel: system => {
      if (system.includes('You translate')) translations += 1
    },
    onPrompt: text => sent.push(text),
  })
  mock.store(on, { settings: { ...SAVED, features: { ...SAVED.features, translate: false } } })
  mock.clock(on)
  await $.session.start(START)

  await $.prompt.submit({ text: '请修复这个错误', wait: false, origin: { kind: 'composer' } })
  await $.prompt.submit({ text: 'please fix this error', wait: false, origin: { kind: 'composer' } })
  expect(translations).toBe(0)
  expect(sent).toEqual(['请修复这个错误', 'please fix this error'])
})

test('when the translation fails, the original message is sent', async ($, on) => {
  const sent: string[] = []
  engine(on, { translation: 'sorry, no', onPrompt: text => sent.push(text) })
  mock.store(on, { settings: SAVED })
  mock.clock(on)
  await $.session.start(START)

  await $.prompt.submit({ text: '请修复 `app.js` 让页面能用', wait: false, origin: { kind: 'composer' } })
  expect(sent).toEqual(['请修复 `app.js` 让页面能用'])
})

test('on a phone, /learn opens a panel with the setup, and tips arrive as toasts', async ($, on) => {
  const toasts: string[] = []
  engine(on, { coach: CORRECTION, surfaces: ['mobile'], onToast: text => toasts.push(text) })
  mock.store(on)
  const clock = mock.clock(on)
  await $.session.start(START)
  expect(toasts.some(text => text.includes('/learn'))).toBe(true)

  const learned = await $.command.run({ command: 'learn', args: '', origin: { kind: 'bridge' }, presentation: undefined as never })
  expect(learned.text).toContain('panel')
  const pane = await $.ui.mount({ plugin: 'languagemod', surface: 'mobile', ...SETTINGS_PANE })
  await pane.press({ key: 'lang:ko' })
  await pane.press({ key: 'level:beginner' })
  expect(await pane.find({ key: 'set:feature:translate' })).toBeDefined()

  await $.prompt.submit({ text: 'could u think the result will effect now page?', wait: false, origin: { kind: 'bridge' } })
  await clock.settle()
  expect(toasts.some(text => text.includes('affect this page'))).toBe(true)
  expect(await pane.find({ key: 'tip:ok' })).toBeDefined()
  await pane.unmount()
})
