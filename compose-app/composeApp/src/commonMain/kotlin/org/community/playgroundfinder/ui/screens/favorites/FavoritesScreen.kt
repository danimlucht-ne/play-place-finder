package org.community.playgroundfinder.ui.screens.favorites

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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
fun FavoritesScreen(
    service: PlaygroundService,
    userId: String,
    userLat: Double? = null,
    userLng: Double? = null,
    onPlaygroundClick: (Playground) -> Unit,
) {
    val scope = rememberCoroutineScope()
    var favorites by remember { mutableStateOf<List<Playground>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(userId) {
        scope.launch {
            try { favorites = service.getFavorites(userId) } catch (e: Exception) { error = e.message }
            isLoading = false
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        when {
            isLoading -> CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
            error != null -> Text("Failed to load favorites.", modifier = Modifier.align(Alignment.Center))
            favorites.isEmpty() -> Text("No favorites yet.", modifier = Modifier.align(Alignment.Center))
            else -> {
                val sorted = remember(favorites, userLat, userLng) {
                    if (userLat != null && userLng != null) {
                        favorites.sortedBy { pg ->
                            if (pg.latitude != 0.0 && pg.longitude != 0.0) {
                                haversineMeters(userLat, userLng, pg.latitude, pg.longitude)
                            } else {
                                Double.MAX_VALUE
                            }
                        }
                    } else {
                        favorites
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
