package org.community.playgroundfinder.ui.screens.home

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons as MaterialIcons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupProperties
import coil3.compose.AsyncImage
import org.community.playgroundfinder.data.Playground
import org.community.playgroundfinder.data.PlaygroundService
import org.community.playgroundfinder.ui.composables.*
import org.community.playgroundfinder.util.MarketingLinks
import org.community.playgroundfinder.util.parseHexColor
import org.community.playgroundfinder.util.rememberLocationService
import org.community.playgroundfinder.util.rememberOpenExternalUrl
import org.community.playgroundfinder.util.rememberSettings
import org.community.playgroundfinder.util.rememberVerificationGeofenceRegistrar
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.math.*
import org.community.playgroundfinder.models.AllAdsResponse
import org.community.playgroundfinder.models.HybridSearchResponse

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun HomeScreen(
    service: PlaygroundService,
    isAdmin: Boolean = false,
    isEmailVerified: Boolean = true,
    onResendVerification: () -> Unit = {},
    onNavigateToSearch: (HybridSearchResponse) -> Unit,
    onNavigateToMap: (List<Playground>, String?) -> Unit,
    onNavigateToAdd: () -> Unit,
    onNavigateToAll: (List<Playground>, String?) -> Unit,
    onNavigateToDetail: (Playground) -> Unit,
    onNavigateToPrivacy: () -> Unit,
    onLogout: () -> Unit,
    onNavigateToSupportTicket: () -> Unit,
    onNavigateToAdminHub: () -> Unit = {},
    onNavigateToFavorites: () -> Unit = {},
    onNavigateToMySubmissions: () -> Unit = {},
    onNavigateToLists: () -> Unit = {},
    onNavigateToRegionPlaygrounds: (regionKey: String, label: String) -> Unit = { _, _ -> },
    onNavigateToNearbyEvents: (regionKey: String, regionLabel: String, preloadedInlineListingAds: AllAdsResponse?) -> Unit = { _, _, _ -> },
    onNavigateToAdvertise: () -> Unit = {},
    onNavigateToMyAds: () -> Unit = {},
    onAdClick: (url: String) -> Unit = {},
    /** When true (e.g. returning from All Sites), open the filter sheet once then clear via [onConsumedOpenFilterSheetRequest]. */
    openFilterSheetRequest: Boolean = false,
    /** When opening the sheet from the interactive map, Apply & Search returns to the map with updated results. */
    openFilterReturnToMap: Boolean = false,
    onConsumedOpenFilterSheetRequest: () -> Unit = {},
) {
    val initialNearbyCount = 25
    val scope = rememberCoroutineScope()
    /** Cancels overlapping [performSearch] runs so an older request cannot clear the list after a newer one. */
    var performSearchJob by remember { mutableStateOf<Job?>(null) }
    val settings = rememberSettings()
    val openExternalUrl = rememberOpenExternalUrl()
    /** When GET /playgrounds/search rows omit [Playground.regionKey], we still resolve ads from region/hybrid APIs. */
    var adsRegionKeyHint by remember { mutableStateOf<String?>(null) }
    var nearbyPlaygrounds by remember { mutableStateOf<List<Playground>>(emptyList()) }
    var syncedResults by remember { mutableStateOf<List<Playground>>(emptyList()) }
    var searchQuery by remember { mutableStateOf(settings.getString("home_search_query", "")) }
    var isSearching by remember { mutableStateOf(false) }
    var searchMessage by remember { mutableStateOf("") }

    // List membership for chips on Popular Near You cards
    var listMembership by remember { mutableStateOf<Map<String, List<Pair<String, String?>>>>(emptyMap()) }

    // Local favorites set — populated from server, used to show filled hearts
    var favoritedIds by remember { mutableStateOf<Set<String>>(emptySet()) }

    // 9.10 — city completion meter state
    var cityCompletion by remember { mutableStateOf<PlaygroundService.CityCompletion?>(null) }

    // Location consent is now handled by the Android system permission dialog.
    // The old onboarding checkbox was removed, so default to true and let
    // the actual getLocation() call handle permission failures gracefully.
    val locationConsentAccepted = true

    val getLocation = rememberLocationService()
    val registerVerificationGeofences = rememberVerificationGeofenceRegistrar()
    var userLat by remember { mutableStateOf<Double?>(null) }
    var userLng by remember { mutableStateOf<Double?>(null) }

    var homeMoreMenuExpanded by remember { mutableStateOf(false) }
    var showAboutDialog by remember { mutableStateOf(false) }
    var moreMenuAnchorWindowPos by remember { mutableStateOf<IntOffset?>(null) }
    var moreMenuAnchorSizePx by remember { mutableStateOf<IntSize?>(null) }

    // --- FILTER STATE (restored from last search) ---
    var showFilterSheet by remember { mutableStateOf(false) }
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    /** Set when opening filters from the map; cleared after Apply navigates back or sheet is dismissed. */
    var pendingNavigateToMapAfterFilter by remember { mutableStateOf(false) }
    LaunchedEffect(openFilterSheetRequest) {
        if (openFilterSheetRequest) {
            pendingNavigateToMapAfterFilter = openFilterReturnToMap
            showFilterSheet = true
            onConsumedOpenFilterSheetRequest()
        }
    }

    val popularNearYouListState = rememberLazyListState()
    var wasSearchInProgress by remember { mutableStateOf(false) }
    LaunchedEffect(isSearching) {
        if (wasSearchInProgress && !isSearching) {
            popularNearYouListState.scrollToItem(0)
        }
        wasSearchInProgress = isSearching
    }

    var filterRadius by remember { mutableStateOf(settings.getString("filter_radius", "10").toFloatOrNull() ?: 10f) }
    var filterCityState by remember { mutableStateOf(settings.getString("filter_search_location", "")) }
    var isRegionSearching by remember { mutableStateOf(false) }
    var autocompletePredictions by remember { mutableStateOf<List<org.community.playgroundfinder.models.CityPrediction>>(emptyList()) }
    var overrideLat by remember { mutableStateOf<Double?>(null) }
    var overrideLng by remember { mutableStateOf<Double?>(null) }
    var overrideLocationLabel by remember { mutableStateOf<String?>(null) }
    var lastResolvedLocationQuery by remember { mutableStateOf("") }
    var filterPlaygroundType by remember { mutableStateOf(settings.getString("filter_playgroundType", "").ifBlank { null }) }
    var filterGroundTypesInclude by remember {
        mutableStateOf(
            run {
                val fromNew = settings.getString("filter_groundType_include", "")
                    .split(",")
                    .map { it.trim() }
                    .filter { it.isNotBlank() }
                    .toSet()
                if (fromNew.isNotEmpty()) fromNew
                else {
                    settings.getString("filter_groundType", "").trim()
                        .takeIf { it.isNotBlank() }
                        ?.let { setOf(it) }
                        ?: emptySet()
                }
            },
        )
    }
    var filterGroundTypesExclude by remember {
        mutableStateOf(
            settings.getString("filter_groundType_exclude", "")
                .split(",")
                .map { it.trim() }
                .filter { it.isNotBlank() }
                .toSet(),
        )
    }
    var filterExpense by remember { mutableStateOf(settings.getString("filter_expense", "").ifBlank { null }) }
    
    // Boolean Toggles (restored)
    var filterHasBathrooms by remember { mutableStateOf(settings.getBoolean("filter_hasBathrooms", false)) }
    var filterHasShade by remember { mutableStateOf(settings.getBoolean("filter_hasShade", false)) }
    var filterIsFenced by remember { mutableStateOf(settings.getBoolean("filter_isFenced", false)) }
    var filterIsToddlerFriendly by remember { mutableStateOf(settings.getBoolean("filter_isToddlerFriendly", false)) }
    var filterIsDogFriendly by remember { mutableStateOf(settings.getBoolean("filter_isDogFriendly", false)) }
    var filterIsAccessible by remember { mutableStateOf(settings.getBoolean("filter_isAccessible", false)) }
    var filterHasParking by remember { mutableStateOf(settings.getBoolean("filter_hasParking", false)) }
    var filterHasWifi by remember { mutableStateOf(settings.getBoolean("filter_hasWifi", false)) }
    var filterNeedsGripSocks by remember { mutableStateOf(settings.getBoolean("filter_needsGripSocks", false)) }
    var filterRequiresWaiver by remember { mutableStateOf(settings.getBoolean("filter_requiresWaiver", false)) }
    var filterHasPicnicTables by remember { mutableStateOf(settings.getBoolean("filter_hasPicnicTables", false)) }
    var filterHasBenches by remember { mutableStateOf(settings.getBoolean("filter_hasBenches", false)) }
    var filterHasTrashCans by remember { mutableStateOf(settings.getBoolean("filter_hasTrashCans", false)) }
    var filterHasSplashPad by remember { mutableStateOf(settings.getBoolean("filter_hasSplashPad", false)) }
    var filterHasWaterFountain by remember { mutableStateOf(settings.getBoolean("filter_hasWaterFountain", false)) }
    var filterHasWalkingTrail by remember { mutableStateOf(settings.getBoolean("filter_hasWalkingTrail", false)) }

    // Multi-select Lists (restored)
    var selectedEquipment by remember { mutableStateOf(settings.getString("filter_equipment", "").split(",").filter { it.isNotBlank() }.toSet()) }
    var selectedExercise by remember { mutableStateOf(settings.getString("filter_exercise", "").split(",").filter { it.isNotBlank() }.toSet()) }
    var selectedSwings by remember { mutableStateOf(settings.getString("filter_swings", "").split(",").filter { it.isNotBlank() }.toSet()) }

    fun activeFilterSummary(): String {
        val parts = mutableListOf<String>()
        val loc = overrideLocationLabel?.takeIf { it.isNotBlank() }
            ?: filterCityState.takeIf { it.isNotBlank() }
            ?: "Current location"
        parts.add(loc)
        parts.add("${filterRadius.toInt()} mi")
        if (searchQuery.isNotBlank()) parts.add("Search: \"$searchQuery\"")
        filterPlaygroundType?.takeIf { it.isNotBlank() }?.let { parts.add("Type: $it") }
        if (filterGroundTypesInclude.isNotEmpty() || filterGroundTypesExclude.isNotEmpty()) {
            val bits = mutableListOf<String>()
            if (filterGroundTypesInclude.isNotEmpty()) {
                bits.add("Ground: ${filterGroundTypesInclude.sorted().joinToString(", ")}")
            }
            if (filterGroundTypesExclude.isNotEmpty()) {
                bits.add("Not: ${filterGroundTypesExclude.sorted().joinToString(", ")}")
            }
            parts.add(bits.joinToString(" · "))
        }
        filterExpense?.takeIf { it.isNotBlank() }?.let { parts.add("Cost: $it") }
        val toggleCount = listOf(
            filterHasBathrooms, filterHasShade, filterIsFenced, filterIsToddlerFriendly, filterIsDogFriendly,
            filterIsAccessible, filterHasParking, filterHasWifi, filterNeedsGripSocks, filterRequiresWaiver,
            filterHasPicnicTables, filterHasBenches, filterHasTrashCans, filterHasSplashPad, filterHasWaterFountain,
            filterHasWalkingTrail
        ).count { it }
        if (toggleCount > 0) parts.add("$toggleCount amenity filter${if (toggleCount == 1) "" else "s"}")
        val multiCount = selectedEquipment.size + selectedExercise.size + selectedSwings.size
        if (multiCount > 0) parts.add("$multiCount equipment/sport filter${if (multiCount == 1) "" else "s"}")
        return parts.joinToString(" • ")
    }

    // Save all filters to settings
    fun saveFilters() {
        settings.putString("home_search_query", searchQuery)
        settings.putString("filter_playgroundType", filterPlaygroundType ?: "")
        settings.putString("filter_groundType_include", filterGroundTypesInclude.joinToString(","))
        settings.putString("filter_groundType_exclude", filterGroundTypesExclude.joinToString(","))
        settings.putString("filter_groundType", "")
        settings.putString("filter_expense", filterExpense ?: "")
        settings.putString("filter_radius", filterRadius.toString())
        settings.setBoolean("filter_hasBathrooms", filterHasBathrooms)
        settings.setBoolean("filter_hasShade", filterHasShade)
        settings.setBoolean("filter_isFenced", filterIsFenced)
        settings.setBoolean("filter_isToddlerFriendly", filterIsToddlerFriendly)
        settings.setBoolean("filter_isDogFriendly", filterIsDogFriendly)
        settings.setBoolean("filter_isAccessible", filterIsAccessible)
        settings.setBoolean("filter_hasParking", filterHasParking)
        settings.setBoolean("filter_hasWifi", filterHasWifi)
        settings.setBoolean("filter_needsGripSocks", filterNeedsGripSocks)
        settings.setBoolean("filter_requiresWaiver", filterRequiresWaiver)
        settings.setBoolean("filter_hasPicnicTables", filterHasPicnicTables)
        settings.setBoolean("filter_hasBenches", filterHasBenches)
        settings.setBoolean("filter_hasTrashCans", filterHasTrashCans)
        settings.setBoolean("filter_hasSplashPad", filterHasSplashPad)
        settings.setBoolean("filter_hasWaterFountain", filterHasWaterFountain)
        settings.setBoolean("filter_hasWalkingTrail", filterHasWalkingTrail)
        settings.putString("filter_equipment", selectedEquipment.joinToString(","))
        settings.putString("filter_exercise", selectedExercise.joinToString(","))
        settings.putString("filter_swings", selectedSwings.joinToString(","))
        settings.putString("filter_search_location", filterCityState)
    }

    // playgroundTypes replaced by PLACE_CATEGORIES in CategoryTypePicker
    val groundTypes = listOf("Rubber", "Mulch", "Sand", "Grass", "Concrete")
    val expenseOptions = FormColors.COST_OPTIONS
    val equipmentOptions = listOf("Swings", "Slide", "Climbing Wall", "Monkey Bars", "Sandbox", "Seesaw", "Spring Riders", "Balance Beam", "Zip Line")
    val swingOptions = listOf("Belt", "Bucket", "Tire", "Accessible")
    val sportOptions = listOf("Football", "Basketball", "Soccer", "Tennis", "Pickleball", "Volleyball", "Sand Volleyball", "Baseball", "Softball")
    val exerciseOptions = listOf("Pull-up Bar", "Fitness Station", "Walking Trail Exercise Stops", "Outdoor Gym", "Balance Beam", "Parallel Bars")

    // Helper for manual distance sorting
    fun calculateDistance(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val r = 3958.8 // Radius of Earth in miles
        val dLat = (lat2 - lat1) * (PI / 180.0)
        val dLon = (lon2 - lon1) * (PI / 180.0)
        val a = sin(dLat / 2) * sin(dLat / 2) + cos(lat1 * (PI / 180.0)) * cos(lat2 * (PI / 180.0)) * sin(dLon / 2) * sin(dLon / 2)
        val c = 2 * atan2(sqrt(a), sqrt(1 - a))
        return r * c
    }

    /**
     * True when API returned usable coordinates (rejects missing center and 0,0 placeholders).
     */
    fun coordsUsable(lat: Double?, lng: Double?): Boolean {
        if (lat == null || lng == null) return false
        if (lat == 0.0 && lng == 0.0) return false
        return true
    }

    /**
     * Single source for home list + synced results. Pass fresh GPS here on first load so we never
     * read stale [userLat]/[userLng] from a nested coroutine started before state updates.
     *
     * @param clearStaleResults When true (filter Apply / Clear / Reset), geocode [filterCityState] if needed and avoid showing previous results while loading.
     * @param resetToGps When true (Clear all filters), ignore saved city string and use device coordinates only.
     */
    suspend fun runPlaygroundSearch(deviceLat: Double?, deviceLng: Double?, clearStaleResults: Boolean = false, resetToGps: Boolean = false) {
        fun mergeRegionPlaceLists(a: List<Playground>, b: List<Playground>): List<Playground> {
            if (b.isEmpty()) return a
            if (a.isEmpty()) return b
            val byKey = linkedMapOf<String, Playground>()
            fun key(p: Playground) = p.id?.takeIf { it.isNotBlank() }
                ?: "${p.latitude},${p.longitude},${p.name}"
            for (p in a) byKey[key(p)] = p
            for (p in b) byKey[key(p)] = p
            return byKey.values.toList()
        }

        // Places returned by POST /regions/search (region list) — use when GET /playgrounds/search $near returns nothing.
        var regionPlacesFallback: List<Playground> = emptyList()
        var regionSeedingTriggered = false

        // Use saved label / settings if the text field was cleared before this coroutine ran (e.g. sheet dismiss)
        val cityQueryForGeocode = if (resetToGps) {
            ""
        } else {
            filterCityState.trim().ifBlank {
                overrideLocationLabel?.trim().orEmpty()
            }.ifBlank {
                settings.getString("filter_search_location", "").trim()
            }
        }
        if (clearStaleResults && cityQueryForGeocode.isNotBlank()) {
            overrideLocationLabel = cityQueryForGeocode
            try {
                val resolved = service.searchRegion(cityQueryForGeocode)
                resolved.regionKey.takeIf { it.isNotBlank() }?.let { adsRegionKeyHint = it }
                regionPlacesFallback = mergeRegionPlaceLists(regionPlacesFallback, resolved.places)
                regionSeedingTriggered = regionSeedingTriggered || resolved.seedingTriggered
                if (resolved.seedingTriggered) {
                    searchMessage =
                        "Mapping this area — new places usually appear within a minute. Hang tight…"
                }
                val c = resolved.center
                if (c != null && coordsUsable(c.lat, c.lng)) {
                    overrideLat = c.lat
                    overrideLng = c.lng
                    overrideLocationLabel = cityQueryForGeocode
                    filterCityState = cityQueryForGeocode
                } else {
                    overrideLat = null
                    overrideLng = null
                }
            } catch (_: Exception) {
                overrideLat = null
                overrideLng = null
            }
            if (!coordsUsable(overrideLat, overrideLng)) {
                searchMessage =
                    "Could not find that location. Try choosing an address from the suggestions, or check spelling."
                syncedResults = emptyList()
                nearbyPlaygrounds = emptyList()
                return
            }
        }
        // Picked a suggestion (override set) but cleared the text field — still resolve coords if missing
        val labelForRetry = overrideLocationLabel
        if (!coordsUsable(overrideLat, overrideLng) && !labelForRetry.isNullOrBlank()) {
            try {
                val resolved = service.searchRegion(labelForRetry.trim())
                resolved.regionKey.takeIf { it.isNotBlank() }?.let { adsRegionKeyHint = it }
                regionPlacesFallback = mergeRegionPlaceLists(regionPlacesFallback, resolved.places)
                regionSeedingTriggered = regionSeedingTriggered || resolved.seedingTriggered
                if (resolved.seedingTriggered) {
                    searchMessage =
                        "Mapping this area — new places usually appear within a minute. Hang tight…"
                }
                val c = resolved.center
                if (c != null && coordsUsable(c.lat, c.lng)) {
                    overrideLat = c.lat
                    overrideLng = c.lng
                }
            } catch (_: Exception) { }
        }
        val trimmedQuery = searchQuery.trim()
        val looksLikeLocationQuery =
            trimmedQuery.length >= 6 && (trimmedQuery.contains(",") || trimmedQuery.any { it.isDigit() })
        if (looksLikeLocationQuery && !trimmedQuery.equals(lastResolvedLocationQuery, ignoreCase = true)) {
            try {
                val prediction = service.autocompleteLocation(trimmedQuery).firstOrNull()
                if (prediction != null) {
                    val region = service.searchRegion(prediction.description)
                    region.regionKey.takeIf { it.isNotBlank() }?.let { adsRegionKeyHint = it }
                    regionPlacesFallback = mergeRegionPlaceLists(regionPlacesFallback, region.places)
                    regionSeedingTriggered = regionSeedingTriggered || region.seedingTriggered
                    if (region.seedingTriggered) {
                        searchMessage =
                            "Mapping this area — new places usually appear within a minute. Hang tight…"
                    }
                    val c = region.center
                    if (c != null && coordsUsable(c.lat, c.lng)) {
                        overrideLat = c.lat
                        overrideLng = c.lng
                        overrideLocationLabel = prediction.description
                        filterCityState = prediction.description
                        lastResolvedLocationQuery = trimmedQuery
                    }
                }
            } catch (_: Exception) {
                // Keep normal text search behavior if location resolution fails.
            }
        }
        val searchLatRaw = overrideLat ?: deviceLat
        val searchLngRaw = overrideLng ?: deviceLng
        if (!coordsUsable(searchLatRaw, searchLngRaw)) {
            searchMessage = when {
                !overrideLocationLabel.isNullOrBlank() || filterCityState.isNotBlank() ->
                    "Could not resolve that place yet. Check your connection, or pick the city again from the list."
                else ->
                    "We couldn't get your location. Enable location to search nearby."
            }
            syncedResults = emptyList()
            nearbyPlaygrounds = emptyList()
            return
        }
        val searchLat = searchLatRaw!!
        val searchLng = searchLngRaw!!
        val q = searchQuery.trim()

        println("HomeScreen: runPlaygroundSearch started with searchLat=$searchLat, searchLng=$searchLng, radius=${filterRadius.toInt()}, query='$q'")
        
        try {
            /** @param rawCount how many places the API returned before the home text filter (for UX when API has data but list is empty). */
            suspend fun queryPlaygroundsForHome(radius: Int): Pair<List<Playground>, Int> {
                val raw = service.searchPlaygrounds(
                    lat = searchLat,
                    lng = searchLng,
                    radius = radius,
                    playgroundType = filterPlaygroundType,
                    groundTypesInclude = filterGroundTypesInclude.takeIf { it.isNotEmpty() }?.toList(),
                    groundTypesExclude = filterGroundTypesExclude.takeIf { it.isNotEmpty() }?.toList(),
                    expense = filterExpense,
                    hasBathrooms = if (filterHasBathrooms) true else null,
                    hasShade = if (filterHasShade) true else null,
                    isFenced = if (filterIsFenced) true else null,
                    isToddlerFriendly = if (filterIsToddlerFriendly) true else null,
                    isDogFriendly = if (filterIsDogFriendly) true else null,
                    isAccessible = if (filterIsAccessible) true else null,
                    hasParking = if (filterHasParking) true else null,
                    hasWifi = if (filterHasWifi) true else null,
                    needsGripSocks = if (filterNeedsGripSocks) true else null,
                    requiresWaiver = if (filterRequiresWaiver) true else null,
                    hasPicnicTables = if (filterHasPicnicTables) true else null,
                    hasBenches = if (filterHasBenches) true else null,
                    hasTrashCans = if (filterHasTrashCans) true else null,
                    hasSplashPad = if (filterHasSplashPad) true else null,
                    hasWaterFountain = if (filterHasWaterFountain) true else null,
                    hasWalkingTrail = if (filterHasWalkingTrail) true else null,
                    equipment = if (selectedEquipment.isNotEmpty()) selectedEquipment.toList() else null,
                    sportsCourts = if (selectedExercise.isNotEmpty()) selectedExercise.toList() else null,
                    swingTypes = if (selectedSwings.isNotEmpty()) selectedSwings.toList() else null
                )
                println("HomeScreen: API returned ${raw.size} results for searchLat=$searchLat, searchLng=$searchLng")
                val nameFiltered = if (q.isEmpty()) raw else raw.filter { it.matchesHomeSearchQuery(q) }
                println("HomeScreen: After local text filter, ${nameFiltered.size} results remain")
                return Pair(
                    nameFiltered.sortedBy { calculateDistance(searchLat, searchLng, it.latitude, it.longitude) },
                    raw.size
                )
            }

            // When user is typing a name query, search wider (200 miles) to cover the whole region
            val effectiveRadius = if (q.isNotEmpty()) 200 else filterRadius.toInt()
            // Overlap region fallback fetch with playground query — two round-trips in one wall-clock wait (helps remote API latency).
            var (filtered, rawFromApi) = coroutineScope {
                // Always resolve canonical regionKey from search center for ads (featured + inline).
                // Skipping this when override coords were set left discoverCityId null until a text search
                // or hybridSearch completed — ads never loaded on first paint.
                val regionDeferred = async {
                    try {
                        service.searchRegionAtCoordinates(searchLat, searchLng)
                    } catch (_: Exception) {
                        null
                    }
                }
                val playgroundsDeferred = async { queryPlaygroundsForHome(effectiveRadius) }
                val pgPair = playgroundsDeferred.await()
                val resolvedRegion = regionDeferred.await()
                if (resolvedRegion != null) {
                    resolvedRegion.regionKey.takeIf { it.isNotBlank() }?.let { adsRegionKeyHint = it }
                    regionPlacesFallback = mergeRegionPlaceLists(regionPlacesFallback, resolvedRegion.places)
                    regionSeedingTriggered = regionSeedingTriggered || resolvedRegion.seedingTriggered
                    if (resolvedRegion.seedingTriggered) {
                        searchMessage =
                            "Mapping this area — new places usually appear within a minute. Hang tight…"
                    }
                }
                pgPair
            }

            fun List<Playground>.applyGroundSurfaceFiltersIfNeeded(): List<Playground> =
                if (filterGroundTypesInclude.isEmpty() && filterGroundTypesExclude.isEmpty()) this
                else filter { it.matchesGroundSurfaceFilters(filterGroundTypesInclude, filterGroundTypesExclude) }

            filtered = filtered.applyGroundSurfaceFiltersIfNeeded()

            // If /regions/search did not return a key, use the first playground row that has one (DB-backed).
            if (adsRegionKeyHint.isNullOrBlank()) {
                filtered.firstOrNull { !it.regionKey.isNullOrBlank() }?.regionKey?.trim()?.takeIf { it.isNotBlank() }?.let { k ->
                    adsRegionKeyHint = k
                }
            }

            if (filtered.isEmpty() && regionPlacesFallback.isNotEmpty()) {
                println(
                    "HomeScreen: proximity search empty; using ${regionPlacesFallback.size} place(s) from region/search fallback"
                )
                val nameFiltered =
                    if (q.isEmpty()) regionPlacesFallback
                    else regionPlacesFallback.filter { it.matchesHomeSearchQuery(q) }
                filtered = nameFiltered
                    .applyGroundSurfaceFiltersIfNeeded()
                    .filter { coordsUsable(it.latitude, it.longitude) }
                    .sortedBy { calculateDistance(searchLat, searchLng, it.latitude, it.longitude) }
                rawFromApi = regionPlacesFallback.size
            }

            val hasNearby = filtered.any { calculateDistance(searchLat, searchLng, it.latitude, it.longitude) <= 5.0 }

            if (!hasNearby && overrideLat != null) {
                val locationName = overrideLocationLabel ?: "that location"
                println("HomeScreen: No nearby places found for override location $locationName, falling back to hybrid search")
                // Keep API results on screen while seeding; clearing here made the home carousel blank despite a good /search response.
                if (filtered.isNotEmpty()) {
                    syncedResults = filtered
                    nearbyPlaygrounds = filtered.take(initialNearbyCount)
                    searchMessage =
                        "Showing places in the wider area; loading closer spots near $locationName…"
                } else {
                    syncedResults = emptyList()
                    nearbyPlaygrounds = emptyList()
                    searchMessage =
                        "Loading play places near $locationName — this usually takes about a minute."
                }
                try {
                    val hybrid = withTimeoutOrNull(90_000) {
                        service.hybridSearch(searchLat, searchLng)
                    }
                    hybrid?.regionKey?.takeIf { it.isNotBlank() }?.let { adsRegionKeyHint = it }
                    var hybridList = hybrid?.places.orEmpty()
                    if (q.isNotEmpty()) {
                        hybridList = hybridList.filter { it.matchesHomeSearchQuery(q) }
                    }
                    hybridList = hybridList
                        .let { list ->
                            if (filterGroundTypesInclude.isEmpty() && filterGroundTypesExclude.isEmpty()) list
                            else list.filter {
                                it.matchesGroundSurfaceFilters(filterGroundTypesInclude, filterGroundTypesExclude)
                            }
                        }
                        .sortedBy { calculateDistance(searchLat, searchLng, it.latitude, it.longitude) }
                    if (hybridList.isNotEmpty()) {
                        syncedResults = hybridList
                        nearbyPlaygrounds = hybridList.take(initialNearbyCount)
                        searchMessage = hybrid?.message.orEmpty().ifBlank {
                            "More places may appear as we finish mapping this area."
                        }
                    }
                    for (attempt in 1..18) {
                        delay(5000L)
                        val (refreshed, _) = queryPlaygroundsForHome(10)
                        val refreshedGround = refreshed.applyGroundSurfaceFiltersIfNeeded()
                        if (refreshedGround.isNotEmpty()) {
                            syncedResults = refreshedGround
                            nearbyPlaygrounds = refreshedGround.take(initialNearbyCount)
                            searchMessage = ""
                            break
                        }
                    }
                    if (nearbyPlaygrounds.isEmpty()) {
                        searchMessage = "Seeding complete — no play places found near $locationName yet."
                    }
                } catch (e: Exception) {
                    println("HomeScreen: Hybrid search error: ${e.message}")
                    searchMessage = "Could not load play places: ${e.message}"
                }
                return
            }

            syncedResults = filtered
            nearbyPlaygrounds = filtered.take(initialNearbyCount)
            val anyExtraFilters = filterPlaygroundType != null ||
                filterGroundTypesInclude.isNotEmpty() || filterGroundTypesExclude.isNotEmpty() ||
                filterExpense != null ||
                filterHasBathrooms || filterHasShade || filterIsFenced || filterIsToddlerFriendly || filterIsDogFriendly ||
                filterIsAccessible || filterHasParking || filterHasWifi || filterNeedsGripSocks || filterRequiresWaiver ||
                filterHasPicnicTables || filterHasBenches || filterHasTrashCans || filterHasSplashPad ||
                filterHasWaterFountain || filterHasWalkingTrail ||
                selectedEquipment.isNotEmpty() || selectedExercise.isNotEmpty() || selectedSwings.isNotEmpty() ||
                q.isNotEmpty()
                
            println("HomeScreen: nearbyPlaygrounds size=${nearbyPlaygrounds.size}, syncedResults size=${syncedResults.size}")
            
            searchMessage = when {
                filtered.isNotEmpty() && regionSeedingTriggered ->
                    "Still mapping this area — showing places across the region. Pull to refresh in a minute for more nearby."
                filtered.isNotEmpty() -> ""
                rawFromApi > 0 && q.isNotEmpty() ->
                    "The map returned places, but none match \"$q\". Clear the search box to see all nearby places."
                anyExtraFilters -> "No matching play places found nearby."
                regionSeedingTriggered ->
                    "We're mapping this area — try widening your search radius or check back in a minute."
                else -> "You're the first in your area - we're loading a list of play places now!"
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            println("HomeScreen: search failed error=${e.message}")
            searchMessage = homeSearchFailureUserMessage(e)
        }
    }

    /**
     * @param clearStaleResults Pass true when applying or clearing filters so the list does not keep showing the previous area while the new search runs.
     * @param resetToGps Pass true when clearing all filters so search centers on device location, not a previously saved city string.
     * @param navigateToMapWhenDone After a successful search, open the interactive map with the current result set (map filter flow).
     */
    fun performSearch(
        clearStaleResults: Boolean = false,
        resetToGps: Boolean = false,
        navigateToMapWhenDone: Boolean = false,
    ) {
        performSearchJob?.cancel()
        performSearchJob = scope.launch {
            isSearching = true
            if (clearStaleResults) {
                nearbyPlaygrounds = emptyList()
                syncedResults = emptyList()
            }
            val keepExistingLoadingMessage =
                searchMessage.contains("Loading play places", ignoreCase = true) ||
                    searchMessage.contains("Mapping this area", ignoreCase = true) ||
                    searchMessage.contains("Still mapping", ignoreCase = true) ||
                    searchMessage.contains("seeding", ignoreCase = true) ||
                    searchMessage.contains("minute", ignoreCase = true)
            if (searchMessage.isBlank() || !keepExistingLoadingMessage) {
                searchMessage = "Loading play places near you!"
            }
            try {
                runPlaygroundSearch(userLat, userLng, clearStaleResults = clearStaleResults, resetToGps = resetToGps)
                if (navigateToMapWhenDone) {
                    onNavigateToMap(syncedResults.ifEmpty { nearbyPlaygrounds }, activeFilterSummary())
                }
            } catch (_: CancellationException) {
                /* superseded by a newer search */
            } finally {
                isSearching = false
                if (navigateToMapWhenDone) {
                    pendingNavigateToMapAfterFilter = false
                }
                saveFilters()
            }
        }
    }

    var skipSearchQueryDebounce by remember { mutableStateOf(true) }
    LaunchedEffect(searchQuery) {
        if (skipSearchQueryDebounce) {
            skipSearchQueryDebounce = false
            return@LaunchedEffect
        }
        delay(400)
        performSearch()
    }

    LaunchedEffect(Unit) {
        searchMessage = "Loading play places near you!"
        isSearching = true
        scope.launch {
            if (!locationConsentAccepted) {
                searchMessage = "Browsing without location. Enable location services to find places near you."
                isSearching = false
                return@launch
            }

            val loc = getLocation()
            if (loc != null) {
                println("HomeScreen: Got location $loc")
                userLat = loc.latitude
                userLng = loc.longitude
                try {
                    // Load list from /playgrounds/search first — hybrid seeding can take 30s+ and must not block first paint.
                    runPlaygroundSearch(loc.latitude, loc.longitude)
                    scope.launch {
                        try {
                            val h = service.hybridSearch(loc.latitude, loc.longitude)
                            h.regionKey?.takeIf { it.isNotBlank() }?.let { adsRegionKeyHint = it }
                        } catch (_: Exception) {
                            /* seeding is best-effort */
                        }
                    }
                    val needsSeedPoll = nearbyPlaygrounds.isEmpty() &&
                        searchMessage.contains("first in your area", ignoreCase = true)
                    if (needsSeedPoll) {
                        println("HomeScreen: Needs seed poll")
                        repeat(17) {
                            delay(5000L)
                            withTimeoutOrNull(90_000) {
                                try {
                                    val h = service.hybridSearch(loc.latitude, loc.longitude)
                                    h.regionKey?.takeIf { it.isNotBlank() }?.let { adsRegionKeyHint = it }
                                } catch (_: Exception) {
                                    /* ignore */
                                }
                            }
                            runPlaygroundSearch(loc.latitude, loc.longitude)
                            if (nearbyPlaygrounds.isNotEmpty()) return@repeat
                        }
                    }
                } catch (e: Exception) {
                    println("HomeScreen: Error in initial load flow: ${e.message}")
                    try {
                        runPlaygroundSearch(loc.latitude, loc.longitude)
                        if (nearbyPlaygrounds.isNotEmpty()) {
                            searchMessage = "Localized search had issues. Showing closest matches for your filters."
                        }
                    } catch (_: Exception) {
                        searchMessage = "Localized search failed. Check your connection."
                    }
                } finally {
                    isSearching = false
                }
            } else {
                println("HomeScreen: loc is null, falling back to all playgrounds")
                searchMessage = "We couldn't get your location. Check that location services are on and try again."
                isSearching = false
                try {
                    val all = service.getAllPlaygrounds().data
                    println("HomeScreen: getAllPlaygrounds API returned size: ${all.size}")
                    if (all.isNotEmpty()) {
                        syncedResults = all
                        nearbyPlaygrounds = all.take(initialNearbyCount)
                        searchMessage = ""
                    } else {
                        println("HomeScreen: getAllPlaygrounds returned empty list")
                    }
                } catch (e: Exception) {
                    println("HomeScreen: Failed to get all playgrounds: ${e.message}")
                }
            }
        }
    }

    // Register proximity prompts for the closest results (Android only; no-op elsewhere).
    LaunchedEffect(nearbyPlaygrounds, userLat, userLng) {
        if (userLat != null && userLng != null && nearbyPlaygrounds.isNotEmpty()) {
            // 9.10 — fetch city completion for the first playground's region
            val regionKey = nearbyPlaygrounds.firstOrNull()?.regionKey
            if (!regionKey.isNullOrBlank() && cityCompletion == null) {
                try { cityCompletion = service.getCityCompletion(regionKey) } catch (_: Exception) {}
            }
            val freePublicPlaces = nearbyPlaygrounds.filter { pg ->
                val costRange = pg.costRange?.trim().orEmpty()
                val expense = pg.expense?.trim().orEmpty()
                val costToEnter = pg.costToEnter?.trim().orEmpty()

                costRange.equals("Free", ignoreCase = true) ||
                    costRange.equals("Free/Public", ignoreCase = true) ||
                    expense.equals("Free/Public", ignoreCase = true) ||
                    expense.equals("Free", ignoreCase = true) ||
                    costToEnter.equals("Free", ignoreCase = true) ||
                    costToEnter.equals("Free/Public", ignoreCase = true)
            }

            registerVerificationGeofences(freePublicPlaces.take(25), 250.0)
        }
    }

    // Fetch user list membership for chips on Popular Near You cards
    LaunchedEffect(Unit) {
        try {
            // Fetch favorite IDs
            favoritedIds = service.getMyFavoriteIds()
        } catch (_: Exception) {}
        try {
            val lists = service.getLists()
            val map = mutableMapOf<String, MutableList<Pair<String, String?>>>()
            lists.forEach { list ->
                try {
                    val detail = service.getListDetail(list.id)
                    detail.places.forEach { place ->
                        val pid = place.id ?: return@forEach
                        map.getOrPut(pid) { mutableListOf() }.add(list.name to list.color)
                    }
                } catch (_: Exception) {}
            }
            listMembership = map
        } catch (_: Exception) {}
    }

    if (showFilterSheet) {
        ModalBottomSheet(
            onDismissRequest = {
                showFilterSheet = false
                pendingNavigateToMapAfterFilter = false
            },
            sheetState = sheetState,
            dragHandle = { BottomSheetDefaults.DragHandle() }
        ) {
            Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 24.dp).padding(bottom = 48.dp).verticalScroll(rememberScrollState())) {
                Text("Search Filters", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(24.dp))

                // Search by location — autocomplete with Google Places
                Text("Search by Location", style = MaterialTheme.typography.titleMedium)
                Text("Type an address, city, or zip code", fontSize = 12.sp, color = Color.Gray)
                Spacer(Modifier.height(4.dp))
                OutlinedTextField(
                    value = filterCityState,
                    onValueChange = { newValue ->
                        filterCityState = newValue
                        if (newValue.length >= 2) {
                            scope.launch {
                                try {
                                    autocompletePredictions = service.autocompleteLocation(newValue)
                                } catch (_: Exception) {
                                    autocompletePredictions = emptyList()
                                }
                            }
                        } else {
                            autocompletePredictions = emptyList()
                        }
                    },
                    placeholder = { Text("e.g. 123 Main St, Austin TX or 68510") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    leadingIcon = { Icon(MaterialIcons.Filled.LocationOn, contentDescription = null, tint = Color.Gray) },
                    trailingIcon = {
                        if (filterCityState.isNotEmpty()) {
                            IconButton(onClick = {
                                filterCityState = ""
                                autocompletePredictions = emptyList()
                            }) {
                                Icon(MaterialIcons.Filled.Clear, contentDescription = "Clear")
                            }
                        }
                    }
                )
                // Autocomplete suggestions dropdown
                if (autocompletePredictions.isNotEmpty()) {
                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = Color.White,
                        tonalElevation = 4.dp,
                        shadowElevation = 4.dp,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column {
                            autocompletePredictions.take(5).forEach { prediction ->
                                Text(
                                    prediction.description,
                                    fontSize = 14.sp,
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clickable {
                                            filterCityState = prediction.description
                                            autocompletePredictions = emptyList()
                                            // Geocode the selected location to get lat/lng
                                            scope.launch {
                                                try {
                                                    val result = service.searchRegion(prediction.description)
                                                    result.regionKey.takeIf { it.isNotBlank() }?.let { adsRegionKeyHint = it }
                                                    val c = result.center
                                                    if (c != null && coordsUsable(c.lat, c.lng)) {
                                                        overrideLat = c.lat
                                                        overrideLng = c.lng
                                                        overrideLocationLabel = prediction.description
                                                    }
                                                } catch (_: Exception) {}
                                            }
                                        }
                                        .padding(horizontal = 12.dp, vertical = 10.dp),
                                    color = Color(0xFF212121)
                                )
                                if (prediction != autocompletePredictions.take(5).last()) {
                                    Divider(color = Color(0xFFEEEEEE))
                                }
                            }
                        }
                    }
                }
                if (overrideLocationLabel != null) {
                    Spacer(Modifier.height(4.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("📍 Searching near: $overrideLocationLabel", fontSize = 12.sp, color = Color(0xFF2E7D32), modifier = Modifier.weight(1f))
                        TextButton(onClick = {
                            overrideLat = null
                            overrideLng = null
                            overrideLocationLabel = null
                            filterCityState = ""
                            settings.putString("filter_search_location", "")
                            saveFilters()
                            performSearch(clearStaleResults = true)
                        }) {
                            Text("Reset to my location", fontSize = 11.sp)
                        }
                    }
                }
                Spacer(Modifier.height(16.dp))
                Divider(color = FormColors.SubtleDivider)
                Spacer(Modifier.height(16.dp))

                // Radius
                Text("Search Radius: ${filterRadius.toInt()} miles", style = MaterialTheme.typography.titleMedium)
                Slider(value = filterRadius, onValueChange = { filterRadius = it }, valueRange = 1f..50f, steps = 10)

                val filterTypeConfig = remember(filterPlaygroundType) {
                    AmenityTypeMapping.getConfigForType(filterPlaygroundType)
                }

                HorizontalDivider(color = FormColors.SubtleDivider, thickness = 1.dp)

                var locationTypeExpanded by remember { mutableStateOf(false) }
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { locationTypeExpanded = !locationTypeExpanded }
                        .padding(top = 12.dp, bottom = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Location Type", style = MaterialTheme.typography.titleMedium)
                        if (!locationTypeExpanded) {
                            Text(
                                filterPlaygroundType ?: "Any type",
                                fontSize = 12.sp,
                                color = FormColors.SecondaryButtonText,
                                maxLines = 1,
                            )
                        }
                    }
                    Icon(
                        if (locationTypeExpanded) MaterialIcons.Filled.ExpandLess else MaterialIcons.Filled.ExpandMore,
                        contentDescription = null,
                        tint = FormColors.AccordionChevronTint,
                    )
                }
                if (locationTypeExpanded) {
                    CategoryTypePicker(
                        selected = filterPlaygroundType,
                        onSelect = { filterPlaygroundType = it },
                        showTitleRow = false,
                    )
                }

                HorizontalDivider(color = FormColors.SubtleDivider, thickness = 1.dp)

                var groundSurfaceExpanded by remember { mutableStateOf(false) }
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { groundSurfaceExpanded = !groundSurfaceExpanded }
                        .padding(top = 4.dp, bottom = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Ground Surface", style = MaterialTheme.typography.titleMedium)
                        if (!groundSurfaceExpanded) {
                            val summary = when {
                                filterGroundTypesInclude.isEmpty() && filterGroundTypesExclude.isEmpty() ->
                                    "Any surface"
                                filterGroundTypesInclude.isEmpty() ->
                                    "Not: ${filterGroundTypesExclude.sorted().joinToString(", ")}"
                                filterGroundTypesExclude.isEmpty() ->
                                    filterGroundTypesInclude.sorted().joinToString(", ")
                                else ->
                                    "${filterGroundTypesInclude.sorted().joinToString(", ")} · not ${filterGroundTypesExclude.sorted().joinToString(", ")}"
                            }
                            Text(
                                summary,
                                fontSize = 12.sp,
                                color = FormColors.SecondaryButtonText,
                                maxLines = 2,
                            )
                        }
                    }
                    Icon(
                        if (groundSurfaceExpanded) MaterialIcons.Filled.ExpandLess else MaterialIcons.Filled.ExpandMore,
                        contentDescription = null,
                        tint = FormColors.AccordionChevronTint,
                    )
                }
                if (groundSurfaceExpanded) {
                    Text(
                        "Has any of (OR)",
                        style = MaterialTheme.typography.labelLarge,
                        color = FormColors.SecondaryButtonText,
                        modifier = Modifier.padding(top = 4.dp, bottom = 6.dp),
                    )
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        groundTypes.forEach { opt ->
                            FilterChip(
                                selected = opt in filterGroundTypesInclude,
                                onClick = {
                                    filterGroundTypesInclude =
                                        if (opt in filterGroundTypesInclude) filterGroundTypesInclude - opt
                                        else {
                                            filterGroundTypesExclude = filterGroundTypesExclude - opt
                                            filterGroundTypesInclude + opt
                                        }
                                },
                                label = { Text(opt) },
                                shape = RoundedCornerShape(20.dp),
                                colors = FilterChipDefaults.filterChipColors(
                                    selectedContainerColor = FormColors.SelectedChip,
                                    selectedLabelColor = FormColors.SelectedChipText,
                                ),
                            )
                        }
                    }
                    Text(
                        "Exclude (no match if listed)",
                        style = MaterialTheme.typography.labelLarge,
                        color = FormColors.SecondaryButtonText,
                        modifier = Modifier.padding(top = 16.dp, bottom = 6.dp),
                    )
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        groundTypes.forEach { opt ->
                            FilterChip(
                                selected = opt in filterGroundTypesExclude,
                                onClick = {
                                    filterGroundTypesExclude =
                                        if (opt in filterGroundTypesExclude) filterGroundTypesExclude - opt
                                        else {
                                            filterGroundTypesInclude = filterGroundTypesInclude - opt
                                            filterGroundTypesExclude + opt
                                        }
                                },
                                label = { Text(opt) },
                                shape = RoundedCornerShape(20.dp),
                                colors = FilterChipDefaults.filterChipColors(
                                    selectedContainerColor = FormColors.SelectedChip,
                                    selectedLabelColor = FormColors.SelectedChipText,
                                ),
                            )
                        }
                    }
                }

                HorizontalDivider(color = FormColors.SubtleDivider, thickness = 1.dp)

                var expenseExpanded by remember { mutableStateOf(false) }
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { expenseExpanded = !expenseExpanded }
                        .padding(top = 4.dp, bottom = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Expense Level", style = MaterialTheme.typography.titleMedium)
                        if (!expenseExpanded) {
                            Text(
                                filterExpense ?: "Any cost",
                                fontSize = 12.sp,
                                color = FormColors.SecondaryButtonText,
                                maxLines = 1,
                            )
                        }
                    }
                    Icon(
                        if (expenseExpanded) MaterialIcons.Filled.ExpandLess else MaterialIcons.Filled.ExpandMore,
                        contentDescription = null,
                        tint = FormColors.AccordionChevronTint,
                    )
                }
                if (expenseExpanded) {
                    FilterSection(
                        title = "Expense Level",
                        options = expenseOptions,
                        selected = filterExpense,
                        onSelect = { filterExpense = it },
                        showTitle = false,
                    )
                }

                HorizontalDivider(color = FormColors.SubtleDivider, thickness = 1.dp)

                // Boolean Toggles — collapsible
                var amenitiesExpanded by remember { mutableStateOf(false) }
                Row(
                    modifier = Modifier.fillMaxWidth().clickable { amenitiesExpanded = !amenitiesExpanded }.padding(top = 24.dp, bottom = 12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("Must Have Amenities", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                    Icon(if (amenitiesExpanded) MaterialIcons.Filled.ExpandLess else MaterialIcons.Filled.ExpandMore, contentDescription = null, tint = FormColors.AccordionChevronTint)
                }
                if (amenitiesExpanded) {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if ("Bathrooms" in filterTypeConfig.visibleAmenities) AmenityToggle("Bathrooms", filterHasBathrooms) { filterHasBathrooms = it }
                        if ("Shade" in filterTypeConfig.visibleAmenities) AmenityToggle("Shade", filterHasShade) { filterHasShade = it }
                        if ("Fenced" in filterTypeConfig.visibleAmenities) AmenityToggle("Fenced", filterIsFenced) { filterIsFenced = it }
                        if ("Toddler Friendly" in filterTypeConfig.visibleAmenities) AmenityToggle("Toddler Friendly", filterIsToddlerFriendly) { filterIsToddlerFriendly = it }
                        if ("Dog Friendly" in filterTypeConfig.visibleAmenities) AmenityToggle("Dog Friendly", filterIsDogFriendly) { filterIsDogFriendly = it }
                        if ("Accessible" in filterTypeConfig.visibleAmenities) AmenityToggle("Accessible", filterIsAccessible) { filterIsAccessible = it }
                        if ("Parking" in filterTypeConfig.visibleAmenities) AmenityToggle("Parking", filterHasParking) { filterHasParking = it }
                        if ("WiFi" in filterTypeConfig.visibleAmenities) AmenityToggle("Wi-Fi", filterHasWifi) { filterHasWifi = it }
                        if ("Splash Pad" in filterTypeConfig.visibleAmenities) AmenityToggle("Splash Pad", filterHasSplashPad) { filterHasSplashPad = it }
                        if ("Picnic Tables" in filterTypeConfig.visibleAmenities) AmenityToggle("Picnic Tables", filterHasPicnicTables) { filterHasPicnicTables = it }
                        if ("Benches" in filterTypeConfig.visibleAmenities) AmenityToggle("Benches", filterHasBenches) { filterHasBenches = it }
                        if ("Water Fountain" in filterTypeConfig.visibleAmenities) AmenityToggle("Water Fountain", filterHasWaterFountain) { filterHasWaterFountain = it }
                        if ("Walking Trail" in filterTypeConfig.visibleAmenities) AmenityToggle("Walking Trail", filterHasWalkingTrail) { filterHasWalkingTrail = it }
                        if ("Trash Cans" in filterTypeConfig.visibleAmenities) AmenityToggle("Trash Cans", filterHasTrashCans) { filterHasTrashCans = it }
                    }

                    // Requirements
                    if ("Requires Grip Socks" in filterTypeConfig.visibleAmenities || "Requires Waiver" in filterTypeConfig.visibleAmenities) {
                        Text("Requirements", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 16.dp, bottom = 8.dp))
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            if ("Requires Grip Socks" in filterTypeConfig.visibleAmenities) AmenityToggle("Needs Grip Socks", filterNeedsGripSocks) { filterNeedsGripSocks = it }
                            if ("Requires Waiver" in filterTypeConfig.visibleAmenities) AmenityToggle("Requires Waiver", filterRequiresWaiver) { filterRequiresWaiver = it }
                        }
                    }
                }

                // Equipment — collapsible (hidden when all equipment booleans are false)
                val showEquipmentSection = filterTypeConfig.showPlaygroundEquipment || filterTypeConfig.showSwingTypes || filterTypeConfig.showSportsCourts || filterTypeConfig.showExerciseEquipment
                if (showEquipmentSection) {
                    HorizontalDivider(color = FormColors.SubtleDivider, thickness = 1.dp)

                    var equipmentExpanded by remember { mutableStateOf(false) }
                    Row(
                        modifier = Modifier.fillMaxWidth().clickable { equipmentExpanded = !equipmentExpanded }.padding(top = 24.dp, bottom = 12.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("Playground Equipment", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                        Icon(if (equipmentExpanded) MaterialIcons.Filled.ExpandLess else MaterialIcons.Filled.ExpandMore, contentDescription = null, tint = FormColors.AccordionChevronTint)
                    }
                    if (equipmentExpanded) {
                        if (filterTypeConfig.showPlaygroundEquipment) {
                            Text("Playground Equipment Types", fontWeight = FontWeight.SemiBold, fontSize = 14.sp, modifier = Modifier.padding(bottom = 8.dp))
                            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                equipmentOptions.forEach { eq ->
                                    FilterChip(
                                        selected = selectedEquipment.contains(eq),
                                        onClick = { selectedEquipment = if (selectedEquipment.contains(eq)) selectedEquipment - eq else selectedEquipment + eq },
                                        label = { Text(eq) },
                                        colors = FilterChipDefaults.filterChipColors(selectedContainerColor = FormColors.SelectedChip, selectedLabelColor = FormColors.SelectedChipText)
                                    )
                                }
                            }
                        }

                        if (filterTypeConfig.showSwingTypes) {
                            Text("Swing Types", fontWeight = FontWeight.SemiBold, fontSize = 14.sp, modifier = Modifier.padding(top = 16.dp, bottom = 8.dp))
                            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                swingOptions.forEach { s ->
                                    FilterChip(
                                        selected = selectedSwings.contains(s),
                                        onClick = { selectedSwings = if (selectedSwings.contains(s)) selectedSwings - s else selectedSwings + s },
                                        label = { Text(s) },
                                        colors = FilterChipDefaults.filterChipColors(selectedContainerColor = FormColors.SelectedChip, selectedLabelColor = FormColors.SelectedChipText)
                                    )
                                }
                            }
                        }

                        if (filterTypeConfig.showSportsCourts) {
                            Text("Sports Courts / Fields", fontWeight = FontWeight.SemiBold, fontSize = 14.sp, modifier = Modifier.padding(top = 16.dp, bottom = 8.dp))
                            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                sportOptions.forEach { sport ->
                                    FilterChip(
                                        selected = selectedExercise.contains(sport),
                                        onClick = { selectedExercise = if (selectedExercise.contains(sport)) selectedExercise - sport else selectedExercise + sport },
                                        label = { Text(sport) },
                                        colors = FilterChipDefaults.filterChipColors(selectedContainerColor = FormColors.SelectedChip, selectedLabelColor = FormColors.SelectedChipText)
                                    )
                                }
                            }
                        }

                        if (filterTypeConfig.showExerciseEquipment) {
                            Text("Exercise Equipment", fontWeight = FontWeight.SemiBold, fontSize = 14.sp, modifier = Modifier.padding(top = 16.dp, bottom = 8.dp))
                            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                exerciseOptions.forEach { ex ->
                                    FilterChip(
                                        selected = selectedEquipment.contains(ex),
                                        onClick = { selectedEquipment = if (selectedEquipment.contains(ex)) selectedEquipment - ex else selectedEquipment + ex },
                                        label = { Text(ex) },
                                        colors = FilterChipDefaults.filterChipColors(selectedContainerColor = FormColors.SelectedChip, selectedLabelColor = FormColors.SelectedChipText)
                                    )
                                }
                            }
                        }
                    }
                } // end showEquipmentSection

                Spacer(Modifier.height(32.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    OutlinedButton(
                        onClick = {
                            searchQuery = ""
                            settings.putString("home_search_query", "")
                            overrideLat = null
                            overrideLng = null
                            overrideLocationLabel = null
                            lastResolvedLocationQuery = ""
                            filterCityState = ""
                            settings.putString("filter_search_location", "")
                            filterPlaygroundType = null
                            filterGroundTypesInclude = emptySet()
                            filterGroundTypesExclude = emptySet()
                            filterExpense = null
                            filterHasBathrooms = false; filterHasShade = false; filterIsFenced = false
                            filterIsToddlerFriendly = false; filterIsDogFriendly = false; filterIsAccessible = false
                            filterHasParking = false; filterHasWifi = false; filterNeedsGripSocks = false
                            filterRequiresWaiver = false; filterHasPicnicTables = false; filterHasBenches = false
                            filterHasTrashCans = false; filterHasSplashPad = false; filterHasWaterFountain = false
                            filterHasWalkingTrail = false
                            selectedEquipment = emptySet(); selectedExercise = emptySet(); selectedSwings = emptySet()
                            showFilterSheet = false
                            pendingNavigateToMapAfterFilter = false
                            performSearch(clearStaleResults = true, resetToGps = true)
                        },
                        modifier = Modifier.weight(1f).height(56.dp),
                        shape = RoundedCornerShape(16.dp),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = Color(0xFF00CED1))
                    ) {
                        Icon(MaterialIcons.Filled.Clear, null)
                        Spacer(Modifier.width(4.dp))
                        Text("Clear All", fontWeight = FontWeight.Bold)
                    }
                    Button(
                        onClick = {
                            val pendingCity = filterCityState.trim()
                            if (pendingCity.isNotBlank()) {
                                overrideLocationLabel = pendingCity
                                settings.putString("filter_search_location", pendingCity)
                            }
                            val goMap = pendingNavigateToMapAfterFilter
                            showFilterSheet = false
                            performSearch(clearStaleResults = true, navigateToMapWhenDone = goMap)
                        },
                        modifier = Modifier.weight(2f).height(56.dp),
                        shape = RoundedCornerShape(16.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF00CED1))
                    ) {
                        Icon(MaterialIcons.Filled.Search, null)
                        Spacer(Modifier.width(8.dp))
                        Text("Apply & Search", fontWeight = FontWeight.Bold, color = Color.White)
                    }
                }
                Spacer(Modifier.height(48.dp))
            }
        }
    }

    Box(modifier = Modifier.fillMaxSize().background(
        Brush.verticalGradient(listOf(Color(0xFF00CED1), Color(0xFF40B5AD)))
    )) {
        // Do not use fillMaxSize() on this Column: it breaks LazyRow measurement (unbounded height → carousel often draws 0px tall).
        Column(modifier = Modifier.fillMaxWidth().verticalScroll(rememberScrollState())) {
            // 1. RESTORED HEADER
            Box(modifier = Modifier.fillMaxWidth().background(Color(0xFF5E5E5E))) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("Ready for Adventure?", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.ExtraBold, color = Color.White, modifier = Modifier.weight(1f))

                IconButton(
                    onClick = { homeMoreMenuExpanded = true },
                    modifier = Modifier
                        .onGloballyPositioned { coords ->
                            val pos = coords.positionInWindow()
                            moreMenuAnchorWindowPos = IntOffset(pos.x.roundToInt(), pos.y.roundToInt())
                            moreMenuAnchorSizePx = IntSize(coords.size.width, coords.size.height)
                        }
                ) {
                    Icon(
                        MaterialIcons.Filled.Menu,
                        contentDescription = "More",
                        tint = Color.White
                    )
                }
                // Use a Popup anchored to the actual 3-bars button position.
                // This avoids Material3 DropdownMenu anchoring quirks across versions.
                if (homeMoreMenuExpanded && moreMenuAnchorWindowPos != null && moreMenuAnchorSizePx != null) {
                    val anchorPos = moreMenuAnchorWindowPos!!
                    val anchorSize = moreMenuAnchorSizePx!!
                    val density = LocalDensity.current
                    val yNudgePx = with(density) { (-70.dp).roundToPx() }
                    Popup(
                        offset = IntOffset(anchorPos.x, anchorPos.y + anchorSize.height + yNudgePx),
                        properties = PopupProperties(focusable = true),
                        onDismissRequest = { homeMoreMenuExpanded = false }
                    ) {
                        Surface(
                            shape = RoundedCornerShape(12.dp),
                            color = Color.White,
                            shadowElevation = 8.dp,
                            tonalElevation = 6.dp
                        ) {
                            Column(modifier = Modifier.widthIn(min = 220.dp, max = 280.dp)) {
                                MoreMenuItem(
                                    label = "My Favorites & Lists",
                                    enabled = true,
                                    onClick = {
                                        homeMoreMenuExpanded = false
                                        onNavigateToLists()
                                    }
                                )
                                MoreMenuItem(
                                    label = "My Submissions",
                                    enabled = true,
                                    onClick = {
                                        homeMoreMenuExpanded = false
                                        onNavigateToMySubmissions()
                                    }
                                )
                                MoreMenuItem(
                                    label = "My Ads",
                                    enabled = true,
                                    onClick = {
                                        homeMoreMenuExpanded = false
                                        onNavigateToMyAds()
                                    }
                                )
                                MoreMenuItem(
                                    label = "Advertising (website)",
                                    enabled = true,
                                    onClick = {
                                        homeMoreMenuExpanded = false
                                        openExternalUrl(MarketingLinks.advertiserLanding())
                                    }
                                )
                                MoreMenuItem(
                                    label = "Contact / Support",
                                    enabled = true,
                                    onClick = {
                                        homeMoreMenuExpanded = false
                                        onNavigateToSupportTicket()
                                    }
                                )
                                MoreMenuItem(
                                    label = "Terms & Privacy",
                                    enabled = true,
                                    onClick = {
                                        homeMoreMenuExpanded = false
                                        onNavigateToPrivacy()
                                    }
                                )
                                if (isAdmin) {
                                    MoreMenuItem(
                                        label = "Admin Hub",
                                        enabled = true,
                                        onClick = {
                                            homeMoreMenuExpanded = false
                                            onNavigateToAdminHub()
                                        }
                                    )
                                }
                                MoreMenuItem(
                                    label = "Log out",
                                    enabled = true,
                                    onClick = {
                                        homeMoreMenuExpanded = false
                                        onLogout()
                                    }
                                )
                            }
                        }
                    }
                }
            }
            } // end header Box

            // Email verification banner — only for email/password users who haven't verified
            if (!isEmailVerified) {
                var bannerDismissed by remember { mutableStateOf(false) }
                if (!bannerDismissed) {
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        color = Color(0xFFFFF3E0),
                        shadowElevation = 2.dp
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                "Please verify your email address. Check your inbox for a verification link.",
                                color = Color(0xFFE65100),
                                fontSize = 13.sp,
                                modifier = Modifier.weight(1f),
                                lineHeight = 18.sp
                            )
                            TextButton(onClick = { onResendVerification() }) {
                                Text("Resend Email", color = Color(0xFFE65100), fontSize = 12.sp, fontWeight = FontWeight.Bold)
                            }
                            TextButton(onClick = { bannerDismissed = true }) {
                                Text("Dismiss", color = Color(0xFFE65100), fontSize = 12.sp)
                            }
                        }
                    }
                }
            }

            Spacer(Modifier.height(12.dp))

            // 2. SEARCH BAR & FILTER BUTTON
            Card(
                modifier = Modifier.padding(horizontal = 24.dp).fillMaxWidth().shadow(8.dp, RoundedCornerShape(24.dp)),
                shape = RoundedCornerShape(24.dp),
                colors = CardDefaults.cardColors(containerColor = Color.White)
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    OutlinedTextField(
                        value = searchQuery,
                        onValueChange = {
                            searchQuery = it
                            settings.putString("home_search_query", it)
                        },
                        placeholder = { Text("Search for amenities or play places...", color = Color.Gray) },
                        modifier = Modifier.weight(1f),
                        leadingIcon = { Icon(MaterialIcons.Filled.Search, null, tint = Color.Gray) },
                        shape = RoundedCornerShape(24.dp),
                        singleLine = true,
                        textStyle = LocalTextStyle.current.copy(fontSize = 15.sp),
                        colors = TextFieldDefaults.colors(
                            focusedContainerColor = Color.Transparent,
                            unfocusedContainerColor = Color.Transparent,
                            focusedIndicatorColor = Color.Transparent,
                            unfocusedIndicatorColor = Color.Transparent
                        )
                    )
                    IconButton(
                        onClick = { showFilterSheet = true },
                        modifier = Modifier
                            .size(44.dp)
                            .background(MaterialTheme.colorScheme.primary, CircleShape)
                    ) {
                        Icon(MaterialIcons.Filled.Tune, contentDescription = "Filters", tint = Color.White)
                    }
                }
            }

            // 3. SECTION HEADER
            val isSeedingState = nearbyPlaygrounds.isEmpty() && searchMessage.contains("first in your area")
            val isRemoteSeeding =
                nearbyPlaygrounds.isEmpty() && searchMessage.contains("Loading play places", ignoreCase = true)
            Text(
                when {
                    isSeedingState -> "Mapping Your City"
                    isRemoteSeeding -> "Loading This Area"
                    nearbyPlaygrounds.isEmpty() && isSearching -> "Finding Play Places..."
                    else -> "Popular Near You"
                },
                color = Color.White,
                modifier = Modifier.padding(start = 24.dp, top = 12.dp, bottom = 8.dp),
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold
            )
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 24.dp)
                    .padding(bottom = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    activeFilterSummary(),
                    color = Color.White.copy(alpha = 0.85f),
                    fontSize = 12.sp,
                    modifier = Modifier.weight(1f),
                )
                TextButton(
                    onClick = {
                        searchQuery = ""
                        settings.putString("home_search_query", "")
                        overrideLat = null
                        overrideLng = null
                        overrideLocationLabel = null
                        lastResolvedLocationQuery = ""
                        filterCityState = ""
                        settings.putString("filter_search_location", "")
                        filterPlaygroundType = null
                        filterGroundTypesInclude = emptySet()
                        filterGroundTypesExclude = emptySet()
                        filterExpense = null
                        filterHasBathrooms = false
                        filterHasShade = false
                        filterIsFenced = false
                        filterIsToddlerFriendly = false
                        filterIsDogFriendly = false
                        filterIsAccessible = false
                        filterHasParking = false
                        filterHasWifi = false
                        filterNeedsGripSocks = false
                        filterRequiresWaiver = false
                        filterHasPicnicTables = false
                        filterHasBenches = false
                        filterHasTrashCans = false
                        filterHasSplashPad = false
                        filterHasWaterFountain = false
                        filterHasWalkingTrail = false
                        selectedEquipment = emptySet()
                        selectedExercise = emptySet()
                        selectedSwings = emptySet()
                        performSearch(clearStaleResults = true, resetToGps = true)
                    },
                ) {
                    Text("Clear filters", color = Color.White, fontSize = 12.sp)
                }
            }

            // Seeding / loading state card
            if (isSeedingState) {
                val infiniteTransition = rememberInfiniteTransition(label = "seed_pulse")
                val pulse by infiniteTransition.animateFloat(
                    initialValue = 0.4f,
                    targetValue = 1f,
                    animationSpec = infiniteRepeatable(
                        animation = tween(900, easing = LinearEasing),
                        repeatMode = RepeatMode.Reverse
                    ),
                    label = "pulse_alpha"
                )

                Surface(
                    modifier = Modifier.padding(horizontal = 24.dp, vertical = 4.dp).fillMaxWidth(),
                    color = Color.White.copy(alpha = 0.15f),
                    shape = RoundedCornerShape(20.dp)
                ) {
                    Column(
                        modifier = Modifier.padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Box(
                                modifier = Modifier
                                    .size(10.dp)
                                    .background(Color(0xFF4CAF50).copy(alpha = pulse), CircleShape)
                            )
                            Text(
                                "We're mapping play places in your city!",
                                color = Color.White,
                                fontWeight = FontWeight.SemiBold,
                                fontSize = 15.sp
                            )
                        }
                        Text(
                            "This usually takes about a minute. Results will appear automatically — no need to refresh.",
                            color = Color.White.copy(alpha = 0.8f),
                            fontSize = 13.sp,
                            lineHeight = 18.sp
                        )
                        LinearProgressIndicator(
                            modifier = Modifier.fillMaxWidth(),
                            color = Color(0xFF4CAF50),
                            trackColor = Color.White.copy(alpha = 0.2f)
                        )
                        Button(
                            onClick = onNavigateToAdd,
                            colors = ButtonDefaults.buttonColors(containerColor = Color.White.copy(alpha = 0.2f)),
                            shape = RoundedCornerShape(12.dp),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Icon(MaterialIcons.Filled.Add, contentDescription = null, tint = Color.White, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Be the first to add a place!", color = Color.White, fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
            } else if (isRemoteSeeding) {
                val infiniteTransition = rememberInfiniteTransition(label = "remote_seed_pulse")
                val pulseR by infiniteTransition.animateFloat(
                    initialValue = 0.4f,
                    targetValue = 1f,
                    animationSpec = infiniteRepeatable(
                        animation = tween(900, easing = LinearEasing),
                        repeatMode = RepeatMode.Reverse
                    ),
                    label = "remote_pulse_alpha"
                )
                Surface(
                    modifier = Modifier.padding(horizontal = 24.dp, vertical = 4.dp).fillMaxWidth(),
                    color = Color.White.copy(alpha = 0.15f),
                    shape = RoundedCornerShape(20.dp)
                ) {
                    Column(
                        modifier = Modifier.padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Box(
                                modifier = Modifier
                                    .size(10.dp)
                                    .background(Color(0xFF00E5FF).copy(alpha = pulseR), CircleShape)
                            )
                            Text(
                                "Loading play places",
                                color = Color.White,
                                fontWeight = FontWeight.SemiBold,
                                fontSize = 15.sp
                            )
                        }
                        Text(
                            searchMessage,
                            color = Color.White.copy(alpha = 0.88f),
                            fontSize = 13.sp,
                            lineHeight = 18.sp
                        )
                        LinearProgressIndicator(
                            modifier = Modifier.fillMaxWidth(),
                            color = Color(0xFF00E5FF),
                            trackColor = Color.White.copy(alpha = 0.2f)
                        )
                    }
                }
            } else if (searchMessage.isNotEmpty()) {
                var showLocationHelp by remember { mutableStateOf(false) }
                val isLocationIssue = searchMessage.contains("location", ignoreCase = true) || searchMessage.contains("Browsing without", ignoreCase = true)
                Surface(
                    modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp).fillMaxWidth(),
                    color = Color.White.copy(alpha = 0.15f),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Column(modifier = Modifier.padding(12.dp)) {
                        Text(searchMessage, color = Color.White, style = MaterialTheme.typography.bodySmall)
                        if (isLocationIssue) {
                            Spacer(Modifier.height(4.dp))
                            Text(
                                if (showLocationHelp) "Hide tips \u25B2" else "Having trouble? Tap for tips \u25BC",
                                color = Color.White.copy(alpha = 0.8f),
                                fontSize = 12.sp,
                                modifier = Modifier.clickable { showLocationHelp = !showLocationHelp }.padding(vertical = 4.dp),
                            )
                            if (showLocationHelp) {
                                Spacer(Modifier.height(4.dp))
                                Text(
                                    "\u2022 Make sure Location (GPS) is turned on in your phone's quick settings\n" +
                                    "\u2022 Turn off Battery Saver / Power Saving mode\n" +
                                    "\u2022 Go to Settings \u2192 Apps \u2192 PlayPlace Finder \u2192 Permissions \u2192 Location \u2192 Allow\n" +
                                    "\u2022 Try stepping outside or near a window for better GPS signal\n" +
                                    "\u2022 Restart the app after changing settings",
                                    color = Color.White.copy(alpha = 0.9f),
                                    fontSize = 11.sp,
                                    lineHeight = 16.sp,
                                )
                            }
                        }
                    }
                }
            }

            // Prefer the region from current results so ads match what the user is viewing. Persisted key is
            // only a fallback when lists are empty mid-load (avoids flashing); it must not override a stale
            // saved key after the user moves or searches elsewhere — that previously required "Clear filters".
            val discoverCityId = remember(nearbyPlaygrounds, syncedResults, adsRegionKeyHint) {
                val persisted = settings.getString("home_ads_region_key", "").trim().takeIf { it.isNotBlank() }
                sequenceOf(
                    nearbyPlaygrounds.firstOrNull()?.regionKey,
                    syncedResults.firstOrNull()?.regionKey,
                    adsRegionKeyHint,
                    persisted,
                ).mapNotNull { it?.trim()?.takeIf { k -> k.isNotBlank() } }.firstOrNull()
            }
            LaunchedEffect(adsRegionKeyHint) {
                val k = adsRegionKeyHint?.trim().orEmpty()
                if (k.isNotBlank()) {
                    try {
                        settings.putString("home_ads_region_key", k)
                    } catch (_: Exception) {
                    }
                }
            }
            var inlineListingAdsResponse by remember { mutableStateOf<AllAdsResponse?>(null) }
            LaunchedEffect(discoverCityId) {
                if (discoverCityId.isNullOrBlank()) {
                    inlineListingAdsResponse = null
                } else {
                    try {
                        settings.putString("home_ads_region_key", discoverCityId)
                    } catch (_: Exception) {}
                    inlineListingAdsResponse = try {
                        service.getAllAds(discoverCityId, "inline_listing")
                    } catch (_: Exception) {
                        null
                    }
                }
            }
            if (isSearching && nearbyPlaygrounds.isEmpty() && !isSeedingState && !isRemoteSeeding) {
                Column(
                    modifier = Modifier.fillMaxWidth().height(160.dp).padding(horizontal = 24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Text(
                        "Loading play places near you",
                        color = Color.White,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 15.sp,
                    )
                    Spacer(Modifier.height(12.dp))
                    CircularProgressIndicator(color = Color.White)
                }
            } else if (!isSeedingState && !isRemoteSeeding) {
                // Bounded height required when this LazyRow sits inside a vertically scrollable Column.
                LazyRow(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = HomeDiscoverPlaygroundCardMinTotalHeight),
                    state = popularNearYouListState,
                    contentPadding = PaddingValues(horizontal = 24.dp),
                    horizontalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    items(
                        items = nearbyPlaygrounds,
                        key = { place ->
                            place.id?.takeIf { it.isNotBlank() }
                                ?: "${place.name}_${place.latitude}_${place.longitude}"
                        },
                    ) { place ->
                        // Fixed height so carousel tiles share a consistent row height.
                        Column(
                            modifier = Modifier
                                .width(300.dp)
                                .height(HomeDiscoverPlaygroundCardMinTotalHeight)
                                .clickable { onNavigateToDetail(place) },
                        ) {
                            Box {
                                if (place.imageUrls.isNotEmpty()) {
                                    AsyncImage(
                                        model = place.imageUrls.first(),
                                        contentDescription = null,
                                        modifier = Modifier.fillMaxWidth().height(HomeDiscoverHeroImageHeight).clip(RoundedCornerShape(24.dp)),
                                        contentScale = androidx.compose.ui.layout.ContentScale.Crop
                                    )
                                } else {
                                    Box(
                                        modifier = Modifier.fillMaxWidth().height(HomeDiscoverHeroImageHeight).clip(RoundedCornerShape(24.dp)).background(Color.White),
                                        contentAlignment = Alignment.Center
                                    ) {
                                        Image(
                                            painter = playgroundPlaceholderPainter(place.playgroundType),
                                            contentDescription = place.playgroundType ?: "Play Place",
                                            modifier = Modifier.fillMaxSize(),
                                            contentScale = ContentScale.FillWidth
                                        )
                                    }
                                }
                                Surface(
                                    modifier = Modifier.padding(12.dp).align(Alignment.TopEnd),
                                    shape = CircleShape,
                                    color = Color.White.copy(alpha = 0.8f)
                                ) {
                                    val isFav = favoritedIds.contains(place.id) || place.isFavorited
                                    Icon(if (isFav) MaterialIcons.Filled.Favorite else MaterialIcons.Filled.FavoriteBorder, null, modifier = Modifier.padding(8.dp).size(20.dp), tint = Color.Red)
                                }
                            }
                            Spacer(Modifier.height(HomeDiscoverCardBelowHeroSpacing))
                            Column(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .weight(1f),
                                verticalArrangement = Arrangement.Top,
                            ) {
                                Text(place.name, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = Color.White, maxLines = 1)

                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(place.playgroundType ?: "Public", color = Color.White.copy(alpha = 0.7f), fontSize = 14.sp)
                                    if (userLat != null && userLng != null && place.latitude != 0.0) {
                                        val distance = calculateDistance(userLat!!, userLng!!, place.latitude, place.longitude)
                                        Text(" • ${((distance * 10.0).roundToInt() / 10.0)} mi away", color = Color.White.copy(alpha = 0.7f), fontSize = 14.sp)
                                    }
                                }
                                if (place.subVenues.isNotEmpty()) {
                                    Text(
                                        "Includes ${place.subVenues.size} areas",
                                        fontSize = 12.sp,
                                        color = Color.White.copy(alpha = 0.88f),
                                        modifier = Modifier.padding(top = 4.dp),
                                    )
                                }

                                val placeListNames = listMembership[place.id] ?: emptyList()
                                val isFav = favoritedIds.contains(place.id) || place.isFavorited
                                if (isFav || placeListNames.isNotEmpty()) {
                                    Row(
                                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                                        modifier = Modifier.padding(top = 4.dp)
                                    ) {
                                        if (isFav) {
                                            Surface(shape = RoundedCornerShape(6.dp), color = Color(0xFFFCE4EC).copy(alpha = 0.9f)) {
                                                Row(modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                                                    Icon(MaterialIcons.Filled.Favorite, null, modifier = Modifier.size(10.dp), tint = Color(0xFFF06292))
                                                    Spacer(Modifier.width(2.dp))
                                                    Text("Favorite", fontSize = 10.sp, color = Color(0xFFC62828))
                                                }
                                            }
                                        }
                                        placeListNames.forEach { (name, chipColor) ->
                                            val parsedColor = chipColor?.let { parseHexColor(it) }
                                            val bgColor = parsedColor?.copy(alpha = 0.85f) ?: FormColors.ListChipDefaultBg
                                            val textColor = when {
                                                parsedColor != null && isColorDark(parsedColor) -> Color.White
                                                parsedColor != null -> Color(0xFF212121)
                                                else -> FormColors.ListChipDefaultFg
                                            }
                                            Surface(shape = RoundedCornerShape(6.dp), color = bgColor) {
                                                Text(name, fontSize = 10.sp, color = textColor, modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp))
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // --- Featured Ad Slot ---
            Spacer(Modifier.height(16.dp))
            Box(modifier = Modifier.padding(horizontal = 24.dp)) {
                FeaturedAdCard(
                    service = service,
                    cityId = discoverCityId,
                    onAdClick = onAdClick,
                    onNavigateToAdvertise = onNavigateToAdvertise,
                    userLat = userLat,
                    userLng = userLng,
                )
            }

            // 4. QUICK ACTIONS — use same region key as inline ads ([discoverCityId]); the first carousel row
            // may lack regionKey after text search while persisted/hint still resolves ads.
            val eventsRegionKey = discoverCityId.orEmpty()
            val pgForEventsLabel = syncedResults.firstOrNull { it.regionKey?.trim().orEmpty() == discoverCityId }
                ?: nearbyPlaygrounds.firstOrNull { it.regionKey?.trim().orEmpty() == discoverCityId }
                ?: syncedResults.firstOrNull()
                ?: nearbyPlaygrounds.firstOrNull()
            val eventsRegionLabel = listOfNotNull(pgForEventsLabel?.city, pgForEventsLabel?.state)
                .filter { !it.isNullOrBlank() }
                .joinToString(", ")
                .ifBlank { "Your area" }
            Row(modifier = Modifier.padding(24.dp).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                CategoryAction(MaterialIcons.Filled.Map, "Interactive Map", Color.White, Color(0xFF00CED1), Modifier.weight(1f)) {
                    onNavigateToMap(syncedResults.ifEmpty { nearbyPlaygrounds }, activeFilterSummary())
                }
                CategoryAction(MaterialIcons.Filled.List, "All Sites", Color.White, Color(0xFF00CED1), Modifier.weight(1f)) {
                    onNavigateToAll(syncedResults.ifEmpty { nearbyPlaygrounds }, activeFilterSummary())
                }
            }
            Row(
                modifier = Modifier.padding(horizontal = 24.dp).padding(bottom = 24.dp).fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                CategoryAction(
                    MaterialIcons.Filled.Event,
                    "Events near you",
                    Color.White,
                    Color(0xFF00CED1),
                    Modifier.fillMaxWidth(),
                ) {
                    val preloaded = inlineListingAdsResponse?.takeIf { discoverCityId.isNullOrBlank().not() }
                    onNavigateToNearbyEvents(eventsRegionKey, eventsRegionLabel, preloaded)
                }
            }

            // 9.10 — City Completion Meter
            cityCompletion?.let { completion ->
                CityCompletionMeter(completion, modifier = Modifier.padding(horizontal = 24.dp).fillMaxWidth())
                Spacer(Modifier.height(8.dp))
            }

            Spacer(Modifier.height(8.dp))

            if (showAboutDialog) {
                AlertDialog(
                    onDismissRequest = { showAboutDialog = false },
                    title = { Text("About Play Place Finder") },
                    text = { Text("About content coming soon. For now, review the policy from the menu.") },
                    confirmButton = {
                        TextButton(onClick = { showAboutDialog = false }) {
                            Text("OK")
                        }
                    }
                )
            }

            Spacer(Modifier.height(100.dp))
        }

        // Floating Action Button — dark gray so it doesn’t blend with the teal “All Sites” tile
        FloatingActionButton(
            onClick = onNavigateToAdd,
            modifier = Modifier.align(Alignment.BottomEnd).padding(24.dp),
            containerColor = Color(0xFF424242),
            shape = RoundedCornerShape(16.dp)
        ) {
            Icon(
                MaterialIcons.Filled.Add,
                contentDescription = "Submit New Play Place",
                tint = Color.White,
            )
        }
    }
}

@Composable
private fun MoreMenuItem(
    label: String,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    Text(
        text = label,
        modifier = Modifier
            .clickable(enabled = enabled) { onClick() }
            .padding(horizontal = 16.dp, vertical = 12.dp),
        color = if (enabled) Color(0xFF212121) else Color(0xFF212121).copy(alpha = 0.4f),
        style = MaterialTheme.typography.bodyMedium
    )
}

@Composable
fun CategoryAction(icon: ImageVector, label: String, backgroundColor: Color, contentColor: Color = Color.White, modifier: Modifier = Modifier, onClick: () -> Unit = {}) {
    Surface(
        modifier = modifier.height(100.dp).clickable(onClick = onClick),
        shape = RoundedCornerShape(24.dp),
        color = backgroundColor
    ) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(icon, null, modifier = Modifier.size(32.dp), tint = contentColor)
            Spacer(Modifier.height(8.dp))
            Text(label, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold, color = contentColor)
        }
    }
}

// 9.10 — City Completion Meter composable
@Composable
fun CityCompletionMeter(
    completion: PlaygroundService.CityCompletion,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(16.dp),
        color = Color.White.copy(alpha = 0.15f)
    ) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    "${completion.regionKey} Map Completion",
                    color = Color.White,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 13.sp
                )
                Text(
                    "${completion.completionPercent}%",
                    color = Color.White,
                    fontWeight = FontWeight.Bold,
                    fontSize = 13.sp
                )
            }
            LinearProgressIndicator(
                progress = { completion.completionPercent / 100f },
                modifier = Modifier.fillMaxWidth(),
                color = Color(0xFF4CAF50),
                trackColor = Color.White.copy(alpha = 0.3f),
            )
            Text(
                "${completion.verifiedPlaces} of ${completion.totalPlaces} places verified",
                color = Color.White.copy(alpha = 0.75f),
                fontSize = 11.sp
            )
        }
    }
}

private fun playgroundSearchHaystack(p: Playground): String = buildString {
    append(p.name)
    append(' ')
    append(p.description)
    append(' ')
    p.playgroundType?.let { append(it); append(' ') }
    p.groundType?.let { append(it); append(' ') }
    p.costRange?.let { append(it); append(' ') }
    p.expense?.let { append(it); append(' ') }
    p.costToEnter?.let { append(it); append(' ') }
    p.ageRange?.let { append(it); append(' ') }
    p.address?.let { append(it); append(' ') }
    p.city?.let { append(it); append(' ') }
    p.normalizedCitySlug?.let { append(it); append(' ') }
    p.state?.let { append(it); append(' ') }
    p.zipCode?.let { append(it); append(' ') }
    p.crossStreets?.let { append(it); append(' ') }
    p.parentVenueName?.let { append(it); append(' ') }
    p.phoneNumber?.let { append(it); append(' ') }
    p.website?.let { append(it); append(' ') }
    p.hours?.let { append(it); append(' ') }
    p.crowdLevel?.let { append(it); append(' ') }
    p.badges.forEach { append(it); append(' ') }
    p.equipment.forEach { append(it); append(' ') }
    p.swingTypes.forEach { append(it); append(' ') }
    p.sportsCourts.forEach { append(it); append(' ') }
    p.exerciseEquipment.forEach { append(it); append(' ') }
    p.subVenues.forEach { sv ->
        append(sv.name)
        append(' ')
        sv.playgroundType?.let { append(it); append(' ') }
        sv.features.forEach { append(it); append(' ') }
        sv.equipment.forEach { append(it); append(' ') }
    }
    fun tri(label: String, v: Boolean?) {
        when (v) {
            true -> {
                append(label)
                append(' ')
            }
            false -> {
                append("no ")
                append(label.lowercase())
                append(' ')
            }
            null -> {}
        }
    }
    tri("Playground", p.hasPlayground)
    tri("Bathrooms", p.hasBathrooms)
    tri("Shade", p.hasShade)
    tri("Fenced", p.isFenced)
    tri("Toddler Friendly", p.isToddlerFriendly)
    tri("Dog Friendly", p.isDogFriendly)
    tri("Parking", p.hasParking)
    tri("Splash Pad", p.hasSplashPad)
    tri("Accessible", p.isAccessible)
    tri("WiFi", p.hasWifi)
    tri("Walking Trail", p.hasWalkingTrail)
    tri("Water Fountain", p.hasWaterFountain)
    tri("Benches", p.hasBenches)
    tri("Picnic Tables", p.hasPicnicTables)
    tri("Trash Cans", p.hasTrashCans)
    tri("Grip Socks", p.needsGripSocks)
    tri("Waiver", p.requiresWaiver)
    tri("Outdoor Shower", p.hasOutdoorShower)
    tri("Changing Rooms", p.hasChangingRooms)
    tri("Lockers", p.hasLockers)
    tri("Nursing Room", p.hasNursingRoom)
    tri("Party Room", p.hasPartyRoom)
    tri("Covered Seating", p.hasCoveredSeating)
    tri("Food Services", p.hasFoodServices)
    tri("Snack Bar", p.hasSnackBar)
    tri("Alcohol On Site", p.hasAlcoholOnSite)
    tri("Gift Shop", p.hasGiftShop)
    tri("Rental Equipment", p.hasRentalEquipment)
    tri("Card Only", p.isCardOnly)
    tri("ATM", p.hasATM)
    tri("Height Age Restrictions", p.hasHeightAgeRestrictions)
    tri("Arcade Games", p.hasArcadeGames)
    tri("Stroller Friendly", p.isStrollerFriendly)
    tri("Sunscreen Station", p.hasSunscreenStation)
    tri("Bug Spray Station", p.hasBugSprayStation)
    tri("EV Charging", p.hasEVCharging)
}.lowercase()

/** Maps Ktor / HTTP / JSON errors to something actionable (generic copy hid real causes like timeout vs 500 vs parse). */
private fun homeSearchFailureUserMessage(e: Exception): String {
    val m = e.message?.trim().orEmpty()
    val lower = m.lowercase()
    return when {
        lower.contains("timeout") || lower.contains("timed out") ->
            "Search timed out. Check that your API server is up, reachable from this network, and not overloaded."
        lower.contains("unable to resolve host") || lower.contains("unknownhost") ->
            "Could not reach the server host. Check SERVER_BASE_URL and your internet connection."
        lower.contains("connection refused") ||
            lower.contains("failed to connect") ||
            lower.contains("connection reset") ||
            lower.contains("network is unreachable") ->
            "Could not connect to the API. Confirm the server is running and the IP/port/firewall allow this device."
        lower.contains("cleartext") || lower.contains("cleartext traffic not permitted") ->
            "HTTP traffic was blocked. Use HTTPS for the API or allow cleartext to your dev host in the Android manifest."
        lower.contains("401") || lower.contains("403") || lower.contains("unauthorized") || lower.contains("forbidden") ->
            "Search was rejected by the server. Try signing out and back in, or check API auth."
        lower.contains("500") || lower.contains("502") || lower.contains("503") ->
            "The API returned a server error. Check server logs; the response may include a hint below.\n${m.take(220)}"
        m.startsWith("Search failed (") || m.contains("serialization") || m.contains("json") ->
            "Could not read search results from the server. ${m.take(220)}${if (m.length > 220) "…" else ""}"
        m.isNotEmpty() ->
            "Search failed: ${m.take(240)}${if (m.length > 240) "…" else ""}"
        else ->
            "Search failed. Check your connection and API URL, then try again."
    }
}

private fun Playground.matchesHomeSearchQuery(q: String): Boolean {
    if (q.isBlank()) return true
    return playgroundSearchHaystack(this).contains(q.trim().lowercase())
}

/**
 * [groundType] is comma-separated on the document.
 * Include: pass if any include token is present (OR). Exclude: fail if any exclude token is present (AND).
 */
private fun Playground.matchesGroundSurfaceFilters(
    include: Set<String>,
    exclude: Set<String>,
): Boolean {
    if (include.isEmpty() && exclude.isEmpty()) return true
    val tokens = groundType?.split(',')
        ?.map { it.trim().lowercase() }
        ?.filter { it.isNotEmpty() }
        ?.toSet()
        ?: emptySet()
    if (include.isNotEmpty()) {
        val inc = include.map { it.lowercase() }.toSet()
        if (tokens.none { it in inc }) return false
    }
    if (exclude.isNotEmpty()) {
        val exc = exclude.map { it.lowercase() }.toSet()
        if (tokens.any { it in exc }) return false
    }
    return true
}
