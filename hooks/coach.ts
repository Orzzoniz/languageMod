import type { Feature, Level, NewWord, Practice, Word } from '../types'
import { ENGLISH, isKnownLanguage, LANGUAGES, languageOf } from './languages'

export const COACH_MODEL = 'haiku'

export const FEATURES: readonly Feature[] = ['translate', 'simple', 'glossary', 'coach', 'collect']

export const DEFAULT_SETTINGS: Practice = {
  isOn: true,
  native: 'en',
  level: 'beginner',
  strictness: 'big',
  translateMode: 'send',
  features: { translate: true, simple: true, glossary: true, coach: true, collect: true },
}

export function isActive(s: Practice | null, feature: Feature): s is Practice {
  return s !== null && s.isOn && s.features[feature]
}

const LEVEL_STYLE: Record<Level, string> = {
  beginner:
    'Write at CEFR level A2: short sentences of about 12 words or fewer, the most common English words, one idea per sentence. Prefer lists and small steps.',
  middle:
    'Write at CEFR level B1: clear, plain sentences. Avoid idioms, slang, and phrasal verbs whose meaning is hard to guess.',
  advanced: 'Write clear, normal technical English (CEFR B2 to C1). Avoid rare idioms and slang.',
}

const GLOSS_LIMIT: Record<Level, string> = {
  beginner: 'up to 5 words per reply: technical terms and words outside the 2,000 most common English words',
  middle: 'up to 3 words per reply: only words a B1 learner probably does not know',
  advanced: 'at most 2 words per reply: only rare or tricky words',
}

/**
 * The system prompt section for the parts of practice mode that change Claude's replies, or null when none is on.
 * `inReply` is for surfaces that draw no box above the input: tips and translations go in the reply itself.
 */
export function learnSection(s: Practice, inReply = false): string | null {
  const isSimple = isActive(s, 'simple')
  const isGlossary = isActive(s, 'glossary')
  const isCoach = inReply && isActive(s, 'coach')
  const isTranslate = inReply && isActive(s, 'translate')
  if (!isSimple && !isGlossary && !isCoach && !isTranslate) return null

  const lang = languageOf(s.native)
  const lines = [
    '# English practice mode',
    `The user is a software developer practicing English. Their level is ${s.level}. Their native language is ${lang.english}.`,
    'Reply in English, even when the user writes in another language, unless they clearly ask for another language.',
  ]
  if (isSimple) lines.push(LEVEL_STYLE[s.level])
  if (isGlossary) {
    const how =
      lang.code === 'en'
        ? 'a very short, simple English meaning after it, like: **deprecated** (= old, do not use).'
        : `its ${lang.english} translation after it, like: **deprecated** (<${lang.english} translation>).`
    lines.push(
      `Help with vocabulary: the first time you use a hard word in a reply, write it in bold and put ${how} Do this for ${GLOSS_LIMIT[s.level]}. Never do it inside code blocks, inline code, commands, file paths, or commit messages.`,
    )
  }
  if (isTranslate) {
    lines.push(
      'When a note says the practice tool translated the user\'s message, start your reply with one line: **In English:** "<the English message>", so they learn how to say it.',
    )
  }
  if (isCoach) {
    const which =
      s.strictness === 'all'
        ? 'any grammar, spelling, or word-choice mistake (ignore capital letters and final punctuation)'
        : 'a big mistake: a wrong or misspelled word, a wrong verb form, a missing word, or word order that makes the meaning unclear'
    const reason = lang.code === 'en' ? 'a short reason in simple English' : `a short reason in ${lang.english}`
    lines.push(
      `English corrections: when the user's latest message is in English and has ${which}, end your reply with one line: **English tip:** "<their words>" → "<better English>" (${reason}). Ignore code, commands, and names. When there is no such mistake, or the message was translated, add nothing.`,
    )
  }
  lines.push('Keep code, identifiers, code comments, commit messages, and file contents in normal English.')
  if (!isCoach) lines.push("Do not correct the user's English in your reply: a separate tool shows them corrections.")
  return lines.join('\n')
}

/** Tells Claude to point the person to the setup once, while practice mode is installed but not set up. */
export const SETUP_SECTION = [
  '# English practice tool',
  'The user has an English practice tool that is not set up yet.',
  'At the end of your first reply in this conversation only, add one line: "Tip: send /learn to set up English practice."',
].join('\n')

const FEATURE_WORDS: Record<string, Feature> = {
  translate: 'translate',
  simple: 'simple',
  wordhelp: 'glossary',
  glossary: 'glossary',
  corrections: 'coach',
  correction: 'coach',
  coach: 'coach',
  collect: 'collect',
}

export const FEATURE_ARG: Record<Feature, string> = {
  translate: 'translate',
  simple: 'simple',
  glossary: 'wordhelp',
  coach: 'corrections',
  collect: 'collect',
}

export type LearnAction =
  | { kind: 'status' }
  | { kind: 'master'; isOn: boolean }
  | { kind: 'languages' }
  | { kind: 'language'; code: string }
  | { kind: 'level'; level: Level }
  | { kind: 'feature'; feature: Feature; isOn: boolean }
  | { kind: 'translateMode'; mode: 'send' | 'review' }
  | { kind: 'strictness'; strictness: 'big' | 'all' }
  | { kind: 'unknown'; text: string }

/** What `/learn <args>` asks for, as typed in any case. */
export function parseLearnArgs(args: string): LearnAction {
  const text = args.trim()
  const words = text.toLowerCase().split(/\s+/).filter(word => word !== '')
  const [first, second] = words
  if (first === undefined) return { kind: 'status' }
  if (words.length === 1 && (first === 'on' || first === 'off')) return { kind: 'master', isOn: first === 'on' }
  if (first === 'language' || first === 'languages') return { kind: 'languages' }
  if (first === 'beginner' || first === 'middle' || first === 'advanced') return { kind: 'level', level: first }
  const feature = FEATURE_WORDS[first]
  if (feature !== undefined) {
    if (second === 'on' || second === 'off') return { kind: 'feature', feature, isOn: second === 'on' }
    if (feature === 'translate' && (second === 'send' || second === 'check')) {
      return { kind: 'translateMode', mode: second === 'check' ? 'review' : 'send' }
    }
    if (feature === 'coach' && (second === 'big' || second === 'all')) return { kind: 'strictness', strictness: second }
    return { kind: 'unknown', text }
  }
  const lang = findLanguage(text)
  return lang === undefined ? { kind: 'unknown', text } : { kind: 'language', code: lang }
}

function findLanguage(text: string): string | undefined {
  const wanted = text.trim().toLowerCase()
  const all = [...LANGUAGES, ENGLISH]
  const exact = all.find(
    lang => lang.code.toLowerCase() === wanted || lang.native.toLowerCase() === wanted || lang.english.toLowerCase() === wanted,
  )
  if (exact !== undefined) return exact.code
  // "chinese", "portuguese", "english": the first language whose English name has that word.
  return all.find(lang => lang.english.toLowerCase().split(' ').includes(wanted))?.code
}

export function languagesText(isFirstTime: boolean): string {
  const rows = [...LANGUAGES, ENGLISH].map(lang => `/learn ${lang.code.padEnd(6)} ${lang.native}`)
  return [
    isFirstTime ? 'English practice setup, step 1 of 2.' : 'Change your help language.',
    'Which language do you know best? Send one of these:',
    '',
    ...rows,
  ].join('\n')
}

export function levelsText(): string {
  return [
    'Step 2 of 2: what is your English level? Send one of these:',
    '',
    '/learn beginner   short, easy sentences',
    '/learn middle     plain sentences',
    '/learn advanced   normal technical English',
  ].join('\n')
}

const FEATURE_LABEL: Record<Feature, string> = {
  translate: 'Translate',
  simple: 'Simple English',
  glossary: 'Word help',
  coach: 'Corrections',
  collect: 'Collect words',
}

export function statusText(s: Practice, wordCount: number): string {
  const lang = languageOf(s.native)
  const level = s.level[0]?.toUpperCase() + s.level.slice(1)
  const rows = FEATURES.map(feature => {
    const isOn = s.features[feature]
    const toggle = `/learn ${FEATURE_ARG[feature]} ${isOn ? 'off' : 'on'}`
    return `${FEATURE_LABEL[feature].padEnd(15)}${isOn ? 'On ' : 'Off'}   change: ${toggle}`
  })
  return [
    s.isOn ? 'English practice is ON.' : 'English practice is OFF. Send /learn on to start again.',
    `Help language: ${lang.native} (change: /learn language)`,
    `Level: ${level} (change: /learn beginner, /learn middle, /learn advanced)`,
    '',
    ...rows,
    '',
    `Translate then: ${s.translateMode === 'review' ? 'let me check first' : 'send in English'} (change: /learn translate send, /learn translate check)`,
    ...(s.translateMode === 'review'
      ? ['  (Checking first works in the terminal and desktop app. In the web and phone apps the English is sent at once.)']
      : []),
    `Corrections show: ${s.strictness === 'all' ? 'every mistake' : 'big mistakes'} (change: /learn corrections big, /learn corrections all)`,
    '',
    `Saved words: ${wordCount} (/words to see them, /quiz to practice)`,
    ...(s.isOn ? ['Turn everything off: /learn off'] : []),
  ].join('\n')
}


export function coachSystem(s: Practice): string {
  const lang = languageOf(s.native)
  const helpLanguage = lang.code === 'en' ? 'simple English' : lang.english
  const strictness =
    s.strictness === 'all'
      ? 'Report every grammar, spelling, and word-choice mistake. Ignore capital letters and the punctuation at the end.'
      : 'Report only big mistakes: a wrong or misspelled word, a wrong verb form, a missing word, or word order that makes the meaning unclear. Ignore capital letters, punctuation, small article mistakes, and casual chat style.'
  return [
    'You are a kind English coach for a software developer who is learning English.',
    `Their level: ${s.level}. Their native language: ${lang.english}.`,
    'You get one message they typed to an AI coding assistant. Check its English.',
    strictness,
    'Ignore code, file paths, commands, URLs, names, and technical terms.',
    'If the message is not in English, put the natural English version in "better" so they learn how to say it.',
    'Answer with one JSON object and nothing else.',
    'When there is nothing to fix: {"ok": true}',
    `Otherwise: {"ok": false, "better": "<the whole message in natural, simple English, same meaning, code unchanged>", "why": "<the main reason, in simple English, 15 words or fewer>", "whyNative": "<the same reason in ${helpLanguage}>", "words": [{"word": "<an English word or phrase to learn>", "meaning": "<a short meaning in ${helpLanguage}>"}]}`,
    'Give at most 3 items in "words".',
  ].join('\n')
}

const FENCED = /```[\s\S]*?(```|$)/g
const INLINE_CODE = /`[^`\n]*`/g

/** The words a person wrote, without code, links or extra space: what the coach reads. */
export function proseOf(text: string): string {
  return text
    .replace(FENCED, ' ')
    .replace(INLINE_CODE, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1200)
}

export function isWorthChecking(prose: string): boolean {
  const letters = prose.replace(/[^\p{L}]/gu, '').length
  const words = prose.split(' ').filter(word => /\p{L}/u.test(word)).length
  // Scripts without spaces between words (Chinese, Japanese, Thai) count by letters alone.
  return letters >= 8 && (words >= 3 || /[^\u0000-ɏ\s\p{P}\d]/u.test(prose))
}

export type Verdict =
  | { ok: true }
  | { ok: false; better: string; why: string; whyNative: string; words: NewWord[] }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const textOf = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

export function parseCoach(reply: string): Verdict | null {
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  if (start < 0 || end <= start) return null

  let raw: unknown
  try {
    raw = JSON.parse(reply.slice(start, end + 1))
  } catch {
    return null
  }
  if (!isRecord(raw)) return null
  if (raw.ok === true) return { ok: true }

  const better = textOf(raw.better)
  if (better === '') return null
  const words = Array.isArray(raw.words) ? raw.words.flatMap(wordOf).slice(0, 3) : []
  return { ok: false, better, why: textOf(raw.why), whyNative: textOf(raw.whyNative), words }
}

function wordOf(value: unknown): NewWord[] {
  if (!isRecord(value)) return []
  const word = textOf(value.word)
  const meaning = textOf(value.meaning)
  return word !== '' && meaning !== '' ? [{ word, meaning }] : []
}

/** True when two texts differ only in case, spacing or punctuation. */
export function sameText(a: string, b: string): boolean {
  const plain = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
  return plain(a) === plain(b)
}

// Native languages written in the Latin alphabet, where a message has to be told from English by its words.
const LATIN_NATIVE = new Set(['es', 'pt-BR', 'fr', 'de', 'vi', 'id', 'tr', 'it', 'pl'])

// Short words almost every English sentence has and these other languages do not.
const ENGLISH_COMMON = new Set(
  (
    'a an the is are was were be been am i you he she it we they me my your our this that these those ' +
    'to of and in on at for with from by as or but if not no do does did can could will would should ' +
    'have has had what why how when where which who there here please just also so all some any more ' +
    'help make get use want need fix add run show tell let like about into out up'
  ).split(' '),
)

// One letter of these scripts says about as much as a short English word.
const DENSE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u

/** True when a message is written, wholly or partly, in a language other than English. */
export function looksForeign(prose: string, native: string): boolean {
  let latin = 0
  let other = 0
  for (const char of prose) {
    if (/\p{Script=Latin}/u.test(char)) latin += 1
    else if (/\p{L}/u.test(char)) other += DENSE_SCRIPT.test(char) ? 3 : 1
  }
  if (other >= 2 && other / (latin + other) >= 0.15) return true
  if (!LATIN_NATIVE.has(native)) return false
  const words = prose.toLowerCase().match(/[\p{L}']+/gu) ?? []
  if (words.length < 3) return false
  return words.filter(word => ENGLISH_COMMON.has(word)).length / words.length < 0.2
}

export function translateSystem(s: Practice): string {
  const lang = languageOf(s.native)
  const helpLanguage = lang.code === 'en' ? 'simple English' : lang.english
  return [
    "You translate a software developer's message into natural, clear English for an AI coding assistant.",
    'Keep the exact meaning and tone. Do not answer the message, explain it, or add anything.',
    'Keep these unchanged: placeholders like ⟦0⟧, file paths, commands, URLs, code identifiers, and product names.',
    'If the message asks to use specific non-English text (a UI label, a string, a translation), keep that text exactly as written.',
    'If the whole message is already in English, answer only: <same/>',
    'Otherwise answer in exactly this format:',
    '<english>the translation</english>',
    '<language>the name of the language it was written in, in English</language>',
    '<words>',
    `up to 3 lines like "fix = <meaning in ${helpLanguage}>": the English words in your translation for what they wrote in their own language`,
    '</words>',
  ].join('\n')
}

export type Translated = { english: string; language: string; words: NewWord[] }

export function parseTranslation(reply: string): Translated | 'same' | null {
  const english = /<english>([\s\S]*?)<\/english>/.exec(reply)?.[1]?.trim() ?? ''
  if (english === '') return /<same\s*\/>/.test(reply) ? 'same' : null
  const language = /<language>([\s\S]*?)<\/language>/.exec(reply)?.[1]?.trim() ?? ''
  const list = /<words>([\s\S]*?)<\/words>/.exec(reply)?.[1] ?? ''
  const words = list
    .split('\n')
    .flatMap(line => {
      const match = /^\s*[-*]?\s*(.+?)\s*=\s*(.+?)\s*$/.exec(line)
      return match?.[1] && match[2] ? [{ word: match[1], meaning: match[2] }] : []
    })
    .slice(0, 3)
  return { english, language, words }
}

/** Code in a message, swapped for numbered marks the translator keeps, so the code is never translated. */
export function maskCode(text: string): { masked: string; blocks: string[] } {
  const blocks: string[] = []
  const masked = text.replace(/```[\s\S]*?```|`[^`\n]+`/g, block => {
    blocks.push(block)
    return `⟦${blocks.length - 1}⟧`
  })
  return { masked, blocks }
}

/** The code put back in place of its marks, or null when the translation lost a mark. */
export function restoreCode(text: string, blocks: readonly string[]): string | null {
  let restored = text
  for (const [index, block] of blocks.entries()) {
    const mark = `⟦${index}⟧`
    if (!restored.includes(mark)) return null
    restored = restored.replace(mark, () => block)
  }
  return restored
}

const GLOSS = /\*\*([A-Za-z][A-Za-z'’ -]{0,38}[A-Za-z])\*\*\s*\(([^()\n]{1,60})\)/g

/** The words Claude glossed in a reply, written as **word** (meaning), outside code. */
export function harvestWords(answer: string): NewWord[] {
  const prose = answer.replace(FENCED, ' ').replace(INLINE_CODE, ' ')
  const seen = new Set<string>()
  const found: NewWord[] = []
  for (const match of prose.matchAll(GLOSS)) {
    const word = (match[1] ?? '').trim()
    const meaning = (match[2] ?? '').replace(/^=\s*/, '').trim()
    const key = word.toLowerCase()
    if (meaning === '' || seen.has(key)) continue
    seen.add(key)
    found.push({ word, meaning })
    if (found.length === 8) break
  }
  return found
}

export function addWords(list: readonly Word[], add: readonly NewWord[], now: number): Word[] {
  const have = new Set(list.map(word => word.word.toLowerCase()))
  const fresh: Word[] = []
  for (const word of add) {
    const key = word.word.toLowerCase()
    if (have.has(key)) continue
    have.add(key)
    fresh.push({ ...word, addedAt: now, known: 0 })
  }
  return [...list, ...fresh].slice(-500)
}

/** Up to ten words for a quiz, the least known first and, among those, the newest. */
export function quizOrder(list: readonly Word[]): string[] {
  return [...list]
    .sort((a, b) => a.known - b.known || b.addedAt - a.addedAt)
    .slice(0, 10)
    .map(word => word.word)
}

export function parseSettings(raw: unknown): Practice | null {
  if (!isRecord(raw)) return null
  const native = textOf(raw.native)
  const features = isRecord(raw.features) ? raw.features : {}
  return {
    isOn: raw.isOn !== false,
    native: isKnownLanguage(native) ? native : DEFAULT_SETTINGS.native,
    level: raw.level === 'middle' || raw.level === 'advanced' ? raw.level : 'beginner',
    strictness: raw.strictness === 'all' ? 'all' : 'big',
    translateMode: raw.translateMode === 'review' ? 'review' : 'send',
    features: {
      translate: features.translate !== false,
      simple: features.simple !== false,
      glossary: features.glossary !== false,
      coach: features.coach !== false,
      collect: features.collect !== false,
    },
  }
}

export function parseWords(raw: unknown): Word[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap(value => {
    if (!isRecord(value)) return []
    const [word] = wordOf(value)
    if (word === undefined) return []
    const addedAt = typeof value.addedAt === 'number' ? value.addedAt : 0
    const known = typeof value.known === 'number' ? value.known : 0
    return [{ ...word, addedAt, known }]
  })
}

export function clip(text: string, length: number): string {
  return text.length <= length ? text : `${text.slice(0, length - 1)}…`
}
