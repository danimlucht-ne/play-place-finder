package org.community.playgroundfinder.util

/**
 * Picks the first image URL Coil can load. Raw `google_photo:…` refs are skipped until the server
 * expands them to https; the API often puts that token first with real CDN URLs after it.
 */
fun firstDisplayablePlaygroundImageUrl(imageUrls: List<String>): String? =
    imageUrls.asSequence()
        .map { it.trim() }
        .firstOrNull { u -> u.isNotBlank() && !u.startsWith("google_photo:") }
