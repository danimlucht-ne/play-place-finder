package org.community.playgroundfinder.ui.screens.map

/**
 * A promoted inline / event listing shown on the interactive map when the advertiser supplied coordinates.
 * Common pattern in consumer apps: distinct marker or “promoted pin” rather than covering the map with banners.
 */
data class MapSponsorPin(
    val id: String,
    val campaignId: String,
    val title: String,
    val snippet: String,
    val latitude: Double,
    val longitude: Double,
    val targetUrl: String,
    val isEvent: Boolean,
)
