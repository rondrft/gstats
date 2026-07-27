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

import type { StatsData } from '../../github/types'
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
  render(data: StatsData, options: RenderOptions): string
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
