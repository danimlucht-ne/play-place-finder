package org.community.playgroundfinder.ui.composables

import androidx.compose.ui.graphics.Color

object FormColors {
    val PrimaryButton = Color(0xFF00CED1)
    val PrimaryButtonText = Color.White
    val SecondaryButtonText = Color(0xFF5E5E5E)
    val SelectedChip = Color(0xFF808080)
    val SelectedChipText = PrimaryButton
    val SuggestChip = Color(0xFF00CED1)
    val SuggestChipText = Color.White
    val Divider = Color(0xFF5E5E5E)
    /** Accordions, inset panels on detail / forms */
    val MutedCardBackground = Color(0xFFD0D0D0)
    val CardBackground = Color(0xFFFAFAFA)
    val ErrorText = Color(0xFFE53935)
    val SubtleDivider = Color(0xFFE0E0E0)
    val BodyText = Color(0xFF424242)
    /** Expand / collapse affordances in sheets and accordions */
    val AccordionChevronTint = PrimaryButton
    /** Meta chips (e.g. labels, distance pill) */
    val InfoChipBackground = PrimaryButton.copy(alpha = 0.14f)
    val InfoChipText = PrimaryButton
    /** List / map filter summary strip */
    val FilterBannerBackground = PrimaryButton.copy(alpha = 0.14f)
    val FilterBannerText = BodyText
    /** Default styling for list membership chips when no custom color */
    val ListChipDefaultBg = PrimaryButton.copy(alpha = 0.14f)
    val ListChipDefaultFg = PrimaryButton
    /** Primary screen FAB (matches list + add flow) */
    val FabSurface = Color.White
    val FabContent = SecondaryButtonText
    /** App-wide softer screen background to reduce glare */
    val ScreenBackground = Color(0xFFE0E0E0)

    val COST_OPTIONS = listOf("Free", "Low (\$1–\$5)", "Medium (\$6–\$15)", "High (\$16+)")
}
