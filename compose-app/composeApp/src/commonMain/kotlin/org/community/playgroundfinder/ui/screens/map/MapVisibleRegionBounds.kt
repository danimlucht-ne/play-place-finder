package org.community.playgroundfinder.ui.screens.map

/** Visible map rectangle in WGS84, used for admin “seed this viewport” requests. */
data class MapVisibleRegionBounds(
    val southWestLat: Double,
    val southWestLng: Double,
    val northEastLat: Double,
    val northEastLng: Double,
)
