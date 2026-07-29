/**
 * What the service calls itself, wherever that name is written into output.
 *
 * The rename from `phosphor-stats` reached the landing page, the credit line and
 * the documentation, and missed the `pass` design's band, which went on printing
 * the old name onto every card drawn with it for three commits. There was no one
 * place to change: the name was a literal in each of them. Now there is.
 *
 * It is deliberately *not* used for anything a reader has written down. The
 * `phosphor` theme keeps its name because it is a public parameter value sitting
 * in other people's READMEs, the legacy Worker keeps its hostname for the same
 * reason, and neither is this string.
 */
export const SERVICE_NAME = 'gstats'
