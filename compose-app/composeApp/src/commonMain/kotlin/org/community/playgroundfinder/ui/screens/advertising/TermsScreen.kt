package org.community.playgroundfinder.ui.screens.advertising

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.community.playgroundfinder.data.PlaygroundService
import org.community.playgroundfinder.ui.composables.FormColors

private val TERMS_TEXT = """
PLAY PLACE FINDER — ADVERTISER AGREEMENT

Last Updated: 3/26/2026

This Advertiser Agreement ("Agreement") governs the submission, approval, and display of advertising content within Play Place Finder.

By submitting an advertisement and completing payment, you ("Advertiser") agree to the following terms:

1. AUTHORIZATION

You represent and warrant that:
- you are authorized to act on behalf of the business
- all submitted information is accurate and truthful
- you have rights to use all submitted images, logos, and content

2. ADVERTISING CONTENT REQUIREMENTS

All advertising content must:
- be family-friendly and appropriate for a general audience
- comply with all applicable laws and regulations
- not be false, misleading, or deceptive
- not promote unsafe, illegal, or harmful activities

We reserve the right to reject or remove any content at our discretion.

3. APPROVAL & PUBLICATION

- All advertisements are subject to review and approval
- Payment does not guarantee approval or placement
- We may request modifications prior to approval
- We may remove or pause ads at any time if they violate policies

4. CAMPAIGN TERMS

- Ads will run for the selected duration and placement
- Start dates may be adjusted based on approval timing
- Placement is subject to availability and platform rules

5. PAYMENTS & REFUNDS

- Payment is required prior to review or activation
- If an ad is rejected before going live, we may issue a refund or credit
- Once a campaign is active, fees are generally non-refundable
- Chargebacks or fraudulent disputes may result in account suspension

6. NO PERFORMANCE GUARANTEE

We do not guarantee:
- number of impressions
- number of clicks
- leads, customers, or revenue

All advertising performance depends on user behavior and market conditions.

7. ADVERTISER RESPONSIBILITY

Advertisers are solely responsible for:
- the accuracy of business information
- customer interactions
- fulfillment of services
- compliance with laws

We are not responsible for disputes between users and advertisers.

8. LIMITATION OF LIABILITY

To the fullest extent permitted by law:

Play Place Finder shall not be liable for:
- indirect or consequential damages
- loss of revenue or business opportunities
- issues arising from ad performance

9. LICENSE TO USE CONTENT

You grant us a non-exclusive, royalty-free license to:
- display your submitted content within the app
- modify formatting to fit app layouts
- use content for review and moderation

10. TERMINATION

We may suspend or terminate campaigns if:
- terms are violated
- payment issues occur
- fraudulent activity is detected

11. MODIFICATIONS

We may update this Agreement at any time.

12. ACCEPTANCE

By submitting your advertisement, you confirm that:
- you have read and agree to this Agreement
- you understand payment does not guarantee results
- you accept all terms outlined above

13. CONTACT

For questions: playplacefinder@gmail.com

End of Advertiser Agreement
""".trimIndent()

@Composable
fun TermsScreen(
    playgroundService: PlaygroundService,
    submissionId: String,
    onTermsAccepted: () -> Unit,
    onBack: () -> Unit,
) {
    val scope = rememberCoroutineScope()

    var accepted by remember { mutableStateOf(false) }
    var isLoading by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            "Please review and accept the advertising terms before proceeding to payment.",
            fontSize = 14.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        Spacer(Modifier.height(4.dp))

        // Terms card (scrollable content inside the outer scroll)
        OutlinedCard(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.outlinedCardColors(
                containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f),
            ),
        ) {
            Text(
                text = TERMS_TEXT,
                modifier = Modifier.padding(16.dp),
                fontSize = 13.sp,
                lineHeight = 20.sp,
                color = MaterialTheme.colorScheme.onSurface,
            )
        }

        Spacer(Modifier.height(4.dp))

        // Accept checkbox
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Checkbox(
                checked = accepted,
                onCheckedChange = { accepted = it },
            )
            Spacer(Modifier.width(8.dp))
            Text(
                "I accept the advertising terms and conditions",
                fontSize = 14.sp,
                modifier = Modifier.weight(1f),
            )
        }

        // Error banner
        errorMessage?.let {
            Text(it, color = FormColors.ErrorText, fontSize = 13.sp)
        }

        Spacer(Modifier.height(8.dp))

        // Continue to Payment button
        Button(
            onClick = {
                scope.launch {
                    isLoading = true
                    errorMessage = null
                    try {
                        playgroundService.acceptTerms(submissionId, "3/26/2026")
                        onTermsAccepted()
                    } catch (e: Exception) {
                        errorMessage = e.message ?: "Something went wrong. Please try again."
                    } finally {
                        isLoading = false
                    }
                }
            },
            enabled = accepted && !isLoading,
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp),
            shape = RoundedCornerShape(16.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = Color(0xFF5E5E5E),
                contentColor = Color.White,
            ),
        ) {
            if (isLoading) {
                CircularProgressIndicator(
                    modifier = Modifier.size(20.dp),
                    color = Color.White,
                    strokeWidth = 2.dp,
                )
            } else {
                Text("Continue to Payment", fontWeight = FontWeight.Bold)
            }
        }
    }
}
