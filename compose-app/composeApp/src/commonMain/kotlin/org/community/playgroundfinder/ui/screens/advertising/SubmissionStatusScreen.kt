package org.community.playgroundfinder.ui.screens.advertising

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.community.playgroundfinder.data.PlaygroundService
import org.community.playgroundfinder.models.AdSubmission
import org.community.playgroundfinder.ui.composables.FormColors

@Composable
fun SubmissionStatusScreen(
    playgroundService: PlaygroundService,
    submissionId: String,
    onNavigateToDashboard: () -> Unit,
    onSubmissionRemoved: () -> Unit = {},
    onBack: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var submission by remember { mutableStateOf<AdSubmission?>(null) }
    var isLoading by remember { mutableStateOf(true) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var refreshNonce by remember { mutableStateOf(0) }
    var showDeleteDraftDialog by remember { mutableStateOf(false) }
    var showWithdrawDialog by remember { mutableStateOf(false) }
    var removalBusy by remember { mutableStateOf(false) }
    var removalError by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(submissionId, refreshNonce) {
        isLoading = true
        errorMessage = null
        try {
            var sub = playgroundService.getSubmission(submissionId)
            if (sub.status == "draft") {
                runCatching { playgroundService.reconcileAdPaymentAfterCheckout(submissionId) }
                sub = playgroundService.getSubmission(submissionId)
            }
            submission = sub
        } catch (e: Exception) {
            errorMessage = e.message ?: "Failed to load submission"
        }
        isLoading = false
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        if (showDeleteDraftDialog) {
            AlertDialog(
                onDismissRequest = { if (!removalBusy) showDeleteDraftDialog = false },
                title = { Text("Delete this submission?") },
                text = {
                    Text(
                        "This permanently removes your draft. You have not completed payment. You can start a new ad anytime.",
                        fontSize = 14.sp,
                    )
                },
                confirmButton = {
                    Button(
                        onClick = {
                            scope.launch {
                                removalBusy = true
                                removalError = null
                                try {
                                    playgroundService.deleteDraftSubmission(submissionId)
                                    showDeleteDraftDialog = false
                                    onSubmissionRemoved()
                                } catch (e: Exception) {
                                    removalError = e.message ?: "Delete failed"
                                }
                                removalBusy = false
                            }
                        },
                        enabled = !removalBusy,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = Color(0xFFC62828),
                            contentColor = Color.White,
                        ),
                    ) {
                        if (removalBusy) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(18.dp),
                                strokeWidth = 2.dp,
                                color = Color.White,
                            )
                        } else {
                            Text("Delete")
                        }
                    }
                },
                dismissButton = {
                    TextButton(onClick = { showDeleteDraftDialog = false }, enabled = !removalBusy) {
                        Text("Keep submission")
                    }
                },
            )
        }
        if (showWithdrawDialog) {
            AlertDialog(
                onDismissRequest = { if (!removalBusy) showWithdrawDialog = false },
                title = { Text("Withdraw this submission?") },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(
                            "We will cancel this submission and any scheduled ad tied to it before it goes live, if applicable.",
                            fontSize = 14.sp,
                        )
                        Text(
                            "If you already paid, refunds are not guaranteed for advertiser withdrawals; contact support if you believe you were charged in error.",
                            fontSize = 13.sp,
                            color = Color.DarkGray,
                        )
                    }
                },
                confirmButton = {
                    Button(
                        onClick = {
                            scope.launch {
                                removalBusy = true
                                removalError = null
                                try {
                                    playgroundService.prelaunchCancelSubmission(submissionId)
                                    showWithdrawDialog = false
                                    onSubmissionRemoved()
                                } catch (e: Exception) {
                                    removalError = e.message ?: "Withdraw failed"
                                }
                                removalBusy = false
                            }
                        },
                        enabled = !removalBusy,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = Color(0xFFC62828),
                            contentColor = Color.White,
                        ),
                    ) {
                        if (removalBusy) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(18.dp),
                                strokeWidth = 2.dp,
                                color = Color.White,
                            )
                        } else {
                            Text("Withdraw")
                        }
                    }
                },
                dismissButton = {
                    TextButton(onClick = { showWithdrawDialog = false }, enabled = !removalBusy) {
                        Text("Keep submission")
                    }
                },
            )
        }

        // Header
        Row(verticalAlignment = Alignment.CenterVertically) {
            // TextButton(onClick = onBack) { Text("← Back") }
        }

        // Status header removed — shown in TopAppBar

        when {
            isLoading -> {
                Box(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 48.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator()
                }
            }

            errorMessage != null -> {
                ErrorState(errorMessage!!) {
                    isLoading = true
                    errorMessage = null
                    // Retry is handled by re-triggering LaunchedEffect via key change
                }
            }

            submission != null -> {
                val sub = submission!!
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End,
                ) {
                    TextButton(onClick = { refreshNonce++ }) { Text("Refresh") }
                }
                StepProgressIndicator(currentStep = sub.currentStep)
                Spacer(Modifier.height(4.dp))
                CheckoutChecklistCard(sub)
                Spacer(Modifier.height(4.dp))
                SubmissionStatusBadge(status = sub.status)

                // Rejection reason
                if (sub.status == "rejected" && !sub.rejectionReason.isNullOrBlank()) {
                    RejectionReasonCard(sub.rejectionReason!!)
                }

                // Package info
                sub.`package`?.let { pkg ->
                    PackageInfoCard(pkg.type, pkg.priceInCents, pkg.durationDays)
                }

                // Dashboard link for active/completed campaigns
                if (sub.status == "active" || sub.status == "completed" || sub.status == "approved") {
                    Button(
                        onClick = onNavigateToDashboard,
                        modifier = Modifier.fillMaxWidth().height(52.dp),
                        shape = RoundedCornerShape(16.dp),
                    ) {
                        Text("View Dashboard", fontWeight = FontWeight.Bold)
                    }
                }

                // Status explanation
                StatusExplanation(sub.status)

                val noWithdrawStatuses = setOf("cancelled", "rejected", "completed", "active", "draft")
                val canDeleteDraft = sub.status == "draft"
                val canWithdraw = sub.status !in noWithdrawStatuses
                if (canDeleteDraft || canWithdraw) {
                    Spacer(Modifier.height(8.dp))
                    Text("Change your mind?", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                    Spacer(Modifier.height(6.dp))
                    if (canDeleteDraft) {
                        OutlinedButton(
                            onClick = { removalError = null; showDeleteDraftDialog = true },
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(12.dp),
                            colors = ButtonDefaults.outlinedButtonColors(contentColor = Color(0xFFC62828)),
                        ) {
                            Text("Delete submission (not paid yet)")
                        }
                    }
                    if (canWithdraw) {
                        OutlinedButton(
                            onClick = { removalError = null; showWithdrawDialog = true },
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(12.dp),
                            colors = ButtonDefaults.outlinedButtonColors(contentColor = Color(0xFFC62828)),
                        ) {
                            Text("Withdraw submission")
                        }
                    }
                    removalError?.let {
                        Text(it, color = FormColors.ErrorText, fontSize = 12.sp)
                    }
                }
            }
        }
    }
}

// ─── Terms / payment checklist (server truth: contractId, paidAt, paymentStatus, status)

private fun termsAccepted(sub: AdSubmission): Boolean =
    !sub.contractId.isNullOrBlank()

private fun checkoutComplete(sub: AdSubmission): Boolean {
    if (!sub.paidAt.isNullOrBlank()) return true
    when (sub.paymentStatus?.lowercase()) {
        "authorized", "captured", "payment_method_saved" -> return true
        else -> Unit
    }
    return sub.status.isNotBlank() && sub.status != "draft"
}

@Composable
private fun CheckoutChecklistCard(sub: AdSubmission) {
    val termsOk = termsAccepted(sub)
    val payOk = checkoutComplete(sub)
    OutlinedCard(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text("Submission checklist", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
            ChecklistRow("Terms accepted", termsOk)
            ChecklistRow("Payment / card on file", payOk)
        }
    }
}

@Composable
private fun ChecklistRow(label: String, done: Boolean) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(
            if (done) "✓" else "○",
            fontSize = 16.sp,
            color = if (done) FormColors.PrimaryButton else Color.Gray,
        )
        Text(
            label,
            fontSize = 14.sp,
            color = if (done) MaterialTheme.colorScheme.onSurface else Color.Gray,
        )
    }
}

// ─── Step Progress Indicator ─────────────────────────────────────────────────

private val STEP_LABELS = listOf(
    "Business Info",
    "Package",
    "Creative",
    "Preview",
    "Terms",
    "Payment",
)

@Composable
private fun StepProgressIndicator(currentStep: Int) {
    OutlinedCard(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("Progress", fontWeight = FontWeight.Bold, fontSize = 16.sp)

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                for (step in 1..6) {
                    val isCompleted = step <= currentStep
                    val isCurrent = step == currentStep

                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        modifier = Modifier.weight(1f),
                    ) {
                        Box(
                            modifier = Modifier
                                .size(32.dp)
                                .clip(CircleShape)
                                .background(
                                    when {
                                        isCompleted -> MaterialTheme.colorScheme.primary
                                        else -> MaterialTheme.colorScheme.surfaceVariant
                                    }
                                ),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                if (step < currentStep) "✓" else step.toString(),
                                fontSize = 13.sp,
                                fontWeight = if (isCurrent) FontWeight.Bold else FontWeight.Normal,
                                color = if (isCompleted) MaterialTheme.colorScheme.onPrimary
                                        else MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Spacer(Modifier.height(4.dp))
                        Text(
                            STEP_LABELS[step - 1],
                            fontSize = 9.sp,
                            textAlign = TextAlign.Center,
                            maxLines = 1,
                            color = if (isCompleted) MaterialTheme.colorScheme.primary
                                    else Color.Gray,
                        )
                    }
                }
            }
        }
    }
}

// ─── Status Badge ────────────────────────────────────────────────────────────

@Composable
private fun SubmissionStatusBadge(status: String) {
    val (bgColor, textColor, label) = statusStyle(status)

    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("Status: ", fontSize = 15.sp, fontWeight = FontWeight.Medium)
        Surface(
            shape = RoundedCornerShape(20.dp),
            color = bgColor,
        ) {
            Text(
                label,
                fontSize = 13.sp,
                color = textColor,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
            )
        }
    }
}

private fun statusStyle(status: String): Triple<Color, Color, String> = when (status) {
    "draft" -> Triple(Color(0xFFF5F5F5), Color(0xFF757575), "Draft")
    "paid" -> Triple(FormColors.FilterBannerBackground, FormColors.PrimaryButton, "Paid — processing")
    "approved" -> Triple(Color(0xFFE8F5E9), Color(0xFF2E7D32), "Approved")
    "approved_pending_charge" -> Triple(Color(0xFFE3F2FD), Color(0xFF1565C0), "Payment pending final charge")
    "manual_review" -> Triple(Color(0xFFFFF3E0), Color(0xFFE65100), "Under review")
    "rejected" -> Triple(Color(0xFFFFEBEE), Color(0xFFC62828), "Rejected")
    "active" -> Triple(Color(0xFFE8F5E9), Color(0xFF2E7D32), "Active")
    "completed" -> Triple(Color(0xFFF5F5F5), Color(0xFF616161), "Completed")
    else -> Triple(Color(0xFFF5F5F5), Color(0xFF757575), status.replaceFirstChar { it.uppercase() })
}

// ─── Rejection Reason ────────────────────────────────────────────────────────

@Composable
private fun RejectionReasonCard(reason: String) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = Color(0xFFFFEBEE)),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text("Rejection Reason", fontWeight = FontWeight.Bold, fontSize = 14.sp, color = Color(0xFFC62828))
            Spacer(Modifier.height(4.dp))
            Text(reason, fontSize = 13.sp, color = Color(0xFF8B0000))
        }
    }
}

// ─── Package Info ────────────────────────────────────────────────────────────

@Composable
private fun PackageInfoCard(type: String, priceInCents: Int, durationDays: Int) {
    val packageName = when (type) {
        "featured_home" -> "Featured Home"
        "inline_listing" -> "Inline Listing"
        else -> type
    }
    val dollars = priceInCents / 100
    val cents = (priceInCents % 100).toString().padStart(2, '0')

    OutlinedCard(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
    ) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("Package", fontWeight = FontWeight.Bold, fontSize = 14.sp)
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("Type", fontSize = 13.sp, color = Color.Gray)
                Text(packageName, fontSize = 13.sp, fontWeight = FontWeight.Medium)
            }
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("Price", fontSize = 13.sp, color = Color.Gray)
                Text("$$dollars.$cents", fontSize = 13.sp, fontWeight = FontWeight.Medium)
            }
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("Duration", fontSize = 13.sp, color = Color.Gray)
                Text("$durationDays days", fontSize = 13.sp, fontWeight = FontWeight.Medium)
            }
        }
    }
}

// ─── Status Explanation ──────────────────────────────────────────────────────

@Composable
private fun StatusExplanation(status: String) {
    val explanation = when (status) {
        "draft" -> "Your submission is in progress. Complete all steps to submit."
        "paid" -> "Payment was received. Your ad is moving through automated checks or review."
        "approved" -> "Your ad has been approved and will go live shortly."
        "approved_pending_charge" -> "Your card is authorized. The final charge may run at campaign start, or refresh this screen in a moment if checkout just finished."
        "manual_review" -> "Your ad is being reviewed by our team. This usually takes 1–2 business days."
        "rejected" -> "Your ad was not approved. A refund will be processed automatically."
        "active" -> "Your ad is live! Open My Campaigns for performance metrics."
        "completed" -> "Your campaign has ended. View the dashboard for final results."
        else -> null
    }
    explanation?.let {
        Text(it, fontSize = 13.sp, color = Color.Gray)
    }
}

// ─── Error State ─────────────────────────────────────────────────────────────

@Composable
private fun ErrorState(message: String, onRetry: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(vertical = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("⚠️", fontSize = 48.sp)
        Text(message, fontSize = 14.sp, color = MaterialTheme.colorScheme.error, textAlign = TextAlign.Center)
        TextButton(onClick = onRetry) { Text("Retry") }
    }
}
