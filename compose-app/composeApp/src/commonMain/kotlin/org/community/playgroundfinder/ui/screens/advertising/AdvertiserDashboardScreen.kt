package org.community.playgroundfinder.ui.screens.advertising

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import kotlinx.coroutines.launch
import org.community.playgroundfinder.data.CampaignAnalyticsData
import org.community.playgroundfinder.data.PlaygroundService
import org.community.playgroundfinder.models.AdCampaignStats
import org.community.playgroundfinder.ui.composables.AdIndicatorPill
import org.community.playgroundfinder.ui.composables.EventBadgePill
import org.community.playgroundfinder.ui.composables.FormColors
import org.community.playgroundfinder.models.CampaignCreativePreview
import org.community.playgroundfinder.util.MarketingLinks
import org.community.playgroundfinder.util.rememberOpenExternalUrl
import org.community.playgroundfinder.ui.composables.eventBodyTextForDisplay
import org.community.playgroundfinder.ui.composables.formatEventDateReadableLine
import org.community.playgroundfinder.ui.composables.HomeDiscoverFeaturedAdSplitMinRowHeight

/** Strong outline so campaign rows and detail blocks read clearly on light backgrounds. */
private val DashboardOutlineColor = Color(0xFF2C2C2C)
private val DashboardOutlineWidth = 1.5.dp

@Composable
fun AdvertiserDashboardScreen(
    playgroundService: PlaygroundService,
    /** Optional: when set, dashboard may open focused to a single campaign id. */
    soloCampaignId: String? = null,
    /** Optional: callback for switching from focused campaign to full list. */
    onViewAllCampaigns: () -> Unit = {},
    onNavigateToAdvertise: () -> Unit = {},
    onRenew: (submissionId: String, regionKey: String) -> Unit = { _, _ -> },
    onBack: () -> Unit,
    /** Android: opens gallery + crop, then uploads and PATCHes creative `imageUrl`. */
    onPickCreativeImage: ((campaignId: String, submissionId: String) -> Unit)? = null,
    /** Incremented after a successful image replace so the dashboard can refresh previews. */
    externalReloadNonce: Int = 0,
) {
    val scope = rememberCoroutineScope()
    val openExternalUrl = rememberOpenExternalUrl()
    var campaigns by remember { mutableStateOf<List<AdCampaignStats>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    // Track which campaign is expanded and its analytics data
    var expandedCampaignId by remember { mutableStateOf<String?>(null) }
    var analyticsData by remember { mutableStateOf<Map<String, CampaignAnalyticsData>>(emptyMap()) }
    var analyticsLoading by remember { mutableStateOf<Set<String>>(emptySet()) }

    // Edit dialog state
    var editingCampaignId by remember { mutableStateOf<String?>(null) }
    var editingSubmissionId by remember { mutableStateOf("") }
    var editHeadline by remember { mutableStateOf("") }
    var editBody by remember { mutableStateOf("") }
    var editCtaText by remember { mutableStateOf("") }
    var editCtaUrl by remember { mutableStateOf("") }
    /** Image currently shown to users (live creative). */
    var editLiveImagePreviewUrl by remember { mutableStateOf<String?>(null) }
    /** Staged image waiting for review, if any. */
    var editPendingImagePreviewUrl by remember { mutableStateOf<String?>(null) }
    /** True when the submission has a staged creative (may be text-only; image URLs can match live). */
    var editHasStagedCreative by remember { mutableStateOf(false) }
    var editSaving by remember { mutableStateOf(false) }
    var editError by remember { mutableStateOf<String?>(null) }

    // Cancel live campaign (no refund) — only for active ads
    var cancellingCampaignId by remember { mutableStateOf<String?>(null) }
    var cancelInProgress by remember { mutableStateOf(false) }
    var cancelError by remember { mutableStateOf<String?>(null) }

    // Withdraw before launch (prelaunch-cancel API — refund / release per server rules)
    var prelaunchSubmissionId by remember { mutableStateOf<String?>(null) }
    var prelaunchInProgress by remember { mutableStateOf(false) }
    var prelaunchError by remember { mutableStateOf<String?>(null) }

    // Renew state
    var renewingCampaignId by remember { mutableStateOf<String?>(null) }
    var renewError by remember { mutableStateOf<String?>(null) }

    fun loadCampaigns() {
        scope.launch {
            isLoading = true
            errorMessage = null
            try {
                val list = playgroundService.getMyCampaigns()
                campaigns = list.sortedWith(
                    compareByDescending<AdCampaignStats> { it.startDateCalendar.ifBlank { "0000-00-00" } }
                        .thenByDescending { it._id },
                )
            } catch (e: Exception) {
                errorMessage = e.message ?: "Failed to load campaigns"
            }
            isLoading = false
        }
    }

    fun loadAnalytics(campaignId: String) {
        if (analyticsData.containsKey(campaignId)) return
        scope.launch {
            analyticsLoading = analyticsLoading + campaignId
            try {
                val data = playgroundService.getCampaignAnalytics(campaignId)
                analyticsData = analyticsData + (campaignId to data)
            } catch (_: Exception) {
                // Silently fail — the expanded section just won't show daily data
            }
            analyticsLoading = analyticsLoading - campaignId
        }
    }

    fun openEditDialog(campaignId: String) {
        editHeadline = ""
        editBody = ""
        editCtaText = ""
        editCtaUrl = ""
        editLiveImagePreviewUrl = null
        editPendingImagePreviewUrl = null
        editHasStagedCreative = false
        editError = null
        editSaving = false
        editingCampaignId = campaignId
        editingSubmissionId = campaigns.find { it._id == campaignId }?.submissionId?.trim().orEmpty()
        scope.launch {
            try {
                val data = playgroundService.getCampaignAnalytics(campaignId)
                val live = data.campaign.creativePreview
                val pending = data.campaign.pendingCreativePreview
                val p = pending ?: live
                editHasStagedCreative = pending != null
                editLiveImagePreviewUrl = live?.imageUrl?.trim()?.takeIf { it.isNotBlank() }
                editPendingImagePreviewUrl = pending?.imageUrl?.trim()?.takeIf { it.isNotBlank() }
                if (p != null) {
                    editHeadline = p.headline
                    editBody = p.body
                    editCtaText = p.ctaText
                    editCtaUrl = p.ctaUrl
                }
            } catch (_: Exception) { /* keep empty */ }
        }
    }

    fun submitEdit() {
        val campaignId = editingCampaignId ?: return
        scope.launch {
            editSaving = true
            editError = null
            try {
                val fields = mutableMapOf<String, Any?>()
                if (editHeadline.isNotBlank()) fields["headline"] = editHeadline
                if (editBody.isNotBlank()) fields["body"] = editBody
                if (editCtaText.isNotBlank()) fields["ctaText"] = editCtaText
                if (editCtaUrl.isNotBlank()) fields["ctaUrl"] = editCtaUrl
                playgroundService.editCampaignCreative(campaignId, fields)
                editingCampaignId = null
                editingSubmissionId = ""
                // Refresh analytics for this campaign so the detail section updates
                analyticsData = analyticsData - campaignId
                loadAnalytics(campaignId)
                loadCampaigns()
            } catch (e: Exception) {
                editError = e.message ?: "Failed to save changes"
            }
            editSaving = false
        }
    }

    fun openCancelLiveDialog(campaignId: String) {
        cancellingCampaignId = campaignId
        cancelError = null
        cancelInProgress = false
    }

    fun confirmCancelLive() {
        val campaignId = cancellingCampaignId ?: return
        scope.launch {
            cancelInProgress = true
            cancelError = null
            try {
                playgroundService.cancelCampaign(campaignId)
                cancellingCampaignId = null
                loadCampaigns()
            } catch (e: Exception) {
                cancelError = e.message ?: "Cancellation failed"
            }
            cancelInProgress = false
        }
    }

    fun openPrelaunchWithdrawDialog(submissionId: String) {
        prelaunchSubmissionId = submissionId
        prelaunchError = null
        prelaunchInProgress = false
    }

    fun confirmPrelaunchWithdraw() {
        val submissionId = prelaunchSubmissionId ?: return
        scope.launch {
            prelaunchInProgress = true
            prelaunchError = null
            try {
                playgroundService.prelaunchCancelSubmission(submissionId)
                prelaunchSubmissionId = null
                loadCampaigns()
            } catch (e: Exception) {
                prelaunchError = e.message ?: "Withdraw failed"
            }
            prelaunchInProgress = false
        }
    }

    LaunchedEffect(Unit) { loadCampaigns() }

    // Deep link from the menu: open with this campaign expanded (analytics load when expanded).
    LaunchedEffect(soloCampaignId, campaigns) {
        val want = soloCampaignId?.trim()?.takeIf { it.isNotEmpty() }
        if (want == null) {
            expandedCampaignId = null
            return@LaunchedEffect
        }
        if (campaigns.isEmpty()) return@LaunchedEffect
        if (campaigns.any { it._id == want }) {
            expandedCampaignId = want
            loadAnalytics(want)
        }
    }

    LaunchedEffect(externalReloadNonce) {
        if (externalReloadNonce <= 0) return@LaunchedEffect
        loadCampaigns()
        val cid = editingCampaignId ?: return@LaunchedEffect
        try {
            val data = playgroundService.getCampaignAnalytics(cid)
            val live = data.campaign.creativePreview
            val pending = data.campaign.pendingCreativePreview
            editHasStagedCreative = pending != null
            editLiveImagePreviewUrl = live?.imageUrl?.trim()?.takeIf { it.isNotBlank() }
            editPendingImagePreviewUrl = pending?.imageUrl?.trim()?.takeIf { it.isNotBlank() }
        } catch (_: Exception) { }
    }

    // ─── Edit Creative Dialog ────────────────────────────────────────────────
    if (editingCampaignId != null) {
        AlertDialog(
            onDismissRequest = {
                if (!editSaving) {
                    editingCampaignId = null
                    editingSubmissionId = ""
                }
            },
            title = { Text("Edit Creative", fontWeight = FontWeight.Bold) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedTextField(
                        value = editHeadline,
                        onValueChange = { editHeadline = it },
                        label = { Text("Headline") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = editBody,
                        onValueChange = { editBody = it },
                        label = { Text("Body") },
                        maxLines = 3,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Text("Creative image", fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                    Text(
                        "Each campaign uses one picture at a time. Renewing or rebooking copies your last image until you upload a new one.",
                        fontSize = 11.sp,
                        color = Color.DarkGray,
                    )
                    Text("Live (what people see now)", fontSize = 12.sp, fontWeight = FontWeight.Medium, color = Color.DarkGray)
                    if (!editLiveImagePreviewUrl.isNullOrBlank()) {
                        AsyncImage(
                            model = editLiveImagePreviewUrl,
                            contentDescription = "Live ad image",
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(140.dp)
                                .clip(RoundedCornerShape(12.dp))
                                .background(FormColors.CardBackground),
                            contentScale = ContentScale.Crop,
                        )
                    } else {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(100.dp)
                                .clip(RoundedCornerShape(12.dp))
                                .background(Color(0xFFEEEEEE)),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text("No live image on file", color = Color.Gray, fontSize = 12.sp)
                        }
                    }
                    if (
                        !editPendingImagePreviewUrl.isNullOrBlank()
                        && editPendingImagePreviewUrl != editLiveImagePreviewUrl
                    ) {
                        Spacer(Modifier.height(6.dp))
                        Text("Pending review (replaces live when approved)", fontSize = 12.sp, fontWeight = FontWeight.Medium, color = Color.DarkGray)
                        AsyncImage(
                            model = editPendingImagePreviewUrl,
                            contentDescription = "Pending ad image",
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(140.dp)
                                .clip(RoundedCornerShape(12.dp))
                                .background(FormColors.CardBackground),
                            contentScale = ContentScale.Crop,
                        )
                    } else if (editHasStagedCreative) {
                        Text(
                            "Headline or other copy changes are pending review; the live picture above stays until those are approved.",
                            fontSize = 11.sp,
                            color = Color.DarkGray,
                        )
                    }
                    if (onPickCreativeImage != null) {
                        if (editingSubmissionId.isNotBlank()) {
                            OutlinedButton(
                                onClick = {
                                    onPickCreativeImage.invoke(editingCampaignId!!, editingSubmissionId)
                                },
                                enabled = !editSaving,
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Text("Change picture…")
                            }
                            Text(
                                "Pick a new photo, crop it, then we upload it. On live ads, the new picture appears above as “pending” until review approves it.",
                                fontSize = 11.sp,
                                color = Color.DarkGray,
                            )
                        } else {
                            Text(
                                "Picture changes aren’t available for this campaign (missing submission link). Contact support if you need help.",
                                fontSize = 11.sp,
                                color = FormColors.ErrorText,
                            )
                        }
                    }
                    OutlinedTextField(
                        value = editCtaText,
                        onValueChange = { editCtaText = it },
                        label = { Text("Button text") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = editCtaUrl,
                        onValueChange = { editCtaUrl = it },
                        label = { Text("Button link (URL)") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    if (editError != null) {
                        Text(editError!!, color = FormColors.ErrorText, fontSize = 12.sp)
                    }
                }
            },
            confirmButton = {
                Button(
                    onClick = { submitEdit() },
                    enabled = !editSaving,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = FormColors.PrimaryButton,
                        contentColor = FormColors.PrimaryButtonText,
                    ),
                ) {
                    if (editSaving) {
                        CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp, color = FormColors.PrimaryButtonText)
                    } else {
                        Text("Save")
                    }
                }
            },
            dismissButton = {
                TextButton(
                    onClick = {
                        editingCampaignId = null
                        editingSubmissionId = ""
                    },
                    enabled = !editSaving,
                ) { Text("Cancel", color = FormColors.SecondaryButtonText) }
            },
        )
    }

    // ─── Withdraw before launch (prelaunch-cancel) ─────────────────────────
    if (prelaunchSubmissionId != null) {
        AlertDialog(
            onDismissRequest = { if (!prelaunchInProgress) prelaunchSubmissionId = null },
            title = { Text("Withdraw before launch?", fontWeight = FontWeight.Bold) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(
                        "Your campaign hasn’t started yet. We’ll cancel the submission and scheduled campaign. If your card was charged, you’ll typically receive a full refund; if only a hold was placed, it will be released.",
                        fontSize = 14.sp,
                    )
                    Text(
                        "This matches “Withdraw submission” on your submission status screen.",
                        fontSize = 12.sp,
                        color = Color.DarkGray,
                    )
                    if (prelaunchError != null) {
                        Text(prelaunchError!!, color = FormColors.ErrorText, fontSize = 13.sp)
                    }
                }
            },
            confirmButton = {
                Button(
                    onClick = { confirmPrelaunchWithdraw() },
                    enabled = !prelaunchInProgress,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Color(0xFFC62828),
                        contentColor = Color.White,
                    ),
                ) {
                    if (prelaunchInProgress) {
                        CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp, color = Color.White)
                    } else {
                        Text("Yes, withdraw")
                    }
                }
            },
            dismissButton = {
                TextButton(
                    onClick = { prelaunchSubmissionId = null },
                    enabled = !prelaunchInProgress,
                ) { Text("Keep campaign", color = FormColors.SecondaryButtonText) }
            },
        )
    }

    // ─── Cancel live campaign (no refund for amounts already paid) ───────────
    if (cancellingCampaignId != null) {
        AlertDialog(
            onDismissRequest = { if (!cancelInProgress) cancellingCampaignId = null },
            title = { Text("Cancel this live campaign?", fontWeight = FontWeight.Bold) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(
                        "Your ad will stop running. This cannot be undone.",
                        fontSize = 14.sp,
                    )
                    Text(
                        "You will not receive a refund for any payment already collected. If only an authorization hold was placed and your card was not charged yet, that hold is usually released by your bank within a few business days.",
                        fontSize = 13.sp,
                        color = Color.DarkGray,
                    )
                    if (cancelError != null) {
                        Text(cancelError!!, color = FormColors.ErrorText, fontSize = 13.sp)
                    }
                }
            },
            confirmButton = {
                Button(
                    onClick = { confirmCancelLive() },
                    enabled = !cancelInProgress,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Color(0xFFC62828),
                        contentColor = Color.White,
                    ),
                ) {
                    if (cancelInProgress) {
                        CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp, color = Color.White)
                    } else {
                        Text("Yes, cancel campaign")
                    }
                }
            },
            dismissButton = {
                TextButton(
                    onClick = { cancellingCampaignId = null },
                    enabled = !cancelInProgress,
                ) { Text("Keep campaign", color = FormColors.SecondaryButtonText) }
            },
        )
    }

    // Use [surface] (white), not [background] (app theme sets background = primary teal) — else the
    // list looks like a giant empty teal field under the app bar and metrics feel like open ocean.
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.surface),
    ) {
        Box(modifier = Modifier.fillMaxSize()) {
            when {
                isLoading -> CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))

                errorMessage != null -> Column(
                    modifier = Modifier.align(Alignment.Center).padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text("⚠️ $errorMessage", fontSize = 14.sp, color = FormColors.ErrorText)
                    Spacer(Modifier.height(12.dp))
                    TextButton(onClick = { loadCampaigns() }) { Text("Retry", color = FormColors.PrimaryButton) }
                }

                campaigns.isEmpty() -> Column(
                    modifier = Modifier.align(Alignment.Center),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text("Ads", fontSize = 32.sp, fontWeight = FontWeight.Bold, color = FormColors.PrimaryButton)
                    Spacer(Modifier.height(8.dp))
                    Text("No campaigns yet", fontSize = 16.sp, color = Color.Gray)
                    Spacer(Modifier.height(4.dp))
                    Text("Your campaign metrics will appear here", fontSize = 13.sp, color = Color.Gray)
                    Spacer(Modifier.height(12.dp))
                    Button(
                        onClick = onNavigateToAdvertise,
                        modifier = Modifier.fillMaxWidth(0.7f).height(48.dp),
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = FormColors.PrimaryButton,
                            contentColor = FormColors.PrimaryButtonText,
                        ),
                    ) {
                        Text("+ Create New Ad", fontWeight = FontWeight.SemiBold)
                    }
                    Spacer(Modifier.height(8.dp))
                    Button(
                        onClick = { openExternalUrl(MarketingLinks.advertiserHub()) },
                        modifier = Modifier.fillMaxWidth(0.7f).height(44.dp),
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = Color(0xFF424242),
                            contentColor = Color.White,
                        ),
                    ) {
                        Text("Website — pricing & full analytics", fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                    }
                    Spacer(Modifier.height(8.dp))
                    TextButton(onClick = { loadCampaigns() }) { Text("Refresh", color = FormColors.PrimaryButton) }
                }

                else -> LazyColumn(
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    item {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(
                                onClick = onNavigateToAdvertise,
                                modifier = Modifier.fillMaxWidth().height(48.dp),
                                shape = RoundedCornerShape(12.dp),
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = FormColors.PrimaryButton,
                                    contentColor = FormColors.PrimaryButtonText,
                                ),
                            ) {
                                Text("+ Create New Ad", fontWeight = FontWeight.SemiBold)
                            }
                            Button(
                                onClick = { openExternalUrl(MarketingLinks.advertiserHub()) },
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(44.dp),
                                shape = RoundedCornerShape(12.dp),
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = Color(0xFF424242),
                                    contentColor = Color.White,
                                ),
                            ) {
                                Text(
                                    "Website — pricing & full analytics",
                                    fontWeight = FontWeight.SemiBold,
                                    fontSize = 13.sp,
                                )
                            }
                        }
                    }
                    items(campaigns) { campaign ->
                        LaunchedEffect(campaign._id, campaign.status, campaign.submissionId) {
                            if (campaign.status.isBlank() && campaign.submissionId.isNotBlank()) {
                                loadAnalytics(campaign._id)
                            }
                        }
                        val campaignAnalytics = analyticsData[campaign._id]
                        val campaignStatus = campaign.status.ifBlank {
                            campaignAnalytics?.campaign?.status.orEmpty()
                        }
                        val submissionIdForWithdraw = campaign.submissionId.ifBlank {
                            campaignAnalytics?.campaign?.submissionId.orEmpty()
                        }
                        val canEdit = campaignStatus == "active" || campaignStatus == "scheduled" ||
                            campaignStatus == "pending_review"
                        val canPrelaunchWithdraw =
                            (campaignStatus == "scheduled" || campaignStatus == "pending_review") &&
                                submissionIdForWithdraw.isNotBlank()
                        val canCancelLive = campaignStatus == "active"
                        val canRenew = campaignStatus == "completed" || campaignStatus == "cancelled"

                        CampaignCard(
                            campaign = campaign,
                            isExpanded = expandedCampaignId == campaign._id,
                            analytics = campaignAnalytics,
                            isAnalyticsLoading = campaign._id in analyticsLoading,
                            campaignStatusForBadge = campaignStatus,
                            canEdit = canEdit,
                            canPrelaunchWithdraw = canPrelaunchWithdraw,
                            canCancelLiveCampaign = canCancelLive,
                            canRenew = canRenew,
                            isRenewing = renewingCampaignId == campaign._id,
                            renewError = if (renewingCampaignId == campaign._id) renewError else null,
                            onToggle = {
                                if (expandedCampaignId == campaign._id) {
                                    expandedCampaignId = null
                                } else {
                                    expandedCampaignId = campaign._id
                                    loadAnalytics(campaign._id)
                                }
                            },
                            onEdit = { openEditDialog(campaign._id) },
                            onPrelaunchWithdraw = {
                                if (submissionIdForWithdraw.isNotBlank()) {
                                    openPrelaunchWithdrawDialog(submissionIdForWithdraw)
                                }
                            },
                            onCancelLiveCampaign = { openCancelLiveDialog(campaign._id) },
                            onRenew = {
                                val submissionId = campaign.submissionId.ifBlank {
                                    campaignAnalytics?.campaign?.submissionId ?: return@CampaignCard
                                }
                                val regionKey = campaign.cityId.ifBlank {
                                    campaignAnalytics?.campaign?.cityId ?: return@CampaignCard
                                }
                                renewingCampaignId = campaign._id
                                renewError = null
                                scope.launch {
                                    try {
                                        val result = playgroundService.renewSubmission(submissionId)
                                        renewingCampaignId = null
                                        onRenew(result.submissionId, regionKey)
                                    } catch (e: Exception) {
                                        renewError = e.message ?: "Renewal failed"
                                        renewingCampaignId = null
                                    }
                                }
                            },
                        )
                    }
                }
            }
        }
    }
}

private fun campaignTitle(c: AdCampaignStats): String {
    val h = c.headline.trim()
    if (h.isNotEmpty()) return h
    val b = c.businessName.trim()
    if (b.isNotEmpty()) return b
    return "Your ad campaign"
}

private fun placementDisplayLabel(placement: String): String = when (placement) {
    "featured_home" -> "Prime (home screen)"
    "inline_listing" -> "Inline listing"
    else -> placement.replace("_", " ").replaceFirstChar { it.uppercase() }
}

/** Placeholder CTA labels that should nudge the advertiser to fix copy in Edit. */
private fun isWeakCtaLabel(s: String): Boolean {
    val t = s.trim().lowercase()
    return t == "button" || t == "button button" || t == "test" || t == "x" || t == "cta"
}

private fun howYourAdLooksBlurb(placement: String, isEvent: Boolean): String = when {
    placement == "featured_home" && isEvent ->
        "Same as the home screen: split row with the image on the left, then title, When/Where, your message, and Event + your button."
    placement == "featured_home" ->
        "Same as the prime home card: split row—image on the left, your business name and message on the right, then Ad + your button below."
    else ->
        "Same as search and list: image on the left, headline and message on the right, and Ad (or Event) with your button in a row at the bottom."
}

private fun previewLabeledEventLine(label: String, value: String) = buildAnnotatedString {
    withStyle(SpanStyle(fontWeight = FontWeight.Bold, color = Color(0xFF263238))) { append(label) }
    append(" ")
    withStyle(SpanStyle(color = Color(0xFF37474F))) { append(value) }
}

private fun previewFeaturedImageAlignment(s: String?): Alignment = when (s?.lowercase()) {
    "top" -> Alignment.TopCenter
    "bottom" -> Alignment.BottomCenter
    else -> Alignment.Center
}

@Composable
private fun HowYourAdLooksBlock(
    placement: String,
    isEvent: Boolean,
    preview: CampaignCreativePreview,
) {
    val isPrime = placement == "featured_home"
    val displayTitle = when {
        isPrime && isEvent && !preview.eventName.isNullOrBlank() -> preview.eventName!!.trim()
        isPrime && preview.businessName.trim().isNotBlank() -> preview.businessName.trim()
        isPrime -> preview.headline.trim().ifBlank { preview.businessName.trim() }
        else -> preview.headline.trim().ifBlank { preview.businessName.trim() }
    }.ifBlank { "Your ad" }
    val eventNameForDedup = if (isEvent) {
        preview.eventName?.trim()?.takeIf { it.isNotEmpty() } ?: displayTitle
    } else {
        null
    }
    val bodyDisplayed = eventBodyTextForDisplay(
        preview.body,
        isEvent,
        eventName = eventNameForDedup,
        eventDate = preview.eventDate,
        eventTime = preview.eventTime,
        eventLocation = preview.eventLocation,
    )
    val ctaLabel = preview.ctaText.trim().ifBlank { "Learn more" }
    val showWeakHint = isWeakCtaLabel(preview.ctaText)
    val listingStroke = BorderStroke(1.5.dp, if (isEvent) Color(0xFFFF8F00) else Color(0xFF00CED1))

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .border(DashboardOutlineWidth, DashboardOutlineColor, RoundedCornerShape(10.dp))
            .background(Color(0xFFFAFAFA))
            .padding(10.dp),
    ) {
        if (isPrime) {
            // Matches [FeaturedAdCard] / AdCardContent: always a horizontal split (not stacked).
            val layoutDir = LocalLayoutDirection.current
            val corner = 20.dp
            val imageHalfShape = if (layoutDir == LayoutDirection.Rtl) {
                RoundedCornerShape(topStart = 0.dp, bottomStart = 0.dp, topEnd = corner, bottomEnd = corner)
            } else {
                RoundedCornerShape(topStart = corner, bottomStart = corner, topEnd = 0.dp, bottomEnd = 0.dp)
            }
            val dateReadable = if (isEvent) formatEventDateReadableLine(preview.eventDate, preview.isRecurring) else null
            val whenLine = if (isEvent) {
                listOfNotNull(
                    dateReadable?.trim()?.takeIf { it.isNotEmpty() },
                    preview.eventTime?.trim()?.takeIf { it.isNotEmpty() },
                ).joinToString(" at ").ifBlank { null }
            } else {
                null
            }
            val whereLine = if (isEvent) preview.eventLocation?.trim()?.takeIf { it.isNotEmpty() } else null
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(corner),
                border = BorderStroke(1.dp, Color(0xFF00CED1).copy(alpha = 0.4f)),
                colors = CardDefaults.cardColors(containerColor = Color(0xFFFFFFFF)),
                elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = HomeDiscoverFeaturedAdSplitMinRowHeight)
                        .height(IntrinsicSize.Min),
                    verticalAlignment = Alignment.Top,
                ) {
                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .fillMaxHeight()
                            .clip(imageHalfShape)
                            .background(
                                if (!preview.imageUrl.isNullOrBlank()) {
                                    Color(0xFFEEEEEE)
                                } else {
                                    Color(0xFFB2EBF2).copy(alpha = 0.5f)
                                },
                            ),
                    ) {
                        if (!preview.imageUrl.isNullOrBlank()) {
                            AsyncImage(
                                model = preview.imageUrl,
                                contentDescription = null,
                                modifier = Modifier.fillMaxSize(),
                                contentScale = ContentScale.Fit,
                                alignment = previewFeaturedImageAlignment(preview.imageAlignment),
                            )
                        }
                    }
                    Box(
                        modifier = Modifier
                            .fillMaxHeight()
                            .width(1.dp)
                            .background(Color(0xFFE8E8E8)),
                    )
                    Column(
                        modifier = Modifier
                            .weight(1f)
                            .fillMaxHeight()
                            .padding(start = 8.dp, end = 10.dp, top = 8.dp, bottom = 8.dp),
                        verticalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Column(
                            verticalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            Text(
                                displayTitle,
                                fontWeight = FontWeight.Bold,
                                fontSize = 13.sp,
                                lineHeight = 17.sp,
                                color = Color(0xFF212121),
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                            if (!whenLine.isNullOrBlank()) {
                                Text(
                                    text = previewLabeledEventLine("When:", whenLine),
                                    fontSize = 12.sp,
                                    maxLines = 2,
                                    overflow = TextOverflow.Ellipsis,
                                    lineHeight = 16.sp,
                                )
                            }
                            if (!whereLine.isNullOrBlank()) {
                                Text(
                                    text = previewLabeledEventLine("Where:", whereLine),
                                    fontSize = 12.sp,
                                    maxLines = 2,
                                    overflow = TextOverflow.Ellipsis,
                                    lineHeight = 16.sp,
                                )
                            }
                            if (bodyDisplayed.isNotBlank()) {
                                Text(
                                    bodyDisplayed,
                                    fontSize = 11.sp,
                                    color = Color(0xFF424242),
                                    lineHeight = 14.sp,
                                    maxLines = 8,
                                    overflow = TextOverflow.Clip,
                                )
                            }
                        }
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            if (isEvent) EventBadgePill() else AdIndicatorPill()
                            Box(
                                modifier = Modifier
                                    .weight(1f)
                                    .border(BorderStroke(1.dp, Color(0xFF00CED1)), RoundedCornerShape(8.dp))
                                    .padding(horizontal = 10.dp, vertical = 6.dp),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(
                                    ctaLabel,
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    color = Color(0xFF00CED1),
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                        }
                    }
                }
            }
        } else {
            // Inline / list: same split as [SponsoredListingCard] (image left, copy + CTA right).
            val layoutDir = LocalLayoutDirection.current
            val corner = 10.dp
            val imageHalfShape = if (layoutDir == LayoutDirection.Rtl) {
                RoundedCornerShape(topEnd = corner, bottomEnd = corner)
            } else {
                RoundedCornerShape(topStart = corner, bottomStart = corner)
            }
            val splitHeight = if (isEvent) 188.dp else 132.dp
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(corner),
                border = listingStroke,
                colors = CardDefaults.cardColors(containerColor = Color(0xFFFFFFFF)),
                elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(splitHeight),
                    verticalAlignment = Alignment.Top,
                ) {
                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .fillMaxHeight()
                            .clip(imageHalfShape)
                            .background(Color(0xFFEEEEEE)),
                    ) {
                        if (!preview.imageUrl.isNullOrBlank()) {
                            AsyncImage(
                                model = preview.imageUrl,
                                contentDescription = null,
                                modifier = Modifier.fillMaxSize(),
                                contentScale = ContentScale.Crop,
                            )
                        } else {
                            Box(
                                modifier = Modifier.fillMaxSize(),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(
                                    "Ad image",
                                    fontSize = 11.sp,
                                    color = FormColors.PrimaryButton,
                                    fontWeight = FontWeight.Medium,
                                )
                            }
                        }
                    }
                    Box(
                        modifier = Modifier
                            .fillMaxHeight()
                            .width(1.dp)
                            .background(Color(0xFFE8E8E8)),
                    )
                    Column(
                        modifier = Modifier
                            .weight(1f)
                            .fillMaxHeight()
                            .padding(start = 8.dp, end = 8.dp, top = 6.dp, bottom = 6.dp),
                    ) {
                        val whenIn = if (isEvent) {
                            listOfNotNull(
                                formatEventDateReadableLine(preview.eventDate, preview.isRecurring),
                                preview.eventTime?.trim()?.takeIf { it.isNotEmpty() },
                            ).joinToString(" at ").ifBlank { null }
                        } else {
                            null
                        }
                        val whereIn = if (isEvent) preview.eventLocation?.trim()?.takeIf { it.isNotEmpty() } else null
                        Text(
                            displayTitle,
                            fontWeight = FontWeight.Bold,
                            fontSize = 14.sp,
                            color = Color(0xFF212121),
                            maxLines = 2,
                        )
                        if (!whenIn.isNullOrBlank()) {
                            Spacer(Modifier.height(2.dp))
                            Text(
                                text = previewLabeledEventLine("When:", whenIn),
                                fontSize = 11.sp,
                                maxLines = 2,
                                lineHeight = 15.sp,
                            )
                        }
                        if (!whereIn.isNullOrBlank()) {
                            Spacer(Modifier.height(2.dp))
                            Text(
                                text = previewLabeledEventLine("Where:", whereIn),
                                fontSize = 11.sp,
                                maxLines = 2,
                                lineHeight = 15.sp,
                            )
                        }
                        if (bodyDisplayed.isNotBlank()) {
                            Spacer(Modifier.height(4.dp))
                            Text(
                                bodyDisplayed,
                                fontSize = 11.sp,
                                color = Color(0xFF424242),
                                lineHeight = 15.sp,
                                maxLines = 3,
                            )
                        }
                        Spacer(Modifier.weight(1f, fill = true))
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            if (isEvent) EventBadgePill() else AdIndicatorPill()
                            OutlinedButton(
                                onClick = {},
                                enabled = false,
                                modifier = Modifier.weight(1f),
                                shape = RoundedCornerShape(10.dp),
                                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp),
                                border = BorderStroke(1.dp, Color(0xFF00CED1)),
                                colors = ButtonDefaults.outlinedButtonColors(
                                    contentColor = Color(0xFF00CED1),
                                ),
                            ) {
                                Text(
                                    ctaLabel,
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    maxLines = 1,
                                )
                            }
                        }
                    }
                }
            }
        }

        if (showWeakHint) {
            Spacer(Modifier.height(6.dp))
            Text(
                "Your button label is still a placeholder—use Edit to set the text people will see.",
                fontSize = 10.sp,
                lineHeight = 14.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun CampaignCard(
    campaign: AdCampaignStats,
    isExpanded: Boolean,
    analytics: CampaignAnalyticsData?,
    isAnalyticsLoading: Boolean,
    campaignStatusForBadge: String,
    canEdit: Boolean,
    canPrelaunchWithdraw: Boolean,
    canCancelLiveCampaign: Boolean,
    canRenew: Boolean,
    isRenewing: Boolean,
    renewError: String?,
    onToggle: () -> Unit,
    onEdit: () -> Unit,
    onPrelaunchWithdraw: () -> Unit,
    onCancelLiveCampaign: () -> Unit,
    onRenew: () -> Unit,
) {
    val clickRateFormatted = "%.2f%%".format(campaign.ctr * 100)
    val labels = campaign.targetedCityLabels.filter { it.isNotBlank() }
    val regionSummary = when {
        labels.size > 1 -> labels.joinToString(", ")
        labels.size == 1 -> labels[0]
        campaign.targetedRegionKeys.size > 1 -> "${campaign.targetedRegionKeys.size} areas"
        campaign.targetedRegionKeys.size == 1 -> campaign.targetedRegionKeys[0]
        else -> ""
    }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .border(DashboardOutlineWidth, DashboardOutlineColor, RoundedCornerShape(12.dp))
            .clickable(onClick = onToggle),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(
            defaultElevation = 3.dp,
            pressedElevation = 2.dp,
        ),
    ) {
        Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) {
            // Campaign header row + creative preview
            Row(verticalAlignment = Alignment.Top) {
                if (!campaign.imageUrl.isNullOrBlank()) {
                    AsyncImage(
                        model = campaign.imageUrl,
                        contentDescription = "Ad preview",
                        modifier = Modifier
                            .size(width = 96.dp, height = 72.dp)
                            .padding(end = 10.dp),
                    )
                } else {
                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = Color(0xFFE0F7FA),
                        modifier = Modifier.width(36.dp).padding(end = 8.dp),
                    ) {
                        Box(Modifier.fillMaxWidth().padding(vertical = 6.dp), contentAlignment = Alignment.Center) {
                            Text("Ad", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = FormColors.PrimaryButton)
                        }
                    }
                }
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        campaignTitle(campaign),
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 15.sp,
                    )
                    if (campaign.placement.isNotBlank()) {
                        Text(
                            placementDisplayLabel(campaign.placement),
                            fontSize = 12.sp,
                            color = Color.Gray,
                        )
                    }
                    val startCal = campaign.startDateCalendar.trim()
                    val endCal = campaign.endDateCalendar.trim()
                    if (startCal.isNotEmpty() || endCal.isNotEmpty()) {
                        val dateLine = buildString {
                            if (startCal.isNotEmpty()) append("Runs ").append(startCal)
                            if (endCal.isNotEmpty()) {
                                if (startCal.isNotEmpty()) append(" to ") else append("Through ")
                                append(endCal)
                            }
                        }
                        Text(
                            dateLine,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Medium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    if (regionSummary.isNotBlank()) {
                        Text(
                            "Areas: $regionSummary",
                            fontSize = 11.sp,
                            color = Color.Gray,
                            maxLines = 2,
                        )
                    }
                    // Status: list API + optional analytics fallback
                    if (campaignStatusForBadge.isNotBlank() || analytics != null) {
                        Spacer(Modifier.height(4.dp))
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            when {
                                campaignStatusForBadge.isNotBlank() -> StatusBadge(campaignStatusForBadge)
                                analytics != null -> StatusBadge(analytics.campaign.status)
                            }
                        }
                    }
                }
                Text(if (isExpanded) "Hide" else "Show", fontSize = 11.sp, color = Color.Gray)
            }

            Spacer(Modifier.height(6.dp))

            // Metrics: equal columns (no [SpaceEvenly] — that spreads three narrow items across the full width).
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(10.dp))
                    .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f))
                    .padding(vertical = 8.dp, horizontal = 4.dp),
            ) {
                Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                    MetricColumn("Views", campaign.impressions.toString(), 20.sp, 11.sp)
                }
                Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                    MetricColumn("Clicks", campaign.clicks.toString(), 20.sp, 11.sp)
                }
                Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                    MetricColumn("Tapped", clickRateFormatted, 20.sp, 11.sp)
                }
            }

            // Action buttons — withdraw-before-launch vs cancel-live are different APIs
            if (canEdit || canPrelaunchWithdraw || canCancelLiveCampaign || canRenew) {
                Spacer(Modifier.height(10.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (canRenew) {
                        Button(
                            onClick = onRenew,
                            enabled = !isRenewing,
                            shape = RoundedCornerShape(8.dp),
                            contentPadding = PaddingValues(horizontal = 14.dp, vertical = 6.dp),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = FormColors.PrimaryButton,
                                contentColor = FormColors.PrimaryButtonText,
                            ),
                        ) {
                            if (isRenewing) {
                                CircularProgressIndicator(modifier = Modifier.size(14.dp), strokeWidth = 2.dp, color = FormColors.PrimaryButtonText)
                            } else {
                                Text("Renew", fontSize = 13.sp)
                            }
                        }
                        Spacer(Modifier.width(8.dp))
                    }
                    if (canEdit) {
                        OutlinedButton(
                            onClick = onEdit,
                            shape = RoundedCornerShape(8.dp),
                            contentPadding = PaddingValues(horizontal = 14.dp, vertical = 6.dp),
                            colors = ButtonDefaults.outlinedButtonColors(contentColor = FormColors.PrimaryButton),
                        ) {
                            Text("Edit", fontSize = 13.sp)
                        }
                    }
                    if (canEdit && (canPrelaunchWithdraw || canCancelLiveCampaign)) Spacer(Modifier.width(8.dp))
                    if (canPrelaunchWithdraw) {
                        OutlinedButton(
                            onClick = onPrelaunchWithdraw,
                            shape = RoundedCornerShape(8.dp),
                            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
                            colors = ButtonDefaults.outlinedButtonColors(contentColor = Color(0xFFC62828)),
                        ) {
                            Text("Withdraw before launch", fontSize = 12.sp, maxLines = 2)
                        }
                    }
                    if (canPrelaunchWithdraw && canCancelLiveCampaign) Spacer(Modifier.width(8.dp))
                    if (canCancelLiveCampaign) {
                        OutlinedButton(
                            onClick = onCancelLiveCampaign,
                            shape = RoundedCornerShape(8.dp),
                            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
                            colors = ButtonDefaults.outlinedButtonColors(contentColor = Color(0xFFC62828)),
                        ) {
                            Text("Cancel campaign", fontSize = 12.sp, maxLines = 2)
                        }
                    }
                }
                if (renewError != null) {
                    Text(renewError, color = FormColors.ErrorText, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
                }
            }

            // Expanded detail section
            AnimatedVisibility(visible = isExpanded) {
                Column(modifier = Modifier.padding(top = 8.dp)) {
                    HorizontalDivider(modifier = Modifier.padding(bottom = 8.dp))

                    if (isAnalyticsLoading) {
                        Box(modifier = Modifier.fillMaxWidth().padding(vertical = 16.dp), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 2.dp)
                        }
                    } else if (analytics != null) {
                        CampaignDetailSection(analytics)
                    }
                }
            }
        }
    }
}

@Composable
private fun CampaignDetailSection(analytics: CampaignAnalyticsData) {
    var showAllDaily by remember { mutableStateOf(false) }
    /** Collapsed by default so the card stays scannable; expand for the full table. */
    var showDayByDayTable by remember { mutableStateOf(false) }
    var showCancellationNote by remember { mutableStateOf(false) }
    val campaign = analytics.campaign
    val daily = analytics.analytics.daily
    val sortedDaily = remember(daily) { daily.sortedByDescending { it.date } }
    val last7 = remember(sortedDaily) { sortedDaily.take(7) }
    val sumImp7 = remember(last7) { last7.sumOf { it.impressions } }
    val sumClk7 = remember(last7) { last7.sumOf { it.clicks } }
    val ctr7 = if (sumImp7 > 0) sumClk7.toDouble() / sumImp7 else 0.0
    val visibleDaily = if (showAllDaily) sortedDaily else sortedDaily.take(7)
    val preview = campaign.creativePreview
    val pendingPreview = campaign.pendingCreativePreview
    val pendingImageNorm = pendingPreview?.imageUrl?.trim()?.takeIf { it.isNotBlank() }
    val liveImageNorm = preview?.imageUrl?.trim()?.takeIf { it.isNotBlank() }
    val showPendingImagePreview = pendingImageNorm != null && pendingImageNorm != liveImageNorm
    val startYmd = campaign.startDateCalendar.ifBlank { campaign.startDate.take(10) }
    val endYmd = campaign.endDateCalendar.ifBlank { campaign.endDate.take(10) }
    val areaLabels = campaign.targetedCityLabels.filter { it.isNotBlank() }
    val areaText = when {
        areaLabels.isNotEmpty() -> areaLabels.joinToString(", ")
        campaign.targetedRegionKeys.isNotEmpty() -> campaign.targetedRegionKeys.joinToString(", ")
        else -> ""
    }

    if (campaign.isDemoCampaign) {
        Surface(
            shape = RoundedCornerShape(10.dp),
            color = MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.45f),
            modifier = Modifier
                .fillMaxWidth()
                .border(DashboardOutlineWidth, DashboardOutlineColor, RoundedCornerShape(10.dp)),
        ) {
            Text(
                "Demo campaign — stats may reflect testing and placeholders, not a live paid run.",
                fontSize = 12.sp,
                color = MaterialTheme.colorScheme.onSecondaryContainer,
                lineHeight = 16.sp,
                modifier = Modifier.padding(12.dp),
            )
        }
        Spacer(Modifier.height(8.dp))
    }

    // Live ad preview — layout follows [placement] (prime vs list), matching the website hub preview.
    if (preview != null && (preview.headline.isNotBlank() || !preview.imageUrl.isNullOrBlank())) {
        Text("How your ad looks", color = FormColors.PrimaryButton, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(2.dp))
        Text(
            howYourAdLooksBlurb(campaign.placement, campaign.isEvent),
            fontSize = 11.sp,
            lineHeight = 15.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(6.dp))
        HowYourAdLooksBlock(
            placement = campaign.placement,
            isEvent = campaign.isEvent,
            preview = preview,
        )
        if (showPendingImagePreview && pendingPreview != null) {
            Spacer(Modifier.height(8.dp))
            Text("New image (pending review)", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(4.dp))
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .border(DashboardOutlineWidth, DashboardOutlineColor, RoundedCornerShape(10.dp)),
                shape = RoundedCornerShape(10.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.tertiaryContainer.copy(alpha = 0.35f)),
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    AsyncImage(
                        model = pendingImageNorm,
                        contentDescription = "Pending ad image",
                        modifier = Modifier.size(width = 88.dp, height = 66.dp),
                    )
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text(
                            "This replaces the live image after approval.",
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.onTertiaryContainer,
                        )
                    }
                }
            }
        } else if (pendingPreview != null) {
            Spacer(Modifier.height(6.dp))
            Text(
                "Other creative changes are pending review; the image above is what people still see until those are approved.",
                fontSize = 11.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                lineHeight = 15.sp,
            )
        }
        Spacer(Modifier.height(8.dp))
    }

    // Campaign details — single inset block so the section reads as one unit, not floating labels.
    Surface(
        shape = RoundedCornerShape(10.dp),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f),
        modifier = Modifier
            .fillMaxWidth()
            .border(DashboardOutlineWidth, DashboardOutlineColor, RoundedCornerShape(10.dp)),
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text("Status", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.height(4.dp))
                    StatusBadge(campaign.status)
                }
                Spacer(Modifier.width(12.dp))
                Column(
                    modifier = Modifier.weight(1f),
                    horizontalAlignment = Alignment.End,
                ) {
                    Text("Where it shows", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.height(4.dp))
                    Text(
                        placementDisplayLabel(campaign.placement),
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Medium,
                        textAlign = TextAlign.End,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }

            if (areaText.isNotBlank()) {
                Spacer(Modifier.height(8.dp))
                HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.25f))
                Spacer(Modifier.height(8.dp))
                Text("Audience areas", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(
                    areaText,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium,
                )
                if (campaign.targetingRadiusMiles > 0) {
                    Text(
                        "Within about ${campaign.targetingRadiusMiles} miles of your business",
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            if (startYmd.isNotBlank() || endYmd.isNotBlank()) {
                Spacer(Modifier.height(8.dp))
                HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.25f))
                Spacer(Modifier.height(8.dp))
                Text("Schedule", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(
                    "${startYmd.ifBlank { "-" }} to ${endYmd.ifBlank { "-" }}",
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium,
                )
            }
        }
    }

    Text("Recent performance", fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
    Spacer(Modifier.height(8.dp))

    if (sortedDaily.isNotEmpty()) {
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .border(DashboardOutlineWidth, DashboardOutlineColor, RoundedCornerShape(12.dp)),
            shape = RoundedCornerShape(12.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.25f)),
        ) {
            Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) {
                Text(
                    "Last 7 days (summary)",
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(6.dp))
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f))
                        .padding(vertical = 8.dp, horizontal = 4.dp),
                ) {
                    Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                        MetricColumn("Views", sumImp7.toString(), 21.sp, 11.sp)
                    }
                    Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                        MetricColumn("Clicks", sumClk7.toString(), 21.sp, 11.sp)
                    }
                    Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                        MetricColumn("Tapped", "%.1f%%".format(ctr7 * 100), 21.sp, 11.sp)
                    }
                }
            }
        }
        val uniqueReach = analytics.analytics.uniqueReach
        val frequency = analytics.analytics.frequency
        if (uniqueReach > 0) {
            Spacer(Modifier.height(8.dp))
            Text(
                "Est. unique viewers (rolling): $uniqueReach" + if (frequency > 0.0) {
                    " — avg. ${"%.1f".format(frequency)} impressions / viewer in window"
                } else "",
                fontSize = 12.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                lineHeight = 16.sp,
            )
        }
        Spacer(Modifier.height(10.dp))
        TextButton(onClick = { showDayByDayTable = !showDayByDayTable }) {
            Text(
                if (showDayByDayTable) "Hide day-by-day table" else "Show day-by-day table",
                fontSize = 14.sp,
            )
        }
        AnimatedVisibility(visible = showDayByDayTable) {
            Column {
                Text(
                    if (showAllDaily) "All days" else "Latest 7 days",
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Medium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(6.dp))
                Row(modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
                    Text("Day", fontSize = 12.sp, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1.2f))
                    Text("Views", fontSize = 12.sp, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(0.8f))
                    Text("Clicks", fontSize = 12.sp, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(0.8f))
                    Text("Tapped", fontSize = 12.sp, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(0.8f))
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.35f))
                visibleDaily.forEach { day ->
                    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                        Text(day.date.take(10), fontSize = 13.sp, modifier = Modifier.weight(1.2f))
                        Text(day.impressions.toString(), fontSize = 13.sp, modifier = Modifier.weight(0.8f))
                        Text(day.clicks.toString(), fontSize = 13.sp, modifier = Modifier.weight(0.8f))
                        Text("%.1f%%".format(day.ctr * 100), fontSize = 13.sp, modifier = Modifier.weight(0.8f))
                    }
                }
                if (sortedDaily.size > 7) {
                    TextButton(onClick = { showAllDaily = !showAllDaily }, modifier = Modifier.padding(top = 2.dp)) {
                        Text(
                            if (showAllDaily) "Show only latest 7 days" else "Show all ${sortedDaily.size} days",
                            fontSize = 13.sp,
                        )
                    }
                }
            }
        }
    } else {
        Text(
            "Daily stats will appear here once your ad starts reaching people.",
            fontSize = 13.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }

    Spacer(Modifier.height(8.dp))
    Text(
        "Reference: ...${campaign._id.takeLast(6)}",
        fontSize = 10.sp,
        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.75f),
    )

    Spacer(Modifier.height(10.dp))
    TextButton(onClick = { showCancellationNote = !showCancellationNote }) {
        Text(if (showCancellationNote) "Hide cancellation details" else "Cancellation & refunds", fontSize = 13.sp)
    }
    if (showCancellationNote) {
        Text(
            "Before your start date, use \"Withdraw before launch\" for pre-launch cancellation (refund or hold release per our terms). After the ad is live, use \"Cancel campaign\" - amounts already paid are not refunded.",
            fontSize = 12.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            lineHeight = 16.sp,
            modifier = Modifier.padding(bottom = 4.dp),
        )
    }
}

@Composable
private fun MetricColumn(
    label: String,
    value: String,
    valueSp: TextUnit = 20.sp,
    labelSp: TextUnit = 11.sp,
) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, fontSize = valueSp, fontWeight = FontWeight.Bold, color = FormColors.PrimaryButton)
        Text(label, fontSize = labelSp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun StatusBadge(status: String) {
    // Brand is teal; avoid mint “success” green on active (reads off-brand next to [FormColors.PrimaryButton]).
    val (bgColor, textColor) = when (status) {
        "active" -> FormColors.InfoChipBackground to Color(0xFF006064)
        "scheduled" -> FormColors.FilterBannerBackground to FormColors.PrimaryButton
        "completed" -> Color(0xFFF5F5F5) to Color(0xFF616161)
        "paused" -> Color(0xFFFFF3E0) to Color(0xFFE65100)
        "cancelled" -> Color(0xFFFFEBEE) to Color(0xFFC62828)
        else -> Color(0xFFF5F5F5) to Color(0xFF757575)
    }
    Surface(shape = RoundedCornerShape(20.dp), color = bgColor) {
        Text(
            status.replaceFirstChar { it.uppercase() },
            fontSize = 12.sp,
            color = textColor,
            fontWeight = FontWeight.Medium,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
        )
    }
}
