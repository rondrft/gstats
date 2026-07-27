/**
 * Types for the brand files imported by `src/brand.ts`.
 *
 * Wrangler bundles them through the module rules in `wrangler.toml`: `.svg` as
 * `Text`, `.png` as `Data`. TypeScript has no way to know that, so it is
 * declared here rather than inferred — and narrowly, by extension, so that an
 * accidental import of some other binary is still a type error.
 */

declare module '*.svg' {
  const markup: string
  export default markup
}

declare module '*.png' {
  const bytes: ArrayBuffer
  export default bytes
}
