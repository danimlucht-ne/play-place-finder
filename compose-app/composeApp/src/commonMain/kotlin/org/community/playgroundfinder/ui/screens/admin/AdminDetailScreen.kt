package org.community.playgroundfinder.ui.screens.admin

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.ClickableText
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.platform.LocalUriHandler
import coil3.compose.AsyncImage
import kotlinx.coroutines.launch
import org.community.playgroundfinder.data.Playground
import org.community.playgroundfinder.data.PlaygroundService
import org.community.playgroundfinder.ui.composables.FormColors
import org.community.playgroundfinder.ui.composables.TextWithClickableMongoObjectIds
import org.community.playgroundfinder.util.mongoIdString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

private val mongoObjectIdInString = Regex("[a-fA-F0-9]{24}")

/** Parses `imageUrls` whether the API stored a list, a JSON string array, or comma-separated URLs. */
private fun parseModerationImageUrlList(value: Any?): List<String> {
    when (value) {
        is List<*> -> return value.mapNotNull { it?.toString()?.trim()?.takeIf { u -> u.startsWith("http") } }
        is String -> {
            val t = value.trim()
            if (t.startsWith("[")) {
                val parsed = runCatching {
                    val el = moderationJson.parseToJsonElement(t)
                    if (el is JsonArray) {
                        el.mapNotNull { elem ->
                            runCatching { elem.jsonPrimitive.content }.getOrNull()?.trim()
                                ?.takeIf { it.startsWith("http") }
                        }
                    } else {
                        emptyList()
                    }
                }.getOrNull()
                if (!parsed.isNullOrEmpty()) return parsed
                return t.removePrefix("[").removeSuffix("]")
                    .split("\",\"", ",")
                    .map { it.trim().trim('"', ' ', '\n', '\r') }
                    .filter { it.startsWith("http") }
            }
            return t.split(",").map { it.trim().trim('"') }.filter { it.startsWith("http") }
        }
        else -> return emptyList()
    }
}

private fun isAutomatedReviewFailureBlob(line: String): Boolean {
    val s = line.trim()
    if (s.contains("Automated text review unavailable", ignoreCase = true)) return true
    if (s.contains("Automated image review unavailable", ignoreCase = true)) return true
    if (s.contains("Automated text review failed", ignoreCase = true)) return true
    if (s.contains("Automated image review failed", ignoreCase = true)) return true
    if (s.contains("Submitted image could not be processed automatically", ignoreCase = true)) return true
    if (s.length < 50) return false
    if (s.contains("generativelanguage.googleapis.com", ignoreCase = true)) return true
    if (s.contains("SERVICE_DISABLED", ignoreCase = true)) return true
    if (s.contains("text_review_error", ignoreCase = true)) return true
    if (s.contains("image_review_error", ignoreCase = true)) return true
    if (s.contains("fetch_or_process_failed", ignoreCase = true)) return true
    if (s.contains("PERMISSION_DENIED", ignoreCase = true) && s.contains("Gemini", ignoreCase = true)) return true
    if (s.startsWith("{") && s.contains("\"error\"")) return true
    return false
}

/** Replaces raw Gemini/API JSON dumps with a short moderator-facing note. */
private fun distillReviewBulletsForDisplay(raw: List<String>): List<String> {
    var scrubbedAutomatedFailure = false
    val kept = mutableListOf<String>()
    for (line in raw) {
        val t = line.trim()
        if (t.isEmpty()) continue
        if (isAutomatedReviewFailureBlob(t) || (t.length > 400 && t.startsWith("{"))) {
            scrubbedAutomatedFailure = true
            continue
        }
        kept.add(t)
    }
    val out = kept.distinct().toMutableList()
    if (scrubbedAutomatedFailure) {
        out.add(
            0,
            "Automated review did not complete cleanly (Gemini / Generative Language API is disabled or misconfigured on the server). " +
                "Use the submitted photos and fields below for a manual decision.",
        )
    }
    return out
}

private val moderationJson = Json {
    encodeDefaults = true
    ignoreUnknownKeys = true
}

private fun proposedToJsonElement(v: Any?): JsonElement {
    return when (v) {
        null -> JsonNull
        is Boolean -> JsonPrimitive(v)
        is Number -> JsonPrimitive(v.toDouble())
        is String -> JsonPrimitive(v)
        is List<*> -> JsonArray(v.map { proposedToJsonElement(it) })
        else -> JsonPrimitive(v.toString())
    }
}

private fun jsonElementComparableString(el: JsonElement?): String {
    if (el == null || el is JsonNull) return ""
    if (el is JsonPrimitive) return el.content
    return el.toString()
}

/** When we have the live [Playground], hide proposed rows that match the published record (full-document submits). */
private fun editValueMatchesPlayground(key: String, proposed: Any?, pg: Playground): Boolean {
    val pgEl = try {
        moderationJson.encodeToJsonElement(Playground.serializer(), pg).jsonObject[key]
    } catch (_: Exception) {
        null
    }
    val propEl = proposedToJsonElement(proposed)
    return jsonElementComparableString(pgEl) == jsonElementComparableString(propEl)
}

/** City/state plus region key for admin queue context. */
private fun playgroundLocationSubtitle(pg: Playground): String {
    val cityState = listOfNotNull(
        pg.city?.trim()?.takeIf { it.isNotEmpty() },
        pg.state?.trim()?.takeIf { it.isNotEmpty() },
    ).joinToString(", ")
    val rk = pg.regionKey?.trim()?.takeIf { it.isNotEmpty() }
    return when {
        cityState.isNotEmpty() && rk != null -> "$cityState · $rk"
        cityState.isNotEmpty() -> cityState
        rk != null -> rk
        else -> ""
    }
}

private fun formatModerationSubmittedAt(raw: String): String? {
    val s = raw.trim().removeSuffix("Z").removeSuffix("z")
    if (s.isEmpty()) return null
    val date = s.take(10)
    val rest = s.substringAfter("T", "")
    val time = rest.substringBefore(".").substringBefore("+").ifBlank { rest.take(8) }
    return if (time.isNotEmpty()) "$date · $time UTC" else date
}

@Composable
private fun ModerationDetailRow(label: String, value: String) {
    val v = if (value.isBlank() || value.equals("null", ignoreCase = true)) "—" else value
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Text(
            label,
            modifier = Modifier.widthIn(min = 100.dp, max = 128.dp),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            v,
            modifier = Modifier.weight(1f).padding(start = 8.dp),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurface,
        )
    }
}

@Composable
fun AdminDetailScreen(
    service: PlaygroundService,
    queueId: String,
    onComplete: () -> Unit,
    /** When set, admin can open the live play place from this queue row (by id or ids embedded in notes). */
    onNavigateToPlayground: ((Playground) -> Unit)? = null,
) {
    val scope = rememberCoroutineScope()
    var item by remember { mutableStateOf<Map<String, Any>>(emptyMap()) }
    var isLoading by remember { mutableStateOf(true) }
    var rejectReason by remember { mutableStateOf("") }
    var showRejectDialog by remember { mutableStateOf(false) }
    var actionInProgress by remember { mutableStateOf(false) }
    var errorMsg by remember { mutableStateOf<String?>(null) }
    var successMsg by remember { mutableStateOf<String?>(null) }
    var showBlockDialog by remember { mutableStateOf(false) }
    var blockReasonInput by remember { mutableStateOf("") }
    var showForceReviewDialog by remember { mutableStateOf(false) }
    var forceReviewReasonInput by remember { mutableStateOf("") }
    var showDeleteDialog by remember { mutableStateOf(false) }
    var showRollbackDialog by remember { mutableStateOf(false) }
    var showAllProposedFields by remember { mutableStateOf(false) }
    var adminToolsMenuExpanded by remember { mutableStateOf(false) }
    var latestAudit by remember { mutableStateOf<Map<String, Any?>?>(null) }
    var auditLoading by remember { mutableStateOf(false) }
    var playgroundPreview by remember { mutableStateOf<Playground?>(null) }
    var playgroundPreviewLoading by remember { mutableStateOf(false) }

    val playgroundIdStr = remember(item) {
        item["playgroundId"]?.mongoIdString()
            ?: item["targetId"]?.toString()?.takeIf { it.isNotBlank() }
    }
    val submitterId = remember(item) { item["submittedByUserId"]?.mongoIdString() }
    val uriHandler = LocalUriHandler.current

    fun openPlaygroundById(id: String) {
        val cb = onNavigateToPlayground ?: return
        scope.launch {
            actionInProgress = true
            errorMsg = null
            try {
                cb(service.getPlaygroundById(id.trim()))
            } catch (e: Exception) {
                errorMsg = "Could not open play place: ${e.message}"
            } finally {
                actionInProgress = false
            }
        }
    }

    LaunchedEffect(queueId) {
        try { item = service.getModerationItem(queueId) } catch (_: Exception) {}
        isLoading = false
    }

    LaunchedEffect(playgroundIdStr, onNavigateToPlayground) {
        playgroundPreview = null
        if (playgroundIdStr == null || onNavigateToPlayground == null) {
            playgroundPreviewLoading = false
            return@LaunchedEffect
        }
        playgroundPreviewLoading = true
        try {
            playgroundPreview = service.getPlaygroundById(playgroundIdStr.trim())
        } catch (_: Exception) {
            playgroundPreview = null
        } finally {
            playgroundPreviewLoading = false
        }
    }
    LaunchedEffect(playgroundIdStr) {
        latestAudit = null
        val pid = playgroundIdStr ?: return@LaunchedEffect
        auditLoading = true
        try {
            latestAudit = service.adminGetPlaygroundChangeAudit(pid, 1).firstOrNull()
        } catch (_: Exception) {
            latestAudit = null
        } finally {
            auditLoading = false
        }
    }

    val submissionType = item["submissionType"]?.toString() ?: ""
    val isEdit = submissionType == "PLAYGROUND_EDIT"
    val isPhoto = submissionType == "PHOTO"
    val isNewPlayground = submissionType == "NEW_PLAYGROUND"
    val isDeleteRequest = submissionType == "DELETE_REQUEST"

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(FormColors.ScreenBackground),
    ) {
        if (isLoading) {
            CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
        } else {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(16.dp),
                    colors = CardDefaults.cardColors(containerColor = FormColors.CardBackground),
                    elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
                ) {
                    Column(
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text(
                            when {
                                isEdit -> "✏️ Edit submission"
                                isPhoto -> "📷 Photo submission"
                                isNewPlayground -> "🆕 New play place"
                                isDeleteRequest -> "🗑️ Removal request"
                                else -> "Review submission"
                            },
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                        Text(
                            item["playgroundName"]?.toString()?.trim()?.ifBlank { "Unknown play place" } ?: "Unknown play place",
                            style = MaterialTheme.typography.bodyLarge,
                            fontWeight = FontWeight.Medium,
                            color = FormColors.PrimaryButton,
                        )
                        item["createdAt"]?.toString()?.let { raw ->
                            formatModerationSubmittedAt(raw)?.let { line ->
                                Text(
                                    "Submitted · $line",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }

                val reviewBullets = remember(item) {
                    val out = mutableListOf<String>()
                    item["reason"]?.toString()?.trim()?.takeIf { it.isNotEmpty() && !it.equals("null", true) }?.let { out += it }
                    item["decisionReason"]?.toString()?.trim()?.takeIf { it.isNotEmpty() && !it.equals("null", true) }?.let { out += it }
                    @Suppress("UNCHECKED_CAST")
                    val review = item["geminiSubmissionReview"] as? Map<String, Any?>
                    @Suppress("UNCHECKED_CAST")
                    val text = review?.get("text") as? Map<String, Any?>
                    @Suppress("UNCHECKED_CAST")
                    val textConcerns = text?.get("concerns") as? List<Any?>
                    val concernLines = textConcerns.orEmpty().mapNotNull { it?.toString()?.trim()?.takeIf(String::isNotEmpty) }
                    concernLines.forEach { out += it }
                    @Suppress("UNCHECKED_CAST")
                    val images = review?.get("images") as? List<Map<String, Any?>>
                    images.orEmpty().forEach { img ->
                        @Suppress("UNCHECKED_CAST")
                        val concerns = img["concerns"] as? List<Any?>
                        concerns.orEmpty().mapNotNull { it?.toString()?.trim()?.takeIf(String::isNotEmpty) }.forEach { out += it }
                    }
                    if (concernLines.isEmpty()) {
                        text?.get("severity")?.toString()?.trim()?.takeIf { it.isNotEmpty() }?.let { sev ->
                            out += "Automated text review flagged this edit (severity: $sev)."
                        }
                    }
                    if (out.none { it.contains("manual", true) || it.contains("mandatory", true) } &&
                        review != null && review["autoApprove"] == false && concernLines.isEmpty() && text?.get("severity") == null
                    ) {
                        out += "Automated review did not auto-approve; manual check required."
                    }
                    out.distinct()
                }

                if (!isDeleteRequest) {
                    @Suppress("UNCHECKED_CAST")
                    val flagList = item["moderationFlags"] as? List<Map<String, Any?>>
                    val hasQueueStory = reviewBullets.isNotEmpty() ||
                        item["confidence"] != null ||
                        (!flagList.isNullOrEmpty())
                    if (hasQueueStory) {
                        Card(
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(16.dp),
                            colors = CardDefaults.cardColors(containerColor = Color.White),
                            border = BorderStroke(1.dp, FormColors.PrimaryButton.copy(alpha = 0.35f)),
                            elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
                        ) {
                            Column(
                                modifier = Modifier.padding(14.dp),
                                verticalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                Text(
                                    "Why this needs review",
                                    style = MaterialTheme.typography.titleSmall,
                                    fontWeight = FontWeight.SemiBold,
                                    color = FormColors.BodyText,
                                )
                                val displayReviewBullets = distillReviewBulletsForDisplay(reviewBullets)
                                if (displayReviewBullets.isEmpty()) {
                                    Text(
                                        "No automated explanation was attached. Decide from the changed fields below.",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        lineHeight = 18.sp,
                                    )
                                } else {
                                    displayReviewBullets.take(10).forEach { line ->
                                        Text(
                                            "• $line",
                                            style = MaterialTheme.typography.bodySmall,
                                            color = FormColors.BodyText,
                                            lineHeight = 18.sp,
                                        )
                                    }
                                }
                                item["confidence"]?.let { conf ->
                                    val confFloat = conf.toString().toFloatOrNull() ?: 0f
                                    val color = when {
                                        confFloat >= 0.8f -> Color(0xFF2E7D32)
                                        confFloat >= 0.5f -> Color(0xFFE65100)
                                        else -> Color(0xFFC62828)
                                    }
                                    Surface(
                                        shape = RoundedCornerShape(10.dp),
                                        color = color.copy(alpha = 0.12f),
                                        border = BorderStroke(1.dp, color.copy(alpha = 0.35f)),
                                    ) {
                                        Text(
                                            "Model confidence ${"%.0f".format(confFloat * 100)}% · ${item["recommendedAction"] ?: ""}",
                                            style = MaterialTheme.typography.labelMedium,
                                            color = color,
                                            fontWeight = FontWeight.SemiBold,
                                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                                        )
                                    }
                                }
                                if (!flagList.isNullOrEmpty()) {
                                    Text(
                                        "Flags",
                                        style = MaterialTheme.typography.labelLarge,
                                        fontWeight = FontWeight.SemiBold,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                    flagList.take(6).forEach { f ->
                                        val t = f["type"]?.toString() ?: f["flagType"]?.toString() ?: "flag"
                                        val d = f["description"]?.toString().orEmpty()
                                        Text(
                                            "• ${t.replace("_", " ")}${if (d.isNotBlank()) ": $d" else ""}",
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            lineHeight = 18.sp,
                                        )
                                    }
                                }
                            }
                        }
                    }
                }

                if (playgroundIdStr != null && onNavigateToPlayground != null) {
                    Spacer(Modifier.height(4.dp))
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        if (playgroundPreviewLoading) {
                            Text(
                                "Loading play place details…",
                                fontSize = 12.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        } else {
                            playgroundPreview?.let { pg ->
                                if (pg.name.isNotBlank()) {
                                    Text(
                                        text = pg.name,
                                        fontSize = 15.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        color = MaterialTheme.colorScheme.onSurface,
                                        maxLines = 2,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                }
                                val loc = playgroundLocationSubtitle(pg)
                                if (loc.isNotEmpty()) {
                                    Text(
                                        text = loc,
                                        fontSize = 12.sp,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        maxLines = 2,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                }
                            }
                        }
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Text(
                                "Play place ID",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            val idAnnotated = remember(playgroundIdStr) {
                                buildAnnotatedString {
                                    pushStringAnnotation(tag = "OPEN_PG", annotation = playgroundIdStr)
                                    pushStyle(SpanStyle(color = FormColors.PrimaryButton, textDecoration = TextDecoration.Underline))
                                    append(playgroundIdStr)
                                    pop()
                                    pop()
                                }
                            }
                            ClickableText(
                                text = idAnnotated,
                                style = TextStyle(fontSize = 13.sp, fontWeight = FontWeight.Medium),
                                onClick = { offset ->
                                    idAnnotated.getStringAnnotations(tag = "OPEN_PG", start = offset, end = offset)
                                        .firstOrNull()
                                        ?.let { openPlaygroundById(it.item) }
                                },
                            )
                            OutlinedButton(
                                onClick = { openPlaygroundById(playgroundIdStr) },
                                enabled = !actionInProgress,
                                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
                            ) {
                                Text("Open in app", fontSize = 12.sp)
                            }
                        }
                    }
                }

                if (isDeleteRequest) {
                    Text(
                        "Approve archives this listing (soft delete). Reject leaves it published.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        lineHeight = 18.sp,
                    )
                    item["reason"]?.toString()?.trim()?.takeIf { it.isNotEmpty() && !it.equals("null", ignoreCase = true) }?.let { note ->
                        Spacer(Modifier.height(4.dp))
                        Text(
                            "Requester note",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        if (onNavigateToPlayground != null && mongoObjectIdInString.containsMatchIn(note)) {
                            TextWithClickableMongoObjectIds(
                                text = note,
                                baseColor = Color(0xFF5D4037),
                                linkColor = FormColors.PrimaryButton,
                                fontSize = 13.sp,
                                onObjectIdClick = { openPlaygroundById(it) },
                            )
                        } else {
                            Text(note, fontSize = 13.sp, color = Color(0xFF5D4037))
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                }

                HorizontalDivider(color = FormColors.SubtleDivider)

                // Photo preview
                if (isPhoto) {
                    item["previewUrl"]?.toString()?.takeIf { it.isNotBlank() }?.let { url ->
                        AsyncImage(
                            model = url,
                            contentDescription = null,
                            modifier = Modifier.fillMaxWidth().height(240.dp)
                        )
                        TextButton(
                            onClick = { runCatching { uriHandler.openUri(url) } },
                            contentPadding = PaddingValues(0.dp),
                        ) { Text("Open full image", fontSize = 12.sp) }
                    }
                    item["faceCount"]?.let { fc ->
                        val count = fc.toString().toIntOrNull() ?: 0
                        if (count > 0) {
                            Text("⚠️ $count face(s) detected", color = Color(0xFFE53935), fontWeight = FontWeight.Medium)
                        }
                    }
                }

                // Edit: only fields that differ from the live listing (full-document submits are common).
                if (isEdit) {
                    @Suppress("UNCHECKED_CAST")
                    val proposed = item["proposedChanges"] as? Map<String, Any?> ?: emptyMap()
                    val skipKeys = setOf("lastUpdated", "_id", "id", "__v")
                    val proposedClean = proposed.filterKeys { it !in skipKeys }
                    val displayFields = remember(proposedClean, playgroundPreview, showAllProposedFields, playgroundPreviewLoading) {
                        if (showAllProposedFields) proposedClean
                        else {
                            val pg = playgroundPreview
                            if (pg == null) proposedClean
                            else proposedClean.filter { (k, v) -> !editValueMatchesPlayground(k, v, pg) }
                        }
                    }

                    Text(
                        if (showAllProposedFields) "All submitted fields" else "Changed fields only",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold,
                    )
                    if (!showAllProposedFields && playgroundPreviewLoading) {
                        Text(
                            "Comparing to the live listing…",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    } else if (!showAllProposedFields && playgroundPreview == null && playgroundIdStr != null) {
                        Text(
                            "Could not load the live listing; showing every submitted field.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }

                    TextButton(
                        onClick = { showAllProposedFields = !showAllProposedFields },
                        contentPadding = PaddingValues(0.dp),
                    ) {
                        Text(if (showAllProposedFields) "Show changed fields only" else "Show all submitted fields", fontSize = 12.sp)
                    }

                    if (displayFields.isEmpty()) {
                        Text(
                            "No differences found vs the live listing. If this looks wrong, use “Show all submitted fields”.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            lineHeight = 18.sp,
                        )
                    } else {
                        displayFields.toSortedMap().forEach { (key, value) ->
                            Card(
                                modifier = Modifier.fillMaxWidth(),
                                shape = RoundedCornerShape(14.dp),
                                colors = CardDefaults.cardColors(containerColor = FormColors.CardBackground),
                                elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
                            ) {
                                Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                    Text(
                                        key.replaceFirstChar { it.titlecase() },
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        fontWeight = FontWeight.SemiBold,
                                    )
                                    if (key.equals("imageUrls", ignoreCase = true)) {
                                        val urls = parseModerationImageUrlList(value)
                                        Text("${urls.size} image(s)", style = MaterialTheme.typography.bodySmall, color = FormColors.BodyText)
                                        urls.take(3).forEach { u ->
                                            Row(
                                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                                                verticalAlignment = Alignment.CenterVertically,
                                            ) {
                                                AsyncImage(
                                                    model = u,
                                                    contentDescription = null,
                                                    modifier = Modifier.size(72.dp),
                                                )
                                                TextButton(
                                                    onClick = { runCatching { uriHandler.openUri(u) } },
                                                    contentPadding = PaddingValues(0.dp),
                                                ) { Text("Open", fontSize = 12.sp) }
                                            }
                                        }
                                        if (urls.size > 3) {
                                            Text("+ ${urls.size - 3} more", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                        }
                                    } else {
                                        val vs = value?.toString() ?: "(cleared)"
                                        if (onNavigateToPlayground != null && vs != "(cleared)" && mongoObjectIdInString.containsMatchIn(vs)) {
                                            TextWithClickableMongoObjectIds(
                                                text = vs,
                                                baseColor = Color(0xFF212121),
                                                linkColor = FormColors.PrimaryButton,
                                                fontSize = 13.sp,
                                                onObjectIdClick = { openPlaygroundById(it) },
                                            )
                                        } else {
                                            Text(vs, style = MaterialTheme.typography.bodyMedium, color = FormColors.BodyText)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                if (!isEdit && !isPhoto && !isDeleteRequest) {
                    val skipKeys = setOf(
                        "_id", "id", "__v", "previewUrl",
                        "geminiSubmissionReview", "proposedChanges", "moderationFlags",
                        "submissionType", "submissionId", "status", "createdAt", "updatedAt",
                        "reviewedAt", "reviewedBy", "confidence", "recommendedAction",
                        "reason", "decisionReason",
                    )
                    val rows = item.filterKeys { it !in skipKeys }
                    if (rows.isNotEmpty()) {
                        Card(
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(16.dp),
                            colors = CardDefaults.cardColors(containerColor = FormColors.CardBackground),
                            elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
                        ) {
                            Column(
                                modifier = Modifier.padding(14.dp),
                                verticalArrangement = Arrangement.spacedBy(6.dp),
                            ) {
                                Text(
                                    "Payload",
                                    style = MaterialTheme.typography.titleSmall,
                                    fontWeight = FontWeight.SemiBold,
                                )
                                rows.forEach { (k, v) ->
                                    ModerationDetailRow(k, v?.toString() ?: "—")
                                }
                            }
                        }
                    }
                }

                errorMsg?.let { Text(it, color = FormColors.ErrorText, fontSize = 13.sp) }
                successMsg?.let { Text(it, color = Color(0xFF2E7D32), fontSize = 13.sp) }

                if (playgroundIdStr != null || submitterId != null || isNewPlayground) {
                    Spacer(Modifier.height(4.dp))
                    HorizontalDivider(color = FormColors.SubtleDivider)
                    Text(
                        "Admin tools",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold,
                    )
                    submitterId?.let { uid ->
                        Text(
                            "Submitter ID · $uid",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                    }
                    Box(Modifier.fillMaxWidth()) {
                        OutlinedButton(
                            onClick = { adminToolsMenuExpanded = true },
                            enabled = !actionInProgress,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text("Choose admin action…", fontWeight = FontWeight.Medium)
                        }
                        DropdownMenu(
                            expanded = adminToolsMenuExpanded,
                            onDismissRequest = { adminToolsMenuExpanded = false },
                            modifier = Modifier.fillMaxWidth(0.92f),
                        ) {
                            if (submitterId != null) {
                                DropdownMenuItem(
                                    text = { Text("Block submitter", color = FormColors.ErrorText) },
                                    onClick = {
                                        adminToolsMenuExpanded = false
                                        successMsg = null
                                        showBlockDialog = true
                                    },
                                )
                                DropdownMenuItem(
                                    text = { Text("Require manual review for submitter") },
                                    onClick = {
                                        adminToolsMenuExpanded = false
                                        successMsg = null
                                        showForceReviewDialog = true
                                    },
                                )
                            }
                            if (!isNewPlayground && !isDeleteRequest && playgroundIdStr != null) {
                                DropdownMenuItem(
                                    text = { Text("Archive playground") },
                                    onClick = {
                                        adminToolsMenuExpanded = false
                                        successMsg = null
                                        showDeleteDialog = true
                                    },
                                )
                                DropdownMenuItem(
                                    text = {
                                        Text(
                                            if (auditLoading) "Rollback latest change (loading…)"
                                            else "Rollback latest change",
                                        )
                                    },
                                    onClick = {
                                        adminToolsMenuExpanded = false
                                        successMsg = null
                                        if (!auditLoading && latestAudit != null) showRollbackDialog = true
                                    },
                                    enabled = !auditLoading && latestAudit != null,
                                )
                            }
                        }
                    }
                }

                Spacer(Modifier.height(4.dp))

                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Button(
                        onClick = {
                            scope.launch {
                                actionInProgress = true
                                errorMsg = null
                                try {
                                    when {
                                        isEdit -> service.approveEdit(queueId)
                                        isPhoto -> service.approvePhoto(queueId)
                                        isNewPlayground -> service.approveNewPlayground(queueId)
                                        else -> service.approveModeration(queueId)
                                    }
                                    onComplete()
                                } catch (e: Exception) {
                                    errorMsg = "Approve failed: ${e.message}"
                                    actionInProgress = false
                                }
                            }
                        },
                        enabled = !actionInProgress,
                        modifier = Modifier.weight(1f).height(48.dp),
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = Color(0xFF2E7D32),
                            contentColor = Color.White,
                        ),
                    ) { Text(if (isDeleteRequest) "Archive" else "✓ Approve", fontWeight = FontWeight.SemiBold) }

                    OutlinedButton(
                        onClick = { showRejectDialog = true },
                        enabled = !actionInProgress,
                        modifier = Modifier.weight(1f).height(48.dp),
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.outlinedButtonColors(
                            contentColor = MaterialTheme.colorScheme.error,
                        ),
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.error),
                    ) { Text(if (isDeleteRequest) "Keep listing" else "✗ Reject", fontWeight = FontWeight.SemiBold) }
                }
            }
        }
    }

    if (showRejectDialog) {
        AlertDialog(
            onDismissRequest = { showRejectDialog = false },
            title = { Text(if (isDeleteRequest) "Decline removal" else "Reject Submission") },
            text = {
                OutlinedTextField(
                    value = rejectReason,
                    onValueChange = { rejectReason = it },
                    label = { Text("Note (optional)") },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 2
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    showRejectDialog = false
                    scope.launch {
                        actionInProgress = true
                        errorMsg = null
                        try {
                            when {
                                isEdit -> service.rejectEdit(queueId, rejectReason)
                                isPhoto -> service.rejectPhoto(queueId, rejectReason)
                                isNewPlayground -> service.rejectNewPlayground(queueId, rejectReason)
                                else -> service.rejectModeration(queueId, rejectReason)
                            }
                            onComplete()
                        } catch (e: Exception) {
                            errorMsg = "Reject failed: ${e.message}"
                            actionInProgress = false
                        }
                    }
                }) { Text("Reject", color = FormColors.ErrorText) }
            },
            dismissButton = {
                TextButton(onClick = { showRejectDialog = false }) { Text("Cancel") }
            }
        )
    }

    if (showBlockDialog) {
        AlertDialog(
            onDismissRequest = { showBlockDialog = false },
            title = { Text("Block submitter") },
            text = {
                OutlinedTextField(
                    value = blockReasonInput,
                    onValueChange = { blockReasonInput = it },
                    label = { Text("Reason (required)") },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 2
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    val uid = submitterId ?: return@TextButton
                    if (blockReasonInput.isBlank()) return@TextButton
                    scope.launch {
                        actionInProgress = true
                        errorMsg = null
                        try {
                            service.adminBlockUser(uid, blockReasonInput.trim())
                            showBlockDialog = false
                            blockReasonInput = ""
                            successMsg = "User blocked."
                        } catch (e: Exception) {
                            errorMsg = "Block failed: ${e.message}"
                        } finally {
                            actionInProgress = false
                        }
                    }
                }) { Text("Block", color = FormColors.ErrorText) }
            },
            dismissButton = {
                TextButton(onClick = { showBlockDialog = false }) { Text("Cancel") }
            }
        )
    }

    if (showDeleteDialog) {
        AlertDialog(
            onDismissRequest = { showDeleteDialog = false },
            title = { Text("Archive playground") },
            text = {
                Text("This archives the place so it no longer appears in search. Continue?")
            },
            confirmButton = {
                TextButton(onClick = {
                    val pid = playgroundIdStr ?: return@TextButton
                    scope.launch {
                        actionInProgress = true
                        errorMsg = null
                        try {
                            service.adminDeletePlayground(pid)
                            showDeleteDialog = false
                            onComplete()
                        } catch (e: Exception) {
                            errorMsg = "Archive failed: ${e.message}"
                            actionInProgress = false
                        }
                    }
                }) { Text("Archive", color = FormColors.ErrorText) }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteDialog = false }) { Text("Cancel") }
            }
        )
    }

    if (showForceReviewDialog) {
        AlertDialog(
            onDismissRequest = { showForceReviewDialog = false },
            title = { Text("Require manual review") },
            text = {
                OutlinedTextField(
                    value = forceReviewReasonInput,
                    onValueChange = { forceReviewReasonInput = it },
                    label = { Text("Reason (optional)") },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 2,
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    val uid = submitterId ?: return@TextButton
                    scope.launch {
                        actionInProgress = true
                        errorMsg = null
                        try {
                            service.adminSetUserManualReview(
                                userId = uid,
                                enabled = true,
                                reason = forceReviewReasonInput.trim().ifBlank { null },
                            )
                            showForceReviewDialog = false
                            forceReviewReasonInput = ""
                            successMsg = "Manual-review flag enabled for this user."
                        } catch (e: Exception) {
                            errorMsg = "Could not set manual-review flag: ${e.message}"
                        } finally {
                            actionInProgress = false
                        }
                    }
                }) { Text("Save") }
            },
            dismissButton = {
                TextButton(onClick = { showForceReviewDialog = false }) { Text("Cancel") }
            },
        )
    }

    if (showRollbackDialog) {
        val audit = latestAudit
        val auditId = audit?.get("id")?.toString().orEmpty()
        val sourceType = audit?.get("sourceType")?.toString().orEmpty()
        val reason = audit?.get("reason")?.toString()?.takeIf { it.isNotBlank() }
        AlertDialog(
            onDismissRequest = { showRollbackDialog = false },
            title = { Text("Rollback latest change") },
            text = {
                if (audit == null || auditId.isBlank()) {
                    Text("No rollback-ready audit entry found.")
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("This restores the playground to its previous snapshot for the latest audit record.")
                        if (sourceType.isNotBlank()) {
                            Text("Source: $sourceType", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        if (!reason.isNullOrBlank()) {
                            Text("Reason: $reason", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(
                    enabled = audit != null && auditId.isNotBlank() && !actionInProgress,
                    onClick = {
                        if (auditId.isBlank()) return@TextButton
                        scope.launch {
                            actionInProgress = true
                            errorMsg = null
                            try {
                                service.adminRollbackPlaygroundAudit(auditId)
                                showRollbackDialog = false
                                successMsg = "Latest change rolled back."
                                onComplete()
                            } catch (e: Exception) {
                                errorMsg = "Rollback failed: ${e.message}"
                            } finally {
                                actionInProgress = false
                            }
                        }
                    },
                ) { Text("Rollback", color = FormColors.ErrorText) }
            },
            dismissButton = {
                TextButton(onClick = { showRollbackDialog = false }) { Text("Cancel") }
            },
        )
    }
}
