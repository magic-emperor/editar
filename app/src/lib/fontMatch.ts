// Phase 2 will: parse the embedded TTF name table (opentype.js, record ID 4)
// to get a readable family name, then call IntelliFont getFontSuggestions(name).
// The visual matcher (aiSuggestSimilarBuffer) is NOT used — broken for Latin fonts.
export async function resolveEmbeddedFont(_fontBytes: Uint8Array): Promise<string> {
  return 'inherit'
}
