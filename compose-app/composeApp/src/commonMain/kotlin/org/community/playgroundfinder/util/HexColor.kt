package org.community.playgroundfinder.util

import androidx.compose.ui.graphics.Color

/**
 * Parses `#RRGGBB` or `#AARRGGBB` into a Compose [Color], or null if invalid.
 */
fun parseHexColor(hex: String): Color? {
    val raw = hex.trim().removePrefix("#").lowercase()
    if (raw.length != 6 && raw.length != 8) return null
    if (!raw.all { it in '0'..'9' || it in 'a'..'f' }) return null
    val n = raw.toLongOrNull(16) ?: return null
    val argb = when (raw.length) {
        6 -> (0xFF000000L or n).toInt()
        8 -> (n and 0xFFFFFFFFL).toInt()
        else -> return null
    }
    return Color(argb)
}
