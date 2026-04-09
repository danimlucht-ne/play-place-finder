package org.community.playgroundfinder.ui.screens.advertising

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import kotlinx.datetime.Clock
import kotlinx.datetime.DatePeriod
import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone
import kotlinx.datetime.plus
import kotlinx.datetime.todayIn
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import org.community.playgroundfinder.data.PlaygroundService
import org.community.playgroundfinder.models.AdSubmission
import org.community.playgroundfinder.models.Advertiser
import org.community.playgroundfinder.ui.composables.FormColors
import coil3.compose.AsyncImage

private val HTML_REGEX = Regex("<[^>]+>")
private const val MAX_IMAGE_SIZE = 2 * 1024 * 1024

private val AD_BRAND_CATEGORIES = listOf(
    "indoor_play",
    "outdoor_recreation",
    "family_dining",
    "education",
    "entertainment",
    "retail",
    "health_wellness",
    "services",
    "other",
)

private val AD_BRAND_CATEGORY_LABELS = mapOf(
    "indoor_play" to "Indoor Play",
    "outdoor_recreation" to "Outdoor Recreation",
    "family_dining" to "Family Dining",
    "education" to "Education",
    "entertainment" to "Entertainment",
    "retail" to "Retail",
    "health_wellness" to "Health & Wellness",
    "services" to "Services",
    "other" to "Other",
)

/** Matches server [ALLOWED_IMAGE_TYPES] (multer mimetype). Cropped uploads are JPEG. */
private fun LocalDate.formatMedium(): String {
    val mon = month.name.take(3).lowercase().replaceFirstChar { it.titlecase() }
    return "$mon $dayOfMonth, $year"
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun EventDatePickerField(
    eventDateIso: String,
    onDateSelected: (String) -> Unit,
    errorText: String? = null,
) {
    val zone = TimeZone.currentSystemDefault()
    var open by remember { mutableStateOf(false) }
    val displayText = remember(eventDateIso) {
        runCatching { LocalDate.parse(eventDateIso.trim()).formatMedium() }
            .getOrElse { "Tap to choose date" }
    }
    val selectableDates = remember(zone) {
        object : SelectableDates {
            override fun isSelectableDate(utcTimeMillis: Long): Boolean {
                val selected = datePickerUtcMillisToLocalDate(utcTimeMillis)
                val today = Clock.System.todayIn(zone)
                return selected >= today
            }

            override fun isSelectableYear(year: Int): Boolean {
                val today = Clock.System.todayIn(zone)
                return year in today.year..(today.year + 2)
            }
        }
    }
    OutlinedTextField(
        value = displayText,
        onValueChange = { },
        readOnly = true,
        label = { Text("Event date") },
        isError = errorText != null,
        supportingText = {
            Text(
                errorText ?: "Choose the day the event takes place",
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
        val today = Clock.System.todayIn(zone)
        val startLd = runCatching { LocalDate.parse(eventDateIso.trim()) }.getOrNull() ?: today
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

private fun isAllowedAdImageMagic(b: ByteArray): Boolean {
    if (b.size < 12) return false
    if (b[0].toInt() and 0xFF == 0xFF && b[1].toInt() and 0xFF == 0xD8) return true
    if (b[0] == 0x89.toByte() && b[1] == 0x50.toByte() && b[2] == 0x4E.toByte() && b[3] == 0x47.toByte()) return true
    if (b[0] == 'G'.code.toByte() && b[1] == 'I'.code.toByte() && b[2] == 'F'.code.toByte()) return true
    if (b[0] == 'R'.code.toByte() && b[1] == 'I'.code.toByte() && b[2] == 'F'.code.toByte() && b[3] == 'F'.code.toByte() &&
        b[8] == 'W'.code.toByte() && b[9] == 'E'.code.toByte() && b[10] == 'B'.code.toByte() && b[11] == 'P'.code.toByte()
    ) {
        return true
    }
    return false
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CreativeContentScreen(
    playgroundService: PlaygroundService,
    submissionId: String,
    onCreativeSubmitted: () -> Unit,
    onBack: () -> Unit,
    selectedImageBytes: ByteArray? = null,
    selectedImageName: String? = null,
    onPickImage: () -> Unit = {},
    /** Clear picked bytes after each successful upload so the user can add another photo. */
    onImageUploadComplete: () -> Unit = {},
    /** Multi-select from gallery (no crop); processed after [selectedImageBytes] flow. */
    pendingDirectImageBatch: List<ByteArray>? = null,
    onDirectBatchConsumed: (() -> Unit)? = null,
) {
    val scope = rememberCoroutineScope()

    var headline by remember { mutableStateOf("") }
    var body by remember { mutableStateOf("") }
    var ctaText by remember { mutableStateOf("") }
    var ctaUrl by remember { mutableStateOf("") }

    // Event-specific fields
    var eventName by remember { mutableStateOf("") }
    var eventDate by remember { mutableStateOf("") }
    var eventTime by remember { mutableStateOf("") }
    var isRecurring by remember { mutableStateOf(false) }
    var eventLocation by remember { mutableStateOf("") }

    var uploadedImageUrls by remember { mutableStateOf<List<String>>(emptyList()) }
    var isUploading by remember { mutableStateOf(false) }
    var isSubmitting by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var submission by remember { mutableStateOf<AdSubmission?>(null) }

    // Whether the advertiser has a business address (enables showDistance toggle)
    var hasBusinessAddress by remember { mutableStateOf(false) }
    var showDistance by remember { mutableStateOf(false) }
    /** top | center | bottom — how the photo is aligned when the live ad crops the image. */
    var imageAlignment by remember { mutableStateOf("center") }

    /** Shown on the ad / used for review — can differ from account business (agencies, multiple clients). */
    var creativeBusinessName by remember { mutableStateOf("") }
    var creativeBusinessCategory by remember { mutableStateOf("") }
    var brandCategoryMenuExpanded by remember { mutableStateOf(false) }
    /** When false, company fields stay synced to profile (step 1); tap "Edit" to override. */
    var editingCompanyOnAd by remember { mutableStateOf(false) }
    var profileBusinessName by remember { mutableStateOf("") }
    var profileCategory by remember { mutableStateOf("") }

    // Field-level validation errors
    var headlineError by remember { mutableStateOf<String?>(null) }
    var bodyError by remember { mutableStateOf<String?>(null) }
    var ctaTextError by remember { mutableStateOf<String?>(null) }
    var ctaUrlError by remember { mutableStateOf<String?>(null) }
    var imageError by remember { mutableStateOf<String?>(null) }
    var eventNameError by remember { mutableStateOf<String?>(null) }
    var eventDateError by remember { mutableStateOf<String?>(null) }
    var brandNameError by remember { mutableStateOf<String?>(null) }
    var brandCategoryError by remember { mutableStateOf<String?>(null) }

    // Load submission, advertiser profile, and creative defaults in order (profile informs "edit company" state).
    LaunchedEffect(submissionId) {
        try {
            submission = playgroundService.getSubmission(submissionId)
        } catch (_: Exception) {}
        var advForProfile: Advertiser? = null
        try {
            val advertiser = playgroundService.getMyAdvertiser()
            advForProfile = advertiser
            hasBusinessAddress = advertiser.businessAddress.isNotBlank()
            profileBusinessName = advertiser.businessName
            profileCategory = advertiser.category
        } catch (_: Exception) {}

        var brandName = ""
        var brandCat = ""
        try {
            val creative = playgroundService.getAdCreative(submissionId)
            if (creative.headline.isNotBlank()) headline = creative.headline
            if (creative.body.isNotBlank()) body = creative.body
            if (creative.ctaText.isNotBlank()) ctaText = creative.ctaText
            if (creative.ctaUrl.isNotBlank()) ctaUrl = creative.ctaUrl
            if (creative.businessName.isNotBlank()) brandName = creative.businessName
            if (creative.businessCategory.isNotBlank()) brandCat = creative.businessCategory
            val urls = buildList {
                if (creative.imageUrl.isNotBlank()) add(creative.imageUrl.trim())
                creative.additionalImageUrls.filter { it.isNotBlank() }.forEach { add(it.trim()) }
            }
            if (urls.isNotEmpty()) uploadedImageUrls = urls.distinct()
            val a = creative.imageAlignment.trim().lowercase()
            if (a == "top" || a == "center" || a == "bottom") imageAlignment = a
        } catch (_: Exception) {
            // 404 or error — leave fields empty (user enters manually)
        }
        if (brandName.isBlank() || brandCat.isBlank()) {
            advForProfile?.let { adv ->
                if (brandName.isBlank()) brandName = adv.businessName
                if (brandCat.isBlank()) brandCat = adv.category
            }
        }
        creativeBusinessName = brandName
        creativeBusinessCategory = brandCat
        editingCompanyOnAd =
            (brandName.isNotBlank() && profileBusinessName.isNotBlank() && brandName.trim() != profileBusinessName.trim()) ||
                (brandCat.isNotBlank() && profileCategory.isNotBlank() && brandCat != profileCategory)
    }

    val isEventPackage = submission?.`package`?.type?.startsWith("event_spotlight") == true

    fun buildAutoEventBody(): String {
        val name = eventName.trim()
        val parts = mutableListOf<String>()
        parts.add("Join us for $name.")
        if (eventDate.isNotBlank()) parts.add("Date: ${eventDate.trim()}")
        if (eventTime.isNotBlank()) parts.add("Time: ${eventTime.trim()}")
        if (eventLocation.isNotBlank()) parts.add("Location: ${eventLocation.trim()}")
        var s = parts.joinToString("\n").trim()
        if (s.length < 10) {
            s = "$name — family-friendly event. Tap through for details."
        }
        return s.take(150)
    }

    fun readableImageName(url: String, index: Int): String {
        val trimmed = url.trim()
        val withoutQuery = trimmed.substringBefore('?')
        val tail = withoutQuery.substringAfterLast('/').substringAfterLast("%2F")
        val raw = if (tail.isNotBlank()) tail else "image-${index + 1}"
        return raw
            .replace("%20", " ")
            .replace("%28", "(")
            .replace("%29", ")")
            .replace('+', ' ')
            .ifBlank { "image-${index + 1}" }
    }

    // Auto-upload when image bytes arrive
    LaunchedEffect(selectedImageBytes, selectedImageName) {
        val bytes = selectedImageBytes ?: return@LaunchedEffect
        val name = selectedImageName ?: "image.jpg"
        if (bytes.size > MAX_IMAGE_SIZE) {
            imageError = "Image must be under 2 MB"
            return@LaunchedEffect
        }
        if (!isAllowedAdImageMagic(bytes)) {
            imageError = "Use a JPEG, PNG, GIF, or WebP image"
            return@LaunchedEffect
        }
        isUploading = true
        imageError = null
        try {
            val url = playgroundService.uploadAdAsset(submissionId, bytes, name)
            uploadedImageUrls = (uploadedImageUrls + url).distinct()
            onImageUploadComplete()
        } catch (e: Exception) {
            imageError = e.message ?: "Image upload failed"
        } finally {
            isUploading = false
        }
    }

    LaunchedEffect(pendingDirectImageBatch) {
        val batch = pendingDirectImageBatch ?: return@LaunchedEffect
        if (batch.isEmpty()) return@LaunchedEffect
        isUploading = true
        imageError = null
        val errors = mutableListOf<String>()
        var stamp = System.currentTimeMillis()
        try {
            batch.forEachIndexed { idx, bytes ->
                if (bytes.size > MAX_IMAGE_SIZE) {
                    errors.add("Photo ${idx + 1}: must be under 2 MB")
                    return@forEachIndexed
                }
                if (!isAllowedAdImageMagic(bytes)) {
                    errors.add("Photo ${idx + 1}: use JPEG, PNG, GIF, or WebP")
                    return@forEachIndexed
                }
                try {
                    val name = "ad_${stamp}_${idx + 1}.jpg"
                    stamp += 1
                    val url = playgroundService.uploadAdAsset(submissionId, bytes, name)
                    uploadedImageUrls = (uploadedImageUrls + url).distinct()
                } catch (e: Exception) {
                    errors.add("Photo ${idx + 1}: ${e.message ?: "upload failed"}")
                }
            }
            if (errors.isNotEmpty()) {
                imageError = errors.joinToString("; ")
            }
        } finally {
            isUploading = false
            onDirectBatchConsumed?.invoke()
        }
    }

    fun validate(): Boolean {
        var valid = true
        if (!isEventPackage) {
            headlineError = when {
                headline.isBlank() -> { valid = false; "Headline is required" }
                headline.trim().length < 5 -> { valid = false; "Must be at least 5 characters" }
                headline.trim().length > 50 -> { valid = false; "Must be 50 characters or fewer" }
                HTML_REGEX.containsMatchIn(headline) -> { valid = false; "HTML is not allowed" }
                else -> null
            }
            bodyError = when {
                body.isBlank() -> { valid = false; "Body text is required" }
                body.trim().length < 10 -> { valid = false; "Use at least 10 characters (required by the ad review rules)" }
                body.trim().length > 150 -> { valid = false; "Must be 150 characters or fewer" }
                HTML_REGEX.containsMatchIn(body) -> { valid = false; "HTML is not allowed" }
                else -> null
            }
        } else {
            headlineError = null
            bodyError = null
        }
        val ctaForRules = if (isEventPackage && ctaText.isBlank()) "Learn More" else ctaText
        ctaTextError = when {
            ctaForRules.trim().length < 2 -> { valid = false; "Button text is required" }
            ctaForRules.trim().length > 25 -> { valid = false; "Must be 25 characters or fewer" }
            HTML_REGEX.containsMatchIn(ctaForRules) -> { valid = false; "HTML is not allowed" }
            else -> null
        }
        ctaUrlError = when {
            ctaUrl.isBlank() -> { valid = false; "Button link is required" }
            !ctaUrl.trim().startsWith("https://") -> { valid = false; "Must be a valid HTTPS URL" }
            HTML_REGEX.containsMatchIn(ctaUrl) -> { valid = false; "HTML is not allowed" }
            else -> null
        }
        if (uploadedImageUrls.isEmpty()) { imageError = "Please upload at least one image"; valid = false }
        if (!editingCompanyOnAd) {
            if (profileBusinessName.isNotBlank()) creativeBusinessName = profileBusinessName
            if (profileCategory.isNotBlank()) creativeBusinessCategory = profileCategory
        }
        brandNameError = when {
            creativeBusinessName.isBlank() -> { valid = false; "Company name is required" }
            creativeBusinessName.trim().length < 2 -> { valid = false; "Must be at least 2 characters" }
            creativeBusinessName.trim().length > 100 -> { valid = false; "Must be 100 characters or fewer" }
            HTML_REGEX.containsMatchIn(creativeBusinessName) -> { valid = false; "HTML is not allowed" }
            else -> null
        }
        brandCategoryError = when {
            creativeBusinessCategory.isBlank() || creativeBusinessCategory !in AD_BRAND_CATEGORIES ->
                { valid = false; "Choose a category for this ad" }
            else -> null
        }
        if (isEventPackage) {
            eventNameError = when {
                eventName.isBlank() -> { valid = false; "Event name is required" }
                eventName.trim().length < 5 -> { valid = false; "Must be at least 5 characters" }
                eventName.trim().length > 100 -> { valid = false; "Must be 100 characters or fewer" }
                HTML_REGEX.containsMatchIn(eventName) -> { valid = false; "HTML is not allowed" }
                else -> null
            }
            eventDateError = when {
                eventDate.isBlank() -> { valid = false; "Event date is required" }
                runCatching { LocalDate.parse(eventDate.trim()) }.isFailure -> { valid = false; "Pick a valid event date" }
                else -> null
            }
        }
        return valid
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            if (isEventPackage) {
                "Event creative \u2014 add your event details, a hero image, and where families should tap to learn more."
            } else {
                "Create your ad \u2014 provide a headline, body text, image, and a button for your website."
            },
            fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(4.dp))

        Card(
            shape = RoundedCornerShape(12.dp),
            colors = CardDefaults.cardColors(containerColor = FormColors.CardBackground),
            elevation = CardDefaults.cardElevation(1.dp),
            modifier = Modifier.fillMaxWidth(),
        ) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {

        Text(
            "Business on this ad",
            fontWeight = FontWeight.SemiBold,
            fontSize = 15.sp,
        )
        Text(
            "We start from the business profile you entered earlier. Edit only if this placement is for a different brand.",
            fontSize = 12.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            lineHeight = 16.sp,
        )
        if (!editingCompanyOnAd) {
            val catLabel = AD_BRAND_CATEGORY_LABELS[creativeBusinessCategory] ?: creativeBusinessCategory
            Text(
                "${creativeBusinessName.ifBlank { "—" }} · $catLabel",
                fontSize = 14.sp,
                fontWeight = FontWeight.Medium,
                color = MaterialTheme.colorScheme.onSurface,
            )
            TextButton(onClick = { editingCompanyOnAd = true }) {
                Text("Edit company on this ad")
            }
        } else {
            OutlinedTextField(
                value = creativeBusinessName,
                onValueChange = { creativeBusinessName = it; brandNameError = null },
                label = { Text("Company / brand name *") },
                isError = brandNameError != null,
                supportingText = brandNameError?.let { { Text(it) } },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            ExposedDropdownMenuBox(
                expanded = brandCategoryMenuExpanded,
                onExpandedChange = { brandCategoryMenuExpanded = it },
            ) {
                OutlinedTextField(
                    value = AD_BRAND_CATEGORY_LABELS[creativeBusinessCategory] ?: "",
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("Company category *") },
                    trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = brandCategoryMenuExpanded) },
                    isError = brandCategoryError != null,
                    supportingText = brandCategoryError?.let { { Text(it) } },
                    modifier = Modifier.fillMaxWidth().menuAnchor(),
                )
                ExposedDropdownMenu(
                    expanded = brandCategoryMenuExpanded,
                    onDismissRequest = { brandCategoryMenuExpanded = false },
                ) {
                    AD_BRAND_CATEGORIES.forEach { cat ->
                        DropdownMenuItem(
                            text = { Text(AD_BRAND_CATEGORY_LABELS[cat] ?: cat) },
                            onClick = {
                                creativeBusinessCategory = cat
                                brandCategoryError = null
                                brandCategoryMenuExpanded = false
                            },
                        )
                    }
                }
            }
            TextButton(onClick = {
                editingCompanyOnAd = false
                creativeBusinessName = profileBusinessName
                creativeBusinessCategory = profileCategory
                brandNameError = null
                brandCategoryError = null
            }) {
                Text("Use profile defaults")
            }
        }

        HorizontalDivider(color = FormColors.Divider.copy(alpha = 0.35f))

        if (!isEventPackage) {
            OutlinedTextField(
                value = headline, onValueChange = { headline = it; headlineError = null },
                label = { Text("Headline *") }, placeholder = { Text("e.g. Visit Fun Zone!") },
                isError = headlineError != null,
                supportingText = headlineError?.let { { Text(it) } } ?: { Text("${headline.trim().length}/50") },
                singleLine = true, modifier = Modifier.fillMaxWidth(),
            )

            OutlinedTextField(
                value = body, onValueChange = { body = it; bodyError = null },
                label = { Text("Body Text *") }, placeholder = { Text("e.g. Indoor play for ages 2-12") },
                isError = bodyError != null,
                supportingText = bodyError?.let { { Text(it) } }
                    ?: { Text("At least 10 characters, up to 150 — ${body.trim().length}/150") },
                minLines = 2, modifier = Modifier.fillMaxWidth(),
            )
        } else {
            Text(
                "Headline and short description are built from your event name and details so you do not repeat the same copy here.",
                fontSize = 12.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                lineHeight = 16.sp,
            )
        }

        // Image upload section
        OutlinedCard(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp)) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Ad Image *", fontWeight = FontWeight.Medium)
                Text(
                    "JPEG, PNG, GIF, or WebP — max 2 MB each. Pick several at once from your gallery, or one at a time. " +
                        "One image opens the crop editor; multiple upload as-is. The first in the list is the main banner.",
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    lineHeight = 18.sp,
                )
                uploadedImageUrls.forEachIndexed { index, url ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        val label = readableImageName(url, index)
                        Text(
                            if (index == 0) "\u2605 Main image: $label" else "\u2022 $label",
                            fontSize = 12.sp,
                            modifier = Modifier.weight(1f),
                        )
                        TextButton(
                            onClick = {
                                uploadedImageUrls = uploadedImageUrls.filterIndexed { i, _ -> i != index }
                            },
                        ) { Text("Remove") }
                    }
                }
                uploadedImageUrls.firstOrNull()?.let { heroUrl ->
                    Text(
                        "Banner preview uses the same fit framing as live ads, so your full image stays visible.",
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        lineHeight = 16.sp,
                    )
                    Spacer(Modifier.height(6.dp))
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(140.dp)
                            .clip(RoundedCornerShape(10.dp))
                            .background(Color(0xFFEEEEEE)),
                        contentAlignment = Alignment.Center,
                    ) {
                        AsyncImage(
                            model = heroUrl,
                            contentDescription = "Main ad image preview",
                            modifier = Modifier.fillMaxSize(),
                            contentScale = ContentScale.Fit,
                            alignment = Alignment.Center,
                        )
                    }
                }
                when {
                    isUploading -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                        Text("Uploading\u2026", fontSize = 14.sp)
                    }
                    else -> {
                        OutlinedButton(onClick = onPickImage) {
                            Text(if (uploadedImageUrls.isEmpty()) "Add image(s)" else "Add more image(s)")
                        }
                    }
                }
                imageError?.let { Text(it, color = FormColors.ErrorText, fontSize = 13.sp) }
            }
        }

        OutlinedTextField(
            value = ctaText,
            onValueChange = { ctaText = it; ctaTextError = null },
            label = { Text(if (isEventPackage) "Button Text (optional)" else "Button Text *") },
            placeholder = { Text(if (isEventPackage) "Defaults to Learn More" else "e.g. Learn More") },
            isError = ctaTextError != null,
            supportingText = ctaTextError?.let { { Text(it) } }
                ?: { Text(if (isEventPackage) "Leave blank to use \"Learn More\"" else "${ctaText.trim().length}/25") },
            singleLine = true, modifier = Modifier.fillMaxWidth(),
        )

        // Button Link
        OutlinedTextField(
            value = ctaUrl, onValueChange = { ctaUrl = it; ctaUrlError = null },
            label = { Text("Button Link *") }, placeholder = { Text("https://example.com") },
            isError = ctaUrlError != null,
            supportingText = ctaUrlError?.let { { Text(it) } },
            singleLine = true, modifier = Modifier.fillMaxWidth(),
        )

        // Event-specific fields (shown only for event packages)
        if (isEventPackage) {
            HorizontalDivider(color = FormColors.Divider.copy(alpha = 0.3f))
            Text("\uD83C\uDF89 Event Details", fontSize = 16.sp, fontWeight = FontWeight.SemiBold)

            OutlinedTextField(
                value = eventName, onValueChange = { eventName = it; eventNameError = null },
                label = { Text("Event Name *") }, placeholder = { Text("e.g. Family Fun Day at Sunny Park") },
                isError = eventNameError != null,
                supportingText = eventNameError?.let { { Text(it) } } ?: { Text("${eventName.trim().length}/100") },
                singleLine = true, modifier = Modifier.fillMaxWidth(),
            )

            EventDatePickerField(
                eventDateIso = eventDate,
                onDateSelected = { eventDate = it; eventDateError = null },
                errorText = eventDateError,
            )

            OutlinedTextField(
                value = eventTime, onValueChange = { eventTime = it },
                label = { Text("Event Time (optional)") }, placeholder = { Text("e.g. 10am - 2pm") },
                singleLine = true, modifier = Modifier.fillMaxWidth(),
            )

            OutlinedTextField(
                value = eventLocation, onValueChange = { eventLocation = it },
                label = { Text("Event Location (optional)") }, placeholder = { Text("e.g. Sunny Park, 123 Main St") },
                singleLine = true, modifier = Modifier.fillMaxWidth(),
            )

            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = isRecurring, onCheckedChange = { isRecurring = it })
                Text("This is a recurring event (e.g. every Saturday)", fontSize = 14.sp)
            }
        }

        // Show distance toggle — only if advertiser provided a business address
        if (hasBusinessAddress) {
            HorizontalDivider(color = FormColors.Divider.copy(alpha = 0.3f))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = showDistance, onCheckedChange = { showDistance = it })
                Text("Show distance to your business on your ad?", fontSize = 14.sp)
            }
        }

        } // Column inside Card
        } // Card

        errorMessage?.let {
            Text(it, color = FormColors.ErrorText, fontSize = 13.sp)
            Spacer(Modifier.height(8.dp))
        }

        Button(
            onClick = {
                if (!validate()) return@Button
                scope.launch {
                    isSubmitting = true
                        errorMessage = null
                        headlineError = null
                        bodyError = null
                        ctaTextError = null
                        ctaUrlError = null
                        imageError = null
                        eventNameError = null
                        eventDateError = null
                        brandNameError = null
                        brandCategoryError = null
                    try {
                        val primary = uploadedImageUrls.first()
                        val effectiveHeadline = if (isEventPackage) {
                            headline.trim().ifBlank { eventName.trim() }
                        } else {
                            headline.trim()
                        }
                        val effectiveBody = if (isEventPackage) {
                            if (body.trim().length >= 10) body.trim() else buildAutoEventBody()
                        } else {
                            body.trim()
                        }
                        val effectiveCta = if (isEventPackage && ctaText.isBlank()) "Learn More" else ctaText.trim()
                        val fields = mutableMapOf<String, kotlinx.serialization.json.JsonElement>(
                            "step" to JsonPrimitive(3),
                            "headline" to JsonPrimitive(effectiveHeadline),
                            "body" to JsonPrimitive(effectiveBody),
                            "imageUrl" to JsonPrimitive(primary),
                            "ctaText" to JsonPrimitive(effectiveCta),
                            "ctaUrl" to JsonPrimitive(ctaUrl.trim()),
                            "showDistance" to JsonPrimitive(showDistance),
                            "imageAlignment" to JsonPrimitive(imageAlignment),
                            "creativeBusinessName" to JsonPrimitive(creativeBusinessName.trim()),
                            "creativeBusinessCategory" to JsonPrimitive(creativeBusinessCategory.trim()),
                        )
                        if (uploadedImageUrls.size > 1) {
                            fields["additionalImageUrls"] = buildJsonArray {
                                uploadedImageUrls.drop(1).forEach { add(JsonPrimitive(it)) }
                            }
                        }
                        if (isEventPackage) {
                            fields["eventName"] = JsonPrimitive(eventName.trim())
                            fields["eventDate"] = JsonPrimitive(eventDate.trim())
                            if (eventTime.isNotBlank()) fields["eventTime"] = JsonPrimitive(eventTime.trim())
                            fields["isRecurring"] = JsonPrimitive(isRecurring)
                            if (eventLocation.isNotBlank()) fields["eventLocation"] = JsonPrimitive(eventLocation.trim())
                        }
                        playgroundService.updateSubmissionJson(submissionId, JsonObject(fields))
                        onCreativeSubmitted()
                    } catch (e: Exception) {
                        val raw = e.message ?: "Something went wrong. Please try again."
                        val lower = raw.lowercase()
                        when {
                            "headline" in lower -> headlineError = raw
                            (("body" in lower) || ("10" in lower && "character" in lower)) && "event" !in lower -> bodyError = raw
                            "cta" in lower || ("button" in lower && "text" in lower) -> ctaTextError = raw
                            "url" in lower || "https" in lower -> ctaUrlError = raw
                            "image" in lower || "upload" in lower -> imageError = raw
                            "event name" in lower || ("event" in lower && "name" in lower) -> eventNameError = raw
                            "event date" in lower || "eventdate" in lower -> eventDateError = raw
                            "creativebusinessname" in lower.replace(" ", "") ||
                                ("businessname" in lower && "creative" in lower) -> brandNameError = raw
                            "creativebusinesscategory" in lower.replace(" ", "") ||
                                ("category" in lower && "creative" in lower) -> brandCategoryError = raw
                            else -> errorMessage = raw
                        }
                    } finally {
                        isSubmitting = false
                    }
                }
            },
            enabled = !isSubmitting && !isUploading,
            modifier = Modifier.fillMaxWidth().height(52.dp),
            shape = RoundedCornerShape(16.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF5E5E5E), contentColor = Color.White),
        ) {
            if (isSubmitting) {
                CircularProgressIndicator(modifier = Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp)
            } else {
                Text("Continue", fontWeight = FontWeight.Bold)
            }
        }
        // Room to scroll the last fields above the keyboard without dismissing it
        Spacer(Modifier.height(120.dp))
    }
}
