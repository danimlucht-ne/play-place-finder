package org.community.playgroundfinder.ui.screens.events

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons as MaterialIcons
import androidx.compose.material.icons.filled.Event
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.community.playgroundfinder.data.PlaygroundService
import org.community.playgroundfinder.events.EventsCalendarSort
import org.community.playgroundfinder.events.applyEventsCalendarSort
import org.community.playgroundfinder.events.eventCreativeDedupeKey
import org.community.playgroundfinder.events.eventCreativeDisplayTitle
import org.community.playgroundfinder.events.paidEventCreativesSortedForCalendar
import org.community.playgroundfinder.models.AdCreativePayload
import org.community.playgroundfinder.models.AllAdsResponse
import org.community.playgroundfinder.ui.composables.FormColors
import org.community.playgroundfinder.ui.composables.SponsoredListingCard
import org.community.playgroundfinder.ui.composables.formatEventDateDisplay
import org.community.playgroundfinder.util.MarketingLinks
import org.community.playgroundfinder.util.rememberOpenExternalUrl

/**
 * **Product shape (#9):** a dedicated “events nearby” surface — date chips + list of paid [event spotlight]
 * listings (same backend as inline carousel). One-time / flat event packages already exist; this screen
 * is the family-facing calendar view advertisers are buying into.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NearbyEventsCalendarScreen(
    playgroundService: PlaygroundService,
    regionKey: String,
    regionLabel: String,
    userLat: Double?,
    userLng: Double?,
    onAdClick: (String) -> Unit,
    onAdvertise: () -> Unit,
    /** When Home already fetched [getAllAds] for this region, pass it to avoid a duplicate request on open. */
    preloadedInlineListingAds: AllAdsResponse? = null,
) {
    val scope = rememberCoroutineScope()
    val openExternalUrl = rememberOpenExternalUrl()
    var rawEvents by remember { mutableStateOf<List<AdCreativePayload>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var selectedDate by remember { mutableStateOf<String?>(null) }
    var sortMode by remember { mutableStateOf(EventsCalendarSort.ByDate) }

    val events = remember(rawEvents, sortMode, userLat, userLng) {
        applyEventsCalendarSort(rawEvents, sortMode, userLat, userLng)
    }

    fun load() {
        if (regionKey.isBlank()) {
            rawEvents = emptyList()
            isLoading = false
            error = "Set your location on Home to see events in your area."
            return
        }
        scope.launch {
            isLoading = true
            error = null
            try {
                val resp = playgroundService.getAllAds(regionKey, "inline_listing")
                rawEvents = paidEventCreativesSortedForCalendar(resp)
            } catch (e: Exception) {
                error = e.message ?: "Could not load events"
                rawEvents = emptyList()
            }
            isLoading = false
        }
    }

    LaunchedEffect(regionKey, preloadedInlineListingAds) {
        when {
            regionKey.isBlank() -> {
                rawEvents = emptyList()
                isLoading = false
                error = "Set your location on Home to see events in your area."
            }
            preloadedInlineListingAds != null -> {
                rawEvents = paidEventCreativesSortedForCalendar(preloadedInlineListingAds)
                isLoading = false
                error = null
            }
            else -> {
                isLoading = true
                error = null
                try {
                    val resp = playgroundService.getAllAds(regionKey, "inline_listing")
                    rawEvents = paidEventCreativesSortedForCalendar(resp)
                } catch (e: Exception) {
                    error = e.message ?: "Could not load events"
                    rawEvents = emptyList()
                }
                isLoading = false
            }
        }
    }

    val dateKeys = remember(rawEvents) {
        rawEvents.map { it.eventDate.orEmpty().trim() }.filter { it.isNotEmpty() }.distinct().sorted()
    }
    val visible = remember(events, selectedDate) {
        if (selectedDate == null) events
        else events.filter { it.eventDate.orEmpty().trim() == selectedDate }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 16.dp, vertical = 12.dp),
    ) {
            Text(
                regionLabel,
                fontSize = 14.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                "Sponsored happenings (Event Spotlight on Select Package — same listing appears here and on Home). Tap a card for details.",
                fontSize = 12.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 4.dp, bottom = 12.dp),
            )

            when {
                isLoading -> Box(Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
                error != null -> Column(Modifier.fillMaxWidth().weight(1f), verticalArrangement = Arrangement.Center) {
                    Text(error!!, color = MaterialTheme.colorScheme.error)
                    Spacer(Modifier.height(12.dp))
                    TextButton(onClick = { load() }) { Text("Retry") }
                }
                rawEvents.isEmpty() -> Column(
                    Modifier.fillMaxWidth().weight(1f),
                    verticalArrangement = Arrangement.Center,
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Icon(MaterialIcons.Filled.Event, null, modifier = Modifier.size(48.dp), tint = FormColors.PrimaryButton)
                    Spacer(Modifier.height(8.dp))
                    Text("No sponsored events in this area yet.", fontWeight = FontWeight.Medium)
                    Text(
                        "Businesses can list a dated event (workshops, grand openings, seasonal fun) for a one-time fee.",
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 8.dp),
                    )
                    Spacer(Modifier.height(16.dp))
                    Button(
                        onClick = onAdvertise,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = FormColors.PrimaryButton,
                            contentColor = FormColors.PrimaryButtonText,
                        ),
                    ) {
                        Text("Advertise an event")
                    }
                    Spacer(Modifier.height(8.dp))
                    TextButton(onClick = { openExternalUrl(MarketingLinks.advertiserLanding()) }) {
                        Text("Event packages (website)", color = FormColors.PrimaryButton)
                    }
                }
                else -> {
                    Text("Sort by", fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                    Spacer(Modifier.height(6.dp))
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        item {
                            FilterChip(
                                selected = sortMode == EventsCalendarSort.ByDate,
                                onClick = { sortMode = EventsCalendarSort.ByDate },
                                label = { Text("Date") },
                            )
                        }
                        item {
                            FilterChip(
                                selected = sortMode == EventsCalendarSort.ByDistance,
                                onClick = { sortMode = EventsCalendarSort.ByDistance },
                                label = { Text("Distance") },
                            )
                        }
                        item {
                            FilterChip(
                                selected = sortMode == EventsCalendarSort.ByBusinessName,
                                onClick = { sortMode = EventsCalendarSort.ByBusinessName },
                                label = { Text("Business") },
                            )
                        }
                    }
                    if (sortMode == EventsCalendarSort.ByDistance && (userLat == null || userLng == null)) {
                        Text(
                            "Turn on location to sort by distance; list is in date order until then.",
                            fontSize = 11.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(top = 6.dp),
                        )
                    }
                    if (dateKeys.isNotEmpty()) {
                        Spacer(Modifier.height(10.dp))
                        Text("Filter by date", fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                        Spacer(Modifier.height(6.dp))
                        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            item {
                                FilterChip(
                                    selected = selectedDate == null,
                                    onClick = { selectedDate = null },
                                    label = { Text("All") },
                                )
                            }
                            items(dateKeys) { d ->
                                val chipLabel = formatEventDateDisplay(d, isRecurring = false)
                                    ?: d.trim().take(10)
                                FilterChip(
                                    selected = selectedDate == d,
                                    onClick = { selectedDate = if (selectedDate == d) null else d },
                                    label = { Text(chipLabel) },
                                )
                            }
                        }
                        Spacer(Modifier.height(12.dp))
                    } else {
                        Spacer(Modifier.height(12.dp))
                    }
                    LazyColumn(
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                        contentPadding = PaddingValues(bottom = 24.dp),
                        modifier = Modifier.weight(1f),
                    ) {
                        items(visible, key = { eventCreativeDedupeKey(it) }) { ad ->
                            val title = eventCreativeDisplayTitle(ad)
                            SponsoredListingCard(
                                businessName = title,
                                category = ad.businessCategory.takeIf { it.isNotBlank() },
                                description = ad.body.takeIf { it.isNotBlank() },
                                websiteUrl = ad.ctaUrl.takeIf { it.isNotBlank() },
                                imageUrl = ad.imageUrl?.takeIf { it.isNotBlank() },
                                onLearnMore = { url ->
                                    scope.launch {
                                        try {
                                            playgroundService.trackAdEvent(
                                                type = "click",
                                                adId = ad.id,
                                                campaignId = ad.campaignId ?: "",
                                                cityId = regionKey,
                                                placement = "inline_listing",
                                            )
                                        } catch (_: Exception) {}
                                        onAdClick(url)
                                    }
                                },
                                isEvent = true,
                                eventDate = ad.eventDate,
                                isRecurring = ad.isRecurring,
                                userLat = userLat,
                                userLng = userLng,
                                businessLat = ad.businessLat.takeIf { it != 0.0 },
                                businessLng = ad.businessLng.takeIf { it != 0.0 },
                                showDistance = ad.showDistance,
                                matchCarouselMinHeight = false,
                                showCategory = false,
                                imageContentScale = ContentScale.Fit,
                            )
                        }
                    }
                }
            }
    }

    LaunchedEffect(visible.map { it.id }.joinToString(), regionKey) {
        if (regionKey.isBlank()) return@LaunchedEffect
        for (ad in visible) {
            try {
                playgroundService.trackAdEvent(
                    type = "impression",
                    adId = ad.id,
                    campaignId = ad.campaignId ?: "",
                    cityId = regionKey,
                    placement = "inline_listing",
                )
            } catch (_: Exception) {}
        }
    }
}
