/**
 * Repository language data.
 *
 * Fetches the account's own public, non-forked repositories and hands them to
 * `src/languages.ts`, which decides what the numbers mean. Forks are excluded
 * because they would credit the fork's author with the upstream project's
 * entire history — the single most common way these cards end up lying.
 *
 * This is by far the most expensive query in the service: 100 repositories per
 * page, each with up to 10 language edges. Pagination stops after `MAX_PAGES` —
 * sorted by most recently pushed, and with a per-repository cap applied
 * downstream, the tail past 300 repositories cannot move a percentage by a
 * visible amount, and the quota saved is better spent on other users.
 */

import type { LangMode, RepoLanguages } from '../languages'
import { rankLanguages } from '../languages'
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
        pushedAt
        primaryLanguage { name }
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
        pushedAt: string | null
        primaryLanguage: { name: string } | null
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
  /** Lowercased language names to drop, on top of the defaults. */
  exclude: readonly string[]
  /** Lowercased language names to re-admit from the defaults. */
  include: readonly string[]
  mode: LangMode
  /** Reference time for the recency weight, in epoch milliseconds. */
  now: number
}

export async function fetchLanguages(
  client: GitHubClient,
  login: string,
  options: LanguagesOptions,
): Promise<LanguageStat[]> {
  const repos: RepoLanguages[] = []
  let cursor: string | null = null

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const payload: LanguagesPayload = await client.query<LanguagesPayload>(QUERY, {
      login,
      after: cursor,
    })

    const repositories = payload.user?.repositories
    if (repositories === undefined) throw new StatsError('not-found', `no such user: ${login}`)

    for (const repository of repositories.nodes) {
      if (repository === null) continue
      repos.push({
        name: repository.name,
        pushedAt: repository.pushedAt,
        primaryLanguage: repository.primaryLanguage?.name ?? null,
        edges: repository.languages.edges.filter(isEdge).map((edge) => ({
          name: edge.node.name,
          color: HEX_COLOR.test(edge.node.color ?? '') ? edge.node.color : null,
          size: edge.size,
        })),
      })
    }

    if (!repositories.pageInfo.hasNextPage) break
    cursor = repositories.pageInfo.endCursor
    if (cursor === null) break
  }

  return rankLanguages(repos, options)
}

function isEdge<T>(edge: T | null): edge is T {
  return edge !== null
}
