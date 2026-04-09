package org.community.playgroundfinder.events

import org.community.playgroundfinder.models.AdCreativePayload
import org.community.playgroundfinder.models.AllAdsResponse
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

private fun creativeWithCoords(
    id: String,
    businessLat: Double,
    businessLng: Double,
    eventDate: String? = "2026-06-15",
    eventName: String? = "E",
    headline: String = "H",
    businessName: String = "",
) = AdCreativePayload(
    id = id,
    isEvent = true,
    eventDate = eventDate,
    eventName = eventName,
    headline = headline,
    businessName = businessName,
    businessLat = businessLat,
    businessLng = businessLng,
)

class NearbyEventsCalendarPipelineTest {

    private fun creative(
        id: String,
        isEvent: Boolean = true,
        eventDate: String? = "2026-06-15",
        eventName: String? = "Named",
        headline: String = "Headline",
        campaignId: String? = null,
    ) = AdCreativePayload(
        id = id,
        campaignId = campaignId,
        isEvent = isEvent,
        eventDate = eventDate,
        eventName = eventName,
        headline = headline,
    )

    @Test
    fun `non-paid response yields no calendar rows`() {
        val resp = AllAdsResponse(
            type = "house",
            ads = listOf(creative("1", isEvent = true)),
        )
        assertTrue(paidEventCreativesSortedForCalendar(resp).isEmpty())
    }

    @Test
    fun `paid response excludes non-event creatives`() {
        val resp = AllAdsResponse(
            type = "paid",
            ads = listOf(
                creative("evt", isEvent = true, eventName = "Fair"),
                creative("plain", isEvent = false, eventName = "Sponsored only"),
            ),
        )
        val out = paidEventCreativesSortedForCalendar(resp)
        assertEquals(listOf("evt"), out.map { it.id })
    }

    @Test
    fun `sorts by eventDate then by display title eventName or headline`() {
        val resp = AllAdsResponse(
            type = "paid",
            ads = listOf(
                creative("later", eventDate = "2026-07-01", eventName = "Zoo night"),
                creative("earlier", eventDate = "2026-06-01", eventName = "Park day"),
                creative("same-day-b", eventDate = "2026-06-10", eventName = "B workshop"),
                creative("same-day-a", eventDate = "2026-06-10", eventName = "A workshop"),
            ),
        )
        assertEquals(
            listOf("earlier", "same-day-a", "same-day-b", "later"),
            paidEventCreativesSortedForCalendar(resp).map { it.id },
        )
    }

    @Test
    fun `blank eventDate sorts after concrete dates using sentinel`() {
        val resp = AllAdsResponse(
            type = "paid",
            ads = listOf(
                creative("no-date", eventDate = "  ", eventName = "Mystery"),
                creative("dated", eventDate = "2026-05-01", eventName = "Known"),
            ),
        )
        assertEquals(
            listOf("dated", "no-date"),
            paidEventCreativesSortedForCalendar(resp).map { it.id },
        )
    }

    @Test
    fun `blank eventName falls back to headline for tie-break`() {
        val resp = AllAdsResponse(
            type = "paid",
            ads = listOf(
                creative("m", eventDate = "2026-04-01", eventName = null, headline = "M headline"),
                creative("a", eventDate = "2026-04-01", eventName = null, headline = "A headline"),
            ),
        )
        assertEquals(
            listOf("a", "m"),
            paidEventCreativesSortedForCalendar(resp).map { it.id },
        )
    }

    @Test
    fun `empty paid ads yields empty list`() {
        val resp = AllAdsResponse(type = "paid", ads = emptyList())
        assertTrue(paidEventCreativesSortedForCalendar(resp).isEmpty())
    }

    @Test
    fun `dedupes same campaign appearing twice in API payload`() {
        val dup = creative("row-a", campaignId = "camp-1", eventName = "Spring fair", eventDate = "2026-06-01")
        val sameCampaign = dup.copy(id = "other-id")
        val resp = AllAdsResponse(
            type = "paid",
            ads = listOf(dup, sameCampaign, creative("other", campaignId = "camp-2", eventName = "Zoo night", eventDate = "2026-07-01")),
        )
        val out = paidEventCreativesSortedForCalendar(resp)
        assertEquals(2, out.size)
        assertEquals(listOf("row-a", "other"), out.map { it.id })
    }

    @Test
    fun `dedupes duplicate events with different creative ids when campaignId is blank`() {
        val a = AdCreativePayload(
            id = "creative-a",
            campaignId = null,
            isEvent = true,
            eventDate = "2026-04-22T00:00:00.000Z",
            eventName = "an event",
            headline = "h",
            businessName = "Cat Co",
            businessCategory = "education",
            body = "body text cat",
            imageUrl = "https://example.com/cat.jpg",
            ctaUrl = "https://example.com",
        )
        val b = a.copy(id = "creative-b")
        val resp = AllAdsResponse(type = "paid", ads = listOf(a, b))
        val out = paidEventCreativesSortedForCalendar(resp)
        assertEquals(1, out.size)
    }

    @Test
    fun `dedupes two active campaigns that share the same event fingerprint`() {
        val a = AdCreativePayload(
            id = "c1",
            campaignId = "campaign-aaa",
            isEvent = true,
            eventDate = "2026-04-22T00:00:00.000Z",
            eventName = "an event",
            headline = "h",
            businessName = "Cat Co",
            body = "body text cat",
        )
        val b = a.copy(id = "c2", campaignId = "campaign-bbb", eventDate = "2026-04-22")
        val resp = AllAdsResponse(type = "paid", ads = listOf(a, b))
        val out = paidEventCreativesSortedForCalendar(resp)
        assertEquals(1, out.size)
    }

    @Test
    fun `applyEventsCalendarSort by business name is case insensitive`() {
        val a = creative("x", eventDate = "2026-06-01", eventName = "Zebra")
        val b = creative("y", eventDate = "2026-06-02", eventName = "apple")
        val base = listOf(a, b)
        assertEquals(
            listOf("y", "x"),
            applyEventsCalendarSort(base, EventsCalendarSort.ByBusinessName, null, null).map { it.id },
        )
    }

    @Test
    fun `applyEventsCalendarSort by distance orders nearest first`() {
        val far = creativeWithCoords("far", 42.0, -97.0, eventDate = "2026-07-01", eventName = "Far")
        val near = creativeWithCoords("near", 41.27, -96.01, eventDate = "2026-06-01", eventName = "Near")
        val base = paidEventCreativesSortedForCalendar(
            AllAdsResponse(type = "paid", ads = listOf(far, near)),
        )
        val uLat = 41.26
        val uLng = -96.0
        assertEquals(
            listOf("near", "far"),
            applyEventsCalendarSort(base, EventsCalendarSort.ByDistance, uLat, uLng).map { it.id },
        )
    }

    @Test
    fun `applyEventsCalendarSort by distance without user location matches date order`() {
        val a = creative("later", eventDate = "2026-07-01", eventName = "Z")
        val b = creative("earlier", eventDate = "2026-06-01", eventName = "A")
        val base = paidEventCreativesSortedForCalendar(AllAdsResponse(type = "paid", ads = listOf(a, b)))
        assertEquals(
            listOf("earlier", "later"),
            applyEventsCalendarSort(base, EventsCalendarSort.ByDistance, null, null).map { it.id },
        )
    }
}
