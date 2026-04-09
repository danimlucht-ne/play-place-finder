package org.community.playgroundfinder.util

import androidx.compose.runtime.Composable

/**
 * Opens turn-by-turn **driving** directions to [latitude]/[longitude] (Google Maps).
 * Android prefers the Maps app with a browser fallback; iOS uses the platform actual when added.
 */
@Composable
expect fun rememberOpenMapDirections(): (latitude: Double, longitude: Double, placeName: String?) -> Unit
