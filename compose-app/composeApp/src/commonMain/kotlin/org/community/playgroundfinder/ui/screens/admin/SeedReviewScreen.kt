package org.community.playgroundfinder.ui.screens.admin

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Star
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
import org.community.playgroundfinder.data.SeedReviewItem

@Composable
fun SeedReviewScreen(
    service: PlaygroundService,
    onComplete: () -> Unit
) {
    val scope = rememberCoroutineScope()
    var items by remember { mutableStateOf<List<SeedReviewItem>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var errorMsg by remember { mutableStateOf<String?>(null) }
    var rejectDialogItem by remember { mutableStateOf<SeedReviewItem?>(null) }
    var rejectReason by remember { mutableStateOf("") }
    var processingId by remember { mutableStateOf<String?>(null) }

    fun reload() {
        scope.launch {
            isLoading = true
            errorMsg = null
            try {
                items = service.getSeedReviewQueue()
            } catch (e: Exception) {
                errorMsg = e.message
            } finally {
                isLoading = false
            }
        }
    }

    LaunchedEffect(Unit) { reload() }

    rejectDialogItem?.let { item ->
        AlertDialog(
            onDismissRequest = { rejectDialogItem = null; rejectReason = "" },
            title = { Text("Reject Photo") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Reason (optional):", fontSize = 13.sp)
                    OutlinedTextField(
                        value = rejectReason,
                        onValueChange = { rejectReason = it },
                        placeholder = { Text("e.g. Not relevant, faces visible") },
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    val id = item.id
                    rejectDialogItem = null
                    scope.launch {
                        processingId = id
                        try {
                            service.rejectSeedReviewPhoto(id, rejectReason.ifBlank { null })
                            items = items.filter { it.id != id }
                        } catch (_: Exception) {}
                        processingId = null
                        rejectReason = ""
                    }
                }) { Text("Reject", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = {
                TextButton(onClick = { rejectDialogItem = null; rejectReason = "" }) { Text("Cancel") }
            }
        )
    }

    Box(modifier = Modifier.fillMaxSize()) {
        when {
            isLoading -> CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
            errorMsg != null -> Column(
                modifier = Modifier.align(Alignment.Center).padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text("Error: $errorMsg", color = MaterialTheme.colorScheme.error)
                Spacer(Modifier.height(12.dp))
                Button(onClick = { reload() }) { Text("Retry") }
            }
            items.isEmpty() -> AdminEmptyQueueMessage(
                modifier = Modifier.align(Alignment.Center),
                onRefresh = { reload() },
            )
            else -> LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                item {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("${items.size} photos pending", fontSize = 13.sp, color = Color.Gray)
                        TextButton(onClick = { reload() }) { Text("Refresh") }
                    }
                }
                items(items, key = { it.id }) { item ->
                    SeedReviewCard(
                        item = item,
                        isProcessing = processingId == item.id,
                        onApprove = { setAsHero ->
                            scope.launch {
                                processingId = item.id
                                try {
                                    service.approveSeedReviewPhoto(item.id, setAsHero)
                                    items = items.filter { it.id != item.id }
                                } catch (_: Exception) {}
                                processingId = null
                            }
                        },
                        onReject = { rejectDialogItem = item }
                    )
                }
            }
        }
    }
}

@Composable
private fun SeedReviewCard(
    item: SeedReviewItem,
    isProcessing: Boolean,
    onApprove: (setAsHero: Boolean) -> Unit,
    onReject: () -> Unit
) {
    val confidence = item.geminiSummary?.confidence?.let { "%.0f%%".format(it * 100) } ?: "?"
    val relevance = item.geminiSummary?.relevanceScore?.let { "%.0f%%".format(it * 100) } ?: "?"
    val overview = item.geminiSummary?.overviewScore?.let { "%.0f%%".format(it * 100) } ?: "?"
    val notes = item.geminiSummary?.notes

    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        elevation = CardDefaults.cardElevation(2.dp)
    ) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(item.playgroundName, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                    Text(item.regionKey, fontSize = 12.sp, color = Color.Gray)
                }
                if (item.isTopPhoto) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .background(Color(0xFFFFD700).copy(alpha = 0.2f))
                            .padding(horizontal = 8.dp, vertical = 4.dp)
                    ) {
                        Icon(Icons.Filled.Star, contentDescription = null, tint = Color(0xFFFFD700), modifier = Modifier.size(14.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("Top Photo", fontSize = 12.sp, color = Color(0xFFB8860B), fontWeight = FontWeight.SemiBold)
                    }
                }
            }

            if (item.photoUrl.isNotBlank()) {
                var imageState by remember { mutableStateOf("loading") }
                AsyncImage(
                    model = item.photoUrl,
                    contentDescription = "Seed photo for ${item.playgroundName}",
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(200.dp)
                        .clip(RoundedCornerShape(8.dp)),
                    contentScale = ContentScale.Crop,
                    onError = { imageState = "error" },
                    onSuccess = { imageState = "success" }
                )
                if (imageState == "error") {
                    Text(
                        "Failed to load image",
                        fontSize = 11.sp,
                        color = Color.Red,
                        modifier = Modifier.padding(top = 2.dp)
                    )
                    Text(
                        item.photoUrl.take(80) + if (item.photoUrl.length > 80) "…" else "",
                        fontSize = 10.sp,
                        color = Color.Gray,
                        modifier = Modifier.padding(top = 2.dp)
                    )
                }
            } else {
                Text("No photo URL", fontSize = 12.sp, color = Color.Gray)
            }

            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                InfoChip("AI: $confidence", FormColors.PrimaryButton)
                InfoChip("Relevance: $relevance", Color(0xFF2E7D32))
                InfoChip("Overview: $overview", Color(0xFF6A1B9A))
                if (item.hasFaces) InfoChip("Has Faces", Color(0xFFE65100))
            }

            if (item.queueReasons.isNotEmpty()) {
                Text(
                    "Why it’s here",
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Color(0xFF1565C0),
                    modifier = Modifier.padding(top = 4.dp),
                )
                item.queueReasons.forEach { line ->
                    Text(
                        "\u2022 $line",
                        fontSize = 12.sp,
                        color = Color(0xFF37474F),
                        lineHeight = 16.sp,
                        modifier = Modifier.padding(top = 2.dp),
                    )
                }
            }

            notes?.let {
                Text(it, fontSize = 12.sp, color = Color.Gray, lineHeight = 16.sp)
            }

            if (isProcessing) {
                LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            } else {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    if (item.isTopPhoto) {
                        Button(
                            onClick = { onApprove(true) },
                            modifier = Modifier.weight(1f),
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFFFD700)),
                        ) {
                            Icon(Icons.Filled.Star, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(4.dp))
                            Text("Set as Hero", color = Color.Black, fontSize = 13.sp)
                        }
                    } else {
                        Button(
                            onClick = { onApprove(false) },
                            modifier = Modifier.weight(1f),
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF2E7D32)),
                        ) {
                            Icon(Icons.Filled.Check, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(4.dp))
                            Text("Keep", fontSize = 13.sp)
                        }
                    }
                    OutlinedButton(
                        onClick = onReject,
                        modifier = Modifier.weight(1f),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error)
                    ) {
                        Icon(Icons.Filled.Close, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("Remove", fontSize = 13.sp)
                    }
                }
            }
        }
    }
}

@Composable
private fun InfoChip(label: String, color: Color) {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(6.dp))
            .background(color.copy(alpha = 0.12f))
            .padding(horizontal = 8.dp, vertical = 3.dp)
    ) {
        Text(label, fontSize = 11.sp, color = color, fontWeight = FontWeight.Medium)
    }
}
