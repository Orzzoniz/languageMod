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
  parseLearnArgs,
  parseTranslation,
  proseOf,
  restoreCode,
} from '../hooks/coach'

const SAVED = { ...DEFAULT_SETTINGS, native: 'zh-CN' }
const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const COMPOSE = { model: 'm', promptModel: 'm', surfaces: ['terminal'] as const, tools: [], outputStyle: null, traits: [] }
const COMPOSE_PHONE = { ...COMPOSE, surfaces: ['mobile'] as const }
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
  /** Called with each prompt that reaches Claude Code, and what the model reads beside it. */
  onPrompt?: (text: string, context: readonly string[]) => void
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
    beneath.onPrompt?.(e.text, e.context ?? [])
    return { text: e.text }
  })
  on('turn.complete', ($, e) => ({ text: e.answer }))
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
  expect(result.text).toContain('affect = 影响')
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

const RUN = { origin: { kind: 'bridge' }, presentation: undefined as never } as const

test('learn commands parse in plain words', () => {
  expect(parseLearnArgs('')).toEqual({ kind: 'status' })
  expect(parseLearnArgs('OFF')).toEqual({ kind: 'master', isOn: false })
  expect(parseLearnArgs('ja')).toEqual({ kind: 'language', code: 'ja' })
  expect(parseLearnArgs('Chinese')).toEqual({ kind: 'language', code: 'zh-CN' })
  expect(parseLearnArgs('한국어')).toEqual({ kind: 'language', code: 'ko' })
  expect(parseLearnArgs('middle')).toEqual({ kind: 'level', level: 'middle' })
  expect(parseLearnArgs('wordhelp off')).toEqual({ kind: 'feature', feature: 'glossary', isOn: false })
  expect(parseLearnArgs('translate check')).toEqual({ kind: 'translateMode', mode: 'review' })
  expect(parseLearnArgs('corrections all')).toEqual({ kind: 'strictness', strictness: 'all' })
  expect(parseLearnArgs('blah')).toEqual({ kind: 'unknown', text: 'blah' })
})

test('on a phone, setup and switches work by text commands', async ($, on) => {
  engine(on, { surfaces: ['mobile'] })
  mock.store(on)
  mock.clock(on)
  await $.session.start(START)

  const setupNote = await $.prompt.compose(COMPOSE_PHONE)
  expect(setupNote.sections.at(-1)?.text).toContain('send /learn')

  expect((await $.command.run({ command: 'learn', args: '', ...RUN })).text).toContain('/learn ja')
  expect((await $.command.run({ command: 'learn', args: 'japanese', ...RUN })).text).toContain('Step 2 of 2')
  const done = await $.command.run({ command: 'learn', args: 'middle', ...RUN })
  expect(done.text).toContain('English practice is ON')
  expect(done.text).toContain('日本語')

  const off = await $.command.run({ command: 'learn', args: 'translate off', ...RUN })
  expect(off.text).toMatch(/Translate\s+Off/)
  expect((await $.command.run({ command: 'learn', args: 'off', ...RUN })).text).toContain('OFF')
  expect((await $.command.run({ command: 'learn', args: 'nonsense', ...RUN })).text).toContain('I don\'t know')
})

test('on a phone, tips and translations go in Claude\'s reply', async ($, on) => {
  let checks = 0
  const sent: { text: string; context: readonly string[] }[] = []
  engine(on, {
    surfaces: ['mobile'],
    translation: TRANSLATION,
    onModel: system => {
      if (!system.includes('You translate')) checks += 1
    },
    onPrompt: (text, context) => sent.push({ text, context }),
  })
  mock.store(on, { settings: { ...SAVED, translateMode: 'review' } })
  const clock = mock.clock(on)
  await $.session.start(START)

  const phone = await $.prompt.compose(COMPOSE_PHONE)
  const rules = phone.sections.find(one => one.id === 'languagemod:learn')?.text ?? ''
  expect(rules).toContain('**English tip:**')
  expect(rules).toContain('**In English:**')
  const terminal = await $.prompt.compose(COMPOSE)
  expect(terminal.sections.find(one => one.id === 'languagemod:learn')?.text).not.toContain('English tip')

  await $.prompt.submit({ text: 'could u think the result will effect now page?', wait: false, origin: { kind: 'bridge' } })
  await clock.settle()
  expect(checks).toBe(0)

  await $.prompt.submit({ text: '请修复 `app.js` 让页面能用', wait: false, origin: { kind: 'bridge' } })
  expect(sent.at(-1)?.text).toBe('Please fix `app.js` so the page works.')
  expect(sent.at(-1)?.context.join(' ')).toContain('translated this message from Chinese')
})

test('on a phone, words are listed and saved by text, and the quiz runs in the chat', async ($, on) => {
  const sent: string[] = []
  engine(on, { surfaces: ['mobile'], onPrompt: text => sent.push(text) })
  mock.store(on, { settings: SAVED })
  const clock = mock.clock(on)
  await $.session.start(START)

  await $.turn.complete({ answer: 'It is **deprecated** (已弃用).', reason: 'answer', durationMs: 1, isAborted: false, turnId: 't1' })
  const list = await $.command.run({ command: 'words', args: '', ...RUN })
  expect(list.text).toContain('deprecated = 已弃用')
  expect(list.text).toContain('/words save')
  expect((await $.command.run({ command: 'words', args: 'save', ...RUN })).text).toContain('Saved 1')
  expect((await $.command.run({ command: 'words', args: '', ...RUN })).text).toContain('Your words (1)')

  expect((await $.command.run({ command: 'quiz', args: '', ...RUN })).text).toContain('1 word')
  await clock.settle()
  expect(sent.at(-1)).toContain('Quiz me')
  expect(sent.at(-1)).toContain('deprecated')
})
