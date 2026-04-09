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
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.community.playgroundfinder.data.PlaygroundService
import org.community.playgroundfinder.models.AdCreative
import org.community.playgroundfinder.ui.composables.FormColors
import org.community.playgroundfinder.ui.composables.SponsoredListingCard

private fun adPreviewCardTitle(c: AdCreative, isEvent: Boolean): String {
    if (isEvent && c.headline.isNotBlank()) return c.headline.trim()
    val bn = c.businessName.trim()
    if (bn.isNotBlank()) return bn
    return c.headline.trim().ifBlank { "Sponsored" }
}

@Composable
fun AdPreviewScreen(
    playgroundService: PlaygroundService,
    submissionId: String,
    onContinueToTerms: () -> Unit,
    onBack: () -> Unit,
) {
    val scope = rememberCoroutineScope()

    var creative by remember { mutableStateOf<AdCreative?>(null) }
    var isLoading by remember { mutableStateOf(true) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var isAdvancing by remember { mutableStateOf(false) }
    var isEventPackage by remember { mutableStateOf(false) }
    /** `featured_home` vs `inline_listing` / event packages — drives preview geometry. */
    var packagePlacement by remember { mutableStateOf("") }

    // Fetch submission + creative on load
    LaunchedEffect(submissionId) {
        isLoading = true
        errorMessage = null
        try {
            val sub = playgroundService.getSubmission(submissionId)
            packagePlacement = sub.`package`?.type?.trim().orEmpty()
            isEventPackage = sub.`package`?.type?.startsWith("event_spotlight") == true
            try {
                creative = playgroundService.getAdCreative(submissionId)
            } catch (_: Exception) {
                // Creative not yet linked — this can happen if step 3 save had issues
                creative = null
            }
            // If creative loaded but has empty fields, show error
            if (creative != null && creative!!.headline.isBlank() && creative!!.body.isBlank()) {
                errorMessage = "Creative data appears empty. Please go back and re-enter your ad content."
                creative = null
            }
        } catch (e: Exception) {
            errorMessage = e.message ?: "Failed to load preview"
        } finally {
            isLoading = false
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            "Preview your creative before you accept terms.",
            fontSize = 14.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        Spacer(Modifier.height(4.dp))

        when {
            isLoading -> {
                Box(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 48.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator()
                }
            }

            errorMessage != null -> {
                Text(
                    errorMessage ?: "Unknown error",
                    color = FormColors.ErrorText,
                    fontSize = 14.sp,
                )
                Spacer(Modifier.height(8.dp))
                OutlinedButton(onClick = onBack) {
                    Text("Go Back & Edit")
                }
            }

            creative != null -> {
                val c = creative!!
                val isPrime = packagePlacement == "featured_home" ||
                    (isEventPackage && packagePlacement.endsWith("_home"))

                Text(
                    text = if (isPrime) {
                        "Prime / home-hero layout: image on the left, copy and CTA on the right (same as the " +
                            "sponsored row at the top of Home). If several businesses run prime ads, Home may rotate between them in that row."
                    } else {
                        val label = if (isEventPackage) {
                            "Event Spotlight (Calendar / Inline)"
                        } else {
                            "Inline (All Sites & search-style lists)"
                        }
                        "$label: same side-by-side card — image left, title and body on the right, with Ad/Event and Learn More on the bottom row."
                    },
                    fontSize = 14.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    lineHeight = 20.sp,
                )

                Text(
                    "Layout preview",
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurface,
                )

                val previewTitle = adPreviewCardTitle(c, isEventPackage)
                if (isPrime) {
                    SponsoredListingCard(
                        businessName = previewTitle,
                        category = c.businessCategory.takeIf { it.isNotBlank() },
                        description = c.body.takeIf { it.isNotBlank() },
                        websiteUrl = c.ctaUrl.takeIf { it.isNotBlank() },
                        onLearnMore = { },
                        isEvent = isEventPackage,
                        imageUrl = c.imageUrl.takeIf { it.isNotBlank() },
                        showCategory = false,
                        imageContentScale = ContentScale.Fit,
                        imageAlignment = c.imageAlignment,
                        matchCarouselMinHeight = true,
                    )
                } else {
                    SponsoredListingCard(
                        businessName = previewTitle,
                        category = c.businessCategory.takeIf { it.isNotBlank() },
                        description = c.body.takeIf { it.isNotBlank() },
                        websiteUrl = c.ctaUrl.takeIf { it.isNotBlank() },
                        onLearnMore = { },
                        isEvent = isEventPackage,
                        imageUrl = c.imageUrl.takeIf { it.isNotBlank() },
                        showCategory = false,
                        imageContentScale = ContentScale.Fit,
                        imageAlignment = c.imageAlignment,
                        matchCarouselMinHeight = false,
                    )
                }

                Spacer(Modifier.height(8.dp))

                // Continue to Terms button
                Button(
                    onClick = {
                        scope.launch {
                            isAdvancing = true
                            errorMessage = null
                            try {
                                // Advance to step 4 (preview acknowledged)
                                playgroundService.updateSubmission(
                                    submissionId,
                                    mapOf("step" to 4),
                                )
                                onContinueToTerms()
                            } catch (e: Exception) {
                                errorMessage = e.message ?: "Something went wrong. Please try again."
                            } finally {
                                isAdvancing = false
                            }
                        }
                    },
                    enabled = !isAdvancing,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(52.dp),
                    shape = RoundedCornerShape(16.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Color(0xFF5E5E5E),
                        contentColor = Color.White,
                    ),
                ) {
                    if (isAdvancing) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(20.dp),
                            color = Color.White,
                            strokeWidth = 2.dp,
                        )
                    } else {
                        Text("Continue to Terms", fontWeight = FontWeight.Bold)
                    }
                }
            }

            else -> {
                Text(
                    "We could not load your ad creative. Go back to the creative step, save again, then return to preview.",
                    fontSize = 14.sp,
                    color = FormColors.ErrorText,
                )
                Spacer(Modifier.height(8.dp))
                OutlinedButton(onClick = onBack) {
                    Text("Go Back & Edit")
                }
            }
        }
    }
}
