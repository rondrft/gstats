/**
 * Language breakdown.
 *
 * Bytes are summed across the account's own public, non-forked repositories.
 * Forks are excluded because they would credit the fork's author with the
 * upstream project's entire history, which is the single most common way these
 * cards end up lying.
 *
 * This is by far the most expensive query in the service: 100 repositories per
 * page, each with up to 10 language edges. Pagination stops after
 * `MAX_PAGES` — sorted by most recently pushed, the tail past 300 repositories
 * cannot move a percentage by a visible amount, and the quota saved is better
 * spent on other users.
 */

import type { GitHubClient } from './client'
import type { LanguageStat } from './types'
import { StatsError } from './types'

const MAX_PAGES = 3

const QUERY = `query($login: String!, $after: String) {
  user(login: $login) {
    repositories(
      first: 100
      after: $after
      ownerAffiliations: OWNER
      isFork: false
      privacy: PUBLIC
      orderBy: { field: PUSHED_AT, direction: DESC }
    ) {
      pageInfo { hasNextPage endCursor }
      nodes {
        name
        languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
          edges { size node { name color } }
        }
      }
    }
  }
}`

interface LanguagesPayload {
  user: {
    repositories: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null }
      nodes: ({
        name: string
        languages: {
          edges: ({ size: number; node: { name: string; color: string | null } } | null)[]
        }
      } | null)[]
    }
  } | null
}

/**
 * Linguist colours are interpolated straight into a `fill` attribute, so they
 * are validated like any other untrusted value even though they come from
 * GitHub rather than from the caller.
 */
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

export interface LanguagesOptions {
  /** How many entries to return, after exclusions. */
  limit: number
  /** Lowercased language names to drop before ranking. */
  exclude: readonly string[]
}

export async function fetchLanguages(
  client: GitHubClient,
  login: string,
  { limit, exclude }: LanguagesOptions,
): Promise<LanguageStat[]> {
  const totals = new Map<string, { size: number; color: string | null }>()
  const excluded = new Set(exclude)

  let cursor: string | null = null

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const payload: LanguagesPayload = await client.query<LanguagesPayload>(QUERY, {
      login,
      after: cursor,
    })

    const repositories = payload.user?.repositories
    if (repositories === undefined) throw new StatsError('not-found', `no such user: ${login}`)

    for (const repository of repositories.nodes) {
      for (const edge of repository?.languages.edges ?? []) {
        if (edge === null) continue
        const name = edge.node.name
        if (excluded.has(name.toLowerCase())) continue

        const entry = totals.get(name)
        if (entry === undefined) {
          totals.set(name, {
            size: edge.size,
            color: HEX_COLOR.test(edge.node.color ?? '') ? edge.node.color : null,
          })
        } else {
          entry.size += edge.size
        }
      }
    }

    if (!repositories.pageInfo.hasNextPage) break
    cursor = repositories.pageInfo.endCursor
    if (cursor === null) break
  }

  const grandTotal = [...totals.values()].reduce((sum, entry) => sum + entry.size, 0)
  if (grandTotal === 0) return []

  return [...totals.entries()]
    .map(([name, entry]) => ({
      name,
      color: entry.color,
      size: entry.size,
      pct: entry.size / grandTotal,
    }))
    .sort((a, b) => b.size - a.size)
    .slice(0, limit)
}
