package org.community.playgroundfinder.ui.screens.admin

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.community.playgroundfinder.data.ContributorLeaderboardEntry
import org.community.playgroundfinder.data.PlaygroundService
import org.community.playgroundfinder.models.SeededRegion
import org.community.playgroundfinder.ui.composables.FormColors

private fun epochDaysToDateString(epochDays: Long): String {
    var z = epochDays + 719468L
    val era = (if (z >= 0) z else z - 146096L) / 146097L
    val doe = (z - era * 146097L).toInt()
    val yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365
    val y = yoe + era * 400
    val doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
    val mp = (5 * doy + 2) / 153
    val d = doy - (153 * mp + 2) / 5 + 1
    val m = if (mp < 10) mp + 3 else mp - 9
    val yr = if (m <= 2) y + 1 else y
    return "${yr}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}"
}

@Suppress("DEPRECATION")
private fun epochDaysNow(): Long = java.util.Date().time / 86400000L

private fun todayString(): String = epochDaysToDateString(epochDaysNow())
private fun daysAgoString(days: Int): String = epochDaysToDateString(epochDaysNow() - days)
private val leaderboardPresets = listOf("Last 7 days" to 7, "Last 30 days" to 30, "Last 90 days" to 90)

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun AdminLeaderboardScreen(service: PlaygroundService) {
    val scope = rememberCoroutineScope()
    var entries by remember { mutableStateOf<List<ContributorLeaderboardEntry>>(emptyList()) }
    var regions by remember { mutableStateOf<List<SeededRegion>>(emptyList()) }
    var selectedRegion by remember { mutableStateOf<String?>(null) }
    var startDate by remember { mutableStateOf(daysAgoString(30)) }
    var endDate by remember { mutableStateOf(todayString()) }
    var selectedPreset by remember { mutableStateOf("Last 30 days") }
    var isLoading by remember { mutableStateOf(true) }
    var errorMsg by remember { mutableStateOf<String?>(null) }
    var dropdownExpanded by remember { mutableStateOf(false) }

    fun fetchLeaderboard() {
        scope.launch {
            isLoading = true
            errorMsg = null
            try {
                entries = service.getContributorLeaderboard(
                    startDate = startDate,
                    endDate = endDate,
                    limit = 50,
                    regionKey = selectedRegion,
                )
            } catch (e: Exception) {
                errorMsg = e.message ?: "Failed to load contributor leaderboard"
            } finally {
                isLoading = false
            }
        }
    }

    LaunchedEffect(selectedRegion, startDate, endDate) { fetchLeaderboard() }

    LaunchedEffect(Unit) {
        try {
            regions = service.getSeededRegions().data
        } catch (_: Exception) {}
    }

    val totalPoints = entries.sumOf { it.periodScore }
    val totalActions = entries.sumOf { it.contributionCount }
    val reviewed = entries.sumOf { it.approved + it.rejected }
    val approved = entries.sumOf { it.approved }
    val approvalRate = if (reviewed > 0) approved.toDouble() / reviewed.toDouble() else null

    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Text("Contributor Leaderboard", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Text(
            "See who is contributing, what kind of work they are doing, and how often those contributions are getting approved.",
            fontSize = 12.sp,
            color = Color(0xFF616161),
            modifier = Modifier.padding(top = 4.dp, bottom = 12.dp),
        )

        FlowRow(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            leaderboardPresets.forEach { (label, days) ->
                FilterChip(
                    selected = selectedPreset == label,
                    onClick = {
                        selectedPreset = label
                        startDate = daysAgoString(days)
                        endDate = todayString()
                    },
                    label = { Text(label, fontSize = 13.sp) },
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = FormColors.SelectedChip,
                        selectedLabelColor = FormColors.SelectedChipText,
                    ),
                )
            }
        }

        Spacer(Modifier.padding(top = 8.dp))

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            OutlinedTextField(
                value = startDate,
                onValueChange = { startDate = it; selectedPreset = "" },
                label = { Text("Start") },
                modifier = Modifier.weight(1f),
                singleLine = true,
            )
            OutlinedTextField(
                value = endDate,
                onValueChange = { endDate = it; selectedPreset = "" },
                label = { Text("End") },
                modifier = Modifier.weight(1f),
                singleLine = true,
            )
        }

        Spacer(Modifier.padding(top = 8.dp))

        ExposedDropdownMenuBox(
            expanded = dropdownExpanded,
            onExpandedChange = { dropdownExpanded = it },
        ) {
            OutlinedTextField(
                value = if (selectedRegion == null) "All Regions" else selectedRegion ?: "",
                onValueChange = {},
                readOnly = true,
                label = { Text("Region") },
                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = dropdownExpanded) },
                modifier = Modifier.fillMaxWidth().menuAnchor(),
                singleLine = true,
            )
            ExposedDropdownMenu(
                expanded = dropdownExpanded,
                onDismissRequest = { dropdownExpanded = false },
            ) {
                DropdownMenuItem(
                    text = { Text("All Regions") },
                    onClick = {
                        selectedRegion = null
                        dropdownExpanded = false
                    },
                )
                regions.forEach { region ->
                    val label = "${region.displayCity.ifBlank { region.city }}, ${region.state}"
                    DropdownMenuItem(
                        text = { Text(label) },
                        onClick = {
                            selectedRegion = region.regionKey
                            dropdownExpanded = false
                        },
                    )
                }
            }
        }

        Spacer(Modifier.padding(top = 12.dp))

        when {
            isLoading -> Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }

            errorMsg != null -> Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(errorMsg ?: "Failed to load leaderboard", color = FormColors.ErrorText, fontSize = 14.sp)
                    Spacer(Modifier.padding(top = 8.dp))
                    Button(onClick = { fetchLeaderboard() }) { Text("Retry") }
                }
            }

            entries.isEmpty() -> Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("No contributor activity found for this window.", color = Color.Gray, fontSize = 14.sp)
            }

            else -> LazyColumn(
                modifier = Modifier.fillMaxSize(),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                item {
                    FlowRow(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        SummaryCard("Contributors", entries.size.toString())
                        SummaryCard("Points", totalPoints.toString())
                        SummaryCard("Actions", totalActions.toString())
                        SummaryCard("Approval", approvalRate?.let { "${(it * 100).toInt()}%" } ?: "-")
                    }
                }

                items(entries) { entry ->
                    LeaderboardCard(entry)
                }
            }
        }
    }
}

@Composable
private fun SummaryCard(label: String, value: String) {
    Card(
        shape = RoundedCornerShape(8.dp),
        colors = CardDefaults.cardColors(containerColor = FormColors.CardBackground),
    ) {
        Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) {
            Text(label, fontSize = 11.sp, color = Color(0xFF616161))
            Text(value, fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = FormColors.PrimaryButton)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun LeaderboardCard(entry: ContributorLeaderboardEntry) {
    Card(
        shape = RoundedCornerShape(8.dp),
        colors = CardDefaults.cardColors(containerColor = FormColors.CardBackground),
    ) {
        Column(modifier = Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Top,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = "#${entry.rank} ${entry.displayName?.takeIf { it.isNotBlank() } ?: "Anonymous"}",
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 15.sp,
                    )
                    val subtitle = listOfNotNull(entry.level, entry.city).joinToString(" | ")
                    if (subtitle.isNotBlank()) {
                        Text(subtitle, fontSize = 12.sp, color = Color(0xFF757575))
                    }
                }
                Column(horizontalAlignment = Alignment.End) {
                    Text("${entry.periodScore} pts", fontWeight = FontWeight.SemiBold, color = FormColors.PrimaryButton)
                    Text("Lifetime ${entry.lifetimeScore}", fontSize = 11.sp, color = Color(0xFF757575))
                }
            }

            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                MiniStat("Photos", entry.photos.toString())
                MiniStat("Edits", entry.edits.toString())
                MiniStat("New", entry.newPlaygrounds.toString())
                MiniStat("Reports", entry.reports.toString())
                MiniStat("Approved", entry.approved.toString())
                MiniStat("Rejected", entry.rejected.toString())
                MiniStat("Approval", entry.approvalRate?.let { "${(it * 100).toInt()}%" } ?: "-")
            }

            HorizontalDivider()
            Text(
                text = "Last activity: ${entry.lastContributionAt?.take(10) ?: "-"} | ${entry.contributionCount} total actions",
                fontSize = 11.sp,
                color = Color(0xFF616161),
            )
        }
    }
}

@Composable
private fun MiniStat(label: String, value: String) {
    Card(
        shape = RoundedCornerShape(8.dp),
        colors = CardDefaults.cardColors(containerColor = Color.White),
    ) {
        Column(modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp)) {
            Text(label, fontSize = 10.sp, color = Color(0xFF757575))
            Text(value, fontSize = 13.sp, fontWeight = FontWeight.Medium)
        }
    }
}

