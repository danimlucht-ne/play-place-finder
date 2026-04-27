package org.community.playgroundfinder.ui.screens.account

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.community.playgroundfinder.data.ContributorProfile
import org.community.playgroundfinder.data.PlaygroundService
import org.community.playgroundfinder.ui.composables.FormColors
import org.community.playgroundfinder.util.MarketingLinks
import org.community.playgroundfinder.util.contributorDisplayNameValidationMessage
import org.community.playgroundfinder.util.isValidContributorNameFormat
import org.community.playgroundfinder.util.normalizeContributorDisplayName

/**
 * Signed-in account: contributor stats, display name, password reset, and support/deletion paths.
 */
@Composable
fun AccountProfileScreen(
    service: PlaygroundService,
    userEmail: String?,
    onSendPasswordReset: (() -> Unit)? = null,
    onNavigateToAccountSupport: () -> Unit,
    onNavigateToMySubmissions: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var displayNameInput by remember { mutableStateOf("") }
    var displayNameError by remember { mutableStateOf<String?>(null) }
    var displayNameSaving by remember { mutableStateOf(false) }
    var resetHint by remember { mutableStateOf<String?>(null) }
    var contributor by remember { mutableStateOf<ContributorProfile?>(null) }
    var contributorLoadError by remember { mutableStateOf<String?>(null) }
    var contributorLoading by remember { mutableStateOf(true) }

    LaunchedEffect(Unit) {
        contributorLoading = true
        contributorLoadError = null
        runCatching { service.getMyContributorProfile() }
            .onSuccess { profile ->
                contributor = profile
                displayNameInput = profile.displayName.orEmpty()
            }
            .onFailure { e -> contributorLoadError = e.message ?: "Could not load your profile" }
        contributorLoading = false
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(FormColors.ScreenBackground)
            .verticalScroll(rememberScrollState()),
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(5.dp)
                .background(FormColors.PrimaryButton),
        )
        Column(
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    "Account",
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold,
                    color = FormColors.BodyText,
                )
                Text(
                    "Your profile on leaderboards, password, and ways to get help.",
                    fontSize = 14.sp,
                    color = Color(0xFF757575),
                    lineHeight = 20.sp,
                )
            }

            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(20.dp),
                colors = CardDefaults.cardColors(containerColor = Color.White),
                elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
            ) {
                Column(
                    modifier = Modifier.padding(18.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Text(
                        "Points & activity",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = FormColors.BodyText,
                    )
                    when {
                        contributorLoading -> {
                            CircularProgressIndicator(
                                modifier = Modifier.size(32.dp),
                                strokeWidth = 2.dp,
                                color = FormColors.PrimaryButton,
                            )
                        }
                        contributorLoadError != null -> {
                            Text(
                                contributorLoadError!!,
                                fontSize = 14.sp,
                                color = Color(0xFFE53935),
                                lineHeight = 20.sp,
                            )
                        }
                        contributor != null -> {
                            val c = contributor!!
                            Text(
                                "Earn points when photos and edits are approved. Rank is for your area.",
                                fontSize = 13.sp,
                                color = Color(0xFF757575),
                                lineHeight = 18.sp,
                            )
                            Card(
                                modifier = Modifier.fillMaxWidth(),
                                shape = RoundedCornerShape(14.dp),
                                colors = CardDefaults.cardColors(containerColor = FormColors.PrimaryButton.copy(alpha = 0.1f)),
                            ) {
                                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                    Text(
                                        "${c.score} points",
                                        fontSize = 22.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = FormColors.PrimaryButton,
                                    )
                                    Text(
                                        "${c.level}" + (c.regionKey?.let { " · #${c.rank} in your area" } ?: " · #${c.rank} overall"),
                                        fontSize = 15.sp,
                                        fontWeight = FontWeight.Medium,
                                        color = FormColors.BodyText,
                                    )
                                }
                            }
                            if (c.adFree) {
                                Text("Ad-free app unlocked", fontSize = 13.sp, color = Color(0xFF2E7D32), fontWeight = FontWeight.Medium)
                            }
                            c.contributions?.let { t ->
                                Text(
                                    "Approved contributions",
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    color = FormColors.BodyText,
                                )
                                Text(
                                    "Photos ${t.photos} · New places ${t.newPlaygrounds} · Edits ${t.edits} · " +
                                        "Reports ${t.reports} · Suggestions ${t.suggestions}",
                                    fontSize = 14.sp,
                                    color = Color(0xFF616161),
                                    lineHeight = 20.sp,
                                )
                                Text(
                                    "Total ${t.total}",
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    color = FormColors.BodyText,
                                )
                            }
                            c.supportTickets?.let { s ->
                                Text(
                                    "With the team",
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    color = FormColors.BodyText,
                                    modifier = Modifier.padding(top = 4.dp),
                                )
                                Text(
                                    "Pending ${s.pending} · Resolved ${s.resolved} · Not accepted ${s.rejected} · All ${s.total}",
                                    fontSize = 14.sp,
                                    color = Color(0xFF616161),
                                    lineHeight = 20.sp,
                                )
                            }
                            OutlinedButton(
                                onClick = onNavigateToMySubmissions,
                                modifier = Modifier.fillMaxWidth(),
                                shape = RoundedCornerShape(12.dp),
                            ) {
                                Text("View my submissions", fontWeight = FontWeight.SemiBold)
                            }
                        }
                    }
                }
            }

            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(20.dp),
                colors = CardDefaults.cardColors(containerColor = Color.White),
                elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
            ) {
                Column(
                    modifier = Modifier.padding(18.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Text(
                        "Sign-in email",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = FormColors.BodyText,
                    )
                    Text(
                        userEmail?.ifBlank { "Not available for this sign-in method." } ?: "Not available for this sign-in method.",
                        fontSize = 15.sp,
                        color = if (userEmail.isNullOrBlank()) Color(0xFF9E9E9E) else FormColors.BodyText,
                    )
                    if (!userEmail.isNullOrBlank() && onSendPasswordReset != null) {
                        OutlinedButton(
                            onClick = {
                                resetHint = null
                                onSendPasswordReset()
                                resetHint = "If an account exists for this email, you will receive reset instructions shortly."
                            },
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(12.dp),
                        ) {
                            Text("Send password reset email")
                        }
                        resetHint?.let {
                            Text(it, fontSize = 13.sp, color = Color(0xFF2E7D32), lineHeight = 18.sp)
                        }
                    }
                }
            }

            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(20.dp),
                colors = CardDefaults.cardColors(containerColor = Color.White),
                elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
            ) {
                Column(
                    modifier = Modifier.padding(18.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Text(
                        "Contributor display name",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = FormColors.BodyText,
                    )
                    Text(
                        "Letters only, 2–30 characters. Shown on leaderboards when you contribute.",
                        fontSize = 13.sp,
                        color = Color(0xFF757575),
                        lineHeight = 18.sp,
                    )
                    OutlinedTextField(
                        value = displayNameInput,
                        onValueChange = {
                            if (it.length <= 30) displayNameInput = it
                        },
                        label = { Text("Display name") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        enabled = !displayNameSaving,
                        shape = RoundedCornerShape(12.dp),
                    )
                    val preview = normalizeContributorDisplayName(displayNameInput)
                    if (isValidContributorNameFormat(displayNameInput)) {
                        Text("Will show as: $preview", fontSize = 13.sp, color = Color(0xFF2E7D32), fontWeight = FontWeight.Medium)
                    }
                    displayNameError?.let { Text(it, color = Color(0xFFE53935), fontSize = 13.sp) }

                    Button(
                        onClick = {
                            scope.launch {
                                displayNameSaving = true
                                displayNameError = null
                                try {
                                    val normalized = normalizeContributorDisplayName(displayNameInput)
                                    if (!isValidContributorNameFormat(normalized)) {
                                        displayNameError = contributorDisplayNameValidationMessage()
                                        return@launch
                                    }
                                    service.setDisplayName(normalized)
                                } catch (e: Exception) {
                                    displayNameError = e.message ?: "Could not save display name"
                                } finally {
                                    displayNameSaving = false
                                }
                            }
                        },
                        enabled = isValidContributorNameFormat(displayNameInput) && !displayNameSaving,
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = FormColors.PrimaryButton,
                            contentColor = FormColors.PrimaryButtonText,
                        ),
                    ) {
                        if (displayNameSaving) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(20.dp),
                                strokeWidth = 2.dp,
                                color = FormColors.PrimaryButtonText,
                            )
                        } else {
                            Text("Save display name", fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
            }

            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(20.dp),
                colors = CardDefaults.cardColors(containerColor = Color.White),
                elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
            ) {
                Column(
                    modifier = Modifier.padding(18.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Text(
                        "Email changes & account deletion",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = FormColors.BodyText,
                    )
                    Text(
                        "To change the email on your account, delete your account, or get other help, contact us at ${MarketingLinks.SUPPORT_EMAIL}.",
                        fontSize = 14.sp,
                        color = Color(0xFF616161),
                        lineHeight = 20.sp,
                    )
                    OutlinedButton(
                        onClick = onNavigateToAccountSupport,
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                    ) {
                        Text("Account & support")
                    }
                }
            }

            Spacer(Modifier.height(8.dp))
        }
    }
}
