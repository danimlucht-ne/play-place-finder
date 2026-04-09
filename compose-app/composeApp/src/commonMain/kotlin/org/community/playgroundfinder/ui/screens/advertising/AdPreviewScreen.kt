package org.community.playgroundfinder.ui.screens.advertising

import androidx.compose.foundation.background
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
import coil3.compose.AsyncImage
import kotlinx.coroutines.launch
import org.community.playgroundfinder.data.PlaygroundService
import org.community.playgroundfinder.models.AdCreative
import org.community.playgroundfinder.ui.composables.FormColors

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

    // Fetch submission + creative on load
    LaunchedEffect(submissionId) {
        isLoading = true
        errorMessage = null
        try {
            val sub = playgroundService.getSubmission(submissionId)
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
            "This is how your ad will appear in the app.",
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

                // Native ad card preview
                OutlinedCard(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(16.dp),
                    colors = CardDefaults.outlinedCardColors(
                        containerColor = MaterialTheme.colorScheme.surface,
                    ),
                ) {
                    Column {
                        // Sponsored/Event label
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 16.dp, vertical = 8.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                c.businessName,
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Medium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Surface(
                                shape = RoundedCornerShape(4.dp),
                                color = if (isEventPackage) androidx.compose.ui.graphics.Color(0xFFFF8F00) else MaterialTheme.colorScheme.secondaryContainer,
                            ) {
                                Text(
                                    if (isEventPackage) "Event" else "Sponsored",
                                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
                                    fontSize = 11.sp,
                                    color = if (isEventPackage) androidx.compose.ui.graphics.Color.White else MaterialTheme.colorScheme.onSecondaryContainer,
                                )
                            }
                        }

                        // Ad image
                        if (c.imageUrl.isNotBlank()) {
                            AsyncImage(
                                model = c.imageUrl,
                                contentDescription = "Ad image",
                                contentScale = ContentScale.Fit,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .heightIn(min = 120.dp, max = 300.dp)
                                    .background(MaterialTheme.colorScheme.surfaceVariant),
                            )
                        } else {
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(200.dp)
                                    .background(MaterialTheme.colorScheme.surfaceVariant),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(
                                    "No image",
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    fontSize = 14.sp,
                                )
                            }
                        }

                        // Text content
                        Column(
                            modifier = Modifier.padding(16.dp),
                            verticalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            // Headline
                            Text(
                                c.headline,
                                fontSize = 18.sp,
                                fontWeight = FontWeight.Bold,
                            )

                            // Body
                            Text(
                                c.body,
                                fontSize = 14.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )

                            Spacer(Modifier.height(4.dp))

                            // Action button (non-interactive in preview)
                            Button(
                                onClick = { /* preview only */ },
                                shape = RoundedCornerShape(12.dp),
                                enabled = false,
                                colors = ButtonDefaults.buttonColors(
                                    disabledContainerColor = FormColors.PrimaryButton.copy(alpha = 0.8f),
                                    disabledContentColor = FormColors.PrimaryButtonText,
                                ),
                            ) {
                                Text(c.ctaText, fontWeight = FontWeight.Medium)
                            }
                        }
                    }
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
