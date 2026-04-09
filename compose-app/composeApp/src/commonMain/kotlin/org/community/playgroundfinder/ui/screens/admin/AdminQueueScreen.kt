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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.community.playgroundfinder.data.PlaygroundService
import org.community.playgroundfinder.ui.composables.FormColors
import org.community.playgroundfinder.util.mongoIdString

@Composable
fun AdminQueueScreen(
    service: PlaygroundService,
    onItemClick: (String) -> Unit,
    onNavigateToSupportQueue: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val snackbarHostState = remember { SnackbarHostState() }
    var items by remember { mutableStateOf<List<Map<String, Any>>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var errorMsg by remember { mutableStateOf<String?>(null) }

    fun reload() {
        scope.launch {
            isLoading = true
            errorMsg = null
            try {
                items = service.getModerationQueue("NEEDS_ADMIN_REVIEW")
            } catch (e: Exception) {
                errorMsg = e.message ?: "Failed to load moderation queue"
                snackbarHostState.showSnackbar("Failed to load moderation queue")
            }
            isLoading = false
        }
    }

    LaunchedEffect(Unit) { reload() }

    Scaffold(
        containerColor = FormColors.ScreenBackground,
        contentColor = FormColors.BodyText,
        snackbarHost = { SnackbarHost(hostState = snackbarHostState) },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = onNavigateToSupportQueue,
                icon = { Icon(MaterialIcons.Filled.SupportAgent, null) },
                text = { Text("Support Queue") }
            )
        }
    ) { padding ->
        Box(modifier = Modifier.fillMaxSize().padding(padding)) {
            when {
                isLoading -> CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
                errorMsg != null && items.isEmpty() -> Column(
                    modifier = Modifier.align(Alignment.Center),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text(errorMsg ?: "Failed to load queue", color = MaterialTheme.colorScheme.error)
                    Spacer(Modifier.height(8.dp))
                    TextButton(onClick = { reload() }) { Text("Retry") }
                }
                items.isEmpty() -> AdminEmptyQueueMessage(
                    modifier = Modifier.align(Alignment.Center),
                    onRefresh = { reload() },
                )
                else -> LazyColumn(
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(items) { item ->
                        val id = item["id"]?.mongoIdString()
                            ?: item["_id"]?.mongoIdString()
                            ?: ""
                        val name = item["playgroundName"]?.toString() ?: "Unnamed"
                        val type = item["submissionType"]?.toString() ?: ""
                        val confidence = (item["confidence"] as? Number)?.toFloat()
                        val recommended = item["recommendedAction"]?.toString() ?: ""

                        Card(
                            modifier = Modifier.fillMaxWidth().clickable { onItemClick(id) },
                            shape = RoundedCornerShape(12.dp)
                        ) {
                            Row(
                                modifier = Modifier.padding(16.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(
                                    imageVector = when (type) {
                                        "PHOTO" -> MaterialIcons.Filled.PhotoCamera
                                        "PLAYGROUND_EDIT" -> MaterialIcons.Filled.Edit
                                        "NEW_PLAYGROUND" -> MaterialIcons.Filled.AddCircleOutline
                                        "DELETE_REQUEST" -> MaterialIcons.Filled.DeleteOutline
                                        else -> MaterialIcons.Filled.Assignment
                                    },
                                    contentDescription = null,
                                    tint = FormColors.PrimaryButton,
                                    modifier = Modifier.size(28.dp),
                                )
                                Spacer(Modifier.width(8.dp))
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(name, fontWeight = FontWeight.SemiBold)
                                    Text(
                                        type.replace("_", " ").lowercase()
                                            .replaceFirstChar { it.uppercase() },
                                        style = MaterialTheme.typography.bodySmall,
                                        color = Color.Gray
                                    )
                                    if (confidence != null) {
                                        val confColor = when {
                                            confidence >= 0.8f -> Color(0xFF4CAF50)
                                            confidence >= 0.5f -> Color(0xFFFFC107)
                                            else -> Color(0xFFF44336)
                                        }
                                        Text(
                                            "${"%.0f".format(confidence * 100)}% confidence • $recommended",
                                            fontSize = 11.sp, color = confColor
                                        )
                                    }
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