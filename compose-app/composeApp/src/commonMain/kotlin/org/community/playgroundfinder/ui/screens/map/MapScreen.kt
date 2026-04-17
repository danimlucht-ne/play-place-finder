package org.community.playgroundfinder.ui.screens.map

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.FilterList
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
import org.community.playgroundfinder.data.Playground
import org.community.playgroundfinder.data.PlaygroundService
import org.community.playgroundfinder.ui.composables.FilterSummaryBanner
import org.community.playgroundfinder.ui.composables.FormColors
import org.community.playgroundfinder.util.rememberLocationService

@Composable
fun MapScreen(
    service: PlaygroundService,
    initialPlaces: List<Playground> = emptyList(),
    useInitialAsAuthoritative: Boolean = false,
    filterSummary: String? = null,
    filteredPlaygrounds: List<Playground>? = null,
    userLat: Double? = null,
    userLng: Double? = null,
    onPlaygroundClick: (Playground) -> Unit,
    /** Long-press map → pin location → add playground without GPS or street address. */
    onAddPlaygroundAt: ((Double, Double) -> Unit)? = null,
    /** When set, shows a control to return to Home and open the filter sheet. */
    onOpenFilters: (() -> Unit)? = null,
    /** Opens promoted listing / event URLs (map pins). */
    onPromotedMapPinUrl: (String) -> Unit = {},
) {
    var playgrounds by remember { mutableStateOf(initialPlaces) }
    var isLoading by remember { mutableStateOf(true) }
    var resolvedLat by remember { mutableStateOf(userLat) }
    var resolvedLng by remember { mutableStateOf(userLng) }
    val scope = rememberCoroutineScope()
    val getLocation = rememberLocationService()

    LaunchedEffect(filteredPlaygrounds, initialPlaces, useInitialAsAuthoritative) {
        scope.launch {
            val locJob = launch {
                if (resolvedLat == null || resolvedLng == null) {
                    val loc = getLocation()
                    if (loc != null) {
                        resolvedLat = loc.latitude
                        resolvedLng = loc.longitude
                    }
                }
            }
            val dataJob = launch {
                when {
                    filteredPlaygrounds != null -> {
                        playgrounds = filteredPlaygrounds
                        val regionKey = filteredPlaygrounds
                            .asSequence()
                            .mapNotNull { it.regionKey?.trim()?.takeIf { k -> k.isNotEmpty() } }
                            .firstOrNull()
                        if (regionKey != null) {
                            launch {
                                try {
                                    val regionAll = mutableListOf<Playground>()
                                    var skip = 0
                                    val pageSize = 200
                                    var guard = 0
                                    while (guard++ < 60) {
                                        val resp = service.getPlaygroundsByRegion(
                                            regionKey = regionKey,
                                            limit = pageSize,
                                            skip = skip,
                                        )
                                        if (resp.data.isEmpty()) break
                                        regionAll.addAll(resp.data)
                                        if (resp.data.size < pageSize) break
                                        skip += pageSize
                                    }
                                    if (regionAll.isNotEmpty()) {
                                        playgrounds = mergePlaygroundsForFilteredMap(
                                            searchRows = filteredPlaygrounds,
                                            regionRows = regionAll,
                                        )
                                    }
                                } catch (_: Exception) {
                                }
                            }
                        }
                    }
                    useInitialAsAuthoritative -> {
                        playgrounds = initialPlaces
                    }
                    else -> {
                        try {
                            val allPages = mutableListOf<Playground>()
                            var cursor: String? = null
                            do {
                                val resp = service.getAllPlaygrounds(cursor = cursor, limit = 200)
                                allPages.addAll(resp.data)
                                cursor = resp.nextCursor
                            } while (cursor != null)
                            if (allPages.isNotEmpty()) playgrounds = allPages
                        } catch (_: Exception) {}
                    }
                }
            }
            locJob.join()
            dataJob.join()
            isLoading = false
        }
    }

    val mapUserLat = resolvedLat ?: userLat
    val mapUserLng = resolvedLng ?: userLng

    var draftPin by remember { mutableStateOf<Pair<Double, Double>?>(null) }

    val mapRegionKey = remember(playgrounds) {
        playgrounds.firstOrNull { !it.regionKey.isNullOrBlank() }?.regionKey
    }
    var sponsorPins by remember { mutableStateOf<List<MapSponsorPin>>(emptyList()) }
    LaunchedEffect(mapRegionKey, playgrounds.size) {
        if (mapRegionKey.isNullOrBlank()) {
            sponsorPins = emptyList()
            return@LaunchedEffect
        }
        sponsorPins = try {
            val r = service.getAllAds(mapRegionKey, "inline_listing")
            if (r.type != "paid") {
                emptyList()
            } else {
                r.ads.mapNotNull { ad ->
                    val lat = ad.businessLat.takeIf { it != 0.0 } ?: return@mapNotNull null
                    val lng = ad.businessLng.takeIf { it != 0.0 } ?: return@mapNotNull null
                    val title = ad.eventName?.takeIf { it.isNotBlank() }
                        ?: ad.businessName.ifBlank { ad.headline }.ifBlank { "Promoted" }
                    val snippet = if (ad.isEvent) "Event · tap for details" else "Sponsored · tap for details"
                    val url = ad.ctaUrl.trim().takeIf { it.isNotEmpty() } ?: return@mapNotNull null
                    MapSponsorPin(
                        id = ad.id,
                        campaignId = ad.campaignId ?: "",
                        title = title,
                        snippet = snippet,
                        latitude = lat,
                        longitude = lng,
                        targetUrl = url,
                        isEvent = ad.isEvent,
                    )
                }
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    val sponsorPinIdsKey = remember(sponsorPins) {
        sponsorPins.map { it.id }.sorted().joinToString()
    }
    // One impression per pin when the set loads. Same placement as [getAllAds] / pin taps so
    // [adTargeting] matches; a distinct "map_pin" placement would need duplicate targeting docs server-side.
    LaunchedEffect(mapRegionKey, sponsorPinIdsKey) {
        if (mapRegionKey.isNullOrBlank() || sponsorPins.isEmpty()) return@LaunchedEffect
        for (pin in sponsorPins) {
            try {
                service.trackAdEvent(
                    type = "impression",
                    adId = pin.id,
                    campaignId = pin.campaignId,
                    cityId = mapRegionKey,
                    placement = "inline_listing",
                )
            } catch (_: Exception) {}
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        if (isLoading) {
            CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
        } else {
            MapContent(
                playgrounds = playgrounds,
                userLat = mapUserLat,
                userLng = mapUserLng,
                onPlaygroundClick = onPlaygroundClick,
                draftPinLat = draftPin?.first,
                draftPinLng = draftPin?.second,
                onMapLongClick = if (onAddPlaygroundAt != null) { lat, lng ->
                    draftPin = lat to lng
                } else null,
                sponsorPins = sponsorPins,
                onSponsorPinClick = { pin ->
                    scope.launch {
                        if (!mapRegionKey.isNullOrBlank()) {
                            try {
                                service.trackAdEvent(
                                    type = "click",
                                    adId = pin.id,
                                    campaignId = pin.campaignId,
                                    cityId = mapRegionKey,
                                    placement = "inline_listing",
                                )
                            } catch (_: Exception) {}
                        }
                        onPromotedMapPinUrl(pin.targetUrl)
                    }
                },
            )
            if (!filterSummary.isNullOrBlank()) {
                FilterSummaryBanner(
                    summary = filterSummary,
                    forMapOverlay = true,
                    modifier = Modifier.align(Alignment.TopStart).padding(horizontal = 8.dp, vertical = 8.dp),
                )
            }
            if (onOpenFilters != null) {
                FloatingActionButton(
                    onClick = onOpenFilters,
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(horizontal = 8.dp, vertical = 8.dp),
                    containerColor = FormColors.PrimaryButton,
                    contentColor = Color.White,
                ) {
                    Icon(Icons.Filled.FilterList, contentDescription = "Filters")
                }
            }
            MapLegend(
                modifier = Modifier.align(Alignment.BottomStart).padding(8.dp),
                showAddByPinHint = onAddPlaygroundAt != null,
                showPromotedPinHint = sponsorPins.isNotEmpty(),
            )
            if (draftPin != null && onAddPlaygroundAt != null) {
                val (dlat, dlng) = draftPin!!
                Surface(
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(horizontal = 12.dp, vertical = 20.dp)
                        .fillMaxWidth(),
                    shape = RoundedCornerShape(16.dp),
                    color = Color.White.copy(alpha = 0.96f),
                    shadowElevation = 6.dp,
                ) {
                    Column(Modifier.padding(14.dp)) {
                        Text(
                            "Add a playground here?",
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 15.sp,
                            color = Color(0xFF212121),
                        )
                        Text(
                            "Long-press placed a pin. You can name it and fill details even without a street address.",
                            fontSize = 12.sp,
                            color = Color(0xFF616161),
                            modifier = Modifier.padding(top = 4.dp),
                        )
                        Text(
                            "${"%.5f".format(dlat)}, ${"%.5f".format(dlng)}",
                            fontSize = 11.sp,
                            color = Color(0xFF9E9E9E),
                            modifier = Modifier.padding(top = 2.dp),
                        )
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
                        ) {
                            TextButton(onClick = { draftPin = null }) {
                                Text("Clear pin")
                            }
                            Button(
                                onClick = {
                                    onAddPlaygroundAt(dlat, dlng)
                                    draftPin = null
                                },
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = FormColors.PrimaryButton,
                                    contentColor = FormColors.PrimaryButtonText,
                                ),
                            ) {
                                Text("Continue")
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * Union of region pins and home search rows. [searchRows] overwrite [regionRows] on the same stable key
 * so favorited / search-enriched fields from Home are preserved.
 */
private fun mergePlaygroundsForFilteredMap(
    searchRows: List<Playground>,
    regionRows: List<Playground>,
): List<Playground> {
    fun keyOf(p: Playground): String {
        val id = p.id?.trim()?.takeIf { it.isNotEmpty() }
        if (id != null) return "id:$id"
        return "loc:${p.latitude},${p.longitude},${p.name}"
    }
    val byKey = LinkedHashMap<String, Playground>()
    for (p in regionRows) byKey[keyOf(p)] = p
    for (p in searchRows) byKey[keyOf(p)] = p
    return byKey.values.toList()
}

@Composable
expect fun MapContent(
    playgrounds: List<Playground>,
    userLat: Double?,
    userLng: Double?,
    onPlaygroundClick: (Playground) -> Unit,
    draftPinLat: Double? = null,
    draftPinLng: Double? = null,
    onMapLongClick: ((Double, Double) -> Unit)? = null,
    sponsorPins: List<MapSponsorPin> = emptyList(),
    onSponsorPinClick: (MapSponsorPin) -> Unit = {},
)


private data class LegendItem(val label: String, val color: Color)

private val legendItems = listOf(
    LegendItem("Public / Park", Color(0xFF4CAF50)),
    LegendItem("School", Color(0xFFFFC107)),
    LegendItem("Library", Color(0xFF00CED1)),
    LegendItem("Indoor / Amusement", Color(0xFFFF9800)),
    LegendItem("Splash Pad", Color(0xFF00BCD4)),
    LegendItem("Trail / Nature", Color(0xFFE91E63)),
    LegendItem("Museum / Zoo", Color(0xFFE91E63)),
    LegendItem("Private", Color(0xFF9C27B0)),
    LegendItem("Neighborhood", Color(0xFF8BC34A)),
)

@Composable
private fun MapLegend(
    modifier: Modifier = Modifier,
    showAddByPinHint: Boolean = false,
    showPromotedPinHint: Boolean = false,
) {
    var expanded by remember { mutableStateOf(false) }

    Surface(
        modifier = modifier.clickable { expanded = !expanded },
        shape = RoundedCornerShape(12.dp),
        color = Color.White.copy(alpha = 0.92f),
        shadowElevation = 4.dp,
    ) {
        Column(modifier = Modifier.padding(10.dp)) {
            Text(
                if (expanded) "Map Legend" else "Legend \u25B6",
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
                color = Color(0xFF424242),
            )
            if (expanded) {
                Spacer(Modifier.height(6.dp))
                if (showAddByPinHint) {
                    Text(
                        "Tip: long-press the map to pin a new place you see from satellite (no address needed).",
                        fontSize = 10.sp,
                        color = Color(0xFF1565C0),
                        modifier = Modifier.padding(bottom = 6.dp),
                    )
                }
                if (showPromotedPinHint) {
                    Text(
                        "Star / rose pins: sponsored listings or events (tap to open their link).",
                        fontSize = 10.sp,
                        color = Color(0xFF6A1B9A),
                        modifier = Modifier.padding(bottom = 6.dp),
                    )
                }
                legendItems.forEach { item ->
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.padding(vertical = 2.dp),
                    ) {
                        Box(
                            modifier = Modifier
                                .size(10.dp)
                                .clip(CircleShape)
                                .background(item.color)
                        )
                        Spacer(Modifier.width(6.dp))
                        Text(item.label, fontSize = 11.sp, color = Color(0xFF616161))
                    }
                }
            }
        }
    }
}
