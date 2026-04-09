package org.community.playgroundfinder.ui.composables

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
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
import coil3.compose.AsyncImage
import org.community.playgroundfinder.data.Playground
import org.community.playgroundfinder.util.firstDisplayablePlaygroundImageUrl
import org.community.playgroundfinder.util.parseHexColor
import kotlin.math.roundToInt

// Types that are inherently free — no cost confirmation needed
private val FREE_TYPES = setOf(
    "public", "neighborhood", "elementary school", "school", "nature trail"
)

/**
 * Returns a display string for cost.
 * Inherently-free types (Public, Neighborhood, School, etc.) always show "Free".
 * Any other type with no/unknown cost → "Unknown"
 */
fun costDisplay(cost: String?, playgroundType: String?): String {
    val typeKey = playgroundType?.trim()?.lowercase() ?: ""
    val isFreeType = FREE_TYPES.any { typeKey.contains(it) }
    val blank = cost.isNullOrBlank()
        || cost.equals("Unknown", ignoreCase = true)
        || cost.equals("Unknown/varies", ignoreCase = true)
        || cost.equals("Varies", ignoreCase = true)
    if (blank) return if (isFreeType) "Free" else "Unknown"
    return when {
        cost!!.contains("free", ignoreCase = true) -> "Free"
        cost.contains("low", ignoreCase = true) -> "\$"
        cost.contains("medium", ignoreCase = true) -> "\$\$"
        cost.contains("high", ignoreCase = true) -> "\$\$\$"
        cost.startsWith("\$") -> cost
        isFreeType -> "Free"
        else -> cost
    }
}

/** Haversine distance in meters. */
fun haversineMeters(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
    val r = 6_371_000.0
    val dLat = Math.toRadians(lat2 - lat1)
    val dLng = Math.toRadians(lng2 - lng1)
    val a = Math.sin(dLat / 2).let { it * it } +
            Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) *
            Math.sin(dLng / 2).let { it * it }
    return r * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

fun distanceText(meters: Double): String =
    if (meters < 160) "${meters.roundToInt()} m"
    else if (meters < 1609) "%.1f mi".format(meters / 1609.34)
    else "%.1f mi".format(meters / 1609.34)

/** Returns true if the color is dark (luminance < 0.5), meaning white text should be used on it. */
fun isColorDark(color: Color): Boolean {
    val r = color.red
    val g = color.green
    val b = color.blue
    // Relative luminance formula (WCAG)
    val luminance = 0.299 * r + 0.587 * g + 0.114 * b
    return luminance < 0.5
}

/** Maps a playground type string to a (background, foreground) color pair. */
@Composable
fun playgroundTypeColors(type: String): Pair<Color, Color> {
    val t = type.lowercase().trim()
    return when {
        // Water
        t.contains("splash")       -> Pair(Color.White, Color(0xFF00838F)) // teal
        t.contains("swim") ||
        t.contains("pool") ||
        t.contains("water park")   -> Pair(Color.White, FormColors.PrimaryButton)
        // Outdoors
        t.contains("beach") ||
        t.contains("boardwalk")    -> Pair(Color(0xFFFFF8E1), Color(0xFFE65100)) // sandy orange
        t.contains("botanical") ||
        t.contains("garden")       -> Pair(Color(0xFFE8F5E9), Color(0xFF1B5E20)) // garden green
        t.contains("trail") ||
        t.contains("nature")       -> Pair(Color(0xFFF1F8E9), Color(0xFF33691E)) // olive
        // Active
        t.contains("skate")        -> Pair(Color(0xFFEDE7F6), Color(0xFF4527A0)) // deep purple
        t.contains("ice skat") ||
        t.contains("skating rink") -> Pair(FormColors.InfoChipBackground, Color(0xFF004D4F)) // ice / cool accent
        t.contains("amusement")    -> Pair(Color(0xFFFFF3E0), Color(0xFFE65100)) // orange
        t.contains("bowling")       -> Pair(Color(0xFFFFF3E0), Color(0xFFE65100)) // orange
        t.contains("mini golf") ||
        t.contains("putt")        -> Pair(Color(0xFFE8F5E9), Color(0xFF2E7D32)) // green
        // Learning
        t.contains("library")      -> Pair(FormColors.InfoChipBackground, FormColors.InfoChipText)
        t.contains("science") ||
        t.contains("museum")       -> Pair(Color(0xFFFCE4EC), Color(0xFF880E4F)) // pink
        // Animals
        t.contains("zoo") ||
        t.contains("aquarium")     -> Pair(Color(0xFFFCE4EC), Color(0xFF880E4F)) // pink
        // Indoor
        t.contains("indoor") ||
        t.contains("trampoline") ||
        t.contains("arcade")       -> Pair(Color(0xFFFFF3E0), Color(0xFFE65100)) // orange
        // School
        t.contains("school")       -> Pair(Color(0xFFF3E5F5), Color(0xFF6A1B9A)) // purple
        // Parks
        t.contains("private")      -> Pair(Color(0xFFFCE4EC), Color(0xFFC62828)) // red
        t.contains("neighborhood") -> Pair(Color(0xFFE8F5E9), Color(0xFF2E7D32)) // green
        t.contains("city park") ||
        t.contains("regional") ||
        t.contains("state park")   -> Pair(Color(0xFFE8F5E9), Color(0xFF1B5E20)) // dark green
        t.contains("public park") ||
        t.contains("public")       -> Pair(Color(0xFFE8F5E9), Color(0xFF2E7D32)) // green
        else                       -> Pair(MaterialTheme.colorScheme.primaryContainer, MaterialTheme.colorScheme.onPrimaryContainer)
    }
}

@Composable
fun PlaygroundItem(
    playground: Playground,
    userLat: Double? = null,
    userLng: Double? = null,
    listNames: List<Pair<String, String?>> = emptyList(),
    onClick: () -> Unit,
) {
    // Prefer server-provided distance, fall back to haversine
    val distMeters: Double? = playground.distanceMeters
        ?: if (userLat != null && userLng != null &&
            playground.latitude != 0.0 && playground.longitude != 0.0)
            haversineMeters(userLat, userLng, playground.latitude, playground.longitude)
        else null

    val cost = costDisplay(playground.costRange ?: playground.expense, playground.playgroundType)
    val isFree = cost == "Free"

    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        shape = RoundedCornerShape(16.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column {
            // ── Top image ─────────────────────────────────────────────────────
            val firstUrl = firstDisplayablePlaygroundImageUrl(playground.imageUrls)
            val typePh = playgroundPlaceholderPainter(playground.playgroundType)
            if (firstUrl != null) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(160.dp)
                        .clip(RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp))
                        .background(FormColors.CardBackground),
                    contentAlignment = Alignment.Center,
                ) {
                    AsyncImage(
                        model = firstUrl,
                        contentDescription = null,
                        modifier = Modifier.fillMaxSize(),
                        contentScale = ContentScale.Crop,
                        placeholder = typePh,
                        error = typePh,
                    )
                }
            } else {
                Box(
                    modifier = Modifier.fillMaxWidth().height(160.dp).clip(RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp)).background(FormColors.CardBackground),
                    contentAlignment = Alignment.Center
                ) {
                    Image(
                        painter = typePh,
                        contentDescription = playground.playgroundType ?: "Play Place",
                        modifier = Modifier.fillMaxSize(),
                        contentScale = ContentScale.FillWidth
                    )
                }
            }

            // ── Info ──────────────────────────────────────────────────────────
            Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                // Name + type on the same row
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        playground.name,
                        fontWeight = FontWeight.Bold,
                        fontSize = 16.sp,
                        maxLines = 1,
                        modifier = Modifier.weight(1f, fill = false)
                    )
                    val typeLabel = playground.playgroundType?.takeIf { it.isNotBlank() } ?: "Park"
                    val (typeBg, typeFg) = playgroundTypeColors(typeLabel)
                    Surface(shape = RoundedCornerShape(6.dp), color = typeBg) {
                        Text(
                            typeLabel,
                            fontSize = 11.sp,
                            color = typeFg,
                            fontWeight = FontWeight.Medium,
                            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                        )
                    }
                    playground.groundType?.takeIf { it.isNotBlank() }?.let { ground ->
                        Spacer(Modifier.width(6.dp))
                        Surface(shape = RoundedCornerShape(6.dp), color = FormColors.PrimaryButton) {
                            Text(
                                ground.split(",").firstOrNull()?.trim() ?: ground,
                                fontSize = 11.sp,
                                color = Color.White,
                                fontWeight = FontWeight.Medium,
                                modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                                maxLines = 1,
                            )
                        }
                    }
                }

                playground.address?.let {
                    Text(it, fontSize = 13.sp, color = Color.Gray, maxLines = 1)
                }
                if (playground.subVenues.isNotEmpty()) {
                    Text(
                        "Includes ${playground.subVenues.size} areas",
                        fontSize = 12.sp,
                        color = Color(0xFF5C6BC0),
                        fontWeight = FontWeight.Medium,
                        modifier = Modifier.padding(top = 2.dp),
                    )
                }

                val hasChips = playground.isFavorited || listNames.isNotEmpty()
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.padding(top = 2.dp)
                ) {
                    distMeters?.let {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                            Icon(MaterialIcons.Filled.NearMe, null, modifier = Modifier.size(13.dp), tint = Color.Gray)
                            Text(distanceText(it), fontSize = 12.sp, color = Color.Gray)
                        }
                    }
                    if (hasChips) {
                        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            if (playground.isFavorited) {
                                Surface(shape = RoundedCornerShape(6.dp), color = Color(0xFFFCE4EC)) {
                                    Row(modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                                        Icon(MaterialIcons.Filled.Favorite, null, modifier = Modifier.size(10.dp), tint = Color(0xFFF06292))
                                        Spacer(Modifier.width(2.dp))
                                        Text("Favorite", fontSize = 10.sp, color = Color(0xFFC62828))
                                    }
                                }
                            }
                            listNames.forEach { (name, chipColor) ->
                                val bgColor = chipColor?.let { parseHexColor(it)?.copy(alpha = 0.15f) } ?: FormColors.ListChipDefaultBg
                                val fgColor = chipColor?.let { parseHexColor(it) } ?: FormColors.ListChipDefaultFg
                                Surface(shape = RoundedCornerShape(6.dp), color = bgColor) {
                                    Text(name, fontSize = 10.sp, color = fgColor, modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp))
                                }
                            }
                        }
                    }
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("Cost/person:", fontSize = 11.sp, color = Color.Gray)
                        Surface(
                            shape = RoundedCornerShape(6.dp),
                            color = if (isFree) Color(0xFFE8F5E9) else Color(0xFFFFF8E1)
                        ) {
                            Text(
                                cost,
                                fontSize = 11.sp,
                                color = if (isFree) Color(0xFF388E3C) else Color(0xFF795548),
                                fontWeight = FontWeight.SemiBold,
                                modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                            )
                        }
                    }
                    Spacer(Modifier.weight(1f))
                    if (playground.verificationCount > 0) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(MaterialIcons.Filled.Verified, null, tint = Color(0xFF4CAF50), modifier = Modifier.size(13.dp))
                            Text(" ${playground.verificationCount}", fontSize = 11.sp, color = Color.Gray)
                        }
                    }
                }
            }
        }
    }
}

// ── Hierarchical Category System ─────────────────────────────────────────────

data class PlaceCategory(
    val emoji: String,
    val label: String,
    val subTypes: List<String>,  // empty = category IS the type (no sub-types)
)

val PLACE_CATEGORIES = listOf(
    PlaceCategory("🌳", "Parks", listOf("Public Park", "Neighborhood Park", "Private Park")),
    PlaceCategory("🌿", "Outdoors", listOf("Nature Trail", "Beach", "Botanical Garden")),
    PlaceCategory("🌊", "Water", listOf("Splash Pad", "Pool / Water Park")),
    PlaceCategory("🏃", "Active", listOf("Skate Park", "Ice Skating Rink", "Mini Golf", "Amusement Park", "Bowling Alley")),
    PlaceCategory("📚", "Learning", listOf("Library", "Museum / Science Center")),
    PlaceCategory("🐾", "Animals", listOf("Zoo / Aquarium")),
    PlaceCategory("🏠", "Indoor Play", emptyList()),
    PlaceCategory("🏫", "Elementary School", emptyList()),
)

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun CategoryTypePicker(
    selected: String?,
    onSelect: (String?) -> Unit,
    modifier: Modifier = Modifier,
    /** When false, omits the top "Location Type" row (e.g. when wrapped in a collapsible section that supplies the title). */
    showTitleRow: Boolean = true,
) {
    // Track which categories are expanded
    var expandedCategories by remember(selected) {
        mutableStateOf(
            if (selected == null) emptySet()
            else PLACE_CATEGORIES
                .filter { cat ->
                    if (cat.subTypes.isEmpty()) cat.label == selected
                    else selected in cat.subTypes
                }
                .map { it.label }
                .toSet()
        )
    }

    Column(modifier = modifier) {
        if (showTitleRow) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth().padding(top = 20.dp, bottom = 8.dp)
            ) {
                Text(
                    "Location Type",
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f)
                )
                if (selected != null) {
                    TextButton(onClick = { onSelect(null) }, contentPadding = PaddingValues(horizontal = 8.dp, vertical = 0.dp)) {
                        Text("Clear", fontSize = 12.sp)
                    }
                }
            }
        } else if (selected != null) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 4.dp, bottom = 8.dp),
                horizontalArrangement = Arrangement.End
            ) {
                TextButton(onClick = { onSelect(null) }, contentPadding = PaddingValues(horizontal = 8.dp, vertical = 0.dp)) {
                    Text("Clear", fontSize = 12.sp)
                }
            }
        }

        PLACE_CATEGORIES.forEach { category ->
            val hasSubTypes = category.subTypes.isNotEmpty()
            val isExpanded = category.label in expandedCategories
            // For categories without sub-types, the category label IS the type
            val isCategorySelected = if (hasSubTypes) {
                selected in category.subTypes
            } else {
                selected == category.label
            }

            // Category row
            Surface(
                modifier = Modifier.fillMaxWidth(),
                color = if (isCategorySelected) MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.3f)
                         else Color.Transparent,
                shape = RoundedCornerShape(8.dp)
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable {
                            if (hasSubTypes) {
                                expandedCategories = if (isExpanded)
                                    expandedCategories - category.label
                                else
                                    expandedCategories + category.label
                            } else {
                                // Toggle selection for leaf categories
                                onSelect(if (selected == category.label) null else category.label)
                            }
                        }
                        .padding(horizontal = 12.dp, vertical = 6.dp)
                ) {
                    Text(category.emoji, fontSize = 16.sp)
                    Spacer(Modifier.width(10.dp))
                    Text(
                        category.label,
                        fontSize = 14.sp,
                        fontWeight = if (isCategorySelected) FontWeight.SemiBold else FontWeight.Normal,
                        modifier = Modifier.weight(1f)
                    )
                    if (!hasSubTypes && isCategorySelected) {
                        Icon(
                            MaterialIcons.Filled.Check,
                            contentDescription = "Selected",
                            modifier = Modifier.size(18.dp),
                            tint = MaterialTheme.colorScheme.primary
                        )
                    }
                    if (hasSubTypes) {
                        // Show which sub-type is selected as a small label
                        if (isCategorySelected && selected != null) {
                            Text(
                                selected,
                                fontSize = 11.sp,
                                color = MaterialTheme.colorScheme.primary,
                                fontWeight = FontWeight.Medium,
                                modifier = Modifier.padding(end = 4.dp)
                            )
                        }
                        Icon(
                            if (isExpanded) MaterialIcons.Filled.ExpandLess else MaterialIcons.Filled.ExpandMore,
                            contentDescription = if (isExpanded) "Collapse" else "Expand",
                            modifier = Modifier.size(20.dp),
                            tint = FormColors.AccordionChevronTint
                        )
                    }
                }
            }

            // Expanded sub-types
            if (hasSubTypes && isExpanded) {
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.padding(start = 44.dp, bottom = 4.dp, end = 12.dp)
                ) {
                    category.subTypes.forEach { subType ->
                        FilterChip(
                            selected = selected == subType,
                            onClick = { onSelect(if (selected == subType) null else subType) },
                            label = { Text(subType, fontSize = 13.sp) },
                            shape = RoundedCornerShape(20.dp),
                            colors = FilterChipDefaults.filterChipColors(selectedContainerColor = FormColors.SelectedChip, selectedLabelColor = FormColors.SelectedChipText),
                            leadingIcon = if (selected == subType) {
                                { Icon(MaterialIcons.Filled.Check, null, modifier = Modifier.size(14.dp)) }
                            } else null
                        )
                    }
                }
            }
        }
    }
}
