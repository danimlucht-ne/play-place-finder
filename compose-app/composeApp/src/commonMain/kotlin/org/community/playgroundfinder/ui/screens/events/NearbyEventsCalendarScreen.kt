package org.community.playgroundfinder.ui.screens.events

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons as MaterialIcons
import androidx.compose.material.icons.filled.Event
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import kotlinx.datetime.Instant
import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone
import kotlinx.datetime.atStartOfDayIn
import kotlinx.datetime.toLocalDateTime
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
import org.community.playgroundfinder.util.rememberSettings

private const val SAVED_EVENT_IDS_KEY = "saved_event_ids"

private fun parseCsvSet(raw: String): Set<String> =
    raw.split(",").map { it.trim() }.filter { it.isNotBlank() }.toSet()

private fun toCsv(values: Set<String>): String = values.sorted().joinToString(",")

private fun localDateToDatePickerUtcMillis(d: LocalDate): Long =
    d.atStartOfDayIn(TimeZone.UTC).toEpochMilliseconds()

private fun datePickerUtcMillisToLocalDate(ms: Long): LocalDate {
    val utc = Instant.fromEpochMilliseconds(ms).toLocalDateTime(TimeZone.UTC)
    return LocalDate(utc.year, utc.monthNumber, utc.dayOfMonth)
}

private fun encodeUrlComponent(raw: String): String {
    val bytes = raw.encodeToByteArray()
    val out = StringBuilder()
    for (b in bytes) {
        val ch = b.toInt().toChar()
        val safe = (ch in 'a'..'z') || (ch in 'A'..'Z') || (ch in '0'..'9') || ch == '-' || ch == '_' || ch == '.' || ch == '~'
        if (safe) {
            out.append(ch)
        } else {
            val v = b.toInt() and 0xFF
            out.append('%')
            out.append("0123456789ABCDEF"[v ushr 4])
            out.append("0123456789ABCDEF"[v and 0x0F])
        }
    }
    return out.toString()
}

private fun eventGoogleCalendarUrl(ad: AdCreativePayload): String? {
    val date = ad.eventDate?.trim()?.takeIf { it.length >= 10 }?.take(10) ?: return null
    val title = eventCreativeDisplayTitle(ad).ifBlank { "Event" }
    val details = ad.body.trim().ifBlank { title }
    val location = ad.eventLocation?.trim()?.takeIf { it.isNotBlank() } ?: ad.businessName.trim()
    val start = date.replace("-", "")
    // all-day single-date events in Google Calendar format (inclusive start, exclusive end)
    val end = date.replace("-", "")
    return "https://calendar.google.com/calendar/render?action=TEMPLATE" +
        "&text=${encodeUrlComponent(title)}" +
        "&details=${encodeUrlComponent(details)}" +
        "&location=${encodeUrlComponent(location)}" +
        "&dates=${start}/${end}"
}

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
    val settings = rememberSettings()
    var rawEvents by remember { mutableStateOf<List<AdCreativePayload>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var selectedDate by remember { mutableStateOf<String?>(null) }
    var sortMode by remember { mutableStateOf(EventsCalendarSort.ByDate) }
    var showDatePicker by remember { mutableStateOf(false) }
    var showSavedOnly by remember { mutableStateOf(false) }
    var savedEventIds by remember {
        mutableStateOf(parseCsvSet(settings.getString(SAVED_EVENT_IDS_KEY, "")))
    }

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
    val savedVisible = remember(visible, savedEventIds) { visible.filter { savedEventIds.contains(it.id) } }
    val listVisible = if (showSavedOnly) savedVisible else visible

    val pickerInitialDate = runCatching { LocalDate.parse((selectedDate ?: dateKeys.firstOrNull() ?: "2026-01-01").take(10)) }
        .getOrDefault(LocalDate(2026, 1, 1))
    if (showDatePicker) {
        val pickerState = rememberDatePickerState(initialSelectedDateMillis = localDateToDatePickerUtcMillis(pickerInitialDate))
        DatePickerDialog(
            onDismissRequest = { showDatePicker = false },
            confirmButton = {
                TextButton(onClick = {
                    val ms = pickerState.selectedDateMillis
                    if (ms != null) {
                        selectedDate = datePickerUtcMillisToLocalDate(ms).toString()
                    }
                    showDatePicker = false
                }) { Text("Apply") }
            },
            dismissButton = { TextButton(onClick = { showDatePicker = false }) { Text("Cancel") } },
        ) {
            DatePicker(state = pickerState)
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFFF4FAFB))
            .padding(horizontal = 16.dp, vertical = 12.dp),
    ) {
            Surface(
                shape = RoundedCornerShape(12.dp),
                color = Color.White,
                tonalElevation = 1.dp,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(regionLabel, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Color(0xFF006064))
                    Text(
                        "Discover upcoming local events. Use date filters, save events, or add them to your calendar.",
                        fontSize = 12.sp,
                        color = Color(0xFF546E7A),
                    )
                }
            }
            Spacer(Modifier.height(10.dp))

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
                    Text("Sort by", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Color(0xFF006064))
                    Spacer(Modifier.height(6.dp))
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        item {
                            FilterChip(
                                selected = sortMode == EventsCalendarSort.ByDate,
                                onClick = { sortMode = EventsCalendarSort.ByDate },
                                label = { Text("Date") },
                                colors = FilterChipDefaults.filterChipColors(
                                    selectedContainerColor = Color(0xFFE0F7FA),
                                    selectedLabelColor = Color(0xFF006064),
                                ),
                            )
                        }
                        item {
                            FilterChip(
                                selected = sortMode == EventsCalendarSort.ByDistance,
                                onClick = { sortMode = EventsCalendarSort.ByDistance },
                                label = { Text("Distance") },
                                colors = FilterChipDefaults.filterChipColors(
                                    selectedContainerColor = Color(0xFFE0F7FA),
                                    selectedLabelColor = Color(0xFF006064),
                                ),
                            )
                        }
                        item {
                            FilterChip(
                                selected = sortMode == EventsCalendarSort.ByBusinessName,
                                onClick = { sortMode = EventsCalendarSort.ByBusinessName },
                                label = { Text("Business") },
                                colors = FilterChipDefaults.filterChipColors(
                                    selectedContainerColor = Color(0xFFE0F7FA),
                                    selectedLabelColor = Color(0xFF006064),
                                ),
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
                        Text("Filter by date", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Color(0xFF006064))
                        Spacer(Modifier.height(6.dp))
                        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            item {
                                FilterChip(
                                    selected = selectedDate == null,
                                    onClick = { selectedDate = null },
                                    label = { Text("All") },
                                    colors = FilterChipDefaults.filterChipColors(
                                        selectedContainerColor = Color(0xFFE0F7FA),
                                        selectedLabelColor = Color(0xFF006064),
                                    ),
                                )
                            }
                            item {
                                FilterChip(
                                    selected = selectedDate != null,
                                    onClick = { showDatePicker = true },
                                    label = {
                                        Text(
                                            selectedDate?.let { formatEventDateDisplay(it, false) ?: it.take(10) } ?: "Pick date",
                                        )
                                    },
                                    colors = FilterChipDefaults.filterChipColors(
                                        selectedContainerColor = Color(0xFFB2EBF2),
                                        selectedLabelColor = Color(0xFF004D40),
                                    ),
                                )
                            }
                            items(dateKeys) { d ->
                                val chipLabel = formatEventDateDisplay(d, isRecurring = false)
                                    ?: d.trim().take(10)
                                FilterChip(
                                    selected = selectedDate == d,
                                    onClick = { selectedDate = if (selectedDate == d) null else d },
                                    label = { Text(chipLabel) },
                                    colors = FilterChipDefaults.filterChipColors(
                                        selectedContainerColor = Color(0xFFE0F7FA),
                                        selectedLabelColor = Color(0xFF006064),
                                    ),
                                )
                            }
                        }
                        Spacer(Modifier.height(12.dp))
                    } else {
                        Spacer(Modifier.height(12.dp))
                    }
                    Text("Saved events", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Color(0xFF006064))
                    Spacer(Modifier.height(6.dp))
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        item {
                            FilterChip(
                                selected = !showSavedOnly,
                                onClick = { showSavedOnly = false },
                                label = { Text("All events") },
                                colors = FilterChipDefaults.filterChipColors(
                                    selectedContainerColor = Color(0xFFE0F7FA),
                                    selectedLabelColor = Color(0xFF006064),
                                ),
                            )
                        }
                        item {
                            FilterChip(
                                selected = showSavedOnly,
                                onClick = { showSavedOnly = true },
                                label = { Text("Saved only (${savedVisible.size})") },
                                leadingIcon = {
                                    Icon(
                                        imageVector = if (savedVisible.isEmpty()) MaterialIcons.Filled.FavoriteBorder else MaterialIcons.Filled.Favorite,
                                        contentDescription = null,
                                        modifier = Modifier.size(16.dp),
                                    )
                                },
                                colors = FilterChipDefaults.filterChipColors(
                                    selectedContainerColor = Color(0xFFE0F7FA),
                                    selectedLabelColor = Color(0xFF006064),
                                ),
                            )
                        }
                    }
                    if (!showSavedOnly && savedVisible.isNotEmpty()) {
                        Spacer(Modifier.height(8.dp))
                        Text(
                            "Saved events appear first so you can find them quickly.",
                            fontSize = 11.sp,
                            color = Color(0xFF546E7A),
                        )
                    }
                    Spacer(Modifier.height(10.dp))
                    LazyColumn(
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                        contentPadding = PaddingValues(bottom = 24.dp),
                        modifier = Modifier.weight(1f),
                    ) {
                        if (!showSavedOnly) {
                            items(savedVisible, key = { "saved-${eventCreativeDedupeKey(it)}" }) { ad ->
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
                                    eventTime = ad.eventTime,
                                    eventLocation = ad.eventLocation ?: ad.businessName,
                                    isRecurring = ad.isRecurring,
                                    userLat = userLat,
                                    userLng = userLng,
                                    businessLat = ad.businessLat.takeIf { it != 0.0 },
                                    businessLng = ad.businessLng.takeIf { it != 0.0 },
                                    showDistance = ad.showDistance,
                                    matchCarouselMinHeight = false,
                                    showCategory = false,
                                    imageContentScale = ContentScale.Crop,
                                    imageAlignment = ad.imageAlignment,
                                )
                                Spacer(Modifier.height(6.dp))
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    OutlinedButton(
                                        onClick = {
                                            eventGoogleCalendarUrl(ad)?.let(openExternalUrl)
                                        },
                                        enabled = eventGoogleCalendarUrl(ad) != null,
                                        modifier = Modifier.weight(1f),
                                        shape = RoundedCornerShape(10.dp),
                                        border = ButtonDefaults.outlinedButtonBorder.copy(width = 1.dp),
                                        colors = ButtonDefaults.outlinedButtonColors(contentColor = FormColors.PrimaryButton),
                                    ) {
                                        Text("Add to calendar", fontSize = 12.sp)
                                    }
                                    FilledTonalButton(
                                        onClick = {
                                            savedEventIds = savedEventIds - ad.id
                                            settings.putString(SAVED_EVENT_IDS_KEY, toCsv(savedEventIds))
                                        },
                                        modifier = Modifier.weight(1f),
                                        shape = RoundedCornerShape(10.dp),
                                        colors = ButtonDefaults.filledTonalButtonColors(
                                            containerColor = Color(0xFFE0F7FA),
                                            contentColor = Color(0xFF006064),
                                        ),
                                    ) {
                                        Icon(
                                            imageVector = MaterialIcons.Filled.Favorite,
                                            contentDescription = null,
                                            modifier = Modifier.size(16.dp),
                                        )
                                        Spacer(Modifier.width(6.dp))
                                        Text("Saved", fontSize = 12.sp)
                                    }
                                }
                            }
                        }
                        items(listVisible.filter { if (showSavedOnly) true else !savedEventIds.contains(it.id) }, key = { eventCreativeDedupeKey(it) }) { ad ->
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
                                eventTime = ad.eventTime,
                                eventLocation = ad.eventLocation ?: ad.businessName,
                                isRecurring = ad.isRecurring,
                                userLat = userLat,
                                userLng = userLng,
                                businessLat = ad.businessLat.takeIf { it != 0.0 },
                                businessLng = ad.businessLng.takeIf { it != 0.0 },
                                showDistance = ad.showDistance,
                                matchCarouselMinHeight = false,
                                showCategory = false,
                                imageContentScale = ContentScale.Crop,
                                imageAlignment = ad.imageAlignment,
                            )
                            Spacer(Modifier.height(6.dp))
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                OutlinedButton(
                                    onClick = {
                                        eventGoogleCalendarUrl(ad)?.let(openExternalUrl)
                                    },
                                    enabled = eventGoogleCalendarUrl(ad) != null,
                                    modifier = Modifier.weight(1f),
                                    shape = RoundedCornerShape(10.dp),
                                    border = ButtonDefaults.outlinedButtonBorder.copy(width = 1.dp),
                                    colors = ButtonDefaults.outlinedButtonColors(contentColor = FormColors.PrimaryButton),
                                ) {
                                    Text("Add to calendar", fontSize = 12.sp)
                                }
                                FilledTonalButton(
                                    onClick = {
                                        savedEventIds = if (savedEventIds.contains(ad.id)) {
                                            savedEventIds - ad.id
                                        } else {
                                            savedEventIds + ad.id
                                        }
                                        settings.putString(SAVED_EVENT_IDS_KEY, toCsv(savedEventIds))
                                    },
                                    modifier = Modifier.weight(1f),
                                    shape = RoundedCornerShape(10.dp),
                                    colors = ButtonDefaults.filledTonalButtonColors(
                                        containerColor = if (savedEventIds.contains(ad.id)) Color(0xFFE0F7FA) else Color(0xFFF1F3F4),
                                        contentColor = if (savedEventIds.contains(ad.id)) Color(0xFF006064) else Color(0xFF455A64),
                                    ),
                                ) {
                                    Icon(
                                        imageVector = if (savedEventIds.contains(ad.id)) MaterialIcons.Filled.Favorite else MaterialIcons.Filled.FavoriteBorder,
                                        contentDescription = null,
                                        modifier = Modifier.size(16.dp),
                                    )
                                    Spacer(Modifier.width(6.dp))
                                    Text(if (savedEventIds.contains(ad.id)) "Saved" else "Save", fontSize = 12.sp)
                                }
                            }
                        }
                    }
                }
            }
    }

    LaunchedEffect(listVisible.map { it.id }.joinToString(), regionKey) {
        if (regionKey.isBlank()) return@LaunchedEffect
        for (ad in listVisible) {
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
