package org.community.playgroundfinder.ui.screens.advertising

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
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
import org.community.playgroundfinder.models.AdSubmission
import org.community.playgroundfinder.ui.screens.admin.AdminEmptyQueueMessage

@Composable
fun AdReviewQueueScreen(
    playgroundService: PlaygroundService,
    onItemClick: (String) -> Unit,
    onBack: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var submissions by remember { mutableStateOf<List<AdSubmission>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    fun reload() {
        scope.launch {
            isLoading = true
            errorMessage = null
            try {
                submissions = playgroundService.getAdReviewQueue()
            } catch (e: Exception) {
                errorMessage = e.message ?: "Failed to load review queue"
            }
            isLoading = false
        }
    }

    LaunchedEffect(Unit) { reload() }

    Scaffold(
        containerColor = Color(0xFFF0F4F7),
        contentColor = Color(0xFF1A1A1A),
    ) { padding ->
    Column(modifier = Modifier.fillMaxSize().padding(padding)) {
        // Header provided by TopAppBar

        Box(modifier = Modifier.fillMaxSize()) {
            when {
                isLoading -> CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))

                errorMessage != null -> Column(
                    modifier = Modifier.align(Alignment.Center).padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text("⚠️ $errorMessage", fontSize = 14.sp, color = MaterialTheme.colorScheme.error)
                    Spacer(Modifier.height(12.dp))
                    TextButton(onClick = { reload() }) { Text("Retry") }
                }

                submissions.isEmpty() -> AdminEmptyQueueMessage(
                    modifier = Modifier.align(Alignment.Center),
                    onRefresh = { reload() },
                )

                else -> LazyColumn(
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(submissions) { submission ->
                        AdReviewQueueItem(
                            submission = submission,
                            onClick = { onItemClick(submission._id) },
                        )
                    }
                }
            }
        }
    }
    }
}

@Composable
private fun AdReviewQueueItem(
    submission: AdSubmission,
    onClick: () -> Unit,
) {
    val flagTypes = submission.validationResult?.flags ?: emptyList()
    val packageType = submission.`package`?.type ?: "unknown"

    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = Color.White),
        elevation = CardDefaults.cardElevation(defaultElevation = 3.dp),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("🔍", fontSize = 24.sp, modifier = Modifier.width(36.dp))
                Spacer(Modifier.width(8.dp))
                Column(modifier = Modifier.weight(1f)) {
                    val title = submission.reviewDisplayName.trim().ifBlank {
                        "Submission ${submission._id.takeLast(8)}"
                    }
                    Text(
                        title,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 15.sp,
                    )
                    Text(
                        packageType.replace("_", " ").replaceFirstChar { it.uppercase() },
                        style = MaterialTheme.typography.bodySmall,
                        color = Color(0xFF424242),
                    )
                }
                // Status badge
                Surface(
                    shape = RoundedCornerShape(20.dp),
                    color = Color(0xFFFFF3E0),
                ) {
                    Text(
                        "Manual Review",
                        fontSize = 11.sp,
                        color = Color(0xFFE65100),
                        fontWeight = FontWeight.Medium,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                    )
                }
            }

            Spacer(Modifier.height(8.dp))

            // Flag chips
            if (flagTypes.isNotEmpty()) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    flagTypes.forEach { flag ->
                        Surface(
                            shape = RoundedCornerShape(8.dp),
                            color = flagColor(flag).copy(alpha = 0.12f),
                        ) {
                            Text(
                                flagLabel(flag),
                                fontSize = 11.sp,
                                color = flagColor(flag),
                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                            )
                        }
                    }
                }
                Spacer(Modifier.height(6.dp))
            }

            // Submitted date
            if (submission.createdAt.isNotBlank()) {
                Text(
                    "Submitted: ${submission.createdAt.take(10)}",
                    fontSize = 12.sp,
                    color = Color(0xFF616161),
                )
            }
        }
    }
}

private fun flagLabel(flag: String): String = when (flag) {
    "suspicious_content" -> "⚠️ Suspicious Content"
    "no_online_presence" -> "🌐 No Online Presence"
    "premium_placement" -> "⭐ Premium Placement"
    "duplicate_business" -> "🔄 Duplicate Business"
    "validation_service_error" -> "❌ Validation Error"
    else -> flag.replace("_", " ").replaceFirstChar { it.uppercase() }
}

private fun flagColor(flag: String): Color = when (flag) {
    "suspicious_content" -> Color(0xFFF44336)
    "no_online_presence" -> Color(0xFFFF9800)
    "premium_placement" -> Color(0xFF2196F3)
    "duplicate_business" -> Color(0xFF9C27B0)
    "validation_service_error" -> Color(0xFFF44336)
    else -> Color(0xFF757575)
}
