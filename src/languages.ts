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

/** One repository as the GitHub layer reports it. */
export interface RepoLanguages {
  /** ISO timestamp of the last push, used for the recency weight. */
  pushedAt: string | null
  /** Linguist's own choice of primary language, used by `repos` mode. */
  primaryLanguage: string | null
  edges: { name: string; color: string | null; size: number }[]
}

/**
 * The repositories as they are *stored*, which is what the ranking now reads.
 *
 * The cache holds this rather than a finished ranking, so that `lang_mode`,
 * `langs_count`, `exclude_langs` and `include_langs` can be answered from an
 * entry somebody else already paid for instead of each combination costing its
 * own fetch. That only works if the weight is not paid for in bulk, and the
 * obvious `RepoLanguages[]` is: at the 300-repository cap it serialises to about
 * 53 KB, most of it the same language name and the same Linguist colour written
 * out several thousand times.
 *
 * So names and colours are interned into `langs` and everything else refers to
 * them by index — the same trade `CompactCalendar` makes, for the same reason.
 * Measured on a real account at the cap: **53 KB to 7 KB**. Field names are
 * single letters because at three thousand edges they are a third of what is
 * left.
 */
export interface RepoSample {
  /** Language table. Every index below points into this. */
  langs: { name: string; color: string | null }[]
  repos: SampledRepo[]
}

export interface SampledRepo {
  /**
   * Recency weight, resolved when the sample was taken rather than stored as a
   * push date. It is a three-step bucket over months; an entry lives hours.
   */
  w: number
  /** Index of Linguist's primary language, or -1 when it reports none. */
  p: number
  /** `[language index, bytes]`, largest first. */
  e: [number, number][]
}

export interface RankOptions {
  mode: LangMode
  /** How many entries to return. */
  limit: number
  /** Lowercased names the caller wants removed, on top of the defaults. */
  exclude: readonly string[]
  /** Lowercased names the caller wants re-admitted from the defaults. */
  include: readonly string[]
}

/**
 * Compacts what was fetched into what gets stored, resolving the recency weight
 * against the moment of the fetch.
 */
export function sampleRepos(repos: readonly RepoLanguages[], now: number): RepoSample {
  const langs: { name: string; color: string | null }[] = []
  const index = new Map<string, number>()

  const intern = (name: string, color: string | null): number => {
    const seen = index.get(name)
    if (seen !== undefined) {
      // The first colour wins, but a later repository may know one where the
      // first did not — GitHub omits it per edge, not per language.
      const entry = langs[seen]
      if (entry !== undefined && entry.color === null) entry.color = color
      return seen
    }
    index.set(name, langs.length)
    langs.push({ name, color })
    return langs.length - 1
  }

  const sampled = repos.map((repo): SampledRepo => {
    // Edges first, so the primary language is usually already interned with
    // whatever colour its own edge carried.
    const e = repo.edges.map((edge): [number, number] => [intern(edge.name, edge.color), edge.size])
    return {
      w: recencyWeight(repo.pushedAt, now),
      p: repo.primaryLanguage === null ? -1 : intern(repo.primaryLanguage, null),
      e,
    }
  })

  return { langs, repos: sampled }
}

/** An empty sample, for the paths that never asked for languages. */
export const EMPTY_SAMPLE: RepoSample = { langs: [], repos: [] }

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

export function rankLanguages(sample: RepoSample, options: RankOptions): LanguageStat[] {
  const excluded = excludedSet(options)
  // Exclusion is decided once per language rather than once per edge: the same
  // few dozen names are referenced thousands of times.
  const kept = sample.langs.map((lang) => !excluded.has(lang.name.toLowerCase()))

  const totals =
    options.mode === 'repos' ? countByRepo(sample.repos, kept) : sumBytes(sample.repos, kept)

  const grandTotal = [...totals.values()].reduce((sum, value) => sum + value, 0)
  if (grandTotal === 0) return []

  return [...totals.entries()]
    .map(([language, value]) => ({
      name: sample.langs[language]?.name ?? '',
      color: sample.langs[language]?.color ?? null,
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
function sumBytes(repos: readonly SampledRepo[], kept: readonly boolean[]): Map<number, number> {
  // Per repository: the languages that survived exclusion, and their total.
  const perRepo = repos.map((repo) => {
    const edges = repo.e.filter(([language]) => kept[language] === true)
    const bytes = edges.reduce((sum, [, size]) => sum + size, 0)
    return { edges, bytes, weight: repo.w }
  })

  const capped = capValues(perRepo.map((repo) => repo.bytes * repo.weight))
  const accountTotal = capped.reduce((sum, value) => sum + value, 0)
  if (accountTotal === 0) return new Map()

  const totals = new Map<number, number>()
  perRepo.forEach((repo, index) => {
    if (repo.bytes === 0) return
    // The repository's final share of the account, spread across its languages
    // in the proportions it actually holds them.
    const repoShare = (capped[index] ?? 0) / accountTotal
    for (const [language, size] of repo.edges) {
      const contribution = repoShare * (size / repo.bytes)
      totals.set(language, (totals.get(language) ?? 0) + contribution)
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
function countByRepo(repos: readonly SampledRepo[], kept: readonly boolean[]): Map<number, number> {
  const totals = new Map<number, number>()

  for (const repo of repos) {
    const surviving = [...repo.e]
      .filter(([language]) => kept[language] === true)
      .sort((a, b) => b[1] - a[1])

    const primaryKept = surviving.find(([language]) => language === repo.p)
    const leader = primaryKept ?? surviving[0]
    if (leader === undefined) continue

    totals.set(leader[0], (totals.get(leader[0]) ?? 0) + repo.w)
  }

  return totals
}
