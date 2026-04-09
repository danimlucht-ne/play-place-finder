package org.community.playgroundfinder.ui.screens.admin

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.community.playgroundfinder.data.PlaygroundService
import org.community.playgroundfinder.models.SeededRegion
import org.community.playgroundfinder.ui.composables.AmenityTypeMapping
import org.community.playgroundfinder.ui.composables.FormColors

private sealed class SingleRegionPick {
    data object None : SingleRegionPick()
    data class One(val region: SeededRegion) : SingleRegionPick()
}

private fun SingleRegionPick.displayLabel(): String = when (this) {
    SingleRegionPick.None -> ""
    is SingleRegionPick.One -> {
        val r = region
        val citySt = listOf(r.displayCity.ifBlank { r.city }, r.state).filter { it.isNotBlank() }.joinToString(", ")
        if (citySt.isNotBlank()) "$citySt (${r.regionKey})" else r.regionKey
    }
}

private fun effectiveRegionKey(pick: SingleRegionPick, manualKey: String): String =
    manualKey.trim().takeIf { it.isNotBlank() }
        ?: (pick as? SingleRegionPick.One)?.region?.regionKey?.trim().orEmpty()

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SeededRegionKeyPicker(
    label: String,
    placeholderText: String,
    filteredRegions: List<SeededRegion>,
    regionsLoading: Boolean,
    pick: SingleRegionPick,
    onPick: (SingleRegionPick) -> Unit,
    manualKey: String,
    onManualChange: (String) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }

    ExposedDropdownMenuBox(
        expanded = expanded,
        onExpandedChange = { expanded = it },
        modifier = Modifier.fillMaxWidth(),
    ) {
        OutlinedTextField(
            value = when {
                manualKey.trim().isNotEmpty() -> manualKey.trim()
                else -> pick.displayLabel()
            },
            onValueChange = {},
            readOnly = true,
            label = { Text(label) },
            placeholder = { Text(placeholderText) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            modifier = Modifier.fillMaxWidth().menuAnchor(),
            enabled = !regionsLoading,
        )
        ExposedDropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
            modifier = Modifier.heightIn(max = 320.dp),
        ) {
            filteredRegions.forEach { r ->
                DropdownMenuItem(
                    text = {
                        Text(
                            SingleRegionPick.One(r).displayLabel(),
                            fontSize = 14.sp,
                        )
                    },
                    onClick = {
                        onPick(SingleRegionPick.One(r))
                        onManualChange("")
                        expanded = false
                    },
                )
            }
        }
    }
    OutlinedTextField(
        value = manualKey,
        onValueChange = {
            onManualChange(it)
            if (it.isNotBlank()) onPick(SingleRegionPick.None)
        },
        label = { Text("Or type regionKey manually") },
        supportingText = {
            Text("Overrides the menu when non-empty.", fontSize = 11.sp, color = Color(0xFF757575))
        },
        modifier = Modifier.fillMaxWidth(),
        singleLine = true,
    )
}

private sealed class TypeLabelPick {
    data object None : TypeLabelPick()
    data class One(val label: String) : TypeLabelPick()
}

private fun effectivePlaygroundTypeLabel(pick: TypeLabelPick, manual: String): String =
    manual.trim().takeIf { it.isNotEmpty() }
        ?: (pick as? TypeLabelPick.One)?.label?.trim().orEmpty()

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PlaygroundTypeLabelPicker(
    label: String,
    placeholderText: String,
    typeLabels: List<String>,
    pick: TypeLabelPick,
    onPick: (TypeLabelPick) -> Unit,
    manualValue: String,
    onManualChange: (String) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }

    ExposedDropdownMenuBox(
        expanded = expanded,
        onExpandedChange = { expanded = it },
        modifier = Modifier.fillMaxWidth(),
    ) {
        OutlinedTextField(
            value = when {
                manualValue.trim().isNotEmpty() -> manualValue.trim()
                else -> (pick as? TypeLabelPick.One)?.label.orEmpty()
            },
            onValueChange = {},
            readOnly = true,
            label = { Text(label) },
            placeholder = { Text(placeholderText) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            modifier = Modifier.fillMaxWidth().menuAnchor(),
        )
        ExposedDropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
            modifier = Modifier.heightIn(max = 320.dp),
        ) {
            typeLabels.forEach { t ->
                DropdownMenuItem(
                    text = { Text(t, fontSize = 14.sp) },
                    onClick = {
                        onPick(TypeLabelPick.One(t))
                        onManualChange("")
                        expanded = false
                    },
                )
            }
        }
    }
    OutlinedTextField(
        value = manualValue,
        onValueChange = {
            onManualChange(it)
            if (it.isNotBlank()) onPick(TypeLabelPick.None)
        },
        label = { Text("Or type activity label exactly") },
        supportingText = {
            Text(
                "Must match stored playgroundType (e.g. Mini Golf). Overrides the menu.",
                fontSize = 11.sp,
                color = Color(0xFF757575),
            )
        },
        modifier = Modifier.fillMaxWidth(),
        singleLine = true,
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AdminBulkToolsScreen(
    service: PlaygroundService,
) {
    val scope = rememberCoroutineScope()

    var regions by remember { mutableStateOf<List<SeededRegion>>(emptyList()) }
    var regionsLoading by remember { mutableStateOf(true) }
    var regionsLoadError by remember { mutableStateOf<String?>(null) }
    var regionFilter by remember { mutableStateOf("") }

    LaunchedEffect(Unit) {
        regionsLoading = true
        regionsLoadError = null
        try {
            regions = service.getSeededRegions().data
        } catch (e: Exception) {
            regionsLoadError = e.message ?: "Could not load regions"
            regions = emptyList()
        } finally {
            regionsLoading = false
        }
    }

    val filteredRegions = remember(regions, regionFilter) {
        val q = regionFilter.trim().lowercase()
        if (q.isEmpty()) regions
        else regions.filter { r ->
            r.regionKey.lowercase().contains(q) ||
                r.displayCity.ifBlank { r.city }.lowercase().contains(q) ||
                r.state.lowercase().contains(q)
        }
    }.sortedWith(
        compareBy<SeededRegion> { it.state.lowercase() }
            .thenBy { it.displayCity.ifBlank { it.city }.lowercase() }
            .thenBy { it.regionKey },
    )

    var fromPick by remember { mutableStateOf<SingleRegionPick>(SingleRegionPick.None) }
    var fromManualKey by remember { mutableStateOf("") }
    var toPick by remember { mutableStateOf<SingleRegionPick>(SingleRegionPick.None) }
    var toManualKey by remember { mutableStateOf("") }
    var mergeDryRun by remember { mutableStateOf(true) }
    var mergeLoading by remember { mutableStateOf(false) }
    var mergeResult by remember { mutableStateOf<String?>(null) }
    var mergeError by remember { mutableStateOf<String?>(null) }

    val knownTypeLabels = remember { AmenityTypeMapping.knownPlaygroundTypeLabels }

    var nameContains by remember { mutableStateOf("") }
    var activityTypePick by remember { mutableStateOf<TypeLabelPick>(TypeLabelPick.None) }
    var activityTypeManual by remember { mutableStateOf("") }
    var tagDryRun by remember { mutableStateOf(true) }
    var tagLoading by remember { mutableStateOf(false) }
    var tagResult by remember { mutableStateOf<String?>(null) }
    var tagError by remember { mutableStateOf<String?>(null) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(
            "Region merge & set activity by name",
            fontWeight = FontWeight.Bold,
            fontSize = 18.sp,
            color = FormColors.PrimaryButton,
        )
        Text(
            "Merge moves every playground from one regionKey to another. " +
                "Set activity by name matches place names in any region and sets Location type (playgroundType) only — " +
                "e.g. name contains \"putt putt\" and activity Mini Golf. Region keys are not changed.",
            fontSize = 13.sp,
            color = Color(0xFF616161),
        )

        if (regionsLoading) {
            LinearProgressIndicator(Modifier.fillMaxWidth())
            Text("Loading regions…", fontSize = 12.sp, color = Color.Gray)
        }
        regionsLoadError?.let { Text(it, color = FormColors.ErrorText, fontSize = 13.sp) }

        OutlinedTextField(
            value = regionFilter,
            onValueChange = { regionFilter = it },
            label = { Text("Filter region list (optional)") },
            supportingText = { Text("Narrows all dropdowns below by city, state, or key.", fontSize = 11.sp) },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            enabled = !regionsLoading,
        )

        Text("Merge regions", fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
        SeededRegionKeyPicker(
            label = "From regionKey (source)",
            placeholderText = "Choose source region",
            filteredRegions = filteredRegions,
            regionsLoading = regionsLoading,
            pick = fromPick,
            onPick = { fromPick = it },
            manualKey = fromManualKey,
            onManualChange = { fromManualKey = it },
        )
        SeededRegionKeyPicker(
            label = "To regionKey (target)",
            placeholderText = "Choose target region",
            filteredRegions = filteredRegions,
            regionsLoading = regionsLoading,
            pick = toPick,
            onPick = { toPick = it },
            manualKey = toManualKey,
            onManualChange = { toManualKey = it },
        )
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = mergeDryRun, onCheckedChange = { mergeDryRun = it })
            Text("Dry run (merge)", fontSize = 14.sp)
        }
        mergeError?.let { Text(it, color = FormColors.ErrorText, fontSize = 13.sp) }
        mergeResult?.let { Text(it, fontSize = 13.sp, color = Color(0xFF2E7D32)) }
        Button(
            onClick = {
                val from = effectiveRegionKey(fromPick, fromManualKey)
                val to = effectiveRegionKey(toPick, toManualKey)
                if (from.isBlank() || to.isBlank()) {
                    mergeError = "Choose or enter both region keys."
                    return@Button
                }
                scope.launch {
                    mergeLoading = true
                    mergeError = null
                    mergeResult = null
                    try {
                        val resp = service.adminReassignRegion(
                            from,
                            to,
                            mergeDryRun,
                        )
                        val err = resp["error"]?.toString()
                        if (err != null) mergeError = err
                        else {
                            @Suppress("UNCHECKED_CAST")
                            val data = resp["data"] as? Map<String, Any?>
                            mergeResult = if (data != null) {
                                val dry = data["dryRun"] == true
                                val n = data["matchedCount"]?.toString() ?: "?"
                                val mod = data["modifiedCount"]?.toString() ?: "—"
                                buildString {
                                    append(if (dry) "Merge dry run: " else "Merge applied: ")
                                    append("matched=$n")
                                    if (!dry) append(", modified=$mod")
                                }
                            } else resp.toString()
                        }
                    } catch (e: Exception) {
                        mergeError = e.message ?: "Request failed"
                    } finally {
                        mergeLoading = false
                    }
                }
            },
            enabled = !mergeLoading,
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(containerColor = FormColors.PrimaryButton),
        ) {
            Text(if (mergeDryRun) "Preview merge" else "Apply merge")
        }
        if (mergeLoading) LinearProgressIndicator(Modifier.fillMaxWidth())

        HorizontalDivider(color = FormColors.Divider.copy(alpha = 0.35f))

        Text("Set activity type by name (substring → playgroundType)", fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
        OutlinedTextField(
            value = nameContains,
            onValueChange = { nameContains = it },
            label = { Text("Name contains (substring)") },
            supportingText = {
                Text(
                    "Case-insensitive match anywhere in the place name. Searches all regions; does not use regionKey.",
                    fontSize = 12.sp,
                    color = Color(0xFF757575),
                )
            },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )
        PlaygroundTypeLabelPicker(
            label = "Activity / Location type (playgroundType)",
            placeholderText = "Choose type (e.g. Mini Golf)",
            typeLabels = knownTypeLabels,
            pick = activityTypePick,
            onPick = { activityTypePick = it },
            manualValue = activityTypeManual,
            onManualChange = { activityTypeManual = it },
        )
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = tagDryRun, onCheckedChange = { tagDryRun = it })
            Text("Dry run (preview matches only)", fontSize = 14.sp)
        }
        tagError?.let { Text(it, color = FormColors.ErrorText, fontSize = 13.sp) }
        tagResult?.let { Text(it, fontSize = 13.sp, color = Color(0xFF2E7D32)) }
        Button(
            onClick = {
                val typeLabel = effectivePlaygroundTypeLabel(activityTypePick, activityTypeManual)
                if (nameContains.isBlank() || typeLabel.isBlank()) {
                    tagError = "Enter name substring and choose or type an activity (playgroundType)."
                    return@Button
                }
                scope.launch {
                    tagLoading = true
                    tagError = null
                    tagResult = null
                    try {
                        val resp = service.adminBulkSetPlaygroundTypeByName(
                            nameContains = nameContains.trim(),
                            playgroundType = typeLabel,
                            dryRun = tagDryRun,
                        )
                        val err = resp["error"]?.toString()
                        if (err != null) tagError = err
                        else {
                            @Suppress("UNCHECKED_CAST")
                            val data = resp["data"] as? Map<String, Any?>
                            tagResult = if (data != null) {
                                val dry = data["dryRun"] == true
                                val matched = data["matchedCount"]?.toString() ?: "?"
                                val modified = data["modifiedCount"]?.toString() ?: "—"
                                val pt = data["playgroundType"]?.toString().orEmpty()
                                buildString {
                                    append(if (dry) "Type update dry run: " else "Type update applied: ")
                                    append("matched=$matched")
                                    if (pt.isNotEmpty()) append(" → playgroundType=\"$pt\"")
                                    if (!dry) append(", modified=$modified")
                                }
                            } else resp.toString()
                        }
                    } catch (e: Exception) {
                        tagError = e.message ?: "Request failed"
                    } finally {
                        tagLoading = false
                    }
                }
            },
            enabled = !tagLoading,
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(containerColor = FormColors.PrimaryButton),
        ) {
            Text(if (tagDryRun) "Preview type update" else "Apply type update")
        }
        if (tagLoading) LinearProgressIndicator(Modifier.fillMaxWidth())
    }
}
