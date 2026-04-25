package org.community.playgroundfinder.ui.screens.privacy

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.community.playgroundfinder.util.MarketingLinks
import org.community.playgroundfinder.util.rememberOpenExternalUrl

@Composable
fun PrivacyScreen() {
    val openExternalUrl = rememberOpenExternalUrl()
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text("Privacy Policy (v1.0)", fontSize = 22.sp, fontWeight = FontWeight.Bold)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TextButton(onClick = { openExternalUrl(MarketingLinks.privacyPolicy()) }) {
                Text("Open on website", fontSize = 14.sp)
            }
            TextButton(onClick = { openExternalUrl(MarketingLinks.mailtoSupport()) }) {
                Text("Email support", fontSize = 14.sp)
            }
        }
        Text(
            "PLAY PLACE FINDER — PRIVACY POLICY\n\n" +
            "Last Updated: 03/25/2026\n\n" +
            "1. OVERVIEW\n\n" +
            "Play Spotter (\"we\", \"our\", or \"the app\") is a community-driven mobile application designed for adult parents and caregivers to discover family-friendly places and activities.\n\n" +
            "This app is not directed to children under 13, and we do not knowingly collect personal data from children.\n\n" +
            "By using the app, you agree to this Privacy Policy.\n\n" +
            "2. INFORMATION WE COLLECT\n\n" +
            "A. Information You Provide\n\n" +
            "You may provide:\n" +
            "- name (optional)\n" +
            "- email address\n" +
            "- submitted content (reviews, photos, listings)\n" +
            "- advertiser/business information (if applicable)\n\n" +
            "We do not require account creation for general use of the app unless specific features require it.\n\n" +
            "B. Location Data (Permission-Based)\n\n" +
            "With your explicit permission, we may collect:\n" +
            "- approximate or precise location\n" +
            "- ZIP code or city\n" +
            "- manually entered location data\n\n" +
            "How We Use Location Data\n\n" +
            "Location data is used strictly to:\n" +
            "- show nearby family-friendly places\n" +
            "- personalize search results\n" +
            "- display relevant local content\n" +
            "- serve geographically relevant advertisements\n\n" +
            "We do not:\n" +
            "- track location in the background unnecessarily\n" +
            "- sell precise location data\n" +
            "- use location for unrelated purposes\n\n" +
            "You can disable location access at any time in your device settings.\n\n" +
            "C. Automatically Collected Data\n\n" +
            "We may collect limited technical data such as:\n" +
            "- device type and OS version\n" +
            "- app interactions (screens viewed, taps)\n" +
            "- session data\n" +
            "- basic analytics\n" +
            "- ad impressions and clicks\n\n" +
            "This data is used to improve app performance and user experience.\n\n" +
            "3. HOW WE USE INFORMATION\n\n" +
            "We use collected information to:\n" +
            "- provide and improve app functionality\n" +
            "- display relevant local results and ads\n" +
            "- monitor usage and performance\n" +
            "- detect fraud or abuse\n" +
            "- process advertiser submissions and payments\n\n" +
            "We do not use personal data for unrelated purposes.\n\n" +
            "4. DATA SHARING\n\n" +
            "We do not sell personal data.\n\n" +
            "We may share limited data with:\n" +
            "- payment processors (for transactions)\n" +
            "- analytics providers (aggregated, non-identifiable data)\n" +
            "- infrastructure providers (hosting, storage)\n\n" +
            "All partners are required to protect user data.\n\n" +
            "5. CROWDSOURCED CONTENT DISCLAIMER\n\n" +
            "Play Spotter is a community-driven platform.\n\n" +
            "- Content may be submitted by users or third parties.\n" +
            "- We do not guarantee accuracy, completeness, or reliability.\n" +
            "- Listings may be outdated or incorrect.\n\n" +
            "Users are responsible for verifying information before relying on it.\n\n" +
            "6. ADVERTISING & SPONSORED CONTENT\n\n" +
            "- Some content is labeled as \"Sponsored\".\n" +
            "- Sponsored content is paid advertising from local businesses.\n" +
            "- We do not endorse or guarantee advertised businesses.\n" +
            "- Interactions with advertisers are solely between you and the business.\n\n" +
            "7. CHILDREN'S PRIVACY (COPPA COMPLIANCE)\n\n" +
            "- This app is intended for adults (parents and caregivers).\n" +
            "- We do not knowingly collect personal information from children under 13.\n" +
            "- We do not allow children to create accounts or submit personal data.\n\n" +
            "If we discover that we have collected data from a child under 13, we will delete it promptly.\n\n" +
            "8. DATA RETENTION\n\n" +
            "We retain data only as long as necessary to:\n" +
            "- operate the app\n" +
            "- comply with legal obligations\n" +
            "- resolve disputes\n\n" +
            "9. SECURITY\n\n" +
            "We implement reasonable safeguards to protect data.\n\n" +
            "However, no system is completely secure, and we cannot guarantee absolute security.\n\n" +
            "10. YOUR CHOICES\n\n" +
            "You may:\n" +
            "- disable location permissions\n" +
            "- request deletion of your data\n" +
            "- opt out of communications\n\n" +
            "Contact: playplacefinder@gmail.com\n\n" +
            "11. CHANGES TO THIS POLICY\n\n" +
            "We may update this policy periodically.\n\n" +
            "Continued use of the app means you accept updates.\n\n" +
            "12. TRACKING\n\n" +
            "We do not track users across third-party apps or websites for advertising purposes.\n\n" +
            "Advertising within the app is based on general location (such as city or ZIP code) and not on cross-app tracking.",
            fontSize = 14.sp,
            lineHeight = 22.sp
        )
    }
}
