package org.community.playgroundfinder.ui.screens.advertiser

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.community.playgroundfinder.data.PlaygroundService

@Composable
fun AdvertiserIntakeScreen(
    service: PlaygroundService,
    onComplete: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var businessName by remember { mutableStateOf("") }
    var contactEmail by remember { mutableStateOf("") }
    var category by remember { mutableStateOf("") }
    var city by remember { mutableStateOf("") }
    var websiteUrl by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    var isLoading by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var successMessage by remember { mutableStateOf<String?>(null) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text("Advertise with Us", fontSize = 22.sp, fontWeight = FontWeight.Bold)
        Text(
            "Reach families in your area. Fill out the form below and our team will be in touch.",
            fontSize = 14.sp
        )

        OutlinedTextField(
            value = businessName,
            onValueChange = { businessName = it; errorMessage = null },
            label = { Text("Business Name *") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true
        )
        OutlinedTextField(
            value = contactEmail,
            onValueChange = { contactEmail = it; errorMessage = null },
            label = { Text("Contact Email *") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true
        )
        OutlinedTextField(
            value = category,
            onValueChange = { category = it; errorMessage = null },
            label = { Text("Category (e.g. Restaurant, Toy Store) *") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true
        )
        OutlinedTextField(
            value = city,
            onValueChange = { city = it; errorMessage = null },
            label = { Text("City / Region *") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true
        )
        OutlinedTextField(
            value = websiteUrl,
            onValueChange = { websiteUrl = it },
            label = { Text("Website URL (optional)") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true
        )
        OutlinedTextField(
            value = description,
            onValueChange = { if (it.length <= 300) description = it },
            label = { Text("Description (max 300 chars)") },
            modifier = Modifier.fillMaxWidth(),
            minLines = 3,
            maxLines = 5,
            supportingText = { Text("${description.length}/300") }
        )

        errorMessage?.let {
            Text(it, color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
        }
        successMessage?.let {
            Text(it, color = MaterialTheme.colorScheme.primary, fontSize = 13.sp, fontWeight = FontWeight.Bold)
        }

        Button(
            onClick = {
                if (businessName.isBlank() || contactEmail.isBlank() || category.isBlank() || city.isBlank()) {
                    errorMessage = "Please fill in all required fields."
                    return@Button
                }
                scope.launch {
                    isLoading = true
                    errorMessage = null
                    try {
                        service.submitAdvertiserIntake(
                            businessName = businessName,
                            contactEmail = contactEmail,
                            category = category,
                            city = city,
                            websiteUrl = websiteUrl.ifBlank { null },
                            description = description.ifBlank { null },
                        )
                        successMessage = "Thanks! We'll be in touch soon."
                    } catch (e: Exception) {
                        errorMessage = "Submission failed. Please try again."
                    } finally {
                        isLoading = false
                    }
                }
            },
            enabled = !isLoading && successMessage == null,
            modifier = Modifier.fillMaxWidth().height(52.dp),
            shape = RoundedCornerShape(16.dp)
        ) {
            if (isLoading) CircularProgressIndicator(modifier = Modifier.size(20.dp))
            else Text(if (successMessage != null) "Submitted" else "Submit", fontWeight = FontWeight.Bold)
        }

        if (successMessage != null) {
            TextButton(onClick = onComplete, modifier = Modifier.fillMaxWidth()) {
                Text("Back to Home")
            }
        }
    }
}
