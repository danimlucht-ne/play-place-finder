package org.community.playgroundfinder.ui.composables

import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Consistent “active filters” callout used on list and map (matches app teal, not Material blue).
 */
@Composable
fun FilterSummaryBanner(
    summary: String,
    modifier: Modifier = Modifier,
    forMapOverlay: Boolean = false,
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(10.dp),
        color = if (forMapOverlay) FormColors.FilterBannerBackground.copy(alpha = 0.96f) else FormColors.FilterBannerBackground,
        shadowElevation = if (forMapOverlay) 2.dp else 0.dp,
    ) {
        Text(
            "Filters: $summary",
            fontSize = 12.sp,
            fontWeight = FontWeight.Medium,
            color = FormColors.FilterBannerText,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp),
        )
    }
}
