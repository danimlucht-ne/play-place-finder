package org.community.playgroundfinder.ui.screens.advertising

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import kotlinx.coroutines.launch
import org.community.playgroundfinder.data.PlaygroundService
import org.community.playgroundfinder.ui.composables.FormColors

private val adminSettableSubmissionStatuses = listOf(
    "manual_review",
    "rejected",
    "revision_requested",
    "cancelled",
    "approved",
    "approved_pending_charge",
)

private fun adminSubmissionStatusLabel(status: String): String {
    val s = status.trim()
    if (s.isEmpty() || s == "\u2014") return "\u2014"
    return when (s) {
        "manual_review" -> "Manual review (in queue)"
        "rejected" -> "Rejected"
        "revision_requested" -> "Revision requested"
        "cancelled" -> "Cancelled"
        "approved" -> "Approved"
        "approved_pending_charge" -> "Approved (payment pending)"
        else -> s.replace("_", " ").replaceFirstChar { it.uppercase() }
    }
}

private fun cleanDisplay(raw: String?): String {
    val t = raw?.trim() ?: return "\u2014"
    if (t.isEmpty() || t.equals("null", ignoreCase = true)) return "\u2014"
    return t
}

private fun formatDurationDays(raw: Any?): String {
    if (raw == null) return "\u2014"
    val num = when (raw) {
        is Number -> raw.toDouble()
        is String -> raw.toDoubleOrNull() ?: return cleanDisplay(raw)
        else -> return "\u2014"
    }
    val whole = num.toInt()
    return if (kotlin.math.abs(num - whole) < 0.001) {
        if (whole == 1) "1 day" else "$whole days"
    } else {
        "%.1f days".format(num)
    }
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

    Column(modifier = Modifier.fillMaxSize().background(FormColors.ScreenBackground)) {
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
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    if (flags.isNotEmpty()) {
                        SectionCard(title = "Review flags (${flags.size})") {
                            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
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
                    }

                    SectionCard(title = "Package") {
                        val pkgType = packageInfo["type"]?.toString()
                        val priceRaw = packageInfo["priceInCents"]
                        val price = formatCentsPrice(priceRaw)
                        val durationStr = formatDurationDays(packageInfo["durationDays"])
                        DetailRow("Type", formatCategory(cleanDisplay(pkgType)))
                        DetailRow("Price", price)
                        DetailRow("Duration", durationStr)
                    }

                    val rawStatus = submission["status"]?.toString()
                    SectionCard(title = "Submission status") {
                        DetailRow("Current", adminSubmissionStatusLabel(cleanDisplay(rawStatus)))
                        Text(
                            "If the queue does not match what you expect (for example after a Stripe error), use Fix status below. " +
                                "That only updates the database; it does not move money.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            lineHeight = 18.sp,
                        )
                        Spacer(Modifier.height(4.dp))
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

                    SectionCard(title = "Advertiser") {
                        DetailRow("Business name", cleanDisplay(advertiser["businessName"]?.toString()))
                        DetailRow("Category", formatCategory(cleanDisplay(advertiser["category"]?.toString())))
                        DetailRow("City", cleanDisplay(advertiser["city"]?.toString()))
                        DetailRow("Email", cleanDisplay(advertiser["contactEmail"]?.toString()))
                        DetailRow("Website", cleanDisplay(advertiser["websiteUrl"]?.toString()))
                    }

                    SectionCard(title = "Creative") {
                        creative["imageUrl"]?.toString()?.takeIf { it.isNotBlank() }?.let { url ->
                            AsyncImage(
                                model = url,
                                contentDescription = "Ad creative image",
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .heightIn(max = 220.dp)
                                    .clip(RoundedCornerShape(10.dp)),
                                contentScale = ContentScale.Crop,
                            )
                            Spacer(Modifier.height(10.dp))
                        }
                        DetailRow("Headline", cleanDisplay(creative["headline"]?.toString()))
                        DetailRow("Body", cleanDisplay(creative["body"]?.toString()))
                        DetailRow("Button text", cleanDisplay(creative["ctaText"]?.toString()))
                        DetailRow("Button link", cleanDisplay(creative["ctaUrl"]?.toString()))
                    }

                    // Action Error
                    actionError?.let {
                        Text(it, color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
                    }

                    // Action Buttons
                    Column(
                        modifier = Modifier.fillMaxWidth().padding(bottom = 28.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
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
                                modifier = Modifier.weight(1f).height(48.dp),
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = Color(0xFF2E7D32),
                                    contentColor = Color.White,
                                ),
                                shape = RoundedCornerShape(12.dp),
                            ) { Text("\u2713 Approve", fontWeight = FontWeight.SemiBold) }

                            OutlinedButton(
                                onClick = { showRejectDialog = true },
                                enabled = !actionInProgress,
                                modifier = Modifier.weight(1f).height(48.dp),
                                shape = RoundedCornerShape(12.dp),
                                border = BorderStroke(1.dp, MaterialTheme.colorScheme.error),
                                colors = ButtonDefaults.outlinedButtonColors(
                                    contentColor = MaterialTheme.colorScheme.error,
                                ),
                            ) { Text("\u2717 Reject", fontWeight = FontWeight.SemiBold) }
                        }
                        FilledTonalButton(
                            onClick = { showRevisionDialog = true },
                            enabled = !actionInProgress,
                            modifier = Modifier.fillMaxWidth().height(48.dp),
                            shape = RoundedCornerShape(12.dp),
                            colors = ButtonDefaults.filledTonalButtonColors(
                                containerColor = FormColors.PrimaryButton.copy(alpha = 0.18f),
                                contentColor = FormColors.BodyText,
                            ),
                        ) {
                            Text("Request changes (releases payment hold)", fontWeight = FontWeight.Medium)
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
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = FormColors.CardBackground),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                title,
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurface,
            )
            HorizontalDivider(color = FormColors.SubtleDivider)
            content()
        }
    }
}

@Composable
private fun DetailRow(label: String, value: String) {
    val display = if (value.isBlank() || value.equals("null", ignoreCase = true)) "\u2014" else value
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Text(
            label,
            modifier = Modifier.widthIn(min = 112.dp, max = 132.dp),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            display,
            modifier = Modifier.weight(1f).padding(start = 10.dp),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurface,
        )
    }
}

@Composable
private fun ReviewFlagItem(flagType: String, description: String, severity: String) {
    val severityColor = when (severity.lowercase()) {
        "high" -> Color(0xFFC62828)
        "medium" -> Color(0xFFE65100)
        "low" -> Color(0xFF2E7D32)
        else -> Color(0xFF546E7A)
    }
    val borderColor = severityColor.copy(alpha = 0.45f)

    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 0.dp,
        shadowElevation = 0.dp,
        border = BorderStroke(1.dp, borderColor),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(IntrinsicSize.Min),
        ) {
            Box(
                modifier = Modifier
                    .width(4.dp)
                    .fillMaxHeight()
                    .background(severityColor),
            )
            Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text(
                        flagLabel(flagType),
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurface,
                        modifier = Modifier.weight(1f).padding(end = 8.dp),
                    )
                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = severityColor.copy(alpha = 0.14f),
                    ) {
                        Text(
                            severity.replaceFirstChar { it.uppercase() },
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
                            style = MaterialTheme.typography.labelSmall,
                            fontWeight = FontWeight.SemiBold,
                            color = severityColor,
                        )
                    }
                }
                if (description.isNotBlank()) {
                    Spacer(Modifier.height(6.dp))
                    Text(
                        description,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        lineHeight = 18.sp,
                    )
                }
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
