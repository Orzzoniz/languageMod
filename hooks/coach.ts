import type { Feature, Level, NewWord, Practice, Word } from '../types'
import { isKnownLanguage, languageOf } from './languages'

export const COACH_MODEL = 'haiku'

export const FEATURES: readonly Feature[] = ['simple', 'glossary', 'coach', 'collect']

export const DEFAULT_SETTINGS: Practice = {
  isOn: true,
  native: 'en',
  level: 'beginner',
  strictness: 'big',
  features: { simple: true, glossary: true, coach: true, collect: true },
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

/** The system prompt section for the parts of practice mode that change Claude's replies, or null when none is on. */
export function learnSection(s: Practice): string | null {
  const isSimple = isActive(s, 'simple')
  const isGlossary = isActive(s, 'glossary')
  if (!isSimple && !isGlossary) return null

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
  lines.push(
    'Keep code, identifiers, code comments, commit messages, and file contents in normal English.',
    "Do not correct the user's English in your reply: a separate tool shows them corrections.",
  )
  return lines.join('\n')
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
    features: {
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
