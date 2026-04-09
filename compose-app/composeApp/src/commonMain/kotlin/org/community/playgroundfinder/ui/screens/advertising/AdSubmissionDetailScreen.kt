package org.community.playgroundfinder.ui.screens.advertising

import androidx.compose.foundation.clickable
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
import coil3.compose.AsyncImage
import kotlinx.coroutines.launch
import org.community.playgroundfinder.data.PlaygroundService

private val adminSettableSubmissionStatuses = listOf(
    "manual_review",
    "rejected",
    "revision_requested",
    "cancelled",
    "approved",
    "approved_pending_charge",
)

private fun adminSubmissionStatusLabel(status: String): String = when (status) {
    "manual_review" -> "Manual review (shows in queue)"
    "rejected" -> "Rejected"
    "revision_requested" -> "Revision requested"
    "cancelled" -> "Cancelled"
    "approved" -> "Approved"
    "approved_pending_charge" -> "Approved (payment pending)"
    else -> status.replace("_", " ").replaceFirstChar { it.uppercase() }
}

@Composable
fun AdSubmissionDetailScreen(
    playgroundService: PlaygroundService,
    submissionId: String,
    onComplete: () -> Unit,
    onBack: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var detail by remember { mutableStateOf<Map<String, Any?>>(emptyMap()) }
    var isLoading by remember { mutableStateOf(true) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var actionInProgress by remember { mutableStateOf(false) }
    var actionError by remember { mutableStateOf<String?>(null) }
    var showRejectDialog by remember { mutableStateOf(false) }
    var rejectReason by remember { mutableStateOf("") }
    var showRevisionDialog by remember { mutableStateOf(false) }
    var revisionMessage by remember { mutableStateOf("") }
    var showStatusFixDialog by remember { mutableStateOf(false) }
    var statusFixChoice by remember { mutableStateOf("rejected") }
    var statusFixNote by remember { mutableStateOf("") }

    fun loadDetail() {
        scope.launch {
            isLoading = true
            errorMessage = null
            try {
                detail = playgroundService.getAdSubmissionDetail(submissionId)
            } catch (e: Exception) {
                errorMessage = e.message ?: "Failed to load submission detail"
            }
            isLoading = false
        }
    }

    LaunchedEffect(submissionId) { loadDetail() }

    // Parse nested data from the Map response
    @Suppress("UNCHECKED_CAST")
    val submission = (detail["submission"] as? Map<String, Any?>) ?: detail
    @Suppress("UNCHECKED_CAST")
    val advertiser = (detail["advertiser"] as? Map<String, Any?>) ?: emptyMap()
    @Suppress("UNCHECKED_CAST")
    val creative = (detail["creative"] as? Map<String, Any?>) ?: emptyMap()
    @Suppress("UNCHECKED_CAST")
    val flags = (detail["flags"] as? List<Map<String, Any?>>)
        ?: (detail["reviewFlags"] as? List<Map<String, Any?>>)
        ?: emptyList()
    @Suppress("UNCHECKED_CAST")
    val packageInfo = submission["package"] as? Map<String, Any?> ?: emptyMap()

    Column(modifier = Modifier.fillMaxSize()) {
        // Header
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // Header provided by TopAppBar
        }

        Box(modifier = Modifier.fillMaxSize()) {
            when {
                isLoading -> CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))

                errorMessage != null -> Column(
                    modifier = Modifier.align(Alignment.Center).padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(
                        "\u26A0\uFE0F $errorMessage",
                        fontSize = 14.sp,
                        color = MaterialTheme.colorScheme.error,
                    )
                    Spacer(Modifier.height(12.dp))
                    TextButton(onClick = { loadDetail() }) { Text("Retry") }
                }

                else -> Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .verticalScroll(rememberScrollState())
                        .padding(horizontal = 20.dp, vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    // Advertiser Info
                    SectionCard(title = "Advertiser Info") {
                        DetailRow("Business Name", advertiser["businessName"]?.toString() ?: "\u2014")
                        DetailRow("Category", formatCategory(advertiser["category"]?.toString() ?: ""))
                        DetailRow("City", advertiser["city"]?.toString() ?: "\u2014")
                        DetailRow("Email", advertiser["contactEmail"]?.toString() ?: "\u2014")
                        DetailRow("Website", advertiser["websiteUrl"]?.toString() ?: "\u2014")
                    }

                    // Creative Preview
                    SectionCard(title = "Creative Preview") {
                        creative["imageUrl"]?.toString()?.takeIf { it.isNotBlank() }?.let { url ->
                            AsyncImage(
                                model = url,
                                contentDescription = "Ad creative image",
                                modifier = Modifier.fillMaxWidth().height(200.dp),
                            )
                            Spacer(Modifier.height(8.dp))
                        }
                        DetailRow("Headline", creative["headline"]?.toString() ?: "\u2014")
                        DetailRow("Body", creative["body"]?.toString() ?: "\u2014")
                        DetailRow("Button text", creative["ctaText"]?.toString() ?: "\u2014")
                        DetailRow("Button link (URL)", creative["ctaUrl"]?.toString() ?: "\u2014")
                    }

                    // Review Flags
                    if (flags.isNotEmpty()) {
                        SectionCard(title = "Review Flags (${flags.size})") {
                            flags.forEach { flag ->
                                val flagType = flag["flagType"]?.toString() ?: "unknown"
                                val description = flag["description"]?.toString() ?: ""
                                val severity = flag["severity"]?.toString() ?: "medium"
                                ReviewFlagItem(
                                    flagType = flagType,
                                    description = description,
                                    severity = severity,
                                )
                            }
                        }
                    }

                    // Package Info
                    SectionCard(title = "Package Info") {
                        val pkgType = packageInfo["type"]?.toString() ?: "\u2014"
                        val priceRaw = packageInfo["priceInCents"]
                        val price = formatCentsPrice(priceRaw)
                        val duration = packageInfo["durationDays"]?.toString() ?: "30"
                        DetailRow("Type", formatCategory(pkgType))
                        DetailRow("Price", price)
                        DetailRow("Duration", "$duration days")
                    }

                    val rawStatus = submission["status"]?.toString() ?: "\u2014"
                    SectionCard(title = "Submission status") {
                        DetailRow("Current", rawStatus.replace("_", " "))
                        Text(
                            "If the queue does not match what you did (e.g. Stripe errored), use the fix below. " +
                                "This only updates the database\u2014it does not move money.",
                            fontSize = 12.sp,
                            color = Color.Gray,
                        )
                        Spacer(Modifier.height(8.dp))
                        TextButton(
                            onClick = {
                                val s = submission["status"]?.toString()
                                statusFixChoice =
                                    if (s != null && s in adminSettableSubmissionStatuses) s else "rejected"
                                statusFixNote = ""
                                showStatusFixDialog = true
                            },
                            enabled = !actionInProgress,
                        ) {
                            Text("Fix submission status\u2026")
                        }
                    }

                    // Action Error
                    actionError?.let {
                        Text(it, color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
                    }

                    // Action Buttons
                    Column(
                        modifier = Modifier.fillMaxWidth().padding(bottom = 24.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            Button(
                                onClick = {
                                    scope.launch {
                                        actionInProgress = true
                                        actionError = null
                                        try {
                                            playgroundService.reviewAdSubmission(submissionId, "approve")
                                            onComplete()
                                        } catch (e: Exception) {
                                            actionError = "Approve failed: ${e.message}"
                                            actionInProgress = false
                                        }
                                    }
                                },
                                enabled = !actionInProgress,
                                modifier = Modifier.weight(1f),
                                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF4CAF50)),
                            ) { Text("\u2713 Approve") }

                            OutlinedButton(
                                onClick = { showRejectDialog = true },
                                enabled = !actionInProgress,
                                modifier = Modifier.weight(1f),
                                colors = ButtonDefaults.outlinedButtonColors(contentColor = Color(0xFFF44336)),
                            ) { Text("\u2717 Reject") }
                        }
                        OutlinedButton(
                            onClick = { showRevisionDialog = true },
                            enabled = !actionInProgress,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text("Request changes (releases payment hold)")
                        }
                    }
                }
            }
        }
    }

    if (showRevisionDialog) {
        AlertDialog(
            onDismissRequest = { showRevisionDialog = false },
            title = { Text("Request changes") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        "The advertiser can edit and resubmit. Uncaptured payments are released (same as reject for holds).",
                        fontSize = 13.sp,
                        color = Color.Gray,
                    )
                    OutlinedTextField(
                        value = revisionMessage,
                        onValueChange = { revisionMessage = it },
                        label = { Text("What should they fix?") },
                        modifier = Modifier.fillMaxWidth(),
                        minLines = 3,
                    )
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        showRevisionDialog = false
                        scope.launch {
                            actionInProgress = true
                            actionError = null
                            try {
                                playgroundService.requestAdSubmissionRevision(submissionId, revisionMessage)
                                onComplete()
                            } catch (e: Exception) {
                                actionError = "Request failed: ${e.message}"
                                actionInProgress = false
                            }
                        }
                    },
                    enabled = revisionMessage.trim().length >= 5,
                ) { Text("Send request") }
            },
            dismissButton = {
                TextButton(onClick = { showRevisionDialog = false }) { Text("Cancel") }
            },
        )
    }

    // Reject Dialog
    if (showRejectDialog) {
        AlertDialog(
            onDismissRequest = { showRejectDialog = false },
            title = { Text("Reject Submission") },
            text = {
                OutlinedTextField(
                    value = rejectReason,
                    onValueChange = { rejectReason = it },
                    label = { Text("Rejection reason") },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 2,
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    showRejectDialog = false
                    scope.launch {
                        actionInProgress = true
                        actionError = null
                        try {
                            playgroundService.reviewAdSubmission(
                                submissionId,
                                "reject",
                                rejectReason,
                            )
                            onComplete()
                        } catch (e: Exception) {
                            actionError = "Reject failed: ${e.message}"
                            actionInProgress = false
                        }
                    }
                }) { Text("Reject", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = {
                TextButton(onClick = { showRejectDialog = false }) { Text("Cancel") }
            },
        )
    }

    if (showStatusFixDialog) {
        AlertDialog(
            onDismissRequest = { showStatusFixDialog = false },
            title = { Text("Fix submission status") },
            text = {
                Column(
                    modifier = Modifier.fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text("Choose the correct status:", fontSize = 13.sp, color = Color.Gray)
                    adminSettableSubmissionStatuses.forEach { opt ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { statusFixChoice = opt },
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            RadioButton(
                                selected = statusFixChoice == opt,
                                onClick = { statusFixChoice = opt },
                            )
                            Spacer(Modifier.width(4.dp))
                            Text(adminSubmissionStatusLabel(opt), fontSize = 14.sp)
                        }
                    }
                    OutlinedTextField(
                        value = statusFixNote,
                        onValueChange = { statusFixNote = it },
                        label = { Text("Note (optional, audit log)") },
                        modifier = Modifier.fillMaxWidth(),
                        minLines = 2,
                    )
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        showStatusFixDialog = false
                        scope.launch {
                            actionInProgress = true
                            actionError = null
                            try {
                                playgroundService.adminSetAdSubmissionStatus(
                                    submissionId,
                                    statusFixChoice,
                                    statusFixNote.ifBlank { null },
                                )
                                loadDetail()
                                actionInProgress = false
                            } catch (e: Exception) {
                                actionError = "Status update failed: ${e.message}"
                                actionInProgress = false
                            }
                        }
                    },
                ) { Text("Apply") }
            },
            dismissButton = {
                TextButton(onClick = { showStatusFixDialog = false }) { Text("Cancel") }
            },
        )
    }
}

// ── Helper Composables ──

@Composable
private fun SectionCard(title: String, content: @Composable ColumnScope.() -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(title, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
            HorizontalDivider(modifier = Modifier.padding(vertical = 4.dp))
            content()
        }
    }
}

@Composable
private fun DetailRow(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth()) {
        Text(label, fontSize = 13.sp, color = Color.Gray, modifier = Modifier.width(100.dp))
        Text(value, fontSize = 13.sp, modifier = Modifier.weight(1f))
    }
}

@Composable
private fun ReviewFlagItem(flagType: String, description: String, severity: String) {
    val severityColor = when (severity) {
        "high" -> Color(0xFFF44336)
        "medium" -> Color(0xFFFF9800)
        "low" -> Color(0xFF4CAF50)
        else -> Color(0xFF757575)
    }

    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(8.dp),
        color = severityColor.copy(alpha = 0.08f),
    ) {
        Column(modifier = Modifier.padding(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    flagLabel(flagType),
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium,
                )
                Spacer(Modifier.weight(1f))
                Surface(
                    shape = RoundedCornerShape(12.dp),
                    color = severityColor.copy(alpha = 0.15f),
                ) {
                    Text(
                        severity.replaceFirstChar { it.uppercase() },
                        fontSize = 11.sp,
                        color = severityColor,
                        fontWeight = FontWeight.Medium,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
                    )
                }
            }
            if (description.isNotBlank()) {
                Spacer(Modifier.height(4.dp))
                Text(description, fontSize = 12.sp, color = Color.Gray)
            }
        }
    }
}

private fun flagLabel(flag: String): String = when (flag) {
    "suspicious_content" -> "\u26A0\uFE0F Suspicious Content"
    "no_online_presence" -> "\uD83C\uDF10 No Online Presence"
    "premium_placement" -> "\u2B50 Premium Placement"
    "duplicate_business" -> "\uD83D\uDD04 Duplicate Business"
    "validation_service_error" -> "\u274C Validation Error"
    else -> flag.replace("_", " ").replaceFirstChar { it.uppercase() }
}

private fun formatCategory(raw: String): String =
    raw.replace("_", " ").replaceFirstChar { it.uppercase() }

private fun formatCentsPrice(raw: Any?): String {
    if (raw == null) return "\u2014"
    val cents = when (raw) {
        is Number -> raw.toInt()
        is String -> raw.toIntOrNull() ?: return "\u2014"
        else -> return "\u2014"
    }
    val dollars = cents / 100
    val remainder = (cents % 100).toString().padStart(2, '0')
    return "\$$dollars.$remainder"
}
