package org.community.playgroundfinder.events

import org.community.playgroundfinder.models.AdCreativePayload
import org.community.playgroundfinder.models.AllAdsResponse

/** Haversine distance in meters (same formula as [org.community.playgroundfinder.ui.composables.haversineMeters]). */
private fun haversineMeters(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
    val r = 6_371_000.0
    val dLat = Math.toRadians(lat2 - lat1)
    val dLng = Math.toRadians(lng2 - lng1)
    val a = Math.sin(dLat / 2).let { it * it } +
        Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) *
        Math.sin(dLng / 2).let { it * it }
    return r * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** User-chosen ordering for the events calendar list (after [paidEventCreativesSortedForCalendar] filtering). */
enum class EventsCalendarSort {
    /** Soonest event date first; same day ordered by display title. */
    ByDate,
    /** Nearest business location to the user first; needs location + business coordinates (unknowns last). */
    ByDistance,
    /** Alphabetical by display title (event name, else business name, else headline); ties by date. */
    ByBusinessName,
}

/** Title shown on cards: event name, else business name, else headline. */
fun eventCreativeDisplayTitle(ad: AdCreativePayload): String =
    ad.eventName?.takeIf { it.isNotBlank() } ?: ad.businessName.ifBlank { ad.headline }

/**
 * Percent-encode a string for safe embedding in a URL query value.
 * Hand-rolled because [java.net.URLEncoder] isn't available in commonMain.
 */
private fun encodeUrlComponent(raw: String): String {
    val bytes = raw.encodeToByteArray()
    val out = StringBuilder()
    for (b in bytes) {
        val ch = b.toInt().toChar()
        val safe = (ch in 'a'..'z') || (ch in 'A'..'Z') || (ch in '0'..'9') ||
            ch == '-' || ch == '_' || ch == '.' || ch == '~'
        if (safe) {
            out.append(ch)
        } else {
            val v = b.toInt() and 0xFF
            out.append('%')
            out.append("0123456789ABCDEF"[v ushr 4])
            out.append("0123456789ABCDEF"[v and 0x0F])
        }
    }
    return out.toString()
}

/**
 * Build a Google Calendar `?action=TEMPLATE` URL for an event creative, or null when the
 * creative has no usable date. Shared between the inline list, prime/featured slot, and
 * the dedicated "Events near you" screen so every event surface has the same experience.
 */
fun eventCreativeGoogleCalendarUrl(ad: AdCreativePayload): String? {
    val date = ad.eventDate?.trim()?.takeIf { it.length >= 10 }?.take(10) ?: return null
    val title = eventCreativeDisplayTitle(ad).ifBlank { "Event" }
    val details = ad.body.trim().ifBlank { title }
    val location = ad.eventLocation?.trim()?.takeIf { it.isNotBlank() } ?: ad.businessName.trim()
    val start = date.replace("-", "")
    val end = date.replace("-", "")
    return "https://calendar.google.com/calendar/render?action=TEMPLATE" +
        "&text=${encodeUrlComponent(title)}" +
        "&details=${encodeUrlComponent(details)}" +
        "&location=${encodeUrlComponent(location)}" +
        "&dates=${start}/${end}"
}

private fun dateSortKey(ad: AdCreativePayload): String =
    ad.eventDate.orEmpty().trim().ifBlank { "9999-99-99" }

private fun compareByDateThenTitle(): Comparator<AdCreativePayload> =
    compareBy<AdCreativePayload>({ dateSortKey(it) }, { eventCreativeDisplayTitle(it) })

/** Meters from user to business pin, or null if it cannot be computed. */
fun eventCreativeDistanceMeters(ad: AdCreativePayload, userLat: Double?, userLng: Double?): Double? {
    val uLat = userLat ?: return null
    val uLng = userLng ?: return null
    if (ad.businessLat == 0.0 && ad.businessLng == 0.0) return null
    return haversineMeters(uLat, uLng, ad.businessLat, ad.businessLng)
}

/**
 * Re-orders [events] (typically from [paidEventCreativesSortedForCalendar]) without changing membership.
 * [ByDistance] falls back to date order when location or business coordinates are missing.
 */
fun applyEventsCalendarSort(
    events: List<AdCreativePayload>,
    sort: EventsCalendarSort,
    userLat: Double?,
    userLng: Double?,
): List<AdCreativePayload> {
    if (events.size <= 1) return events
    return when (sort) {
        EventsCalendarSort.ByDate -> events.sortedWith(compareByDateThenTitle())
        EventsCalendarSort.ByBusinessName -> events.sortedWith(
            compareBy<AdCreativePayload>({ eventCreativeDisplayTitle(it).lowercase() })
                .thenBy { dateSortKey(it) },
        )
        EventsCalendarSort.ByDistance -> events.sortedWith(
            compareBy<AdCreativePayload>(
                { ad ->
                    val m = eventCreativeDistanceMeters(ad, userLat, userLng)
                    m ?: Double.POSITIVE_INFINITY
                },
            ).then(compareByDateThenTitle()),
        )
    }
}

private fun whitespaceCollapse(s: String): String =
    s.trim().lowercase().replace(Regex("\\s+"), " ")

/**
 * One calendar row per **logical** event. The API can return multiple active campaigns (different
 * [AdCreativePayload.campaignId] / [AdCreativePayload.id]) for the same sponsored event; ISO vs plain
 * date strings and URL/query noise must not split fingerprints.
 */
internal fun eventCreativeDedupeKey(ad: AdCreativePayload): String {
    val ymd = ad.eventDate.orEmpty().trim().take(10)
    val fp = listOf(
        whitespaceCollapse(ad.businessName),
        ymd,
        whitespaceCollapse(ad.eventName.orEmpty()),
        whitespaceCollapse(ad.headline),
        whitespaceCollapse(ad.body).take(200),
    ).joinToString("\u0001")
    if (fp.isNotBlank() && fp != "\u0001\u0001\u0001\u0001") return fp
    val c = ad.campaignId?.trim().orEmpty()
    if (c.isNotEmpty()) return c
    val id = ad.id.trim()
    if (id.isNotEmpty()) return id
    return "${ad.headline}_${ad.eventDate}"
}

/**
 * Builds the list for **Events near you**: paid `inline_listing` payloads with [AdCreativePayload.isEvent],
 * ordered by calendar date then title (same rules as [org.community.playgroundfinder.ui.screens.events.NearbyEventsCalendarScreen]).
 */
fun paidEventCreativesSortedForCalendar(resp: AllAdsResponse): List<AdCreativePayload> {
    val paid = if (resp.type == "paid") resp.ads else emptyList()
    return paid
        .filter { it.isEvent }
        .distinctBy { eventCreativeDedupeKey(it) }
        .sortedWith(compareByDateThenTitle())
}
