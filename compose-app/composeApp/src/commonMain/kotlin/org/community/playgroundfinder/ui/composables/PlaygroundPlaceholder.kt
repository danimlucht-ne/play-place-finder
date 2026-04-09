package org.community.playgroundfinder.ui.composables

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.painter.Painter

/**
 * Placeholder image when a play place has no photo. Android uses type-specific drawables;
 * iOS will supply its own [actual] (compose resources or assets).
 */
@Composable
expect fun playgroundPlaceholderPainter(playgroundType: String?): Painter
