package org.community.playgroundfinder.ui.screens.account

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
 * Single place for signed-in account basics: email display, password reset, contributor display name,
 * and a path to account deletion / email-change help via support.
 */
@Composable
fun AccountProfileScreen(
    service: PlaygroundService,
    /** Sign-in email from Firebase (Android); may be null for some providers. */
    userEmail: String?,
    /** Fire-and-forget password reset (platform provides Firebase). No-op when null. */
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
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text(
            "Account",
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
            color = FormColors.BodyText,
        )
        Text(
            "Update how you appear on leaderboards, reset your password, or get help with email and account deletion.",
            fontSize = 13.sp,
            color = Color(0xFF757575),
            lineHeight = 18.sp,
        )

        Text("Points & activity", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = FormColors.BodyText)
        when {
            contributorLoading -> {
                CircularProgressIndicator(
                    modifier = Modifier.size(28.dp),
                    strokeWidth = 2.dp,
                    color = FormColors.PrimaryButton,
                )
            }
            contributorLoadError != null -> {
                Text(
                    contributorLoadError!!,
                    fontSize = 13.sp,
                    color = Color(0xFFE53935),
                    lineHeight = 18.sp,
                )
            }
            contributor != null -> {
                val c = contributor!!
                Text(
                    "You earn points when playground photos and edits are approved. Rank compares you to others in the same area.",
                    fontSize = 12.sp,
                    color = Color(0xFF757575),
                    lineHeight = 16.sp,
                )
                Text(
                    "${c.score} points · ${c.level}" +
                        (c.regionKey?.let { " · #${c.rank} in area" } ?: " · #${c.rank} overall"),
                    fontSize = 15.sp,
                    color = FormColors.BodyText,
                    lineHeight = 20.sp,
                )
                if (c.adFree) {
                    Text("Ad-free app unlocked", fontSize = 12.sp, color = Color(0xFF2E7D32))
                }
                c.contributions?.let { t ->
                    Text("Approved contributions", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = FormColors.BodyText, modifier = Modifier.padding(top = 4.dp))
                    Text(
                        "Photos ${t.photos} · New places ${t.newPlaygrounds} · Edits ${t.edits} · " +
                            "Reports ${t.reports} · Suggestions ${t.suggestions} · Total ${t.total}",
                        fontSize = 13.sp,
                        color = Color(0xFF616161),
                        lineHeight = 18.sp,
                    )
                }
                c.supportTickets?.let { s ->
                    Text("Support & suggestions to the team", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = FormColors.BodyText, modifier = Modifier.padding(top = 6.dp))
                    Text(
                        "Pending review ${s.pending} · Resolved ${s.resolved} · Not accepted ${s.rejected} · All ${s.total}",
                        fontSize = 13.sp,
                        color = Color(0xFF616161),
                        lineHeight = 18.sp,
                    )
                }
                OutlinedButton(
                    onClick = onNavigateToMySubmissions,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 4.dp),
                ) {
                    Text("View my submissions in review")
                }
            }
        }

        Text("Sign-in email", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = FormColors.BodyText)
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
            ) {
                Text("Send password reset email")
            }
            resetHint?.let {
                Text(it, fontSize = 12.sp, color = Color(0xFF2E7D32), lineHeight = 16.sp)
            }
        }

        Text("Contributor display name", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = FormColors.BodyText)
        Text(
            "Letters only, 2–30 characters. Shown on leaderboards when you contribute.",
            fontSize = 12.sp,
            color = Color(0xFF757575),
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
        )
        val preview = normalizeContributorDisplayName(displayNameInput)
        if (isValidContributorNameFormat(displayNameInput)) {
            Text("Will display as: $preview", fontSize = 12.sp, color = Color(0xFF2E7D32))
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
                Text("Save display name")
            }
        }

        Spacer(Modifier.height(8.dp))

        Text("Email changes & account deletion", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = FormColors.BodyText)
        Text(
            "To change the email on your account, delete your account, or get other account help, contact support " +
                "(${MarketingLinks.SUPPORT_EMAIL}).",
            fontSize = 13.sp,
            color = Color(0xFF616161),
            lineHeight = 18.sp,
        )
        OutlinedButton(onClick = onNavigateToAccountSupport, modifier = Modifier.fillMaxWidth()) {
            Text("Open account & support form")
        }
    }
}
