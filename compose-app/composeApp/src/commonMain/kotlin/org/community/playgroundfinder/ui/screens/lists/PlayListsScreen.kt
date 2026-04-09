package org.community.playgroundfinder.ui.screens.lists

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import org.community.playgroundfinder.models.PlayListSummary

@Composable
fun PlayListsScreen(
    service: PlaygroundService,
    userId: String,
    onListClick: (id: String, name: String) -> Unit,
    onFavoritesClick: () -> Unit = {},
) {
    val scope = rememberCoroutineScope()
    var lists by remember { mutableStateOf<List<PlayListSummary>>(emptyList()) }
    var favCount by remember { mutableStateOf(0) }
    var isLoading by remember { mutableStateOf(true) }
    var showCreateDialog by remember { mutableStateOf(false) }
    var newListName by remember { mutableStateOf("") }
    var newListColor by remember { mutableStateOf<String?>(null) }

    fun reload() {
        scope.launch {
            isLoading = true
            try {
                lists = service.getLists()
                favCount = try { service.getFavorites(userId).size } catch (_: Exception) { 0 }
            } catch (_: Exception) {}
            isLoading = false
        }
    }

    LaunchedEffect(Unit) { reload() }

    Scaffold(
        floatingActionButton = {
            FloatingActionButton(onClick = { showCreateDialog = true }, containerColor = Color.White) {
                Icon(MaterialIcons.Filled.Add, null, tint = Color(0xFF00CED1))
            }
        }
    ) { padding ->
        Box(modifier = Modifier.fillMaxSize().padding(padding)) {
            when {
                isLoading -> CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
                lists.isEmpty() -> LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    item {
                        Card(
                            modifier = Modifier.fillMaxWidth().clickable { onFavoritesClick() },
                            shape = RoundedCornerShape(12.dp),
                            colors = CardDefaults.cardColors(containerColor = Color.White.copy(alpha = 0.95f))
                        ) {
                            Row(modifier = Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                                Icon(MaterialIcons.Filled.Favorite, null, modifier = Modifier.size(24.dp), tint = Color(0xFFC62828))
                                Spacer(Modifier.width(12.dp))
                                Column(modifier = Modifier.weight(1f)) {
                                    Text("Favorites", fontWeight = FontWeight.SemiBold, color = Color(0xFF212121))
                                    Text("$favCount places", color = Color(0xFF616161))
                                }
                                Icon(MaterialIcons.Filled.ChevronRight, null)
                            }
                        }
                    }
                    item {
                        Text("No custom lists yet. Tap + to create one.", modifier = Modifier.padding(top = 8.dp), color = androidx.compose.ui.graphics.Color.Gray)
                    }
                }
                else -> LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    // Favorites as the top pinned "list"
                    item {
                        Card(
                            modifier = Modifier.fillMaxWidth().clickable { onFavoritesClick() },
                            shape = RoundedCornerShape(12.dp),
                            colors = CardDefaults.cardColors(containerColor = Color.White.copy(alpha = 0.95f))
                        ) {
                            Row(modifier = Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                                Icon(MaterialIcons.Filled.Favorite, null, modifier = Modifier.size(24.dp), tint = Color(0xFFC62828))
                                Spacer(Modifier.width(12.dp))
                                Column(modifier = Modifier.weight(1f)) {
                                    Text("Favorites", fontWeight = FontWeight.SemiBold, color = Color(0xFF212121))
                                    Text("$favCount places", color = Color(0xFF616161))
                                }
                                Icon(MaterialIcons.Filled.ChevronRight, null)
                            }
                        }
                    }
                    items(lists) { list ->
                        val listColor = list.color?.let {
                            try { Color(it.removePrefix("#").toLong(16) or 0xFF000000) } catch (_: Exception) { null }
                        }
                        Card(
                            modifier = Modifier.fillMaxWidth().clickable { onListClick(list.id, list.name) },
                            shape = RoundedCornerShape(12.dp)
                        ) {
                            Row(modifier = Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                                if (listColor != null) {
                                    Box(modifier = Modifier.size(24.dp).background(listColor, RoundedCornerShape(12.dp)))
                                } else {
                                    Icon(MaterialIcons.Filled.List, null, modifier = Modifier.size(24.dp))
                                }
                                Spacer(Modifier.width(12.dp))
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(list.name, fontWeight = FontWeight.SemiBold)
                                    Text("${list.placeCount} places")
                                }
                                Icon(MaterialIcons.Filled.ChevronRight, null)
                            }
                        }
                    }
                }
            }
        }
    }

    if (showCreateDialog) {
        val colorOptions = listOf(
            null to "Default",
            "#E53935" to "Red",
            "#FF8F00" to "Orange",
            "#43A047" to "Green",
            "#1E88E5" to "Blue",
            "#8E24AA" to "Purple",
            "#00ACC1" to "Teal",
        )
        AlertDialog(
            onDismissRequest = { showCreateDialog = false },
            title = { Text("New Play List") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedTextField(
                        value = newListName,
                        onValueChange = { newListName = it },
                        label = { Text("List name") },
                        modifier = Modifier.fillMaxWidth()
                    )
                    Text("Color", fontSize = 13.sp, color = Color.Gray)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        colorOptions.forEach { (hex, _) ->
                            val bgColor = if (hex != null) Color(hex.removePrefix("#").toLong(16) or 0xFF000000) else Color(0xFFE0E0E0)
                            val isSelected = newListColor == hex
                            Box(
                                modifier = Modifier
                                    .size(32.dp)
                                    .background(bgColor, shape = RoundedCornerShape(16.dp))
                                    .then(if (isSelected) Modifier.border(2.dp, Color(0xFF212121), RoundedCornerShape(16.dp)) else Modifier)
                                    .clickable { newListColor = hex },
                                contentAlignment = Alignment.Center,
                            ) {
                                if (isSelected) Text("✓", fontSize = 12.sp, color = Color.White)
                            }
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    scope.launch {
                        try { service.createList(newListName, newListColor) } catch (_: Exception) {}
                        newListName = ""
                        newListColor = null
                        showCreateDialog = false
                        reload()
                    }
                }, enabled = newListName.isNotBlank()) { Text("Create") }
            },
            dismissButton = {
                TextButton(onClick = { showCreateDialog = false; newListName = ""; newListColor = null }) { Text("Cancel") }
            }
        )
    }
}
