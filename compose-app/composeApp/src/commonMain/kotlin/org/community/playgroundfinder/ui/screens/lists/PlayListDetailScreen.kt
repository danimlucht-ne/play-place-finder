package org.community.playgroundfinder.ui.screens.lists

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons as MaterialIcons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.community.playgroundfinder.data.Playground
import org.community.playgroundfinder.data.PlaygroundService
import org.community.playgroundfinder.ui.composables.PlaygroundItem
import org.community.playgroundfinder.ui.composables.haversineMeters

@Composable
fun PlayListDetailScreen(
    service: PlaygroundService,
    listId: String,
    listName: String,
    userLat: Double? = null,
    userLng: Double? = null,
    onPlaygroundClick: (Playground) -> Unit,
    onDeleteList: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var places by remember { mutableStateOf<List<Playground>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var showDeleteConfirm by remember { mutableStateOf(false) }

    LaunchedEffect(listId) {
        scope.launch {
            try { places = service.getListDetail(listId).places } catch (_: Exception) {}
            isLoading = false
        }
    }

    Scaffold(
        floatingActionButton = {
            FloatingActionButton(
                onClick = { showDeleteConfirm = true },
                containerColor = MaterialTheme.colorScheme.error
            ) {
                Icon(MaterialIcons.Filled.Delete, null)
            }
        }
    ) { padding ->
        Box(modifier = Modifier.fillMaxSize().padding(padding)) {
            when {
                isLoading -> CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
                places.isEmpty() -> Text("No places in this list yet.", modifier = Modifier.align(Alignment.Center))
                else -> {
                    val sorted = remember(places, userLat, userLng) {
                        if (userLat != null && userLng != null) {
                            places.sortedBy { pg ->
                                if (pg.latitude != 0.0 && pg.longitude != 0.0) {
                                    haversineMeters(userLat, userLng, pg.latitude, pg.longitude)
                                } else {
                                    Double.MAX_VALUE
                                }
                            }
                        } else {
                            places
                        }
                    }
                    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        items(sorted) { pg ->
                            PlaygroundItem(
                                pg,
                                userLat = userLat,
                                userLng = userLng,
                                onClick = { onPlaygroundClick(pg) },
                            )
                        }
                    }
                }
            }
        }
    }

    if (showDeleteConfirm) {
        AlertDialog(
            onDismissRequest = { showDeleteConfirm = false },
            title = { Text("Delete \"$listName\"?") },
            text = { Text("This will permanently delete the list.") },
            confirmButton = {
                TextButton(onClick = {
                    scope.launch {
                        try { service.deleteList(listId) } catch (_: Exception) {}
                        onDeleteList()
                    }
                }) { Text("Delete") }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteConfirm = false }) { Text("Cancel") }
            }
        )
    }
}
