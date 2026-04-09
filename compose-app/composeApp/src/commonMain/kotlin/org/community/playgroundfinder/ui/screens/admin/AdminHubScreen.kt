package org.community.playgroundfinder.ui.screens.admin

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.Campaign
import androidx.compose.material.icons.filled.Checklist
import androidx.compose.material.icons.filled.Discount
import androidx.compose.material.icons.filled.EmojiEvents
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.Label
import androidx.compose.material.icons.filled.RateReview
import androidx.compose.material.icons.filled.SupportAgent
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material.icons.filled.Wifi
import androidx.compose.material3.Badge
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.community.playgroundfinder.data.PlaygroundService
import org.community.playgroundfinder.ui.composables.FormColors

private data class AdminTile(
    val label: String,
    val icon: ImageVector,
    val description: String,
    val badge: Int? = null,
    val onClick: () -> Unit,
)

private data class AdminSection(
    val title: String,
    val description: String,
    val tiles: List<AdminTile>,
)

@Composable
fun AdminHubScreen(
    service: PlaygroundService,
    onNavigateToModerationQueue: () -> Unit = {},
    onNavigateToSupportQueue: () -> Unit = {},
    onNavigateToSuggestionsQueue: () -> Unit = {},
    onNavigateToSeedReview: () -> Unit = {},
    onNavigateToAnalytics: () -> Unit = {},
    onNavigateToLeaderboard: () -> Unit = {},
    onNavigateToRegionSwitcher: () -> Unit = {},
    onNavigateToAdReviewQueue: () -> Unit = {},
    onNavigateToDiscountHub: () -> Unit = {},
    onNavigateToCampaignManagement: () -> Unit = {},
    onNavigateToRegionMaintenance: () -> Unit = {},
    showDevApiEndpointTile: Boolean = false,
    onNavigateToDevApiEndpoint: () -> Unit = {},
) {
    val scope = rememberCoroutineScope()
    var moderationCount by remember { mutableStateOf<Int?>(null) }
    var supportCount by remember { mutableStateOf<Int?>(null) }
    var suggestionsCount by remember { mutableStateOf<Int?>(null) }
    var adReviewCount by remember { mutableStateOf<Int?>(null) }
    var activeSeeds by remember { mutableStateOf<List<org.community.playgroundfinder.models.SeededRegion>>(emptyList()) }

    var adsOpen by remember { mutableStateOf(true) }
    var regionOpen by remember { mutableStateOf(true) }
    var analyticsOpen by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        scope.launch {
            try {
                val queue = service.getModerationQueue("NEEDS_ADMIN_REVIEW")
                moderationCount = queue.size
            } catch (_: Exception) {}
        }
        scope.launch {
            try {
                val tickets = service.getSupportQueue("NEEDS_ADMIN_REVIEW")
                supportCount = tickets.size
            } catch (_: Exception) {}
        }
        scope.launch {
            try {
                val regions = service.getSeededRegions().data
                activeSeeds = regions.filter { it.seedStatus == "running" || it.seedStatus == "partial" }
            } catch (_: Exception) {}
        }
        scope.launch {
            try {
                adReviewCount = service.getAdReviewQueue().size
            } catch (_: Exception) {}
        }
        // Do not badge "Campaigns" with active campaign totals - that reads like an unread/alert count.
        // Campaign Management lists live campaigns; use Ad Review for queue-style attention.
    }

    val sections = listOf(
        AdminSection(
            title = "Needs attention",
            description = "The queues and reviews that usually need a quick pass first.",
            tiles = listOfNotNull(
                AdminTile(
                    "Moderation Queue",
                    Icons.Filled.RateReview,
                    "User edits, new places, and photo approvals.",
                    moderationCount,
                    onNavigateToModerationQueue,
                ),
                AdminTile(
                    "Ad Review",
                    Icons.Filled.Verified,
                    "Approve or return advertiser submissions.",
                    adReviewCount,
                    onNavigateToAdReviewQueue,
                ),
                AdminTile(
                    "Support Queue",
                    Icons.Filled.SupportAgent,
                    "Customer tickets and follow-up requests.",
                    supportCount,
                    onNavigateToSupportQueue,
                ),
                AdminTile(
                    "Label suggestions",
                    Icons.Filled.Label,
                    "New equipment, amenities, ground types, etc. Approve applies to the place.",
                    suggestionsCount,
                    onNavigateToSuggestionsQueue,
                ),
                AdminTile(
                    "Seed Review",
                    Icons.Filled.Checklist,
                    "Review seeded photos before they go live.",
                    null,
                    onNavigateToSeedReview,
                ),
            ),
        ),
        AdminSection(
            title = "Regions",
            description = "City coverage, seeding status, and the tools used to maintain map quality.",
            tiles = listOf(
                AdminTile(
                    "Region List",
                    Icons.Filled.Language,
                    "See seeded cities, status, and phase information.",
                    null,
                    onNavigateToRegionSwitcher,
                ),
                AdminTile(
                    "Region Maintenance",
                    Icons.Filled.Link,
                    "Cleanup, merge review, and reseed tools.",
                    null,
                    onNavigateToRegionMaintenance,
                ),
            ),
        ),
        AdminSection(
            title = "Advertising",
            description = "Campaign management and advertiser tools.",
            tiles = listOf(
                AdminTile(
                    "Campaigns",
                    Icons.Filled.Campaign,
                    "View, adjust, and refund advertiser campaigns.",
                    null,
                    onNavigateToCampaignManagement,
                ),
                AdminTile(
                    "Discount Hub",
                    Icons.Filled.Discount,
                    "Create and manage discount offers.",
                    null,
                    onNavigateToDiscountHub,
                ),
                AdminTile(
                    "Analytics",
                    Icons.Filled.BarChart,
                    "Check trends, performance, and growth.",
                    null,
                    onNavigateToAnalytics,
                ),
                AdminTile(
                    "Leaderboard",
                    Icons.Filled.EmojiEvents,
                    "See who is contributing, how often, and how well edits are sticking.",
                    null,
                    onNavigateToLeaderboard,
                ),
            ),
        ),
    )

    val expandedFlags = listOf(adsOpen, regionOpen, analyticsOpen)
    val toggleFlags = listOf(
        { adsOpen = !adsOpen },
        { regionOpen = !regionOpen },
        { analyticsOpen = !analyticsOpen },
    )

    val scroll = rememberScrollState()
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(FormColors.ScreenBackground)
            .padding(16.dp),
    ) {
        Text(
            text = "Admin Hub",
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
            color = FormColors.BodyText,
            modifier = Modifier.padding(bottom = 12.dp),
        )

        if (activeSeeds.isNotEmpty()) {
            Surface(
                shape = RoundedCornerShape(12.dp),
                color = FormColors.FilterBannerBackground,
                modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp),
            ) {
                Column(modifier = Modifier.padding(12.dp)) {
                    Text(
                        "\uD83C\uDF31 ${activeSeeds.size} region${if (activeSeeds.size > 1) "s" else ""} seeding",
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 14.sp,
                        color = FormColors.PrimaryButton,
                    )
                    activeSeeds.forEach { region ->
                        val statusEmoji = if (region.seedStatus == "running") "\uD83D\uDD04" else "\u23F3"
                        Text(
                            "$statusEmoji ${region.displayCity.ifBlank { region.city }}, ${region.state} - ${region.seedStatus} (${region.placeCount} places)",
                            fontSize = 12.sp,
                            color = Color(0xFF424242),
                            modifier = Modifier.padding(top = 2.dp),
                        )
                    }
                }
            }
        }

        Column(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .verticalScroll(scroll),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            sections.forEachIndexed { index, section ->
                val open = expandedFlags[index]
                val toggle = toggleFlags[index]
                AdminAccordionSection(
                    title = section.title,
                    description = section.description,
                    expanded = open,
                    onToggle = toggle,
                ) {
                    section.tiles.chunked(2).forEach { rowTiles ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(AdminHubTileHeight),
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            rowTiles.forEach { tile ->
                                AdminNavTile(
                                    tile = tile,
                                    modifier = Modifier
                                        .weight(1f)
                                        .fillMaxSize(),
                                )
                            }
                            if (rowTiles.size == 1) {
                                Spacer(modifier = Modifier.weight(1f))
                            }
                        }
                    }
                }
            }

            if (showDevApiEndpointTile) {
                Surface(
                    shape = RoundedCornerShape(12.dp),
                    color = Color.White,
                    shadowElevation = 1.dp,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable(onClick = onNavigateToDevApiEndpoint)
                            .padding(horizontal = 14.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Surface(
                            color = FormColors.PrimaryButton.copy(alpha = 0.12f),
                            shape = RoundedCornerShape(8.dp),
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(40.dp),
                                contentAlignment = Alignment.Center,
                            ) {
                                Icon(
                                    imageVector = Icons.Filled.Wifi,
                                    contentDescription = "Dev API URL",
                                    tint = FormColors.PrimaryButton,
                                )
                            }
                        }
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = "Developer settings",
                                fontWeight = FontWeight.SemiBold,
                                color = FormColors.BodyText,
                            )
                            Text(
                                text = "Change the debug API endpoint without rebuilding.",
                                fontSize = 12.sp,
                                color = Color(0xFF616161),
                            )
                        }
                    }
                }
            }
        }
    }
}

private val AdminHubTileHeight = 104.dp

@Composable
private fun AdminAccordionSection(
    title: String,
    description: String,
    expanded: Boolean,
    onToggle: () -> Unit,
    content: @Composable () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .border(BorderStroke(1.dp, FormColors.SubtleDivider), RoundedCornerShape(14.dp)),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(FormColors.CardBackground)
                .clickable(onClick = onToggle)
                .padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Column(
                modifier = Modifier.weight(1f).padding(end = 8.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Text(
                    title,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 16.sp,
                    color = FormColors.BodyText,
                )
                Text(
                    text = description,
                    fontSize = 12.sp,
                    lineHeight = 16.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Icon(
                imageVector = if (expanded) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore,
                contentDescription = if (expanded) "Collapse" else "Expand",
                tint = FormColors.PrimaryButton,
            )
        }
        AnimatedVisibility(
            visible = expanded,
            enter = fadeIn() + expandVertically(),
            exit = fadeOut() + shrinkVertically(),
        ) {
            Surface(
                modifier = Modifier.fillMaxWidth(),
                color = FormColors.CardBackground,
                shadowElevation = 0.dp,
            ) {
                Column(
                    modifier = Modifier.padding(12.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    content()
                }
            }
        }
    }
}

@Composable
private fun AdminNavTile(tile: AdminTile, modifier: Modifier = Modifier) {
    Card(
        onClick = tile.onClick,
        modifier = modifier,
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(
            containerColor = Color.White,
            contentColor = FormColors.BodyText,
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        border = BorderStroke(1.dp, FormColors.SubtleDivider),
    ) {
        Box(modifier = Modifier.fillMaxSize().padding(12.dp)) {
            Column(
                modifier = Modifier
                    .align(Alignment.CenterStart)
                    .fillMaxWidth(),
                horizontalAlignment = Alignment.Start,
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Surface(
                        color = FormColors.PrimaryButton.copy(alpha = 0.12f),
                        shape = RoundedCornerShape(8.dp),
                    ) {
                        Box(
                            modifier = Modifier.size(36.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(
                                imageVector = tile.icon,
                                contentDescription = tile.label,
                                modifier = Modifier.size(20.dp),
                                tint = FormColors.PrimaryButton,
                            )
                        }
                    }
                    Text(
                        text = tile.label,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = FormColors.BodyText,
                        maxLines = 2,
                        lineHeight = 16.sp,
                    )
                }
                Text(
                    text = tile.description,
                    fontSize = 11.sp,
                    lineHeight = 15.sp,
                    color = Color(0xFF616161),
                    maxLines = 3,
                    modifier = Modifier.heightIn(min = 42.dp),
                )
            }
            if (tile.badge != null && tile.badge > 0) {
                Badge(
                    modifier = Modifier.align(Alignment.TopEnd),
                    containerColor = MaterialTheme.colorScheme.error,
                ) {
                    Text(
                        text = if (tile.badge > 99) "99+" else tile.badge.toString(),
                        color = Color.White,
                        fontSize = 11.sp,
                    )
                }
            }
        }
    }
}

