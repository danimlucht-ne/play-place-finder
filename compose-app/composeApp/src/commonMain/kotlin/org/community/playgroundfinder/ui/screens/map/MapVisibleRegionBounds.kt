package org.community.playgroundfinder.ui.screens.map

/** Visible map bounds from the platform map projection (southwest / northeast corners). */
data class MapVisibleRegionBounds(
    val southWestLat: Double,
    val southWestLng: Double,
    val northEastLat: Double,
    val northEastLng: Double,
)
