package org.community.playgroundfinder.util

import androidx.compose.runtime.Composable

data class LatLng(val latitude: Double, val longitude: Double)

/** Returns a suspend lambda that resolves the device's current location, or null on failure/denial. */
@Composable
expect fun rememberLocationService(): suspend () -> LatLng?
