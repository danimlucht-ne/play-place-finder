package org.community.playgroundfinder.ui.screens.advertising

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.community.playgroundfinder.ui.composables.FormColors
import org.community.playgroundfinder.util.MarketingLinks
import org.community.playgroundfinder.util.rememberOpenExternalUrl

@Composable
fun AdvertiserEntryScreen(
    onNavigateToBusinessInfo: () -> Unit,
) {
    val openExternalUrl = rememberOpenExternalUrl()
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text("📢", fontSize = 48.sp)

        Spacer(Modifier.height(16.dp))

        Text(
            "Advertise Your Business",
            fontSize = 24.sp,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center,
        )

        Spacer(Modifier.height(12.dp))

        Text(
            "Reach local families in your area. Promote your family-friendly business to parents actively looking for places to visit.",
            fontSize = 14.sp,
            color = Color.Gray,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 16.dp),
        )

        Spacer(Modifier.height(16.dp))

        // Loyalty: discount after first completed campaign
        Surface(
            shape = RoundedCornerShape(12.dp),
            color = Color(0xFFFFF3E0),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(
                modifier = Modifier.padding(16.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    "20% off your next campaign",
                    fontWeight = FontWeight.Bold,
                    fontSize = 15.sp,
                    color = Color(0xFFE65100),
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    "After your first campaign completes, we email you a 20% discount code to use on your next campaign.",
                    fontSize = 13.sp,
                    color = Color(0xFF795548),
                    textAlign = TextAlign.Center,
                )
            }
        }

        Spacer(Modifier.height(16.dp))

        TextButton(onClick = { openExternalUrl(MarketingLinks.advertiserLanding()) }) {
            Text("See placements & pricing on our website", color = FormColors.PrimaryButton)
        }

        Spacer(Modifier.height(16.dp))

        Button(
            onClick = onNavigateToBusinessInfo,
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp),
            shape = RoundedCornerShape(16.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = FormColors.PrimaryButton,
                contentColor = FormColors.PrimaryButtonText,
            ),
        ) {
            Text("Create your ad now", fontWeight = FontWeight.Bold)
        }
    }
}
