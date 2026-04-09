package org.community.playgroundfinder.util

private val photoRefRegex = Regex("photoreference=([^&]+)", RegexOption.IGNORE_CASE)

/**
 * Dedupes gallery URLs the same way as the server trim step: same Google photo reference → one URL,
 * preferring `masked-photos` (stickered) over raw Places/redirect URLs. Also drops exact string dupes.
 */
fun dedupePlaygroundImageUrls(urls: List<String>): List<String> {
    if (urls.isEmpty()) return urls
    val out = mutableListOf<String>()
    val refToIndex = mutableMapOf<String, Int>()
    val seenExact = mutableSetOf<String>()

    for (u in urls) {
        if (u.isBlank()) continue

        val ref = when {
            u.startsWith("google_photo:") -> u.removePrefix("google_photo:")
            else -> photoRefRegex.find(u)?.groupValues?.getOrNull(1)
        }
        val masked = u.contains("masked-photos")

        if (ref == null) {
            if (!seenExact.add(u)) continue
            out.add(u)
            continue
        }

        val existingIdx = refToIndex[ref]
        if (existingIdx == null) {
            seenExact.add(u)
            refToIndex[ref] = out.size
            out.add(u)
        } else {
            val prev = out[existingIdx]
            val prevMasked = prev.contains("masked-photos")
            if (masked && !prevMasked) {
                seenExact.remove(prev)
                seenExact.add(u)
                out[existingIdx] = u
            }
        }
    }
    return out
}
