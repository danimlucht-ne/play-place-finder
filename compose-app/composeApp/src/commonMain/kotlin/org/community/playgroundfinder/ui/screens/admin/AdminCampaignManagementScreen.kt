package org.community.playgroundfinder.ui.screens.admin

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.community.playgroundfinder.data.PlaygroundService
import org.community.playgroundfinder.models.AdminCampaignItem
import org.community.playgroundfinder.models.AdvertiserListItem
import org.community.playgroundfinder.ui.composables.FormColors

private val STATUS_FILTERS = listOf("All", "Active", "Paused", "Scheduled", "Completed", "Cancelled")

private fun adminPlacementLabel(raw: String): String = when (raw) {
    "featured_home" -> "Home featured"
    "inline_listing" -> "Search listing"
    else -> raw.replace('_', ' ').replaceFirstChar { it.uppercase() }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AdminCampaignManagementScreen(
    service: PlaygroundService,
    onBack: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var campaigns by remember { mutableStateOf<List<AdminCampaignItem>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var errorMsg by remember { mutableStateOf<String?>(null) }
    var selectedFilter by remember { mutableStateOf("All") }
    var actionLoading by remember { mutableStateOf<Set<String>>(emptySet()) }
    var successMsg by remember { mutableStateOf<String?>(null) }
    var lifecycleRunning by remember { mutableStateOf(false) }

    // Dialog states
    var extendTarget by remember { mutableStateOf<AdminCampaignItem?>(null) }
    var cancelTarget by remember { mutableStateOf<AdminCampaignItem?>(null) }
    var refundTarget by remember { mutableStateOf<AdminCampaignItem?>(null) }

    // Advertiser section state
    var advertisers by remember { mutableStateOf<List<AdvertiserListItem>>(emptyList()) }
    var advertisersExpanded by remember { mutableStateOf(false) }
    var advertisersLoading by remember { mutableStateOf(false) }

    fun loadCampaigns() {
        scope.launch {
            isLoading = true
            errorMsg = null
            try {
                val statusParam = if (selectedFilter == "All") null else selectedFilter.lowercase()
                val envelope = service.getAdminCampaigns(status = statusParam, page = 1, limit = 100)
                campaigns = envelope.data
            } catch (e: Exception) {
                errorMsg = e.message ?: "Failed to load campaigns"
            } finally {
                isLoading = false
            }
        }
    }

    fun loadAdvertisers() {
        scope.launch {
            advertisersLoading = true
            try {
                advertisers = service.getAdvertisers()
            } catch (_: Exception) {}
            advertisersLoading = false
        }
    }

    LaunchedEffect(selectedFilter) { loadCampaigns() }

    // ── Extend Dialog ─────────────────────────────────────────────────────────
    extendTarget?.let { campaign ->
        ExtendDialog(
            campaignId = campaign._id,
            businessName = campaign.businessName,
            onDismiss = { extendTarget = null },
            onConfirm = { days, reason ->
                extendTarget = null
                scope.launch {
                    actionLoading = actionLoading + campaign._id
                    try {
                        service.adminExtendCampaign(campaign._id, days, reason.ifBlank { null })
                        successMsg = "Extended ${campaign.businessName} by $days days"
                        loadCampaigns()
                    } catch (e: Exception) {
                        errorMsg = "Extend failed: ${e.message}"
                    }
                    actionLoading = actionLoading - campaign._id
                }
            }
        )
    }

    // ── Cancel Dialog ─────────────────────────────────────────────────────────
    cancelTarget?.let { campaign ->
        CancelDialog(
            campaignId = campaign._id,
            businessName = campaign.businessName,
            onDismiss = { cancelTarget = null },
            onConfirm = { reason ->
                cancelTarget = null
                scope.launch {
                    actionLoading = actionLoading + campaign._id
                    try {
                        service.adminCancelCampaign(campaign._id, reason.ifBlank { null })
                        successMsg = "Cancelled ${campaign.businessName}"
                        loadCampaigns()
                    } catch (e: Exception) {
                        errorMsg = "Cancel failed: ${e.message}"
                    }
                    actionLoading = actionLoading - campaign._id
                }
            }
        )
    }

    // ── Refund Dialog ─────────────────────────────────────────────────────────
    refundTarget?.let { campaign ->
        RefundDialog(
            campaignId = campaign._id,
            businessName = campaign.businessName,
            onDismiss = { refundTarget = null },
            onConfirm = { type, amountInCents, reason ->
                refundTarget = null
                scope.launch {
                    actionLoading = actionLoading + campaign._id
                    try {
                        service.adminRefundCampaign(
                            campaign._id, type,
                            if (type == "partial") amountInCents else null,
                            reason.ifBlank { null }
                        )
                        successMsg = "Refund issued for ${campaign.businessName}"
                        loadCampaigns()
                    } catch (e: Exception) {
                        errorMsg = "Refund failed: ${e.message}"
                    }
                    actionLoading = actionLoading - campaign._id
                }
            }
        )
    }

    Column(modifier = Modifier.fillMaxSize()) {
        // Success / error banners
        successMsg?.let { msg ->
            Surface(
                color = Color(0xFFE8F5E9),
                shape = RoundedCornerShape(8.dp),
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp)
            ) {
                Row(
                    modifier = Modifier.padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(msg, color = Color(0xFF2E7D32), fontSize = 13.sp, modifier = Modifier.weight(1f))
                    TextButton(onClick = { successMsg = null }) { Text("OK", fontSize = 12.sp) }
                }
            }
        }

        // Run Lifecycle button
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.End
        ) {
            Button(
                onClick = {
                    scope.launch {
                        lifecycleRunning = true
                        try {
                            val result = service.runLifecycle()
                            successMsg = "Lifecycle: ${result.activated} activated, ${result.completed} completed, ${result.expired} expired"
                            loadCampaigns()
                        } catch (e: Exception) {
                            errorMsg = "Lifecycle run failed: ${e.message}"
                        } finally {
                            lifecycleRunning = false
                        }
                    }
                },
                enabled = !lifecycleRunning,
                colors = ButtonDefaults.buttonColors(
                    containerColor = FormColors.PrimaryButton,
                    contentColor = FormColors.PrimaryButtonText
                ),
                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
                shape = RoundedCornerShape(8.dp)
            ) {
                if (lifecycleRunning) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(16.dp),
                        strokeWidth = 2.dp,
                        color = FormColors.PrimaryButtonText
                    )
                    Spacer(Modifier.width(6.dp))
                }
                Text("Run Lifecycle", fontSize = 13.sp)
            }
        }

        // Collapsible Advertisers section
        Surface(
            shape = RoundedCornerShape(8.dp),
            color = Color(0xFFF5F5F5),
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp)
        ) {
            Column {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable {
                            advertisersExpanded = !advertisersExpanded
                            if (advertisersExpanded && advertisers.isEmpty()) loadAdvertisers()
                        }
                        .padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(
                        "Advertisers${if (advertisers.isNotEmpty()) " (${advertisers.size})" else ""}",
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 14.sp
                    )
                    Text(
                        if (advertisersExpanded) "▲" else "▼",
                        fontSize = 12.sp,
                        color = Color.Gray
                    )
                }
                if (advertisersExpanded) {
                    if (advertisersLoading) {
                        Box(
                            modifier = Modifier.fillMaxWidth().padding(12.dp),
                            contentAlignment = Alignment.Center
                        ) { CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp) }
                    } else if (advertisers.isEmpty()) {
                        Text(
                            "No advertisers found",
                            fontSize = 13.sp,
                            color = Color.Gray,
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)
                        )
                    } else {
                        advertisers.forEach { adv ->
                            Row(
                                modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(adv.businessName.ifBlank { "Unknown" }, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                                    Text(adv.regionKey.ifBlank { "—" }, fontSize = 11.sp, color = Color.Gray)
                                }
                                Column(horizontalAlignment = Alignment.End) {
                                    Text("${adv.submissionCount} subs", fontSize = 11.sp, color = Color.Gray)
                                    Text("${adv.campaignCount} camps", fontSize = 11.sp, color = Color.Gray)
                                }
                            }
                            HorizontalDivider(modifier = Modifier.padding(horizontal = 12.dp))
                        }
                    }
                }
            }
        }

        // Status filter chips
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            STATUS_FILTERS.forEach { filter ->
                FilterChip(
                    selected = selectedFilter == filter,
                    onClick = { selectedFilter = filter },
                    label = { Text(filter, fontSize = 13.sp) },
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = FormColors.SelectedChip,
                        selectedLabelColor = FormColors.SelectedChipText,
                    )
                )
            }
        }

        when {
            isLoading -> Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center
            ) { CircularProgressIndicator() }

            errorMsg != null && campaigns.isEmpty() -> Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("Error: $errorMsg", color = FormColors.ErrorText, fontSize = 14.sp)
                    Spacer(Modifier.height(12.dp))
                    Button(
                        onClick = { errorMsg = null; loadCampaigns() },
                        colors = ButtonDefaults.buttonColors(
                            containerColor = FormColors.PrimaryButton,
                            contentColor = FormColors.PrimaryButtonText
                        )
                    ) { Text("Retry") }
                }
            }

            campaigns.isEmpty() -> Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center
            ) {
                Text("No campaigns found", color = Color.Gray, fontSize = 14.sp)
            }

            else -> LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                item {
                    Text(
                        "${campaigns.size} campaign${if (campaigns.size != 1) "s" else ""}",
                        fontSize = 13.sp,
                        color = Color.Gray
                    )
                }
                items(campaigns, key = { it._id }) { campaign ->
                    CampaignCard(
                        campaign = campaign,
                        isActionLoading = campaign._id in actionLoading,
                        onExtend = { extendTarget = campaign },
                        onPause = {
                            scope.launch {
                                actionLoading = actionLoading + campaign._id
                                try {
                                    service.adminPauseCampaign(campaign._id)
                                    successMsg = "Paused ${campaign.businessName}"
                                    loadCampaigns()
                                } catch (e: Exception) {
                                    errorMsg = "Pause failed: ${e.message}"
                                }
                                actionLoading = actionLoading - campaign._id
                            }
                        },
                        onUnpause = {
                            scope.launch {
                                actionLoading = actionLoading + campaign._id
                                try {
                                    service.adminUnpauseCampaign(campaign._id)
                                    successMsg = "Unpaused ${campaign.businessName}"
                                    loadCampaigns()
                                } catch (e: Exception) {
                                    errorMsg = "Unpause failed: ${e.message}"
                                }
                                actionLoading = actionLoading - campaign._id
                            }
                        },
                        onCancel = { cancelTarget = campaign },
                        onRefund = { refundTarget = campaign },
                    )
                }
            }
        }
    }
}

// ─── Campaign Card ───────────────────────────────────────────────────────────

@Composable
private fun CampaignCard(
    campaign: AdminCampaignItem,
    isActionLoading: Boolean,
    onExtend: () -> Unit,
    onPause: () -> Unit,
    onUnpause: () -> Unit,
    onCancel: () -> Unit,
    onRefund: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        elevation = CardDefaults.cardElevation(1.dp),
        colors = CardDefaults.cardColors(containerColor = FormColors.CardBackground)
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            // Header row: business name + status badge
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        campaign.businessName.ifBlank { "Unknown Business" },
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 15.sp
                    )
                    if (campaign.headline.isNotBlank()) {
                        Text(
                            campaign.headline,
                            fontSize = 13.sp,
                            color = Color.Gray,
                            maxLines = 1
                        )
                    }
                }
                CampaignStatusBadge(campaign.status)
            }

            Spacer(Modifier.height(6.dp))

            // Details grid
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                DetailLabel("Placement", adminPlacementLabel(campaign.placement).ifBlank { "—" })
                DetailLabel("Areas", "${campaign.targetedRegionKeys.size}")
            }
            Spacer(Modifier.height(2.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                DetailLabel("Dates", "${formatShortDate(campaign.startDate)} – ${formatShortDate(campaign.endDate)}")
            }
            Spacer(Modifier.height(2.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                DetailLabel("Views", "${campaign.impressions}")
                DetailLabel("Clicks", "${campaign.clicks}")
            }

            Spacer(Modifier.height(8.dp))

            // Action buttons
            if (isActionLoading) {
                Box(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                }
            } else {
                CampaignActions(
                    status = campaign.status,
                    onExtend = onExtend,
                    onPause = onPause,
                    onUnpause = onUnpause,
                    onCancel = onCancel,
                    onRefund = onRefund,
                )
            }
        }
    }
}

@Composable
private fun DetailLabel(label: String, value: String) {
    Column {
        Text(label, fontSize = 11.sp, color = Color.Gray)
        Text(value, fontSize = 13.sp, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun CampaignStatusBadge(status: String) {
    val color = campaignStatusColor(status)
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(6.dp))
            .background(color.copy(alpha = 0.12f))
            .padding(horizontal = 8.dp, vertical = 3.dp)
    ) {
        Text(
            status.replaceFirstChar { it.uppercase() },
            fontSize = 11.sp,
            color = color,
            fontWeight = FontWeight.Medium
        )
    }
}

@Composable
private fun CampaignActions(
    status: String,
    onExtend: () -> Unit,
    onPause: () -> Unit,
    onUnpause: () -> Unit,
    onCancel: () -> Unit,
    onRefund: () -> Unit,
) {
    val lowerStatus = status.lowercase()
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        when (lowerStatus) {
            "active" -> {
                SmallActionButton("Extend", FormColors.PrimaryButton, Modifier.weight(1f), onExtend)
                SmallActionButton("Pause", Color(0xFFFF9800), Modifier.weight(1f), onPause)
                SmallActionButton("Cancel", FormColors.ErrorText, Modifier.weight(1f), onCancel)
                SmallActionButton("Refund", Color(0xFF7B1FA2), Modifier.weight(1f), onRefund)
            }
            "paused" -> {
                SmallActionButton("Unpause", Color(0xFF4CAF50), Modifier.weight(1f), onUnpause)
                SmallActionButton("Cancel", FormColors.ErrorText, Modifier.weight(1f), onCancel)
                SmallActionButton("Refund", Color(0xFF7B1FA2), Modifier.weight(1f), onRefund)
            }
            "scheduled" -> {
                SmallActionButton("Extend", FormColors.PrimaryButton, Modifier.weight(1f), onExtend)
                SmallActionButton("Cancel", FormColors.ErrorText, Modifier.weight(1f), onCancel)
                SmallActionButton("Refund", Color(0xFF7B1FA2), Modifier.weight(1f), onRefund)
            }
            "completed", "cancelled" -> {
                SmallActionButton("Refund", Color(0xFF7B1FA2), Modifier.weight(1f), onRefund)
            }
        }
    }
}

@Composable
private fun SmallActionButton(
    text: String,
    color: Color,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    OutlinedButton(
        onClick = onClick,
        modifier = modifier,
        contentPadding = PaddingValues(horizontal = 6.dp, vertical = 4.dp),
        colors = ButtonDefaults.outlinedButtonColors(contentColor = color),
        shape = RoundedCornerShape(8.dp)
    ) {
        Text(text, fontSize = 11.sp, maxLines = 1)
    }
}

private fun campaignStatusColor(status: String): Color = when (status.lowercase()) {
    "active" -> Color(0xFF4CAF50)
    "paused" -> Color(0xFFFF9800)
    "scheduled" -> Color(0xFF2196F3)
    "completed" -> Color(0xFF607D8B)
    "cancelled" -> Color(0xFFF44336)
    else -> Color.Gray
}

private fun formatShortDate(isoDate: String): String {
    if (isoDate.length < 10) return isoDate
    return isoDate.substring(5, 10) // MM-DD
}

// ─── Extend Dialog ───────────────────────────────────────────────────────────

@Composable
private fun ExtendDialog(
    campaignId: String,
    businessName: String,
    onDismiss: () -> Unit,
    onConfirm: (days: Int, reason: String) -> Unit,
) {
    var daysText by remember { mutableStateOf("") }
    var reason by remember { mutableStateOf("") }
    val days = daysText.toIntOrNull() ?: 0
    val isValid = days in 1..90

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Extend Campaign") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Extend \"$businessName\"", fontSize = 13.sp, color = Color.Gray)
                OutlinedTextField(
                    value = daysText,
                    onValueChange = { daysText = it.filter { c -> c.isDigit() }.take(2) },
                    label = { Text("Days (1–90)") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    modifier = Modifier.fillMaxWidth(),
                    isError = daysText.isNotEmpty() && !isValid
                )
                OutlinedTextField(
                    value = reason,
                    onValueChange = { reason = it },
                    label = { Text("Reason (optional)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onConfirm(days, reason) },
                enabled = isValid
            ) { Text("Extend", color = if (isValid) FormColors.PrimaryButton else Color.Gray) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        }
    )
}

// ─── Cancel Dialog ───────────────────────────────────────────────────────────

@Composable
private fun CancelDialog(
    campaignId: String,
    businessName: String,
    onDismiss: () -> Unit,
    onConfirm: (reason: String) -> Unit,
) {
    var reason by remember { mutableStateOf("") }
    var confirmed by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Cancel Campaign", color = FormColors.ErrorText) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    "This will cancel \"$businessName\". This action cannot be undone.",
                    fontSize = 13.sp
                )
                OutlinedTextField(
                    value = reason,
                    onValueChange = { reason = it },
                    label = { Text("Reason (optional)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = confirmed, onCheckedChange = { confirmed = it })
                    Text("I confirm this cancellation", fontSize = 13.sp)
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onConfirm(reason) },
                enabled = confirmed
            ) { Text("Cancel Campaign", color = if (confirmed) FormColors.ErrorText else Color.Gray) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Go Back") }
        }
    )
}

// ─── Refund Dialog ───────────────────────────────────────────────────────────

@Composable
private fun RefundDialog(
    campaignId: String,
    businessName: String,
    onDismiss: () -> Unit,
    onConfirm: (type: String, amountInCents: Int?, reason: String) -> Unit,
) {
    var isFullRefund by remember { mutableStateOf(true) }
    var amountText by remember { mutableStateOf("") }
    var reason by remember { mutableStateOf("") }

    val amountCents = amountText.replace(".", "").toIntOrNull()
    val isValid = if (isFullRefund) true else (amountCents != null && amountCents > 0)

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Issue Refund") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Refund \"$businessName\"", fontSize = 13.sp, color = Color.Gray)

                Row(verticalAlignment = Alignment.CenterVertically) {
                    RadioButton(selected = isFullRefund, onClick = { isFullRefund = true })
                    Text("Full refund", fontSize = 14.sp)
                    Spacer(Modifier.width(16.dp))
                    RadioButton(selected = !isFullRefund, onClick = { isFullRefund = false })
                    Text("Partial refund", fontSize = 14.sp)
                }

                if (!isFullRefund) {
                    OutlinedTextField(
                        value = amountText,
                        onValueChange = { amountText = it.filter { c -> c.isDigit() || c == '.' } },
                        label = { Text("Amount (\u0024)") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        modifier = Modifier.fillMaxWidth(),
                        isError = amountText.isNotEmpty() && !isValid
                    )
                }

                OutlinedTextField(
                    value = reason,
                    onValueChange = { reason = it },
                    label = { Text("Reason (optional)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    val type = if (isFullRefund) "full" else "partial"
                    // Convert dollar string to cents
                    val cents = if (!isFullRefund) {
                        val parts = amountText.split(".")
                        val dollars = parts[0].toIntOrNull() ?: 0
                        val centsPart = if (parts.size > 1) parts[1].take(2).padEnd(2, '0').toIntOrNull() ?: 0 else 0
                        dollars * 100 + centsPart
                    } else null
                    onConfirm(type, cents, reason)
                },
                enabled = isValid
            ) { Text("Issue Refund", color = if (isValid) Color(0xFF7B1FA2) else Color.Gray) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        }
    )
}
