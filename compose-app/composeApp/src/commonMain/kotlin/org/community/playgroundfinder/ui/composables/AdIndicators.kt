package org.community.playgroundfinder.ui.composables

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** High-contrast “Ad” chip for paid non-event placements (dark gray + light border + elevation). */
@Composable
fun AdIndicatorPill(modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(4.dp),
        color = Color(0xFF424242),
        contentColor = Color.White,
        shadowElevation = 3.dp,
        border = BorderStroke(1.dp, Color(0xFF212121)),
    ) {
        Text(
            "Ad",
            modifier = Modifier.padding(horizontal = 7.dp, vertical = 3.dp),
            fontSize = 10.sp,
            fontWeight = FontWeight.Bold,
            color = Color.White,
        )
    }
}

/** Teal “Event” chip (brand-aligned); match [AdIndicatorPill] padding so it lines up in a row with the CTA. */
@Composable
fun EventBadgePill(modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(4.dp),
        color = FormColors.PrimaryButton,
        contentColor = Color.White,
        shadowElevation = 2.dp,
        border = BorderStroke(1.dp, Color(0xFF0097A7)),
    ) {
        Text(
            "Event",
            modifier = Modifier.padding(horizontal = 7.dp, vertical = 3.dp),
            fontSize = 10.sp,
            fontWeight = FontWeight.Bold,
            color = Color.White,
        )
    }
}
