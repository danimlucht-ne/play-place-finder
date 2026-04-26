package org.community.playgroundfinder.ui.screens.map

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.maps.CameraUpdateFactory
import com.google.android.gms.maps.model.BitmapDescriptor
import com.google.android.gms.maps.model.BitmapDescriptorFactory
import com.google.android.gms.maps.model.CameraPosition
import com.google.android.gms.maps.model.LatLng
import com.google.maps.android.compose.GoogleMap
import com.google.maps.android.compose.MapProperties
import com.google.maps.android.compose.MapUiSettings
import com.google.maps.android.compose.Marker
import com.google.maps.android.compose.MarkerState
import com.google.maps.android.compose.rememberCameraPositionState
import org.community.playgroundfinder.BuildConfig
import org.community.playgroundfinder.data.Playground

/** High-contrast pin for geocoded filter / address center (not a playground row). */
private fun buildSearchFocusPinDescriptor(context: android.content.Context): BitmapDescriptor {
    val density = context.resources.displayMetrics.density
    val w = (28 * density).toInt().coerceIn(20, 56)
    val h = (40 * density).toInt().coerceIn(28, 80)
    val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bmp)
    val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = android.graphics.Color.BLACK }
    val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = android.graphics.Color.WHITE
        style = Paint.Style.STROKE
        strokeWidth = 2f * density
    }
    val cx = w / 2f
    val cy = h * 0.38f
    val r = w * 0.28f
    canvas.drawCircle(cx, cy, r, fill)
    canvas.drawCircle(cx, cy, r, ring)
    return BitmapDescriptorFactory.fromBitmap(bmp)
}

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
    mapFocusLat: Double?,
    mapFocusLng: Double?,
    onPlaygroundClick: (Playground) -> Unit,
    draftPinLat: Double?,
    draftPinLng: Double?,
    onMapLongClick: ((Double, Double) -> Unit)?,
    sponsorPins: List<MapSponsorPin>,
    onVisibleRegionReaderChange: (((() -> MapVisibleRegionBounds?)?) -> Unit)?,
    onSponsorPinClick: (MapSponsorPin) -> Unit,
) {
    val defaultPosition = LatLng(39.5, -98.35) // Center of US
    val initialPosition = when {
        mapFocusLat != null && mapFocusLng != null -> LatLng(mapFocusLat, mapFocusLng)
        userLat != null && userLng != null -> LatLng(userLat, userLng)
        else -> defaultPosition
    }
    val initialZoom = when {
        mapFocusLat != null && mapFocusLng != null -> 14f
        userLat != null && userLng != null -> 13f
        else -> 4f
    }
    val savedCameraLat = rememberSaveable { mutableStateOf<Double?>(null) }
    val savedCameraLng = rememberSaveable { mutableStateOf<Double?>(null) }
    val savedCameraZoom = rememberSaveable { mutableStateOf<Float?>(null) }
    val cameraPositionState = rememberCameraPositionState {
        val restoredLat = savedCameraLat.value
        val restoredLng = savedCameraLng.value
        val restoredZoom = savedCameraZoom.value
        position = if (restoredLat != null && restoredLng != null) {
            CameraPosition.fromLatLngZoom(LatLng(restoredLat, restoredLng), restoredZoom ?: initialZoom)
        } else {
            CameraPosition.fromLatLngZoom(initialPosition, initialZoom)
        }
    }

    val context = LocalContext.current
    val hasLocationPermission = remember {
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
    }

    if (!BuildConfig.HAS_GOOGLE_MAPS_API_KEY) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color(0xFFECEFF1)),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = "Map unavailable: add GOOGLE_MAPS_API_KEY to local.properties (Android Maps SDK key) and rebuild.",
                color = Color(0xFFB71C1C),
                fontSize = 14.sp,
                modifier = Modifier.padding(24.dp),
            )
        }
        return
    }

    // [rememberCameraPositionState] only uses the initial lambda once; when [userLat]/[userLng]
    // resolve after the first frame (e.g. GPS), move the camera so the map is not stuck on the US default.
    // When both [mapFocusLat] and [mapFocusLng] are set (Home address / city filter), use that center only —
    // never pair one filter coordinate with the opposite axis from GPS.
    LaunchedEffect(mapFocusLat, mapFocusLng, userLat, userLng) {
        if (savedCameraLat.value != null && savedCameraLng.value != null) return@LaunchedEffect
        val (lat, lng, zoom) = if (mapFocusLat != null && mapFocusLng != null) {
            Triple(mapFocusLat!!, mapFocusLng!!, 14f)
        } else {
            val uLat = userLat ?: return@LaunchedEffect
            val uLng = userLng ?: return@LaunchedEffect
            Triple(uLat, uLng, 13f)
        }
        try {
            cameraPositionState.animate(
                CameraUpdateFactory.newLatLngZoom(LatLng(lat, lng), zoom),
            )
        } catch (_: Exception) {
            runCatching {
                cameraPositionState.move(CameraUpdateFactory.newLatLngZoom(LatLng(lat, lng), zoom))
            }
        }
    }
    LaunchedEffect(cameraPositionState) {
        snapshotFlow { cameraPositionState.position }
            .collect { pos ->
                savedCameraLat.value = pos.target.latitude
                savedCameraLng.value = pos.target.longitude
                savedCameraZoom.value = pos.zoom
            }
    }

    DisposableEffect(onVisibleRegionReaderChange, cameraPositionState) {
        val register = onVisibleRegionReaderChange
        if (register != null) {
            register reader@{
                val projection = cameraPositionState.projection ?: return@reader null
                val b = projection.visibleRegion.latLngBounds
                MapVisibleRegionBounds(
                    southWestLat = b.southwest.latitude,
                    southWestLng = b.southwest.longitude,
                    northEastLat = b.northeast.latitude,
                    northEastLng = b.northeast.longitude,
                )
            }
        }
        onDispose {
            onVisibleRegionReaderChange?.invoke(null)
        }
    }

    val playServicesOk = remember(context) {
        GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS
    }

    val searchFocusPinIcon = remember(context) {
        runCatching { buildSearchFocusPinDescriptor(context) }
            .getOrElse { BitmapDescriptorFactory.defaultMarker(BitmapDescriptorFactory.HUE_VIOLET) }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        GoogleMap(
            modifier = Modifier.fillMaxSize(),
            cameraPositionState = cameraPositionState,
            properties = MapProperties(isMyLocationEnabled = hasLocationPermission),
            uiSettings = MapUiSettings(myLocationButtonEnabled = hasLocationPermission),
            onMapLongClick = onMapLongClick?.let { handler ->
                { latLng: LatLng -> handler(latLng.latitude, latLng.longitude) }
            },
        ) {
        if (draftPinLat != null && draftPinLng != null) {
            Marker(
                state = MarkerState(position = LatLng(draftPinLat, draftPinLng)),
                title = "New place",
                snippet = "Tap Continue below to add details",
                icon = BitmapDescriptorFactory.defaultMarker(BitmapDescriptorFactory.HUE_AZURE),
            )
        }
        if (mapFocusLat != null && mapFocusLng != null) {
            Marker(
                state = MarkerState(position = LatLng(mapFocusLat, mapFocusLng)),
                title = "Search location",
                snippet = "Your address or place filter is centered here",
                icon = searchFocusPinIcon,
                zIndex = 5f,
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

        if (!playServicesOk) {
            Text(
                text = "Update Google Play services to load map tiles.",
                color = Color(0xFFB71C1C),
                fontSize = 12.sp,
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(horizontal = 16.dp, vertical = 8.dp),
            )
        }
    }
}
