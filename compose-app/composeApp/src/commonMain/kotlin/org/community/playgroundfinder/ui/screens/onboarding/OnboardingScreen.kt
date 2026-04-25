package org.community.playgroundfinder.ui.screens.onboarding

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.community.playgroundfinder.util.rememberSettings

@Composable
fun OnboardingScreen(
    onComplete: () -> Unit,
    onNavigateToPrivacy: () -> Unit,
    onNavigateToAdultTerms: () -> Unit,
) {
    val settings = rememberSettings()
    var adultConfirmed by remember { mutableStateOf(false) }

    Box(
        modifier = Modifier.fillMaxSize().background(
            Brush.verticalGradient(listOf(Color(0xFF33CCBF), Color(0xFF1A8F86)))
        ),
        contentAlignment = Alignment.Center
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 32.dp).fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Spacer(Modifier.height(24.dp))

            Text(
                "Play Spotter",
                fontSize = 32.sp,
                fontWeight = FontWeight.ExtraBold,
                color = Color.White,
                textAlign = TextAlign.Center,
            )
            Text(
                "Discover the best play places\nfor your family.",
                fontSize = 16.sp,
                color = Color.White.copy(alpha = 0.85f),
                textAlign = TextAlign.Center,
            )

            Spacer(Modifier.height(8.dp))

            Card(shape = RoundedCornerShape(16.dp), colors = CardDefaults.cardColors(containerColor = Color.White)) {
                Column(modifier = Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        "\uD83D\uDCCD This app uses your location to find play places near you.",
                        fontSize = 13.sp,
                        color = Color.Gray,
                    )
                    Spacer(Modifier.height(4.dp))
                    Row(verticalAlignment = Alignment.Top) {
                        Checkbox(checked = adultConfirmed, onCheckedChange = { adultConfirmed = it })
                        Spacer(Modifier.width(4.dp))
                        Column(modifier = Modifier.padding(top = 12.dp)) {
                            Text("I confirm I am 18+ and agree to the", fontSize = 14.sp)
                            TextButton(onClick = onNavigateToAdultTerms, contentPadding = PaddingValues(0.dp)) {
                                Text("Terms and Conditions", fontSize = 14.sp)
                            }
                        }
                    }
                }
            }

            TextButton(onClick = onNavigateToPrivacy) {
                Text("View Privacy Policy", color = Color.White.copy(alpha = 0.8f))
            }

            Spacer(Modifier.height(4.dp))

            Button(
                onClick = {
                    settings.setBoolean("isAdultConfirmed", adultConfirmed)
                    settings.setBoolean("onboardingCompleted", true)
                    onComplete()
                },
                enabled = adultConfirmed,
                modifier = Modifier.fillMaxWidth().height(52.dp),
                shape = RoundedCornerShape(16.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Color.White)
            ) {
                Text("Get Started", color = Color(0xFF33CCBF), fontWeight = FontWeight.Bold, fontSize = 16.sp)
            }
        }
    }
}
