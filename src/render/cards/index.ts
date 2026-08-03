/**
 * Design lookup.
 *
 * The contract governing what may change about a published design lives in
 * `./registry.ts`. This file only wires the implementations to their ids.
 */

import type { CardData, StatsData } from '../../github/types'
import { resolveLocale } from '../../i18n'
import { rankAllLanguages } from '../../languages'
import type { CardParams } from '../../params'
import { gauge } from './gauge'
import { heatmap } from './heatmap'
import { pass } from './pass'
import { press } from './press'
import { type CardId, type CardRenderer, MAX_LANGUAGES, resolveCardId } from './registry'
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
  return CARDS[resolveCardId(id)]
}

/**
 * How the request for languages was answered, for the response headers.
 *
 * `/api` cannot say any of this on the card — a design is frozen once published
 * and the document has 12 KB to fit in — and it must not say it with a status,
 * since the reader gets a broken image. A header rides on a request that is
 * happening anyway, costs nothing, and is where somebody debugging their own
 * card can find the one number the URL cannot tell them: how many languages the
 * profile actually has to give.
 */
export interface LanguageCount {
  /** Qualified after every filter, before any count was applied. */
  available: number
  /** Drawn on the card. */
  shown: number
  /** The most this design draws, whatever was asked for. */
  ceiling: number
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
  return renderCardWithLanguages(data, params).svg
}

/**
 * The same render, with what became of `langs_count` alongside it.
 *
 * The count is applied here rather than inside the designs. Three of them used
 * to hold their own `slice`, so the number a design would draw was knowable
 * only by drawing it — see `MAX_LANGUAGES` in `./registry.ts` for what that
 * cost.
 */
export function renderCardWithLanguages(
  data: StatsData,
  params: CardParams,
): { svg: string; languages: LanguageCount } {
  const id = resolveCardId(params.style.card)
  const ceiling = MAX_LANGUAGES[id]

  const available = rankAllLanguages(data.repos, {
    mode: params.langMode,
    exclude: params.excludeLangs,
    include: params.includeLangs,
  })

  const languages = available.slice(0, Math.min(params.langsCount, ceiling))
  const view: CardData = { ...data, languages }

  return {
    svg: CARDS[id].render(view, { params, strings: resolveLocale(params.style.locale) }),
    languages: { available: available.length, shown: languages.length, ceiling },
  }
}

export type { CardRenderer, RenderOptions } from './registry'
export { CARD_IDS, DEFAULT_CARD, MAX_LANGUAGES } from './registry'
