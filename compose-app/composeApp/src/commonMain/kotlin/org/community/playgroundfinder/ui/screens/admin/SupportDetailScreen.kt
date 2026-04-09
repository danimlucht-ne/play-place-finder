package org.community.playgroundfinder.ui.screens.admin

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

@Composable
fun SupportDetailScreen(
    service: PlaygroundService,
    ticketId: String,
    onComplete: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var ticket by remember { mutableStateOf<Map<String, Any>>(emptyMap()) }
    var isLoading by remember { mutableStateOf(true) }
    var resolutionReason by remember { mutableStateOf("") }
    var showResolveDialog by remember { mutableStateOf(false) }
    var showRejectDialog by remember { mutableStateOf(false) }
    var actionInProgress by remember { mutableStateOf(false) }
    var actionError by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(ticketId) {
        try { ticket = service.getSupportTicket(ticketId) } catch (_: Exception) {}
        isLoading = false
    }

    val ticketType = ticket["ticketType"]?.toString() ?: ""
    val status = ticket["status"]?.toString() ?: ""
    val isResolved = status in listOf("RESOLVED", "REJECTED")

    Box(modifier = Modifier.fillMaxSize()) {
        if (isLoading) {
            CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
        } else {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                // Header
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        ticketTypeLabel(ticketType),
                        fontWeight = FontWeight.Bold,
                        fontSize = 18.sp,
                        modifier = Modifier.weight(1f)
                    )
                    StatusChip(status)
                }

                ticket["createdAt"]?.let {
                    Text("Submitted: $it", fontSize = 12.sp, color = Color.Gray)
                }

                ticket["targetKind"]?.toString()?.takeIf { it.isNotBlank() }?.let { kind ->
                    val targetId = ticket["targetId"]?.toString() ?: ""
                    Text("Target: $kind — $targetId", fontSize = 12.sp, color = FormColors.PrimaryButton)
                }

                Divider()

                // Message
                Text("Message", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(8.dp),
                    colors = CardDefaults.cardColors(containerColor = FormColors.MutedCardBackground)
                ) {
                    Text(
                        ticket["message"]?.toString() ?: "(no message)",
                        modifier = Modifier.padding(12.dp),
                        fontSize = 14.sp
                    )
                }

                // Resolution notes if already resolved
                ticket["resolutionReason"]?.toString()?.takeIf { it.isNotBlank() }?.let { reason ->
                    Text("Resolution Notes", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(8.dp),
                        colors = CardDefaults.cardColors(containerColor = Color(0xFFFFF9C4))
                    ) {
                        Text(reason, modifier = Modifier.padding(12.dp), fontSize = 13.sp)
                    }
                }

                if (!isResolved) {
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Button(
                            onClick = { showResolveDialog = true },
                            enabled = !actionInProgress,
                            modifier = Modifier.weight(1f),
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF4CAF50))
                        ) { Text("✓ Resolve") }

                        OutlinedButton(
                            onClick = { showRejectDialog = true },
                            enabled = !actionInProgress,
                            modifier = Modifier.weight(1f)
                        ) { Text("✗ Reject") }
                    }
                }
                actionError?.let {
                    Text(it, color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
                }
            }
        }
    }

    if (showResolveDialog) {
        ResolutionDialog(
            title = "Resolve Ticket",
            reason = resolutionReason,
            onReasonChange = { resolutionReason = it },
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
            title = "Reject Ticket",
            reason = resolutionReason,
            onReasonChange = { resolutionReason = it },
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
}

@Composable
private fun StatusChip(status: String) {
    val (color, label) = when (status) {
        "RESOLVED" -> Color(0xFF4CAF50) to "Resolved"
        "REJECTED" -> Color(0xFFF44336) to "Rejected"
        else -> Color(0xFFFF9800) to "Pending"
    }
    Surface(shape = RoundedCornerShape(20.dp), color = color.copy(alpha = 0.15f)) {
        Text(label, fontSize = 11.sp, color = color, fontWeight = FontWeight.Medium,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 3.dp))
    }
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
                label = { Text("Notes (optional)") },
                modifier = Modifier.fillMaxWidth(),
                minLines = 2
            )
        },
        confirmButton = { TextButton(onClick = onConfirm) { Text("Confirm") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } }
    )
}