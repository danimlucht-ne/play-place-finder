package org.community.playgroundfinder.ui.screens

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
import org.community.playgroundfinder.ui.composables.FormColors

private data class TicketCategory(val key: String, val label: String)

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SupportTicketScreen(
    service: PlaygroundService,
    initialPlaceId: String? = null,
    initialTicketType: String? = null,
    onComplete: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var ticketType by remember { mutableStateOf(initialTicketType ?: "GENERAL") }
    var message by remember { mutableStateOf("") }
    var isLoading by remember { mutableStateOf(false) }
    var submitted by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var showDeleteConfirm by remember { mutableStateOf(false) }
    var isDeletingAccount by remember { mutableStateOf(false) }
    var deleteError by remember { mutableStateOf<String?>(null) }

    val categories = listOf(
        TicketCategory("GENERAL", "General Question"),
        TicketCategory("CONTENT_ISSUE", "Playground Issue"),
        TicketCategory("AD_INQUIRY", "Advertising"),
        TicketCategory("ACCOUNT", "My Account"),
        TicketCategory("BUG", "Report a Bug"),
    )

    if (submitted) {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Text("✅", fontSize = 40.sp)
                Text("Thank you! Your message has been sent.", fontWeight = FontWeight.SemiBold)
                Text("We'll get back to you as soon as possible.", fontSize = 13.sp, color = Color.Gray)
                Button(
                    onClick = onComplete,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = FormColors.PrimaryButton,
                        contentColor = FormColors.PrimaryButtonText,
                    ),
                ) { Text("Back to Home") }
            }
        }
        return
    }

    // Delete account confirmation dialog
    if (showDeleteConfirm) {
        AlertDialog(
            onDismissRequest = { if (!isDeletingAccount) showDeleteConfirm = false },
            title = { Text("Delete account?", color = Color(0xFFE53935)) },
            text = {
                Text("This will permanently delete your account, favorites, lists, and all associated data. This cannot be undone.")
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        scope.launch {
                            isDeletingAccount = true
                            deleteError = null
                            try {
                                service.deleteAccount()
                                // After deletion, navigate back — the auth state change will redirect to login
                                onComplete()
                            } catch (e: Exception) {
                                deleteError = e.message ?: "Failed to delete account"
                                isDeletingAccount = false
                            }
                        }
                    },
                    enabled = !isDeletingAccount
                ) {
                    if (isDeletingAccount) CircularProgressIndicator(modifier = Modifier.size(16.dp))
                    else Text("Delete permanently", color = Color(0xFFE53935))
                }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteConfirm = false }, enabled = !isDeletingAccount) {
                    Text("Cancel")
                }
            }
        )
    }

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text("How can we help?", fontWeight = FontWeight.Bold, fontSize = 20.sp)
        Text("Choose a category and tell us what's on your mind.", fontSize = 14.sp, color = Color.Gray)

        Spacer(Modifier.height(4.dp))

        Text("Category", fontWeight = FontWeight.SemiBold)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            categories.forEach { cat ->
                FilterChip(
                    selected = ticketType == cat.key,
                    onClick = { ticketType = cat.key },
                    label = { Text(cat.label, fontSize = 13.sp) },
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = FormColors.SelectedChip,
                        selectedLabelColor = FormColors.SelectedChipText,
                    ),
                )
            }
        }

        // Context hint based on selected category
        val hint = when (ticketType) {
            "GENERAL" -> "Ask us anything about the app or how it works."
            "CONTENT_ISSUE" -> "Tell us about incorrect info, missing places, or content concerns."
            "AD_INQUIRY" -> "Questions about advertising, pricing, or your ad campaigns."
            "ACCOUNT" -> "Issues with your account, login, or profile."
            "BUG" -> "Describe what happened, what you expected, and any steps to reproduce."
            else -> ""
        }
        if (hint.isNotBlank()) {
            Text(hint, fontSize = 12.sp, color = FormColors.PrimaryButton)
        }

        OutlinedTextField(
            value = message,
            onValueChange = { message = it },
            label = { Text("Message *") },
            modifier = Modifier.fillMaxWidth(),
            minLines = 5
        )

        error?.let { Text(it, color = FormColors.ErrorText) }

        Button(
            onClick = {
                scope.launch {
                    isLoading = true
                    error = null
                    try {
                        service.submitSupportTicket(
                            ticketType = ticketType,
                            message = message,
                            targetKind = if (initialPlaceId != null) "playground" else null,
                            targetId = initialPlaceId
                        )
                        submitted = true
                    } catch (e: Exception) {
                        error = "Failed to send. Please try again."
                    } finally {
                        isLoading = false
                    }
                }
            },
            enabled = !isLoading && message.isNotBlank(),
            modifier = Modifier.fillMaxWidth().height(52.dp),
            shape = RoundedCornerShape(16.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = FormColors.PrimaryButton,
                contentColor = FormColors.PrimaryButtonText,
            ),
        ) {
            if (isLoading) CircularProgressIndicator(modifier = Modifier.size(20.dp), color = FormColors.PrimaryButtonText)
            else Text("Send Message", fontWeight = FontWeight.Bold)
        }

        // Delete account section
        Spacer(Modifier.height(24.dp))
        HorizontalDivider(color = Color(0xFFE0E0E0))
        Spacer(Modifier.height(8.dp))

        deleteError?.let { Text(it, color = FormColors.ErrorText, fontSize = 13.sp) }

        TextButton(
            onClick = { showDeleteConfirm = true },
            modifier = Modifier.fillMaxWidth()
        ) {
            Text("Delete my account", color = Color(0xFFE53935), fontSize = 13.sp)
        }
    }
}
