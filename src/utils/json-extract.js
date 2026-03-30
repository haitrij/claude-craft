/**
 * Brace-balanced JSON object extraction from mixed text.
 *
 * More reliable than regex for extracting JSON when the text contains
 * nested braces inside string values (e.g. reasoning fields).
 */

/**
 * Extract a JSON object from mixed text using brace-balanced parsing.
 *
 * @param {string} text         - Text that may contain a JSON object
 * @param {string} requiredKey  - If provided, only return objects containing this key
 * @returns {object|null}         Parsed object, or null if not found
 */
export function extractJsonObject(text, requiredKey = null) {
  if (!text || typeof text !== 'string') return null;

  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue;

    // Quick check: if requiredKey specified, verify it exists after this brace
    if (requiredKey && !text.slice(i).includes(`"${requiredKey}"`)) return null;

    let depth = 0;
    let inString = false;
    let escape = false;

    for (let j = i; j < text.length; j++) {
      const ch = text[j];

      if (escape) { escape = false; continue; }
      if (ch === '\\' && inString) { escape = true; continue; }
      if (ch === '"' && !escape) { inString = !inString; continue; }
      if (inString) continue;

      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          const candidate = text.slice(i, j + 1);
          try {
            const obj = JSON.parse(candidate);
            if (!requiredKey || (obj && typeof obj === 'object' && requiredKey in obj)) {
              return obj;
            }
          } catch {
            // Not valid JSON at this position, try next `{`
          }
          break; // This brace pair didn't parse; move to next `{`
        }
      }
    }
  }

  return null;
}
