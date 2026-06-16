import { zipSync } from 'fflate'

// Bundle named files into a single ZIP (stored, no compression — image/PDF bytes are
// already compressed, so deflate would only waste CPU). Returns the ZIP bytes.
export function zipFiles(files: { name: string; bytes: Uint8Array }[]): Uint8Array {
  const entries: Record<string, [Uint8Array, { level: 0 }]> = {}
  for (const f of files) entries[f.name] = [f.bytes, { level: 0 }]
  return zipSync(entries)
}
