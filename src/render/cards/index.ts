/**
 * Design lookup.
 *
 * The contract governing what may change about a published design lives in
 * `./registry.ts`. This file only wires the implementations to their ids.
 */

import type { StatsData } from '../../github/types'
import { resolveLocale } from '../../i18n'
import type { CardParams } from '../../params'
import { gauge } from './gauge'
import { heatmap } from './heatmap'
import { pass } from './pass'
import { press } from './press'
import { type CardId, type CardRenderer, DEFAULT_CARD } from './registry'
import { terminal } from './terminal'
import { vinyl } from './vinyl'

const CARDS: Record<CardId, CardRenderer> = {
  terminal,
  heatmap,
  pass,
  press,
  gauge,
  vinyl,
}

/**
 * Resolves a design id. An unknown value falls back to the default rather than
 * failing: a typo in a README should degrade to a working card, never to the
 * browser's broken-image glyph.
 */
export function resolveRenderer(id: string): CardRenderer {
  return CARDS[id as CardId] ?? CARDS[DEFAULT_CARD]
}

/** Renders the card the parameters asked for. */
export function renderCard(data: StatsData, params: CardParams): string {
  return resolveRenderer(params.style.card).render(data, {
    params,
    strings: resolveLocale(params.style.locale),
  })
}

export type { CardRenderer, RenderOptions } from './registry'
export { CARD_IDS, DEFAULT_CARD } from './registry'
