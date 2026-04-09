package org.community.playgroundfinder.ui.screens.admin

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.community.playgroundfinder.data.PlaygroundService
import org.community.playgroundfinder.models.SeededRegion
import org.community.playgroundfinder.ui.composables.FormColors

@Composable
fun AdminRegionSwitcherScreen(
    service: PlaygroundService,
    onRegionSelected: (SeededRegion) -> Unit,
    onNavigateBack: () -> Unit
) {
    val scope = rememberCoroutineScope()
    val snackbarHostState = remember { SnackbarHostState() }
    var regions by remember { mutableStateOf<List<SeededRegion>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var errorMsg by remember { mutableStateOf<String?>(null) }

    // Seed new region state
    var city by remember { mutableStateOf("") }
    var state by remember { mutableStateOf("") }
    var isSeedingInProgress by remember { mutableStateOf(false) }
    var seedResultMessage by remember { mutableStateOf<String?>(null) }
    var seedResultIsError by remember { mutableStateOf(false) }

    // Region action state
    var deleteConfirmRegion by remember { mutableStateOf<String?>(null) }
    var actionLoading by remember { mutableStateOf<Set<String>>(emptySet()) }

    var searchQuery by remember { mutableStateOf("") }
    var expandedStates by remember { mutableStateOf<Set<String>>(emptySet()) }
    var phaseByCityId by remember { mutableStateOf<Map<String, String>>(emptyMap()) }

    val filteredRegions = remember(regions, searchQuery) {
        val q = searchQuery.trim().lowercase()
        if (q.isEmpty()) regions
        else regions.filter { r ->
            val c = r.displayCity.ifBlank { r.city }
            c.lowercase().contains(q) ||
                r.state.lowercase().contains(q) ||
                r.regionKey.lowercase().contains(q)
        }
    }

    val regionsByState = remember(filteredRegions) {
        filteredRegions
            .groupBy { it.state.ifBlank { "—" } }
            .mapValues { (_, list) -> list.sortedBy { it.displayCity.ifBlank { it.city }.lowercase() } }
            .entries
            .sortedBy { it.key.lowercase() }
            .map { it.key to it.value }
    }

    LaunchedEffect(searchQuery, regionsByState) {
        if (searchQuery.isNotBlank()) {
            expandedStates = regionsByState.map { it.first }.toSet()
        }
    }

    fun loadRegions() {
        scope.launch {
            isLoading = true
            errorMsg = null
            try {
                regions = service.getSeededRegions().data
                    .sortedWith(
                        compareBy<SeededRegion> { it.state.lowercase() }
                            .thenBy { it.displayCity.ifBlank { it.city }.lowercase() },
                    )
            } catch (e: Exception) {
                errorMsg = e.message ?: "Failed to load regions"
            } finally {
                isLoading = false
            }
        }
    }

    fun loadAdPhases() {
        scope.launch {
            try {
                phaseByCityId = service.getAdminCityPhases().associate { it.cityId to it.phase }
            } catch (_: Exception) {}
        }
    }

    fun seedRegion() {
        val trimmedCity = city.trim()
        val trimmedState = state.trim()
        if (trimmedCity.isBlank() || trimmedState.isBlank()) return
        scope.launch {
            isSeedingInProgress = true
            seedResultMessage = null
            try {
                val result = service.adminSeedRegion(trimmedCity, trimmedState)
                val message = result["message"] ?: "Seeding triggered"
                seedResultMessage = message.toString()
                seedResultIsError = false
                city = ""
                state = ""
                try { regions = service.getSeededRegions().data } catch (_: Exception) {}
            } catch (e: Exception) {
                seedResultMessage = e.message ?: "Seed failed"
                seedResultIsError = true
            } finally {
                isSeedingInProgress = false
            }
        }
    }

    LaunchedEffect(Unit) {
        loadRegions()
        loadAdPhases()
    }

    // Delete confirmation dialog
    if (deleteConfirmRegion != null) {
        AlertDialog(
            onDismissRequest = { deleteConfirmRegion = null },
            title = { Text("Delete Region?", color = FormColors.ErrorText) },
            text = { Text("This will delete the region and all its playground data. This cannot be undone.") },
            confirmButton = {
                TextButton(onClick = {
                    val key = deleteConfirmRegion ?: return@TextButton
                    deleteConfirmRegion = null
                    scope.launch {
                        actionLoading = actionLoading + key
                        try {
                            service.adminDeleteRegion(key)
                            loadRegions()
                        } catch (e: Exception) {
                            snackbarHostState.showSnackbar(e.message ?: "Failed to delete region")
                        }
                        actionLoading = actionLoading - key
                    }
                }) { Text("Delete", color = FormColors.ErrorText) }
            },
            dismissButton = { TextButton(onClick = { deleteConfirmRegion = null }) { Text("Cancel") } }
        )
    }

    Scaffold(
        snackbarHost = { SnackbarHost(hostState = snackbarHostState) },
        containerColor = FormColors.ScreenBackground,
        contentColor = FormColors.BodyText,
    ) { padding ->
    when {
        isLoading -> Box(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentAlignment = Alignment.Center
        ) {
            CircularProgressIndicator()
        }

        errorMsg != null -> Box(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentAlignment = Alignment.Center
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text("Error: $errorMsg", color = FormColors.ErrorText)
                Spacer(Modifier.height(12.dp))
                Button(
                    onClick = { loadRegions() },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = FormColors.PrimaryButton,
                        contentColor = FormColors.PrimaryButtonText
                    )
                ) { Text("Retry") }
            }
        }

        else -> LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // Seed new region section
            item {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(16.dp),
                    elevation = CardDefaults.cardElevation(2.dp),
                    colors = CardDefaults.cardColors(containerColor = FormColors.CardBackground)
                ) {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Text("Seed New Region", fontWeight = FontWeight.Bold, fontSize = 16.sp)
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            OutlinedTextField(
                                value = city,
                                onValueChange = { city = it },
                                label = { Text("City") },
                                singleLine = true,
                                modifier = Modifier.weight(1f)
                            )
                            OutlinedTextField(
                                value = state,
                                onValueChange = { state = it },
                                label = { Text("State") },
                                singleLine = true,
                                modifier = Modifier.weight(0.6f)
                            )
                        }
                        Button(
                            onClick = { seedRegion() },
                            enabled = !isSeedingInProgress && city.isNotBlank() && state.isNotBlank(),
                            modifier = Modifier.fillMaxWidth(),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = FormColors.PrimaryButton,
                                contentColor = FormColors.PrimaryButtonText
                            )
                        ) {
                            if (isSeedingInProgress) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(18.dp),
                                    strokeWidth = 2.dp,
                                    color = Color.White
                                )
                                Spacer(Modifier.width(8.dp))
                            }
                            Text("Seed New Region")
                        }
                        seedResultMessage?.let { msg ->
                            Text(
                                msg,
                                color = if (seedResultIsError) FormColors.ErrorText else Color(0xFF2E7D32),
                                fontSize = 13.sp
                            )
                        }
                    }
                }
            }

            // Search + region count
            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = searchQuery,
                        onValueChange = { searchQuery = it },
                        modifier = Modifier.fillMaxWidth(),
                        placeholder = { Text("Search city, state, or region key") },
                        leadingIcon = {
                            Icon(Icons.Filled.Search, contentDescription = null)
                        },
                        trailingIcon = {
                            if (searchQuery.isNotEmpty()) {
                                IconButton(onClick = { searchQuery = "" }) {
                                    Icon(Icons.Filled.Clear, contentDescription = "Clear search")
                                }
                            }
                        },
                        singleLine = true,
                        shape = RoundedCornerShape(12.dp)
                    )
                    val label = buildString {
                        append("${filteredRegions.size}")
                        if (searchQuery.isNotBlank() && filteredRegions.size != regions.size) {
                            append(" of ${regions.size}")
                        }
                        append(" seeded region")
                        if (filteredRegions.size != 1) append("s")
                        if (searchQuery.isNotBlank()) append(" · ${regionsByState.size} state")
                        if (searchQuery.isNotBlank() && regionsByState.size != 1) append("s")
                    }
                    Text(label, fontSize = 13.sp, color = Color.Gray)
                    Text(
                        "Seed status (per region) is only about map data: complete means the full Places + scrub + merge " +
                            "pipeline finished. Re-seed wipes that region’s playgrounds and seed queues, then runs a fresh " +
                            "hybrid seed in the background (running → partial → complete). Expand bumps coverage metadata and " +
                            "runs an additive Places grid in the background (running → complete).",
                        fontSize = 12.sp,
                        color = Color(0xFF757575),
                        lineHeight = 16.sp,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                    Text(
                        "Ad phase is separate from seed status. Seeding means there is no cityAdSettings row for that " +
                            "regionKey yet — the app shows house ads and blocks most advertisers. It becomes Growth when the " +
                            "first advertiser finishes signup for that city, or when you use Open advertising / Set phase below " +
                            "(Mature can follow automatically unless you override).",
                        fontSize = 12.sp,
                        color = Color(0xFF757575),
                        lineHeight = 16.sp,
                        modifier = Modifier.padding(top = 6.dp),
                    )
                }
            }

            if (filteredRegions.isEmpty() && regions.isNotEmpty()) {
                item {
                    Text(
                        "No regions match your search.",
                        color = Color.Gray,
                        fontSize = 14.sp,
                        modifier = Modifier.padding(vertical = 8.dp)
                    )
                }
            }

            // Region list grouped by state (accordion)
            items(regionsByState, key = { it.first }) { (stateCode, stateRegions) ->
                val sectionExpanded =
                    searchQuery.isNotBlank() || stateCode in expandedStates
                StateRegionAccordion(
                    stateCode = stateCode,
                    regions = stateRegions,
                    expanded = sectionExpanded,
                    onToggle = {
                        if (searchQuery.isBlank()) {
                            expandedStates =
                                if (stateCode in expandedStates) expandedStates - stateCode
                                else expandedStates + stateCode
                        }
                    },
                    actionLoading = actionLoading,
                    phaseByCityId = phaseByCityId,
                    onRegionSelected = onRegionSelected,
                    onDeleteRequest = { deleteConfirmRegion = it },
                    onReseed = { regionKey ->
                        scope.launch {
                            actionLoading = actionLoading + regionKey
                            try {
                                service.adminReseedRegion(regionKey)
                                snackbarHostState.showSnackbar(
                                    "Full re-seed started — playgrounds cleared; hybrid seed runs in background. Refresh this list to watch seedStatus → complete.",
                                )
                                loadRegions()
                            } catch (e: Exception) {
                                snackbarHostState.showSnackbar(e.message ?: "Failed to re-seed region")
                            }
                            actionLoading = actionLoading - regionKey
                        }
                    },
                    onExpandRegion = { regionKey ->
                        scope.launch {
                            actionLoading = actionLoading + regionKey
                            try {
                                service.adminExpandRegion(regionKey)
                                snackbarHostState.showSnackbar(
                                    "Expand started — additive Places crawl in background. seedStatus → complete when done.",
                                )
                                loadRegions()
                            } catch (e: Exception) {
                                snackbarHostState.showSnackbar(e.message ?: "Failed to expand region")
                            }
                            actionLoading = actionLoading - regionKey
                        }
                    },
                    onLightweightReseed = { regionKey ->
                        scope.launch {
                            actionLoading = actionLoading + regionKey
                            try {
                                service.adminLightweightReseedRegion(regionKey)
                                snackbarHostState.showSnackbar("Light re-seed scheduled — new POIs upsert in the background.")
                                loadRegions()
                            } catch (e: Exception) {
                                snackbarHostState.showSnackbar(e.message ?: "Light re-seed failed")
                            }
                            actionLoading = actionLoading - regionKey
                        }
                    },
                    onSetAdPhase = { regionKey, phase ->
                        scope.launch {
                            try {
                                service.setAdminCityPhase(regionKey, phase)
                                loadAdPhases()
                            } catch (e: Exception) {
                                snackbarHostState.showSnackbar(e.message ?: "Failed to update phase")
                            }
                        }
                    },
                    onOpenCityAdvertising = { regionKey ->
                        scope.launch {
                            try {
                                service.openCityAdvertising(regionKey)
                                loadAdPhases()
                            } catch (e: Exception) {
                                snackbarHostState.showSnackbar(e.message ?: "Failed to open advertising")
                            }
                        }
                    },
                )
            }
        }
    }
    }
}

@Composable
private fun StateRegionAccordion(
    stateCode: String,
    regions: List<SeededRegion>,
    expanded: Boolean,
    onToggle: () -> Unit,
    actionLoading: Set<String>,
    phaseByCityId: Map<String, String>,
    onRegionSelected: (SeededRegion) -> Unit,
    onDeleteRequest: (String) -> Unit,
    onReseed: (String) -> Unit,
    onExpandRegion: (String) -> Unit,
    onLightweightReseed: (String) -> Unit,
    onSetAdPhase: (regionKey: String, phase: String) -> Unit,
    onOpenCityAdvertising: (regionKey: String) -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        elevation = CardDefaults.cardElevation(1.dp),
        colors = CardDefaults.cardColors(containerColor = Color(0xFFF5F5F5))
    ) {
        Column {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable(onClick = onToggle)
                    .padding(horizontal = 14.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text(stateCode, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
                    Text("(${regions.size})", fontSize = 14.sp, color = Color.Gray)
                }
                Icon(
                    imageVector = if (expanded) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore,
                    contentDescription = if (expanded) "Collapse" else "Expand",
                    tint = Color.Gray
                )
            }
            AnimatedVisibility(
                visible = expanded,
                enter = fadeIn() + expandVertically(),
                exit = fadeOut() + shrinkVertically()
            ) {
                Column(
                    modifier = Modifier.padding(start = 8.dp, end = 8.dp, bottom = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    regions.forEach { region ->
                        val phase = phaseByCityId[region.regionKey] ?: "seeding"
                        RegionCard(
                            region = region,
                            adPhase = phase,
                            onClick = { onRegionSelected(region) },
                            isActionLoading = region.regionKey in actionLoading,
                            onDelete = { onDeleteRequest(region.regionKey) },
                            onReseed = { onReseed(region.regionKey) },
                            onExpand = { onExpandRegion(region.regionKey) },
                            onLightweightReseed = { onLightweightReseed(region.regionKey) },
                            onSetAdPhase = { onSetAdPhase(region.regionKey, it) },
                            onOpenCityAdvertising = { onOpenCityAdvertising(region.regionKey) },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun RegionCard(
    region: SeededRegion,
    adPhase: String,
    onClick: () -> Unit,
    isActionLoading: Boolean,
    onDelete: () -> Unit,
    onReseed: () -> Unit,
    onExpand: () -> Unit,
    onLightweightReseed: () -> Unit,
    onSetAdPhase: (String) -> Unit,
    onOpenCityAdvertising: () -> Unit,
) {
    var phaseMenuOpen by remember { mutableStateOf(false) }
    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        shape = RoundedCornerShape(16.dp),
        elevation = CardDefaults.cardElevation(1.dp),
        colors = CardDefaults.cardColors(containerColor = FormColors.CardBackground)
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                // Status dot
                Box(
                    modifier = Modifier
                        .size(10.dp)
                        .clip(CircleShape)
                        .background(statusColor(region.seedStatus))
                )
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        "${region.displayCity.ifBlank { region.city }}, ${region.state}",
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 15.sp
                    )
                    Text(
                        region.regionKey,
                        fontSize = 12.sp,
                        color = Color.Gray
                    )
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            "Ad phase: $adPhase",
                            fontSize = 11.sp,
                            color = Color(0xFF757575),
                        )
                        Box {
                            TextButton(
                                onClick = { phaseMenuOpen = true },
                                contentPadding = PaddingValues(horizontal = 6.dp, vertical = 0.dp),
                            ) { Text("Set", fontSize = 11.sp) }
                            DropdownMenu(
                                expanded = phaseMenuOpen,
                                onDismissRequest = { phaseMenuOpen = false },
                            ) {
                                listOf("growing", "mature").forEach { ph ->
                                    DropdownMenuItem(
                                        text = { Text(ph) },
                                        onClick = {
                                            phaseMenuOpen = false
                                            onSetAdPhase(ph)
                                        },
                                    )
                                }
                                if (adPhase == "seeding") {
                                    DropdownMenuItem(
                                        text = { Text("Open advertising (regional pricing)") },
                                        onClick = {
                                            phaseMenuOpen = false
                                            onOpenCityAdvertising()
                                        },
                                    )
                                }
                            }
                        }
                    }
                }
                Column(horizontalAlignment = Alignment.End) {
                    Text(
                        "${region.placeCount} places",
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Medium
                    )
                    StatusChip(status = region.seedStatus)
                }
            }

            Spacer(Modifier.height(10.dp))

            // Action buttons row
            if (isActionLoading) {
                Box(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                }
            } else {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    OutlinedButton(
                        onClick = onDelete,
                        modifier = Modifier.weight(1f),
                        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = FormColors.ErrorText),
                        shape = RoundedCornerShape(8.dp)
                    ) { Text("Delete", fontSize = 12.sp) }

                    Button(
                        onClick = onReseed,
                        modifier = Modifier.weight(1f),
                        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = FormColors.PrimaryButton,
                            contentColor = FormColors.PrimaryButtonText
                        ),
                        shape = RoundedCornerShape(8.dp)
                    ) { Text("Re-seed", fontSize = 12.sp) }

                    OutlinedButton(
                        onClick = onExpand,
                        modifier = Modifier.weight(1f),
                        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = FormColors.PrimaryButton),
                        shape = RoundedCornerShape(8.dp)
                    ) { Text("Expand", fontSize = 12.sp) }
                }
                OutlinedButton(
                    onClick = onLightweightReseed,
                    modifier = Modifier.fillMaxWidth(),
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 6.dp),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = Color(0xFF00695C)),
                    shape = RoundedCornerShape(8.dp),
                ) {
                    Text("Light re-seed (Places crawl)", fontSize = 12.sp)
                }
            }
        }
    }
}

@Composable
private fun StatusChip(status: String) {
    val color = statusColor(status)
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(6.dp))
            .background(color.copy(alpha = 0.12f))
            .padding(horizontal = 8.dp, vertical = 3.dp)
    ) {
        Text(
            status.ifBlank { "unknown" },
            fontSize = 11.sp,
            color = color,
            fontWeight = FontWeight.Medium
        )
    }
}

private fun statusColor(status: String): Color = when (status.lowercase()) {
    "complete" -> Color(0xFF4CAF50)  // green
    "partial" -> Color(0xFFFF9800)   // orange
    "running" -> Color(0xFF2196F3)   // blue
    "failed" -> Color(0xFFF44336)    // red
    else -> Color.Gray
}
