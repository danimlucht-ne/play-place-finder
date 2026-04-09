package org.community.playgroundfinder.ui.screens.advertising

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.community.playgroundfinder.data.PlaygroundService
import org.community.playgroundfinder.models.CityPrediction
import org.community.playgroundfinder.ui.composables.FormColors

private val ALLOWED_CATEGORIES = listOf(
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

private val CATEGORY_LABELS = mapOf(
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

private val HTML_REGEX = Regex("<[^>]+>")
private val EMAIL_REGEX = Regex("^[A-Za-z0-9+_.-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BusinessInfoScreen(
    playgroundService: PlaygroundService,
    onSubmissionCreated: (submissionId: String, regionKey: String) -> Unit,
    onBack: () -> Unit,
) {
    val scope = rememberCoroutineScope()

    var businessName by remember { mutableStateOf("") }
    var selectedCategory by remember { mutableStateOf("") }
    var city by remember { mutableStateOf("") }
    var state by remember { mutableStateOf("") }
    var locationQuery by remember { mutableStateOf("") }
    var locationPredictions by remember { mutableStateOf<List<CityPrediction>>(emptyList()) }
    var locationSelected by remember { mutableStateOf(false) }
    var contactEmail by remember { mutableStateOf("") }
    var websiteUrl by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    /** Full formatted address from Places; only submitted when [businessAddressFromPicker] is true (or pre-filled from server). */
    var businessAddress by remember { mutableStateOf("") }
    var addressPredictions by remember { mutableStateOf<List<CityPrediction>>(emptyList()) }
    /** True after user picks a suggestion, or after pre-fill from an existing advertiser. */
    var businessAddressFromPicker by remember { mutableStateOf(false) }

    var categoryExpanded by remember { mutableStateOf(false) }
    var isLoading by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var isPreFilling by remember { mutableStateOf(true) }

    // Pre-fill from existing advertiser record
    LaunchedEffect(Unit) {
        try {
            val advertiser = playgroundService.getMyAdvertiser()
            businessName = advertiser.businessName
            selectedCategory = advertiser.category
            city = advertiser.city
            state = advertiser.state
            if (advertiser.city.isNotBlank() && advertiser.state.isNotBlank()) {
                locationQuery = "${advertiser.city}, ${advertiser.state}"
                locationSelected = true
            }
            contactEmail = advertiser.contactEmail
            websiteUrl = advertiser.websiteUrl
            description = advertiser.description
            businessAddress = advertiser.businessAddress
            businessAddressFromPicker = advertiser.businessAddress.isNotBlank()
        } catch (_: Exception) {
            // 404 or error — leave fields empty (new advertiser)
        } finally {
            isPreFilling = false
        }
    }

    // Field-level validation errors
    var nameError by remember { mutableStateOf<String?>(null) }
    var categoryError by remember { mutableStateOf<String?>(null) }
    var cityError by remember { mutableStateOf<String?>(null) }
    var emailError by remember { mutableStateOf<String?>(null) }
    var addressError by remember { mutableStateOf<String?>(null) }

    fun validate(): Boolean {
        var valid = true

        // Business name: 2-100 chars, no HTML
        nameError = when {
            businessName.isBlank() -> { valid = false; "Business name is required" }
            businessName.trim().length < 2 -> { valid = false; "Must be at least 2 characters" }
            businessName.trim().length > 100 -> { valid = false; "Must be 100 characters or fewer" }
            HTML_REGEX.containsMatchIn(businessName) -> { valid = false; "HTML is not allowed" }
            else -> null
        }

        // Category: must be from allowed list
        categoryError = if (selectedCategory.isBlank() || selectedCategory !in ALLOWED_CATEGORIES) {
            valid = false; "Please select a category"
        } else null

        // City & State: must be selected from autocomplete
        cityError = if (city.isBlank() || state.isBlank()) {
            valid = false; "Please select a city from the suggestions"
        } else null

        // Email: valid format
        emailError = when {
            contactEmail.isBlank() -> { valid = false; "Email is required" }
            !EMAIL_REGEX.matches(contactEmail.trim()) -> { valid = false; "Enter a valid email address" }
            else -> null
        }

        addressError = when {
            businessAddress.isBlank() -> null
            !businessAddressFromPicker -> {
                valid = false
                "Choose an address from the suggestions"
            }
            else -> null
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
        if (isPreFilling) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = FormColors.PrimaryButton)
            }
            return@Column
        }

        Text(
            "Tell us about your business.",
            fontSize = 14.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        Spacer(Modifier.height(4.dp))

        Card(
            shape = RoundedCornerShape(12.dp),
            colors = CardDefaults.cardColors(containerColor = FormColors.CardBackground),
            elevation = CardDefaults.cardElevation(1.dp),
            modifier = Modifier.fillMaxWidth(),
        ) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {

        // Business Name
        OutlinedTextField(
            value = businessName,
            onValueChange = { businessName = it; nameError = null },
            label = { Text("Business Name *") },
            isError = nameError != null,
            supportingText = nameError?.let { { Text(it) } },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )

        // Category Dropdown
        ExposedDropdownMenuBox(
            expanded = categoryExpanded,
            onExpandedChange = { categoryExpanded = it },
        ) {
            OutlinedTextField(
                value = CATEGORY_LABELS[selectedCategory] ?: "",
                onValueChange = {},
                readOnly = true,
                label = { Text("Category *") },
                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = categoryExpanded) },
                isError = categoryError != null,
                supportingText = categoryError?.let { { Text(it) } },
                modifier = Modifier.fillMaxWidth().menuAnchor(),
            )
            ExposedDropdownMenu(
                expanded = categoryExpanded,
                onDismissRequest = { categoryExpanded = false },
            ) {
                ALLOWED_CATEGORIES.forEach { cat ->
                    DropdownMenuItem(
                        text = { Text(CATEGORY_LABELS[cat] ?: cat) },
                        onClick = {
                            selectedCategory = cat
                            categoryError = null
                            categoryExpanded = false
                        },
                    )
                }
            }
        }

        // City & State — Google Places Autocomplete
        Column {
            OutlinedTextField(
                value = locationQuery,
                onValueChange = { newValue ->
                    locationQuery = newValue
                    locationSelected = false
                    city = ""
                    state = ""
                    cityError = null
                    if (newValue.length >= 2) {
                        scope.launch {
                            try {
                                locationPredictions = playgroundService.autocompleteLocation(newValue)
                            } catch (_: Exception) {
                                locationPredictions = emptyList()
                            }
                        }
                    } else {
                        locationPredictions = emptyList()
                    }
                },
                label = { Text("City, State *") },
                placeholder = { Text("Start typing a city name...") },
                isError = cityError != null,
                supportingText = cityError?.let { { Text(it) } },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            if (locationPredictions.isNotEmpty() && !locationSelected) {
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = Color.White,
                    tonalElevation = 4.dp,
                    shadowElevation = 4.dp,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column {
                        locationPredictions.take(5).forEach { prediction ->
                            Text(
                                prediction.description,
                                fontSize = 14.sp,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable {
                                        locationQuery = prediction.description
                                        locationPredictions = emptyList()
                                        locationSelected = true
                                        cityError = null
                                        // Parse "City, State, USA" from Google Places description
                                        val parts = prediction.description.split(",").map { it.trim() }
                                        if (parts.size >= 2) {
                                            city = parts[0]
                                            // State is typically the second part; strip " USA" if present
                                            state = parts[1].replace("USA", "").trim()
                                        }
                                    }
                                    .padding(horizontal = 12.dp, vertical = 10.dp),
                                color = Color(0xFF212121),
                            )
                            if (prediction != locationPredictions.take(5).last()) {
                                HorizontalDivider(color = Color(0xFFEEEEEE))
                            }
                        }
                    }
                }
            }
        }

        // Contact Email
        OutlinedTextField(
            value = contactEmail,
            onValueChange = { contactEmail = it; emailError = null },
            label = { Text("Contact Email *") },
            isError = emailError != null,
            supportingText = emailError?.let { { Text(it) } },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )

        // Website (optional)
        OutlinedTextField(
            value = websiteUrl,
            onValueChange = { websiteUrl = it },
            label = { Text("Website (optional)") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )

        // Business street address (optional) — Google Places autocomplete; server geocodes for map distance on ads
        Column {
            OutlinedTextField(
                value = businessAddress,
                onValueChange = { newValue ->
                    businessAddress = newValue
                    businessAddressFromPicker = false
                    addressError = null
                    if (newValue.length >= 3) {
                        scope.launch {
                            try {
                                addressPredictions = playgroundService.autocompleteLocation(newValue)
                            } catch (_: Exception) {
                                addressPredictions = emptyList()
                            }
                        }
                    } else {
                        addressPredictions = emptyList()
                    }
                },
                label = { Text("Business street address (optional)") },
                placeholder = { Text("Start typing — pick from suggestions") },
                isError = addressError != null,
                supportingText = addressError?.let { { Text(it) } },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            if (addressPredictions.isNotEmpty() && !businessAddressFromPicker) {
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = Color.White,
                    tonalElevation = 4.dp,
                    shadowElevation = 4.dp,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column {
                        addressPredictions.take(8).forEach { prediction ->
                            Text(
                                prediction.description,
                                fontSize = 14.sp,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable {
                                        businessAddress = prediction.description
                                        addressPredictions = emptyList()
                                        businessAddressFromPicker = true
                                        addressError = null
                                    }
                                    .padding(horizontal = 12.dp, vertical = 10.dp),
                                color = Color(0xFF212121),
                            )
                            if (prediction != addressPredictions.take(8).last()) {
                                HorizontalDivider(color = Color(0xFFEEEEEE))
                            }
                        }
                    }
                }
            }
        }

        // Description (optional)
        OutlinedTextField(
            value = description,
            onValueChange = { description = it },
            label = { Text("Description (optional)") },
            minLines = 3,
            modifier = Modifier.fillMaxWidth(),
        )

        } // Column inside Card
        } // Card

        // Error banner
        errorMessage?.let {
            Text(it, color = FormColors.ErrorText, fontSize = 13.sp)
        }

        Spacer(Modifier.height(8.dp))

        // Submit button
        Button(
            onClick = {
                if (!validate()) return@Button
                scope.launch {
                    isLoading = true
                    errorMessage = null
                    try {
                        val submission = playgroundService.createSubmission(
                            businessName = businessName.trim(),
                            category = selectedCategory,
                            city = city.trim(),
                            state = state.trim(),
                            contactEmail = contactEmail.trim(),
                            websiteUrl = websiteUrl.trim().ifBlank { null },
                            description = description.trim().ifBlank { null },
                            businessAddress = businessAddress.trim().ifBlank { null },
                        )
                        val regionKey = "${city.trim().lowercase().replace(Regex("\\s+"), "-")}-${state.trim().lowercase()}"
                        onSubmissionCreated(submission._id, regionKey)
                    } catch (e: Exception) {
                        errorMessage = e.message ?: "Something went wrong. Please try again."
                    } finally {
                        isLoading = false
                    }
                }
            },
            enabled = !isLoading,
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp),
            shape = RoundedCornerShape(16.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = FormColors.PrimaryButton,
                contentColor = FormColors.PrimaryButtonText,
            ),
        ) {
            if (isLoading) {
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
