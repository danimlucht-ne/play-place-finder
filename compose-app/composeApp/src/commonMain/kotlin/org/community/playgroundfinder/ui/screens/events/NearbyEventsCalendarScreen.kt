package org.community.playgroundfinder.ui.screens.events

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons as MaterialIcons
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Event
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.graphics.Brush
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
import org.community.playgroundfinder.events.eventCreativeGoogleCalendarUrl
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
    var openFilterMenu by remember { mutableStateOf<String?>(null) }
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
            // Eye-catching hero replaces the small white card. Cyan gradient banner with a
            // calendar glyph reads as a destination instead of another filter strip and gives
            // the screen a clear visual identity that matches the rest of the brand.
            Surface(
                shape = RoundedCornerShape(20.dp),
                color = Color.Transparent,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(20.dp))
                        .background(
                            Brush.linearGradient(
                                listOf(Color(0xFF00CED1), Color(0xFF26C6DA), Color(0xFF80DEEA)),
                            ),
                        )
                        .padding(horizontal = 18.dp, vertical = 16.dp),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Surface(
                            shape = RoundedCornerShape(14.dp),
                            color = Color.White.copy(alpha = 0.22f),
                        ) {
                            Box(
                                modifier = Modifier.size(48.dp),
                                contentAlignment = Alignment.Center,
                            ) {
                                Icon(
                                    imageVector = MaterialIcons.Filled.CalendarMonth,
                                    contentDescription = null,
                                    tint = Color.White,
                                    modifier = Modifier.size(28.dp),
                                )
                            }
                        }
                        Spacer(Modifier.width(12.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                "Events near you",
                                fontSize = 18.sp,
                                fontWeight = FontWeight.Bold,
                                color = Color.White,
                            )
                            Text(
                                regionLabel,
                                fontSize = 13.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = Color.White.copy(alpha = 0.92f),
                            )
                            Spacer(Modifier.height(2.dp))
                            Text(
                                "Tap a card to learn more, save favorites, or drop them right on your calendar.",
                                fontSize = 12.sp,
                                color = Color.White.copy(alpha = 0.92f),
                                lineHeight = 16.sp,
                            )
                        }
                    }
                }
            }
            Spacer(Modifier.height(12.dp))

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
                    val sortLabel = when (sortMode) {
                        EventsCalendarSort.ByDate -> "Date"
                        EventsCalendarSort.ByDistance -> "Distance"
                        EventsCalendarSort.ByBusinessName -> "Business"
                    }
                    val dateFilterLabel = when {
                        dateKeys.isEmpty() -> null
                        selectedDate == null -> "All dates"
                        else -> formatEventDateDisplay(selectedDate!!, false) ?: selectedDate!!.trim().take(10)
                    }
                    val filterChipColors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = Color(0xFFFFE0B2),
                        selectedLabelColor = Color(0xFFE65100),
                        containerColor = Color(0xFFF5F5F5),
                        labelColor = Color(0xFF37474F),
                        iconColor = Color(0xFF37474F),
                    )
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(16.dp),
                        color = Color.White,
                        tonalElevation = 1.dp,
                    ) {
                        Column(
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .horizontalScroll(rememberScrollState()),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                Box {
                                    OutlinedButton(
                                        onClick = { openFilterMenu = "sort" },
                                        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
                                    ) {
                                        Text("Sort · $sortLabel", fontSize = 13.sp, fontWeight = FontWeight.Medium)
                                    }
                                    DropdownMenu(
                                        expanded = openFilterMenu == "sort",
                                        onDismissRequest = { openFilterMenu = null },
                                    ) {
                                        DropdownMenuItem(
                                            text = { Text("By date") },
                                            onClick = {
                                                sortMode = EventsCalendarSort.ByDate
                                                openFilterMenu = null
                                            },
                                        )
                                        DropdownMenuItem(
                                            text = { Text("By distance") },
                                            onClick = {
                                                sortMode = EventsCalendarSort.ByDistance
                                                openFilterMenu = null
                                            },
                                        )
                                        DropdownMenuItem(
                                            text = { Text("By business name") },
                                            onClick = {
                                                sortMode = EventsCalendarSort.ByBusinessName
                                                openFilterMenu = null
                                            },
                                        )
                                    }
                                }
                                if (dateKeys.isNotEmpty() && dateFilterLabel != null) {
                                    Box {
                                        OutlinedButton(
                                            onClick = { openFilterMenu = "date" },
                                            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
                                        ) {
                                            Text("When · $dateFilterLabel", fontSize = 13.sp, fontWeight = FontWeight.Medium, maxLines = 1)
                                        }
                                        DropdownMenu(
                                            expanded = openFilterMenu == "date",
                                            onDismissRequest = { openFilterMenu = null },
                                        ) {
                                            DropdownMenuItem(
                                                text = { Text("All dates") },
                                                onClick = {
                                                    selectedDate = null
                                                    openFilterMenu = null
                                                },
                                            )
                                            DropdownMenuItem(
                                                text = { Text("Pick from calendar…") },
                                                onClick = {
                                                    showDatePicker = true
                                                    openFilterMenu = null
                                                },
                                            )
                                            dateKeys.forEach { d ->
                                                val chipLabel = formatEventDateDisplay(d, isRecurring = false)
                                                    ?: d.trim().take(10)
                                                DropdownMenuItem(
                                                    text = { Text(chipLabel) },
                                                    onClick = {
                                                        selectedDate = d
                                                        openFilterMenu = null
                                                    },
                                                )
                                            }
                                        }
                                    }
                                }
                                FilterChip(
                                    selected = showSavedOnly,
                                    onClick = { showSavedOnly = !showSavedOnly },
                                    label = {
                                        Text(
                                            when {
                                                showSavedOnly -> "Saved (${savedEventIds.size})"
                                                else -> "All events"
                                            },
                                            fontSize = 13.sp,
                                            fontWeight = FontWeight.Medium,
                                        )
                                    },
                                    leadingIcon = {
                                        Icon(
                                            imageVector = if (showSavedOnly) MaterialIcons.Filled.Favorite else MaterialIcons.Filled.FavoriteBorder,
                                            contentDescription = null,
                                            modifier = Modifier.size(18.dp),
                                        )
                                    },
                                    colors = filterChipColors,
                                )
                            }
                            if (sortMode == EventsCalendarSort.ByDistance && (userLat == null || userLng == null)) {
                                Text(
                                    "Turn on location to sort by distance; list stays in date order until then.",
                                    fontSize = 11.sp,
                                    color = Color(0xFF37474F),
                                )
                            }
                            if (!showSavedOnly && savedVisible.isNotEmpty()) {
                                Text(
                                    "Saved events appear at the top of the list.",
                                    fontSize = 11.sp,
                                    color = Color(0xFF546E7A),
                                )
                            }
                        }
                    }
                    Spacer(Modifier.height(12.dp))
                    LazyColumn(
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                        contentPadding = PaddingValues(bottom = 24.dp),
                        modifier = Modifier.weight(1f),
                    ) {
                        // Helper: render a card + a single "Save" button. The calendar CTA now lives
                        // inside SponsoredListingCard so we don't render two side-by-side actions.
                        if (!showSavedOnly) {
                            items(savedVisible, key = { "saved-${eventCreativeDedupeKey(it)}" }) { ad ->
                                EventCalendarRow(
                                    ad = ad,
                                    isSaved = savedEventIds.contains(ad.id),
                                    onToggleSaved = {
                                        savedEventIds = if (savedEventIds.contains(ad.id)) {
                                            savedEventIds - ad.id
                                        } else {
                                            savedEventIds + ad.id
                                        }
                                        settings.putString(SAVED_EVENT_IDS_KEY, toCsv(savedEventIds))
                                    },
                                    onAdClick = onAdClick,
                                    onTrackClick = {
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
                                        }
                                    },
                                    onOpenCalendar = { url -> openExternalUrl(url) },
                                    userLat = userLat,
                                    userLng = userLng,
                                )
                            }
                        }
                        items(
                            listVisible.filter { if (showSavedOnly) true else !savedEventIds.contains(it.id) },
                            key = { eventCreativeDedupeKey(it) },
                        ) { ad ->
                            EventCalendarRow(
                                ad = ad,
                                isSaved = savedEventIds.contains(ad.id),
                                onToggleSaved = {
                                    savedEventIds = if (savedEventIds.contains(ad.id)) {
                                        savedEventIds - ad.id
                                    } else {
                                        savedEventIds + ad.id
                                    }
                                    settings.putString(SAVED_EVENT_IDS_KEY, toCsv(savedEventIds))
                                },
                                onAdClick = onAdClick,
                                onTrackClick = {
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
                                    }
                                },
                                onOpenCalendar = { url -> openExternalUrl(url) },
                                userLat = userLat,
                                userLng = userLng,
                            )
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

/**
 * One event row: card (with the in-card "Add to calendar" button) plus a full-width Save toggle
 * underneath. Splitting this out keeps the LazyColumn body readable and ensures the unsaved /
 * saved variants stay structurally identical.
 */
@Composable
private fun EventCalendarRow(
    ad: AdCreativePayload,
    isSaved: Boolean,
    onToggleSaved: () -> Unit,
    onAdClick: (String) -> Unit,
    onTrackClick: () -> Unit,
    onOpenCalendar: (String) -> Unit,
    userLat: Double?,
    userLng: Double?,
) {
    val title = eventCreativeDisplayTitle(ad)
    val calendarUrl = eventCreativeGoogleCalendarUrl(ad)
    SponsoredListingCard(
        businessName = title,
        category = ad.businessCategory.takeIf { it.isNotBlank() },
        description = ad.body.takeIf { it.isNotBlank() },
        websiteUrl = ad.ctaUrl.takeIf { it.isNotBlank() },
        imageUrl = ad.imageUrl?.takeIf { it.isNotBlank() },
        onLearnMore = { url ->
            onTrackClick()
            onAdClick(url)
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
        onAddToCalendar = calendarUrl?.let { url -> { onOpenCalendar(url) } },
    )
    Spacer(Modifier.height(6.dp))
    FilledTonalButton(
        onClick = onToggleSaved,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = ButtonDefaults.filledTonalButtonColors(
            containerColor = if (isSaved) Color(0xFFFFE0B2) else Color(0xFFE8EAF0),
            contentColor = if (isSaved) Color(0xFFE65100) else Color(0xFF263238),
        ),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 10.dp),
    ) {
        Icon(
            imageVector = if (isSaved) MaterialIcons.Filled.Favorite else MaterialIcons.Filled.FavoriteBorder,
            contentDescription = null,
            modifier = Modifier.size(18.dp),
        )
        Spacer(Modifier.width(8.dp))
        Text(
            if (isSaved) "Saved" else "Save event",
            fontSize = 13.sp,
            fontWeight = FontWeight.SemiBold,
        )
    }
}
