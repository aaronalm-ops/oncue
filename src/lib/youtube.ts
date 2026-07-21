/**
 * Build an anonymous YouTube "watch these in sequence" playlist from a set of
 * reference links — no Google login, no API. Extracts the 11-char video id from
 * the common URL shapes (watch?v=, youtu.be/, /embed/, /shorts/, music.youtube).
 */

export function extractYouTubeId(url: string | null | undefined): string | null {
  if (!url) return null
  const m = url.match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/)([A-Za-z0-9_-]{11})/)
  return m ? m[1] : null
}

export function buildYouTubePlaylist(urls: string[]): { url: string | null; ids: string[] } {
  const ids: string[] = []
  for (const u of urls) {
    const id = extractYouTubeId(u)
    if (id && !ids.includes(id)) ids.push(id)
  }
  if (ids.length === 0) return { url: null, ids: [] }
  // watch_videos builds a temporary playlist queue from the ids.
  return { url: `https://www.youtube.com/watch_videos?video_ids=${ids.join(',')}`, ids }
}
