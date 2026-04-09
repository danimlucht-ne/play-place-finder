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

/** Must match [website/content/legal/advertiser-agreement.md] frontmatter `version`. */
private const val ADVERTISER_AGREEMENT_VERSION = "1.1"

/** Display-only; match frontmatter `lastUpdated` in the same markdown file. */
private const val ADVERTISER_AGREEMENT_LAST_UPDATED = "April 15, 2026"

/**
 * Plain-text mirror of `website/content/legal/advertiser-agreement.md` (body only).
 * When legal text changes, update the markdown first, then sync this string.
 */
private val TERMS_TEXT = """
PLAY PLACE FINDER — ADVERTISER AGREEMENT

Version $ADVERTISER_AGREEMENT_VERSION · Last updated: $ADVERTISER_AGREEMENT_LAST_UPDATED

This Advertiser Agreement governs the submission, approval, and display of advertising content within Play Place Finder. By submitting an advertisement and completing payment, you agree to the following terms.

1. AUTHORIZATION

You represent and warrant that you are authorized to act on behalf of the business, all submitted information is accurate and truthful, and you have legal rights to use all submitted images, logos, and content.

2. CONTENT REQUIREMENTS

All advertising content must be family-friendly and appropriate for parents and caregivers using the service, comply with all applicable laws, not be false, harmful, obscene, fraudulent, defamatory, misleading, or deceptive, and not promote unsafe, illegal, obscene or harmful activities. We reserve the right to reject or remove any content at our discretion. The app is not directed at children, and advertising is not delivered to child accounts. Content shall not be designed and/or marketed toward those aged thirteen (13) years of age or below.

3. APPROVAL & PUBLICATION

All advertisements are subject to review and approval. Payment does not guarantee approval or placement. We may request modifications prior to approval and may remove or pause ads at any time if they violate policies.

4. CAMPAIGN TERMS

Ads will run for the selected duration and placement. Start dates may be adjusted based on approval timing. Placement is subject to availability and platform rules.

5. PAYMENTS & REFUNDS

- Payment is required prior to review or activation
- If an ad is rejected before going live, we may issue a refund in line with this Agreement
- You may cancel a campaign at any time; once an advertisement has gone live, cancellation does not entitle you to a refund for time already paid for
- Chargebacks or fraudulent disputes may result in account suspension

6. NO PERFORMANCE GUARANTEE

We do not guarantee number of impressions, clicks, conversions, leads, customers, or revenue. All advertising performance depends on user behavior and market conditions.

Services are provided "AS IS." We work hard to offer great services, but we can't guarantee any minimum level of quality services (which may depend on factors beyond our control, such as the quality of internet access and equipment). To the fullest extent permitted by law, we make no warranties, either express or implied, about the services. The services are provided "AS IS." We also disclaim any implied warranties and merchantability, fitness for a particular purpose, client enjoyment, and non-infringement, and any warranties arising out of course of dealing or usage of trade. The laws of certain jurisdictions or states do not allow limitations on implied warranties. To the extent such warranties cannot be disclaimed under the laws of your jurisdiction, we limit the duration and remedies of such warranties to the fullest extent permissible under those laws.

7. ADVERTISER RESPONSIBILITY

Advertisers are solely responsible for the accuracy of business information, customer interactions, fulfillment of services, and compliance with laws. We are not responsible for disputes between users and advertisers.

8. LIMITATION OF LIABILITY & INDEMNIFICATION

To the fullest extent permitted by law, Play Place Finder shall not be liable for indirect or consequential damages, loss of revenue or business opportunities, or issues arising from ad performance.

Further, the Advertiser agrees to indemnify and hold PlayPlace Finder and its officers, directors, employees and agents harmless from any and all claims, damages, liabilities, and costs (including reasonable legal and accounting fees) related to (a) your access or use of our services or third-party services, (b) your violation of these terms, or (c) your negligence or willful misconduct. OUR TOTAL LIABILITY TO YOU FOR ANY CLAIM ARISING FROM YOUR USE OF OUR ADVERTISING SERVICES SHALL NOT EXCEED THE AMOUNT YOU PAID TO US FOR THE ADVERTISING CAMPAIGN AT ISSUE.

Any action, regardless of form, arising out of or relating to a dispute may be brought by either party not more than one (1) year after the cause of action has accrued.

9. LICENSE TO USE CONTENT / INTELLECTUAL PROPERTY

You grant us a limited, non-exclusive, royalty-free license to display your submitted content within the app, modify formatting to fit app layouts, and use content for review and moderation.

10. TERMINATION

We may suspend or terminate campaigns if terms are violated, payment issues occur, or fraudulent activity is detected.

11. MODIFICATIONS

We may update this Agreement at any time. Continued use of the advertising platform constitutes acceptance of updates.

12. ACCEPTANCE

By submitting your advertisement, you confirm that you have read and agree to this Agreement, you understand payment does not guarantee results, and you accept all terms outlined above.

13. GOVERNING LAW

This Agreement shall be governed by and construed in accordance with the laws of the State of Nebraska, USA. Any legal proceedings shall be filed in Douglas County, Nebraska.

14. CONTACT

playplacefinder@gmail.com
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
                        playgroundService.acceptTerms(submissionId, ADVERTISER_AGREEMENT_VERSION)
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
