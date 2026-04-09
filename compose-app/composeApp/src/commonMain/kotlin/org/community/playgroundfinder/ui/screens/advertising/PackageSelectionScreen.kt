package org.community.playgroundfinder.ui.screens.advertising

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import kotlinx.datetime.Clock
import kotlinx.datetime.DatePeriod
import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone
import kotlinx.datetime.plus
import kotlinx.datetime.todayIn
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.community.playgroundfinder.data.PlaygroundService
import org.community.playgroundfinder.models.PhasePrice
import org.community.playgroundfinder.models.RadiusPreviewData
import org.community.playgroundfinder.ui.composables.FormColors

/** Must match server `pricingService` (`AD_CAMPAIGN_START_MIN_LEAD_DAYS` / `MAX`) for Prime & Inline start dates. */
private const val CAMPAIGN_START_MIN_LEAD_DAYS = 2
private const val CAMPAIGN_START_MAX_LEAD_DAYS = 30

private data class PackageOption(
    val type: String,
    val name: String,
    val priceInCents: Int,
    val priceDisplay: String,
    val durationDays: Int,
    val description: String,
    val isEvent: Boolean = false,
)

/** Listed price: standard rate when the API provides it, otherwise the active rate. */
private fun listPriceCents(phasePrice: PhasePrice): Int {
    val std = phasePrice.standardPriceInCents
    return if (std > 0) std else phasePrice.priceInCents
}

private fun formatCents(cents: Int): String {
    val dollars = cents / 100
    val remainder = cents % 100
    val sign = '\u0024'.toString()
    return if (remainder == 0) "${sign}${dollars}" else "${sign}${dollars}.${remainder.toString().padStart(2, '0')}"
}

private fun multiMonthDiscountFraction(durationMonths: Int): Double = when (durationMonths) {
    2 -> 0.05
    3 -> 0.15
    6 -> 0.25
    else -> 0.0
}

/** Matches server [pricingService.calculateMultiMonthPrice] for display-only totals. */
private val apiErrorJson = Json { ignoreUnknownKeys = true }

/** Turns `Submission update failed (400): {"error":"…","availableRadii":[20]}` into a short, readable line. */
private fun humanizeAdvertisingApiError(raw: String): String {
    if (raw.isBlank()) return raw
    val tail = raw.substringAfter("): ", missingDelimiterValue = raw).trim()
    val errFromJson = runCatching {
        apiErrorJson.parseToJsonElement(tail).jsonObject["error"]?.jsonPrimitive?.content
    }.getOrNull()
    val text = (errFromJson ?: tail).trim()
    if (text.contains("extra cities beyond 20 miles", ignoreCase = true) ||
        text.contains("beyond 20 miles from your business", ignoreCase = true) ||
        text.contains("No additional seeded regions", ignoreCase = true)
    ) {
        return "That distance doesn’t add any extra cities beyond 20 miles from your business. Choose 20 miles or another radius shown as available above."
    }
    if (text.contains("waitlist", ignoreCase = true) || text.contains("slots available", ignoreCase = true)) {
        return "We couldn’t save that selection. If this persists, go back one step and try again, or contact support."
    }
    return if (text.length > 280) text.take(277) + "…" else text
}

private fun LocalDate.formatMedium(): String {
    val mon = month.name.take(3).lowercase().replaceFirstChar { it.titlecase() }
    return "$mon $dayOfMonth, $year"
}

private fun isCampaignStartDateInRange(iso: String): Boolean {
    val d = runCatching { LocalDate.parse(iso.trim()) }.getOrNull() ?: return false
    val zone = TimeZone.currentSystemDefault()
    val today = Clock.System.todayIn(zone)
    val min = today.plus(DatePeriod(days = CAMPAIGN_START_MIN_LEAD_DAYS))
    val max = today.plus(DatePeriod(days = CAMPAIGN_START_MAX_LEAD_DAYS))
    return d >= min && d <= max
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CampaignStartDateField(
    campaignStartDateIso: String,
    onDateSelected: (String) -> Unit,
    errorText: String? = null,
) {
    val zone = TimeZone.currentSystemDefault()
    var open by remember { mutableStateOf(false) }

    val displayText = remember(campaignStartDateIso) {
        runCatching { LocalDate.parse(campaignStartDateIso.trim()).formatMedium() }
            .getOrElse { "Tap to choose" }
    }

    val selectableDates = remember(zone) {
        object : SelectableDates {
            override fun isSelectableDate(utcTimeMillis: Long): Boolean {
                val selected = datePickerUtcMillisToLocalDate(utcTimeMillis)
                val today = Clock.System.todayIn(zone)
                val min = today.plus(DatePeriod(days = CAMPAIGN_START_MIN_LEAD_DAYS))
                val max = today.plus(DatePeriod(days = CAMPAIGN_START_MAX_LEAD_DAYS))
                return selected >= min && selected <= max
            }

            override fun isSelectableYear(year: Int): Boolean {
                val today = Clock.System.todayIn(zone)
                val maxY = today.plus(DatePeriod(days = CAMPAIGN_START_MAX_LEAD_DAYS)).year
                return year in today.year..maxY
            }
        }
    }

    OutlinedTextField(
        value = displayText,
        onValueChange = { },
        readOnly = true,
        label = { Text("Campaign start date") },
        isError = errorText != null,
        supportingText = {
            Text(
                errorText ?: "Between $CAMPAIGN_START_MIN_LEAD_DAYS and $CAMPAIGN_START_MAX_LEAD_DAYS days from today",
                color = if (errorText != null) MaterialTheme.colorScheme.error
                else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        },
        trailingIcon = {
            IconButton(onClick = { open = true }) {
                Icon(Icons.Default.DateRange, contentDescription = "Pick date")
            }
        },
        modifier = Modifier
            .fillMaxWidth()
            .clickable(
                indication = null,
                interactionSource = remember { MutableInteractionSource() },
            ) { open = true },
    )

    if (open) {
        val startLd = runCatching { LocalDate.parse(campaignStartDateIso.trim()) }.getOrNull()
            ?: Clock.System.todayIn(zone).plus(DatePeriod(days = CAMPAIGN_START_MIN_LEAD_DAYS))
        val pickerState = rememberDatePickerState(
            initialSelectedDateMillis = localDateToDatePickerUtcMillis(startLd),
            selectableDates = selectableDates,
        )
        DatePickerDialog(
            onDismissRequest = { open = false },
            confirmButton = {
                TextButton(
                    onClick = {
                        val ms = pickerState.selectedDateMillis ?: localDateToDatePickerUtcMillis(startLd)
                        onDateSelected(datePickerUtcMillisToLocalDate(ms).toString())
                        open = false
                    },
                ) { Text("OK") }
            },
            dismissButton = {
                TextButton(onClick = { open = false }) { Text("Cancel") }
            },
        ) {
            DatePicker(state = pickerState)
        }
    }
}

private fun multiMonthTotalCents(monthlyRate: Int, durationMonths: Int, radiusSurcharge: Int): Int {
    val discountFraction = multiMonthDiscountFraction(durationMonths)
    val subtotal = durationMonths * monthlyRate
    val discount = (subtotal * discountFraction).toInt()
    return (subtotal - discount + radiusSurcharge).coerceAtLeast(0)
}

@OptIn(ExperimentalLayoutApi::class, ExperimentalMaterial3Api::class)
@Composable
fun PackageSelectionScreen(
    playgroundService: PlaygroundService,
    submissionId: String,
    regionKey: String,
    onPackageSelected: () -> Unit,
    onBack: () -> Unit,
) {
    val scope = rememberCoroutineScope()

    var packages by remember { mutableStateOf<List<PackageOption>>(emptyList()) }
    var selectedType by remember { mutableStateOf<String?>(null) }
    var isLoadingPrices by remember { mutableStateOf(true) }
    var isSubmitting by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var eventIs14Day by remember { mutableStateOf(false) }
    var radiusPreview by remember { mutableStateOf<RadiusPreviewData?>(null) }
    var selectedRadiusMiles by remember { mutableStateOf(20) }
    var selectedDurationMonths by remember { mutableStateOf(1) }
    var campaignStartDateIso by remember { mutableStateOf("") }
    var startDateError by remember { mutableStateOf<String?>(null) }
    var radiusOrPackageError by remember { mutableStateOf<String?>(null) }

    // Fetch phase info, pricing, and radius preview on screen load
    LaunchedEffect(regionKey) {
        isLoadingPrices = true
        errorMessage = null
        try {
            val featuredPrice = playgroundService.getPhasePrice(regionKey, "featured_home")
            val inlinePrice = playgroundService.getPhasePrice(regionKey, "inline_listing")
            val event7Price = playgroundService.getPhasePrice(regionKey, "event_spotlight_7d")
            val event14Price = playgroundService.getPhasePrice(regionKey, "event_spotlight_14d")

            val fp = listPriceCents(featuredPrice)
            val il = listPriceCents(inlinePrice)
            val e7 = listPriceCents(event7Price)
            val e14 = listPriceCents(event14Price)
            packages = listOf(
                PackageOption(
                    type = "featured_home",
                    name = "Prime Placement",
                    priceInCents = fp,
                    priceDisplay = formatCents(fp) + "/mo.",
                    durationDays = 30,
                    description = "Your business featured prominently on the home screen for your city.",
                ),
                PackageOption(
                    type = "inline_listing",
                    name = "Inline Listing",
                    priceInCents = il,
                    priceDisplay = formatCents(il) + "/mo.",
                    durationDays = 30,
                    description = "Your business appears in search results, shown every 5-8 organic results.",
                ),
                PackageOption(
                    type = "event_spotlight_7d",
                    name = "Event Spotlight",
                    priceInCents = e7,
                    priceDisplay = formatCents(e7) + " / 7 days",
                    durationDays = 7,
                    description = "Time-limited event with an Event badge. Appears on Home (sponsored carousel) and in the app’s Events near you list for your dates — same listing, no separate calendar SKU.",
                    isEvent = true,
                ),
                PackageOption(
                    type = "event_spotlight_14d",
                    name = "Event Spotlight",
                    priceInCents = e14,
                    priceDisplay = formatCents(e14) + " / 14 days",
                    durationDays = 14,
                    description = "Time-limited event with an Event badge. Appears on Home (sponsored carousel) and in the app’s Events near you list for your dates — same listing, no separate calendar SKU.",
                    isEvent = true,
                ),
            )

            // Fetch radius preview (non-blocking) — pass regionKey so multi-word cities match DB
            try {
                radiusPreview = playgroundService.getRadiusPreview(regionKey)
            } catch (_: Exception) { }
            if (campaignStartDateIso.isBlank()) {
                val zone = TimeZone.currentSystemDefault()
                campaignStartDateIso = Clock.System.todayIn(zone).plus(DatePeriod(days = CAMPAIGN_START_MIN_LEAD_DAYS)).toString()
            }
        } catch (e: Exception) {
            errorMessage = "Unable to load pricing. Please try again."
        } finally {
            isLoadingPrices = false
        }
    }

    // Compute surcharge for selected radius
    val selectableRadii = remember(radiusPreview) {
        val explicit = radiusPreview?.selectableRadii.orEmpty()
        if (explicit.isNotEmpty()) explicit.toSet()
        else radiusPreview?.tiers?.filter { it.selectable }.orEmpty().map { it.radiusMiles }.toSet()
    }
    LaunchedEffect(selectableRadii, radiusPreview) {
        if (radiusPreview == null) return@LaunchedEffect
        if (selectableRadii.isNotEmpty() && selectedRadiusMiles !in selectableRadii) {
            selectedRadiusMiles = selectableRadii.minOrNull() ?: 20
        }
    }
    val selectedTier = remember(radiusPreview, selectedRadiusMiles) {
        radiusPreview?.tiers?.firstOrNull { it.radiusMiles == selectedRadiusMiles }
    }
    val radiusSurcharge = selectedTier?.surchargeInCents ?: 0
    val selectedPkg = packages.find { it.type == selectedType }
    val totalPriceInCents = remember(selectedPkg, selectedRadiusMiles, radiusPreview, selectedDurationMonths) {
        val pkg = selectedPkg ?: return@remember 0
        val sur = radiusPreview?.tiers?.firstOrNull { it.radiusMiles == selectedRadiusMiles }?.surchargeInCents ?: 0
        if (pkg.isEvent) (pkg.priceInCents + sur).coerceAtLeast(0)
        else multiMonthTotalCents(pkg.priceInCents, selectedDurationMonths, sur)
    }
    val needsDurationAndStart =
        selectedType == "featured_home" || selectedType == "inline_listing"
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            "Choose the advertising package that works best for your business.",
            fontSize = 14.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        // Loading state
        if (isLoadingPrices) {
            Box(
                modifier = Modifier.fillMaxWidth().padding(vertical = 32.dp),
                contentAlignment = Alignment.Center,
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator()
                    Spacer(Modifier.height(12.dp))
                    Text("Loading pricing\u2026", fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        } else {
            // Package cards (non-event)
            packages.filter { !it.isEvent }.forEach { pkg ->
                val isSelected = selectedType == pkg.type
                val borderColor = if (isSelected) FormColors.PrimaryButton else MaterialTheme.colorScheme.outlineVariant
                val containerColor = if (isSelected) Color(0xFFF0F0F0) else Color.White

                OutlinedCard(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable {
                            selectedType = pkg.type
                            startDateError = null
                            radiusOrPackageError = null
                            errorMessage = null
                        },
                    shape = RoundedCornerShape(16.dp),
                    border = BorderStroke(
                        width = if (isSelected) 2.dp else 1.dp,
                        color = borderColor,
                    ),
                    colors = CardDefaults.outlinedCardColors(containerColor = containerColor),
                ) {
                    Row(
                        modifier = Modifier.padding(16.dp),
                        verticalAlignment = Alignment.Top,
                    ) {
                        RadioButton(
                            selected = isSelected,
                            onClick = {
                                selectedType = pkg.type
                                startDateError = null
                                radiusOrPackageError = null
                                errorMessage = null
                            },
                            colors = RadioButtonDefaults.colors(selectedColor = FormColors.PrimaryButton),
                        )
                        Spacer(Modifier.width(8.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    pkg.name,
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 16.sp,
                                    color = MaterialTheme.colorScheme.onSurface,
                                )
                                Text(
                                    pkg.priceDisplay,
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 16.sp,
                                    color = FormColors.PrimaryButton,
                                )
                            }
                            Spacer(Modifier.height(6.dp))
                            Text(
                                pkg.description,
                                fontSize = 14.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
            // Event Spotlight card with duration toggle
            val e7 = packages.find { it.type == "event_spotlight_7d" }
            val e14 = packages.find { it.type == "event_spotlight_14d" }
            if (e7 != null && e14 != null) {
                val cur = if (eventIs14Day) e14 else e7
                val isSel = selectedType == "event_spotlight_7d" || selectedType == "event_spotlight_14d"
                val evtBorder = if (isSel) FormColors.PrimaryButton else MaterialTheme.colorScheme.outlineVariant
                val evtBg = if (isSel) Color(0xFFF0F0F0) else Color.White

                OutlinedCard(
                    modifier = Modifier.fillMaxWidth().clickable {
                        selectedType = cur.type
                        startDateError = null
                        radiusOrPackageError = null
                        errorMessage = null
                    },
                    shape = RoundedCornerShape(16.dp),
                    border = BorderStroke(if (isSel) 2.dp else 1.dp, evtBorder),
                    colors = CardDefaults.outlinedCardColors(containerColor = evtBg),
                ) {
                    Row(modifier = Modifier.padding(16.dp), verticalAlignment = Alignment.Top) {
                        RadioButton(
                            isSel,
                            {
                                selectedType = cur.type
                                startDateError = null
                                radiusOrPackageError = null
                                errorMessage = null
                            },
                            colors = RadioButtonDefaults.colors(selectedColor = FormColors.PrimaryButton),
                        )
                        Spacer(Modifier.width(8.dp))
                        Column(Modifier.weight(1f)) {
                            Row(Modifier.fillMaxWidth(), Arrangement.SpaceBetween, Alignment.CenterVertically) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text("Event Spotlight", fontWeight = FontWeight.Bold, fontSize = 16.sp)
                                    Spacer(Modifier.width(6.dp))
                                    Surface(shape = RoundedCornerShape(6.dp), color = Color(0xFFFF8F00)) {
                                        Text(
                                            "Event",
                                            fontSize = 10.sp,
                                            color = Color.White,
                                            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                                        )
                                    }
                                }
                                Column(horizontalAlignment = Alignment.End) {
                                    Text(cur.priceDisplay, fontWeight = FontWeight.Bold, fontSize = 16.sp, color = FormColors.PrimaryButton)
                                    if (isSel) {
                                        Text(
                                            "Total w/ ${selectedRadiusMiles} mi: ${formatCents(totalPriceInCents)}",
                                            fontSize = 11.sp,
                                            fontWeight = FontWeight.SemiBold,
                                            color = FormColors.PrimaryButton,
                                        )
                                    }
                                }
                            }
                            Spacer(Modifier.height(6.dp))
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                FilterChip(
                                    !eventIs14Day,
                                    {
                                        eventIs14Day = false
                                        if (isSel) selectedType = "event_spotlight_7d"
                                        startDateError = null
                                        radiusOrPackageError = null
                                        errorMessage = null
                                    },
                                    label = { Text("7 days") },
                                    colors = FilterChipDefaults.filterChipColors(
                                        selectedContainerColor = FormColors.SelectedChip,
                                        selectedLabelColor = FormColors.SelectedChipText,
                                    ),
                                )
                                FilterChip(
                                    eventIs14Day,
                                    {
                                        eventIs14Day = true
                                        if (isSel) selectedType = "event_spotlight_14d"
                                        startDateError = null
                                        radiusOrPackageError = null
                                        errorMessage = null
                                    },
                                    label = { Text("14 days") },
                                    colors = FilterChipDefaults.filterChipColors(
                                        selectedContainerColor = FormColors.SelectedChip,
                                        selectedLabelColor = FormColors.SelectedChipText,
                                    ),
                                )
                            }
                            Spacer(Modifier.height(4.dp))
                            Text(cur.description, fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }

            // Multi-month + start date (required by server for Prime / Inline — not for Event)
            if (needsDurationAndStart) {
                Spacer(Modifier.height(8.dp))
                HorizontalDivider(color = FormColors.Divider.copy(alpha = 0.3f))
                Spacer(Modifier.height(8.dp))
                Text("Campaign length", fontSize = 18.sp, fontWeight = FontWeight.Bold)
                Text(
                    "Choose how many months to prepay (discounts apply). Campaign start must be $CAMPAIGN_START_MIN_LEAD_DAYS–$CAMPAIGN_START_MAX_LEAD_DAYS days from today.",
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(8.dp))
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    listOf(1, 2, 3, 6).forEach { months ->
                        FilterChip(
                            selected = selectedDurationMonths == months,
                            onClick = { selectedDurationMonths = months },
                            label = { Text("$months mo") },
                            colors = FilterChipDefaults.filterChipColors(
                                selectedContainerColor = FormColors.SelectedChip,
                                selectedLabelColor = FormColors.SelectedChipText,
                            ),
                        )
                    }
                }
                Spacer(Modifier.height(8.dp))
                CampaignStartDateField(
                    campaignStartDateIso = campaignStartDateIso,
                    onDateSelected = {
                        campaignStartDateIso = it
                        startDateError = null
                    },
                    errorText = startDateError,
                )
            }

            // Targeting Radius Section
            val preview = radiusPreview
            if (preview != null && preview.tiers.isNotEmpty()) {
                Spacer(Modifier.height(8.dp))
                HorizontalDivider(color = FormColors.Divider.copy(alpha = 0.3f))
                Spacer(Modifier.height(4.dp))

                Text("Targeting Radius", fontSize = 18.sp, fontWeight = FontWeight.Bold)
                Text(
                    "Choose how far your ad reaches from ${preview.homeCityName}.",
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )

                Spacer(Modifier.height(4.dp))

                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    preview.tiers.forEach { tier ->
                        val tierSelectable = if (selectableRadii.isNotEmpty()) {
                            tier.radiusMiles in selectableRadii
                        } else {
                            tier.selectable
                        }
                        FilterChip(
                            selected = selectedRadiusMiles == tier.radiusMiles,
                            onClick = {
                                if (tierSelectable) {
                                    selectedRadiusMiles = tier.radiusMiles
                                    radiusOrPackageError = null
                                }
                            },
                            label = { Text("${tier.radiusMiles} mi") },
                            enabled = tierSelectable,
                            colors = FilterChipDefaults.filterChipColors(
                                selectedContainerColor = FormColors.SelectedChip,
                                selectedLabelColor = FormColors.SelectedChipText,
                            ),
                        )
                    }
                }

                key(selectedRadiusMiles) {
                    selectedTier?.let { tier ->
                        Surface(
                            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                            shape = RoundedCornerShape(12.dp),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Column(modifier = Modifier.padding(12.dp)) {
                                if (tier.surchargeInCents == 0) {
                                    Text("Included", fontWeight = FontWeight.SemiBold, fontSize = 14.sp, color = FormColors.PrimaryButton)
                                } else {
                                    Text(
                                        "+" + formatCents(tier.surchargeInCents) + " surcharge",
                                        fontWeight = FontWeight.SemiBold,
                                        fontSize = 14.sp,
                                        color = FormColors.PrimaryButton,
                                    )
                                }
                                Spacer(Modifier.height(4.dp))
                                val cityCount = if (tier.count < 1) 1 else tier.count
                                val cityPlural = if (cityCount != 1) "cities" else "city"
                                Text(
                                    "${cityCount} ${cityPlural} reached",
                                    fontSize = 13.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                                if (tier.userCount > 0) {
                                    Text(
                                        "${tier.userCount} active users in range",
                                        fontSize = 12.sp,
                                        color = FormColors.PrimaryButton,
                                    )
                                }
                                val cityNames = if (tier.cities.isNotEmpty()) tier.cities else listOf(preview.homeCityName)
                                Spacer(Modifier.height(2.dp))
                                Text(
                                    cityNames.joinToString(", "),
                                    fontSize = 12.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.8f),
                                )
                            }
                        }
                    }
                }
            }

            // Total (always when a package is selected — updates as soon as radius tier / duration changes)
            val pkgForTotal = selectedPkg
            if (pkgForTotal != null) {
                Spacer(Modifier.height(4.dp))
                Surface(
                    color = Color(0xFFF5F5F5),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column(modifier = Modifier.padding(12.dp).fillMaxWidth()) {
                        if (!pkgForTotal.isEvent) {
                            val subtotal = selectedDurationMonths * pkgForTotal.priceInCents
                            val frac = multiMonthDiscountFraction(selectedDurationMonths)
                            val discount = (subtotal * frac).toInt()
                            Text(
                                "${selectedDurationMonths} mo × ${formatCents(pkgForTotal.priceInCents)}/mo = ${formatCents(subtotal)}",
                                fontSize = 12.sp,
                                color = Color(0xFF616161),
                            )
                            if (discount > 0) {
                                Text(
                                    "Multi-month savings (${(frac * 100).toInt()}%): −${formatCents(discount)}",
                                    fontSize = 12.sp,
                                    color = Color(0xFF2E7D32),
                                )
                            }
                        }
                        if (radiusSurcharge > 0) {
                            Text(
                                "Radius reach surcharge: +${formatCents(radiusSurcharge)}",
                                fontSize = 12.sp,
                                color = Color(0xFF616161),
                            )
                        }
                        Spacer(Modifier.height(6.dp))
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text("Total", fontWeight = FontWeight.Bold, fontSize = 15.sp, color = Color(0xFF212121))
                            Text(
                                formatCents(totalPriceInCents),
                                fontWeight = FontWeight.Bold,
                                fontSize = 16.sp,
                                color = Color(0xFF212121),
                            )
                        }
                    }
                }
            }
        }
        // Advance booking note
        Surface(
            color = FormColors.PrimaryButton.copy(alpha = 0.08f),
            shape = RoundedCornerShape(10.dp),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(
                "Tip: choose 2, 3, or 6 months on Prime or Inline to save. Around the halfway point of a paid campaign we email a one-time 20% code for your next booking (or when it ends if you have not received it yet).",
                fontSize = 13.sp,
                color = FormColors.SecondaryButtonText,
                modifier = Modifier.padding(12.dp),
            )
        }

        errorMessage?.let {
            Text(it, color = FormColors.ErrorText, fontSize = 13.sp)
            Spacer(Modifier.height(8.dp))
        }

        Spacer(Modifier.height(8.dp))

        // Continue button
        Button(
            onClick = {
                val pkgType = selectedType ?: return@Button
                startDateError = null
                radiusOrPackageError = null
                errorMessage = null
                if (pkgType == "featured_home" || pkgType == "inline_listing") {
                    if (!isCampaignStartDateInRange(campaignStartDateIso)) {
                        startDateError = "Pick a start date between $CAMPAIGN_START_MIN_LEAD_DAYS and $CAMPAIGN_START_MAX_LEAD_DAYS days from today."
                        return@Button
                    }
                }
                scope.launch {
                    isSubmitting = true
                    try {
                        val body = buildJsonObject {
                            put("step", 2)
                            put("packageType", pkgType)
                            put("targetingRadiusMiles", selectedRadiusMiles)
                            if (!pkgType.startsWith("event_spotlight")) {
                                put("durationMonths", selectedDurationMonths)
                                put("startDate", campaignStartDateIso.trim())
                            }
                        }
                        playgroundService.updateSubmissionJson(submissionId, body)
                        onPackageSelected()
                    } catch (e: Exception) {
                        val msg = humanizeAdvertisingApiError(e.message ?: "")
                            .ifBlank { "Something went wrong. Please try again." }
                        when {
                            msg.contains("start date", ignoreCase = true) ||
                                msg.contains("2 days", ignoreCase = true) ||
                                msg.contains("7 days", ignoreCase = true) ||
                                msg.contains("30 days", ignoreCase = true) -> startDateError = msg
                            msg.contains("radius", ignoreCase = true) ||
                                msg.contains("miles", ignoreCase = true) ||
                                msg.contains("reach", ignoreCase = true) ||
                                msg.contains("cities beyond", ignoreCase = true) -> radiusOrPackageError = msg
                            else -> errorMessage = msg
                        }
                    } finally {
                        isSubmitting = false
                    }
                }
            },
            enabled = selectedType != null && !isSubmitting && !isLoadingPrices,
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp),
            shape = RoundedCornerShape(16.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = FormColors.PrimaryButton,
                contentColor = FormColors.PrimaryButtonText,
            ),
        ) {
            if (isSubmitting) {
                CircularProgressIndicator(
                    modifier = Modifier.size(20.dp),
                    color = FormColors.PrimaryButtonText,
                    strokeWidth = 2.dp,
                )
            } else {
                Text("Continue", fontWeight = FontWeight.Bold)
            }
        }
    }
}