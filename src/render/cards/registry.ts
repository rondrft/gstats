/**
 * Design registry.
 *
 * ---------------------------------------------------------------------------
 * CONTRACT. Read this before changing anything in `src/render/cards/`.
 *
 * The moment somebody pastes a card URL into their README, that URL is a public
 * promise. They will not revisit it. It has to keep producing what they chose,
 * on a page they are not watching, for as long as the service exists.
 *
 *   1. THE DEFAULT IS FROZEN. `card=terminal` with no other parameters must
 *      look the same in two years as it does today. It is what every URL
 *      written before `?card=` existed resolves to.
 *
 *   2. REDESIGNS SHIP AS NEW IDS. If `press` should look different, the new
 *      look is `press-v2`. Never mutate a published design into another one —
 *      that silently rewrites what somebody already published.
 *
 *   3. A PUBLISHED DESIGN IS NEVER REMOVED, however much it is later regretted.
 *      Deleting one turns every README carrying it into a broken image, and the
 *      people affected are exactly the ones who liked it enough to use it.
 *
 *   4. EVERY DESIGN HONOURS `theme`. A design that ignores the reader's colours
 *      is broken, not opinionated. The same goes for `hide`, `locale` and
 *      `animate=false`.
 *
 * An unknown `card=` resolves to the default in silence. It never errors: a
 * typo in a README should degrade to a working card, not a broken image.
 * ---------------------------------------------------------------------------
 */

import type { CardData } from '../../github/types'
import type { Strings } from '../../i18n'
import type { CardParams } from '../../params'

export interface RenderOptions {
  params: CardParams
  /** Copy for the resolved locale, so a design never reaches for it itself. */
  strings: Strings
}

export interface CardRenderer {
  /** Stable public identifier. Once shipped, it exists forever. */
  id: string
  render(data: CardData, options: RenderOptions): string
}

/**
 * Populated by `./index.ts`, which owns the imports.
 *
 * The registry is split from its contents so that `params.ts` can validate a
 * `card=` value without pulling every design — and every design's dependencies
 * — into the module graph of the query parser.
 */
export const CARD_IDS = ['terminal', 'heatmap', 'pass', 'press', 'gauge', 'vinyl'] as const

export type CardId = (typeof CARD_IDS)[number]

export const DEFAULT_CARD: CardId = 'terminal'

/**
 * The most languages each design draws, whatever `langs_count` asks for.
 *
 * Three of the six stop short of eight because their shape does: the vinyl
 * lists languages as tracks on side B of a record that already carries the
 * stats on side A, and the press and gauge panels are one column standing
 * beside their columns rather than a list with room to grow.
 *
 * Those ceilings existed already, as a `slice(0, 3)` and two `slice(0, 4)`
 * inside the designs — which meant nothing outside them could know. The
 * generator offered eight, the parameter table advertised eight, and somebody
 * who asked for six on `card=vinyl` was given three with nothing anywhere to
 * say why. **That is the whole reason this is a declaration and not three
 * literals**: `params.ts` and the landing page both have to know the number,
 * and neither can import a design — which is also why it lives here beside the
 * ids rather than on `CardRenderer`.
 *
 * A ceiling is part of what a published card looks like, so raising one is a
 * redesign under rule 2 and ships as a new id. The numbers below are what these
 * designs have always drawn.
 *
 * `heatmap` is zero because it draws a calendar and no language block at all.
 */
export const MAX_LANGUAGES: Record<CardId, number> = {
  terminal: 8,
  heatmap: 0,
  pass: 8,
  press: 4,
  gauge: 4,
  vinyl: 3,
}

/**
 * The largest ceiling any design has, and therefore the most `langs_count` can
 * usefully ask for. Derived rather than written down twice.
 */
export const LANGS_CEILING = Math.max(...Object.values(MAX_LANGUAGES))

/** Resolves any string to a published id, falling back to the default. */
export function resolveCardId(id: string): CardId {
  return (CARD_IDS as readonly string[]).includes(id) ? (id as CardId) : DEFAULT_CARD
}
