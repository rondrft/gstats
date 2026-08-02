import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_DAILY_WRITE_BUDGET,
  forgetWriteTally,
  readWriteBudget,
  recordWrite,
} from '../src/budget'
import { KvStatsCache } from '../src/cache'
import worker, { type Env } from '../src/index'
import { statsFixture } from './helpers/fixtures'

const testEnv = env as unknown as Env
const kv = testEnv.STATS_CACHE

/**
 * KV is shared across a file, and the record is keyed by UTC day — so each test
 * takes a day of its own rather than inheriting the one before it.
 */
let days = 0
function nextDay(): number {
  days += 1
  return Date.parse('2026-07-27T09:00:00Z') + days * 86_400_000
}

beforeEach(() => {
  forgetWriteTally()
})

/**
 * The counter exists because running out of KV writes is the failure that
 * cascades — nothing gets cached, so every request is a miss, so the GitHub
 * quota that had several times the headroom drains in minutes. Before this
 * there was no way to see it coming.
 */
describe('the day’s write count', () => {
  it('starts at nothing', async () => {
    const budget = await readWriteBudget(kv, DEFAULT_DAILY_WRITE_BUDGET, nextDay())

    expect(budget.used).toBe(0)
    expect(budget.limit).toBe(1000)
    expect(budget.percent).toBe(0)
    expect(budget.warning).toBe(false)
  })

  /**
   * The whole design constraint: a counter that wrote to KV on every write it
   * counted would double the quantity it exists to protect.
   */
  it('accumulates in the isolate without touching KV', async () => {
    const day = nextDay()
    for (let write = 0; write < 10; write += 1) await recordWrite(kv, day)

    expect((await readWriteBudget(kv, DEFAULT_DAILY_WRITE_BUDGET, day)).used).toBe(10)
    // Nothing has been flushed yet, so a cold isolate would still see zero.
    forgetWriteTally()
    expect((await readWriteBudget(kv, DEFAULT_DAILY_WRITE_BUDGET, day)).used).toBe(0)
  })

  /** And the flush is itself a write, which it has no excuse not to count. */
  it('flushes once enough have accumulated, counting the flush', async () => {
    const day = nextDay()
    for (let write = 0; write < 25; write += 1) await recordWrite(kv, day)

    forgetWriteTally()
    expect((await readWriteBudget(kv, DEFAULT_DAILY_WRITE_BUDGET, day)).used).toBe(26)
  })

  it('adds what the isolate is still holding to what has been flushed', async () => {
    const day = nextDay()
    for (let write = 0; write < 30; write += 1) await recordWrite(kv, day)

    // 26 flushed, 5 pending.
    expect((await readWriteBudget(kv, DEFAULT_DAILY_WRITE_BUDGET, day)).used).toBe(31)
  })

  it('keeps a separate figure for each UTC day', async () => {
    const day = nextDay()
    for (let write = 0; write < 25; write += 1) await recordWrite(kv, day)

    expect((await readWriteBudget(kv, DEFAULT_DAILY_WRITE_BUDGET, day + 86_400_000)).used).toBe(0)
  })

  /**
   * Midnight used to be a reset rather than a flush, which quietly dropped up
   * to twenty-four writes per isolate at every UTC boundary. This is the figure
   * the 80% warning is read off, so undercounting it delays the alert in the one
   * case it exists for.
   */
  it('flushes what it is holding when the day turns over', async () => {
    const day = nextDay()
    for (let write = 0; write < 5; write += 1) await recordWrite(kv, day)

    // The write that crosses the boundary closes the old day on its way past.
    await recordWrite(kv, day + 86_400_000)

    forgetWriteTally()
    // Five carried over, plus the flush that carried them.
    expect((await readWriteBudget(kv, DEFAULT_DAILY_WRITE_BUDGET, day)).used).toBe(6)
  })

  it('does not spend a write closing a day it holds nothing for', async () => {
    const day = nextDay()
    // Lands exactly on a flush, so the isolate carries nothing into midnight.
    for (let write = 0; write < 25; write += 1) await recordWrite(kv, day)
    await recordWrite(kv, day + 86_400_000)

    forgetWriteTally()
    // 26 and not 27: crossing the boundary with an empty tally is not an event.
    expect((await readWriteBudget(kv, DEFAULT_DAILY_WRITE_BUDGET, day)).used).toBe(26)
  })

  it('reports the percentage consumed', async () => {
    const day = nextDay()
    for (let write = 0; write < 100; write += 1) await recordWrite(kv, day)

    const budget = await readWriteBudget(kv, DEFAULT_DAILY_WRITE_BUDGET, day)
    expect(budget.percent).toBe(Math.round((budget.used / 1000) * 100))
    expect(budget.warning).toBe(false)
  })

  it('warns once four fifths of the allowance is gone', async () => {
    const day = nextDay()
    for (let write = 0; write < 81; write += 1) await recordWrite(kv, day)

    // A hundred-write allowance reaches the same state a thousand-write one
    // does at 800, without spending eight hundred writes to prove it.
    const budget = await readWriteBudget(kv, 100, day)
    expect(budget.warning).toBe(true)
    expect(budget.percent).toBeGreaterThanOrEqual(80)
  })
})

describe('what gets counted', () => {
  it('counts a cache write', async () => {
    const cache = new KvStatsCache(kv)
    const before = (await readWriteBudget(kv, DEFAULT_DAILY_WRITE_BUDGET)).used

    await cache.write('budget-probe', { data: statsFixture(), freshUntil: Date.now() + 1000 })

    expect((await readWriteBudget(kv, DEFAULT_DAILY_WRITE_BUDGET)).used).toBe(before + 1)
  })

  /**
   * Cloudflare bills deletes against their own daily allowance, so folding them
   * in here would misreport the one figure this is about.
   */
  it('does not count deletes against the write allowance', async () => {
    const cache = new KvStatsCache(kv)
    await cache.write('delete-probe:one', { data: statsFixture(), freshUntil: Date.now() + 1000 })

    const before = (await readWriteBudget(kv, DEFAULT_DAILY_WRITE_BUDGET)).used
    await cache.purge('delete-probe:')

    expect((await readWriteBudget(kv, DEFAULT_DAILY_WRITE_BUDGET)).used).toBe(before)
  })
})

describe('/health reports it', () => {
  const health = () =>
    worker.fetch(new Request('https://stats.example.com/health'), testEnv) as Promise<Response>

  it('carries the figure and stays ok below the line', async () => {
    const body = (await (await health()).json()) as {
      status: string
      writes: { used: number; limit: number; percent: number }
    }

    expect(body.status).toBe('ok')
    expect(body.writes.limit).toBe(1000)
    expect(typeof body.writes.used).toBe('number')
    expect(typeof body.writes.percent).toBe('number')
  })

  it('turns to warning once the allowance is four fifths gone', async () => {
    for (let write = 0; write < 5; write += 1) await recordWrite(kv)

    // Measure today's real figure against an allowance it has already spent,
    // rather than spending eight hundred writes to reach a thousand-write one.
    const used = (await readWriteBudget(kv, DEFAULT_DAILY_WRITE_BUDGET)).used
    const tight = { ...testEnv, KV_WRITE_BUDGET: String(used) }

    const response = await worker.fetch(new Request('https://stats.example.com/health'), tight)
    const body = (await response.json()) as { status: string; writes: { percent: number } }

    expect(body.writes.percent).toBeGreaterThanOrEqual(80)
    expect(body.status).toBe('warning')
  })

  it('measures against a paid allowance when told to', async () => {
    const paid = { ...testEnv, KV_WRITE_BUDGET: '1000000' }

    const response = await worker.fetch(new Request('https://stats.example.com/health'), paid)
    const body = (await response.json()) as { status: string; writes: { limit: number } }

    expect(body.writes.limit).toBe(1_000_000)
    expect(body.status).toBe('ok')
  })
})
