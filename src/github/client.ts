/**
 * Thin GraphQL client for api.github.com.
 *
 * Deliberately small: it authenticates, enforces a timeout, records rate limit
 * headers and turns every failure mode into a `StatsError`. Query text and
 * response shaping live with the features that need them.
 */

import { type RateLimitState, StatsError } from './types'

const ENDPOINT = 'https://api.github.com/graphql'

/**
 * GitHub rejects unidentified clients. Pointing the agent at the repository
 * means anyone investigating unusual traffic can find out what is generating it.
 */
const USER_AGENT = 'phosphor-stats (+https://github.com/rondrft/phosphor-stats)'

/**
 * A README embeds this card in an `<img>`; a request that hangs shows a broken
 * image for as long as the browser is willing to wait. Failing fast and
 * rendering an error card is the better outcome.
 */
const TIMEOUT_MS = 8_000

/**
 * Source of credentials for an outgoing request.
 *
 * A personal access token gives the whole deployment one 5,000 request/hour
 * budget. A GitHub App gives every installation its own, which is the only way
 * this scales past a few thousand distinct profiles. Isolating credential
 * lookup behind this interface keeps that migration to a single new
 * implementation — nothing else in the codebase knows where a token comes from.
 */
export interface TokenProvider {
  getToken(): Promise<string>
}

export class StaticTokenProvider implements TokenProvider {
  constructor(private readonly token: string) {}

  getToken(): Promise<string> {
    return Promise.resolve(this.token)
  }
}

/** Injection seam for tests, which never reach the network. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

interface GraphQLError {
  type?: string
  message?: string
}

interface GraphQLResponse<T> {
  data?: T
  errors?: GraphQLError[]
}

export class GitHubClient {
  private rateLimitState: RateLimitState = { remaining: null, limit: null, reset: null }

  constructor(
    private readonly tokens: TokenProvider,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
  ) {}

  /** Headers from the most recent response, or nulls before the first call. */
  get rateLimit(): RateLimitState {
    return this.rateLimitState
  }

  async query<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const token = await this.tokens.getToken()

    let response: Response
    try {
      response = await this.fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: {
          authorization: `bearer ${token}`,
          'content-type': 'application/json',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (cause) {
      // Network failure or timeout. Neither is actionable by the caller, and
      // both look the same from a README.
      throw new StatsError('upstream', `request to GitHub failed: ${String(cause)}`)
    }

    this.recordRateLimit(response.headers)

    if (!response.ok) throw this.httpError(response)

    let body: GraphQLResponse<T>
    try {
      body = (await response.json()) as GraphQLResponse<T>
    } catch {
      throw new StatsError('upstream', 'GitHub returned a malformed response')
    }

    const failure = body.errors?.[0]
    if (failure !== undefined) throw this.graphqlError(failure)

    if (body.data === undefined) {
      throw new StatsError('upstream', 'GitHub returned no data')
    }

    return body.data
  }

  private recordRateLimit(headers: Headers): void {
    const readInt = (name: string): number | null => {
      const raw = headers.get(name)
      if (raw === null) return null
      const value = Number.parseInt(raw, 10)
      return Number.isFinite(value) ? value : null
    }

    this.rateLimitState = {
      remaining: readInt('x-ratelimit-remaining'),
      limit: readInt('x-ratelimit-limit'),
      reset: readInt('x-ratelimit-reset'),
    }
  }

  /**
   * Minutes until the quota resets, rounded up so the message never promises a
   * retry that is still too early.
   */
  private minutesUntilReset(): number | null {
    const { reset } = this.rateLimitState
    if (reset === null) return null
    return Math.max(1, Math.ceil((reset * 1000 - Date.now()) / 60_000))
  }

  private httpError(response: Response): StatsError {
    // GitHub answers an exhausted quota with 403 (or 429 for secondary limits)
    // and a `remaining: 0` header. Any other 4xx is a bug on our side, which the
    // reader cannot act on, so it degrades to a generic upstream failure.
    const exhausted = this.rateLimitState.remaining === 0
    if (exhausted || response.status === 429) {
      return new StatsError('rate-limited', 'GitHub rate limit exhausted', this.minutesUntilReset())
    }
    return new StatsError('upstream', `GitHub responded ${response.status}`)
  }

  private graphqlError(error: GraphQLError): StatsError {
    if (error.type === 'NOT_FOUND') {
      return new StatsError('not-found', error.message ?? 'user not found')
    }
    if (error.type === 'RATE_LIMITED') {
      return new StatsError('rate-limited', 'GitHub rate limit exhausted', this.minutesUntilReset())
    }
    return new StatsError('upstream', error.message ?? 'GitHub returned an error')
  }
}
