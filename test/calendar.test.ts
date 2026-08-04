/**
 * The window the heatmap draws.
 *
 * Reported as a missing column: GitHub showed ten columns in the closing
 * stretch and the card showed nine. The column count was never the thing —
 * the array is a constant 371 days and the grid has drawn 53 columns since it
 * shipped. Two other things were true, and these hold both of them.
 *
 * The grids are not comparable column by column. GitHub aligns to weeks and
 * closes on a partial one; this closes on today and counts back in sevens, so
 * the boundaries differ and any count taken between two landmarks differs with
 * them.
 *
 * And the window ended on the streak's reference day, which is Anywhere on
 * Earth — up to twelve hours behind UTC. For half of every day the last square
 * was a day that had already been fetched and stored, and then trimmed off the
 * end of the array on the way into the entry, while GitHub was drawing it.
 */

import { describe, expect, it } from 'vitest'
import { CALENDAR_SPAN, compactCalendar } from '../src/github/contributions'
import { renderCard } from '../src/render/cards'
import { addDays, type ContributionDay } from '../src/streak'
import { paramsFixture, statsFixture } from './helpers/fixtures'

const PITCH = 9
const WEEKS = 53
const DAYS = 7

/** Consecutive days ending on `last`, every one of them active. */
function busyThrough(last: string, span: number): ContributionDay[] {
  const first = addDays(last, -(span - 1))
  return Array.from({ length: span }, (_, index) => ({
    date: addDays(first, index),
    count: 1 + (index % 5),
  }))
}

/** Columns the rendered grid actually puts a cell in. */
function drawnColumns(svg: string): number[] {
  const xs = [...svg.matchAll(/<use href="#[a-g]" x="(\d+)"\/>/g)].map(
    (match) => Number(match[1]) / PITCH,
  )
  return [...new Set(xs)].sort((a, b) => a - b)
}

const heatmapOf = (calendar: { from: string; counts: number[] }) =>
  renderCard(statsFixture({ calendar }), paramsFixture('username=x&card=heatmap&animate=false'))

describe('the compacted calendar', () => {
  it('is exactly 53 columns of 7, whatever the API returned', () => {
    expect(CALENDAR_SPAN).toBe(WEEKS * DAYS)

    // A short history, a year, and more than a year: the span is a constant.
    for (const span of [3, 200, CALENDAR_SPAN, CALENDAR_SPAN + 90]) {
      const calendar = compactCalendar(busyThrough('2026-08-04', span), '2026-08-04')
      expect(calendar.counts, `span ${span}`).toHaveLength(CALENDAR_SPAN)
    }
  })

  /**
   * GitHub returns the current week as a partial one — three days of seven on
   * the day this was checked — and every one of those days is in the window.
   */
  it('keeps the days of the week in progress, including today', () => {
    const days = busyThrough('2026-08-04', 400)
    const calendar = compactCalendar(days, '2026-08-04')

    expect(addDays(calendar.from, CALENDAR_SPAN - 1)).toBe('2026-08-04')
    expect(calendar.counts.at(-1)).toBe(days.at(-1)?.count)
    // Sunday the 2nd, Monday the 3rd, Tuesday the 4th — the partial week.
    expect(calendar.counts.slice(-3)).toEqual(days.slice(-3).map((day) => day.count))
  })

  it('ends on the day it is given and never reaches past it', () => {
    const calendar = compactCalendar(busyThrough('2026-08-10', 400), '2026-08-04')

    expect(addDays(calendar.from, CALENDAR_SPAN - 1)).toBe('2026-08-04')
    // The six days after it were fetched and are deliberately not in the window:
    // a grid of what happened has no business holding a square for tomorrow.
    expect(calendar.counts).toHaveLength(CALENDAR_SPAN)
  })

  it('fills a day the API never reported with a zero rather than a gap', () => {
    const sparse: ContributionDay[] = [
      { date: '2026-08-01', count: 4 },
      { date: '2026-08-04', count: 7 },
    ]
    const calendar = compactCalendar(sparse, '2026-08-04')

    expect(calendar.counts).toHaveLength(CALENDAR_SPAN)
    expect(calendar.counts.at(-1)).toBe(7)
    expect(calendar.counts.at(-4)).toBe(4)
    expect(calendar.counts.at(-2)).toBe(0)
  })
})

describe('the heatmap grid', () => {
  it('draws 53 columns, the last of them ending on today', () => {
    const svg = heatmapOf(compactCalendar(busyThrough('2026-08-04', 400), '2026-08-04'))
    const columns = drawnColumns(svg)

    // Every day is active in this fixture, so every column is drawn.
    expect(columns).toHaveLength(WEEKS)
    expect(columns[0]).toBe(0)
    expect(columns.at(-1)).toBe(WEEKS - 1)

    // The plate underneath is the same 53 wide, so an undrawn column would
    // still be a column rather than a short grid.
    const plate = /<rect width="(\d+)" height="\d+" fill="url\(#empty\)"\/>/.exec(svg)?.[1]
    expect(Number(plate)).toBe(WEEKS * PITCH - (PITCH - 7))
  })

  /**
   * Today is the last cell of the last column — bottom right — because the
   * window ends on it. That is the cell the report was about.
   */
  it('puts today in the last column', () => {
    const calendar = compactCalendar(
      // Only today is active, so whatever is drawn is today and nothing else.
      [{ date: '2026-08-04', count: 9 }],
      '2026-08-04',
    )
    const svg = heatmapOf(calendar)
    const cells = [...svg.matchAll(/<use href="#([a-g])" x="(\d+)"\/>/g)]

    expect(cells).toHaveLength(1)
    expect(Number(cells[0]?.[2]) / PITCH).toBe(WEEKS - 1)
    // Last row of that column: the calendar's final index is 370, and 370 % 7
    // is 6, which is the seventh symbol.
    expect(cells[0]?.[1]).toBe('g')
  })

  it('draws no cell beyond the last column', () => {
    const svg = heatmapOf(compactCalendar(busyThrough('2026-08-04', 400), '2026-08-04'))

    for (const column of drawnColumns(svg)) {
      expect(column).toBeLessThan(WEEKS)
    }
  })
})
