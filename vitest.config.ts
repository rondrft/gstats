import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

/**
 * Tests run inside workerd rather than in Node, so what passes here is what the
 * deployed Worker does — including the parts of the platform the card renderer
 * leans on, such as `Intl` data and `AbortSignal.timeout`.
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        // Nothing in the suite reaches the network; the GitHub client is
        // constructed with a stub transport. This only keeps `env` well-formed.
        bindings: { GITHUB_TOKEN: 'test-token' },
      },
    }),
  ],
  test: {
    globals: true,
  },
})
