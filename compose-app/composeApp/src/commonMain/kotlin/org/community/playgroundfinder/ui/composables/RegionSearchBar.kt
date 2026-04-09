package org.community.playgroundfinder.ui.composables

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.community.playgroundfinder.data.PlaygroundService
import org.community.playgroundfinder.models.RegionSearchResult

@Composable
fun RegionSearchBar(
    service: PlaygroundService,
    onRegionSelected: (RegionSearchResult) -> Unit,
    modifier: Modifier = Modifier
) {
    var query by remember { mutableStateOf("") }
    var isLoading by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var seedingTriggered by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    // Debounce: trigger search 500ms after the user stops typing
    LaunchedEffect(query) {
        if (query.isBlank()) {
            errorMessage = null
            seedingTriggered = false
            return@LaunchedEffect
        }
        delay(500)
        isLoading = true
        errorMessage = null
        seedingTriggered = false
        try {
            val result = service.searchRegion(query)
            seedingTriggered = result.seedingTriggered
            onRegionSelected(result)
        } catch (e: Exception) {
            errorMessage = e.message ?: "Search failed"
        } finally {
            isLoading = false
        }
    }

    Column(modifier = modifier) {
        OutlinedTextField(
            value = query,
            onValueChange = { query = it },
            placeholder = { Text("Search city, state (e.g. Austin, TX)") },
            singleLine = true,
            leadingIcon = { Icon(Icons.Filled.Search, contentDescription = "Search") },
            trailingIcon = {
                if (query.isNotEmpty()) {
                    IconButton(onClick = {
                        query = ""
                        errorMessage = null
                        seedingTriggered = false
                    }) {
                        Icon(Icons.Filled.Clear, contentDescription = "Clear")
                    }
                }
            },
            modifier = Modifier.fillMaxWidth()
        )

        if (isLoading) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.padding(top = 8.dp)
            ) {
                CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                Text("Searching…", style = MaterialTheme.typography.bodySmall)
            }
        }

        if (seedingTriggered) {
            Text(
                "Seeding in progress — results may be partial",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.tertiary,
                modifier = Modifier.padding(top = 4.dp)
            )
        }

        errorMessage?.let { msg ->
            Text(
                msg,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(top = 4.dp)
            )
        }
    }
}
