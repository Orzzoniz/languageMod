export type Language = { code: string; english: string; native: string }

export const ENGLISH: Language = { code: 'en', english: 'English', native: 'English only' }

// The help languages offered at setup, by number of developers who speak them.
// `native` is how speakers write their own language's name: what they look for in a list.
export const LANGUAGES: readonly Language[] = [
  { code: 'zh-CN', english: 'Simplified Chinese', native: '简体中文' },
  { code: 'zh-TW', english: 'Traditional Chinese', native: '繁體中文' },
  { code: 'ja', english: 'Japanese', native: '日本語' },
  { code: 'ko', english: 'Korean', native: '한국어' },
  { code: 'es', english: 'Spanish', native: 'Español' },
  { code: 'pt-BR', english: 'Brazilian Portuguese', native: 'Português' },
  { code: 'fr', english: 'French', native: 'Français' },
  { code: 'de', english: 'German', native: 'Deutsch' },
  { code: 'ru', english: 'Russian', native: 'Русский' },
  { code: 'uk', english: 'Ukrainian', native: 'Українська' },
  { code: 'vi', english: 'Vietnamese', native: 'Tiếng Việt' },
  { code: 'id', english: 'Indonesian', native: 'Bahasa Indonesia' },
  { code: 'tr', english: 'Turkish', native: 'Türkçe' },
  { code: 'hi', english: 'Hindi', native: 'हिन्दी' },
  { code: 'ar', english: 'Arabic', native: 'العربية' },
  { code: 'th', english: 'Thai', native: 'ไทย' },
  { code: 'it', english: 'Italian', native: 'Italiano' },
  { code: 'pl', english: 'Polish', native: 'Polski' },
]

export function languageOf(code: string): Language {
  return LANGUAGES.find(lang => lang.code === code) ?? ENGLISH
}

export function isKnownLanguage(code: string): boolean {
  return code === ENGLISH.code || LANGUAGES.some(lang => lang.code === code)
}

/** The language a person typed by its code, English name or own name (`ja`, `japanese`, `日本語`), if any. */
export function findLanguage(name: string): Language | undefined {
  const typed = name.trim().toLowerCase()
  if (typed === '') return undefined
  return [...LANGUAGES, ENGLISH].find(lang =>
    [lang.code, lang.english, lang.native].some(one => one.toLowerCase() === typed),
  )
}
