package org.community.playgroundfinder.ui.screens.admin

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.community.playgroundfinder.data.AdminAnalyticsOverview
import org.community.playgroundfinder.data.CityGrowthEntry
import org.community.playgroundfinder.data.DailyTrendPoint
import org.community.playgroundfinder.data.PlaygroundService
import org.community.playgroundfinder.ui.composables.FormColors

// ─── Date helpers ────────────────────────────────────────────────────────────

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

private val DATE_PRESETS = listOf("Last 7 days" to 7, "Last 30 days" to 30, "Last 90 days" to 90)

private fun adminPlacementDisplayTitle(raw: String): String = when (raw) {
    "featured_home" -> "Featured (home)"
    "inline_listing" -> "Inline in search"
    else -> raw.replace('_', ' ').replaceFirstChar { it.uppercase() }
}

// ─── Screen ───────────────────────────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun AdminAnalyticsScreen(service: PlaygroundService) {
    var startDate by remember { mutableStateOf(daysAgoString(30)) }
    var endDate by remember { mutableStateOf(todayString()) }
    var selectedPreset by remember { mutableStateOf("Last 30 days") }

    var trends by remember { mutableStateOf<List<DailyTrendPoint>>(emptyList()) }
    var cityGrowth by remember { mutableStateOf<List<CityGrowthEntry>>(emptyList()) }
    var overview by remember { mutableStateOf(AdminAnalyticsOverview()) }
    var isLoading by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    val scope = rememberCoroutineScope()

    fun fetchData() {
        scope.launch {
            isLoading = true
            errorMessage = null
            try {
                val (t, o, g) = Triple(
                    service.getDailyTrends(startDate, endDate),
                    service.getAdminAnalyticsOverview(startDate, endDate),
                    service.getCityGrowthSummary()
                )
                trends = t
                overview = o
                cityGrowth = g
            } catch (e: Exception) {
                errorMessage = e.message ?: "Failed to load analytics"
            } finally {
                isLoading = false
            }
        }
    }

    LaunchedEffect(startDate, endDate) { fetchData() }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("Analytics", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)

        // Date preset chips
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            DATE_PRESETS.forEach { (label, days) ->
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
                    )
                )
            }
        }

        // Date range row
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
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

        when {
            isLoading -> Box(modifier = Modifier.fillMaxWidth().height(200.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
            errorMessage != null -> Column(
                modifier = Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(errorMessage ?: "Error", color = FormColors.ErrorText)
                Spacer(modifier = Modifier.height(8.dp))
                Button(
                    onClick = { fetchData() },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = FormColors.PrimaryButton,
                        contentColor = FormColors.PrimaryButtonText
                    )
                ) { Text("Retry") }
            }
            else -> {
                FlowRow(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    AnalyticsSummaryCard("Points awarded", overview.contributions.pointsAwarded.toString())
                    AnalyticsSummaryCard("Active contributors", overview.contributions.activeContributors.toString())
                    AnalyticsSummaryCard("Ad views", overview.ads.impressions.toString())
                    AnalyticsSummaryCard(
                        "Tapped through (avg)",
                        if (overview.ads.impressions > 0) "${(overview.ads.ctr * 100).toInt()}%" else "0%",
                    )
                }

                // Line chart
                if (trends.isNotEmpty()) {
                    Text("Daily Activity", fontWeight = FontWeight.SemiBold)
                    TrendLineChart(trends = trends, modifier = Modifier.fillMaxWidth().height(200.dp))
                }

                if (overview.contributions.contributionCount > 0) {
                    Text("Contribution Mix", fontWeight = FontWeight.SemiBold)
                    FlowRow(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        AnalyticsSummaryCard("Photos", overview.contributions.photos.toString())
                        AnalyticsSummaryCard("Edits", overview.contributions.edits.toString())
                        AnalyticsSummaryCard("New places", overview.contributions.newPlaygrounds.toString())
                        AnalyticsSummaryCard("Reports", overview.contributions.reports.toString())
                        AnalyticsSummaryCard("Approved", overview.contributions.approved.toString())
                        AnalyticsSummaryCard("Rejected", overview.contributions.rejected.toString())
                    }
                }

                if (overview.ads.topCampaigns.isNotEmpty()) {
                    Text("Top campaigns", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    overview.ads.topCampaigns.forEach { campaign ->
                        val pct = (campaign.ctr * 100).toInt().coerceAtMost(100)
                        AnalyticsMetricRow(
                            title = campaign.label,
                            subtitle = campaign.status.replaceFirstChar { it.uppercase() }.ifBlank { "Campaign" },
                            value = "${campaign.impressions} views · ${campaign.clicks} clicks · $pct% tapped",
                            badgeDemo = campaign.isDemoCampaign,
                        )
                    }
                }

                if (overview.ads.placements.isNotEmpty()) {
                    Text("Where ads ran", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    overview.ads.placements.forEach { placement ->
                        val pct = (placement.ctr * 100).toInt().coerceAtMost(100)
                        AnalyticsMetricRow(
                            title = adminPlacementDisplayTitle(placement.placement),
                            subtitle = "All campaigns in this slot",
                            value = "${placement.impressions} views · ${placement.clicks} clicks · $pct% tapped",
                            footnote = if (placement.includesDemoOrTestTraffic) {
                                "Includes views/clicks from demo or test creatives"
                            } else {
                                null
                            },
                        )
                    }
                }

                // City growth
                if (cityGrowth.isNotEmpty()) {
                    Text("City Growth", fontWeight = FontWeight.SemiBold)
                    cityGrowth.forEach { entry ->
                        CityGrowthRow(entry)
                    }
                }
            }
        }
    }
}

// ─── Line Chart ───────────────────────────────────────────────────────────────

@Composable
private fun TrendLineChart(trends: List<DailyTrendPoint>, modifier: Modifier = Modifier) {
    val lineColor = MaterialTheme.colorScheme.primary
    val gridColor = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.45f)

    Card(modifier = modifier, elevation = CardDefaults.cardElevation(1.dp), shape = RoundedCornerShape(16.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Canvas(modifier = Modifier.fillMaxSize().padding(12.dp)) {
            val maxVal = trends.maxOf { it.newPlaygrounds + it.newUsers + it.crowdReports }.coerceAtLeast(1)
            val w = size.width
            val h = size.height
            val stepX = if (trends.size > 1) w / (trends.size - 1) else w

            // Grid lines
            for (i in 0..4) {
                val y = h - (h * i / 4f)
                drawLine(gridColor, Offset(0f, y), Offset(w, y), strokeWidth = 1f)
            }

            // New playgrounds line
            val path = Path()
            trends.forEachIndexed { idx, point ->
                val x = idx * stepX
                val y = h - (h * point.newPlaygrounds / maxVal.toFloat())
                if (idx == 0) path.moveTo(x, y) else path.lineTo(x, y)
            }
            drawPath(path, lineColor, style = Stroke(width = 3f))

            // New users line (secondary)
            val path2 = Path()
            trends.forEachIndexed { idx, point ->
                val x = idx * stepX
                val y = h - (h * point.newUsers / maxVal.toFloat())
                if (idx == 0) path2.moveTo(x, y) else path2.lineTo(x, y)
            }
            drawPath(path2, Color(0xFF8BC34A), style = Stroke(width = 2f))
        }
    }
}

// ─── Row composables ─────────────────────────────────────────────────────────

@Composable
private fun CityGrowthRow(entry: CityGrowthEntry) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(listOfNotNull(entry.city, entry.state).joinToString(", ").ifEmpty { entry.regionKey ?: "-" })
            Text(entry.seedStatus ?: "", color = Color.Gray, fontSize = 11.sp)
        }
        Text("${entry.verifiedPlaygrounds}/${entry.totalPlaygrounds}", fontWeight = FontWeight.SemiBold)
    }
    HorizontalDivider()
}

@Composable
private fun AnalyticsSummaryCard(label: String, value: String) {
    Card(
        shape = RoundedCornerShape(8.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.35f)),
    ) {
        Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) {
            Text(label, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(value, fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.primary)
        }
    }
}

@Composable
private fun AnalyticsMetricRow(
    title: String,
    subtitle: String,
    value: String,
    footnote: String? = null,
    badgeDemo: Boolean = false,
) {
    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.Top,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(title, fontWeight = FontWeight.Medium, style = MaterialTheme.typography.bodyMedium)
                    if (badgeDemo) {
                        Surface(
                            shape = RoundedCornerShape(6.dp),
                            color = MaterialTheme.colorScheme.secondaryContainer,
                        ) {
                            Text(
                                "Demo",
                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSecondaryContainer,
                            )
                        }
                    }
                }
                Text(subtitle, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                footnote?.let {
                    Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.tertiary)
                }
            }
            Text(
                value,
                fontWeight = FontWeight.Medium,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(start = 8.dp),
            )
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.45f))
    }
}

