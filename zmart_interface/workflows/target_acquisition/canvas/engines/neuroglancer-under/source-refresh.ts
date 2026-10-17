/** What this reads of neuroglancer's chunk manager: the holders it keeps, by key. */
interface Memoized {
  memoize: { map: Map<string, { invalidateCache?: () => void; [more: string]: unknown } | null | undefined> };
}

/** Refresh decoded chunks only for the stores whose published contents changed. */
export function refreshSources(chunkManager: Memoized | null, sources: Iterable<string>): number {
  const folders = [...sources].map(url => url.split("|")[0]);
  if (!folders.length) return 0;
  const refreshed = new Set<object>();
  for (const [key, holder] of chunkManager?.memoize.map ?? []) {
    if (!key.includes('"constructorId"') || !folders.some(folder => key.includes(folder))) continue;
    if (!holder || typeof holder.invalidateCache !== "function" || refreshed.has(holder)) continue;
    holder.invalidateCache();
    refreshed.add(holder);
  }
  return refreshed.size;
}
