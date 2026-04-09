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
import androidx.compose.material3.ExperimentalMaterial3Api
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
import org.community.playgroundfinder.ui.composables.FormColors

private val recategorizeScopes = listOf(
    "seeded",
    "missing",
    "stale_on_seed",
    "recheck_seed",
    "all",
)

private sealed class RegionPick {
    data object None : RegionPick()
    data object All : RegionPick()
    data class One(val region: SeededRegion) : RegionPick()
}

private fun RegionPick.displayLabel(): String = when (this) {
    RegionPick.None -> ""
    RegionPick.All -> "All regions"
    is RegionPick.One -> {
        val r = region
        val citySt = listOf(r.displayCity.ifBlank { r.city }, r.state).filter { it.isNotBlank() }.joinToString(", ")
        if (citySt.isNotBlank()) "$citySt (${r.regionKey})" else r.regionKey
    }
}

@Suppress("UNCHECKED_CAST")
private fun summarizeMergePreview(root: Map<String, Any?>): String {
    val data = root["data"] as? Map<String, Any?> ?: return root.toString()
    val clusters = data["clusters"] as? List<*>
    val dedupN = clusters?.size ?: 0
    val campus = data["campusClusterCount"]?.toString() ?: "?"
    val address = data["addressClusterCount"]?.toString() ?: "?"
    return "Dedup clusters (preview): $dedupN | campus clusters: $campus | address clusters: $address"
}

@Suppress("UNCHECKED_CAST")
private fun summarizeMergeApply(root: Map<String, Any?>): String {
    val data = root["data"] as? Map<String, Any?> ?: return root.toString()
    val dedup = data["dedup"] as? Map<String, Any?>
    val sub = data["subVenueGrouping"] as? Map<String, Any?>
    val merged = dedup?.get("merged")?.toString() ?: "?"
    val archived = dedup?.get("archived")?.toString() ?: "?"
    val grouped = sub?.get("grouped")?.toString() ?: "?"
    return "Dedup: merged=$merged, archived=$archived | Sub-venue grouped=$grouped"
}

@Suppress("UNCHECKED_CAST")
private fun summarizeCrossRegionPreview(root: Map<String, Any?>): String {
    val data = root["data"] as? Map<String, Any?> ?: return root.toString()
    val n = data["clusterCount"]?.toString() ?: "?"
    val clusters = data["clusters"] as? List<Map<String, Any?>>
    val sample = clusters?.take(5)?.joinToString("\n") { c ->
        val w = c["winner"]?.toString() ?: "?"
        val rk = c["regionKeys"]?.toString() ?: "?"
        "| $w - regions $rk"
    } ?: ""
    return buildString {
        append("Cross-region clusters (preview): $n")
        if (sample.isNotEmpty()) append("\n").append(sample)
        if ((clusters?.size ?: 0) > 5) append("\n...")
    }
}

@Suppress("UNCHECKED_CAST")
private fun summarizeCrossRegionApply(root: Map<String, Any?>): String {
    val data = root["data"] as? Map<String, Any?> ?: return root.toString()
    val merged = data["merged"]?.toString() ?: "?"
    val archived = data["archived"]?.toString() ?: "?"
    val cc = data["clusterCount"]?.toString() ?: "?"
    return "Cross-region: merged $merged parent row(s), archived $archived loser(s) (clusters processed: $cc)"
}

@Suppress("UNCHECKED_CAST")
private fun mapFromAny(m: Any?): Map<String, Any?>? = m as? Map<String, Any?>

@Suppress("UNCHECKED_CAST")
private fun listFromAny(m: Any?): List<Any?>? = m as? List<Any?>

@Suppress("UNCHECKED_CAST")
private fun summarizeRecategorize(root: Map<String, Any?>): String {
    val data = root["data"] as? Map<String, Any?> ?: return root.toString()
    val examined = data["examined"]?.toString() ?: "?"
    val wouldChange = data["wouldChange"]?.toString() ?: "?"
    val written = data["written"]?.toString() ?: "?"
    return "Examined=$examined | wouldChange=$wouldChange | written=$written"
}

/**
 * Region tools hub: navigation to switcher / bulk merge / seed review, plus server jobs
 * (proximity dedupe, sub-venue grouping, type re-inference, gallery trim).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AdminRegionMaintenanceScreen(
    service: PlaygroundService,
    onOpenRegionSwitcher: () -> Unit,
    onOpenMergeTools: () -> Unit,
    onOpenSeedReview: () -> Unit,
    onBack: () -> Unit,
) {
    val scope = rememberCoroutineScope()

    var regions by remember { mutableStateOf<List<SeededRegion>>(emptyList()) }
    var regionsLoading by remember { mutableStateOf(true) }
    var regionsLoadError by remember { mutableStateOf<String?>(null) }
    var regionFilter by remember { mutableStateOf("") }
    var regionPick by remember { mutableStateOf<RegionPick>(RegionPick.None) }
    var regionMenuExpanded by remember { mutableStateOf(false) }
    var manualRegionKey by remember { mutableStateOf("") }

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

    fun regionKeysForAllMerge(): List<String> =
        regions.map { it.regionKey }.filter { it.isNotBlank() }.distinct()

    var distanceMetersText by remember { mutableStateOf("100") }

    var mergeLoading by remember { mutableStateOf(false) }
    var mergeResult by remember { mutableStateOf<String?>(null) }
    var mergeError by remember { mutableStateOf<String?>(null) }
    var mergeProgress by remember { mutableStateOf<String?>(null) }
    var showMergeApplyConfirm by remember { mutableStateOf(false) }

    var crossRegionMaxMetersText by remember { mutableStateOf("150") }
    var crossRegionRequireDistinct by remember { mutableStateOf(true) }
    var crossMergeLoading by remember { mutableStateOf(false) }
    var crossMergeResult by remember { mutableStateOf<String?>(null) }
    var crossMergeError by remember { mutableStateOf<String?>(null) }
    var showCrossRegionApplyConfirm by remember { mutableStateOf(false) }

    var recatScopeIndex by remember { mutableStateOf(0) }
    var recatDryRun by remember { mutableStateOf(true) }
    var recatLimitText by remember { mutableStateOf("") }
    var recatLoading by remember { mutableStateOf(false) }
    var recatResult by remember { mutableStateOf<String?>(null) }
    var recatError by remember { mutableStateOf<String?>(null) }

    var trimMaxPhotosText by remember { mutableStateOf("25") }
    var trimDryRun by remember { mutableStateOf(true) }
    var trimLoading by remember { mutableStateOf(false) }
    var trimResult by remember { mutableStateOf<String?>(null) }
    var trimError by remember { mutableStateOf<String?>(null) }

    var mergeAuditPlaygroundId by remember { mutableStateOf("") }
    var mergeAuditLoading by remember { mutableStateOf(false) }
    var mergeAuditError by remember { mutableStateOf<String?>(null) }
    var mergeAuditData by remember { mutableStateOf<Map<String, Any?>?>(null) }
    var unlinkConfirmChildId by remember { mutableStateOf<String?>(null) }
    var unlinkLoading by remember { mutableStateOf(false) }
    var unlinkError by remember { mutableStateOf<String?>(null) }
    var showAdvancedMaintenance by remember { mutableStateOf(false) }

    fun parseDistance(): Int? {
        val t = distanceMetersText.trim()
        if (t.isEmpty()) return null
        val n = t.toIntOrNull() ?: return null
        return if (n > 0) n else null
    }

    fun parseTrimMax(): Int {
        return trimMaxPhotosText.trim().toIntOrNull()?.takeIf { it > 0 } ?: 25
    }

    fun parseCrossRegionMax(): Int? {
        val t = crossRegionMaxMetersText.trim()
        if (t.isEmpty()) return null
        val n = t.toIntOrNull() ?: return null
        return if (n >= 0) n else null
    }

    fun parseRecatLimit(): Int? {
        val t = recatLimitText.trim()
        if (t.isEmpty()) return null
        return t.toIntOrNull()?.takeIf { it > 0 }
    }

    fun requireRegionSelectionForMerge(): Boolean {
        if (manualRegionKey.trim().isNotEmpty()) return true
        return regionPick is RegionPick.One || regionPick is RegionPick.All
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            "Region & location tools",
            fontWeight = FontWeight.Bold,
            fontSize = 18.sp,
            color = FormColors.PrimaryButton,
        )
        Text(
            "Re-seed and expand only upsert by Google place_id, so the same place should not duplicate. " +
                "Different place_ids for one real venue, or user-submitted rows, can still duplicate - run proximity dedupe below after seeding.",
            fontSize = 12.sp,
            color = Color(0xFF616161),
        )
        Text("Routine operations", fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
        Text(
            "Keep the regular city work close at hand. The bigger repair tools are folded lower down.",
            fontSize = 12.sp,
            color = Color(0xFF757575),
        )
        Button(
            onClick = onOpenRegionSwitcher,
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(
                containerColor = FormColors.PrimaryButton,
                contentColor = FormColors.PrimaryButtonText,
            ),
        ) {
            Text("Open region list & ad phases")
        }
        OutlinedButton(onClick = onOpenMergeTools, modifier = Modifier.fillMaxWidth()) {
            Text("Merge regions & set activity by name")
        }
        OutlinedButton(onClick = onOpenSeedReview, modifier = Modifier.fillMaxWidth()) {
            Text("Seed photo review")
        }

        HorizontalDivider(color = FormColors.Divider.copy(alpha = 0.35f))

        Text("Standard cleanup", fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
        if (regionsLoading) {
            LinearProgressIndicator(Modifier.fillMaxWidth())
            Text("Loading regions...", fontSize = 12.sp, color = Color.Gray)
        }
        regionsLoadError?.let {
            Text(it, color = FormColors.ErrorText, fontSize = 13.sp)
        }

        OutlinedTextField(
            value = regionFilter,
            onValueChange = { regionFilter = it },
            label = { Text("Filter regions (optional)") },
            supportingText = { Text("Narrows the list below by city, state, or key.", fontSize = 11.sp) },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            enabled = !regionsLoading,
        )

        ExposedDropdownMenuBox(
            expanded = regionMenuExpanded,
            onExpandedChange = { regionMenuExpanded = it },
            modifier = Modifier.fillMaxWidth(),
        ) {
            OutlinedTextField(
                value = when {
                    manualRegionKey.trim().isNotEmpty() -> manualRegionKey.trim()
                    else -> regionPick.displayLabel()
                },
                onValueChange = {},
                readOnly = true,
                label = { Text("Region") },
                placeholder = { Text("Choose one or All regions") },
                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = regionMenuExpanded) },
                modifier = Modifier.fillMaxWidth().menuAnchor(),
                enabled = !regionsLoading,
            )
            ExposedDropdownMenu(
                expanded = regionMenuExpanded,
                onDismissRequest = { regionMenuExpanded = false },
                modifier = Modifier.heightIn(max = 360.dp),
            ) {
                DropdownMenuItem(
                    text = { Text("All regions (${regions.size} seeded)") },
                    onClick = {
                        regionPick = RegionPick.All
                        manualRegionKey = ""
                        regionMenuExpanded = false
                    },
                )
                HorizontalDivider()
                filteredRegions.forEach { r ->
                    DropdownMenuItem(
                        text = {
                            Text(
                                RegionPick.One(r).displayLabel(),
                                fontSize = 14.sp,
                            )
                        },
                        onClick = {
                            regionPick = RegionPick.One(r)
                            manualRegionKey = ""
                            regionMenuExpanded = false
                        },
                    )
                }
            }
        }

        OutlinedTextField(
            value = manualRegionKey,
            onValueChange = {
                manualRegionKey = it
                if (it.isNotBlank()) regionPick = RegionPick.None
            },
            label = { Text("Or type regionKey manually") },
            supportingText = {
                Text("Overrides the menu when non-empty (e.g. a key not in the list).", fontSize = 11.sp)
            },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )

        OutlinedTextField(
            value = distanceMetersText,
            onValueChange = { distanceMetersText = it },
            label = { Text("Dedupe distance (meters)") },
            supportingText = {
                Text("Optional. Default on server is 100. Blank uses server default.", fontSize = 11.sp)
            },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )

        Text("Proximity dedupe & sub-venues", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
        Text(
            "Preview runs no writes. Apply merges near-duplicate venues and runs sub-venue grouping (writes). " +
                "All regions runs the same job once per seeded region (can take several minutes).",
            fontSize = 12.sp,
            color = Color(0xFF757575),
        )
        mergeError?.let { Text(it, color = FormColors.ErrorText, fontSize = 13.sp) }
        mergeProgress?.let { Text(it, fontSize = 12.sp, color = Color(0xFF616161)) }
        mergeResult?.let { Text(it, fontSize = 12.sp, color = Color(0xFF2E7D32)) }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            OutlinedButton(
                onClick = {
                    if (!requireRegionSelectionForMerge()) {
                        mergeError = "Select a region, All regions, or enter a manual key."
                        return@OutlinedButton
                    }
                    scope.launch {
                        mergeLoading = true
                        mergeError = null
                        mergeResult = null
                        mergeProgress = null
                        try {
                            val dist = parseDistance()
                            val manual = manualRegionKey.trim()
                            when {
                                manual.isNotEmpty() -> {
                                    val resp = service.adminMergePreview(manual, dist)
                                    val err = resp["error"]?.toString()
                                    if (err != null) mergeError = err
                                    else mergeResult = summarizeMergePreview(resp)
                                }
                                regionPick is RegionPick.All -> {
                                    val keys = regionKeysForAllMerge()
                                    if (keys.isEmpty()) {
                                        mergeError = "No seeded regions loaded. Pull to refresh or use manual key."
                                        return@launch
                                    }
                                    val lines = mutableListOf<String>()
                                    keys.forEachIndexed { i, key ->
                                        mergeProgress = "Preview ${i + 1}/${keys.size}: $key"
                                        val resp = service.adminMergePreview(key, dist)
                                        val err = resp["error"]?.toString()
                                        if (err != null) lines.add("$key: ERROR $err")
                                        else lines.add("$key: ${summarizeMergePreview(resp)}")
                                    }
                                    mergeProgress = null
                                    mergeResult = lines.joinToString("\n")
                                }
                                regionPick is RegionPick.One -> {
                                    val key = (regionPick as RegionPick.One).region.regionKey
                                    val resp = service.adminMergePreview(key, dist)
                                    val err = resp["error"]?.toString()
                                    if (err != null) mergeError = err
                                    else mergeResult = summarizeMergePreview(resp)
                                }
                                else -> mergeError = "Select a region or enter a manual key."
                            }
                        } catch (e: Exception) {
                            mergeError = e.message ?: "Request failed"
                        } finally {
                            mergeLoading = false
                            mergeProgress = null
                        }
                    }
                },
                enabled = !mergeLoading,
                modifier = Modifier.weight(1f),
            ) {
                Text("Preview")
            }
            Button(
                onClick = {
                    if (!requireRegionSelectionForMerge()) {
                        mergeError = "Select a region, All regions, or enter a manual key."
                        return@Button
                    }
                    showMergeApplyConfirm = true
                },
                enabled = !mergeLoading,
                modifier = Modifier.weight(1f),
                colors = ButtonDefaults.buttonColors(containerColor = FormColors.PrimaryButton),
            ) {
                Text("Apply merge")
            }
        }
        if (mergeLoading) LinearProgressIndicator(Modifier.fillMaxWidth())

        HorizontalDivider(color = FormColors.Divider.copy(alpha = 0.35f))

        Card(
            colors = CardDefaults.cardColors(containerColor = FormColors.CardBackground),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(
                modifier = Modifier.padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text("Advanced maintenance", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                Text(
                    "Cross-region repair, merge forensics, type backfills, and gallery cleanup are still here when you need them.",
                    fontSize = 12.sp,
                    color = Color.Gray,
                )
                OutlinedButton(
                    onClick = { showAdvancedMaintenance = !showAdvancedMaintenance },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(if (showAdvancedMaintenance) "Hide advanced tools" else "Show advanced tools")
                }
            }
        }

        if (showAdvancedMaintenance) {

        HorizontalDivider(color = FormColors.Divider.copy(alpha = 0.35f))

        Text("Cross-region address merge", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
        Text(
            "Same physical place can appear twice if it was seeded or added under two region keys (e.g. a border). " +
                "This pass buckets by normalized address (≥3 tokens), then merges sets within max distance when " +
                "they span multiple regions (optional). The surviving row keeps its regionKey.",
            fontSize = 12.sp,
            color = Color(0xFF757575),
        )
        OutlinedTextField(
            value = crossRegionMaxMetersText,
            onValueChange = { crossRegionMaxMetersText = it },
            label = { Text("Max distance (meters)") },
            supportingText = {
                Text("Server default is 150 if blank. Use 0 only if coordinates must coincide.", fontSize = 11.sp)
            },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Checkbox(
                checked = crossRegionRequireDistinct,
                onCheckedChange = { crossRegionRequireDistinct = it },
            )
            Text(
                "Require 2+ distinct region keys (recommended)",
                fontSize = 13.sp,
                modifier = Modifier.weight(1f),
            )
        }
        crossMergeError?.let { Text(it, color = FormColors.ErrorText, fontSize = 13.sp) }
        crossMergeResult?.let { Text(it, fontSize = 12.sp, color = Color(0xFF2E7D32)) }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            OutlinedButton(
                onClick = {
                    scope.launch {
                        crossMergeLoading = true
                        crossMergeError = null
                        crossMergeResult = null
                        try {
                            val maxM = parseCrossRegionMax()
                            val resp = service.adminMergeCrossRegionPreview(
                                maxDistanceMeters = maxM,
                                requireDistinctRegions = crossRegionRequireDistinct,
                            )
                            val err = resp["error"]?.toString()
                            if (err != null) crossMergeError = err
                            else crossMergeResult = summarizeCrossRegionPreview(resp)
                        } catch (e: Exception) {
                            crossMergeError = e.message ?: "Request failed"
                        } finally {
                            crossMergeLoading = false
                        }
                    }
                },
                enabled = !crossMergeLoading && !mergeLoading,
                modifier = Modifier.weight(1f),
            ) { Text("Preview") }
            Button(
                onClick = { showCrossRegionApplyConfirm = true },
                enabled = !crossMergeLoading && !mergeLoading,
                modifier = Modifier.weight(1f),
                colors = ButtonDefaults.buttonColors(containerColor = FormColors.PrimaryButton),
            ) { Text("Apply") }
        }
        if (crossMergeLoading) LinearProgressIndicator(Modifier.fillMaxWidth())

        HorizontalDivider(color = FormColors.Divider.copy(alpha = 0.35f))

        Text("Merge audit & unlink", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
        Text(
            "Enter the surviving playground Mongo id (the merged parent). The server explains mergeType " +
                "(subvenue_group = shared normalized address / 50m rule; subvenue_campus = zoo/museum-style cluster; " +
                "proximity_dedup = name prefix + distance; cross_region_address = same address across regions). " +
                "Archived rows show the address lines used for comparison. " +
                "Unlink restores a child from the archive as its own place again (parent merged fields are not auto-reverted).",
            fontSize = 12.sp,
            color = Color(0xFF757575),
        )
        OutlinedTextField(
            value = mergeAuditPlaygroundId,
            onValueChange = { mergeAuditPlaygroundId = it },
            label = { Text("Playground id (parent)") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            enabled = !mergeAuditLoading,
        )
        mergeAuditError?.let { Text(it, color = FormColors.ErrorText, fontSize = 13.sp) }
        unlinkError?.let { Text(it, color = FormColors.ErrorText, fontSize = 13.sp) }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Button(
                onClick = {
                    val pid = mergeAuditPlaygroundId.trim()
                    if (pid.isEmpty()) {
                        mergeAuditError = "Enter a playground id."
                        return@Button
                    }
                    scope.launch {
                        mergeAuditLoading = true
                        mergeAuditError = null
                        unlinkError = null
                        try {
                            val resp = service.adminMergeAudit(pid)
                            val err = resp["error"]?.toString()
                            if (err != null) {
                                mergeAuditError = err
                                mergeAuditData = null
                            } else {
                                mergeAuditData = resp
                            }
                        } catch (e: Exception) {
                            mergeAuditError = e.message ?: "Request failed"
                            mergeAuditData = null
                        } finally {
                            mergeAuditLoading = false
                        }
                    }
                },
                enabled = !mergeAuditLoading,
                modifier = Modifier.weight(1f),
                colors = ButtonDefaults.buttonColors(containerColor = FormColors.PrimaryButton),
            ) {
                Text("Load merge audit")
            }
            OutlinedButton(
                onClick = {
                    mergeAuditData = null
                    mergeAuditError = null
                    unlinkError = null
                },
                enabled = !mergeAuditLoading,
            ) {
                Text("Clear")
            }
        }
        if (mergeAuditLoading) LinearProgressIndicator(Modifier.fillMaxWidth())

        mergeAuditData?.let { data ->
            val parent = mapFromAny(data["parent"])
            val how = mapFromAny(data["howMergeWorked"])
            val normStored = data["normalizedAddressKeyStoredOnRecord"]?.toString()
            val heuristic = data["addressHeuristicNote"]?.toString()
            val sameNorm = listFromAny(data["archivedChildIdsSharingParentNormalizedAddress"])
            Card(
                colors = CardDefaults.cardColors(containerColor = FormColors.CardBackground),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(
                    modifier = Modifier.padding(12.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    parent?.let { p ->
                        Text("Parent: ${p["name"]}", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                        Text("Id: ${p["id"]}", fontSize = 12.sp, color = Color.Gray)
                        Text(
                            "Address: ${listOfNotNull(p["address"], p["city"], p["state"]).joinToString(", ").ifBlank { "-" }}",
                            fontSize = 12.sp,
                        )
                        Text(
                            "Normalized (computed): ${p["normalizedAddress"]?.toString()?.takeIf { it.isNotBlank() } ?: "-"}",
                            fontSize = 11.sp,
                            color = Color(0xFF616161),
                        )
                    }
                    how?.let { h ->
                        Text(h["summary"]?.toString() ?: "", fontWeight = FontWeight.Medium, fontSize = 13.sp, color = FormColors.PrimaryButton)
                        Text(h["detail"]?.toString() ?: "", fontSize = 12.sp, color = Color(0xFF424242))
                    }
                    if (!normStored.isNullOrBlank()) {
                        Text("Stored normalizedAddressKey (newer merges): $normStored", fontSize = 11.sp, color = Color(0xFF2E7D32))
                    }
                    if (!sameNorm.isNullOrEmpty()) {
                        Text(
                            "Archived children whose normalized address matches parent: ${sameNorm.joinToString()}",
                            fontSize = 11.sp,
                            color = Color(0xFF1565C0),
                        )
                    }
                    heuristic?.let {
                        Text(it, fontSize = 11.sp, color = Color.Gray)
                    }
                    Text("Archived merged-from rows", fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                    listFromAny(data["mergedFromArchivedRows"])?.forEach { row ->
                        val m = mapFromAny(row) ?: return@forEach
                        val note = m["note"]?.toString()
                        Card(
                            colors = CardDefaults.cardColors(containerColor = Color.White),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                Text("Id: ${m["id"]}", fontSize = 12.sp, fontWeight = FontWeight.Medium)
                                if (note != null) {
                                    Text(note, fontSize = 12.sp, color = Color(0xFFB71C1C))
                                } else {
                                    Text(m["name"]?.toString() ?: "-", fontSize = 13.sp)
                                    Text(
                                        listOfNotNull(m["address"], m["city"], m["state"]).joinToString(", ").ifBlank { "No address" },
                                        fontSize = 12.sp,
                                    )
                                    Text(
                                        "Normalized: ${m["normalizedAddress"]?.toString()?.takeIf { it.isNotBlank() } ?: "-"}",
                                        fontSize = 11.sp,
                                        color = Color.Gray,
                                    )
                                    Text("Archive reason: ${m["archiveReason"]}", fontSize = 11.sp, color = Color.Gray)
                                    val parentIdForUnlink = parent?.get("id")?.toString()
                                    val childId = m["id"]?.toString()
                                    if (parentIdForUnlink != null && childId != null) {
                                        OutlinedButton(
                                            onClick = { unlinkConfirmChildId = childId },
                                            enabled = !unlinkLoading,
                                        ) {
                                            Text("Unlink / restore this row")
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        HorizontalDivider(color = FormColors.Divider.copy(alpha = 0.35f))

        Text("Re-infer playground types", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text("Scope:", fontSize = 13.sp)
            OutlinedButton(
                onClick = {
                    recatScopeIndex = (recatScopeIndex + 1) % recategorizeScopes.size
                },
            ) {
                Text(recategorizeScopes[recatScopeIndex], fontSize = 12.sp)
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = recatDryRun, onCheckedChange = { recatDryRun = it })
            Text("Dry run", fontSize = 14.sp)
        }
        OutlinedTextField(
            value = recatLimitText,
            onValueChange = { recatLimitText = it },
            label = { Text("Limit (optional, max 5000)") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )
        recatError?.let { Text(it, color = FormColors.ErrorText, fontSize = 13.sp) }
        recatResult?.let { Text(it, fontSize = 12.sp, color = Color(0xFF2E7D32)) }
        Button(
            onClick = {
                scope.launch {
                    recatLoading = true
                    recatError = null
                    recatResult = null
                    try {
                        val rk = when {
                            manualRegionKey.trim().isNotEmpty() -> manualRegionKey.trim()
                            regionPick is RegionPick.All -> null
                            regionPick is RegionPick.One -> (regionPick as RegionPick.One).region.regionKey
                            else -> {
                                recatError = "Select All regions, one region from the menu, or a manual key."
                                recatLoading = false
                                return@launch
                            }
                        }
                        val resp = service.adminRecategorizeTypes(
                            regionKey = rk,
                            scope = recategorizeScopes[recatScopeIndex],
                            dryRun = recatDryRun,
                            limit = parseRecatLimit(),
                        )
                        val err = resp["error"]?.toString()
                        if (err != null) recatError = err
                        else recatResult = summarizeRecategorize(resp)
                    } catch (e: Exception) {
                        recatError = e.message ?: "Request failed"
                    } finally {
                        recatLoading = false
                    }
                }
            },
            enabled = !recatLoading,
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(containerColor = FormColors.PrimaryButton),
        ) {
            Text("Run type re-inference")
        }
        if (recatLoading) LinearProgressIndicator(Modifier.fillMaxWidth())

        HorizontalDivider(color = FormColors.Divider.copy(alpha = 0.35f))

        Text("Trim photo galleries", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
        Text(
            "Uses the same Region choice: All regions trims every region; one region limits to that key; manual key overrides.",
            fontSize = 12.sp,
            color = Color(0xFF757575),
        )
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = trimDryRun, onCheckedChange = { trimDryRun = it })
            Text("Dry run", fontSize = 14.sp)
        }
        OutlinedTextField(
            value = trimMaxPhotosText,
            onValueChange = { trimMaxPhotosText = it },
            label = { Text("Max photos per place") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )
        trimError?.let { Text(it, color = FormColors.ErrorText, fontSize = 13.sp) }
        trimResult?.let { Text(it, fontSize = 12.sp, color = Color(0xFF2E7D32)) }
        Button(
            onClick = {
                val rkTrim = when {
                    manualRegionKey.trim().isNotEmpty() -> manualRegionKey.trim()
                    regionPick is RegionPick.All -> null
                    regionPick is RegionPick.One -> (regionPick as RegionPick.One).region.regionKey
                    else -> {
                        trimError = "Select All regions, one region, or a manual key."
                        return@Button
                    }
                }
                scope.launch {
                    trimLoading = true
                    trimError = null
                    trimResult = null
                    try {
                        val resp = service.adminTrimGalleries(
                            regionKey = rkTrim,
                            maxPhotos = parseTrimMax(),
                            dryRun = trimDryRun,
                        )
                        val err = resp["error"]?.toString()
                        if (err != null) trimError = err
                        else {
                            @Suppress("UNCHECKED_CAST")
                            val data = resp["data"] as? Map<String, Any?>
                            trimResult = data?.get("note")?.toString()
                                ?: resp["message"]?.toString()
                                ?: resp.toString()
                        }
                    } catch (e: Exception) {
                        trimError = e.message ?: "Request failed"
                    } finally {
                        trimLoading = false
                    }
                }
            },
            enabled = !trimLoading,
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(containerColor = FormColors.PrimaryButton),
        ) {
            Text("Start gallery trim")
        }
        if (trimLoading) LinearProgressIndicator(Modifier.fillMaxWidth())

        Card(
            colors = CardDefaults.cardColors(containerColor = FormColors.CardBackground),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(
                modifier = Modifier.padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text("Notes", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                Text(
                    "Gallery trim returns immediately; completion is logged on the server. " +
                        "Type re-inference can take a while on large regions - keep the screen open until it finishes.",
                    fontSize = 12.sp,
                    color = Color.Gray,
                )
            }
        }
        }

        OutlinedButton(onClick = onBack, modifier = Modifier.fillMaxWidth()) {
            Text("Back")
        }
    }

    if (showMergeApplyConfirm) {
        val manual = manualRegionKey.trim()
        val targetDescription = when {
            manual.isNotEmpty() -> manual
            regionPick is RegionPick.All -> "ALL ${regionKeysForAllMerge().size} seeded regions"
            regionPick is RegionPick.One -> (regionPick as RegionPick.One).region.regionKey
            else -> ""
        }
        AlertDialog(
            onDismissRequest = { showMergeApplyConfirm = false },
            title = { Text("Apply proximity merge?") },
            text = {
                Text(
                    "This merges duplicate venues and updates sub-venue links for: $targetDescription. " +
                        "Archived rows are copied to archived_playgrounds.",
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        showMergeApplyConfirm = false
                        val dist = parseDistance()
                        scope.launch {
                            mergeLoading = true
                            mergeError = null
                            mergeResult = null
                            mergeProgress = null
                            try {
                                when {
                                    manual.isNotEmpty() -> {
                                        val resp = service.adminMergeRegion(manual, dryRun = false, distanceMeters = dist)
                                        val err = resp["error"]?.toString()
                                        if (err != null) mergeError = err
                                        else mergeResult = summarizeMergeApply(resp)
                                    }
                                    regionPick is RegionPick.All -> {
                                        val keys = regionKeysForAllMerge()
                                        if (keys.isEmpty()) {
                                            mergeError = "No seeded regions loaded."
                                            return@launch
                                        }
                                        val lines = mutableListOf<String>()
                                        keys.forEachIndexed { i, key ->
                                            mergeProgress = "Merge ${i + 1}/${keys.size}: $key"
                                            val resp = service.adminMergeRegion(key, dryRun = false, distanceMeters = dist)
                                            val err = resp["error"]?.toString()
                                            if (err != null) lines.add("$key: ERROR $err")
                                            else lines.add("$key: ${summarizeMergeApply(resp)}")
                                        }
                                        mergeProgress = null
                                        mergeResult = lines.joinToString("\n")
                                    }
                                    regionPick is RegionPick.One -> {
                                        val key = (regionPick as RegionPick.One).region.regionKey
                                        val resp = service.adminMergeRegion(key, dryRun = false, distanceMeters = dist)
                                        val err = resp["error"]?.toString()
                                        if (err != null) mergeError = err
                                        else mergeResult = summarizeMergeApply(resp)
                                    }
                                    else -> mergeError = "No region selected."
                                }
                            } catch (e: Exception) {
                                mergeError = e.message ?: "Request failed"
                            } finally {
                                mergeLoading = false
                                mergeProgress = null
                            }
                        }
                    },
                ) { Text("Apply") }
            },
            dismissButton = {
                TextButton(onClick = { showMergeApplyConfirm = false }) { Text("Cancel") }
            },
        )
    }

    if (showCrossRegionApplyConfirm) {
        AlertDialog(
            onDismissRequest = { showCrossRegionApplyConfirm = false },
            title = { Text("Apply cross-region address merge?") },
            text = {
                Text(
                    "This runs globally (all non-archived playgrounds): same normalized address, within max distance. " +
                        "Losers are archived into archived_playgrounds. Preview first if unsure.",
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        showCrossRegionApplyConfirm = false
                        scope.launch {
                            crossMergeLoading = true
                            crossMergeError = null
                            crossMergeResult = null
                            try {
                                val maxM = parseCrossRegionMax()
                                val resp = service.adminMergeCrossRegionAddresses(
                                    dryRun = false,
                                    maxDistanceMeters = maxM,
                                    requireDistinctRegions = crossRegionRequireDistinct,
                                )
                                val err = resp["error"]?.toString()
                                if (err != null) crossMergeError = err
                                else crossMergeResult = summarizeCrossRegionApply(resp)
                            } catch (e: Exception) {
                                crossMergeError = e.message ?: "Request failed"
                            } finally {
                                crossMergeLoading = false
                            }
                        }
                    },
                ) { Text("Apply") }
            },
            dismissButton = {
                TextButton(onClick = { showCrossRegionApplyConfirm = false }) { Text("Cancel") }
            },
        )
    }

    unlinkConfirmChildId?.let { childId ->
        val parentId = mergeAuditData?.let { mapFromAny(it["parent"])?.get("id")?.toString() }
        if (parentId != null) {
            AlertDialog(
                onDismissRequest = { if (!unlinkLoading) unlinkConfirmChildId = null },
                title = { Text("Restore archived venue?") },
                text = {
                    Text(
                        "This moves $childId from archived_playgrounds back to playgrounds and removes it from the parent’s subVenues / merge list. " +
                            "Edit the parent separately if merged photos or fields should be trimmed.",
                        fontSize = 14.sp,
                    )
                },
                confirmButton = {
                    TextButton(
                        onClick = {
                            scope.launch {
                                unlinkLoading = true
                                unlinkError = null
                                try {
                                    val r = service.adminUnlinkSubvenue(parentId, childId)
                                    val err = r["error"]?.toString()
                                    if (err != null) {
                                        unlinkError = err
                                    } else {
                                        unlinkConfirmChildId = null
                                        val pid = mergeAuditPlaygroundId.trim()
                                        if (pid.isNotEmpty()) {
                                            val resp = service.adminMergeAudit(pid)
                                            val re = resp["error"]?.toString()
                                            if (re != null) {
                                                mergeAuditError = re
                                                mergeAuditData = null
                                            } else {
                                                mergeAuditData = resp
                                            }
                                        }
                                    }
                                } catch (e: Exception) {
                                    unlinkError = e.message ?: "Unlink failed"
                                } finally {
                                    unlinkLoading = false
                                }
                            }
                        },
                        enabled = !unlinkLoading,
                    ) { Text("Restore") }
                },
                dismissButton = {
                    TextButton(
                        onClick = { unlinkConfirmChildId = null },
                        enabled = !unlinkLoading,
                    ) { Text("Cancel") }
                },
            )
        }
    }
}

