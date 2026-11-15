const ITEM_ID_PATTERN = /^[A-Z0-9_]+(@\d)?$/;

export function isValidItemId(id: string): boolean {
  return ITEM_ID_PATTERN.test(id);
}

/**
 * Greedily splits item IDs into chunks so that every URL built from a chunk stays within maxUrlLength.
 * A single ID that is too long on its own throws, since no request could ever be built for it.
 */
export function chunkIds(ids: string[], buildUrl: (chunk: string[]) => string, maxUrlLength: number): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  for (const id of ids) {
    const candidate = [...current, id];
    if (buildUrl(candidate).length <= maxUrlLength) {
      current = candidate;
      continue;
    }
    if (current.length === 0) throw new Error(`Item id "${id}" produces a URL longer than ${maxUrlLength} characters`);
    chunks.push(current);
    current = [id];
    if (buildUrl(current).length > maxUrlLength) {
      throw new Error(`Item id "${id}" produces a URL longer than ${maxUrlLength} characters`);
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
