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
import coil3.compose.AsyncImage
import kotlinx.coroutines.launch
import org.community.playgroundfinder.data.PlaygroundService
import org.community.playgroundfinder.ui.composables.FormColors
import org.community.playgroundfinder.util.mongoIdString

@Composable
fun AdminDetailScreen(
    service: PlaygroundService,
    queueId: String,
    onComplete: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var item by remember { mutableStateOf<Map<String, Any>>(emptyMap()) }
    var isLoading by remember { mutableStateOf(true) }
    var rejectReason by remember { mutableStateOf("") }
    var showRejectDialog by remember { mutableStateOf(false) }
    var actionInProgress by remember { mutableStateOf(false) }
    var errorMsg by remember { mutableStateOf<String?>(null) }
    var successMsg by remember { mutableStateOf<String?>(null) }
    var showBlockDialog by remember { mutableStateOf(false) }
    var blockReasonInput by remember { mutableStateOf("") }
    var showDeleteDialog by remember { mutableStateOf(false) }

    val playgroundIdStr = remember(item) {
        item["playgroundId"]?.mongoIdString()
            ?: item["targetId"]?.toString()?.takeIf { it.isNotBlank() }
    }
    val submitterId = remember(item) { item["submittedByUserId"]?.mongoIdString() }

    LaunchedEffect(queueId) {
        try { item = service.getModerationItem(queueId) } catch (_: Exception) {}
        isLoading = false
    }

    val submissionType = item["submissionType"]?.toString() ?: ""
    val isEdit = submissionType == "PLAYGROUND_EDIT"
    val isPhoto = submissionType == "PHOTO"
    val isNewPlayground = submissionType == "NEW_PLAYGROUND"
    val isDeleteRequest = submissionType == "DELETE_REQUEST"

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
                Text(
                    when {
                        isEdit -> "✏️ Edit Submission"
                        isPhoto -> "📷 Photo Submission"
                        isNewPlayground -> "🆕 New Play Place"
                        isDeleteRequest -> "🗑️ Removal Request"
                        else -> "Review Submission"
                    },
                    fontWeight = FontWeight.Bold,
                    fontSize = 20.sp
                )

                Text(
                    item["playgroundName"]?.toString() ?: "Unknown Playground",
                    fontSize = 16.sp,
                    color = FormColors.PrimaryButton
                )

                item["createdAt"]?.let {
                    Text("Submitted: $it", fontSize = 12.sp, color = Color.Gray)
                }

                if (isDeleteRequest) {
                    Text(
                        "Approve archives this listing (soft delete). Reject leaves it published.",
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    item["reason"]?.toString()?.trim()?.takeIf { it.isNotEmpty() && !it.equals("null", ignoreCase = true) }?.let { note ->
                        Spacer(Modifier.height(4.dp))
                        Text("Requester note: $note", fontSize = 13.sp, color = Color(0xFF5D4037))
                    }
                    Spacer(Modifier.height(8.dp))
                }

                // AI confidence chip
                item["confidence"]?.let { conf ->
                    if (isDeleteRequest) return@let
                    val confFloat = conf.toString().toFloatOrNull() ?: 0f
                    val color = when {
                        confFloat >= 0.8f -> Color(0xFF4CAF50)
                        confFloat >= 0.5f -> Color(0xFFFFC107)
                        else -> Color(0xFFF44336)
                    }
                    Surface(shape = RoundedCornerShape(20.dp), color = color.copy(alpha = 0.15f)) {
                        Text(
                            "AI Confidence: ${"%.0f".format(confFloat * 100)}%  •  ${item["recommendedAction"] ?: ""}",
                            fontSize = 12.sp, color = color, fontWeight = FontWeight.Medium,
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp)
                        )
                    }
                }

                item["moderationFlags"]?.let { flags ->
                    if (isDeleteRequest) return@let
                    if (flags.toString().isNotBlank() && flags.toString() != "[]") {
                        Surface(shape = RoundedCornerShape(8.dp), color = Color(0xFFFFF3E0)) {
                            Text(
                                "⚠️ Flags: $flags",
                                fontSize = 12.sp, color = Color(0xFFE65100),
                                modifier = Modifier.padding(10.dp)
                            )
                        }
                    }
                }

                Divider()

                // Photo preview
                if (isPhoto) {
                    item["previewUrl"]?.toString()?.takeIf { it.isNotBlank() }?.let { url ->
                        AsyncImage(
                            model = url,
                            contentDescription = null,
                            modifier = Modifier.fillMaxWidth().height(240.dp)
                        )
                    }
                    item["faceCount"]?.let { fc ->
                        val count = fc.toString().toIntOrNull() ?: 0
                        if (count > 0) {
                            Text("⚠️ $count face(s) detected", color = Color(0xFFE53935), fontWeight = FontWeight.Medium)
                        }
                    }
                }

                // Edit diff
                if (isEdit) {
                    @Suppress("UNCHECKED_CAST")
                    val proposed = item["proposedChanges"] as? Map<String, Any?> ?: emptyMap()
                    val skipKeys = setOf("lastUpdated", "_id", "id", "__v")
                    val displayFields = proposed.filterKeys { it !in skipKeys }

                    if (displayFields.isEmpty()) {
                        Text("No changes detected.", color = Color.Gray, fontSize = 13.sp)
                    } else {
                        Text("Proposed Changes:", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                        displayFields.forEach { (key, value) ->
                            Card(
                                modifier = Modifier.fillMaxWidth(),
                                shape = RoundedCornerShape(16.dp),
                                colors = CardDefaults.cardColors(containerColor = Color(0xFFF1F8E9))
                            ) {
                                Column(modifier = Modifier.padding(10.dp)) {
                                    Text(key, fontSize = 11.sp, color = Color.Gray, fontWeight = FontWeight.Medium)
                                    Text(value?.toString() ?: "(cleared)", fontSize = 13.sp)
                                }
                            }
                        }
                    }
                }

                // Raw fields for other types (not removal requests — those are summarized above)
                if (!isEdit && !isPhoto && !isDeleteRequest) {
                    val skipKeys = setOf("_id", "id", "__v", "previewUrl")
                    item.filterKeys { it !in skipKeys }.forEach { (k, v) ->
                        Text("$k: $v", style = MaterialTheme.typography.bodySmall)
                    }
                }

                errorMsg?.let { Text(it, color = FormColors.ErrorText, fontSize = 13.sp) }
                successMsg?.let { Text(it, color = Color(0xFF2E7D32), fontSize = 13.sp) }

                if (playgroundIdStr != null || submitterId != null || isNewPlayground) {
                    Spacer(Modifier.height(8.dp))
                    Divider()
                    Text("Admin tools", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                    submitterId?.let { uid ->
                        Text("Submitter: $uid", fontSize = 11.sp, color = Color.Gray)
                        OutlinedButton(
                            onClick = { successMsg = null; showBlockDialog = true },
                            enabled = !actionInProgress,
                            modifier = Modifier.fillMaxWidth()
                        ) { Text("Block submitter", color = FormColors.ErrorText) }
                    }
                    if (!isNewPlayground && !isDeleteRequest) {
                        playgroundIdStr?.let {
                            OutlinedButton(
                                onClick = { successMsg = null; showDeleteDialog = true },
                                enabled = !actionInProgress,
                                modifier = Modifier.fillMaxWidth()
                            ) { Text("Archive playground") }
                        }
                    }
                }

                Spacer(Modifier.height(8.dp))

                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Button(
                        onClick = {
                            scope.launch {
                                actionInProgress = true
                                errorMsg = null
                                try {
                                    when {
                                        isEdit -> service.approveEdit(queueId)
                                        isPhoto -> service.approvePhoto(queueId)
                                        isNewPlayground -> service.approveNewPlayground(queueId)
                                        else -> service.approveModeration(queueId)
                                    }
                                    onComplete()
                                } catch (e: Exception) {
                                    errorMsg = "Approve failed: ${e.message}"
                                    actionInProgress = false
                                }
                            }
                        },
                        enabled = !actionInProgress,
                        modifier = Modifier.weight(1f),
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF4CAF50), contentColor = Color.White)
                    ) { Text(if (isDeleteRequest) "Archive" else "✓ Approve") }

                    OutlinedButton(
                        onClick = { showRejectDialog = true },
                        enabled = !actionInProgress,
                        modifier = Modifier.weight(1f)
                    ) { Text(if (isDeleteRequest) "Keep listing" else "✗ Reject") }
                }
            }
        }
    }

    if (showRejectDialog) {
        AlertDialog(
            onDismissRequest = { showRejectDialog = false },
            title = { Text(if (isDeleteRequest) "Decline removal" else "Reject Submission") },
            text = {
                OutlinedTextField(
                    value = rejectReason,
                    onValueChange = { rejectReason = it },
                    label = { Text("Note (optional)") },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 2
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    showRejectDialog = false
                    scope.launch {
                        actionInProgress = true
                        errorMsg = null
                        try {
                            when {
                                isEdit -> service.rejectEdit(queueId, rejectReason)
                                isPhoto -> service.rejectPhoto(queueId, rejectReason)
                                isNewPlayground -> service.rejectNewPlayground(queueId, rejectReason)
                                else -> service.rejectModeration(queueId, rejectReason)
                            }
                            onComplete()
                        } catch (e: Exception) {
                            errorMsg = "Reject failed: ${e.message}"
                            actionInProgress = false
                        }
                    }
                }) { Text("Reject", color = FormColors.ErrorText) }
            },
            dismissButton = {
                TextButton(onClick = { showRejectDialog = false }) { Text("Cancel") }
            }
        )
    }

    if (showBlockDialog) {
        AlertDialog(
            onDismissRequest = { showBlockDialog = false },
            title = { Text("Block submitter") },
            text = {
                OutlinedTextField(
                    value = blockReasonInput,
                    onValueChange = { blockReasonInput = it },
                    label = { Text("Reason (required)") },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 2
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    val uid = submitterId ?: return@TextButton
                    if (blockReasonInput.isBlank()) return@TextButton
                    scope.launch {
                        actionInProgress = true
                        errorMsg = null
                        try {
                            service.adminBlockUser(uid, blockReasonInput.trim())
                            showBlockDialog = false
                            blockReasonInput = ""
                            successMsg = "User blocked."
                        } catch (e: Exception) {
                            errorMsg = "Block failed: ${e.message}"
                        } finally {
                            actionInProgress = false
                        }
                    }
                }) { Text("Block", color = FormColors.ErrorText) }
            },
            dismissButton = {
                TextButton(onClick = { showBlockDialog = false }) { Text("Cancel") }
            }
        )
    }

    if (showDeleteDialog) {
        AlertDialog(
            onDismissRequest = { showDeleteDialog = false },
            title = { Text("Archive playground") },
            text = {
                Text("This archives the place so it no longer appears in search. Continue?")
            },
            confirmButton = {
                TextButton(onClick = {
                    val pid = playgroundIdStr ?: return@TextButton
                    scope.launch {
                        actionInProgress = true
                        errorMsg = null
                        try {
                            service.adminDeletePlayground(pid)
                            showDeleteDialog = false
                            onComplete()
                        } catch (e: Exception) {
                            errorMsg = "Archive failed: ${e.message}"
                            actionInProgress = false
                        }
                    }
                }) { Text("Archive", color = FormColors.ErrorText) }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteDialog = false }) { Text("Cancel") }
            }
        )
    }
}
