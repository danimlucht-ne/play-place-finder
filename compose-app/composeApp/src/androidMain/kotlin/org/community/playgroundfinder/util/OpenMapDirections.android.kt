package org.community.playgroundfinder.util

import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext

@Composable
actual fun rememberOpenMapDirections(): (latitude: Double, longitude: Double, placeName: String?) -> Unit {
    val context = LocalContext.current
    return remember(context) {
        { lat, lng, _ ->
            if (lat != 0.0 || lng != 0.0) {
                // mode=d = driving (default UX for "Get directions")
                val gUri = Uri.parse("google.navigation:q=$lat,$lng&mode=d")
                val mapsIntent = Intent(Intent.ACTION_VIEW, gUri).apply {
                    setPackage("com.google.android.apps.maps")
                }
                try {
                    context.startActivity(mapsIntent)
                } catch (_: Exception) {
                    val webUri = Uri.parse(
                        "https://www.google.com/maps/dir/?api=1&destination=$lat,$lng&travelmode=driving",
                    )
                    context.startActivity(Intent(Intent.ACTION_VIEW, webUri))
                }
            }
        }
    }
}
