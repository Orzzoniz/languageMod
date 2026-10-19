export type Level = 'beginner' | 'middle' | 'advanced'

/** `big`: only mistakes that hurt the meaning; `all`: every mistake. */
export type Strictness = 'big' | 'all'

/**
 * The parts of practice mode a person can switch on and off one by one:
 * `simple` replies at their level, `glossary` hard words translated,
 * `coach` corrections of what they type, `collect` saving new words.
 */
export type Feature = 'simple' | 'glossary' | 'coach' | 'collect'

export type Practice = {
  isOn: boolean
  native: string
  level: Level
  strictness: Strictness
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
    }
  }
}
