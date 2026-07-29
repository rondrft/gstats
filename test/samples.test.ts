/**
 * The six sample cards in the README, and the check that they are current.
 *
 * `docs/assets/*.svg` is rendered output committed as files. Nothing regenerated
 * it, so it drifted: `pass.svg` sat three commits behind the renderer, showing a
 * perforation notch painted on the accent band and a stub cramped against the
 * card edge — **both fixed in the code, both still on the front page**, which is
 * where an external report of two closed defects came from. The samples are the
 * most-read output this service has, and they were the only output nothing
 * checked.
 *
 * So they are snapshots with filenames. `pnpm test` compares each one against
 * what the renderer produces now and fails on any difference; `pnpm samples`
 * writes them back. A design change that does not refresh them cannot reach
 * `main`, and adding a seventh design fails here until it has a sample.
 *
 * **Why this is rendered from a fixture and not fetched from the deployed
 * instance.** Fetching the live cards is the obvious way to get samples that are
 * true today, and it cannot be an assertion: everything on them moves. The
 * figures move daily, `press` prints the date it was drawn, and the heatmap emits
 * one element per active day — so a byte comparison against production would
 * fail every morning for reasons that have nothing to do with this repository,
 * and a team learns to re-run a job like that without reading it. Worse, it would
 * be *green* on the failure it exists to catch: a stale committed asset and a
 * stale deploy agree with each other, which is the same trap `/health` has to
 * compare against the commit rather than against the other Worker.
 *
 * The profile below is a real snapshot of the instance, taken by hand and frozen.
 * That keeps the figures plausible and the six mutually consistent — the thing a
 * gallery has to be — while the assertion stays about the only question a test
 * can honestly ask: does the committed file match what this code draws?
 */

import { describe, expect, it } from 'vitest'
import { renderCard } from '../src/render/cards'
import { CARD_IDS } from '../src/render/cards/registry'
import { calendarFixture, paramsFixture, statsFixture } from './helpers/fixtures'

/**
 * The profile the samples are drawn from, read off the live cards on 2026-07-29.
 *
 * Two figures are chosen rather than captured, because no card prints them: the
 * calendar, which is the suite's seeded synthetic year, and the year totals the
 * `gauge` needles measure. Both are illustrative on a sample card and neither can
 * be recovered from the rendered output.
 */
const SAMPLE = statsFixture({
  login: 'rondrft',
  name: 'Martin Aguirre',
  createdAt: '2023-04-11',
  totalContributions: 2202,
  yearContributions: 1204,
  bestYearContributions: 1610,
  calendar: calendarFixture(),
  streaks: {
    current: { length: 41, start: '2026-06-18', end: '2026-07-28' },
    longest: { length: 41, start: '2026-06-18', end: '2026-07-28' },
  },
  // The day the snapshot was taken, which `press` prints. The suite's own fixed
  // clock is three days earlier, and a card dated before the end of the streak it
  // shows is the sort of detail that makes a sample look made up.
  fetchedAt: Date.parse('2026-07-29T12:00:00Z'),
  // Sums to one, so the printed shares are 41, 30 and 28 per cent.
  languages: [
    { name: 'Java', color: '#b07219', size: 0, pct: 0.414 },
    { name: 'Kotlin', color: '#A97BFF', size: 0, pct: 0.302 },
    { name: 'TypeScript', color: '#3178c6', size: 0, pct: 0.284 },
  ],
})

/**
 * What each sample is drawn with, which has to stay in step with the snippet the
 * README prints beside it — the README shows a card and then tells the reader the
 * URL that produced it, and those two disagreeing is its own kind of stale.
 *
 * Every one of them is a different theme on purpose: the README's point there is
 * that the design and the palette are independent axes.
 */
const SAMPLE_QUERIES: Record<string, string> = {
  terminal: '',
  heatmap: 'theme=ice',
  press: 'theme=light',
  gauge: 'theme=mono',
  vinyl: 'theme=amber',
  pass: 'bg=F4EDE1&accent=C1432B&text=2B2118&muted=7A6A57&border=D6C6AC',
}

describe.each(CARD_IDS)('%s sample', (card) => {
  it('is what docs/assets holds', async () => {
    const query = SAMPLE_QUERIES[card]
    expect(
      query,
      `card=${card} is published but has no sample; add one to SAMPLE_QUERIES and to the README`,
    ).toBeDefined()

    const svg = renderCard(
      SAMPLE,
      paramsFixture(
        `username=${SAMPLE.login}&card=${card}${query === undefined || query === '' ? '' : `&${query}`}`,
      ),
    )

    await expect(
      svg,
      `docs/assets/${card}.svg is not what the renderer draws any more — run \`pnpm samples\``,
    ).toMatchFileSnapshot(`../docs/assets/${card}.svg`)
  })
})
