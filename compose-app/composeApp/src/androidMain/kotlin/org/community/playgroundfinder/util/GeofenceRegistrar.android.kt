package org.community.playgroundfinder.util

import androidx.compose.runtime.Composable
import org.community.playgroundfinder.data.Playground

@Composable
actual fun rememberVerificationGeofenceRegistrar(): suspend (List<Playground>, Double) -> Unit {
    // Geofence registration requires a foreground service and complex permission handling.
    // Returning a no-op here keeps the build clean; wire up GeofencingClient when ready.
    return { _, _ -> }
}
