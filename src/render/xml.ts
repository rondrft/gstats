/**
 * The card interpolates values that originate in a query string or in the
 * GitHub API (usernames, display names, language names). All of them go through
 * `escapeXml` before they reach the document.
 *
 * Both quote forms are escaped, not just the ones that matter in text nodes, so
 * the same helper is safe to use for attribute values.
 */

const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
}

export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ENTITIES[char] ?? char)
}
