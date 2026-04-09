package org.community.playgroundfinder.ui.screens.advertising

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import kotlinx.coroutines.launch
import org.community.playgroundfinder.data.CampaignAnalyticsData
import org.community.playgroundfinder.data.PlaygroundService
import org.community.playgroundfinder.models.AdCampaignStats
import org.community.playgroundfinder.ui.composables.FormColors
import org.community.playgroundfinder.ui.composables.SponsoredListingCard
import org.community.playgroundfinder.util.MarketingLinks
import org.community.playgroundfinder.util.rememberOpenExternalUrl

@Composable
fun AdvertiserDashboardScreen(
    playgroundService: PlaygroundService,
    /**
     * When set (e.g. Home overflow â†’ one campaign), only that row is shown, expanded, so the user
     * is not scrolling the full list. Use [onViewAllCampaigns] to switch to the full dashboard.
     */
    soloCampaignId: String? = null,
    onViewAllCampaigns: () -> Unit = {},
    onNavigateToAdvertise: () -> Unit = {},
    onRenew: (submissionId: String, regionKey: String) -> Unit = { _, _ -> },
    onBack: () -> Unit,
    /** Android: opens gallery + crop, then uploads and PATCHes creative `imageUrl`. */
    onPickCreativeImage: ((campaignId: String, submissionId: String) -> Unit)? = null,
    /** Incremented after a successful image replace so the dashboard can refresh previews. */
    externalReloadNonce: Int = 0,
    /**
     * Android: while a cropped dashboard image is uploading (or before the API returns a staged preview URL),
     * `first` is the campaign id and `second` is an on-device JPEG path so Coil can show â€œpendingâ€ next to the
     * live image in the edit dialog.
     */
    pendingLocalCreativePreview: Pair<String, String>? = null,
) {
    val scope = rememberCoroutineScope()
    val openExternalUrl = rememberOpenExternalUrl()
    val soloId = soloCampaignId?.trim()?.takeIf { it.isNotEmpty() }
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
    var editImagePreviewUrl by remember { mutableStateOf<String?>(null) }
    /** Staged creative image URL from analytics when the server exposes a pending creative preview. */
    var editPendingRemoteImageUrl by remember { mutableStateOf<String?>(null) }
    var editSaving by remember { mutableStateOf(false) }
    var editError by remember { mutableStateOf<String?>(null) }

    // Cancel live campaign (no refund) â€” only for active ads
    var cancellingCampaignId by remember { mutableStateOf<String?>(null) }
    var cancelInProgress by remember { mutableStateOf(false) }
    var cancelError by remember { mutableStateOf<String?>(null) }

    // Withdraw before launch (prelaunch-cancel API â€” refund / release per server rules)
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
                // Silently fail â€” the expanded section just won't show daily data
            }
            analyticsLoading = analyticsLoading - campaignId
        }
    }

    fun openEditDialog(campaignId: String) {
        editHeadline = ""
        editBody = ""
        editCtaText = ""
        editCtaUrl = ""
        editImagePreviewUrl = null
        editPendingRemoteImageUrl = null
        editError = null
        editSaving = false
        editingCampaignId = campaignId
        editingSubmissionId = campaigns.find { it._id == campaignId }?.submissionId?.trim().orEmpty()
        scope.launch {
            try {
                val data = playgroundService.getCampaignAnalytics(campaignId)
                val p = data.campaign.creativePreview
                if (p != null) {
                    editHeadline = p.headline
                    editBody = p.body
                    editCtaText = p.ctaText
                    editCtaUrl = p.ctaUrl
                    editImagePreviewUrl = p.imageUrl?.trim()?.takeIf { it.isNotBlank() }
                    editPendingRemoteImageUrl = data.campaign.pendingCreativePreview
                        ?.imageUrl?.trim()?.takeIf { it.isNotBlank() }
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

    val displayedCampaigns = remember(campaigns, soloId) {
        if (soloId != null) campaigns.filter { it._id == soloId } else campaigns
    }

    LaunchedEffect(soloId, campaigns, isLoading) {
        if (isLoading) return@LaunchedEffect
        val id = soloId ?: return@LaunchedEffect
        if (campaigns.any { it._id == id }) {
            expandedCampaignId = id
            loadAnalytics(id)
        }
    }

    LaunchedEffect(externalReloadNonce) {
        if (externalReloadNonce <= 0) return@LaunchedEffect
        loadCampaigns()
        val cid = editingCampaignId ?: return@LaunchedEffect
        try {
            val data = playgroundService.getCampaignAnalytics(cid)
            editImagePreviewUrl = data.campaign.creativePreview?.imageUrl?.trim()?.takeIf { it.isNotBlank() }
            editPendingRemoteImageUrl = data.campaign.pendingCreativePreview
                ?.imageUrl?.trim()?.takeIf { it.isNotBlank() }
        } catch (_: Exception) { }
    }

    // â”€â”€â”€ Edit Creative Dialog â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
                    val pendingLocalPath =
                        pendingLocalCreativePreview?.takeIf { it.first == editingCampaignId }?.second
                    val pendingRemote = editPendingRemoteImageUrl?.takeIf { it.isNotBlank() }
                    val pendingModel = pendingLocalPath ?: pendingRemote
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Column(
                            modifier = Modifier.weight(1f),
                            verticalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            Text("Live now", fontSize = 11.sp, color = Color.DarkGray, fontWeight = FontWeight.Medium)
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(120.dp)
                                    .clip(RoundedCornerShape(10.dp))
                                    .background(FormColors.CardBackground),
                                contentAlignment = Alignment.Center,
                            ) {
                                if (!editImagePreviewUrl.isNullOrBlank()) {
                                    AsyncImage(
                                        model = editImagePreviewUrl,
                                        contentDescription = "Current ad image",
                                        modifier = Modifier.fillMaxSize(),
                                        contentScale = ContentScale.Crop,
                                    )
                                } else {
                                    Text("No image", color = Color.Gray, fontSize = 11.sp)
                                }
                            }
                        }
                        Column(
                            modifier = Modifier.weight(1f),
                            verticalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            Text(
                                "Pending / your pick",
                                fontSize = 11.sp,
                                color = Color.DarkGray,
                                fontWeight = FontWeight.Medium,
                            )
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(120.dp)
                                    .clip(RoundedCornerShape(10.dp))
                                    .background(Color(0xFFF5F5F5)),
                                contentAlignment = Alignment.Center,
                            ) {
                                if (pendingModel != null) {
                                    AsyncImage(
                                        model = pendingModel,
                                        contentDescription = "Pending ad image",
                                        modifier = Modifier.fillMaxSize(),
                                        contentScale = ContentScale.Crop,
                                    )
                                } else {
                                    Text(
                                        "Same as live until you upload a new picture",
                                        color = Color.Gray,
                                        fontSize = 11.sp,
                                        modifier = Modifier.padding(horizontal = 6.dp),
                                    )
                                }
                            }
                        }
                    }
                    Text(
                        "Cropping uses the same wide banner shape as inline listing ads so the preview matches how your photo is clipped in the app.",
                        fontSize = 11.sp,
                        color = Color.DarkGray,
                        lineHeight = 15.sp,
                    )
                    if (onPickCreativeImage != null) {
                        if (editingSubmissionId.isNotBlank()) {
                            OutlinedButton(
                                onClick = {
                                    onPickCreativeImage.invoke(editingCampaignId!!, editingSubmissionId)
                                },
                                enabled = !editSaving,
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Text("Change pictureâ€¦")
                            }
                            Text(
                                "Pick a new photo, crop it, then we upload it. Live ads keep the old image until review approves the new one.",
                                fontSize = 11.sp,
                                color = Color.DarkGray,
                            )
                        } else {
                            Text(
                                "Picture changes arenâ€™t available for this campaign (missing submission link). Contact support if you need help.",
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

    // â”€â”€â”€ Withdraw before launch (prelaunch-cancel) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (prelaunchSubmissionId != null) {
        AlertDialog(
            onDismissRequest = { if (!prelaunchInProgress) prelaunchSubmissionId = null },
            title = { Text("Withdraw before launch?", fontWeight = FontWeight.Bold) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(
                        "Your campaign hasnâ€™t started yet. Weâ€™ll cancel the submission and scheduled campaign. If your card was charged, youâ€™ll typically receive a full refund; if only a hold was placed, it will be released.",
                        fontSize = 14.sp,
                    )
                    Text(
                        "This matches â€œWithdraw submissionâ€ on your submission status screen.",
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

    // â”€â”€â”€ Cancel live campaign (no refund for amounts already paid) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
    ) {
        Box(modifier = Modifier.fillMaxSize()) {
            when {
                isLoading -> CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))

                errorMessage != null -> Column(
                    modifier = Modifier.align(Alignment.Center).padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text("âš ï¸ $errorMessage", fontSize = 14.sp, color = FormColors.ErrorText)
                    Spacer(Modifier.height(12.dp))
                    TextButton(onClick = { loadCampaigns() }) { Text("Retry", color = FormColors.PrimaryButton) }
                }

                soloId != null && !isLoading && campaigns.isNotEmpty() && displayedCampaigns.isEmpty() -> Column(
                    modifier = Modifier.align(Alignment.Center).padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text("That campaign isnâ€™t on your account anymore.", fontSize = 15.sp, color = Color(0xFF424242))
                    Spacer(Modifier.height(16.dp))
                    Button(
                        onClick = onViewAllCampaigns,
                        modifier = Modifier.fillMaxWidth(0.85f).height(48.dp),
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = FormColors.PrimaryButton,
                            contentColor = FormColors.PrimaryButtonText,
                        ),
                    ) {
                        Text("All campaigns", fontWeight = FontWeight.SemiBold)
                    }
                }

                campaigns.isEmpty() -> Column(
                    modifier = Modifier.align(Alignment.Center),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text("ðŸ“Š", fontSize = 48.sp)
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
                    TextButton(onClick = { openExternalUrl(MarketingLinks.advertiserLanding()) }) {
                        Text("Placements & pricing (website)", color = FormColors.PrimaryButton)
                    }
                    Spacer(Modifier.height(8.dp))
                    TextButton(onClick = { loadCampaigns() }) { Text("Refresh", color = FormColors.PrimaryButton) }
                }

                else -> LazyColumn(
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    if (soloId == null) {
                        item {
                            Card(
                                modifier = Modifier.fillMaxWidth(),
                                shape = RoundedCornerShape(12.dp),
                                colors = CardDefaults.cardColors(containerColor = Color(0xFFF5F7F8)),
                            ) {
                                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                    Text(
                                        "Advertising hub",
                                        fontWeight = FontWeight.SemiBold,
                                        fontSize = 15.sp,
                                        color = Color(0xFF263238),
                                    )
                                    Text(
                                        "Start a new campaign or manage the ones below. Tap a row for details and last weekâ€™s numbers.",
                                        fontSize = 13.sp,
                                        color = Color(0xFF546E7A),
                                        lineHeight = 18.sp,
                                    )
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        Button(
                                            onClick = onNavigateToAdvertise,
                                            modifier = Modifier.weight(1f).height(44.dp),
                                            shape = RoundedCornerShape(10.dp),
                                            colors = ButtonDefaults.buttonColors(
                                                containerColor = FormColors.PrimaryButton,
                                                contentColor = FormColors.PrimaryButtonText,
                                            ),
                                        ) {
                                            Text("New ad", fontWeight = FontWeight.SemiBold)
                                        }
                                        TextButton(
                                            onClick = { openExternalUrl(MarketingLinks.advertiserLanding()) },
                                            modifier = Modifier.weight(1f),
                                        ) {
                                            Text("Pricing", color = FormColors.PrimaryButton, fontSize = 13.sp)
                                        }
                                    }
                                }
                            }
                        }
                    } else {
                        item {
                            Card(
                                modifier = Modifier.fillMaxWidth(),
                                shape = RoundedCornerShape(12.dp),
                                colors = CardDefaults.cardColors(containerColor = Color(0xFFF5F7F8)),
                            ) {
                                Row(
                                    Modifier
                                        .fillMaxWidth()
                                        .padding(horizontal = 12.dp, vertical = 10.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                ) {
                                    Column(Modifier.weight(1f)) {
                                        Text(
                                            "This campaign",
                                            fontWeight = FontWeight.SemiBold,
                                            fontSize = 14.sp,
                                            color = Color(0xFF263238),
                                        )
                                        Text(
                                            "Showing one ad. Open the full list anytime.",
                                            fontSize = 12.sp,
                                            color = Color(0xFF546E7A),
                                            lineHeight = 16.sp,
                                        )
                                    }
                                    TextButton(onClick = onViewAllCampaigns) {
                                        Text("All campaigns", color = FormColors.PrimaryButton, fontWeight = FontWeight.SemiBold)
                                    }
                                }
                            }
                        }
                    }
                    items(displayedCampaigns, key = { it._id }) { campaign ->
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
                        val isSolo = soloId != null
                        val expanded = isSolo || expandedCampaignId == campaign._id

                        CampaignCard(
                            campaign = campaign,
                            isExpanded = expanded,
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
                                if (isSolo) {
                                    /* Single-campaign mode: always expanded; no accordion toggle. */
                                } else if (expandedCampaignId == campaign._id) {
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
        modifier = Modifier.fillMaxWidth().clickable(onClick = onToggle),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
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
                            .padding(end = 10.dp)
                            .clip(RoundedCornerShape(8.dp)),
                        contentScale = ContentScale.Crop,
                    )
                } else {
                    Text("ðŸ“ˆ", fontSize = 24.sp, modifier = Modifier.width(36.dp).padding(end = 8.dp))
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
                                if (startCal.isNotEmpty()) append(" â†’ ") else append("Through ")
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
                Text(if (isExpanded) "â–²" else "â–¼", fontSize = 12.sp, color = Color.Gray)
            }

            // Expanded detail section
            AnimatedVisibility(visible = isExpanded) {
                Column(modifier = Modifier.padding(top = 8.dp)) {
                    HorizontalDivider(modifier = Modifier.padding(bottom = 6.dp))

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceEvenly,
                    ) {
                        MetricColumn("Views", campaign.impressions.toString())
                        MetricColumn("Clicks", campaign.clicks.toString())
                        MetricColumn("Tapped", clickRateFormatted)
                    }

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

                    if (isAnalyticsLoading) {
                        Spacer(Modifier.height(8.dp))
                        Box(modifier = Modifier.fillMaxWidth().padding(vertical = 16.dp), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 2.dp)
                        }
                    } else if (analytics != null) {
                        Spacer(Modifier.height(8.dp))
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
    var showDailyBreakdown by remember { mutableStateOf(false) }
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
    Spacer(Modifier.height(2.dp))

    // Live ad preview - same side-by-side card as in-app; prime = home row height, inline = min-height row.
    if (preview != null && (preview.headline.isNotBlank() || !preview.imageUrl.isNullOrBlank())) {
        Text("How it looks in the app", fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(4.dp))
        val title = preview.headline.ifBlank { preview.businessName.ifBlank { "Sponsored" } }
        val isPrime = campaign.placement == "featured_home"
        if (isPrime) {
            SponsoredListingCard(
                businessName = title,
                category = null,
                description = preview.body.takeIf { it.isNotBlank() },
                websiteUrl = preview.ctaUrl.takeIf { it.isNotBlank() },
                onLearnMore = { },
                isEvent = campaign.isEvent,
                matchCarouselMinHeight = true,
                imageUrl = preview.imageUrl?.takeIf { it.isNotBlank() },
                showCategory = false,
                imageContentScale = ContentScale.Fit,
            )
        } else {
            SponsoredListingCard(
                businessName = title,
                category = null,
                description = preview.body.takeIf { it.isNotBlank() },
                websiteUrl = preview.ctaUrl.takeIf { it.isNotBlank() },
                onLearnMore = { },
                isEvent = campaign.isEvent,
                matchCarouselMinHeight = false,
                imageUrl = preview.imageUrl?.takeIf { it.isNotBlank() },
                showCategory = false,
                imageContentScale = ContentScale.Fit,
            )
        }
        val pending = campaign.pendingCreativePreview
        if (pending != null && (!pending.imageUrl.isNullOrBlank() || pending.headline.isNotBlank())) {
            Spacer(Modifier.height(10.dp))
            Text("Replacement pending review", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(4.dp))
            val pTitle = pending.headline.ifBlank { pending.businessName.ifBlank { title } }
            if (isPrime) {
                SponsoredListingCard(
                    businessName = pTitle,
                    category = null,
                    description = pending.body.takeIf { it.isNotBlank() },
                    websiteUrl = pending.ctaUrl.takeIf { it.isNotBlank() },
                    onLearnMore = { },
                    isEvent = campaign.isEvent,
                    matchCarouselMinHeight = true,
                    imageUrl = pending.imageUrl?.takeIf { it.isNotBlank() },
                    showCategory = false,
                    imageContentScale = ContentScale.Fit,
                )
            } else {
                SponsoredListingCard(
                    businessName = pTitle,
                    category = null,
                    description = pending.body.takeIf { it.isNotBlank() },
                    websiteUrl = pending.ctaUrl.takeIf { it.isNotBlank() },
                    onLearnMore = { },
                    isEvent = campaign.isEvent,
                    matchCarouselMinHeight = false,
                    imageUrl = pending.imageUrl?.takeIf { it.isNotBlank() },
                    showCategory = false,
                    imageContentScale = ContentScale.Fit,
                )
            }
        }
        Spacer(Modifier.height(8.dp))
    }

    Text("Recent performance", fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
    Spacer(Modifier.height(6.dp))

    if (sortedDaily.isNotEmpty()) {
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.25f)),
        ) {
            Column(modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp)) {
                Text(
                    "Last 7 days",
                    fontSize = 11.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(6.dp))
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                    MetricColumn("Views", sumImp7.toString())
                    MetricColumn("Clicks", sumClk7.toString())
                    MetricColumn("% tapped", "%.2f%%".format(ctr7 * 100))
                }
            }
        }
        Spacer(Modifier.height(6.dp))

        TextButton(onClick = { showDailyBreakdown = !showDailyBreakdown }) {
            Text(
                if (showDailyBreakdown) "Hide day-by-day table" else "Show day-by-day table",
                fontSize = 13.sp,
            )
        }

        if (showDailyBreakdown) {
            Text(
                if (showAllDaily) "All days" else "Latest 7 days",
                fontSize = 11.sp,
                fontWeight = FontWeight.Medium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(4.dp))

            Row(modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
                Text("Day", fontSize = 11.sp, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1.2f))
                Text("Views", fontSize = 11.sp, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(0.8f))
                Text("Clicks", fontSize = 11.sp, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(0.8f))
                Text("% tapped", fontSize = 11.sp, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(0.8f))
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.35f))

            visibleDaily.forEach { day ->
                Row(modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp)) {
                    Text(day.date.take(10), fontSize = 12.sp, modifier = Modifier.weight(1.2f))
                    Text(day.impressions.toString(), fontSize = 12.sp, modifier = Modifier.weight(0.8f))
                    Text(day.clicks.toString(), fontSize = 12.sp, modifier = Modifier.weight(0.8f))
                    Text("%.1f%%".format(day.ctr * 100), fontSize = 12.sp, modifier = Modifier.weight(0.8f))
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
    } else {
        Text(
            "Daily stats will appear here once your ad starts reaching people.",
            fontSize = 13.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }

    Spacer(Modifier.height(8.dp))
    Text(
        "Reference: â€¦${campaign._id.takeLast(6)}",
        fontSize = 10.sp,
        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.75f),
    )

    Spacer(Modifier.height(10.dp))
    TextButton(onClick = { showCancellationNote = !showCancellationNote }) {
        Text(if (showCancellationNote) "Hide cancellation details" else "Cancellation & refunds", fontSize = 13.sp)
    }
    if (showCancellationNote) {
        Text(
            "Before your start date, use â€œWithdraw before launchâ€ for pre-launch cancellation (refund or hold release per our terms). After the ad is live, use â€œCancel campaignâ€ â€” amounts already paid are not refunded.",
            fontSize = 12.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            lineHeight = 16.sp,
            modifier = Modifier.padding(bottom = 4.dp),
        )
    }
}

@Composable
private fun MetricColumn(label: String, value: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, fontSize = 17.sp, fontWeight = FontWeight.Bold)
        Text(label, fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun StatusBadge(status: String) {
    val (bgColor, textColor) = when (status) {
        "active" -> Color(0xFFE8F5E9) to Color(0xFF2E7D32)
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
