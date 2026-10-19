export type Level = 'beginner' | 'middle' | 'advanced'

/** `big`: only mistakes that hurt the meaning; `all`: every mistake. */
export type Strictness = 'big' | 'all'

/**
 * The parts of practice mode a person can switch on and off one by one:
 * `translate` messages written in another language sent to Claude in English,
 * `simple` replies at their level, `glossary` hard words translated,
 * `coach` corrections of what they type, `collect` saving new words.
 */
export type Feature = 'translate' | 'simple' | 'glossary' | 'coach' | 'collect'

/** `send`: the English goes to Claude at once; `review`: the person sees it first. */
export type TranslateMode = 'send' | 'review'

export type Practice = {
  isOn: boolean
  native: string
  level: Level
  strictness: Strictness
  translateMode: TranslateMode
  features: Record<Feature, boolean>
}

export type NewWord = { word: string; meaning: string }

export type Word = NewWord & { addedAt: number; known: number }

export type Tip = {
  original: string
  better: string
  why: string
  whyNative: string
  words: NewWord[]
}

export type Translation = { original: string; english: string; language: string; words: NewWord[] }

export type Setup = 'native' | 'level' | null

export type Quiz = { order: string[]; index: number; isRevealed: boolean; right: number } | null

declare module 'claude-code' {
  interface PluginState {
    languagemod: {
      settings: Practice | null
      setup: Setup
      tip: Tip | null
      showNative: boolean
      newWords: NewWord[]
      words: Word[]
      quiz: Quiz
      lastPrompt: string
      streak: number
      translations: Translation[]
      pending: Translation | null
    }
  }
}
