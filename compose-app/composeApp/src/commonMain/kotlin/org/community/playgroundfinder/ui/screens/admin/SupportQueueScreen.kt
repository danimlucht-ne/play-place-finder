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
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.community.playgroundfinder.data.PlaygroundService
import org.community.playgroundfinder.ui.composables.FormColors
import org.community.playgroundfinder.util.mongoIdString

@Composable
fun SupportQueueScreen(
    service: PlaygroundService,
    onItemClick: (String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    val snackbarHostState = remember { SnackbarHostState() }
    var tickets by remember { mutableStateOf<List<Map<String, Any>>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var errorMsg by remember { mutableStateOf<String?>(null) }

    fun reload() {
        scope.launch {
            isLoading = true
            errorMsg = null
            try {
                tickets = service.getSupportQueue("NEEDS_ADMIN_REVIEW")
            } catch (e: Exception) {
                errorMsg = e.message ?: "Failed to load support tickets"
                snackbarHostState.showSnackbar("Failed to load support tickets")
            }
            isLoading = false
        }
    }
    LaunchedEffect(Unit) { reload() }

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
                        val type = ticket["ticketType"]?.toString() ?: "General"
                        val message = ticket["message"]?.toString()?.take(80) ?: ""
                        Card(
                            modifier = Modifier.fillMaxWidth().clickable { onItemClick(id) },
                            shape = RoundedCornerShape(12.dp)
                        ) {
                            Row(modifier = Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                                Icon(
                                    MaterialIcons.Filled.SupportAgent,
                                    contentDescription = null,
                                    modifier = Modifier.size(28.dp),
                                    tint = FormColors.PrimaryButton,
                                )
                                Spacer(Modifier.width(12.dp))
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(type, fontWeight = FontWeight.SemiBold)
                                    Text(message, style = MaterialTheme.typography.bodySmall, maxLines = 2)
                                }
                                Icon(MaterialIcons.Filled.ChevronRight, null)
                            }
                        }
                    }
                }
            }        
        }
    }
}
