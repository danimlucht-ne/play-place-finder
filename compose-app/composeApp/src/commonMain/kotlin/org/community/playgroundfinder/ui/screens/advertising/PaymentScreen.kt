package org.community.playgroundfinder.ui.screens.advertising

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.graphics.Color
import kotlinx.coroutines.launch
import org.community.playgroundfinder.AppConfig
import org.community.playgroundfinder.isLiveStripePublishableKey
import org.community.playgroundfinder.data.PlaygroundService
import org.community.playgroundfinder.models.AdSubmission
import org.community.playgroundfinder.models.DiscountValidationResult
import org.community.playgroundfinder.ui.composables.FormColors

sealed interface PaymentResult {
    data object Success : PaymentResult
    data class Error(val message: String) : PaymentResult
    data object Cancelled : PaymentResult
}

private enum class PaymentState {
    Loading,
    Ready,
    Processing,
    Success,
    Error,
}

@Composable
fun PaymentScreen(
    playgroundService: PlaygroundService,
    submissionId: String,
    onConfirmPayment: (clientSecret: String) -> Unit,
    onPaymentComplete: () -> Unit,
    onBack: () -> Unit,
    onSubmissionWithdrawn: () -> Unit = {},
    paymentResult: PaymentResult? = null,
) {
    val scope = rememberCoroutineScope()

    var paymentState by remember { mutableStateOf(PaymentState.Loading) }
    var submission by remember { mutableStateOf<AdSubmission?>(null) }
    var clientSecret by remember { mutableStateOf<String?>(null) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    // Discount code state
    var discountCode by remember { mutableStateOf("") }
    var discountError by remember { mutableStateOf<String?>(null) }
    var discountResult by remember { mutableStateOf<DiscountValidationResult?>(null) }
    var isValidating by remember { mutableStateOf(false) }
    /** Bump to reload submission + PaymentIntent / SetupIntent (same as initial load). */
    var paymentReloadNonce by remember(submissionId) { mutableStateOf(0) }
    var showAbandonDialog by remember { mutableStateOf(false) }
    var abandonBusy by remember { mutableStateOf(false) }

    val discountCodeRef = rememberUpdatedState(discountCode)
    val discountResultRef = rememberUpdatedState(discountResult)

    // Fetch submission details and create payment intent on load / refresh
    LaunchedEffect(submissionId, paymentReloadNonce) {
        paymentState = PaymentState.Loading
        errorMessage = null
        try {
            val sub = playgroundService.getSubmission(submissionId)
            submission = sub
            val dr = discountResultRef.value
            val skipStripeForFullDiscount = dr != null &&
                dr.percentOff == 100 &&
                dr.discountedAmountInCents == 0 &&
                dr.originalAmountInCents > 0
            if (skipStripeForFullDiscount) {
                clientSecret = null
                paymentState = PaymentState.Ready
            } else {
                val appliedCode =
                    discountCodeRef.value.trim().takeIf { it.isNotEmpty() && discountResultRef.value != null }
                val intentData =
                    if (appliedCode != null) {
                        playgroundService.createPaymentIntent(submissionId, appliedCode)
                    } else {
                        playgroundService.createPaymentIntent(submissionId)
                    }
                if (intentData.freeCheckout) {
                    clientSecret = null
                    paymentState = PaymentState.Ready
                } else {
                    val secret = intentData.clientSecret.trim()
                    if (secret.isEmpty()) {
                        errorMessage =
                            "Payment did not return a client secret. On the server set STRIPE_SECRET_KEY (Dashboard → Developers → API keys, secret key) and restart. The app needs STRIPE_PUBLISHABLE_KEY in local.properties (matching test vs live)."
                        paymentState = PaymentState.Error
                    } else {
                        clientSecret = secret
                        paymentState = PaymentState.Ready
                    }
                }
            }
        } catch (e: Exception) {
            errorMessage = e.message ?: "Failed to initialize payment"
            paymentState = PaymentState.Error
        }
    }

    // React to payment result from the platform-specific Stripe SDK callback
    LaunchedEffect(paymentResult) {
        when (paymentResult) {
            is PaymentResult.Success -> {
                paymentState = PaymentState.Success
            }
            is PaymentResult.Error -> {
                errorMessage = paymentResult.message
                paymentState = PaymentState.Error
            }
            is PaymentResult.Cancelled -> {
                errorMessage = "Payment was cancelled."
                paymentState = PaymentState.Ready
            }
            null -> { /* no-op */ }
        }
    }

    // If Stripe webhooks never hit the API (common on localhost), capture + validation won’t run — sync from the client.
    LaunchedEffect(paymentState, submissionId) {
        if (paymentState == PaymentState.Success) {
            runCatching { playgroundService.reconcileAdPaymentAfterCheckout(submissionId) }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (showAbandonDialog) {
            val sub = submission
            val isDraft = sub?.status == "draft"
            AlertDialog(
                onDismissRequest = { if (!abandonBusy) showAbandonDialog = false },
                title = { Text(if (isDraft) "Delete this submission?" else "Withdraw this submission?") },
                text = {
                    Text(
                        if (isDraft) {
                            "This removes your draft. You have not completed payment. You can start a new ad anytime."
                        } else {
                            "We will cancel this submission. If you already paid, refunds are not guaranteed; contact support if needed."
                        },
                        fontSize = 14.sp,
                    )
                },
                confirmButton = {
                    Button(
                        onClick = {
                            scope.launch {
                                abandonBusy = true
                                try {
                                    if (isDraft) {
                                        playgroundService.deleteDraftSubmission(submissionId)
                                    } else {
                                        playgroundService.prelaunchCancelSubmission(submissionId)
                                    }
                                    showAbandonDialog = false
                                    onSubmissionWithdrawn()
                                } catch (e: Exception) {
                                    errorMessage = e.message ?: "Could not cancel submission"
                                }
                                abandonBusy = false
                            }
                        },
                        enabled = !abandonBusy,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = Color(0xFFC62828),
                            contentColor = Color.White,
                        ),
                    ) {
                        if (abandonBusy) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(18.dp),
                                strokeWidth = 2.dp,
                                color = Color.White,
                            )
                        } else {
                            Text(if (isDraft) "Delete" else "Withdraw")
                        }
                    }
                },
                dismissButton = {
                    TextButton(onClick = { showAbandonDialog = false }, enabled = !abandonBusy) {
                        Text("Keep")
                    }
                },
            )
        }

        Text(
            "Review your order and complete payment to submit your ad.",
            fontSize = 14.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        if (isLiveStripePublishableKey(AppConfig.stripePublishableKey)) {
            Spacer(Modifier.height(10.dp))
            Surface(
                shape = RoundedCornerShape(12.dp),
                color = Color(0xFFFFEBEE),
                tonalElevation = 0.dp,
                shadowElevation = 0.dp,
            ) {
                Text(
                    "Live payments: cards are charged for real. Stripe test cards (4242…) only work with a test key (pk_test…). " +
                        "Your server must use matching live secret keys and webhooks.",
                    fontSize = 13.sp,
                    color = Color(0xFFB71C1C),
                    lineHeight = 18.sp,
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
                )
            }
        }

        Spacer(Modifier.height(4.dp))

        when (paymentState) {
            PaymentState.Loading -> {
                Box(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 48.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator()
                }
            }

            PaymentState.Ready, PaymentState.Processing -> {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End,
                ) {
                    TextButton(
                        onClick = { paymentReloadNonce++ },
                        enabled = paymentState == PaymentState.Ready && !isValidating,
                    ) {
                        Text("Refresh payment")
                    }
                }
                val sub = submission
                if (sub?.`package` != null) {
                    PackageSummaryCard(sub, discountResult)
                }

                Spacer(Modifier.height(8.dp))

                // Discount code input section
                DiscountCodeSection(
                    discountCode = discountCode,
                    onDiscountCodeChange = { discountCode = it },
                    discountError = discountError,
                    discountResult = discountResult,
                    isValidating = isValidating,
                    enabled = paymentState == PaymentState.Ready,
                    onApply = {
                        if (discountCode.isBlank()) return@DiscountCodeSection
                        scope.launch {
                            isValidating = true
                            discountError = null
                            discountResult = null
                            try {
                                val result = playgroundService.validateDiscountCode(
                                    discountCode.trim(),
                                    submissionId,
                                )
                                discountResult = result
                                paymentReloadNonce++
                            } catch (e: Exception) {
                                discountError = e.message ?: "Failed to validate code"
                            } finally {
                                isValidating = false
                            }
                        }
                    },
                )

                Spacer(Modifier.height(8.dp))

                // Error banner (e.g. after a cancelled attempt)
                errorMessage?.let {
                    Text(it, color = FormColors.ErrorText, fontSize = 13.sp)
                }

                // True 100% off only — never treat $0 totals or 0% codes as "free checkout"
                val dr = discountResult
                val isFreeSubmission = dr != null &&
                    dr.percentOff == 100 &&
                    dr.discountedAmountInCents == 0 &&
                    dr.originalAmountInCents > 0

                // Payment / Complete Submission button
                Button(
                    onClick = {
                        paymentState = PaymentState.Processing
                        errorMessage = null
                        if (isFreeSubmission) {
                            // 100% discount — skip Stripe, complete free submission
                            scope.launch {
                                try {
                                    playgroundService.completeFreeSubmission(
                                        submissionId,
                                        discountCode.trim(),
                                    )
                                    paymentState = PaymentState.Success
                                } catch (e: Exception) {
                                    errorMessage = e.message ?: "Failed to complete submission"
                                    paymentState = PaymentState.Error
                                }
                            }
                        } else if (discountResult != null) {
                            // Partial discount — re-create payment intent with discount code
                            scope.launch {
                                try {
                                    val intentData = playgroundService.createPaymentIntent(
                                        submissionId,
                                        discountCode.trim(),
                                    )
                                    clientSecret = intentData.clientSecret
                                    onConfirmPayment(intentData.clientSecret)
                                } catch (e: Exception) {
                                    errorMessage = e.message ?: "Failed to create payment"
                                    paymentState = PaymentState.Error
                                }
                            }
                        } else {
                            // No discount — use existing client secret
                            val secret = clientSecret?.trim()?.takeIf { it.isNotEmpty() } ?: return@Button
                            onConfirmPayment(secret)
                        }
                    },
                    enabled = paymentState == PaymentState.Ready &&
                        (isFreeSubmission || !clientSecret.isNullOrBlank()),
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(52.dp),
                    shape = RoundedCornerShape(16.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = FormColors.PrimaryButton,
                        contentColor = FormColors.PrimaryButtonText,
                    ),
                ) {
                    if (paymentState == PaymentState.Processing) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(20.dp),
                            color = FormColors.PrimaryButtonText,
                            strokeWidth = 2.dp,
                        )
                    } else if (isFreeSubmission) {
                        Text("Complete Submission", fontWeight = FontWeight.Bold)
                    } else {
                        val sub = submission
                        val displayPrice = discountResult?.discountedAmountInCents
                            ?: if (sub != null && sub.totalPriceInCents > 0) sub.totalPriceInCents
                            else sub?.`package`?.priceInCents
                        val priceText = displayPrice?.let { formatPrice(it) } ?: ""
                        Text(if (priceText.isNotBlank()) "Pay $priceText" else "Pay Now", fontWeight = FontWeight.Bold)
                    }
                }

                Spacer(Modifier.height(8.dp))
                TextButton(
                    onClick = { showAbandonDialog = true },
                    enabled = paymentState == PaymentState.Ready,
                ) {
                    Text(
                        if (submission?.status == "draft") "Delete submission (leave without paying)"
                        else "Cancel submission",
                        color = Color(0xFFC62828),
                        fontSize = 14.sp,
                    )
                }
            }

            PaymentState.Success -> {
                SuccessContent(onPaymentComplete)
            }

            PaymentState.Error -> {
                ErrorContent(
                    errorMessage = errorMessage ?: "An unexpected error occurred.",
                    onLeaveSubmission = { showAbandonDialog = true },
                    onRetry = {
                        // Re-attempt: if we already have a clientSecret, go back to Ready
                        if (!clientSecret.isNullOrBlank()) {
                            errorMessage = null
                            paymentState = PaymentState.Ready
                        } else {
                            val dr = discountResult
                            val isFreeCheckout = dr != null &&
                                dr.percentOff == 100 &&
                                dr.discountedAmountInCents == 0 &&
                                dr.originalAmountInCents > 0 &&
                                discountCode.isNotBlank()
                            if (isFreeCheckout) {
                                scope.launch {
                                    paymentState = PaymentState.Processing
                                    errorMessage = null
                                    try {
                                        playgroundService.completeFreeSubmission(
                                            submissionId,
                                            discountCode.trim(),
                                        )
                                        paymentState = PaymentState.Success
                                    } catch (e: Exception) {
                                        errorMessage = e.message ?: "Failed to complete submission"
                                        paymentState = PaymentState.Error
                                    }
                                }
                            } else {
                                scope.launch {
                                    paymentState = PaymentState.Loading
                                    errorMessage = null
                                    try {
                                        val sub = playgroundService.getSubmission(submissionId)
                                        submission = sub
                                        val appliedCode =
                                            discountCode.trim().takeIf { it.isNotEmpty() && discountResult != null }
                                        val intentData =
                                            if (appliedCode != null) {
                                                playgroundService.createPaymentIntent(submissionId, appliedCode)
                                            } else {
                                                playgroundService.createPaymentIntent(submissionId)
                                            }
                                        if (intentData.freeCheckout) {
                                            clientSecret = null
                                            paymentState = PaymentState.Ready
                                        } else {
                                            val s = intentData.clientSecret.trim()
                                            if (s.isEmpty()) {
                                                errorMessage =
                                                    "No client secret from server. Set STRIPE_SECRET_KEY on the API and restart."
                                                paymentState = PaymentState.Error
                                            } else {
                                                clientSecret = s
                                                paymentState = PaymentState.Ready
                                            }
                                        }
                                    } catch (e: Exception) {
                                        errorMessage = e.message ?: "Failed to initialize payment"
                                        paymentState = PaymentState.Error
                                    }
                                }
                            }
                        }
                    },
                )
            }
        }
    }
}


@Composable
private fun DiscountCodeSection(
    discountCode: String,
    onDiscountCodeChange: (String) -> Unit,
    discountError: String?,
    discountResult: DiscountValidationResult?,
    isValidating: Boolean,
    enabled: Boolean,
    onApply: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            OutlinedTextField(
                value = discountCode,
                onValueChange = onDiscountCodeChange,
                label = { Text("Discount Code") },
                singleLine = true,
                enabled = enabled && !isValidating,
                modifier = Modifier.weight(1f),
                shape = RoundedCornerShape(12.dp),
            )
            Button(
                onClick = onApply,
                enabled = enabled && !isValidating && discountCode.isNotBlank(),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = FormColors.PrimaryButton,
                    contentColor = FormColors.PrimaryButtonText,
                ),
            ) {
                if (isValidating) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(18.dp),
                        color = FormColors.PrimaryButtonText,
                        strokeWidth = 2.dp,
                    )
                } else {
                    Text("Apply")
                }
            }
        }

        // Validation error
        discountError?.let {
            Text(
                it,
                fontSize = 13.sp,
                color = FormColors.ErrorText,
            )
        }

        // Valid discount result
        discountResult?.let { result ->
            val msg = when {
                result.percentOff >= 100 -> "100% discount applied — no payment due"
                result.percentOff > 0 -> "${result.percentOff}% discount applied"
                else -> "Discount applied"
            }
            Text(
                msg,
                fontSize = 13.sp,
                fontWeight = FontWeight.Medium,
                color = FormColors.PrimaryButton,
            )
        }
    }
}


@Composable
private fun PackageSummaryCard(submission: AdSubmission, discountResult: DiscountValidationResult? = null) {
    val pkg = submission.`package` ?: return
    val packageName = when (pkg.type) {
        "featured_home" -> "Featured Home"
        "inline_listing" -> "Inline Listing"
        else -> pkg.type
    }
    val isEvent = pkg.type.startsWith("event_spotlight")
    val displayTotal = if (submission.totalPriceInCents > 0) submission.totalPriceInCents else pkg.priceInCents

    OutlinedCard(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.outlinedCardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f),
        ),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                "Order Summary",
                fontWeight = FontWeight.Bold,
                fontSize = 16.sp,
            )

            HorizontalDivider()

            SummaryRow("Package", packageName)
            if (!isEvent && submission.durationMonths > 1) {
                SummaryRow("Duration", submission.durationMonths.toString() + " months")
            } else {
                SummaryRow("Duration", pkg.durationDays.toString() + " days")
            }
            if (!isEvent && submission.discountPercent > 0) {
                SummaryRow("Discount", submission.discountPercent.toString() + "% off")
            }

            HorizontalDivider()

            if (discountResult != null) {
                // Show original price with strikethrough
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text(
                        "Original Price",
                        fontSize = 14.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        formatPrice(discountResult.originalAmountInCents),
                        fontSize = 14.sp,
                        textDecoration = TextDecoration.LineThrough,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                // Show discounted total
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text(
                        "Total",
                        fontWeight = FontWeight.Bold,
                        fontSize = 16.sp,
                    )
                    Text(
                        if (discountResult.discountedAmountInCents == 0) "FREE"
                        else formatPrice(discountResult.discountedAmountInCents),
                        fontWeight = FontWeight.Bold,
                        fontSize = 16.sp,
                        color = FormColors.PrimaryButton,
                    )
                }
            } else {
                // No discount code — show total from submission
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text(
                        "Total",
                        fontWeight = FontWeight.Bold,
                        fontSize = 16.sp,
                    )
                    Text(
                        formatPrice(displayTotal),
                        fontWeight = FontWeight.Bold,
                        fontSize = 16.sp,
                        color = FormColors.PrimaryButton,
                    )
                }
            }
        }
    }
}

@Composable
private fun SummaryRow(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(
            label,
            fontSize = 14.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            value,
            fontSize = 14.sp,
            fontWeight = FontWeight.Medium,
        )
    }
}


@Composable
private fun SuccessContent(onPaymentComplete: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(vertical = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("\u2713", fontSize = 48.sp, color = FormColors.PrimaryButton)

        Text(
            "Payment Successful",
            fontSize = 20.sp,
            fontWeight = FontWeight.Bold,
        )

        Text(
            "Your ad has been submitted for review. You'll be notified once it's approved.",
            fontSize = 14.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        Spacer(Modifier.height(16.dp))

        Button(
            onClick = onPaymentComplete,
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp),
            shape = RoundedCornerShape(16.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = FormColors.PrimaryButton,
                contentColor = FormColors.PrimaryButtonText,
            ),
        ) {
            Text("View Submission Status", fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun ErrorContent(
    errorMessage: String,
    onRetry: () -> Unit,
    onLeaveSubmission: (() -> Unit)? = null,
) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(vertical = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("\u2717", fontSize = 48.sp, color = FormColors.ErrorText)

        Text(
            "Payment Failed",
            fontSize = 20.sp,
            fontWeight = FontWeight.Bold,
        )

        Text(
            errorMessage,
            fontSize = 14.sp,
            color = FormColors.ErrorText,
        )

        Spacer(Modifier.height(16.dp))

        Button(
            onClick = onRetry,
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp),
            shape = RoundedCornerShape(16.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = FormColors.PrimaryButton,
                contentColor = FormColors.PrimaryButtonText,
            ),
        ) {
            Text("Try Again", fontWeight = FontWeight.Bold)
        }

        if (onLeaveSubmission != null) {
            TextButton(onClick = onLeaveSubmission) {
                Text("Delete submission / leave without paying", color = Color(0xFFC62828), fontSize = 14.sp)
            }
        }
    }
}

private fun formatPrice(cents: Int): String {
    val dollars = cents / 100
    val remainder = cents % 100
    val pad = remainder.toString().padStart(2, '0')
    return buildString {
        append('$')
        append(dollars)
        append('.')
        append(pad)
    }
}
