package org.community.playgroundfinder.ui.screens.map

import android.Manifest
import android.content.pm.PackageManager
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import com.google.android.gms.maps.model.BitmapDescriptorFactory
import com.google.android.gms.maps.model.CameraPosition
import com.google.android.gms.maps.model.LatLng
import com.google.maps.android.compose.GoogleMap
import com.google.maps.android.compose.MapEffect
import com.google.maps.android.compose.MapProperties
import com.google.maps.android.compose.MapUiSettings
import com.google.maps.android.compose.Marker
import com.google.maps.android.compose.MarkerState
import com.google.maps.android.compose.rememberCameraPositionState
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.delay
import org.community.playgroundfinder.data.Playground

/** Maps a playground's type to a hue for the map marker pin. */
private fun markerHue(playgroundType: String?): Float {
    val t = playgroundType?.lowercase()?.trim() ?: return BitmapDescriptorFactory.HUE_GREEN
    return when {
        t.contains("library")          -> BitmapDescriptorFactory.HUE_AZURE      // blue
        t.contains("school")           -> BitmapDescriptorFactory.HUE_YELLOW     // yellow
        t.contains("indoor") ||
        t.contains("amusement")        -> BitmapDescriptorFactory.HUE_ORANGE     // orange
        t.contains("private")          -> BitmapDescriptorFactory.HUE_VIOLET     // violet
        t.contains("splash")           -> BitmapDescriptorFactory.HUE_CYAN       // cyan
        t.contains("trail") ||
        t.contains("nature")           -> BitmapDescriptorFactory.HUE_MAGENTA    // magenta
        t.contains("museum") ||
        t.contains("zoo") ||
        t.contains("aquarium")         -> BitmapDescriptorFactory.HUE_ROSE       // rose/pink
        t.contains("city park") ||
        t.contains("regional") ||
        t.contains("state park")       -> BitmapDescriptorFactory.HUE_GREEN      // darker green
        t.contains("neighborhood")     -> 100f                                    // yellow-green
        t.contains("playground")       -> BitmapDescriptorFactory.HUE_GREEN      // green
        t.contains("public park") ||
        t.contains("public")           -> BitmapDescriptorFactory.HUE_GREEN      // green
        else                           -> BitmapDescriptorFactory.HUE_GREEN
    }
}

@Composable
actual fun MapContent(
    playgrounds: List<Playground>,
    userLat: Double?,
    userLng: Double?,
    onPlaygroundClick: (Playground) -> Unit,
    draftPinLat: Double?,
    draftPinLng: Double?,
    onMapLongClick: ((Double, Double) -> Unit)?,
    sponsorPins: List<MapSponsorPin>,
    onVisibleRegionReaderChange: (((() -> MapVisibleRegionBounds?)?) -> Unit)?,
    onSponsorPinClick: (MapSponsorPin) -> Unit,
) {
    val defaultPosition = LatLng(39.5, -98.35) // Center of US
    val initialPosition = if (userLat != null && userLng != null) LatLng(userLat, userLng) else defaultPosition
    val initialZoom = if (userLat != null && userLng != null) 13f else 4f
    val cameraPositionState = rememberCameraPositionState {
        position = CameraPosition.fromLatLngZoom(initialPosition, initialZoom)
    }

    // Defer map rendering by one frame to avoid blocking the main thread during
    // Maps SDK initialization (reduces ClientParametersBlockingReference warnings).
    var mapVisible by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        delay(50)
        mapVisible = true
    }

    if (!mapVisible) return

    val context = LocalContext.current
    val hasLocationPermission = remember {
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
    }

    GoogleMap(
        modifier = Modifier.fillMaxSize(),
        cameraPositionState = cameraPositionState,
        properties = MapProperties(isMyLocationEnabled = hasLocationPermission),
        uiSettings = MapUiSettings(myLocationButtonEnabled = hasLocationPermission),
        onMapLongClick = onMapLongClick?.let { handler ->
            { latLng: LatLng -> handler(latLng.latitude, latLng.longitude) }
        },
    ) {
        val registerBounds = onVisibleRegionReaderChange
        if (registerBounds != null) {
            MapEffect(registerBounds) { map ->
                registerBounds {
                    try {
                        val b = map.projection.visibleRegion.latLngBounds
                        MapVisibleRegionBounds(
                            southWestLat = b.southwest.latitude,
                            southWestLng = b.southwest.longitude,
                            northEastLat = b.northeast.latitude,
                            northEastLng = b.northeast.longitude,
                        )
                    } catch (_: Exception) {
                        null
                    }
                }
                try {
                    awaitCancellation()
                } finally {
                    registerBounds(null)
                }
            }
        }
        if (draftPinLat != null && draftPinLng != null) {
            Marker(
                state = MarkerState(position = LatLng(draftPinLat, draftPinLng)),
                title = "New place",
                snippet = "Tap Continue below to add details",
                icon = BitmapDescriptorFactory.defaultMarker(BitmapDescriptorFactory.HUE_AZURE),
            )
        }
        playgrounds.forEach { playground ->
            if (playground.latitude != 0.0 && playground.longitude != 0.0) {
                val snippet = when {
                    playground.subVenues.isNotEmpty() && !playground.address.isNullOrBlank() ->
                        "${playground.address}\nIncludes ${playground.subVenues.size} areas"
                    playground.subVenues.isNotEmpty() ->
                        "Includes ${playground.subVenues.size} areas"
                    else -> playground.address ?: ""
                }
                Marker(
                    state = MarkerState(position = LatLng(playground.latitude, playground.longitude)),
                    title = playground.name,
                    snippet = snippet,
                    icon = BitmapDescriptorFactory.defaultMarker(markerHue(playground.playgroundType)),
                    onClick = {
                        onPlaygroundClick(playground)
                        false
                    }
                )
            }
        }
        sponsorPins.forEach { pin ->
            Marker(
                state = MarkerState(position = LatLng(pin.latitude, pin.longitude)),
                title = pin.title,
                snippet = pin.snippet,
                icon = BitmapDescriptorFactory.defaultMarker(
                    if (pin.isEvent) BitmapDescriptorFactory.HUE_ROSE else BitmapDescriptorFactory.HUE_ORANGE,
                ),
                onClick = {
                    onSponsorPinClick(pin)
                    false
                },
            )
        }
    }
}
