package org.community.playgroundfinder.ui.composables

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.unit.dp
import org.jetbrains.compose.ui.tooling.preview.Preview

@Composable
fun PlaygroundAppIcon(
    modifier: Modifier = Modifier
) {
    Box(
        modifier = modifier
            .size(256.dp)
            .clip(RoundedCornerShape(64.dp))
            .background(
                brush = Brush.verticalGradient(
                    colors = listOf(
                        Color(0xFF329DF8),
                        Color(0xFF1475F2)
                    )
                )
            )
    ) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            val width = size.width
            val height = size.height
            
            // Scaled coordinates based on a 100x100 grid centered in the view
            val scaleX = width / 100f
            val scaleY = height / 100f
            
            val path = Path().apply {
                // Ground line
                moveTo(15f * scaleX, 60f * scaleY)
                lineTo(85f * scaleX, 60f * scaleY)
                lineTo(85f * scaleX, 62f * scaleY)
                lineTo(15f * scaleX, 62f * scaleY)
                close()
                
                // Roof of the tower
                moveTo(28f * scaleX, 38f * scaleY)
                lineTo(35f * scaleX, 30f * scaleY)
                lineTo(42f * scaleX, 38f * scaleY)
                close()
                
                // Tower pillars
                // Left pillar
                moveTo(30f * scaleX, 38f * scaleY)
                lineTo(32f * scaleX, 38f * scaleY)
                lineTo(32f * scaleX, 60f * scaleY)
                lineTo(30f * scaleX, 60f * scaleY)
                close()
                // Right pillar
                moveTo(38f * scaleX, 38f * scaleY)
                lineTo(40f * scaleX, 38f * scaleY)
                lineTo(40f * scaleX, 60f * scaleY)
                lineTo(38f * scaleX, 60f * scaleY)
                close()
                
                // Tower platform
                moveTo(29f * scaleX, 48f * scaleY)
                lineTo(41f * scaleX, 48f * scaleY)
                lineTo(41f * scaleX, 50f * scaleY)
                lineTo(29f * scaleX, 50f * scaleY)
                close()
                
                // Slide
                moveTo(40f * scaleX, 48f * scaleY)
                cubicTo(
                    45f * scaleX, 48f * scaleY,
                    48f * scaleX, 55f * scaleY,
                    52f * scaleX, 60f * scaleY
                )
                lineTo(55f * scaleX, 60f * scaleY)
                cubicTo(
                    51f * scaleX, 55f * scaleY,
                    47f * scaleX, 45f * scaleY,
                    40f * scaleX, 45f * scaleY
                )
                close()
                
                // Ladder
                moveTo(22f * scaleX, 60f * scaleY)
                lineTo(28f * scaleX, 48f * scaleY)
                lineTo(30f * scaleX, 48f * scaleY)
                lineTo(24f * scaleX, 60f * scaleY)
                close()
                
                // Ladder rungs
                moveTo(24f * scaleX, 56f * scaleY)
                lineTo(31f * scaleX, 56f * scaleY)
                lineTo(31f * scaleX, 57f * scaleY)
                lineTo(24f * scaleX, 57f * scaleY)
                close()
                
                moveTo(26f * scaleX, 52f * scaleY)
                lineTo(31f * scaleX, 52f * scaleY)
                lineTo(31f * scaleX, 53f * scaleY)
                lineTo(26f * scaleX, 53f * scaleY)
                close()

                // Swing set frame
                // Left A-frame front
                moveTo(52f * scaleX, 60f * scaleY)
                lineTo(55f * scaleX, 40f * scaleY)
                lineTo(57f * scaleX, 40f * scaleY)
                lineTo(54f * scaleX, 60f * scaleY)
                close()
                
                // Left A-frame back
                moveTo(58f * scaleX, 60f * scaleY)
                lineTo(56f * scaleX, 40f * scaleY)
                lineTo(58f * scaleX, 40f * scaleY)
                lineTo(60f * scaleX, 60f * scaleY)
                close()
                
                // Right A-frame front
                moveTo(78f * scaleX, 60f * scaleY)
                lineTo(75f * scaleX, 40f * scaleY)
                lineTo(77f * scaleX, 40f * scaleY)
                lineTo(80f * scaleX, 60f * scaleY)
                close()
                
                // Right A-frame back
                moveTo(82f * scaleX, 60f * scaleY)
                lineTo(79f * scaleX, 40f * scaleY)
                lineTo(81f * scaleX, 40f * scaleY)
                lineTo(84f * scaleX, 60f * scaleY)
                close()
                
                // Top bar
                moveTo(53f * scaleX, 39f * scaleY)
                lineTo(82f * scaleX, 39f * scaleY)
                lineTo(82f * scaleX, 42f * scaleY)
                lineTo(53f * scaleX, 42f * scaleY)
                close()
                
                // Swing 1 ropes
                moveTo(60f * scaleX, 42f * scaleY)
                lineTo(60f * scaleX, 54f * scaleY)
                lineTo(61f * scaleX, 54f * scaleY)
                lineTo(61f * scaleX, 42f * scaleY)
                close()
                
                moveTo(66f * scaleX, 42f * scaleY)
                lineTo(66f * scaleX, 54f * scaleY)
                lineTo(67f * scaleX, 54f * scaleY)
                lineTo(67f * scaleX, 42f * scaleY)
                close()
                
                // Swing 1 seat
                moveTo(59f * scaleX, 54f * scaleY)
                lineTo(68f * scaleX, 54f * scaleY)
                lineTo(68f * scaleX, 56f * scaleY)
                lineTo(59f * scaleX, 56f * scaleY)
                close()
                
                // Swing 2 ropes
                moveTo(70f * scaleX, 42f * scaleY)
                lineTo(70f * scaleX, 54f * scaleY)
                lineTo(71f * scaleX, 54f * scaleY)
                lineTo(71f * scaleX, 42f * scaleY)
                close()
                
                moveTo(76f * scaleX, 42f * scaleY)
                lineTo(76f * scaleX, 54f * scaleY)
                lineTo(77f * scaleX, 54f * scaleY)
                lineTo(77f * scaleX, 42f * scaleY)
                close()
                
                // Swing 2 seat
                moveTo(69f * scaleX, 54f * scaleY)
                lineTo(78f * scaleX, 54f * scaleY)
                lineTo(78f * scaleX, 56f * scaleY)
                lineTo(69f * scaleX, 56f * scaleY)
                close()
            }
            drawPath(
                path = path,
                color = Color.Black,
                style = Fill
            )
        }
    }
}

@Preview
@Composable
fun PlaygroundAppIconPreview() {
    PlaygroundAppIcon()
}
