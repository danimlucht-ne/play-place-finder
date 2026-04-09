package org.community.playgroundfinder.ui.screens.admin

import androidx.compose.foundation.background
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
import org.community.playgroundfinder.models.CityPhaseListItem

@Composable
fun AdminCityPhaseScreen(
    playgroundService: PlaygroundService,
    onBack: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val snackbarHostState = remember { SnackbarHostState() }
    var cities by remember { mutableStateOf<List<CityPhaseListItem>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var errorMsg by remember { mutableStateOf<String?>(null) }

    fun loadCities() {
        scope.launch {
            isLoading = true
            errorMsg = null
            try {
                cities = playgroundService.getAdminCityPhases()
            } catch (e: Exception) {
                errorMsg = e.message ?: "Failed to load city phases"
            } finally {
                isLoading = false
            }
        }
    }

    LaunchedEffect(Unit) { loadCities() }

    Scaffold(snackbarHost = { SnackbarHost(hostState = snackbarHostState) }) { padding ->
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
                Text("Error: $errorMsg", color = MaterialTheme.colorScheme.error)
                Spacer(Modifier.height(12.dp))
                Button(onClick = { loadCities() }) { Text("Retry") }
            }
        }

        cities.isEmpty() -> Box(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentAlignment = Alignment.Center
        ) {
            Text("No cities configured yet.", color = Color.Gray)
        }

        else -> LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            item {
                Text(
                    "${cities.size} cities",
                    fontSize = 13.sp,
                    color = Color.Gray,
                )
            }
            items(cities, key = { it.cityId }) { city ->
                CityPhaseCard(
                    city = city,
                    onOpenAdvertising = {
                        scope.launch {
                            try {
                                playgroundService.openCityAdvertising(city.cityId)
                                loadCities()
                            } catch (e: Exception) {
                                snackbarHostState.showSnackbar(
                                    e.message ?: "Failed to open advertising"
                                )
                            }
                        }
                    },
                    onPhaseOverride = { newPhase ->
                        scope.launch {
                            try {
                                playgroundService.setAdminCityPhase(city.cityId, newPhase)
                                loadCities()
                            } catch (e: Exception) {
                                snackbarHostState.showSnackbar(
                                    e.message ?: "Failed to update phase"
                                )
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
private fun CityPhaseCard(
    city: CityPhaseListItem,
    onOpenAdvertising: () -> Unit,
    onPhaseOverride: (String) -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        elevation = CardDefaults.cardElevation(2.dp),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            // City ID + Phase badge row
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(
                    city.cityId,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 15.sp,
                    modifier = Modifier.weight(1f),
                )
                PhaseBadge(phase = city.phase)
            }

            city.slots?.let { slots ->
                Row(
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    SlotLabel(
                        label = "Featured",
                        remaining = slots.featured.remaining,
                        max = slots.featured.max,
                    )
                    SlotLabel(
                        label = "Sponsored",
                        remaining = slots.sponsored.remaining,
                        max = slots.sponsored.max,
                    )
                }
            }

            // Actions
            if (city.phase == "seeding") {
                Button(
                    onClick = onOpenAdvertising,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Open advertising")
                }
            } else {
                PhaseOverrideDropdown(
                    currentPhase = city.phase,
                    onPhaseSelected = onPhaseOverride,
                )
            }
        }
    }
}

@Composable
private fun PhaseBadge(phase: String) {
    val color = when (phase) {
        "seeding" -> Color.Gray
        "growing", "growth" -> Color(0xFF4CAF50)  // green
        "mature" -> Color(0xFF9C27B0)  // purple
        else -> Color.Gray
    }
    Box(
        modifier = Modifier
            .background(color.copy(alpha = 0.12f), RoundedCornerShape(6.dp))
            .padding(horizontal = 10.dp, vertical = 4.dp),
    ) {
        Text(
            phase,
            fontSize = 12.sp,
            fontWeight = FontWeight.Medium,
            color = color,
        )
    }
}

@Composable
private fun SlotLabel(label: String, remaining: Int, max: Int) {
    Column {
        Text(label, fontSize = 12.sp, color = Color.Gray)
        Text(
            "$remaining/$max",
            fontSize = 14.sp,
            fontWeight = FontWeight.Medium,
        )
    }
}

@Composable
private fun PhaseOverrideDropdown(
    currentPhase: String,
    onPhaseSelected: (String) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    val phases = listOf("growing", "mature")

    Box {
        OutlinedButton(onClick = { expanded = true }) {
            Text("Override Phase: $currentPhase")
        }
        DropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
        ) {
            phases.forEach { phase ->
                DropdownMenuItem(
                    text = { Text(phase) },
                    onClick = {
                        expanded = false
                        if (phase != currentPhase) {
                            onPhaseSelected(phase)
                        }
                    },
                    enabled = phase != currentPhase,
                )
            }
        }
    }
}
