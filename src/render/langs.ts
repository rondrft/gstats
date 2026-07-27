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
import { LANGS_FONT_SIZE, type LangsContent, type LangsPlacement, langsTextWidth } from './layout'
import { escapeXml } from './xml'

/** Widest bar, in cells. Six reads as a bar without crowding the percentage. */
const MAX_BLOCKS = 6

const BLOCK = '█'

/** Width of the name column, in characters. */
const NAME_WIDTH = 5

/**
 * Cells in one row: the name column, the bar, the percentage, and a space
 * between each. Every row is this wide by construction, which is what makes the
 * columns line up and what lets the block be measured without rendering it.
 */
const ROW_CELLS = NAME_WIDTH + 1 + MAX_BLOCKS + 1 + 4

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

/**
 * Rows and width the block will occupy, without building any markup.
 *
 * The layout has to know how much room to reserve before it can decide where
 * the block goes, so measurement is separated from rendering. Both variants are
 * the same width: the `bars` columns are placed on the same cell grid the
 * `blocks` characters sit on.
 */
export { barFraction }

export function measureLangs(languages: readonly LanguageStat[], emptyLabel: string): LangsContent {
  if (languages.length === 0) {
    return { lineCount: 1, width: langsTextWidth(emptyLabel) }
  }
  return { lineCount: languages.length, width: langsTextWidth(' '.repeat(ROW_CELLS)) }
}

interface LangsOptions {
  languages: readonly LanguageStat[]
  /** Where the layout decided the block goes. */
  placement: LangsPlacement
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
  placement,
  text,
  muted,
  fallbackColor,
  style,
  emptyLabel,
}: LangsOptions): string {
  const { x, firstBaseline, lineHeight } = placement

  if (languages.length === 0) {
    return (
      `<text x="${round(x)}" y="${round(firstBaseline)}" font-size="${LANGS_FONT_SIZE}" ` +
      `fill="${muted}">${escapeXml(emptyLabel)}</text>`
    )
  }

  // The list arrives sorted, but taking the maximum is what makes the bars
  // correct rather than what makes them happen to be correct.
  const leader = Math.max(...languages.map((language) => language.pct))

  return languages
    .map((language, index) => {
      const y = round(firstBaseline + index * lineHeight)
      return style === 'bars'
        ? barLine(language, x, y, leader, text, muted, fallbackColor)
        : blockLine(language, x, y, leader, text)
    })
    .join('')
}

/** `ts    ██████  41%` — one text node, alignment courtesy of the font. */
function blockLine(
  language: LanguageStat,
  x: number,
  y: number,
  leader: number,
  text: string,
): string {
  const name = abbreviate(language.name).slice(0, NAME_WIDTH).padEnd(NAME_WIDTH)
  const bar = BLOCK.repeat(blockCount(language.pct, leader)).padEnd(MAX_BLOCKS)
  const percent = `${Math.round(language.pct * 100)}`.padStart(3)
  const line = `${name} ${bar} ${percent}%`
  return (
    `<text x="${round(x)}" y="${y}" font-size="${LANGS_FONT_SIZE}" fill="${text}" ` +
    `xml:space="preserve">${escapeXml(line)}</text>`
  )
}

/**
 * Bar length, as a share of the *leading* language rather than of the whole.
 *
 * Scaling against 100% wastes almost all the resolution. Six cells over the full
 * range makes one cell worth 17 percentage points, and a normal breakdown —
 * 41/25/17/10 — collapses to 2, 2, 1, 1: the bars all look the same and carry no
 * information the percentages beside them do not already give.
 *
 * Against the leader, the same breakdown reads 6, 4, 2, 1. The trade is that a
 * bar is no longer comparable between two cards, only within one. That is the
 * comparison a reader actually makes, and the percentage is right there for the
 * other one.
 */
function barFraction(pct: number, leader: number): number {
  return leader <= 0 ? 0 : Math.min(1, pct / leader)
}

/** A language that made the list gets at least one cell, however small it is. */
function blockCount(pct: number, leader: number): number {
  return Math.max(1, Math.min(MAX_BLOCKS, Math.round(barFraction(pct, leader) * MAX_BLOCKS)))
}

/**
 * One character cell, in user units. The `bars` variant places its columns on
 * the same grid the `blocks` characters land on, so the two styles occupy
 * identical space and the layout can measure either one the same way.
 */
const CELL = langsTextWidth(' ')

const BAR_WIDTH = MAX_BLOCKS * CELL
const BAR_HEIGHT = 7

function barLine(
  language: LanguageStat,
  x: number,
  y: number,
  leader: number,
  text: string,
  muted: string,
  fallbackColor: string,
): string {
  const name = abbreviate(language.name).slice(0, NAME_WIDTH)
  const barX = x + (NAME_WIDTH + 1) * CELL
  const filled = Math.max(1, Math.round(barFraction(language.pct, leader) * BAR_WIDTH))
  const color = language.color ?? fallbackColor
  const percent = `${Math.round(language.pct * 100)}%`
  const percentX = barX + BAR_WIDTH + CELL

  return (
    `<text x="${round(x)}" y="${y}" font-size="${LANGS_FONT_SIZE}" fill="${text}">${escapeXml(name)}</text>` +
    `<rect x="${round(barX)}" y="${round(y - BAR_HEIGHT)}" width="${round(BAR_WIDTH)}" ` +
    `height="${BAR_HEIGHT}" rx="1" fill="${muted}" opacity="0.25"/>` +
    `<rect x="${round(barX)}" y="${round(y - BAR_HEIGHT)}" width="${round(filled)}" ` +
    `height="${BAR_HEIGHT}" rx="1" fill="${color}"/>` +
    `<text x="${round(percentX)}" y="${y}" font-size="${LANGS_FONT_SIZE}" fill="${text}">${percent}</text>`
  )
}

const round = (n: number) => Math.round(n * 100) / 100
