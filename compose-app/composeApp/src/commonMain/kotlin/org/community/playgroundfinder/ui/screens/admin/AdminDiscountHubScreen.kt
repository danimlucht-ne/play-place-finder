package org.community.playgroundfinder.ui.screens.admin

import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import kotlinx.datetime.Clock
import kotlinx.datetime.DatePeriod
import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone
import kotlinx.datetime.plus
import kotlinx.datetime.todayIn
import org.community.playgroundfinder.AppConfig
import org.community.playgroundfinder.data.PlaygroundService
import org.community.playgroundfinder.models.CityPhaseListItem
import org.community.playgroundfinder.models.DiscountCode
import org.community.playgroundfinder.models.DiscountRedemption
import org.community.playgroundfinder.models.AdvertiserListItem
import org.community.playgroundfinder.ui.composables.FormColors
import org.community.playgroundfinder.ui.screens.advertising.datePickerUtcMillisToLocalDate
import org.community.playgroundfinder.ui.screens.advertising.localDateToDatePickerUtcMillis

private fun formatRegionLabel(cityId: String): String =
    cityId.split('-').joinToString(" ") { part ->
        part.replaceFirstChar { c -> if (c.isLowerCase()) c.titlecase() else c.toString() }
    }.ifBlank { cityId }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AdminDiscountHubScreen(
    playgroundService: PlaygroundService,
    @Suppress("UNUSED_PARAMETER") onBack: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val zone = TimeZone.currentSystemDefault()
    val showDevDiscountOptions = AppConfig.isDebugDevelopmentBuild

    // --- List state ---
    var codes by remember { mutableStateOf<List<DiscountCode>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var listError by remember { mutableStateOf<String?>(null) }

    // --- Reference data for scoped codes ---
    var cities by remember { mutableStateOf<List<CityPhaseListItem>>(emptyList()) }
    var advertisers by remember { mutableStateOf<List<AdvertiserListItem>>(emptyList()) }
    var metaLoaded by remember { mutableStateOf(false) }

    // --- Create form state ---
    var codeName by remember { mutableStateOf("") }
    var percentOff by remember { mutableStateOf("") }
    var maxUses by remember { mutableStateOf("") }
    var startDateIso by remember { mutableStateOf("") }
    var endDateIso by remember { mutableStateOf("") }
    var selectedRegionKey by remember { mutableStateOf<String?>(null) }
    var selectedAdvertiserId by remember { mutableStateOf<String?>(null) }
    var regionMenuExpanded by remember { mutableStateOf(false) }
    var advertiserMenuExpanded by remember { mutableStateOf(false) }
    var showStartPicker by remember { mutableStateOf(false) }
    var showEndPicker by remember { mutableStateOf(false) }
    var devOnly by remember { mutableStateOf(false) }
    var unlimitedValidity by remember { mutableStateOf(false) }
    var createError by remember { mutableStateOf<String?>(null) }
    var isCreating by remember { mutableStateOf(false) }

    // --- Detail dialog state ---
    var selectedCode by remember { mutableStateOf<DiscountCode?>(null) }
    var redemptions by remember { mutableStateOf<List<DiscountRedemption>>(emptyList()) }
    var redemptionsLoading by remember { mutableStateOf(false) }

    val selectableDatesWide = remember {
        object : SelectableDates {
            override fun isSelectableDate(utcTimeMillis: Long) = true
            override fun isSelectableYear(year: Int) = year in 2000..2100
        }
    }

    LaunchedEffect(Unit) {
        val today = Clock.System.todayIn(zone)
        if (startDateIso.isBlank()) startDateIso = today.toString()
        if (endDateIso.isBlank()) endDateIso = today.plus(DatePeriod(years = 1)).toString()
    }

    fun loadCodes() {
        scope.launch {
            isLoading = true
            listError = null
            try {
                codes = playgroundService.getDiscountCodes()
            } catch (e: Exception) {
                listError = e.message ?: "Failed to load discount codes"
            }
            isLoading = false
        }
    }

    fun loadMeta() {
        scope.launch {
            try {
                val c = async { playgroundService.getAdminCityPhases() }
                val a = async { playgroundService.getAdvertisers() }
                cities = c.await().sortedBy { it.cityId }
                advertisers = a.await().sortedBy { it.businessName.lowercase() }
            } catch (_: Exception) {
                cities = emptyList()
                advertisers = emptyList()
            }
            metaLoaded = true
        }
    }

    fun createCode() {
        val pct = percentOff.toIntOrNull()
        val maxUsesInt = maxUses.toIntOrNull() ?: 0
        if (codeName.isBlank() || pct == null || pct !in 1..100) {
            createError = "Code and a percentage from 1 to 100 are required"
            return
        }
        val effectiveDevOnly = devOnly || unlimitedValidity
        val effectiveUnlimited = unlimitedValidity && effectiveDevOnly
        if (!effectiveUnlimited) {
            if (startDateIso.isBlank() || endDateIso.isBlank()) {
                createError = "Choose start and end dates, or enable unlimited validity (debug builds only)"
                return
            }
            val startLd = runCatching { LocalDate.parse(startDateIso) }.getOrNull()
            val endLd = runCatching { LocalDate.parse(endDateIso) }.getOrNull()
            if (startLd == null || endLd == null || endLd < startLd) {
                createError = "End date must be on or after start date"
                return
            }
        }
        if (unlimitedValidity && !showDevDiscountOptions) {
            createError = "Unlimited validity is only available in debug builds"
            return
        }
        scope.launch {
            isCreating = true
            createError = null
            try {
                playgroundService.createDiscountCode(
                    code = codeName.trim(),
                    percentOff = pct,
                    startDate = if (effectiveUnlimited) "" else startDateIso.trim(),
                    endDate = if (effectiveUnlimited) "" else endDateIso.trim(),
                    maxUses = maxUsesInt,
                    regionKey = selectedRegionKey?.trim()?.takeIf { it.isNotEmpty() },
                    advertiserId = selectedAdvertiserId?.trim()?.takeIf { it.isNotEmpty() },
                    devOnly = effectiveDevOnly,
                    unlimitedValidity = effectiveUnlimited,
                )
                codeName = ""
                percentOff = ""
                maxUses = ""
                selectedRegionKey = null
                selectedAdvertiserId = null
                devOnly = false
                unlimitedValidity = false
                val today = Clock.System.todayIn(zone)
                startDateIso = today.toString()
                endDateIso = today.plus(DatePeriod(years = 1)).toString()
                loadCodes()
            } catch (e: Exception) {
                createError = e.message ?: "Failed to create discount code"
            }
            isCreating = false
        }
    }

    fun deactivateCode(id: String) {
        scope.launch {
            try {
                playgroundService.deactivateDiscountCode(id)
                loadCodes()
            } catch (e: Exception) {
                listError = e.message ?: "Failed to deactivate code"
            }
        }
    }

    fun showDetail(code: DiscountCode) {
        selectedCode = code
        redemptions = emptyList()
        redemptionsLoading = true
        scope.launch {
            try {
                redemptions = playgroundService.getDiscountRedemptions(code._id)
            } catch (_: Exception) { }
            redemptionsLoading = false
        }
    }

    LaunchedEffect(Unit) {
        loadCodes()
        loadMeta()
    }

    val regionMenuLabel = selectedRegionKey?.let { formatRegionLabel(it) } ?: "Any region"
    val advertiserMenuLabel = selectedAdvertiserId?.let { id ->
        advertisers.find { it._id == id }?.let { adv ->
            "${adv.businessName} (${adv.regionKey})"
        } ?: id.takeLast(8)
    } ?: "Any advertiser"

    // --- Detail Dialog ---
    if (selectedCode != null) {
        val c = selectedCode!!
        AlertDialog(
            onDismissRequest = { selectedCode = null },
            confirmButton = {
                TextButton(onClick = { selectedCode = null }) { Text("Close") }
            },
            title = { Text(c.code, fontWeight = FontWeight.Bold) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("${c.percentOff}% off")
                    if (c.unlimitedValidity) {
                        Text("Validity: unlimited (dev)", fontSize = 13.sp, color = Color.Gray)
                    } else {
                        Text("Valid: ${c.startDate.take(10)} — ${c.endDate.take(10)}", fontSize = 13.sp, color = Color.Gray)
                    }
                    Text("Status: ${if (c.active) "Active" else "Inactive"}")
                    if (c.regionKey != null) {
                        Text("Region: ${formatRegionLabel(c.regionKey!!)}", fontSize = 13.sp)
                    }
                    if (c.advertiserId != null) {
                        Text("Advertiser ID: ${c.advertiserId}", fontSize = 13.sp)
                    }
                    if (c.devOnly) {
                        Text("Dev / test DB only", fontSize = 12.sp, color = MaterialTheme.colorScheme.tertiary)
                    }
                    HorizontalDivider()
                    Text(
                        text = "Uses: ${c.usageCount}${
                            if (c.maxUses > 0) " / ${c.maxUses} max" else " (no cap)"
                        }",
                        fontWeight = FontWeight.SemiBold,
                    )

                    if (redemptionsLoading) {
                        CircularProgressIndicator(modifier = Modifier.size(24.dp))
                    } else if (redemptions.isEmpty()) {
                        Text("No redemptions yet", fontSize = 13.sp, color = Color.Gray)
                    } else {
                        Text("Recent redemptions:", fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                        redemptions.take(10).forEach { r ->
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                            ) {
                                Text("Sub: ${r.submissionId.takeLast(6)}", fontSize = 12.sp)
                                Text(r.redeemedAt.take(10), fontSize = 12.sp, color = Color.Gray)
                            }
                        }
                    }
                }
            },
        )
    }

    Column(modifier = Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Spacer(Modifier.width(8.dp))
        }

        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            contentPadding = PaddingValues(bottom = 24.dp),
        ) {
            item {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    elevation = CardDefaults.cardElevation(2.dp),
                ) {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text("Create Discount Code", fontWeight = FontWeight.SemiBold, fontSize = 16.sp)

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            OutlinedTextField(
                                value = codeName,
                                onValueChange = { codeName = it },
                                label = { Text("Code Name") },
                                modifier = Modifier.weight(1f),
                                singleLine = true,
                            )
                            OutlinedButton(
                                onClick = {
                                    val chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
                                    codeName = (1..6).map { chars.random() }.joinToString("")
                                },
                                modifier = Modifier.height(56.dp),
                            ) {
                                Text("Generate", fontSize = 12.sp)
                            }
                        }
                        OutlinedTextField(
                            value = percentOff,
                            onValueChange = { percentOff = it },
                            label = { Text("Percentage Off (1-100)") },
                            modifier = Modifier.fillMaxWidth(),
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        )
                        OutlinedTextField(
                            value = maxUses,
                            onValueChange = { maxUses = it },
                            label = { Text("Max Uses (0 = unlimited)") },
                            modifier = Modifier.fillMaxWidth(),
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        )

                        ExposedDropdownMenuBox(
                            expanded = regionMenuExpanded,
                            onExpandedChange = { regionMenuExpanded = it },
                        ) {
                            OutlinedTextField(
                                value = regionMenuLabel,
                                onValueChange = {},
                                readOnly = true,
                                label = { Text("Limit to region") },
                                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = regionMenuExpanded) },
                                modifier = Modifier.fillMaxWidth().menuAnchor(),
                            )
                            ExposedDropdownMenu(
                                expanded = regionMenuExpanded,
                                onDismissRequest = { regionMenuExpanded = false },
                            ) {
                                DropdownMenuItem(
                                    text = { Text("Any region") },
                                    onClick = {
                                        selectedRegionKey = null
                                        regionMenuExpanded = false
                                    },
                                )
                                cities.forEach { city ->
                                    DropdownMenuItem(
                                        text = {
                                            Column {
                                                Text(formatRegionLabel(city.cityId))
                                                Text(city.cityId, fontSize = 11.sp, color = Color.Gray)
                                            }
                                        },
                                        onClick = {
                                            selectedRegionKey = city.cityId
                                            regionMenuExpanded = false
                                        },
                                    )
                                }
                            }
                        }

                        ExposedDropdownMenuBox(
                            expanded = advertiserMenuExpanded,
                            onExpandedChange = { advertiserMenuExpanded = it },
                        ) {
                            OutlinedTextField(
                                value = advertiserMenuLabel,
                                onValueChange = {},
                                readOnly = true,
                                label = { Text("Limit to advertiser") },
                                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = advertiserMenuExpanded) },
                                modifier = Modifier.fillMaxWidth().menuAnchor(),
                            )
                            ExposedDropdownMenu(
                                expanded = advertiserMenuExpanded,
                                onDismissRequest = { advertiserMenuExpanded = false },
                            ) {
                                DropdownMenuItem(
                                    text = { Text("Any advertiser") },
                                    onClick = {
                                        selectedAdvertiserId = null
                                        advertiserMenuExpanded = false
                                    },
                                )
                                advertisers.forEach { adv ->
                                    DropdownMenuItem(
                                        text = {
                                            Column {
                                                Text(adv.businessName, fontWeight = FontWeight.Medium)
                                                Text(
                                                    "${adv.regionKey} · ${adv._id} · ${adv.submissionCount} subs, ${adv.campaignCount} campaigns",
                                                    fontSize = 11.sp,
                                                    color = Color.Gray,
                                                )
                                            }
                                        },
                                        onClick = {
                                            selectedAdvertiserId = adv._id
                                            advertiserMenuExpanded = false
                                        },
                                    )
                                }
                            }
                        }

                        if (!metaLoaded) {
                            Text("Loading regions and advertisers…", fontSize = 12.sp, color = Color.Gray)
                        } else if (cities.isEmpty() && advertisers.isEmpty()) {
                            Text(
                                "Could not load region/advertiser lists; you can still create codes without scoping.",
                                fontSize = 12.sp,
                                color = Color.Gray,
                            )
                        }

                        if (showDevDiscountOptions) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Checkbox(
                                    checked = devOnly,
                                    onCheckedChange = {
                                        devOnly = it
                                        if (!it) unlimitedValidity = false
                                    },
                                )
                                Column(modifier = Modifier.weight(1f)) {
                                    Text("Dev / test DB only", fontWeight = FontWeight.Medium)
                                    Text(
                                        "Code is rejected in production unless the server allows dev discount codes.",
                                        fontSize = 11.sp,
                                        color = Color.Gray,
                                    )
                                }
                            }
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Checkbox(
                                    checked = unlimitedValidity,
                                    onCheckedChange = { checked ->
                                        unlimitedValidity = checked
                                        if (checked) devOnly = true
                                    },
                                )
                                Column(modifier = Modifier.weight(1f)) {
                                    Text("Unlimited date range", fontWeight = FontWeight.Medium)
                                    Text(
                                        "Server stores a wide window; implies dev-only. Pair with 100% off and max uses 0 for free test checkout.",
                                        fontSize = 11.sp,
                                        color = Color.Gray,
                                    )
                                }
                            }
                        }

                        if (!unlimitedValidity) {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                DiscountDatePickerField(
                                    label = "Start date",
                                    dateIso = startDateIso,
                                    onPickClick = { showStartPicker = true },
                                    modifier = Modifier.weight(1f),
                                )
                                DiscountDatePickerField(
                                    label = "End date",
                                    dateIso = endDateIso,
                                    onPickClick = { showEndPicker = true },
                                    modifier = Modifier.weight(1f),
                                )
                            }
                        } else {
                            Text("Dates skipped (unlimited validity)", fontSize = 13.sp, color = Color.Gray)
                        }

                        if (showStartPicker) {
                            DiscountWideDatePickerDialog(
                                initialIso = startDateIso,
                                zone = zone,
                                selectableDates = selectableDatesWide,
                                onDismiss = { showStartPicker = false },
                                onConfirm = { startDateIso = it.toString() },
                            )
                        }
                        if (showEndPicker) {
                            DiscountWideDatePickerDialog(
                                initialIso = endDateIso,
                                zone = zone,
                                selectableDates = selectableDatesWide,
                                onDismiss = { showEndPicker = false },
                                onConfirm = { endDateIso = it.toString() },
                            )
                        }

                        if (createError != null) {
                            Text(createError!!, color = FormColors.ErrorText, fontSize = 13.sp)
                        }

                        Button(
                            onClick = { createCode() },
                            enabled = !isCreating,
                            modifier = Modifier.fillMaxWidth(),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = FormColors.PrimaryButton,
                                contentColor = FormColors.PrimaryButtonText,
                            ),
                        ) {
                            if (isCreating) {
                                CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                                Spacer(Modifier.width(8.dp))
                            }
                            Text("Create Code")
                        }
                    }
                }
            }

            if (isLoading) {
                item {
                    Box(modifier = Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator()
                    }
                }
            } else if (listError != null) {
                item {
                    Column(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text(listError!!, color = FormColors.ErrorText)
                        Spacer(Modifier.height(8.dp))
                        Button(
                            onClick = { loadCodes() },
                            colors = ButtonDefaults.buttonColors(
                                containerColor = FormColors.PrimaryButton,
                                contentColor = FormColors.PrimaryButtonText,
                            ),
                        ) { Text("Retry") }
                    }
                }
            } else if (codes.isEmpty()) {
                item {
                    Text("No discount codes yet", color = Color.Gray, modifier = Modifier.padding(vertical = 16.dp))
                }
            } else {
                items(codes, key = { it._id }) { code ->
                    DiscountCodeCard(
                        code = code,
                        onClick = { showDetail(code) },
                        onDeactivate = { deactivateCode(code._id) },
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DiscountWideDatePickerDialog(
    initialIso: String,
    zone: TimeZone,
    selectableDates: SelectableDates,
    onDismiss: () -> Unit,
    onConfirm: (LocalDate) -> Unit,
) {
    val initialLd = runCatching { LocalDate.parse(initialIso.trim()) }.getOrElse { Clock.System.todayIn(zone) }
    val pickerState = rememberDatePickerState(
        initialSelectedDateMillis = localDateToDatePickerUtcMillis(initialLd),
        selectableDates = selectableDates,
    )
    DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(
                onClick = {
                    val ms = pickerState.selectedDateMillis ?: localDateToDatePickerUtcMillis(initialLd)
                    onConfirm(datePickerUtcMillisToLocalDate(ms))
                    onDismiss()
                },
            ) { Text("OK") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        },
    ) {
        DatePicker(state = pickerState)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DiscountDatePickerField(
    label: String,
    dateIso: String,
    onPickClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val display = remember(dateIso) {
        runCatching { LocalDate.parse(dateIso.trim()).toString() }.getOrElse { "Pick date" }
    }
    OutlinedTextField(
        value = display,
        onValueChange = {},
        readOnly = true,
        label = { Text(label) },
        trailingIcon = {
            IconButton(onClick = onPickClick) {
                Icon(Icons.Default.DateRange, contentDescription = "Pick date")
            }
        },
        modifier = modifier.clickable(
            indication = null,
            interactionSource = remember { MutableInteractionSource() },
        ) { onPickClick() },
    )
}

@Composable
private fun DiscountCodeCard(
    code: DiscountCode,
    onClick: () -> Unit,
    onDeactivate: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable { onClick() },
        elevation = CardDefaults.cardElevation(1.dp),
    ) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(code.code, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                Surface(
                    shape = RoundedCornerShape(12.dp),
                    color = MaterialTheme.colorScheme.primaryContainer,
                ) {
                    Text(
                        "${code.percentOff}% off",
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
            }

            if (code.unlimitedValidity) {
                Text("Unlimited validity (dev)", fontSize = 13.sp, color = Color.Gray)
            } else {
                Text("${code.startDate.take(10)} — ${code.endDate.take(10)}", fontSize = 13.sp, color = Color.Gray)
            }
            if (code.regionKey != null) {
                Text("Region: ${code.regionKey}", fontSize = 12.sp, color = Color.DarkGray)
            }
            if (code.advertiserId != null) {
                Text("Advertiser: …${code.advertiserId!!.takeLast(8)}", fontSize = 12.sp, color = Color.DarkGray)
            }
            if (code.devOnly) {
                Text("DEV ONLY", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.tertiary)
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Surface(
                    shape = RoundedCornerShape(12.dp),
                    color = if (code.active) Color(0xFF4CAF50) else Color(0xFFF44336),
                ) {
                    Text(
                        if (code.active) "Active" else "Inactive",
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                        fontSize = 12.sp,
                        color = Color.White,
                    )
                }

                val usesLine = if (code.maxUses > 0) {
                    "Used ${code.usageCount} / ${code.maxUses}"
                } else {
                    "Used ${code.usageCount} (no cap)"
                }
                Text(usesLine, fontSize = 13.sp, color = Color.Gray)
            }

            if (code.active) {
                OutlinedButton(
                    onClick = onDeactivate,
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = Color(0xFFF44336)),
                ) {
                    Text("Deactivate")
                }
            }
        }
    }
}
