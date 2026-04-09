package org.community.playgroundfinder.ui.screens.details

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Divider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import coil3.compose.AsyncImage
import kotlinx.coroutines.launch
import org.community.playgroundfinder.data.Playground
import org.community.playgroundfinder.data.PlaygroundService
import org.community.playgroundfinder.data.SubVenue
import org.community.playgroundfinder.ui.composables.AmenityTypeMapping
import org.community.playgroundfinder.ui.composables.FormColors
import org.community.playgroundfinder.ui.composables.PlaygroundDescriptionWithLinks
import org.community.playgroundfinder.ui.composables.QuickVerifyDialog
import org.community.playgroundfinder.ui.composables.playgroundPlaceholderPainter
import org.community.playgroundfinder.util.isValidContributorNameFormat
import org.community.playgroundfinder.util.parseHexColor
import org.community.playgroundfinder.util.dedupePlaygroundImageUrls
import org.community.playgroundfinder.util.rememberOpenExternalUrl
import org.community.playgroundfinder.util.rememberOpenMapDirections
import org.community.playgroundfinder.util.rememberSettings
import kotlinx.datetime.Clock
import kotlinx.datetime.TimeZone
import kotlinx.datetime.todayIn
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt
import androidx.compose.material.icons.Icons as MaterialIcons

/** Best-effort address for the description panel (formatted street, cross streets, or city/state). */
private fun addressLineForDetail(pg: Playground): String? {
    pg.address?.trim()?.takeIf { it.isNotEmpty() }?.let { return it }
    pg.crossStreets?.trim()?.takeIf { it.isNotEmpty() }?.let { return "Near $it" }
    val cityStateZip = listOfNotNull(
        pg.city?.trim()?.takeIf { it.isNotEmpty() },
        pg.state?.trim()?.takeIf { it.isNotEmpty() },
        pg.zipCode?.trim()?.takeIf { it.isNotEmpty() },
    )
    if (cityStateZip.isNotEmpty()) return cityStateZip.joinToString(", ")
    return null
}

private val amenityEmoji = mapOf(
    "Bathrooms"           to "🚻", "Shade" to "🌳", "Fenced" to "🚧",
    "Toddler Friendly"    to "👶", "Dog Friendly" to "🐕", "Parking" to "🅿️",
    "Splash Pad"          to "💦", "Accessible" to "♿", "WiFi" to "📶",
    "Walking Trail"       to "🥾", "Water Fountain" to "🚰", "Benches" to "🪑",
    "Picnic Tables"       to "🧺", "Trash Cans" to "🗑️",
    "Requires Grip Socks" to "🧦", "Requires Waiver" to "📋",
    "Outdoor Shower" to "🚿", "Changing Rooms" to "👗", "Lockers" to "🔒",
    "Nursing Room" to "🤱", "Party Room" to "🎉", "Covered Seating" to "🏛️",
    "Food Services" to "🍽️", "Snack Bar" to "🍿", "Alcohol On Site" to "🍺",
    "Gift Shop" to "🎁", "Rental Equipment" to "⛸️", "Card Only" to "💳",
    "ATM" to "🏧", "Height/Age Restrictions" to "📏", "Arcade Games" to "🕹️",
    "Stroller Friendly" to "👶", "Sunscreen Station" to "☀️",
    "Bug Spray Station" to "🦟", "EV Charging" to "🔌",
)

private val equipmentEmoji = mapOf(
    "Swings" to "🪁", "Slide" to "🛝", "Climbing Wall" to "🧗",
    "Monkey Bars" to "🙈", "Sandbox" to "🏖️", "Merry-Go-Round" to "🎠",
    "See-Saw" to "⚖️", "Seesaw" to "⚖️", "Spring Riders" to "🐴",
    "Zip Line" to "🪂", "Trampoline" to "��", "Balance Beam" to "🎯",
    "Tunnel" to "🕳️", "Standard Swings" to "🪁", "Baby Swings" to "👶",
    "Belt" to "🪁", "Bucket" to "🪣", "Tire" to "🔄", "Tire Swings" to "🔄",
    "Accessible Swings" to "♿", "Grass" to "🌿", "Rubber" to "🔴",
    "Wood Chips" to "🪵", "Sand" to "🏖️", "Pea Gravel" to "🪨",
    "Concrete" to "🏗️", "Turf" to "🟩",
    "Pull-up Bar" to "🏋️", "Fitness Station" to "💪", "Outdoor Gym" to "🏃",
    "Parallel Bars" to "🤸", "Walking Trail Exercise Stops" to "🥾",
    "Football" to "🏈", "Basketball" to "🏀", "Soccer" to "⚽",
    "Tennis" to "🎾", "Pickleball" to "🏓", "Volleyball" to "🏐",
    "Sand Volleyball" to "🏐", "Baseball" to "⚾", "Softball" to "🥎",
)

private fun haversineMeters(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
    val r = 6_371_000.0
    val dLat = Math.toRadians(lat2 - lat1)
    val dLon = Math.toRadians(lon2 - lon1)
    val a = sin(dLat / 2).pow(2) + cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(dLon / 2).pow(2)
    return r * 2 * atan2(sqrt(a), sqrt(1 - a))
}

private fun formatDistance(meters: Double): String {
    val miles = meters / 1609.34
    return if (miles < 0.1) "< 0.1 mi" else if (miles < 10) "%.1f mi".format(miles) else "%.0f mi".format(miles)
}

@Composable
private fun LightboxZoomableImage(
    imageUrl: String,
    pageIndex: Int,
    currentPage: Int,
    onZoomedChanged: (Boolean) -> Unit,
) {
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    LaunchedEffect(currentPage) {
        if (currentPage != pageIndex) {
            scale = 1f
            offset = Offset.Zero
        }
    }
    val transformState = rememberTransformableState { zoomChange, panChange, _ ->
        val next = (scale * zoomChange).coerceIn(1f, 8f)
        scale = next
        offset += panChange
        if (currentPage == pageIndex) {
            onZoomedChanged(next > 1.02f)
        }
    }
    Box(
        modifier = Modifier.fillMaxSize(),
        contentAlignment = Alignment.Center,
    ) {
        AsyncImage(
            model = imageUrl,
            contentDescription = null,
            contentScale = ContentScale.Fit,
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 8.dp)
                .graphicsLayer {
                    scaleX = scale
                    scaleY = scale
                    translationX = offset.x
                    translationY = offset.y
                }
                .transformable(transformState),
        )
    }
}

@Composable
private fun SubSectionLabel(text: String) {
    Text(text, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Color(0xFF212121), modifier = Modifier.padding(top = 6.dp, bottom = 2.dp))
}


private val AccordionCardCorner = 12.dp
private val AccordionAccentWidth = 4.dp

@Composable
private fun AccordionSection(title: String, expanded: Boolean, onToggle: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(AccordionCardCorner),
        colors = CardDefaults.cardColors(containerColor = Color.White),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) {
        // Box + fillMaxHeight stripe — avoid Row(IntrinsicSize.Min) inside verticalScroll (runtime measure crash)
        Box(modifier = Modifier.fillMaxWidth()) {
            Box(
                modifier = Modifier
                    .align(Alignment.CenterStart)
                    .width(AccordionAccentWidth)
                    .fillMaxHeight()
                    .background(
                        FormColors.PrimaryButton,
                        RoundedCornerShape(topStart = AccordionCardCorner, bottomStart = AccordionCardCorner),
                    ),
            )
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = AccordionAccentWidth),
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .then(
                            if (expanded) {
                                Modifier.background(FormColors.PrimaryButton.copy(alpha = 0.09f))
                            } else {
                                Modifier
                            },
                        )
                        .clickable { onToggle() }
                        .padding(horizontal = 16.dp, vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(title, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, color = Color(0xFF212121), modifier = Modifier.weight(1f))
                    Icon(if (expanded) MaterialIcons.Filled.ExpandLess else MaterialIcons.Filled.ExpandMore, contentDescription = null, tint = FormColors.SecondaryButtonText)
                }
                if (expanded) {
                    Divider(color = FormColors.SubtleDivider)
                    Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp)) { content() }
                }
            }
        }
    }
}

@Composable
private fun MetaChip(label: String) {
    Surface(shape = RoundedCornerShape(20.dp), color = FormColors.InfoChipBackground, modifier = Modifier.padding(end = 6.dp, bottom = 4.dp)) {
        Text(label, fontSize = 12.sp, color = FormColors.BodyText, fontWeight = FontWeight.Medium, modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp))
    }
}

@Composable
private fun SubVenueRow(sv: SubVenue) {
    Surface(shape = RoundedCornerShape(10.dp), color = Color(0xFFF0F4F8), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp)) {
            Text(sv.name, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, color = Color(0xFF212121))
            sv.playgroundType?.takeIf { it.isNotBlank() }?.let { type ->
                Spacer(Modifier.height(6.dp))
                MetaChip(type)
            }
            val combined = (sv.features + sv.equipment).distinct().filter { it.isNotBlank() }
            if (combined.isNotEmpty()) {
                Spacer(Modifier.height(6.dp))
                Text(combined.joinToString(" · "), fontSize = 12.sp, color = Color(0xFF616161), lineHeight = 16.sp)
            }
        }
    }
}

/** Compact crowd pill for the metadata chip row (scrolls with type, distance, cost). */
@Composable
private fun CrowdMetaChip(crowdLevel: String?) {
    val normalized = crowdLevel?.trim()?.lowercase()
    val (emoji, color, label) = when (normalized) {
        "low" -> Triple("🟢", Color(0xFF4CAF50), "Low")
        "medium" -> Triple("🟡", Color(0xFFFFC107), "Medium")
        "high" -> Triple("🔴", Color(0xFFF44336), "High")
        else -> Triple("⚪", Color.Gray, "No recent reports")
    }
    Surface(shape = RoundedCornerShape(20.dp), color = color.copy(alpha = 0.14f)) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
        ) {
            Text(emoji, fontSize = 14.sp)
            Spacer(Modifier.width(6.dp))
            Text("Crowd: $label", fontSize = 12.sp, color = color, fontWeight = FontWeight.SemiBold)
        }
    }
}


@Composable
private fun EmojiDetailRow(label: String, emoji: String, confirmed: Boolean? = true, photoEvidence: String? = null) {
    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp), verticalAlignment = Alignment.CenterVertically) {
        Text("•", fontSize = 18.sp, modifier = Modifier.width(20.dp))
        Text(label, fontSize = 14.sp, modifier = Modifier.weight(1f), color = when (confirmed) {
            true -> Color(0xFF212121)
            false -> Color(0xFF9E9E9E)
            null -> Color(0xFF9E9E9E)
        })
        when (photoEvidence) {
            "confirmed" -> Text("📷", fontSize = 12.sp, modifier = Modifier.padding(end = 4.dp))
            "noEvidence" -> Text("❓", fontSize = 12.sp, modifier = Modifier.padding(end = 4.dp))
        }
        when (confirmed) {
            true -> Text("✓", fontSize = 13.sp, color = Color(0xFF4CAF50))
            false -> Text("✗", fontSize = 13.sp, color = Color(0xFFE53935))
            null -> Text("?", fontSize = 13.sp, color = Color(0xFF9E9E9E))
        }
    }
}

@Composable
private fun ColumnScope.TriStateItemList(
    allItems: List<Pair<String, Boolean?>>,
    emojiMap: Map<String, String>,
    defaultEmoji: String,
    photoConfirmed: Set<String> = emptySet(),
    photoNoEvidence: Set<String> = emptySet(),
) {
    fun evidenceFor(label: String): String? {
        val lower = label.lowercase()
        if (photoConfirmed.any { it.lowercase() == lower }) return "confirmed"
        if (photoNoEvidence.any { it.lowercase() == lower }) return "noEvidence"
        return null
    }
    val confirmed = allItems.filter { it.second == true }
    val notPresent = allItems.filter { it.second == false }
    val unconfirmed = allItems.filter { it.second == null }
    confirmed.forEach { (label, _) ->
        EmojiDetailRow(label, emojiMap[label] ?: defaultEmoji, confirmed = true, photoEvidence = evidenceFor(label))
    }
    val hiddenItems = notPresent + unconfirmed
    if (hiddenItems.isNotEmpty()) {
        var hiddenExpanded by remember { mutableStateOf(false) }
        Spacer(Modifier.height(4.dp))
        Row(
            modifier = Modifier.fillMaxWidth().clickable { hiddenExpanded = !hiddenExpanded }.padding(vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text("Unconfirmed or not available (${hiddenItems.size})", fontSize = 12.sp, color = Color(0xFF9E9E9E), modifier = Modifier.weight(1f))
            Icon(if (hiddenExpanded) MaterialIcons.Filled.ExpandLess else MaterialIcons.Filled.ExpandMore, contentDescription = null, tint = FormColors.SecondaryButtonText, modifier = Modifier.size(16.dp))
        }
        if (hiddenExpanded) {
            notPresent.forEach { (label, _) -> EmojiDetailRow(label, emojiMap[label] ?: defaultEmoji, confirmed = false, photoEvidence = evidenceFor(label)) }
            unconfirmed.forEach { (label, _) -> EmojiDetailRow(label, emojiMap[label] ?: defaultEmoji, confirmed = null, photoEvidence = evidenceFor(label)) }
        }
    }
}
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun PlaygroundDetailScreen(
    service: PlaygroundService,
    playground: Playground,
    userId: String,
    userLat: Double? = null,
    userLng: Double? = null,
    onEditClick: (Playground) -> Unit,
    onNavigateToSupportTicket: (String?) -> Unit,
    onNavigateToMap: (Playground) -> Unit = {},
) {
    val scope = rememberCoroutineScope()
    val openMapDirections = rememberOpenMapDirections()
    val openExternal = rememberOpenExternalUrl()
    val settings = rememberSettings()
    val snackbarHostState = remember { SnackbarHostState() }
    // Key by id so navigating between places resets state; list snapshot seeds first paint.
    var pg by remember(playground.id) { mutableStateOf(playground) }
    var isFavorited by remember(playground.id) { mutableStateOf(playground.isFavorited) }

    // Refresh the playground from server so crowd/rating/verification info is current.
    LaunchedEffect(playground.id) {
        if (!playground.id.isNullOrBlank()) {
            runCatching { service.getPlaygroundById(playground.id!!) }
                .onSuccess { latest -> pg = latest }
        }
    }

    // Fetch actual favorite status from server on screen load
    LaunchedEffect(pg.id) {
        if (pg.id != null) {
            try {
                val favs = service.getFavorites(userId)
                isFavorited = favs.any { it.id == pg.id }
            } catch (_: Exception) {}
        }
    }

    var amenitiesExpanded    by remember { mutableStateOf(false) }
    var equipmentExpanded    by remember { mutableStateOf(false) }
    var sportsExpanded       by remember { mutableStateOf(false) }
    var verificationExpanded by remember { mutableStateOf(false) }
    var descriptionExpanded  by remember { mutableStateOf(false) }
    var hoursExpanded        by remember { mutableStateOf(false) }
    var subVenuesExpanded    by remember { mutableStateOf(false) }

    var lightboxIndex by remember { mutableStateOf<Int?>(null) }
    var lightboxPagerLocked by remember { mutableStateOf(false) }

    val displayImageUrls = remember(pg.id, pg.imageUrls) {
        dedupePlaygroundImageUrls(pg.imageUrls)
    }

    // Quick Verify dialog state
    var showQuickVerify    by remember { mutableStateOf(false) }
    var quickVerifyLoading by remember { mutableStateOf(false) }
    var quickVerifySuccess by remember { mutableStateOf(false) }
    var quickVerifyError   by remember { mutableStateOf<String?>(null) }
    val todayIso = remember {
        Clock.System.todayIn(TimeZone.currentSystemDefault()).toString()
    }
    val quickVerifyKey = remember(pg.id, userId) { "quick_verify_${userId}_${pg.id.orEmpty()}" }
    var alreadyVerifiedToday by remember(pg.id, userId) {
        mutableStateOf(settings.getString(quickVerifyKey, "") == todayIso)
    }

    var hasVerified by remember { mutableStateOf(false) }
    var isVerifying by remember { mutableStateOf(false) }
    var showFeedbackChoice by remember { mutableStateOf(false) }
    var showReportDialog   by remember { mutableStateOf(false) }
    var reportText         by remember { mutableStateOf("") }
    var reportLoading      by remember { mutableStateOf(false) }
    var showDeleteConfirm  by remember { mutableStateOf(false) }
    var removalReason      by remember { mutableStateOf("") }

    // Display name prompt state (shown before verify if user has no display name)
    var showDisplayNameDialog by remember { mutableStateOf(false) }
    var displayNameInput by remember { mutableStateOf("") }
    var displayNameError by remember { mutableStateOf<String?>(null) }
    var isSettingDisplayName by remember { mutableStateOf(false) }
    var userHasDisplayName by remember { mutableStateOf(true) }
    var verifyFirstName by remember { mutableStateOf("") }
    var verifyLastInitial by remember { mutableStateOf("") }
    var quickVerifyNameError by remember { mutableStateOf<String?>(null) }

    // Check if user has a display name on load
    LaunchedEffect(userId) {
        try {
            val profile = service.getMyContributorProfile()
            userHasDisplayName = !profile.displayName.isNullOrBlank()
        } catch (_: Exception) {}
    }

    val distanceText = remember(pg, userLat, userLng) {
        val dm = pg.distanceMeters
        when {
            dm != null && dm > 0 -> formatDistance(dm)
            userLat != null && userLng != null && pg.latitude != 0.0 && pg.longitude != 0.0 ->
                formatDistance(haversineMeters(userLat, userLng, pg.latitude, pg.longitude))
            else -> null
        }
    }

    val amenityFields = listOf(
        "Bathrooms" to pg.hasBathrooms, "Shade" to pg.hasShade, "Fenced" to pg.isFenced,
        "Toddler Friendly" to pg.isToddlerFriendly, "Dog Friendly" to pg.isDogFriendly,
        "Parking" to pg.hasParking, "Splash Pad" to pg.hasSplashPad, "Accessible" to pg.isAccessible,
        "WiFi" to pg.hasWifi, "Walking Trail" to pg.hasWalkingTrail, "Water Fountain" to pg.hasWaterFountain,
        "Benches" to pg.hasBenches, "Picnic Tables" to pg.hasPicnicTables, "Trash Cans" to pg.hasTrashCans,
        "Requires Grip Socks" to pg.needsGripSocks, "Requires Waiver" to pg.requiresWaiver,
        "Outdoor Shower" to pg.hasOutdoorShower,
        "Changing Rooms" to pg.hasChangingRooms,
        "Lockers" to pg.hasLockers,
        "Nursing Room" to pg.hasNursingRoom,
        "Party Room" to pg.hasPartyRoom,
        "Covered Seating" to pg.hasCoveredSeating,
        "Food Services" to pg.hasFoodServices,
        "Snack Bar" to pg.hasSnackBar,
        "Alcohol On Site" to pg.hasAlcoholOnSite,
        "Gift Shop" to pg.hasGiftShop,
        "Rental Equipment" to pg.hasRentalEquipment,
        "Card Only" to pg.isCardOnly,
        "ATM" to pg.hasATM,
        "Height/Age Restrictions" to pg.hasHeightAgeRestrictions,
        "Arcade Games" to pg.hasArcadeGames,
        "Stroller Friendly" to pg.isStrollerFriendly,
        "Sunscreen Station" to pg.hasSunscreenStation,
        "Bug Spray Station" to pg.hasBugSprayStation,
        "EV Charging" to pg.hasEVCharging,
    )

    val typeConfig = AmenityTypeMapping.getConfigForType(pg.playgroundType)
    val filteredAmenityFields = amenityFields.filter { (name, _) -> name in typeConfig.visibleAmenities }

    val allEquipmentLabels = listOf("Swings", "Slide", "Climbing Wall", "Monkey Bars", "Sandbox", "Seesaw", "Spring Riders", "Balance Beam", "Zip Line")
    val allSwingLabels     = listOf("Belt", "Bucket", "Tire", "Accessible")
    val equipmentFields    = allEquipmentLabels.map { it to if (pg.equipment.contains(it)) true else null }
    val swingFields        = allSwingLabels.map { it to if (pg.swingTypes.contains(it)) true else null }

    val allSportsLabels   = listOf("Football", "Basketball", "Soccer", "Tennis", "Pickleball", "Volleyball", "Sand Volleyball", "Baseball", "Softball")
    val allExerciseLabels = listOf("Pull-up Bar", "Fitness Station", "Walking Trail Exercise Stops", "Outdoor Gym", "Balance Beam", "Parallel Bars")
    val sportsFields      = allSportsLabels.map { it to if (pg.sportsCourts.contains(it)) true else null }
    val exerciseFields    = allExerciseLabels.map { it to if (pg.exerciseEquipment.contains(it)) true else null }

    // Photo validation confidence data
    val pv = pg.photoValidation
    val pvConfirmedEquip = pv?.confirmed?.equipment?.toSet() ?: emptySet()
    val pvNoEvidenceEquip = pv?.noPhotoEvidence?.equipment?.toSet() ?: emptySet()
    val pvConfirmedSwings = pv?.confirmed?.swingTypes?.toSet() ?: emptySet()
    val pvNoEvidenceSwings = pv?.noPhotoEvidence?.swingTypes?.toSet() ?: emptySet()
    val pvConfirmedSports = pv?.confirmed?.sportsCourts?.toSet() ?: emptySet()
    val pvNoEvidenceSports = pv?.noPhotoEvidence?.sportsCourts?.toSet() ?: emptySet()
    val pvConfirmedAmenities = pv?.confirmed?.amenities?.toSet() ?: emptySet()
    val pvNoEvidenceAmenities = pv?.noPhotoEvidence?.amenities?.toSet() ?: emptySet()

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Spacer(Modifier.height(8.dp))
        if (displayImageUrls.isNotEmpty()) {
            LazyRow(
                modifier = Modifier.fillMaxWidth().height(300.dp),
                contentPadding = PaddingValues(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                itemsIndexed(displayImageUrls, key = { _, u -> u }) { index, url ->
                    AsyncImage(
                        model = url,
                        contentDescription = null,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier
                            .fillParentMaxWidth(0.92f)
                            .fillMaxHeight()
                            .clip(RoundedCornerShape(12.dp))
                            .clickable { lightboxIndex = index },
                    )
                }
            }
        } else {
            Box(
                modifier = Modifier.fillMaxWidth().height(300.dp).padding(horizontal = 16.dp).clip(RoundedCornerShape(12.dp)).background(FormColors.CardBackground),
                contentAlignment = Alignment.Center
            ) {
                Image(
                    painter = playgroundPlaceholderPainter(pg.playgroundType),
                    contentDescription = pg.playgroundType ?: "Play Place",
                    modifier = Modifier.fillMaxSize(),
                    contentScale = ContentScale.FillWidth
                )
            }
        }

        Column(modifier = Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {

            var showListPicker by remember { mutableStateOf(false) }

            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    pg.name,
                    fontSize = 22.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color(0xFF212121),
                    modifier = Modifier.weight(1f)
                )
                IconButton(onClick = {
                    scope.launch {
                        try { service.toggleFavorite(pg.id!!, userId); isFavorited = !isFavorited } catch (_: Exception) {}
                    }
                }) {
                    Icon(if (isFavorited) MaterialIcons.Filled.Favorite else MaterialIcons.Filled.FavoriteBorder,
                        contentDescription = "Favorite", tint = if (isFavorited) Color(0xFFF06292) else Color.Gray)
                }
                // Add to list / edit — filled teal to match primary actions
                IconButton(
                    onClick = { showListPicker = true },
                    colors = IconButtonDefaults.iconButtonColors(
                        containerColor = FormColors.PrimaryButton,
                        contentColor = FormColors.PrimaryButtonText,
                    ),
                ) {
                    Icon(MaterialIcons.Filled.Add, contentDescription = "Add to List")
                }
                IconButton(
                    onClick = { onEditClick(pg) },
                    colors = IconButtonDefaults.iconButtonColors(
                        containerColor = FormColors.PrimaryButton,
                        contentColor = FormColors.PrimaryButtonText,
                    ),
                ) {
                    Icon(MaterialIcons.Filled.Edit, contentDescription = "Edit")
                }
            }

            if (showListPicker) {
                var lists by remember { mutableStateOf<List<org.community.playgroundfinder.models.PlayListSummary>>(emptyList()) }
                var listsLoading by remember { mutableStateOf(true) }
                val colorOptions = listOf("#1565C0", "#2E7D32", "#C62828", "#6A1B9A", "#E65100", "#00838F", "#AD1457", "#4E342E", "#37474F")
                var selectedColor by remember { mutableStateOf(colorOptions[0]) }
                LaunchedEffect(Unit) {
                    try { lists = service.getLists() } catch (_: Exception) {}
                    listsLoading = false
                }
                AlertDialog(
                    onDismissRequest = { showListPicker = false },
                    title = { Text("Add to List") },
                    text = {
                        if (listsLoading) {
                            Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                                CircularProgressIndicator(modifier = Modifier.size(24.dp))
                            }
                        } else if (lists.isEmpty()) {
                            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                var newListName by remember { mutableStateOf("") }
                                var isCreating by remember { mutableStateOf(false) }
                                Text("Create a new list:", fontSize = 13.sp, color = Color.Gray)
                                OutlinedTextField(value = newListName, onValueChange = { if (it.length <= 20) newListName = it }, label = { Text("List name") }, modifier = Modifier.fillMaxWidth(), singleLine = true, enabled = !isCreating)
                                Button(onClick = { scope.launch { isCreating = true; try { val nid = service.createList(newListName.trim()); service.addToList(nid, pg.id!!); showListPicker = false } catch (_: Exception) {} finally { isCreating = false } } }, enabled = newListName.isNotBlank() && !isCreating, modifier = Modifier.fillMaxWidth()) { Text("Create & Add") }
                            }
                        } else {
                            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                lists.forEach { list ->
                                    TextButton(onClick = {
                                        scope.launch {
                                            try { service.addToList(list.id, pg.id!!) } catch (_: Exception) {}
                                        }
                                        showListPicker = false
                                    }) {
                                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                                val listColor = list.color?.let { parseHexColor(it) } ?: FormColors.PrimaryButton
                                                Box(modifier = Modifier.size(12.dp).clip(androidx.compose.foundation.shape.CircleShape).background(listColor))
                                                Text(list.name, modifier = Modifier.weight(1f))
                                            }
                                    }
                                }
                            }
                        }
                    },
                    confirmButton = {},
                    dismissButton = { TextButton(onClick = { showListPicker = false }) { Text("Cancel") } }
                )
            }

            // Compact info row: type, rating, distance, cost on one scrollable line
            val typeLabel = pg.playgroundType?.takeIf { it.isNotBlank() } ?: "Park"
            val t = typeLabel.lowercase().trim()
            val typeBg = when {
                t.contains("library") -> FormColors.InfoChipBackground; t.contains("school") -> Color(0xFFFFF9C4)
                t.contains("splash") -> Color.White; t.contains("indoor") || t.contains("amusement") -> Color(0xFFFFF3E0)
                t.contains("museum") || t.contains("zoo") || t.contains("aquarium") -> Color(0xFFFCE4EC)
                t.contains("trail") || t.contains("nature") -> Color(0xFFFCE4EC)
                t.contains("neighborhood") || t.contains("city park") || t.contains("playground") || t.contains("public") -> Color(0xFFE8F5E9)
                else -> Color(0xFFEEEEEE)
            }
            val typeFg = when {
                t.contains("library") -> Color(0xFF37474F); t.contains("school") -> Color(0xFFF9A825)
                t.contains("splash") -> Color(0xFF00838F); t.contains("indoor") || t.contains("amusement") -> Color(0xFFE65100)
                t.contains("museum") || t.contains("zoo") || t.contains("aquarium") -> Color(0xFF880E4F)
                t.contains("trail") || t.contains("nature") -> Color(0xFFC2185B)
                t.contains("neighborhood") || t.contains("city park") || t.contains("playground") || t.contains("public") -> Color(0xFF2E7D32)
                else -> Color(0xFF424242)
            }
            val freeTypes = setOf("public park", "neighborhood park", "city park", "elementary school", "nature trail", "playground", "splash pad")
            val isFreeType = freeTypes.any { (pg.playgroundType?.lowercase() ?: "").contains(it) }
            val rawCost = (pg.costRange ?: pg.expense)?.trim()
            val displayCost = when {
                rawCost.isNullOrBlank() && isFreeType -> "Free"
                rawCost.isNullOrBlank() -> null
                rawCost.equals("Unknown", ignoreCase = true) || rawCost.equals("Varies", ignoreCase = true) -> if (isFreeType) "Free" else null
                else -> rawCost
            }
            val ratingDisplay = if (pg.ratingCount > 0 && pg.rating != null) "%.1f (%d)".format(pg.rating, pg.ratingCount) else null

            Surface(
                shape = RoundedCornerShape(12.dp),
                color = Color.White,
                shadowElevation = 1.dp,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.padding(12.dp).horizontalScroll(rememberScrollState()),
                ) {
                    Surface(shape = RoundedCornerShape(20.dp), color = typeBg) {
                        Text(typeLabel, fontSize = 12.sp, color = typeFg, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp))
                    }
                    if (ratingDisplay != null) Text("⭐ $ratingDisplay", fontSize = 12.sp, color = Color(0xFF424242))
                    else Text("No ratings", fontSize = 11.sp, color = Color(0xFF9E9E9E))
                    distanceText?.let {
                        Surface(shape = RoundedCornerShape(20.dp), color = FormColors.InfoChipBackground) {
                            Text(
                                "📍 $it",
                                fontSize = 12.sp,
                                color = FormColors.BodyText,
                                fontWeight = FontWeight.SemiBold,
                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                            )
                        }
                    }
                    displayCost?.let { Text("💲 Cost/person: $it", fontSize = 12.sp, color = Color(0xFF212121), fontWeight = FontWeight.SemiBold) }
                    CrowdMetaChip(pg.crowdLevel)
                }
            }

            // Ground + accordions; crowd sits in scrollable metadata row above
            pg.groundType?.takeIf { it.isNotBlank() }?.let { ground ->
                Surface(shape = RoundedCornerShape(20.dp), color = FormColors.PrimaryButton, modifier = Modifier.padding(bottom = 4.dp)) {
                    Text(
                        "Ground: $ground",
                        fontSize = 12.sp,
                        color = Color.White,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp)
                    )
                }
            }

            pg.ageRange?.takeIf { it.isNotBlank() }?.let { ageRange ->
                Text("👶 Ages: $ageRange", fontSize = 13.sp, color = Color(0xFF424242), modifier = Modifier.padding(vertical = 1.dp))
            }
            AccordionSection(title = "📝 Description", expanded = descriptionExpanded, onToggle = { descriptionExpanded = !descriptionExpanded }) {
                val addressLine = addressLineForDetail(pg)
                if (addressLine != null) {
                    Text(
                        "🏠 $addressLine",
                        fontSize = 14.sp,
                        color = Color(0xFF424242),
                        fontWeight = FontWeight.Medium,
                    )
                    Spacer(Modifier.height(10.dp))
                } else if (pg.latitude != 0.0 || pg.longitude != 0.0) {
                    Text(
                        "Address not on file yet — opening details from Google may add it.",
                        fontSize = 13.sp,
                        color = Color(0xFF757575),
                    )
                    Spacer(Modifier.height(10.dp))
                }
                if (pg.description.isNotBlank()) {
                    PlaygroundDescriptionWithLinks(
                        text = pg.description,
                        fontSize = 14.sp,
                        baseColor = Color(0xFF424242),
                        onLinkClick = openExternal,
                    )
                    Spacer(Modifier.height(6.dp))
                    Text("Source: Google / AI-generated. May be inaccurate.", fontSize = 11.sp, color = Color(0xFF9E9E9E))
                    Spacer(Modifier.height(10.dp))
                } else {
                    Text(
                        "No written description on file yet. Get directions opens the place in Google Maps for full details.",
                        fontSize = 13.sp,
                        color = Color(0xFF757575),
                    )
                    Spacer(Modifier.height(10.dp))
                }
                Button(
                    onClick = {
                        val lat = pg.latitude
                        val lng = pg.longitude
                        if (lat != 0.0 && lng != 0.0) {
                            openMapDirections(lat, lng, pg.name)
                        }
                    },
                    modifier = Modifier.wrapContentWidth(),
                    shape = RoundedCornerShape(10.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = FormColors.PrimaryButton,
                        contentColor = FormColors.PrimaryButtonText,
                    ),
                ) {
                    Text("Get Directions")
                }
                if (!pg.website.isNullOrBlank()) {
                    Spacer(Modifier.height(8.dp))
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.clickable { openExternal(pg.website!!.trim()) },
                    ) {
                        Text("🌐 ", fontSize = 13.sp, color = Color(0xFF424242))
                        Text(
                            pg.website!!.trim(),
                            fontSize = 13.sp,
                            color = FormColors.PrimaryButton,
                            textDecoration = TextDecoration.Underline,
                        )
                    }
                }
                if (!pg.phoneNumber.isNullOrBlank()) {
                    Spacer(Modifier.height(4.dp))
                    val tel = pg.phoneNumber!!.filter { it.isDigit() || it == '+' }
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.clickable(enabled = tel.any { it.isDigit() }) {
                            if (tel.any { it.isDigit() }) openExternal("tel:$tel")
                        },
                    ) {
                        Text("📞 ", fontSize = 13.sp, color = Color(0xFF424242))
                        Text(
                            pg.phoneNumber!!.trim(),
                            fontSize = 13.sp,
                            color = FormColors.PrimaryButton,
                            textDecoration = TextDecoration.Underline,
                        )
                    }
                }
            }

            AccordionSection(title = "🚻 Amenities", expanded = amenitiesExpanded, onToggle = { amenitiesExpanded = !amenitiesExpanded }) {
                if (filteredAmenityFields.isEmpty()) {
                    Text("No amenity info yet.", fontSize = 13.sp, color = Color.Gray)
                } else {
                    TriStateItemList(filteredAmenityFields, amenityEmoji, "•", pvConfirmedAmenities, pvNoEvidenceAmenities)
                }
            }

            if (typeConfig.showPlaygroundEquipment) {
                AccordionSection(title = "🛝 Equipment & Features", expanded = equipmentExpanded, onToggle = { equipmentExpanded = !equipmentExpanded }) {
                    TriStateItemList(equipmentFields, equipmentEmoji, "🎮", pvConfirmedEquip, pvNoEvidenceEquip)
                    if (typeConfig.showSwingTypes && (pg.equipment.contains("Swings") || pg.swingTypes.isNotEmpty())) {
                        SubSectionLabel("Swing Types")
                        TriStateItemList(swingFields, equipmentEmoji, "🪁", pvConfirmedSwings, pvNoEvidenceSwings)
                    }
                }
            }

            val showSportsBlock = typeConfig.showSportsCourts || typeConfig.showExerciseEquipment
            if (showSportsBlock) {
                AccordionSection(title = "⚽ Sports & Exercise", expanded = sportsExpanded, onToggle = { sportsExpanded = !sportsExpanded }) {
                    if (typeConfig.showSportsCourts) {
                        SubSectionLabel("Sports Courts / Fields")
                        TriStateItemList(sportsFields, equipmentEmoji, "🏟️", pvConfirmedSports, pvNoEvidenceSports)
                    }
                    if (typeConfig.showExerciseEquipment) {
                        SubSectionLabel("Exercise Equipment")
                        TriStateItemList(exerciseFields, equipmentEmoji, "🏋️")
                    }
                }
            }

            if (!pg.hours.isNullOrBlank()) {
                AccordionSection(title = "🕐 Hours", expanded = hoursExpanded, onToggle = { hoursExpanded = !hoursExpanded }) {
                    val hourLines = pg.hours!!.split(" | ")
                    if (hourLines.size > 1) {
                        hourLines.forEach { line ->
                            Text(line.trim(), fontSize = 13.sp, color = Color(0xFF424242), modifier = Modifier.padding(vertical = 2.dp))
                        }
                    } else {
                        Text(pg.hours!!, fontSize = 13.sp, color = Color(0xFF424242))
                    }
                    Spacer(Modifier.height(6.dp))
                    Text("Source: Google. Hours may vary.", fontSize = 11.sp, color = Color(0xFF9E9E9E))
                }
            }

            if (pg.subVenues.isNotEmpty()) {
                AccordionSection(
                    title = "🏛️ Areas & sub-venues (${pg.subVenues.size})",
                    expanded = subVenuesExpanded,
                    onToggle = { subVenuesExpanded = !subVenuesExpanded },
                ) {
                    Text(
                        "Separate listings merged into this place so one screen shows the whole venue.",
                        fontSize = 12.sp,
                        color = Color(0xFF757575),
                        modifier = Modifier.padding(bottom = 8.dp),
                    )
                    pg.subVenues.forEachIndexed { index, sv ->
                        SubVenueRow(sv)
                        if (index < pg.subVenues.lastIndex) Spacer(Modifier.height(10.dp))
                    }
                }
            }

            AccordionSection(title = "📋 Verification & Info", expanded = verificationExpanded, onToggle = { verificationExpanded = !verificationExpanded }) {
                val pgVerificationCount = pg.verificationCount
                val pgSubmittedBy = pg.submittedBy
                val pgLastVerifiedAt = pg.lastVerifiedAt
                var showListPicker by remember { mutableStateOf(false) }

            Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("📊", fontSize = 16.sp); Spacer(Modifier.width(6.dp))
                    Text("$pgVerificationCount verification${if (pgVerificationCount != 1) "s" else ""}",
                        fontSize = 14.sp, fontWeight = FontWeight.Medium, color = Color(0xFF212121))
                }
                if (!pgSubmittedBy.isNullOrBlank()) {
                    Spacer(Modifier.height(2.dp))
                    Text("Including $pgSubmittedBy — Top Contributor", fontSize = 12.sp, color = Color(0xFF424242), fontWeight = FontWeight.Medium)
                }
                val verifiedText = when {
                    !pgLastVerifiedAt.isNullOrBlank() -> "Last verified: ${pgLastVerifiedAt.take(10)}"
                    pgVerificationCount >= 1 -> "Original data from Google"
                    else -> "Not yet verified"
                }
                Spacer(Modifier.height(2.dp))
                Text(verifiedText, fontSize = 13.sp, color = Color.Gray)
                if (pg.badges.isNotEmpty()) {
                    Spacer(Modifier.height(6.dp))
                    FlowRow {
                        pg.badges.forEach { badge ->
                            Surface(shape = RoundedCornerShape(20.dp), color = Color(0xFFFFF9C4), modifier = Modifier.padding(end = 6.dp, bottom = 4.dp)) {
                                Text("🏅 $badge", fontSize = 12.sp, color = Color(0xFF795548), modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp))
                            }
                        }
                    }
                }
                Spacer(Modifier.height(8.dp))
                Button(
                    onClick = {
                        quickVerifyError = null
                        if (!userHasDisplayName) {
                            showDisplayNameDialog = true
                        } else {
                            showQuickVerify = true
                        }
                    },
                    enabled = !quickVerifySuccess && !alreadyVerifiedToday && !quickVerifyLoading,
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(10.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = FormColors.PrimaryButton,
                        contentColor = FormColors.PrimaryButtonText,
                        disabledContainerColor = FormColors.PrimaryButton.copy(alpha = 0.38f),
                        disabledContentColor = FormColors.PrimaryButtonText.copy(alpha = 0.72f),
                    ),
                ) {
                    Text(
                        when {
                            quickVerifySuccess -> "Verified — thank you!"
                            alreadyVerifiedToday -> "Already verified today"
                            else -> "Tap here to verify this playground"
                        }
                    )
                }
                Text("Earn contribution points for verifying!", fontSize = 11.sp, color = Color.Gray, modifier = Modifier.fillMaxWidth(), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                quickVerifyError?.let { msg ->
                    Spacer(Modifier.height(4.dp))
                    Text(msg, fontSize = 12.sp, color = Color(0xFFE53935))
                }
                Spacer(Modifier.height(8.dp))
                Button(
                    onClick = { showFeedbackChoice = true },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(10.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = FormColors.PrimaryButton,
                        contentColor = FormColors.PrimaryButtonText,
                    ),
                ) {
                    Text("📣 Report or Suggest a Change")
                }
                Spacer(Modifier.height(4.dp))
                TextButton(onClick = { showDeleteConfirm = true }, modifier = Modifier.fillMaxWidth()) {
                    Icon(MaterialIcons.Filled.Delete, contentDescription = null, tint = Color(0xFFE53935), modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("Request Removal", fontSize = 12.sp, color = Color(0xFFE53935))
                }
            }
        }
    }
    lightboxIndex?.let { rawStart ->
        if (displayImageUrls.isEmpty()) return@let
        val startIndex = rawStart.coerceIn(0, displayImageUrls.lastIndex)
        val pagerState = rememberPagerState(initialPage = startIndex, pageCount = { displayImageUrls.size })
        LaunchedEffect(pagerState.currentPage) {
            lightboxPagerLocked = false
        }
        Dialog(
            onDismissRequest = {
                lightboxIndex = null
                lightboxPagerLocked = false
            },
            properties = DialogProperties(usePlatformDefaultWidth = false, dismissOnClickOutside = true)
        ) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Surface(color = Color.Black, modifier = Modifier.fillMaxSize()) {}
                HorizontalPager(
                    state = pagerState,
                    modifier = Modifier.fillMaxSize(),
                    userScrollEnabled = !lightboxPagerLocked,
                ) { page ->
                    LightboxZoomableImage(
                        imageUrl = displayImageUrls[page],
                        pageIndex = page,
                        currentPage = pagerState.currentPage,
                        onZoomedChanged = { zoomed ->
                            if (pagerState.currentPage == page) {
                                lightboxPagerLocked = zoomed
                            }
                        },
                    )
                }
                Text(
                    "${pagerState.currentPage + 1} / ${displayImageUrls.size}",
                    color = Color.White,
                    fontSize = 13.sp,
                    modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 24.dp)
                )
                IconButton(
                    onClick = {
                        lightboxIndex = null
                        lightboxPagerLocked = false
                    },
                    modifier = Modifier.align(Alignment.TopEnd).padding(16.dp)
                ) {
                    Icon(MaterialIcons.Filled.Close, contentDescription = "Close", tint = Color.White)
                }
            }
        }
    }

        if (showFeedbackChoice) {
        AlertDialog(
            onDismissRequest = { showFeedbackChoice = false },
            title = { Text("What would you like to do?") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        onClick = { showFeedbackChoice = false; showReportDialog = true },
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(10.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = FormColors.PrimaryButton,
                            contentColor = FormColors.PrimaryButtonText,
                        ),
                    ) { Text("🚩 Report an Issue") }
                    Button(
                        onClick = { showFeedbackChoice = false; onNavigateToSupportTicket(pg.id) },
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(10.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = FormColors.PrimaryButton,
                            contentColor = FormColors.PrimaryButtonText,
                        ),
                    ) { Text("✏️ Suggest a Change") }
                }
            },
            confirmButton = {},
            dismissButton = { TextButton(onClick = { showFeedbackChoice = false }) { Text("Cancel") } }
        )
    }

    if (showReportDialog) {
        AlertDialog(
            onDismissRequest = { if (!reportLoading) showReportDialog = false },
            title = { Text("Report an Issue") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Describe the issue with this listing:", fontSize = 13.sp, color = Color.Gray)
                    OutlinedTextField(value = reportText, onValueChange = { reportText = it }, label = { Text("Issue description") }, modifier = Modifier.fillMaxWidth(), minLines = 3, enabled = !reportLoading)
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        scope.launch {
                            reportLoading = true
                            try {
                                service.submitSupportTicket(ticketType = "CONTENT_ISSUE", message = reportText, targetKind = "playground", targetId = pg.id)
                                showReportDialog = false; reportText = ""
                            } catch (_: Exception) { showReportDialog = false } finally { reportLoading = false }
                        }
                    },
                    enabled = !reportLoading && reportText.isNotBlank()
                ) { if (reportLoading) CircularProgressIndicator(modifier = Modifier.size(16.dp)) else Text("Submit") }
            },
            dismissButton = { TextButton(onClick = { showReportDialog = false }, enabled = !reportLoading) { Text("Cancel") } }
        )
    }

    if (showDeleteConfirm) {
        AlertDialog(
            onDismissRequest = { showDeleteConfirm = false },
            title = {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(MaterialIcons.Filled.Delete, contentDescription = null, tint = Color(0xFFE53935))
                    Spacer(Modifier.width(8.dp))
                    Text("Request Removal", color = Color(0xFFE53935))
                }
            },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Optional: explain why this listing should be removed (helps moderators).", fontSize = 13.sp, color = Color.Gray)
                    OutlinedTextField(
                        value = removalReason,
                        onValueChange = { removalReason = it },
                        label = { Text("Reason (optional)") },
                        modifier = Modifier.fillMaxWidth(),
                        minLines = 3
                    )
                    Text("Your request goes to the moderation queue. The listing stays visible unless a moderator archives it.", fontSize = 12.sp, color = Color(0xFF9E9E9E))
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        scope.launch {
                            try {
                                val pid = pg.id ?: return@launch
                                val msg = removalReason.trim().takeIf { it.isNotEmpty() }
                                service.requestDeletePlayground(pid, msg)
                            } catch (_: Exception) {}
                            showDeleteConfirm = false
                            removalReason = ""
                        }
                    },
                ) { Text("Submit Request", color = Color(0xFFE53935)) }
            },
            dismissButton = { TextButton(onClick = { showDeleteConfirm = false; removalReason = "" }) { Text("Cancel") } }
        )
    }

    // Display name prompt dialog
    if (showDisplayNameDialog) {
        AlertDialog(
            onDismissRequest = { if (!isSettingDisplayName) showDisplayNameDialog = false },
            title = { Text("Choose a display name") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Pick a name for the contributor leaderboard. This can be your first name, a nickname, or anything family-friendly.", fontSize = 13.sp, color = Color.Gray)
                    Text("Please use first name + last initial (example: Jamie T.)", fontSize = 12.sp, color = Color.Gray)
                    OutlinedTextField(
                        value = displayNameInput, onValueChange = { if (it.length <= 30) displayNameInput = it },
                        label = { Text("First name + last initial") }, modifier = Modifier.fillMaxWidth(), singleLine = true, enabled = !isSettingDisplayName
                    )
                    val preview = displayNameInput.trim()
                    if (isValidContributorNameFormat(preview)) {
                        Text("Will display as: $preview", fontSize = 12.sp, color = Color(0xFF2E7D32))
                    }
                    displayNameError?.let { Text(it, color = Color(0xFFE53935), fontSize = 13.sp) }
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        scope.launch {
                            isSettingDisplayName = true; displayNameError = null
                            try {
                                val trimmed = displayNameInput.trim()
                                if (!isValidContributorNameFormat(trimmed)) {
                                    displayNameError = "Use first name + last initial, like Jamie T."
                                    return@launch
                                }
                                service.setDisplayName(trimmed)
                                userHasDisplayName = true; showDisplayNameDialog = false
                                showQuickVerify = true
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
                    onClick = { showDisplayNameDialog = false },
                    enabled = !isSettingDisplayName
                ) { Text("Not now") }
            }
        )
    }

    // Quick verify dialog
    if (showQuickVerify) {
        QuickVerifyDialog(
            needsDisplayName = !userHasDisplayName,
            verifyFirstName = verifyFirstName,
            verifyLastInitial = verifyLastInitial,
            onVerifyFirstNameChange = { verifyFirstName = it; quickVerifyNameError = null },
            onVerifyLastInitialChange = { verifyLastInitial = it; quickVerifyNameError = null },
            verifyNameError = quickVerifyNameError,
            onSubmit = { rating ->
                if (alreadyVerifiedToday || quickVerifyLoading) {
                    quickVerifyError = "You already verified this playground today."
                    showQuickVerify = false
                    return@QuickVerifyDialog
                }
                scope.launch {
                    quickVerifyLoading = true
                    quickVerifyError = null
                    quickVerifyNameError = null
                    try {
                        if (!userHasDisplayName) {
                            val li = verifyLastInitial.trim().trimEnd('.')
                            val combined = "${verifyFirstName.trim()} $li."
                            if (!isValidContributorNameFormat(combined)) {
                                quickVerifyNameError = "Use first name + last initial, like Jamie T."
                                quickVerifyLoading = false
                                return@launch
                            }
                            try {
                                service.setDisplayName(combined)
                                userHasDisplayName = true
                            } catch (e: Exception) {
                                quickVerifyNameError = e.message ?: "Could not save display name."
                                quickVerifyLoading = false
                                return@launch
                            }
                        }
                        val previousCount = pg.verificationCount
                        val resp = service.quickVerify(
                            playgroundId = pg.id ?: return@launch,
                            lat = userLat ?: 0.0,
                            lng = userLng ?: 0.0,
                            rating = rating,
                        )
                        val nextCount = maxOf(previousCount + 1, resp.data.verificationCount)
                        pg = pg.copy(
                            verificationCount = nextCount,
                            lastVerifiedAt = resp.data.lastVerifiedAt,
                            rating = resp.data.averageRating ?: pg.rating,
                            ratingCount = resp.data.ratingCount,
                        )
                        if (rating != null) {
                            snackbarHostState.showSnackbar("Thanks! Your verification and rating were saved.")
                        }
                        alreadyVerifiedToday = true
                        settings.putString(quickVerifyKey, todayIso)
                        quickVerifyLoading = false
                        quickVerifySuccess = true
                    } catch (e: Exception) {
                        val msg = e.message.orEmpty()
                        if (msg.contains("already", ignoreCase = true) || msg.contains("today", ignoreCase = true) || msg.contains("24", ignoreCase = true)) {
                            alreadyVerifiedToday = true
                            settings.putString(quickVerifyKey, todayIso)
                            quickVerifyError = "You already verified this playground recently."
                        } else {
                            quickVerifyError = "Verification failed. Please try again."
                        }
                        showQuickVerify = false
                    } finally {
                        quickVerifyLoading = false
                    }
                }
            },
            onDismiss = {
                showQuickVerify = false
                quickVerifySuccess = false
                quickVerifyNameError = null
            },
            isLoading = quickVerifyLoading,
            isSuccess = quickVerifySuccess,
        )
    }
    SnackbarHost(
        hostState = snackbarHostState,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp)
    )
}
