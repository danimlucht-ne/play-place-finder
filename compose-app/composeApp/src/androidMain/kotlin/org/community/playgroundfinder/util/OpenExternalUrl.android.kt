package org.community.playgroundfinder.util

import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext

@Composable
actual fun rememberOpenExternalUrl(): (rawUrlOrPhone: String) -> Unit {
    val context = LocalContext.current
    return remember(context) {
        { raw ->
            val t = raw.trim()
            if (t.isNotEmpty()) {
                val uri = when {
                    t.startsWith("tel:", ignoreCase = true) -> Uri.parse(t)
                    t.startsWith("http://", ignoreCase = true) || t.startsWith("https://", ignoreCase = true) ->
                        Uri.parse(t)
                    else -> Uri.parse("https://$t")
                }
                runCatching {
                    context.startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                }
            }
        }
    }
}
