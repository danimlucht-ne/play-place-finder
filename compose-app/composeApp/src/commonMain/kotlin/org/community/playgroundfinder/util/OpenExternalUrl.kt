package org.community.playgroundfinder.util

import androidx.compose.runtime.Composable

/**
 * Opens http(s) URLs in the browser and [tel:] for phone numbers (platform-specific).
 */
@Composable
expect fun rememberOpenExternalUrl(): (rawUrlOrPhone: String) -> Unit
