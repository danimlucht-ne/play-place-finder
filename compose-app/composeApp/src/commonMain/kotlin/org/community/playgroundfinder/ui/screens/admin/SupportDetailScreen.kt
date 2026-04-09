package org.community.playgroundfinder.ui.screens.admin

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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.community.playgroundfinder.data.Playground
import org.community.playgroundfinder.data.PlaygroundService
import org.community.playgroundfinder.ui.composables.FormColors

@Composable
fun SupportDetailScreen(
    service: PlaygroundService,
    ticketId: String,
    onComplete: () -> Unit,
    onNavigateToPlayground: (Playground) -> Unit = {},
) {
    val scope = rememberCoroutineScope()
    var ticket by remember { mutableStateOf<Map<String, Any?>>(emptyMap()) }
    var isLoading by remember { mutableStateOf(true) }
    var resolutionReason by remember { mutableStateOf("") }
    var showResolveDialog by remember { mutableStateOf(false) }
    var showRejectDialog by remember { mutableStateOf(false) }
    var showApproveSuggestionDialog by remember { mutableStateOf(false) }
    var approveFinalLabel by remember { mutableStateOf("") }
    var actionInProgress by remember { mutableStateOf(false) }
    var actionError by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(ticketId) {
        try { ticket = service.getSupportTicket(ticketId) } catch (_: Exception) {}
        isLoading = false
    }

    val ticketType = ticket["ticketType"]?.toString() ?: ""
    val status = ticket["status"]?.toString() ?: ""
    val isResolved = status in listOf("RESOLVED", "REJECTED")
    val isSuggestion = ticketType.equals("suggestion", ignoreCase = true)

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(FormColors.ScreenBackground),
    ) {
        if (isLoading) {
            CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
        } else {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(16.dp),
                    colors = CardDefaults.cardColors(containerColor = FormColors.CardBackground),
                    elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
                ) {
                    Column(
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text(
                                ticketTypeLabel(ticketType),
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.SemiBold,
                                color = MaterialTheme.colorScheme.onSurface,
                                modifier = Modifier.weight(1f).padding(end = 8.dp),
                            )
                            StatusChip(status)
                        }
                        formatSupportSubmittedAt(ticket["createdAt"]?.toString())?.let { line ->
                            SupportMetaRow("Submitted", line)
                        }
                        ticket["actorUserId"]?.toString()?.trim()?.takeIf { it.isNotBlank() }?.let { uid ->
                            SupportMetaRow("Account ID", uid)
                        }
                        @Suppress("UNCHECKED_CAST")
                        val actorProfile = ticket["actorProfile"] as? Map<String, Any?>
                        if (actorProfile != null) {
                            HorizontalDivider(color = FormColors.SubtleDivider)
                            Text(
                                "Reporter (from account)",
                                style = MaterialTheme.typography.labelLarge,
                                fontWeight = FontWeight.SemiBold,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            val em = actorProfile["email"]?.toString()?.takeIf { it.isNotBlank() }
                            val dn = actorProfile["displayName"]?.toString()?.takeIf { it.isNotBlank() }
                            SupportMetaRow("Email", em ?: "—")
                            SupportMetaRow(
                                "Public display name",
                                dn ?: "Anonymous / not set",
                            )
                        }
                    }
                }

                val kind = ticket["targetKind"]?.toString()?.trim()
                val targetId = ticket["targetId"]?.toString()?.trim()
                val showPlayground = kind.equals("playground", ignoreCase = true) &&
                    !targetId.isNullOrBlank() && !targetId.equals("null", ignoreCase = true)
                @Suppress("UNCHECKED_CAST")
                val pgSum = ticket["targetPlaygroundSummary"] as? Map<String, Any?>
                if (showPlayground) {
                    val pgId = pgSum?.get("id")?.toString()?.trim()?.takeIf { it.isNotBlank() } ?: targetId!!.trim()
                    val pgName = pgSum?.get("name")?.toString()?.trim()?.takeIf { it.isNotEmpty() } ?: "Unknown place"
                    val city = pgSum?.get("city")?.toString()?.trim().orEmpty()
                    val st = pgSum?.get("state")?.toString()?.trim().orEmpty()
                    val rk = pgSum?.get("regionKey")?.toString()?.trim().orEmpty()
                    val ptype = pgSum?.get("playgroundType")?.toString()?.trim().orEmpty()
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
                                "Playground",
                                style = MaterialTheme.typography.labelLarge,
                                fontWeight = FontWeight.SemiBold,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Text(
                                pgName,
                                style = MaterialTheme.typography.titleSmall,
                                fontWeight = FontWeight.SemiBold,
                                color = MaterialTheme.colorScheme.onSurface,
                            )
                            val locLine = listOf(city, st).filter { it.isNotBlank() }.joinToString(", ")
                            if (locLine.isNotBlank()) {
                                Text(
                                    locLine,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            if (rk.isNotBlank()) SupportMetaRow("Region", rk)
                            if (ptype.isNotBlank()) SupportMetaRow("Location type", ptype)
                            SupportMetaRow("ID", pgId)
                            Spacer(Modifier.height(4.dp))
                            Text(
                                "Open in app",
                                style = MaterialTheme.typography.labelLarge,
                                fontWeight = FontWeight.SemiBold,
                                color = FormColors.PrimaryButton,
                                modifier = Modifier
                                    .clickable(enabled = !actionInProgress) {
                                        onNavigateToPlayground(
                                            Playground(
                                                id = pgId,
                                                name = pgName,
                                                city = city.ifBlank { null },
                                                state = st.ifBlank { null },
                                                regionKey = rk.ifBlank { null },
                                            ),
                                        )
                                    }
                                    .padding(vertical = 4.dp),
                            )
                        }
                    }
                }

                if (isSuggestion) {
                    val sc = ticket["suggestionCategory"]?.toString()?.trim().orEmpty()
                    val sl = ticket["suggestionLabel"]?.toString()?.trim().orEmpty()
                    if (sc.isNotEmpty() || sl.isNotEmpty()) {
                        Card(
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(16.dp),
                            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                            elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
                        ) {
                            Column(
                                modifier = Modifier.padding(16.dp),
                                verticalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                Text(
                                    "Suggested label",
                                    style = MaterialTheme.typography.labelLarge,
                                    fontWeight = FontWeight.SemiBold,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                                if (sc.isNotEmpty()) SupportMetaRow("Category", sc)
                                if (sl.isNotEmpty()) SupportMetaRow("Name", sl)
                            }
                        }
                    }
                }

                Text(
                    "Message",
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(16.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                    elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
                ) {
                    Text(
                        ticket["message"]?.toString()?.trim()?.takeIf { it.isNotEmpty() }
                            ?: "No message provided.",
                        modifier = Modifier.padding(16.dp),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                        lineHeight = 22.sp,
                    )
                }

                ticket["resolutionReason"]?.toString()?.trim()?.takeIf {
                    it.isNotEmpty() && !it.equals("null", ignoreCase = true)
                }?.let { reason ->
                    Text(
                        "Resolution notes",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(16.dp),
                        colors = CardDefaults.cardColors(
                            containerColor = MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.45f),
                        ),
                        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
                    ) {
                        Text(
                            reason,
                            modifier = Modifier.padding(16.dp),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSecondaryContainer,
                            lineHeight = 22.sp,
                        )
                    }
                }

                if (!isResolved) {
                    Spacer(Modifier.height(4.dp))
                    if (isSuggestion) {
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Button(
                                onClick = {
                                    approveFinalLabel = ticket["suggestionLabel"]?.toString()?.trim().orEmpty()
                                    showApproveSuggestionDialog = true
                                },
                                enabled = !actionInProgress,
                                modifier = Modifier.weight(1f).height(48.dp),
                                shape = RoundedCornerShape(12.dp),
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = Color(0xFF2E7D32),
                                    contentColor = Color.White,
                                ),
                            ) { Text("Approve & apply", fontWeight = FontWeight.SemiBold) }

                            OutlinedButton(
                                onClick = { showRejectDialog = true },
                                enabled = !actionInProgress,
                                modifier = Modifier.weight(1f).height(48.dp),
                                shape = RoundedCornerShape(12.dp),
                                border = BorderStroke(1.dp, MaterialTheme.colorScheme.error),
                                colors = ButtonDefaults.outlinedButtonColors(
                                    contentColor = MaterialTheme.colorScheme.error,
                                ),
                            ) { Text("\u2717 Decline", fontWeight = FontWeight.SemiBold) }
                        }
                    } else {
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Button(
                                onClick = { showResolveDialog = true },
                                enabled = !actionInProgress,
                                modifier = Modifier.weight(1f).height(48.dp),
                                shape = RoundedCornerShape(12.dp),
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = Color(0xFF2E7D32),
                                    contentColor = Color.White,
                                ),
                            ) { Text("\u2713 Resolve", fontWeight = FontWeight.SemiBold) }

                            OutlinedButton(
                                onClick = { showRejectDialog = true },
                                enabled = !actionInProgress,
                                modifier = Modifier.weight(1f).height(48.dp),
                                shape = RoundedCornerShape(12.dp),
                                colors = ButtonDefaults.outlinedButtonColors(
                                    contentColor = MaterialTheme.colorScheme.error,
                                ),
                            ) { Text("\u2717 Reject", fontWeight = FontWeight.SemiBold) }
                        }
                    }
                }
                actionError?.let {
                    Text(
                        it,
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        }
    }

    if (showResolveDialog) {
        ResolutionDialog(
            title = "Resolve Ticket",
            reason = resolutionReason,
            onReasonChange = { resolutionReason = it },
            notesLabel = "Notes (optional)",
            onConfirm = {
                showResolveDialog = false
                scope.launch {
                    actionInProgress = true
                    actionError = null
                    try {
                        service.resolveSupportTicket(ticketId, resolutionReason)
                        onComplete()
                    } catch (e: Exception) {
                        actionError = "Resolve failed: ${e.message}"
                        actionInProgress = false
                    }
                }
            },
            onDismiss = { showResolveDialog = false }
        )
    }

    if (showRejectDialog) {
        ResolutionDialog(
            title = if (isSuggestion) "Decline suggestion" else "Reject ticket",
            reason = resolutionReason,
            onReasonChange = { resolutionReason = it },
            notesLabel = if (isSuggestion) {
                "Note to the submitter (they will see this)"
            } else {
                "Notes (optional)"
            },
            onConfirm = {
                showRejectDialog = false
                scope.launch {
                    actionInProgress = true
                    actionError = null
                    try {
                        service.rejectSupportTicket(ticketId, resolutionReason)
                        onComplete()
                    } catch (e: Exception) {
                        actionError = "Reject failed: ${e.message}"
                        actionInProgress = false
                    }
                }
            },
            onDismiss = { showRejectDialog = false }
        )
    }

    if (showApproveSuggestionDialog) {
        AlertDialog(
            onDismissRequest = { if (!actionInProgress) showApproveSuggestionDialog = false },
            title = { Text("Approve & apply") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        "Adds the label to this playground and the global option list, awards points, and notifies the submitter.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    OutlinedTextField(
                        value = approveFinalLabel,
                        onValueChange = { approveFinalLabel = it },
                        label = { Text("Label as stored (edit spelling if needed)") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        enabled = !actionInProgress,
                    )
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        showApproveSuggestionDialog = false
                        scope.launch {
                            actionInProgress = true
                            actionError = null
                            try {
                                service.approveSupportSuggestion(
                                    ticketId,
                                    approveFinalLabel.trim().takeIf { it.isNotEmpty() },
                                )
                                onComplete()
                            } catch (e: Exception) {
                                actionError = "Approve failed: ${e.message}"
                                actionInProgress = false
                            }
                        }
                    },
                    enabled = !actionInProgress && approveFinalLabel.isNotBlank(),
                ) { Text("Confirm") }
            },
            dismissButton = {
                TextButton(
                    onClick = { showApproveSuggestionDialog = false },
                    enabled = !actionInProgress,
                ) { Text("Cancel") }
            },
        )
    }
}

@Composable
private fun StatusChip(status: String) {
    val (color, label) = when (status.uppercase()) {
        "RESOLVED" -> Color(0xFF2E7D32) to "Resolved"
        "REJECTED" -> Color(0xFFC62828) to "Rejected"
        else -> Color(0xFFE65100) to "Pending"
    }
    Surface(
        shape = RoundedCornerShape(10.dp),
        color = color.copy(alpha = 0.14f),
        border = BorderStroke(1.dp, color.copy(alpha = 0.35f)),
    ) {
        Text(
            label,
            style = MaterialTheme.typography.labelMedium,
            color = color,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
        )
    }
}

@Composable
private fun SupportMetaRow(label: String, value: String) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(
            label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            value,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurface,
        )
    }
}

private fun formatSupportSubmittedAt(raw: String?): String? {
    val s = raw?.trim()?.removeSuffix("Z")?.removeSuffix("z") ?: return null
    if (s.isEmpty()) return null
    val date = s.take(10)
    val rest = s.substringAfter("T", "")
    val time = rest.substringBefore(".").substringBefore("+").ifBlank { rest.take(8) }
    return if (time.isNotEmpty()) "$date · $time UTC" else date
}

private fun ticketTypeLabel(type: String) = when (type.lowercase()) {
    "question" -> "❓ Question"
    "complaint" -> "😤 Complaint"
    "request_update" -> "✏️ Update Request"
    "report_issue", "content_issue" -> "🚩 Issue Report"
    "removal_request" -> "🗑️ Removal Request"
    "suggestion" -> "💡 Suggestion"
    "claim" -> "🏢 Claim Listing"
    else -> "📋 Support Ticket"
}

@Composable
private fun ResolutionDialog(
    title: String,
    reason: String,
    onReasonChange: (String) -> Unit,
    notesLabel: String = "Notes (optional)",
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            OutlinedTextField(
                value = reason,
                onValueChange = onReasonChange,
                label = { Text(notesLabel) },
                modifier = Modifier.fillMaxWidth(),
                minLines = 2
            )
        },
        confirmButton = { TextButton(onClick = onConfirm) { Text("Confirm") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } }
    )
}