package org.community.playgroundfinder.ui.screens.admin

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons as MaterialIcons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.community.playgroundfinder.data.PlaygroundService
import org.community.playgroundfinder.ui.composables.FormColors
import org.community.playgroundfinder.util.mongoIdString

@Composable
fun SupportQueueScreen(
    service: PlaygroundService,
    onItemClick: (String) -> Unit,
    /** `support` = general tickets; `suggestions` = feature label queue only. */
    queueKind: String = "support",
) {
    val scope = rememberCoroutineScope()
    val snackbarHostState = remember { SnackbarHostState() }
    var tickets by remember { mutableStateOf<List<Map<String, Any?>>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var errorMsg by remember { mutableStateOf<String?>(null) }

    fun reload() {
        scope.launch {
            isLoading = true
            errorMsg = null
            try {
                tickets = service.getSupportQueue("NEEDS_ADMIN_REVIEW", queueKind)
            } catch (e: Exception) {
                errorMsg = e.message ?: "Failed to load support tickets"
                snackbarHostState.showSnackbar("Failed to load support tickets")
            }
            isLoading = false
        }
    }
    LaunchedEffect(queueKind) { reload() }

    Scaffold(
        containerColor = FormColors.ScreenBackground,
        contentColor = FormColors.BodyText,
        snackbarHost = { SnackbarHost(hostState = snackbarHostState) },
    ) { padding ->
        Box(modifier = Modifier.fillMaxSize().padding(padding)) {
            when {
                isLoading -> CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
                errorMsg != null && tickets.isEmpty() -> Column(
                    modifier = Modifier.align(Alignment.Center),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text(errorMsg ?: "Failed to load support tickets", color = MaterialTheme.colorScheme.error)
                    Spacer(Modifier.height(8.dp))
                    TextButton(onClick = { reload() }) { Text("Retry") }
                }
                tickets.isEmpty() -> AdminEmptyQueueMessage(
                    modifier = Modifier.align(Alignment.Center),
                    onRefresh = { reload() },
                )
                else -> LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(tickets) { ticket ->
                        val id = ticket["_id"]?.mongoIdString() ?: ticket["id"]?.mongoIdString() ?: ""
                        val typeRaw = ticket["ticketType"]?.toString()?.trim().orEmpty()
                        val typeTitle = if (queueKind == "suggestions") "Label suggestion" else supportTicketTypeTitle(typeRaw)
                        @Suppress("UNCHECKED_CAST")
                        val pgSum = ticket["targetPlaygroundSummary"] as? Map<String, Any?>
                        val placeLine = pgSum?.let { sum ->
                            val nm = sum["name"]?.toString()?.trim()?.takeIf { it.isNotEmpty() }
                            val cityPart = (sum["city"]?.toString()).orEmpty().trim()
                            val stPart = (sum["state"]?.toString()).orEmpty().trim()
                            val rkPart = (sum["regionKey"]?.toString()).orEmpty().trim()
                            val loc = listOf(cityPart, stPart).filter { it.isNotBlank() }.joinToString(", ")
                            val region = if (rkPart.isNotBlank()) " · $rkPart" else ""
                            when {
                                nm != null && loc.isNotBlank() -> "$nm — $loc$region"
                                nm != null -> "$nm$region"
                                loc.isNotBlank() -> "$loc$region"
                                else -> null
                            }
                        }
                        val message = ticket["message"]?.toString()?.trim().orEmpty()
                        val reporter = ticket["actorUserId"]?.toString()?.takeIf { it.isNotBlank() }
                        @Suppress("UNCHECKED_CAST")
                        val profile = ticket["actorProfile"] as? Map<String, Any?>
                        val reporterLine = when {
                            profile != null -> {
                                val dn = profile["displayName"]?.toString()?.takeIf { it.isNotBlank() }
                                val em = profile["email"]?.toString()?.takeIf { it.isNotBlank() }
                                when {
                                    dn != null && em != null -> "$dn · $em"
                                    dn != null -> dn
                                    em != null -> em
                                    reporter != null -> reporter
                                    else -> null
                                }
                            }
                            else -> reporter
                        }
                        Card(
                            modifier = Modifier.fillMaxWidth().clickable { onItemClick(id) },
                            shape = RoundedCornerShape(16.dp),
                            colors = CardDefaults.cardColors(containerColor = FormColors.CardBackground),
                            elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Icon(
                                    MaterialIcons.Filled.SupportAgent,
                                    contentDescription = null,
                                    modifier = Modifier.size(32.dp),
                                    tint = FormColors.PrimaryButton,
                                )
                                Spacer(Modifier.width(12.dp))
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        typeTitle,
                                        style = MaterialTheme.typography.titleSmall,
                                        fontWeight = FontWeight.SemiBold,
                                        color = MaterialTheme.colorScheme.onSurface,
                                        maxLines = 2,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                    if (reporterLine != null) {
                                        Text(
                                            "Reporter: $reporterLine",
                                            style = MaterialTheme.typography.labelMedium,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            maxLines = 2,
                                            overflow = TextOverflow.Ellipsis,
                                        )
                                    }
                                    if (placeLine != null) {
                                        Spacer(Modifier.height(4.dp))
                                        Text(
                                            placeLine,
                                            style = MaterialTheme.typography.labelMedium,
                                            color = FormColors.PrimaryButton,
                                            maxLines = 2,
                                            overflow = TextOverflow.Ellipsis,
                                        )
                                    }
                                    if (message.isNotEmpty()) {
                                        Spacer(Modifier.height(4.dp))
                                        Text(
                                            message,
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            maxLines = 2,
                                            overflow = TextOverflow.Ellipsis,
                                        )
                                    }
                                }
                                Icon(
                                    MaterialIcons.Filled.ChevronRight,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

private fun supportTicketTypeTitle(type: String): String = when (type.lowercase()) {
    "question" -> "Question"
    "complaint" -> "Complaint"
    "request_update" -> "Update request"
    "report_issue", "content_issue" -> "Issue report"
    "removal_request" -> "Removal request"
    "suggestion" -> "Suggestion"
    "claim" -> "Claim listing"
    else ->
        if (type.isBlank()) "Support ticket"
        else type.replace("_", " ").lowercase().replaceFirstChar { it.uppercase() }
}
