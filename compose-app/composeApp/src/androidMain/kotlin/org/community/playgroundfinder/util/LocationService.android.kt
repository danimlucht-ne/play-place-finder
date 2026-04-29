package org.community.playgroundfinder.util

import android.annotation.SuppressLint
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import com.google.android.gms.location.CurrentLocationRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

@SuppressLint("MissingPermission")
@Composable
actual fun rememberLocationService(): suspend () -> LatLng? {
    val context = LocalContext.current
    return remember(context) {
        suspend {
            try {
                val client = LocationServices.getFusedLocationProviderClient(context)

                // Try lastLocation first (fast, no battery cost)
                val last = suspendCancellableCoroutine<android.location.Location?> { cont ->
                    client.lastLocation
                        .addOnSuccessListener { cont.resume(it) }
                        .addOnFailureListener { cont.resume(null) }
                }

                if (last != null) {
                    LatLng(last.latitude, last.longitude)
                } else {
                    // lastLocation is null (fresh boot / no cached fix) — request a fresh one
                    val cts = CancellationTokenSource()
                    // Prefer a slightly older cached fix so first open paints faster; refine on later refresh.
                    val request = CurrentLocationRequest.Builder()
                        .setPriority(Priority.PRIORITY_BALANCED_POWER_ACCURACY)
                        .setMaxUpdateAgeMillis(300_000L)
                        .build()

                    val loc = suspendCancellableCoroutine<android.location.Location?> { cont ->
                        cont.invokeOnCancellation { cts.cancel() }
                        client.getCurrentLocation(request, cts.token)
                            .addOnSuccessListener { cont.resume(it) }
                            .addOnFailureListener { cont.resume(null) }
                    }
                    loc?.let { LatLng(it.latitude, it.longitude) }
                }
            } catch (_: Exception) {
                null
            }
        }
    }
}
