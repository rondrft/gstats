/**
 * Language breakdown block.
 *
 * Two presentations share one layout. `blocks` draws the bar out of U+2588 FULL
 * BLOCK characters inside a single monospaced `<text>`, which means the columns
 * align without measuring anything — the font does the work. `bars` swaps the
 * characters for `<rect>`s so each language can carry its own colour.
 *
 * The `blocks` variant depends on runs of spaces surviving into the rendered
 * output, so its `<text>` carries `xml:space="preserve"`. Without it the XML
 * whitespace rules collapse the padding and the columns drift.
 */

import type { LanguageStat } from '../github/types'
import { escapeXml } from './xml'

export const LANGS_FONT_SIZE = 11
export const LANGS_LINE_HEIGHT = 20

/** Widest bar, in cells. Six reads as a bar without crowding the percentage. */
const MAX_BLOCKS = 6

const BLOCK = '█'

/** Width of the name column, in characters. */
const NAME_WIDTH = 5

/**
 * Short forms for the languages that show up most often. The convention is the
 * language's usual file extension, which is what readers already recognise;
 * anything not listed falls back to its first three letters.
 */
const ABBREVIATIONS: Record<string, string> = {
  typescript: 'ts',
  javascript: 'js',
  python: 'py',
  ruby: 'rb',
  rust: 'rs',
  go: 'go',
  c: 'c',
  'c++': 'cpp',
  'c#': 'cs',
  java: 'java',
  kotlin: 'kt',
  swift: 'swift',
  'objective-c': 'objc',
  php: 'php',
  html: 'html',
  css: 'css',
  scss: 'scss',
  shell: 'sh',
  powershell: 'ps1',
  dart: 'dart',
  elixir: 'ex',
  erlang: 'erl',
  haskell: 'hs',
  lua: 'lua',
  perl: 'pl',
  r: 'r',
  scala: 'scala',
  clojure: 'clj',
  zig: 'zig',
  nix: 'nix',
  vue: 'vue',
  svelte: 'svlt',
  astro: 'astro',
  dockerfile: 'dock',
  makefile: 'make',
  'jupyter notebook': 'ipynb',
  'vim script': 'vim',
  assembly: 'asm',
}

export function abbreviate(language: string): string {
  const known = ABBREVIATIONS[language.toLowerCase()]
  if (known !== undefined) return known
  return language.toLowerCase().slice(0, 3)
}

interface LangsOptions {
  languages: readonly LanguageStat[]
  x: number
  /** Vertical centre of the block. */
  cy: number
  text: string
  muted: string
  /** Used for `bars` when GitHub has no colour on file for a language. */
  fallbackColor: string
  style: 'blocks' | 'bars'
  /** Shown when the account has no public repositories to measure. */
  emptyLabel: string
}

export function langsBlock({
  languages,
  x,
  cy,
  text,
  muted,
  fallbackColor,
  style,
  emptyLabel,
}: LangsOptions): string {
  const font = `font-size="${LANGS_FONT_SIZE}"`

  if (languages.length === 0) {
    return `<text x="${x}" y="${cy + 4}" ${font} fill="${muted}">${escapeXml(emptyLabel)}</text>`
  }

  const firstBaseline = cy - ((languages.length - 1) * LANGS_LINE_HEIGHT) / 2 + 4

  return languages
    .map((language, index) => {
      const y = firstBaseline + index * LANGS_LINE_HEIGHT
      return style === 'bars'
        ? barLine(language, x, y, text, muted, fallbackColor)
        : blockLine(language, x, y, text)
    })
    .join('')
}

/** `ts    ██████  41%` — one text node, alignment courtesy of the font. */
function blockLine(language: LanguageStat, x: number, y: number, text: string): string {
  const name = abbreviate(language.name).slice(0, NAME_WIDTH).padEnd(NAME_WIDTH)
  const bar = BLOCK.repeat(blockCount(language.pct)).padEnd(MAX_BLOCKS)
  const percent = `${Math.round(language.pct * 100)}`.padStart(3)
  const line = `${name} ${bar} ${percent}%`
  return (
    `<text x="${x}" y="${y}" font-size="${LANGS_FONT_SIZE}" fill="${text}" ` +
    `xml:space="preserve">${escapeXml(line)}</text>`
  )
}

/**
 * A language that made the list gets at least one cell even when it rounds to
 * zero; the percentage beside it carries the precision.
 */
function blockCount(pct: number): number {
  return Math.max(1, Math.min(MAX_BLOCKS, Math.round(pct * MAX_BLOCKS)))
}

/** Cell width used to place the `bars` variant's columns, in user units. */
const CELL = LANGS_FONT_SIZE * 0.6

const BAR_WIDTH = MAX_BLOCKS * CELL
const BAR_HEIGHT = 7

function barLine(
  language: LanguageStat,
  x: number,
  y: number,
  text: string,
  muted: string,
  fallbackColor: string,
): string {
  const name = abbreviate(language.name).slice(0, NAME_WIDTH)
  const barX = x + (NAME_WIDTH + 1) * CELL
  const filled = Math.max(1, Math.round(language.pct * BAR_WIDTH))
  const color = language.color ?? fallbackColor
  const percent = `${Math.round(language.pct * 100)}%`
  const percentX = barX + BAR_WIDTH + CELL

  return (
    `<text x="${x}" y="${y}" font-size="${LANGS_FONT_SIZE}" fill="${text}">${escapeXml(name)}</text>` +
    `<rect x="${barX}" y="${y - BAR_HEIGHT}" width="${round(BAR_WIDTH)}" height="${BAR_HEIGHT}" ` +
    `rx="1" fill="${muted}" opacity="0.25"/>` +
    `<rect x="${barX}" y="${y - BAR_HEIGHT}" width="${round(filled)}" height="${BAR_HEIGHT}" ` +
    `rx="1" fill="${color}"/>` +
    `<text x="${round(percentX)}" y="${y}" font-size="${LANGS_FONT_SIZE}" fill="${text}">${percent}</text>`
  )
}

const round = (n: number) => Math.round(n * 100) / 100
