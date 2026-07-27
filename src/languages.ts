/**
 * Language ranking.
 *
 * Pure and I/O free: it takes the repositories the GitHub layer fetched and
 * returns the list the card draws. Everything about *what the list means* lives
 * here, and none of it is obvious, so the reasoning is written down.
 *
 * Summing bytes per language across an account measures how much code exists,
 * which is not what a reader thinks they are looking at. A single generated
 * stylesheet, a vendored dependency or a committed bundle outweighs a year of
 * deliberate work, and one large abandoned repository outvotes ten small live
 * ones. Three corrections turn size into something closer to practice:
 *
 *   1. A per-repository cap, so no single project decides the whole card.
 *   2. A recency weight, so a language dropped two years ago stops leading.
 *   3. A default exclusion list, for languages that are usually a by-product of
 *      the work rather than the work.
 *
 * None of this is a measurement of skill or effort, and it cannot be. It is a
 * heuristic tuned to be wrong less often than raw byte counts are.
 */

import type { LanguageStat } from './github/types'

/**
 * Largest share of the ranking any one repository may contribute.
 *
 * Bounds influence rather than truth: a monorepo still counts more than a
 * scratch project, it just cannot decide the card by itself.
 */
export const REPO_CAP = 0.15

/** Contributions below this share are noise and are dropped before ranking. */
export const MIN_SHARE = 0.005

const DAY_MS = 86_400_000

/**
 * Recency weighting by last push. The steps are coarse on purpose — the signal
 * being approximated ("do they still write this?") does not support anything
 * finer, and a smooth curve would only make the arbitrariness harder to see.
 */
const RECENT_DAYS = 183
const RECENT_WEIGHT = 1
const LAPSED_DAYS = 365
const LAPSED_WEIGHT = 0.5
const STALE_WEIGHT = 0.25

/**
 * Languages excluded unless the caller asks for them back.
 *
 * Each of these is normally generated, configuration, or markup that came with
 * a framework — present in the byte count, absent from the work. Excluding by
 * default and re-admitting on request produces the right list for most people;
 * defaulting the other way makes everyone else edit their URL.
 *
 * Names match GitHub's Linguist exactly, compared case-insensitively.
 */
export const DEFAULT_EXCLUDED = [
  'html',
  'css',
  'scss',
  'dockerfile',
  'makefile',
  'shell',
  'batchfile',
  'roff',
  'tex',
  'jupyter notebook',
] as const

export type LangMode = 'bytes' | 'repos'

/** One repository, reduced to what the ranking needs. */
export interface RepoLanguages {
  name: string
  /** ISO timestamp of the last push, used for the recency weight. */
  pushedAt: string | null
  /** Linguist's own choice of primary language, used by `repos` mode. */
  primaryLanguage: string | null
  edges: { name: string; color: string | null; size: number }[]
}

export interface RankOptions {
  mode: LangMode
  /** How many entries to return. */
  limit: number
  /** Lowercased names the caller wants removed, on top of the defaults. */
  exclude: readonly string[]
  /** Lowercased names the caller wants re-admitted from the defaults. */
  include: readonly string[]
  /** Reference time for the recency weight, in epoch milliseconds. */
  now: number
}

/**
 * Weight for a repository's contribution, by how recently it was pushed to.
 * A repository with no push date is treated as stale rather than dropped.
 */
export function recencyWeight(pushedAt: string | null, now: number): number {
  if (pushedAt === null) return STALE_WEIGHT
  const pushed = Date.parse(pushedAt)
  if (Number.isNaN(pushed)) return STALE_WEIGHT

  const ageDays = (now - pushed) / DAY_MS
  if (ageDays <= RECENT_DAYS) return RECENT_WEIGHT
  if (ageDays <= LAPSED_DAYS) return LAPSED_WEIGHT
  return STALE_WEIGHT
}

/** The set of languages to drop, after the caller's additions and rescues. */
function excludedSet(options: RankOptions): Set<string> {
  const excluded = new Set<string>(DEFAULT_EXCLUDED)
  for (const name of options.include) excluded.delete(name.toLowerCase())
  for (const name of options.exclude) excluded.add(name.toLowerCase())
  return excluded
}

export function rankLanguages(
  repos: readonly RepoLanguages[],
  options: RankOptions,
): LanguageStat[] {
  const excluded = excludedSet(options)
  const colors = new Map<string, string | null>()
  for (const repo of repos) {
    for (const edge of repo.edges) {
      if (!colors.has(edge.name)) colors.set(edge.name, edge.color)
    }
  }

  const totals =
    options.mode === 'repos'
      ? countByRepo(repos, excluded, options)
      : sumBytes(repos, excluded, options)

  const grandTotal = [...totals.values()].reduce((sum, value) => sum + value, 0)
  if (grandTotal === 0) return []

  return [...totals.entries()]
    .map(([name, value]) => ({
      name,
      color: colors.get(name) ?? null,
      size: value,
      pct: value / grandTotal,
    }))
    .filter((language) => language.pct >= MIN_SHARE)
    .sort((a, b) => b.size - a.size || a.name.localeCompare(b.name))
    .slice(0, options.limit)
}

/**
 * Caps every value at `REPO_CAP` of the *capped* total.
 *
 * The naive version — cap against the uncapped total, then renormalise — does
 * not work, and it is worth saying why, because it looks like it should. A
 * repository holding 95% of an account is cut to 15% of the original total, but
 * everything else was tiny, so after renormalising it is back above 70%. The
 * ceiling has to be a fixed point of the total it is a fraction of, which is
 * what this loop finds. It converges downwards and quickly; the iteration bound
 * is a backstop, not a working limit.
 *
 * The cap only engages when it could be satisfied by every repository at once.
 * Below `1 / REPO_CAP` repositories it is arithmetically impossible, and forcing
 * it would flatten the account to equal shares — turning a 9:1 split between two
 * projects into 1:1 and destroying exactly the signal the card is for. A cap is
 * meant to bound influence, not to erase differences.
 */
function capValues(values: readonly number[]): number[] {
  const contributing = values.filter((value) => value > 0).length
  if (contributing * REPO_CAP < 1) return [...values]

  let ceiling = Number.POSITIVE_INFINITY
  for (let pass = 0; pass < 40; pass += 1) {
    const capped = values.map((value) => Math.min(value, ceiling))
    const total = capped.reduce((sum, value) => sum + value, 0)
    const next = REPO_CAP * total
    if (Math.abs(next - ceiling) < total * 1e-9) break
    ceiling = next
  }

  return values.map((value) => Math.min(value, ceiling))
}

/**
 * `bytes` mode: recency-weighted byte counts, with no repository allowed to
 * dominate. See `capValues` for why the cap is iterative.
 */
function sumBytes(
  repos: readonly RepoLanguages[],
  excluded: Set<string>,
  options: RankOptions,
): Map<string, number> {
  // Per repository: the languages that survived exclusion, and their total.
  const perRepo = repos.map((repo) => {
    const kept = repo.edges.filter((edge) => !excluded.has(edge.name.toLowerCase()))
    const bytes = kept.reduce((sum, edge) => sum + edge.size, 0)
    return { kept, bytes, weight: recencyWeight(repo.pushedAt, options.now) }
  })

  const capped = capValues(perRepo.map((repo) => repo.bytes * repo.weight))
  const accountTotal = capped.reduce((sum, value) => sum + value, 0)
  if (accountTotal === 0) return new Map()

  const totals = new Map<string, number>()
  perRepo.forEach((repo, index) => {
    if (repo.bytes === 0) return
    // The repository's final share of the account, spread across its languages
    // in the proportions it actually holds them.
    const repoShare = (capped[index] ?? 0) / accountTotal
    for (const edge of repo.kept) {
      const contribution = repoShare * (edge.size / repo.bytes)
      totals.set(edge.name, (totals.get(edge.name) ?? 0) + contribution)
    }
  })

  return totals
}

/**
 * `repos` mode: how many repositories a language leads.
 *
 * Ignores size entirely, which is the point — it answers "what do they build
 * with" rather than "what is bulkiest". The recency weight still applies, since
 * the question is about current practice.
 *
 * When Linguist's primary language is one of the excluded ones — a site whose
 * bulk is HTML but whose work is TypeScript — the repository falls through to
 * its largest language that survived exclusion rather than being discarded.
 */
function countByRepo(
  repos: readonly RepoLanguages[],
  excluded: Set<string>,
  options: RankOptions,
): Map<string, number> {
  const totals = new Map<string, number>()

  for (const repo of repos) {
    const kept = [...repo.edges]
      .filter((edge) => !excluded.has(edge.name.toLowerCase()))
      .sort((a, b) => b.size - a.size)

    const primaryKept = kept.find((edge) => edge.name === repo.primaryLanguage)
    const leader = primaryKept ?? kept[0]
    if (leader === undefined) continue

    const weight = recencyWeight(repo.pushedAt, options.now)
    totals.set(leader.name, (totals.get(leader.name) ?? 0) + weight)
  }

  return totals
}
