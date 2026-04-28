package org.community.playgroundfinder.ui.screens.add

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons as MaterialIcons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import coil3.compose.AsyncImage
import kotlinx.coroutines.launch
import org.community.playgroundfinder.data.Playground
import org.community.playgroundfinder.data.PlaygroundSaveOutcome
import org.community.playgroundfinder.data.PlaygroundService
import org.community.playgroundfinder.ui.composables.*
import org.community.playgroundfinder.ui.composables.FormColors
import org.community.playgroundfinder.util.contributorAttributionLine
import org.community.playgroundfinder.util.contributorDisplayNameValidationMessage
import org.community.playgroundfinder.util.contributorPublicLabel
import org.community.playgroundfinder.util.isValidContributorNameFormat
import org.community.playgroundfinder.util.normalizeContributorDisplayName
import org.community.playgroundfinder.util.rememberLocationService

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AddEditPlaygroundScreen(
    service: PlaygroundService,
    playgroundToEdit: Playground,
    onComplete: () -> Unit,
    launchImagePicker: (() -> Unit)? = null,
    pendingImageBatch: List<ByteArray>? = null,
    onImageBatchConsumed: (() -> Unit)? = null,
) {
    val scope = rememberCoroutineScope()
    val snackbarHostState = remember { SnackbarHostState() }
    val isEdit = playgroundToEdit.id != null
    val getLocation = rememberLocationService()

    // Photo state
    var imageUrls by remember { mutableStateOf(playgroundToEdit.imageUrls.toMutableList()) }
    var imageUploadLoading by remember { mutableStateOf(false) }
    var imageUploadError by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(pendingImageBatch) {
        val batch = pendingImageBatch ?: return@LaunchedEffect
        if (batch.isEmpty()) return@LaunchedEffect
        imageUploadLoading = true
        imageUploadError = null
        val failures = mutableListOf<String>()
        var baseTime = System.currentTimeMillis()
        try {
            for ((index, bytes) in batch.withIndex()) {
                try {
                    val filename = "photo_${baseTime}_$index.jpg"
                    baseTime += 1
                    val url = service.uploadImage(bytes, filename)
                    imageUrls = (imageUrls + url).toMutableList()
                } catch (e: Exception) {
                    failures.add("Photo ${index + 1}: ${e.message ?: "failed"}")
                }
            }
            if (failures.isNotEmpty()) {
                imageUploadError = failures.joinToString("; ")
            }
        } finally {
            imageUploadLoading = false
            onImageBatchConsumed?.invoke()
        }
    }

    // Basic info
    var name by remember { mutableStateOf(playgroundToEdit.name) }
    var description by remember { mutableStateOf(playgroundToEdit.description) }
    var address by remember { mutableStateOf(
        playgroundToEdit.address ?: run {
            val parts = listOfNotNull(
                playgroundToEdit.city?.takeIf { it.isNotBlank() },
                playgroundToEdit.state?.takeIf { it.isNotBlank() }
            )
            if (parts.isNotEmpty()) parts.joinToString(", ") else ""
        }
    ) }
    var city by remember { mutableStateOf(playgroundToEdit.city ?: "") }
    var state by remember { mutableStateOf(playgroundToEdit.state ?: "") }
    var latStr by remember { mutableStateOf(if (playgroundToEdit.latitude != 0.0) playgroundToEdit.latitude.toString() else "") }
    var lngStr by remember { mutableStateOf(if (playgroundToEdit.longitude != 0.0) playgroundToEdit.longitude.toString() else "") }
    var locationPinned by remember { mutableStateOf(playgroundToEdit.latitude != 0.0) }
    var isPinningLocation by remember { mutableStateOf(false) }

    var playgroundType by remember { mutableStateOf(playgroundToEdit.playgroundType ?: "") }
    var groundTypes by remember { mutableStateOf(
        playgroundToEdit.groundType?.split(",")?.map { it.trim() }?.filter { it.isNotBlank() }?.toSet() ?: emptySet<String>()
    ) }
    var costRange by remember { mutableStateOf(playgroundToEdit.costRange ?: playgroundToEdit.expense ?: "") }
    var ageRange by remember { mutableStateOf(playgroundToEdit.ageRange ?: "") }
    var hours by remember { mutableStateOf(playgroundToEdit.hours ?: "") }
    var website by remember { mutableStateOf(playgroundToEdit.website ?: "") }
    var phoneNumber by remember { mutableStateOf(playgroundToEdit.phoneNumber ?: "") }

    // Amenity toggles
    var hasBathrooms by remember { mutableStateOf(playgroundToEdit.hasBathrooms) }
    var hasShade by remember { mutableStateOf(playgroundToEdit.hasShade) }
    var isFenced by remember { mutableStateOf(playgroundToEdit.isFenced) }
    var isToddlerFriendly by remember { mutableStateOf(playgroundToEdit.isToddlerFriendly) }
    var isDogFriendly by remember { mutableStateOf(playgroundToEdit.isDogFriendly) }
    var hasParking by remember { mutableStateOf(playgroundToEdit.hasParking) }
    var hasSplashPad by remember { mutableStateOf(playgroundToEdit.hasSplashPad) }
    var isAccessible by remember { mutableStateOf(playgroundToEdit.isAccessible) }
    var hasWifi by remember { mutableStateOf(playgroundToEdit.hasWifi) }
    var hasWalkingTrail by remember { mutableStateOf(playgroundToEdit.hasWalkingTrail) }
    var hasBottleFiller by remember { mutableStateOf(playgroundToEdit.hasBottleFiller) }
    var hasBenches by remember { mutableStateOf(playgroundToEdit.hasBenches) }
    var hasPicnicTables by remember { mutableStateOf(playgroundToEdit.hasPicnicTables) }
    var hasTrashCans by remember { mutableStateOf(playgroundToEdit.hasTrashCans) }
    var needsGripSocks by remember { mutableStateOf(playgroundToEdit.needsGripSocks) }
    var requiresWaiver by remember { mutableStateOf(playgroundToEdit.requiresWaiver) }
    var hasOutdoorShower by remember { mutableStateOf(playgroundToEdit.hasOutdoorShower) }
    var hasChangingRooms by remember { mutableStateOf(playgroundToEdit.hasChangingRooms) }
    var hasLockers by remember { mutableStateOf(playgroundToEdit.hasLockers) }
    var hasNursingRoom by remember { mutableStateOf(playgroundToEdit.hasNursingRoom) }
    var hasPartyRoom by remember { mutableStateOf(playgroundToEdit.hasPartyRoom) }
    var hasCoveredSeating by remember { mutableStateOf(playgroundToEdit.hasCoveredSeating) }
    var hasFoodServices by remember { mutableStateOf(playgroundToEdit.hasFoodServices) }
    var hasSnackBar by remember { mutableStateOf(playgroundToEdit.hasSnackBar) }
    var hasAlcoholOnSite by remember { mutableStateOf(playgroundToEdit.hasAlcoholOnSite) }
    var hasGiftShop by remember { mutableStateOf(playgroundToEdit.hasGiftShop) }
    var hasRentalEquipment by remember { mutableStateOf(playgroundToEdit.hasRentalEquipment) }
    var isCardOnly by remember { mutableStateOf(playgroundToEdit.isCardOnly) }
    var hasATM by remember { mutableStateOf(playgroundToEdit.hasATM) }
    var hasHeightAgeRestrictions by remember { mutableStateOf(playgroundToEdit.hasHeightAgeRestrictions) }
    var hasArcadeGames by remember { mutableStateOf(playgroundToEdit.hasArcadeGames) }
    var isStrollerFriendly by remember { mutableStateOf(playgroundToEdit.isStrollerFriendly) }
    var hasSunscreenStation by remember { mutableStateOf(playgroundToEdit.hasSunscreenStation) }
    var hasBugSprayStation by remember { mutableStateOf(playgroundToEdit.hasBugSprayStation) }
    var hasEVCharging by remember { mutableStateOf(playgroundToEdit.hasEVCharging) }

    // Free-form / approved-via-suggestion amenities that don't map to one of the hardcoded
    // boolean fields above (e.g. "Skate Park"). Initialized from the playground; merged with
    // the global category_options/amenity catalog so previously-approved suggestions show up
    // as toggles for everyone going forward.
    var customAmenities by remember {
        mutableStateOf(playgroundToEdit.customAmenities.filter { it.isNotBlank() }.toSet())
    }
    var amenityCatalog by remember { mutableStateOf<List<String>>(emptyList()) }

    // Multi-select lists (base + admin-approved options from server)
    val baseEquipment = OptionCatalogDefaults.equipment
    val baseSwingTypes = OptionCatalogDefaults.swingTypes
    val baseSportsCourts = OptionCatalogDefaults.sportsCourts
    val baseExerciseEquipment = OptionCatalogDefaults.exerciseEquipment
    val baseGroundTypes = listOf("Wood Chips", "Rubber", "Sand", "Pea Gravel", "Grass", "Concrete", "Turf")
    var allEquipment by remember { mutableStateOf(baseEquipment) }
    var allSwingTypes by remember { mutableStateOf(baseSwingTypes) }
    var allSportsCourts by remember { mutableStateOf(baseSportsCourts) }
    var allExerciseEquipment by remember { mutableStateOf(baseExerciseEquipment) }
    var allGroundTypes by remember { mutableStateOf(baseGroundTypes) }
    val allCostOptions = FormColors.COST_OPTIONS

    LaunchedEffect(service) {
        try {
            allEquipment = (baseEquipment + service.getCategoryOptions("equipment")).distinct().sorted()
        } catch (_: Exception) { allEquipment = baseEquipment }
        try {
            allSwingTypes = (baseSwingTypes + service.getCategoryOptions("swing_type")).distinct().sorted()
        } catch (_: Exception) { allSwingTypes = baseSwingTypes }
        try {
            allSportsCourts = (baseSportsCourts + service.getCategoryOptions("sports_court")).distinct().sorted()
        } catch (_: Exception) { allSportsCourts = baseSportsCourts }
        try {
            allExerciseEquipment = (baseExerciseEquipment + service.getCategoryOptions("exercise_equipment")).distinct().sorted()
        } catch (_: Exception) { allExerciseEquipment = baseExerciseEquipment }
        try {
            allGroundTypes = (baseGroundTypes + service.getCategoryOptions("ground_surface")).distinct().sorted()
        } catch (_: Exception) { allGroundTypes = baseGroundTypes }
        try {
            amenityCatalog = service.getCategoryOptions("amenity")
                .filter { it.isNotBlank() }
                .distinct()
                .sorted()
        } catch (_: Exception) { /* leave catalog empty; existing customAmenities still render */ }
    }

    var equipment by remember { mutableStateOf(playgroundToEdit.equipment.toMutableSet()) }
    var swingTypes by remember { mutableStateOf(playgroundToEdit.swingTypes.toMutableSet()) }
    var sportsCourts by remember { mutableStateOf(playgroundToEdit.sportsCourts.toMutableSet()) }
    var exerciseEquipment by remember { mutableStateOf(playgroundToEdit.exerciseEquipment.toMutableSet()) }

    var parentRating by remember { mutableStateOf(0) }
    var submitAnonymously by remember { mutableStateOf(false) }
    var adminNotes by remember { mutableStateOf("") }

    var isLoading by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var showConfirmation by remember { mutableStateOf(false) }
    var showDiscardDialog by remember { mutableStateOf(false) }
    var showReviewDialog by remember { mutableStateOf(false) }
    var showPendingNewDialog by remember { mutableStateOf(false) }
    var pendingReviewMessage by remember { mutableStateOf("") }
    /** true = queued for moderator; false = live / auto-approved */
    var editWasQueuedForReview by remember { mutableStateOf(false) }

    // Display name prompt state
    var showDisplayNameDialog by remember { mutableStateOf(false) }
    var displayNameInput by remember { mutableStateOf("") }
    var displayNameError by remember { mutableStateOf<String?>(null) }
    var isSettingDisplayName by remember { mutableStateOf(false) }
    /** null until contributor profile loads — avoids skipping the name prompt on API failure. */
    var userHasDisplayName by remember { mutableStateOf<Boolean?>(null) }
    var myContributorDisplayName by remember { mutableStateOf<String?>(null) }

    val hasChanges by remember {
        derivedStateOf {
            name != playgroundToEdit.name ||
                description != playgroundToEdit.description ||
                address != (playgroundToEdit.address ?: "") ||
                city != (playgroundToEdit.city ?: "") ||
                state != (playgroundToEdit.state ?: "") ||
                latStr != (if (playgroundToEdit.latitude != 0.0) playgroundToEdit.latitude.toString() else "") ||
                lngStr != (if (playgroundToEdit.longitude != 0.0) playgroundToEdit.longitude.toString() else "") ||
                playgroundType != (playgroundToEdit.playgroundType ?: "") ||
                groundTypes != (playgroundToEdit.groundType?.split(",")?.map { it.trim() }?.filter { it.isNotBlank() }?.toSet() ?: emptySet<String>()) ||
                costRange != (playgroundToEdit.costRange ?: playgroundToEdit.expense ?: "") ||
                ageRange != (playgroundToEdit.ageRange ?: "") ||
                hours != (playgroundToEdit.hours ?: "") ||
                website != (playgroundToEdit.website ?: "") ||
                phoneNumber != (playgroundToEdit.phoneNumber ?: "") ||
                imageUrls != playgroundToEdit.imageUrls ||
                equipment != playgroundToEdit.equipment.toSet() ||
                swingTypes != playgroundToEdit.swingTypes.toSet() ||
                sportsCourts != playgroundToEdit.sportsCourts.toSet() ||
                exerciseEquipment != playgroundToEdit.exerciseEquipment.toSet() ||
                hasBathrooms != playgroundToEdit.hasBathrooms ||
                hasShade != playgroundToEdit.hasShade ||
                isFenced != playgroundToEdit.isFenced ||
                isToddlerFriendly != playgroundToEdit.isToddlerFriendly ||
                isDogFriendly != playgroundToEdit.isDogFriendly ||
                hasParking != playgroundToEdit.hasParking ||
                hasSplashPad != playgroundToEdit.hasSplashPad ||
                isAccessible != playgroundToEdit.isAccessible ||
                hasWifi != playgroundToEdit.hasWifi ||
                hasWalkingTrail != playgroundToEdit.hasWalkingTrail ||
                hasBottleFiller != playgroundToEdit.hasBottleFiller ||
                hasBenches != playgroundToEdit.hasBenches ||
                hasPicnicTables != playgroundToEdit.hasPicnicTables ||
                hasTrashCans != playgroundToEdit.hasTrashCans ||
                needsGripSocks != playgroundToEdit.needsGripSocks ||
                requiresWaiver != playgroundToEdit.requiresWaiver ||
                hasOutdoorShower != playgroundToEdit.hasOutdoorShower ||
                hasChangingRooms != playgroundToEdit.hasChangingRooms ||
                hasLockers != playgroundToEdit.hasLockers ||
                hasNursingRoom != playgroundToEdit.hasNursingRoom ||
                hasPartyRoom != playgroundToEdit.hasPartyRoom ||
                hasCoveredSeating != playgroundToEdit.hasCoveredSeating ||
                hasFoodServices != playgroundToEdit.hasFoodServices ||
                hasSnackBar != playgroundToEdit.hasSnackBar ||
                hasAlcoholOnSite != playgroundToEdit.hasAlcoholOnSite ||
                hasGiftShop != playgroundToEdit.hasGiftShop ||
                hasRentalEquipment != playgroundToEdit.hasRentalEquipment ||
                isCardOnly != playgroundToEdit.isCardOnly ||
                hasATM != playgroundToEdit.hasATM ||
                hasHeightAgeRestrictions != playgroundToEdit.hasHeightAgeRestrictions ||
                hasArcadeGames != playgroundToEdit.hasArcadeGames ||
                isStrollerFriendly != playgroundToEdit.isStrollerFriendly ||
                hasSunscreenStation != playgroundToEdit.hasSunscreenStation ||
                hasBugSprayStation != playgroundToEdit.hasBugSprayStation ||
                hasEVCharging != playgroundToEdit.hasEVCharging ||
                customAmenities != playgroundToEdit.customAmenities.toSet() ||
                adminNotes != (playgroundToEdit.notesForAdmin ?: "") ||
                locationPinned != (playgroundToEdit.latitude != 0.0)
        }
    }

    androidx.activity.compose.BackHandler(enabled = hasChanges) {
        showDiscardDialog = true
    }

    // Map/satellite pin: pre-filled coords but no name — try nearby Places hints (same as "Pin my location").
    LaunchedEffect(playgroundToEdit.latitude, playgroundToEdit.longitude, playgroundToEdit.id, playgroundToEdit.name) {
        if (playgroundToEdit.id != null) return@LaunchedEffect
        val lat = playgroundToEdit.latitude
        val lng = playgroundToEdit.longitude
        if (lat == 0.0 || lng == 0.0) return@LaunchedEffect
        if (playgroundToEdit.name.isNotBlank()) return@LaunchedEffect
        try {
            val suggestions = service.getNearbyPlaceSuggestions(lat, lng)
            val first = suggestions.firstOrNull() ?: return@LaunchedEffect
            if (name.isBlank() && first.name.isNotBlank()) name = first.name
            if (address.isBlank() && !first.vicinity.isNullOrBlank()) address = first.vicinity
        } catch (_: Exception) {}
    }

    var updatedFields by remember { mutableStateOf<List<String>>(emptyList()) }

    var showSuggestionDialog by remember { mutableStateOf(false) }
    var suggestionCategory by remember { mutableStateOf("") }
    var suggestionText by remember { mutableStateOf("") }
    var suggestionLoading by remember { mutableStateOf(false) }
    var previewIndex by remember { mutableStateOf<Int?>(null) }

    // Accordion expanded state
    var expandedSection by remember { mutableStateOf("basics") }

    val typeConfig = remember(playgroundType) {
        AmenityTypeMapping.getConfigForType(playgroundType.takeIf { it.isNotBlank() })
    }

    // Auto-fill amenities for schools/libraries
    LaunchedEffect(playgroundType) {
        val pt = playgroundType.lowercase()
        if (!isEdit && (pt.contains("school") || pt.contains("elementary") || pt.contains("library"))) {
            hasSplashPad = false; needsGripSocks = false; requiresWaiver = false
            hasWifi = false; isDogFriendly = false
        }
    }

    LaunchedEffect(playgroundToEdit.id) {
        try {
            val profile = service.getMyContributorProfile()
            userHasDisplayName = !profile.displayName.isNullOrBlank()
            myContributorDisplayName = profile.displayName?.trim()?.takeIf { it.isNotBlank() }
        } catch (_: Exception) {
            userHasDisplayName = false
            myContributorDisplayName = null
        }
    }

    val listingPublicAttribution = remember(submitAnonymously, myContributorDisplayName) {
        if (submitAnonymously) "Anonymous"
        else contributorPublicLabel(myContributorDisplayName)
    }

    fun proceedSubmitAfterDisplayNameGate() {
        if (userHasDisplayName == false && !submitAnonymously) {
            showDisplayNameDialog = true
            return
        }
        val lat = latStr.toDoubleOrNull()
        val lng = lngStr.toDoubleOrNull()
        if (name.isBlank() || lat == null || lng == null) {
            errorMessage = "Name and location are required. Pin GPS, or use the map (long-press) to set coordinates."
            return
        }
        if (!isEdit) {
            showReviewDialog = true
            return
        }
        scope.launch {
            isLoading = true; errorMessage = null
            try {
                val pg = playgroundToEdit.copy(
                    name = name, description = description,
                    address = address.ifBlank { null }, city = city.ifBlank { null }, state = state.ifBlank { null },
                    latitude = lat, longitude = lng,
                    playgroundType = playgroundType.ifBlank { null },
                    groundType = groundTypes.joinToString(", ").ifBlank { null },
                    costRange = costRange.ifBlank { null }, ageRange = ageRange.ifBlank { null },
                    hours = hours.ifBlank { null }, website = website.ifBlank { null }, phoneNumber = phoneNumber.ifBlank { null },
                    equipment = equipment.toList(), swingTypes = swingTypes.toList(),
                    sportsCourts = sportsCourts.toList(), exerciseEquipment = exerciseEquipment.toList(),
                    imageUrls = imageUrls.toList(),
                    hasBathrooms = hasBathrooms, hasShade = hasShade, isFenced = isFenced,
                    isToddlerFriendly = isToddlerFriendly, isDogFriendly = isDogFriendly,
                    hasParking = hasParking, hasSplashPad = hasSplashPad, isAccessible = isAccessible,
                    hasWifi = hasWifi, hasWalkingTrail = hasWalkingTrail, hasBottleFiller = hasBottleFiller,
                    hasBenches = hasBenches, hasPicnicTables = hasPicnicTables, hasTrashCans = hasTrashCans,
                    needsGripSocks = needsGripSocks, requiresWaiver = requiresWaiver,
                    hasOutdoorShower = hasOutdoorShower, hasChangingRooms = hasChangingRooms,
                    hasLockers = hasLockers, hasNursingRoom = hasNursingRoom,
                    hasPartyRoom = hasPartyRoom, hasCoveredSeating = hasCoveredSeating,
                    hasFoodServices = hasFoodServices, hasSnackBar = hasSnackBar,
                    hasAlcoholOnSite = hasAlcoholOnSite, hasGiftShop = hasGiftShop,
                    hasRentalEquipment = hasRentalEquipment, isCardOnly = isCardOnly,
                    hasATM = hasATM, hasHeightAgeRestrictions = hasHeightAgeRestrictions,
                    hasArcadeGames = hasArcadeGames, isStrollerFriendly = isStrollerFriendly,
                    hasSunscreenStation = hasSunscreenStation, hasBugSprayStation = hasBugSprayStation,
                    hasEVCharging = hasEVCharging,
                    customAmenities = customAmenities.toList(),
                    submittedBy = if (submitAnonymously) "Anonymous" else playgroundToEdit.submittedBy,
                    notesForAdmin = adminNotes.ifBlank { null },
                )
                if (isEdit) {
                    when (val outcome = service.updatePlayground(pg.id!!, pg)) {
                        is PlaygroundSaveOutcome.PendingReview -> {
                            editWasQueuedForReview = true
                            pendingReviewMessage = outcome.message
                        }
                        is PlaygroundSaveOutcome.Saved -> {
                            editWasQueuedForReview = false
                            pendingReviewMessage = ""
                        }
                        else -> {}
                    }
                } else {
                    when (val outcome = service.createPlaygroundOrDuplicate(pg)) {
                        is PlaygroundSaveOutcome.Duplicate -> {
                            errorMessage = "This place may already exist. Try searching the map."
                            return@launch
                        }
                        is PlaygroundSaveOutcome.PendingReview -> {
                            pendingReviewMessage = outcome.message
                            showPendingNewDialog = true
                            return@launch
                        }
                        is PlaygroundSaveOutcome.Saved -> {
                            onComplete()
                            return@launch
                        }
                    }
                }

                if (isEdit && parentRating > 0 && playgroundToEdit.id != null) {
                    try {
                        service.ratePlayground(playgroundToEdit.id!!, parentRating)
                        snackbarHostState.showSnackbar("Thanks! Your rating was saved.")
                    } catch (_: Exception) {}
                }

                if (isEdit) {
                    val changed = mutableListOf<String>()
                    if (name != playgroundToEdit.name) changed.add("Name")
                    if (description != playgroundToEdit.description) changed.add("Description")
                    if (address != (playgroundToEdit.address ?: "")) changed.add("Address")
                    if (city != (playgroundToEdit.city ?: "")) changed.add("City")
                    if (state != (playgroundToEdit.state ?: "")) changed.add("State")
                    if (latStr != (if (playgroundToEdit.latitude != 0.0) playgroundToEdit.latitude.toString() else "") ||
                        lngStr != (if (playgroundToEdit.longitude != 0.0) playgroundToEdit.longitude.toString() else "")
                    ) {
                        changed.add("Location")
                    }
                    if (playgroundType != (playgroundToEdit.playgroundType ?: "")) changed.add("Location type")
                    if (groundTypes != (playgroundToEdit.groundType?.split(",")?.map { it.trim() }?.filter { it.isNotBlank() }?.toSet() ?: emptySet<String>())) changed.add("Ground surface")
                    if (costRange != (playgroundToEdit.costRange ?: playgroundToEdit.expense ?: "")) changed.add("Cost")
                    if (ageRange != (playgroundToEdit.ageRange ?: "")) changed.add("Age range")
                    if (hours != (playgroundToEdit.hours ?: "")) changed.add("Hours")
                    if (website != (playgroundToEdit.website ?: "")) changed.add("Website")
                    if (phoneNumber != (playgroundToEdit.phoneNumber ?: "")) changed.add("Phone")
                    if (imageUrls != playgroundToEdit.imageUrls) changed.add("Photos")
                    if (equipment != playgroundToEdit.equipment.toSet()) changed.add("Equipment")
                    if (swingTypes != playgroundToEdit.swingTypes.toSet()) changed.add("Swing types")
                    if (sportsCourts != playgroundToEdit.sportsCourts.toSet()) changed.add("Sports / fields")
                    if (exerciseEquipment != playgroundToEdit.exerciseEquipment.toSet()) changed.add("Exercise equipment")
                    if (hasBathrooms != playgroundToEdit.hasBathrooms) changed.add("Bathrooms")
                    if (hasShade != playgroundToEdit.hasShade) changed.add("Shade")
                    if (isFenced != playgroundToEdit.isFenced) changed.add("Fenced")
                    if (isToddlerFriendly != playgroundToEdit.isToddlerFriendly) changed.add("Toddler friendly")
                    if (isDogFriendly != playgroundToEdit.isDogFriendly) changed.add("Dog friendly")
                    if (hasParking != playgroundToEdit.hasParking) changed.add("Parking")
                    if (hasSplashPad != playgroundToEdit.hasSplashPad) changed.add("Splash pad")
                    if (isAccessible != playgroundToEdit.isAccessible) changed.add("Accessible")
                    if (hasWifi != playgroundToEdit.hasWifi) changed.add("WiFi")
                    if (hasWalkingTrail != playgroundToEdit.hasWalkingTrail) changed.add("Walking trail")
                    if (hasBottleFiller != playgroundToEdit.hasBottleFiller) changed.add("Water fountain")
                    if (hasBenches != playgroundToEdit.hasBenches) changed.add("Benches")
                    if (hasPicnicTables != playgroundToEdit.hasPicnicTables) changed.add("Picnic tables")
                    if (hasTrashCans != playgroundToEdit.hasTrashCans) changed.add("Trash cans")
                    if (needsGripSocks != playgroundToEdit.needsGripSocks) changed.add("Grip socks")
                    if (requiresWaiver != playgroundToEdit.requiresWaiver) changed.add("Waiver")
                    if (hasOutdoorShower != playgroundToEdit.hasOutdoorShower) changed.add("Outdoor shower")
                    if (hasChangingRooms != playgroundToEdit.hasChangingRooms) changed.add("Changing rooms")
                    if (hasLockers != playgroundToEdit.hasLockers) changed.add("Lockers")
                    if (hasNursingRoom != playgroundToEdit.hasNursingRoom) changed.add("Nursing room")
                    if (hasPartyRoom != playgroundToEdit.hasPartyRoom) changed.add("Party room")
                    if (hasCoveredSeating != playgroundToEdit.hasCoveredSeating) changed.add("Covered seating")
                    if (hasFoodServices != playgroundToEdit.hasFoodServices) changed.add("Food services")
                    if (hasSnackBar != playgroundToEdit.hasSnackBar) changed.add("Snack bar")
                    if (hasAlcoholOnSite != playgroundToEdit.hasAlcoholOnSite) changed.add("Alcohol on site")
                    if (hasGiftShop != playgroundToEdit.hasGiftShop) changed.add("Gift shop")
                    if (hasRentalEquipment != playgroundToEdit.hasRentalEquipment) changed.add("Rental equipment")
                    if (isCardOnly != playgroundToEdit.isCardOnly) changed.add("Card only")
                    if (hasATM != playgroundToEdit.hasATM) changed.add("ATM")
                    if (hasHeightAgeRestrictions != playgroundToEdit.hasHeightAgeRestrictions) changed.add("Height/age restrictions")
                    if (hasArcadeGames != playgroundToEdit.hasArcadeGames) changed.add("Arcade games")
                    if (isStrollerFriendly != playgroundToEdit.isStrollerFriendly) changed.add("Stroller friendly")
                    if (hasSunscreenStation != playgroundToEdit.hasSunscreenStation) changed.add("Sunscreen station")
                    if (hasBugSprayStation != playgroundToEdit.hasBugSprayStation) changed.add("Bug spray station")
                    if (hasEVCharging != playgroundToEdit.hasEVCharging) changed.add("EV charging")
                    if (customAmenities != playgroundToEdit.customAmenities.toSet()) changed.add("Other amenities")
                    if (adminNotes != (playgroundToEdit.notesForAdmin ?: "")) changed.add("Admin notes")
                    updatedFields = changed
                    showConfirmation = true
                }
            } catch (e: Exception) {
                errorMessage = "Save failed: ${e.message}"
            } finally {
                isLoading = false
            }
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 120.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            // ── 1. BASICS (always visible — not collapsible) ──────────────────
            Card(
                shape = RoundedCornerShape(12.dp),
                colors = CardDefaults.cardColors(containerColor = Color(0xFFFFFFFF)),
                elevation = CardDefaults.cardElevation(1.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("Name *") }, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(value = description, onValueChange = { description = it }, label = { Text("Description") }, modifier = Modifier.fillMaxWidth(), minLines = 2)
                    OutlinedTextField(value = address, onValueChange = { address = it }, label = { Text("Address") }, modifier = Modifier.fillMaxWidth())

                    // Pin My Location
                    Button(
                        onClick = {
                            scope.launch {
                                isPinningLocation = true
                                try {
                                    val loc = getLocation()
                                    if (loc != null) {
                                        latStr = loc.latitude.toString()
                                        lngStr = loc.longitude.toString()
                                        locationPinned = true
                                        if (name.isBlank()) {
                                            try {
                                                val suggestions = service.getNearbyPlaceSuggestions(loc.latitude, loc.longitude)
                                                val first = suggestions.firstOrNull()
                                                if (first != null) {
                                                    if (name.isBlank()) name = first.name
                                                    if (address.isBlank() && !first.vicinity.isNullOrBlank()) address = first.vicinity
                                                }
                                            } catch (_: Exception) {}
                                        }
                                    } else {
                                        errorMessage = "Could not get location. Please enable location permissions."
                                    }
                                } catch (_: Exception) {
                                    errorMessage = "Location unavailable."
                                } finally {
                                    isPinningLocation = false
                                }
                            }
                        },
                        enabled = !isPinningLocation,
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = if (locationPinned) Color(0xFF808080) else FormColors.PrimaryButton
                        )
                    ) {
                        if (isPinningLocation) {
                            CircularProgressIndicator(modifier = Modifier.size(18.dp), color = Color.White, strokeWidth = 2.dp)
                            Spacer(Modifier.width(8.dp))
                            Text("Getting location...")
                        } else if (locationPinned) {
                            Text("📍 Location Pinned ✓", fontWeight = FontWeight.Bold)
                        } else {
                            Text("📍 Pin My Location *", fontWeight = FontWeight.Bold)
                        }
                    }
                    if (locationPinned && latStr.isNotBlank() && lngStr.isNotBlank()) {
                        Text("Lat: $latStr, Lng: $lngStr", fontSize = 12.sp, color = Color.Gray, modifier = Modifier.padding(start = 4.dp))
                    }
                    if (!isEdit) {
                        Text(
                            "No GPS? Open Interactive Map from home, long-press the spot (e.g. from satellite), then Continue — address optional.",
                            fontSize = 11.sp,
                            color = Color(0xFF757575),
                            modifier = Modifier.padding(top = 4.dp),
                        )
                    }
                }
            }

            // ── 2. PHOTOS ─────────────────────────────────────────────────────
            AccordionSection(
                title = "Photos",
                subtitle = if (imageUrls.isNotEmpty()) "${imageUrls.size} photo${if (imageUrls.size > 1) "s" else ""}" else null,
                expanded = expandedSection == "photos",
                onToggle = { expandedSection = if (expandedSection == "photos") "" else "photos" }
            ) {
                if (launchImagePicker != null) {
                    Text(
                        "Select several photos at once from your gallery, or add them one by one.",
                        fontSize = 11.sp,
                        color = Color(0xFF757575),
                        modifier = Modifier.padding(bottom = 8.dp),
                    )
                }
                if (imageUrls.isNotEmpty()) {
                    LazyRow(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        itemsIndexed(imageUrls) { index, url ->
                            Box {
                                AsyncImage(
                                    model = url, contentDescription = null, contentScale = ContentScale.Crop,
                                    modifier = Modifier.size(130.dp).clip(RoundedCornerShape(10.dp)).clickable { previewIndex = index }
                                )
                                IconButton(
                                    onClick = { imageUrls = imageUrls.toMutableList().also { it.removeAt(index) } },
                                    modifier = Modifier.align(Alignment.TopEnd).size(28.dp)
                                ) {
                                    Icon(MaterialIcons.Filled.Close, contentDescription = "Remove photo", tint = Color.White, modifier = Modifier.size(16.dp))
                                }
                            }
                        }
                    }
                }
                imageUploadError?.let { Text(it, color = MaterialTheme.colorScheme.error, fontSize = 12.sp) }
                OutlinedButton(
                    onClick = { launchImagePicker?.invoke() },
                    enabled = launchImagePicker != null && !imageUploadLoading,
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(10.dp)
                ) {
                    if (imageUploadLoading) {
                        CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.width(8.dp)); Text("Uploading...")
                    } else {
                        Icon(MaterialIcons.Filled.AddAPhoto, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp)); Text("Add photos")
                    }
                }
            }

            // ── 3. DETAILS ────────────────────────────────────────────────────
            AccordionSection(
                title = "Details",
                subtitle = listOfNotNull(
                    playgroundType.takeIf { it.isNotBlank() },
                    costRange.takeIf { it.isNotBlank() }
                ).joinToString(" · ").takeIf { it.isNotBlank() },
                expanded = expandedSection == "details",
                onToggle = { expandedSection = if (expandedSection == "details") "" else "details" }
            ) {
                CategoryTypePicker(
                    selected = playgroundType.takeIf { it.isNotBlank() },
                    onSelect = { playgroundType = it ?: "" }
                )

                HorizontalDivider(color = FormColors.Divider)

                Text("Ground Surface", fontWeight = FontWeight.SemiBold, fontSize = 14.sp, modifier = Modifier.padding(top = 8.dp))
                ChipGroupWithSuggest(
                    options = allGroundTypes, selected = groundTypes,
                    onToggle = { item -> groundTypes = if (item in groundTypes) groundTypes - item else groundTypes + item },
                    onSuggest = { suggestionCategory = "Ground Surface"; suggestionText = ""; showSuggestionDialog = true }
                )

                HorizontalDivider(color = FormColors.Divider)

                Text("Cost Per Person", fontWeight = FontWeight.SemiBold, fontSize = 14.sp, modifier = Modifier.padding(top = 8.dp))
                ChipGroup(
                    options = allCostOptions, selected = setOf(costRange),
                    onToggle = { costRange = if (costRange == it) "" else it }
                )

                HorizontalDivider(color = FormColors.Divider)

                OutlinedTextField(value = hours, onValueChange = { hours = it }, label = { Text("Hours (e.g. Dawn–Dusk)") }, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(value = website, onValueChange = { website = it }, label = { Text("Website") }, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(value = phoneNumber, onValueChange = { phoneNumber = it }, label = { Text("Phone Number") }, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(value = ageRange, onValueChange = { ageRange = it }, label = { Text("Age Range (e.g. 2–12)") }, modifier = Modifier.fillMaxWidth())
            }

            // ── 4. EQUIPMENT ──────────────────────────────────────────────────
            val showEquipmentSection = typeConfig.showPlaygroundEquipment || typeConfig.showSwingTypes || typeConfig.showSportsCourts || typeConfig.showExerciseEquipment
            if (showEquipmentSection) AccordionSection(
                title = "Equipment",
                subtitle = (equipment.size + sportsCourts.size + exerciseEquipment.size).let { if (it > 0) "$it selected" else null },
                expanded = expandedSection == "equipment",
                onToggle = { expandedSection = if (expandedSection == "equipment") "" else "equipment" }
            ) {
                if (typeConfig.showPlaygroundEquipment) {
                    Text("Playground Equipment", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                    ChipGroupWithSuggest(
                        options = allEquipment, selected = equipment,
                        onToggle = { item -> equipment = equipment.toMutableSet().also { if (item in it) it.remove(item) else it.add(item) } },
                        onSuggest = { suggestionCategory = "Playground Equipment"; suggestionText = ""; showSuggestionDialog = true }
                    )
                }

                if (typeConfig.showSwingTypes && "Swings" in equipment) {
                    HorizontalDivider(color = FormColors.Divider)
                    Text("Swing Types", fontWeight = FontWeight.SemiBold, fontSize = 14.sp, modifier = Modifier.padding(top = 8.dp))
                    ChipGroupWithSuggest(
                        options = allSwingTypes, selected = swingTypes,
                        onToggle = { item -> swingTypes = swingTypes.toMutableSet().also { if (item in it) it.remove(item) else it.add(item) } },
                        onSuggest = { suggestionCategory = "Swing Type"; suggestionText = ""; showSuggestionDialog = true }
                    )
                }

                if (typeConfig.showSportsCourts) {
                    HorizontalDivider(color = FormColors.Divider)
                    Text("Sports Courts / Fields", fontWeight = FontWeight.SemiBold, fontSize = 14.sp, modifier = Modifier.padding(top = 8.dp))
                    ChipGroupWithSuggest(
                        options = allSportsCourts, selected = sportsCourts,
                        onToggle = { item -> sportsCourts = sportsCourts.toMutableSet().also { if (item in it) it.remove(item) else it.add(item) } },
                        onSuggest = { suggestionCategory = "Sports Court"; suggestionText = ""; showSuggestionDialog = true }
                    )
                }

                if (typeConfig.showExerciseEquipment) {
                    HorizontalDivider(color = FormColors.Divider)
                    Text("Exercise Equipment", fontWeight = FontWeight.SemiBold, fontSize = 14.sp, modifier = Modifier.padding(top = 8.dp))
                    ChipGroupWithSuggest(
                        options = allExerciseEquipment, selected = exerciseEquipment,
                        onToggle = { item -> exerciseEquipment = exerciseEquipment.toMutableSet().also { if (item in it) it.remove(item) else it.add(item) } },
                        onSuggest = { suggestionCategory = "Exercise Equipment"; suggestionText = ""; showSuggestionDialog = true }
                    )
                }
            }

            // ── 5. AMENITIES ──────────────────────────────────────────────────
            AccordionSection(
                title = "Amenities",
                subtitle = listOfNotNull(
                    hasBathrooms?.let { if (it) "Bathrooms" else null },
                    hasShade?.let { if (it) "Shade" else null },
                    isFenced?.let { if (it) "Fenced" else null },
                    hasParking?.let { if (it) "Parking" else null },
                ).joinToString(", ").takeIf { it.isNotBlank() },
                expanded = expandedSection == "amenities",
                onToggle = { expandedSection = if (expandedSection == "amenities") "" else "amenities" }
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    // Filter amenities by type config
                    val visible = typeConfig.visibleAmenities
                    if ("Bathrooms" in visible) AmenityToggle("Bathrooms", hasBathrooms) { hasBathrooms = it }
                    if ("Shade" in visible) AmenityToggle("Shade", hasShade) { hasShade = it }
                    if ("Fenced" in visible) AmenityToggle("Fenced", isFenced) { isFenced = it }
                    if ("Toddler Friendly" in visible) AmenityToggle("Toddler Friendly", isToddlerFriendly) { isToddlerFriendly = it }
                    if ("Dog Friendly" in visible) AmenityToggle("Dog Friendly", isDogFriendly) { isDogFriendly = it }
                    if ("Parking" in visible) AmenityToggle("Parking", hasParking) { hasParking = it }
                    if ("Splash Pad" in visible) AmenityToggle("Splash Pad", hasSplashPad) { hasSplashPad = it }
                    if ("Accessible" in visible) AmenityToggle("Accessible", isAccessible) { isAccessible = it }
                    if ("WiFi" in visible) AmenityToggle("WiFi", hasWifi) { hasWifi = it }
                    if ("Walking Trail" in visible) AmenityToggle("Walking Trail", hasWalkingTrail) { hasWalkingTrail = it }
                    if ("Water Fountain" in visible) AmenityToggle("Water Fountain", hasBottleFiller) { hasBottleFiller = it }
                    if ("Benches" in visible) AmenityToggle("Benches", hasBenches) { hasBenches = it }
                    if ("Picnic Tables" in visible) AmenityToggle("Picnic Tables", hasPicnicTables) { hasPicnicTables = it }
                    if ("Trash Cans" in visible) AmenityToggle("Trash Cans", hasTrashCans) { hasTrashCans = it }
                    if ("Requires Grip Socks" in visible) AmenityToggle("Requires Grip Socks", needsGripSocks) { needsGripSocks = it }
                    if ("Requires Waiver" in visible) AmenityToggle("Requires Waiver", requiresWaiver) { requiresWaiver = it }
                    // New amenities
                    if ("Outdoor Shower" in visible) AmenityToggle("Outdoor Shower", hasOutdoorShower) { hasOutdoorShower = it }
                    if ("Changing Rooms" in visible) AmenityToggle("Changing Rooms", hasChangingRooms) { hasChangingRooms = it }
                    if ("Lockers" in visible) AmenityToggle("Lockers", hasLockers) { hasLockers = it }
                    if ("Nursing Room" in visible) AmenityToggle("Nursing Room", hasNursingRoom) { hasNursingRoom = it }
                    if ("Party Room" in visible) AmenityToggle("Party Room", hasPartyRoom) { hasPartyRoom = it }
                    if ("Covered Seating" in visible) AmenityToggle("Covered Seating", hasCoveredSeating) { hasCoveredSeating = it }
                    if ("Food Services" in visible) AmenityToggle("Food Services", hasFoodServices) { hasFoodServices = it }
                    if ("Snack Bar" in visible) AmenityToggle("Snack Bar", hasSnackBar) { hasSnackBar = it }
                    if ("Alcohol On Site" in visible) AmenityToggle("Alcohol On Site", hasAlcoholOnSite) { hasAlcoholOnSite = it }
                    if ("Gift Shop" in visible) AmenityToggle("Gift Shop", hasGiftShop) { hasGiftShop = it }
                    if ("Rental Equipment" in visible) AmenityToggle("Rental Equipment", hasRentalEquipment) { hasRentalEquipment = it }
                    if ("Card Only" in visible) AmenityToggle("Card Only", isCardOnly) { isCardOnly = it }
                    if ("ATM" in visible) AmenityToggle("ATM", hasATM) { hasATM = it }
                    if ("Height/Age Restrictions" in visible) AmenityToggle("Height/Age Restrictions", hasHeightAgeRestrictions) { hasHeightAgeRestrictions = it }
                    if ("Arcade Games" in visible) AmenityToggle("Arcade Games", hasArcadeGames) { hasArcadeGames = it }
                    if ("Stroller Friendly" in visible) AmenityToggle("Stroller Friendly", isStrollerFriendly) { isStrollerFriendly = it }
                    if ("Sunscreen Station" in visible) AmenityToggle("Sunscreen Station", hasSunscreenStation) { hasSunscreenStation = it }
                    if ("Bug Spray Station" in visible) AmenityToggle("Bug Spray Station", hasBugSprayStation) { hasBugSprayStation = it }
                    if ("EV Charging" in visible) AmenityToggle("EV Charging", hasEVCharging) { hasEVCharging = it }
                }
                // Extra amenities = anything in the global catalog or already on the playground
                // that doesn't map to one of the hardcoded boolean toggles above. This is how
                // approved-via-suggestion options surface for everyone going forward.
                val extraAmenities = remember(amenityCatalog, customAmenities) {
                    val merged = (amenityCatalog + customAmenities).filter { it.isNotBlank() }
                    val seen = mutableSetOf<String>()
                    merged.filter { label ->
                        val k = label.lowercase().trim()
                        if (k in OptionCatalogDefaults.hardcodedAmenityKeys) return@filter false
                        seen.add(k)
                    }.sortedBy { it.lowercase() }
                }
                if (extraAmenities.isNotEmpty()) {
                    HorizontalDivider(color = FormColors.Divider, modifier = Modifier.padding(top = 8.dp))
                    Text(
                        "Other amenities",
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 14.sp,
                        modifier = Modifier.padding(top = 8.dp),
                    )
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        extraAmenities.forEach { label ->
                            val checked = label in customAmenities
                            CustomAmenityToggle(label = label, checked = checked) { isOn ->
                                customAmenities = if (isOn) customAmenities + label
                                else customAmenities.filterNot { it.equals(label, ignoreCase = true) }.toSet()
                            }
                        }
                    }
                }
                SuggestNewChip("Amenity") { cat ->
                    suggestionCategory = cat; suggestionText = ""; showSuggestionDialog = true
                }
            }

            // ── 6. REVIEW & NOTES ─────────────────────────────────────────────
            AccordionSection(
                title = "Review & Notes",
                expanded = expandedSection == "review",
                onToggle = { expandedSection = if (expandedSection == "review") "" else "review" }
            ) {
                if (userHasDisplayName != null) {
                    Text(
                        contributorAttributionLine(
                            if (isEdit) "Submitting update" else "Submitting new place",
                            listingPublicAttribution,
                        ),
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Color(0xFF006064),
                    )
                    if (parentRating > 0) {
                        Text(
                            contributorAttributionLine("Rating", listingPublicAttribution),
                            fontSize = 12.sp,
                            color = Color(0xFF424242),
                        )
                    }
                    Spacer(Modifier.height(6.dp))
                }
                if (parentRating > 0) {
                    RatingSlider(value = parentRating, onValueChange = { parentRating = it }, modifier = Modifier.fillMaxWidth())
                } else {
                    OutlinedButton(
                        onClick = { parentRating = 3 },
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(10.dp)
                    ) { Text("Tap to rate this playground") }
                }

                OutlinedTextField(
                    value = adminNotes, onValueChange = { adminNotes = it },
                    label = { Text("Comments to admin (optional)") },
                    placeholder = { Text("Anything we should know about this place?") },
                    modifier = Modifier.fillMaxWidth(), minLines = 2, maxLines = 4
                )

                Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = submitAnonymously, onCheckedChange = { submitAnonymously = it })
                    Spacer(Modifier.width(4.dp))
                    Text("Submit anonymously (won't appear on contributor board)", fontSize = 13.sp, color = Color.Gray, modifier = Modifier.weight(1f))
                }
            }

            errorMessage?.let {
                Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 4.dp))
            }
        } // end scrollable Column

        SnackbarHost(
            hostState = snackbarHostState,
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = 84.dp)
        )

        // ── STICKY BOTTOM BUTTONS ─────────────────────────────────────────────
        Surface(
            modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth(),
            color = Color(0xFFFFFFFF),
            shadowElevation = 8.dp,
            tonalElevation = 4.dp
        ) {
            Column(
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                when (userHasDisplayName) {
                    null -> Text(
                        "Loading how you appear on the contributor board…",
                        fontSize = 12.sp,
                        color = Color(0xFF757575),
                    )
                    else -> {
                        Text(
                            contributorAttributionLine(
                                if (isEdit) "Submitting update" else "Submitting new place",
                                listingPublicAttribution,
                            ),
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = Color(0xFF006064),
                        )
                        if (parentRating > 0) {
                            Text(
                                contributorAttributionLine("Rating", listingPublicAttribution),
                                fontSize = 12.sp,
                                color = Color(0xFF424242),
                            )
                        }
                    }
                }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                OutlinedButton(
                    onClick = {
                        if (hasChanges) showDiscardDialog = true else onComplete()
                    },
                    modifier = Modifier.weight(1f).height(52.dp),
                    shape = RoundedCornerShape(16.dp),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = Color(0xFF00CED1))
                ) {
                    Text("Cancel", fontWeight = FontWeight.Bold)
                }
                Button(
                    onClick = { proceedSubmitAfterDisplayNameGate() },
                    enabled = !isLoading && userHasDisplayName != null,
                    modifier = Modifier.weight(2f).height(52.dp),
                    shape = RoundedCornerShape(16.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF00CED1))
                ) {
                    if (isLoading) CircularProgressIndicator(modifier = Modifier.size(20.dp), color = Color.White)
                    else Text(if (isEdit) "Submit Update" else "Add Play Place", fontWeight = FontWeight.Bold, color = Color.White)
                }
            }
            }
        }

        // ── DIALOGS ───────────────────────────────────────────────────────────
        if (showConfirmation) {
            AlertDialog(
                onDismissRequest = {},
                title = {
                    Text(
                        if (editWasQueuedForReview) "Update submitted for review 🎉"
                        else "Thanks! Your update is live 🎉"
                    )
                },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (editWasQueuedForReview) {
                            Text(
                                pendingReviewMessage.ifBlank { "Moderators will review your changes before they appear for everyone." },
                                fontSize = 13.sp
                            )
                            Spacer(Modifier.height(4.dp))
                        }
                        Text(
                            if (editWasQueuedForReview) "Here's what you submitted:"
                            else "Here's what changed:",
                            fontSize = 13.sp
                        )
                        if (updatedFields.isEmpty()) {
                            Text("• No field changes detected", fontSize = 13.sp, color = Color.Gray)
                        } else {
                            updatedFields.forEach { field -> Text("• $field", fontSize = 13.sp) }
                        }
                        if (editWasQueuedForReview) {
                            Spacer(Modifier.height(4.dp))
                            Text("You can track status under My Submissions in the home menu.", fontSize = 12.sp, color = Color.Gray)
                        }
                    }
                },
                confirmButton = { Button(onClick = onComplete) { Text("Done") } }
            )
        }

        if (showPendingNewDialog) {
            AlertDialog(
                onDismissRequest = { showPendingNewDialog = false },
                title = { Text("Submission received") },
                text = {
                    Text(
                        pendingReviewMessage.ifBlank {
                            "Your new place is pending review. You'll be notified when it's approved."
                        },
                        fontSize = 14.sp
                    )
                    Spacer(Modifier.height(8.dp))
                    Text("Check My Submissions in the home menu for status.", fontSize = 12.sp, color = Color.Gray)
                },
                confirmButton = {
                    Button(onClick = {
                        showPendingNewDialog = false
                        onComplete()
                    }) { Text("OK") }
                }
            )
        }

        previewIndex?.let { startIndex ->
            val pagerState = rememberPagerState(initialPage = startIndex) { imageUrls.size }
            Dialog(
                onDismissRequest = { previewIndex = null },
                properties = DialogProperties(usePlatformDefaultWidth = false, dismissOnClickOutside = true)
            ) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Surface(color = Color.Black, modifier = Modifier.fillMaxSize()) {}
                    HorizontalPager(state = pagerState, modifier = Modifier.fillMaxSize()) { page ->
                        AsyncImage(model = imageUrls[page], contentDescription = null, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize())
                    }
                    Text("${pagerState.currentPage + 1} / ${imageUrls.size}", color = Color.White, fontSize = 13.sp, modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 24.dp))
                    IconButton(onClick = { previewIndex = null }, modifier = Modifier.align(Alignment.TopEnd).padding(16.dp)) {
                        Icon(MaterialIcons.Filled.Close, contentDescription = "Close", tint = Color.White)
                    }
                }
            }
        }

        if (showDiscardDialog) {
            AlertDialog(
                onDismissRequest = { showDiscardDialog = false },
                title = { Text("Discard changes?") },
                text = { Text("You have unsaved changes. Are you sure you want to go back?") },
                confirmButton = {
                    TextButton(onClick = { showDiscardDialog = false; onComplete() }) { Text("Discard", color = MaterialTheme.colorScheme.error) }
                },
                dismissButton = {
                    TextButton(onClick = { showDiscardDialog = false }) { Text("Keep Editing") }
                }
            )
        }

        if (showDisplayNameDialog) {
            AlertDialog(
                onDismissRequest = { if (!isSettingDisplayName) showDisplayNameDialog = false },
                title = { Text("Choose a display name") },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("Pick a name for the contributor leaderboard. This can be your first name, a nickname, or anything family-friendly.", fontSize = 13.sp, color = Color.Gray)
                        Text("Letters only, 2–30 characters. Spaces between words are OK. No numbers or punctuation.", fontSize = 12.sp, color = Color.Gray)
                        Text("Change anytime from Home → menu → Contributor display name.", fontSize = 11.sp, color = Color.Gray)
                        OutlinedTextField(
                            value = displayNameInput, onValueChange = { if (it.length <= 30) displayNameInput = it },
                            label = { Text("Display name") }, modifier = Modifier.fillMaxWidth(), singleLine = true, enabled = !isSettingDisplayName
                        )
                        val preview = normalizeContributorDisplayName(displayNameInput)
                        if (isValidContributorNameFormat(displayNameInput)) {
                            Text("Will display as: $preview", fontSize = 12.sp, color = Color(0xFF2E7D32))
                        }
                        displayNameError?.let { Text(it, color = MaterialTheme.colorScheme.error, fontSize = 13.sp) }
                        OutlinedButton(
                            onClick = {
                                scope.launch {
                                    isSettingDisplayName = true
                                    displayNameError = null
                                    try {
                                        service.setDisplayName(null)
                                        displayNameInput = ""
                                        userHasDisplayName = false
                                    } catch (e: Exception) {
                                        displayNameError = e.message ?: "Could not clear display name"
                                    } finally {
                                        isSettingDisplayName = false
                                    }
                                }
                            },
                            enabled = !isSettingDisplayName,
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text("Clear leaderboard name (account)") }
                    }
                },
                confirmButton = {
                    TextButton(
                        onClick = {
                            scope.launch {
                                isSettingDisplayName = true; displayNameError = null
                                try {
                                    val normalized = normalizeContributorDisplayName(displayNameInput)
                                    if (!isValidContributorNameFormat(normalized)) {
                                        displayNameError = contributorDisplayNameValidationMessage()
                                        return@launch
                                    }
                                    service.setDisplayName(normalized)
                                    userHasDisplayName = true
                                    myContributorDisplayName = normalized
                                    showDisplayNameDialog = false
                                    proceedSubmitAfterDisplayNameGate()
                                } catch (e: Exception) {
                                    displayNameError = e.message ?: "Failed to set display name"
                                } finally { isSettingDisplayName = false }
                            }
                        },
                        enabled = isValidContributorNameFormat(displayNameInput) && !isSettingDisplayName
                    ) {
                        if (isSettingDisplayName) CircularProgressIndicator(modifier = Modifier.size(16.dp))
                        else Text("Save & Continue")
                    }
                },
                dismissButton = {
                    TextButton(
                        onClick = {
                            submitAnonymously = true; userHasDisplayName = true; showDisplayNameDialog = false
                            proceedSubmitAfterDisplayNameGate()
                        },
                        enabled = !isSettingDisplayName
                    ) { Text("Skip (submit anonymously)") }
                }
            )
        }

        if (showSuggestionDialog) {
            AlertDialog(
                onDismissRequest = { if (!suggestionLoading) showSuggestionDialog = false },
                title = { Text("Suggest a new $suggestionCategory") },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(
                            contributorAttributionLine("Submitting suggestion", contributorPublicLabel(myContributorDisplayName)),
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = Color(0xFF006064),
                        )
                        Text("Your suggestion will be reviewed by our team. If approved, it will appear as an option for everyone.", fontSize = 13.sp, color = Color.Gray)
                        OutlinedTextField(value = suggestionText, onValueChange = { suggestionText = it }, label = { Text("Your suggestion") }, modifier = Modifier.fillMaxWidth(), enabled = !suggestionLoading)
                    }
                },
                confirmButton = {
                    TextButton(
                        onClick = {
                            val cat = suggestionCategory.trim()
                            val label = suggestionText.trim()
                            if (cat.isEmpty() || label.isEmpty()) return@TextButton
                            scope.launch {
                                suggestionLoading = true
                                try {
                                    val typeContext = if (playgroundType.isNotBlank()) " [Location Type: $playgroundType]" else ""
                                    val pid = playgroundToEdit.id ?: return@launch
                                    service.submitSupportTicket(
                                        ticketType = "SUGGESTION",
                                        message = "New $cat suggestion: $label$typeContext",
                                        targetKind = "playground",
                                        targetId = pid,
                                        suggestionCategory = cat,
                                        suggestionLabel = label,
                                    )
                                } catch (_: Exception) {}
                                showSuggestionDialog = false; suggestionLoading = false
                            }
                        },
                        enabled = !suggestionLoading && suggestionText.isNotBlank()
                    ) {
                        if (suggestionLoading) CircularProgressIndicator(modifier = Modifier.size(16.dp))
                        else Text("Submit")
                    }
                },
                dismissButton = {
                    TextButton(onClick = { showSuggestionDialog = false }, enabled = !suggestionLoading) { Text("Cancel") }
                }
            )
        }

        if (showReviewDialog) {
            AlertDialog(
                onDismissRequest = { showReviewDialog = false },
                title = { Text("Review Your Submission") },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.verticalScroll(rememberScrollState())) {
                        Text(
                            contributorAttributionLine("Submitting new place", listingPublicAttribution),
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = Color(0xFF006064),
                        )
                        if (parentRating > 0) {
                            Text(
                                contributorAttributionLine("Rating", listingPublicAttribution),
                                fontSize = 12.sp,
                                color = Color(0xFF424242),
                            )
                        }
                        if (name.isNotBlank()) Text("Name: $name", fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                        if (playgroundType.isNotBlank()) Text("Type: $playgroundType", fontSize = 13.sp)
                        if (address.isNotBlank()) Text("Address: $address", fontSize = 13.sp)
                        if (costRange.isNotBlank()) Text("Cost: $costRange", fontSize = 13.sp)
                        if (ageRange.isNotBlank()) Text("Age Range: $ageRange", fontSize = 13.sp)
                        if (hours.isNotBlank()) Text("Hours: $hours", fontSize = 13.sp)
                        if (equipment.isNotEmpty()) Text("Equipment: ${equipment.joinToString(", ")}", fontSize = 13.sp)
                        if (sportsCourts.isNotEmpty()) Text("Sports: ${sportsCourts.joinToString(", ")}", fontSize = 13.sp)
                        val confirmedAmenities = listOfNotNull(
                            if (hasBathrooms == true) "Bathrooms" else null,
                            if (hasShade == true) "Shade" else null,
                            if (isFenced == true) "Fenced" else null,
                            if (hasParking == true) "Parking" else null,
                            if (isAccessible == true) "Accessible" else null,
                        )
                        if (confirmedAmenities.isNotEmpty()) Text("Amenities: ${confirmedAmenities.joinToString(", ")}", fontSize = 13.sp)
                        Text("Photos: ${imageUrls.size}", fontSize = 13.sp)
                        if (locationPinned) Text("📍 Location pinned", fontSize = 13.sp, color = Color(0xFF4CAF50))
                    }
                },
                confirmButton = {
                    Button(
                        onClick = {
                            showReviewDialog = false
                            scope.launch {
                                isLoading = true; errorMessage = null
                                try {
                                    val lat = latStr.toDoubleOrNull()!!
                                    val lng = lngStr.toDoubleOrNull()!!
                                    val pg = playgroundToEdit.copy(
                                        name = name, description = description,
                                        address = address.ifBlank { null }, city = city.ifBlank { null }, state = state.ifBlank { null },
                                        latitude = lat, longitude = lng,
                                        playgroundType = playgroundType.ifBlank { null },
                                        groundType = groundTypes.joinToString(", ").ifBlank { null },
                                        costRange = costRange.ifBlank { null }, ageRange = ageRange.ifBlank { null },
                                        hours = hours.ifBlank { null }, website = website.ifBlank { null }, phoneNumber = phoneNumber.ifBlank { null },
                                        equipment = equipment.toList(), swingTypes = swingTypes.toList(),
                                        sportsCourts = sportsCourts.toList(), exerciseEquipment = exerciseEquipment.toList(),
                                        imageUrls = imageUrls.toList(),
                                        hasBathrooms = hasBathrooms, hasShade = hasShade, isFenced = isFenced,
                                        isToddlerFriendly = isToddlerFriendly, isDogFriendly = isDogFriendly,
                                        hasParking = hasParking, hasSplashPad = hasSplashPad, isAccessible = isAccessible,
                                        hasWifi = hasWifi, hasWalkingTrail = hasWalkingTrail, hasBottleFiller = hasBottleFiller,
                                        hasBenches = hasBenches, hasPicnicTables = hasPicnicTables, hasTrashCans = hasTrashCans,
                                        needsGripSocks = needsGripSocks, requiresWaiver = requiresWaiver,
                                        hasOutdoorShower = hasOutdoorShower, hasChangingRooms = hasChangingRooms,
                                        hasLockers = hasLockers, hasNursingRoom = hasNursingRoom,
                                        hasPartyRoom = hasPartyRoom, hasCoveredSeating = hasCoveredSeating,
                                        hasFoodServices = hasFoodServices, hasSnackBar = hasSnackBar,
                                        hasAlcoholOnSite = hasAlcoholOnSite, hasGiftShop = hasGiftShop,
                                        hasRentalEquipment = hasRentalEquipment, isCardOnly = isCardOnly,
                                        hasATM = hasATM, hasHeightAgeRestrictions = hasHeightAgeRestrictions,
                                        hasArcadeGames = hasArcadeGames, isStrollerFriendly = isStrollerFriendly,
                                        hasSunscreenStation = hasSunscreenStation, hasBugSprayStation = hasBugSprayStation,
                                        hasEVCharging = hasEVCharging,
                                        customAmenities = customAmenities.toList(),
                                        submittedBy = if (submitAnonymously) "Anonymous" else playgroundToEdit.submittedBy,
                                        notesForAdmin = adminNotes.ifBlank { null },
                                    )
                                    when (val outcome = service.createPlaygroundOrDuplicate(pg)) {
                                        is PlaygroundSaveOutcome.Duplicate -> {
                                            errorMessage = "This place may already exist. Try searching the map."
                                        }
                                        is PlaygroundSaveOutcome.PendingReview -> {
                                            pendingReviewMessage = outcome.message
                                            showPendingNewDialog = true
                                        }
                                        is PlaygroundSaveOutcome.Saved -> onComplete()
                                    }
                                } catch (e: Exception) {
                                    errorMessage = "Save failed: ${e.message}"
                                } finally {
                                    isLoading = false
                                }
                            }
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = FormColors.PrimaryButton)
                    ) { Text("Confirm & Submit", color = Color.White) }
                },
                dismissButton = {
                    TextButton(onClick = { showReviewDialog = false }) { Text("Go Back") }
                }
            )
        }
    } // end Box
}

// ── Accordion Section (matches playground detail: white card + teal accent) ───

private val AddEditAccordionCorner = 12.dp
private val AddEditAccordionAccentWidth = 4.dp

@Composable
private fun AccordionSection(
    title: String,
    subtitle: String? = null,
    expanded: Boolean,
    onToggle: () -> Unit,
    content: @Composable ColumnScope.() -> Unit,
) {
    Card(
        shape = RoundedCornerShape(AddEditAccordionCorner),
        colors = CardDefaults.cardColors(containerColor = Color.White),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Box(modifier = Modifier.fillMaxWidth()) {
            Box(
                modifier = Modifier
                    .align(Alignment.CenterStart)
                    .width(AddEditAccordionAccentWidth)
                    .fillMaxHeight()
                    .background(
                        FormColors.PrimaryButton,
                        RoundedCornerShape(
                            topStart = AddEditAccordionCorner,
                            bottomStart = AddEditAccordionCorner,
                        ),
                    ),
            )
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = AddEditAccordionAccentWidth),
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .then(
                            if (expanded) Modifier.background(FormColors.PrimaryButton.copy(alpha = 0.09f))
                            else Modifier,
                        )
                        .clickable(onClick = onToggle)
                        .padding(horizontal = 16.dp, vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(title, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, color = Color(0xFF212121))
                        if (!expanded && subtitle != null) {
                            Text(subtitle, fontSize = 12.sp, color = FormColors.SecondaryButtonText, maxLines = 1)
                        }
                    }
                    Icon(
                        if (expanded) MaterialIcons.Filled.ExpandLess else MaterialIcons.Filled.ExpandMore,
                        contentDescription = if (expanded) "Collapse" else "Expand",
                        tint = FormColors.SecondaryButtonText,
                    )
                }
                AnimatedVisibility(visible = expanded) {
                    Column {
                        Divider(color = FormColors.SubtleDivider)
                        Column(
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                            content = content,
                        )
                    }
                }
            }
        }
    }
}

// ── Helper Composables ────────────────────────────────────────────────────────

@Composable
private fun SuggestNewButton(category: String, onClick: (String) -> Unit) {
    TextButton(
        onClick = { onClick(category) },
        contentPadding = PaddingValues(horizontal = 4.dp, vertical = 0.dp)
    ) {
        Text("＋ Suggest a new $category", fontSize = 12.sp, color = FormColors.SecondaryButtonText)
    }
}

@Composable
private fun SuggestNewChip(category: String, onClick: (String) -> Unit) {
    Row(modifier = Modifier.padding(top = 4.dp)) {
        FilterChip(
            selected = false,
            onClick = { onClick(category) },
            label = { Text("＋ Suggest new $category", fontSize = 12.sp) },
            colors = FilterChipDefaults.filterChipColors(
                containerColor = FormColors.SuggestChip,
                labelColor = FormColors.SuggestChipText
            )
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ChipGroupWithSuggest(
    options: List<String>,
    selected: Set<String>,
    onToggle: (String) -> Unit,
    onSuggest: () -> Unit,
) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        options.forEach { option ->
            FilterChip(
                selected = option in selected,
                onClick = { onToggle(option) },
                label = { Text(option, fontSize = 12.sp) },
                colors = FilterChipDefaults.filterChipColors(
                    selectedContainerColor = FormColors.SelectedChip,
                    selectedLabelColor = FormColors.SelectedChipText
                )
            )
        }
        FilterChip(
            selected = false, onClick = onSuggest,
            label = { Text("＋ Suggest new", fontSize = 12.sp) },
            colors = FilterChipDefaults.filterChipColors(
                containerColor = FormColors.SuggestChip,
                labelColor = FormColors.SuggestChipText
            )
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ChipGroup(options: List<String>, selected: Set<String>, onToggle: (String) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        options.forEach { option ->
            FilterChip(
                selected = option in selected,
                onClick = { onToggle(option) },
                label = { Text(option, fontSize = 12.sp) },
                colors = FilterChipDefaults.filterChipColors(
                    selectedContainerColor = FormColors.SelectedChip,
                    selectedLabelColor = FormColors.SelectedChipText
                )
            )
        }
    }
}

@Composable
private fun AmenityToggle(label: String, value: Boolean?, onChange: (Boolean?) -> Unit) {
    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 0.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, modifier = Modifier.weight(1f), fontSize = 14.sp)
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            FilterChip(selected = value == true, onClick = { onChange(if (value == true) null else true) }, label = { Text("Yes", fontSize = 11.sp) }, colors = FilterChipDefaults.filterChipColors(selectedContainerColor = FormColors.SelectedChip, selectedLabelColor = FormColors.SelectedChipText))
            FilterChip(selected = value == false, onClick = { onChange(if (value == false) null else false) }, label = { Text("No", fontSize = 11.sp) }, colors = FilterChipDefaults.filterChipColors(selectedContainerColor = FormColors.SelectedChip, selectedLabelColor = FormColors.SelectedChipText))
        }
    }
}

/**
 * Yes/no toggle for amenities that come from the suggestion catalog (or were already on the
 * playground but aren't one of the hardcoded boolean fields). Adds or removes the label
 * from a Set<String> instead of toggling a Boolean.
 */
@Composable
private fun CustomAmenityToggle(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 0.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, modifier = Modifier.weight(1f), fontSize = 14.sp)
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            FilterChip(
                selected = checked,
                onClick = { onChange(!checked) },
                label = { Text("Yes", fontSize = 11.sp) },
                colors = FilterChipDefaults.filterChipColors(
                    selectedContainerColor = FormColors.SelectedChip,
                    selectedLabelColor = FormColors.SelectedChipText,
                ),
            )
            FilterChip(
                selected = !checked,
                onClick = { onChange(false) },
                label = { Text("No", fontSize = 11.sp) },
                colors = FilterChipDefaults.filterChipColors(
                    selectedContainerColor = FormColors.SelectedChip,
                    selectedLabelColor = FormColors.SelectedChipText,
                ),
            )
        }
    }
}

