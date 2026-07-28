/**
 * Design lookup.
 *
 * The contract governing what may change about a published design lives in
 * `./registry.ts`. This file only wires the implementations to their ids.
 */

import type { CardData, StatsData } from '../../github/types'
import { resolveLocale } from '../../i18n'
import { rankLanguages } from '../../languages'
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

/**
 * Renders the card the parameters asked for.
 *
 * The language ranking happens here rather than before the entry was stored,
 * which is the whole reason four parameters could leave the cache key. It is the
 * same move the theme made: the cache holds what was fetched, and everything
 * that only decides how it reads is applied on the way out.
 */
export function renderCard(data: StatsData, params: CardParams): string {
  const view: CardData = {
    ...data,
    languages: rankLanguages(data.repos, {
      mode: params.langMode,
      limit: params.langsCount,
      exclude: params.excludeLangs,
      include: params.includeLangs,
    }),
  }

  return resolveRenderer(params.style.card).render(view, {
    params,
    strings: resolveLocale(params.style.locale),
  })
}

export type { CardRenderer, RenderOptions } from './registry'
export { CARD_IDS, DEFAULT_CARD } from './registry'
