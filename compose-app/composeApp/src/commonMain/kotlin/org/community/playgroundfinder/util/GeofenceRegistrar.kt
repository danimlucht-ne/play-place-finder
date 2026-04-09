package org.community.playgroundfinder.util

import androidx.compose.runtime.Composable
import org.community.playgroundfinder.data.Playground

/** Returns a suspend lambda that registers proximity geofences for the given playgrounds. No-op on non-Android. */
@Composable
expect fun rememberVerificationGeofenceRegistrar(): suspend (List<Playground>, Double) -> Unit
