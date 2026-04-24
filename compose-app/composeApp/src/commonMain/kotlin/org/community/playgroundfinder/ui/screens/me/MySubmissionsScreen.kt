package org.community.playgroundfinder.ui.screens.me

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
import org.community.playgroundfinder.ui.composables.FormColors

@Composable
fun MySubmissionsScreen(
    service: PlaygroundService,
) {
    val scope = rememberCoroutineScope()
    var rows by remember { mutableStateOf<List<Map<String, Any>>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }

    fun load() {
        scope.launch {
            loading = true
            error = null
            try {
                rows = service.getMySubmissions(80)
            } catch (e: Exception) {
                error = e.message ?: "Could not load submissions"
            } finally {
                loading = false
            }
        }
    }

    LaunchedEffect(Unit) { load() }

    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Text(
            "Track photos, edits, and new places you’ve submitted. Pending items are reviewed by moderators.",
            fontSize = 13.sp,
            color = Color(0xFF616161),
            modifier = Modifier.padding(bottom = 12.dp)
        )

        when {
            loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = FormColors.PrimaryButton)
            }
            error != null -> Column {
                Text(error!!, color = MaterialTheme.colorScheme.error)
                TextButton(onClick = { load() }) { Text("Retry") }
            }
            rows.isEmpty() -> Text("No submissions yet.", color = Color.Gray, modifier = Modifier.padding(top = 24.dp))
            else -> LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(rows) { row ->
                    SubmissionRow(row)
                }
            }
        }
    }
}

private fun noteForDisplay(raw: Any?): String? {
    val s = raw?.toString()?.trim() ?: return null
    if (s.isEmpty() || s.equals("null", ignoreCase = true)) return null
    return s
}

@Composable
private fun SubmissionRow(row: Map<String, Any>) {
    val type = row["submissionType"]?.toString() ?: ""
    val status = row["status"]?.toString() ?: ""
    val name = row["playgroundName"]?.toString() ?: "Submission"
    val reason = noteForDisplay(row["reason"])
    val created = row["createdAt"]?.toString() ?: ""
    val source = row["source"]?.toString()?.uppercase() ?: "MODERATION"

    val statusColor = when (status) {
        "NEEDS_ADMIN_REVIEW", "PENDING" -> Color(0xFFFF9800)
        "APPROVED", "AUTO_APPROVED", "RESOLVED" -> Color(0xFF2E7D32)
        "REJECTED" -> Color(0xFFC62828)
        else -> Color.Gray
    }

    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = Color(0xFFF5F5F5))
    ) {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    when (type) {
                        "PHOTO" -> "📷"
                        "PLAYGROUND_EDIT" -> "✏️"
                        "NEW_PLAYGROUND" -> "🆕"
                        "DELETE_REQUEST" -> "🗑️"
                        "SUGGESTION" -> "💡"
                        "REQUEST_UPDATE" -> "🛠️"
                        "REPORT_ISSUE" -> "🚩"
                        "QUESTION" -> "❓"
                        "COMPLAINT" -> "⚠️"
                        else -> "📋"
                    },
                    fontSize = 20.sp,
                    modifier = Modifier.padding(end = 8.dp)
                )
                Column(Modifier.weight(1f)) {
                    Text(name, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            when (type) {
                                "DELETE_REQUEST" -> "Removal request"
                                "REQUEST_UPDATE" -> "Update request"
                                "REPORT_ISSUE" -> "Issue report"
                                else -> type.replace("_", " ").lowercase().replaceFirstChar { it.uppercase() }
                            },
                            fontSize = 12.sp,
                            color = Color.Gray
                        )
                        Surface(
                            shape = RoundedCornerShape(6.dp),
                            color = Color(0xFFE3F2FD),
                            modifier = Modifier.padding(start = 8.dp)
                        ) {
                            Text(
                                if (source == "SUPPORT") "Support" else "Moderation",
                                fontSize = 10.sp,
                                color = Color(0xFF1565C0),
                                fontWeight = FontWeight.Medium,
                                modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                            )
                        }
                    }
                }
                Surface(shape = RoundedCornerShape(8.dp), color = statusColor.copy(alpha = 0.15f)) {
                    Text(
                        status.replace("_", " "),
                        fontSize = 11.sp,
                        color = statusColor,
                        fontWeight = FontWeight.Medium,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                    )
                }
            }
            if (created.isNotBlank()) {
                Text(created, fontSize = 11.sp, color = Color.Gray, modifier = Modifier.padding(top = 6.dp))
            }
            reason?.let { note ->
                Text("Note: $note", fontSize = 12.sp, color = Color(0xFF5D4037), modifier = Modifier.padding(top = 6.dp))
            }
        }
    }
}
