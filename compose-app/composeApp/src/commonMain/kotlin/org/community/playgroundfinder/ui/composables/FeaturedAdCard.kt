package org.community.playgroundfinder.ui.composables

import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.community.playgroundfinder.data.PlaygroundService
import org.community.playgroundfinder.events.eventCreativeGoogleCalendarUrl
import org.community.playgroundfinder.models.AdCreativePayload
import org.community.playgroundfinder.models.AllAdsResponse
import org.community.playgroundfinder.util.MarketingLinks
import org.community.playgroundfinder.util.rememberOpenExternalUrl

private fun featuredCropAlignment(s: String?): Alignment = when (s?.lowercase()) {
    "top" -> Alignment.TopCenter
    "bottom" -> Alignment.BottomCenter
    else -> Alignment.Center
}

@Composable
fun FeaturedAdCard(
    service: PlaygroundService,
    cityId: String?,
    onAdClick: (url: String) -> Unit,
    onNavigateToAdvertise: () -> Unit,
    userLat: Double? = null,
    userLng: Double? = null,
) {
    // Do not use remember(cityId): a brief null [cityId] (e.g. Home recomposing while lists clear) wipes state and
    // flashes the offline demo card even when ads load a moment later.
    var allAdsResponse by remember { mutableStateOf<AllAdsResponse?>(null) }
    var loadFailed by remember { mutableStateOf(false) }
    var dailyViews by remember { mutableStateOf<Int?>(null) }
    var currentIndex by remember { mutableStateOf(0) }

    // Fetch all ads when we have a region; keep last successful payload if [cityId] is temporarily null.
    LaunchedEffect(cityId) {
        if (cityId == null) {
            return@LaunchedEffect
        }
        currentIndex = 0
        try {
            val resp = service.getAllAds(cityId, "featured_home")
            allAdsResponse = resp
            loadFailed = false
            println("[Ads] FeaturedAdCard cityId=$cityId type=${resp.type} count=${resp.ads.size} phase=${resp.cityPhase}")
        } catch (e: Exception) {
            loadFailed = true
            println("[Ads] FeaturedAdCard fetch failed cityId=$cityId err=${e.message}")
        }
    }

    // Fetch daily views for house ads
    LaunchedEffect(cityId, allAdsResponse?.type) {
        if (cityId != null && allAdsResponse?.type == "house") {
            dailyViews = service.getDailyAdViews(cityId)
        }
    }

    val ads = allAdsResponse?.ads.orEmpty()
    val showLiveAds = !loadFailed && ads.isNotEmpty()
    val adType = allAdsResponse?.type ?: "house"

    // Timed rotation — cycle every 8 seconds if multiple ads
    LaunchedEffect(ads.size, showLiveAds) {
        if (showLiveAds && ads.size > 1) {
            while (true) {
                delay(8000L)
                currentIndex = (currentIndex + 1) % ads.size
            }
        }
    }

    val ad = if (showLiveAds) ads[currentIndex.coerceIn(0, ads.lastIndex)] else null
    val safeCityId = cityId ?: ""

    LaunchedEffect(ad?.id, showLiveAds) {
        if (!showLiveAds || ad == null) return@LaunchedEffect
        try {
            service.trackAdEvent(
                type = "impression", adId = ad.id, campaignId = ad.campaignId ?: "",
                cityId = safeCityId, placement = "featured_home",
            )
        } catch (_: Exception) {}
    }

    Column(Modifier.fillMaxWidth()) {
        if (loadFailed && cityId != null) {
            Text(
                "Can't load ads right now — sample preview below.",
                color = Color.White.copy(alpha = 0.9f),
                fontSize = 12.sp,
                lineHeight = 16.sp,
                fontWeight = FontWeight.Medium,
            )
            Spacer(Modifier.height(8.dp))
        }
        if (showLiveAds && ad != null) {
            Crossfade(targetState = ad.id, animationSpec = tween(400), label = "ad_rotate") { _ ->
                AdCardContent(
                    ad = ad, adType = adType,
                    dailyViews = dailyViews, adCount = ads.size, currentIndex = currentIndex,
                    onAdClick = onAdClick, onNavigateToAdvertise = onNavigateToAdvertise,
                    service = service, cityId = safeCityId,
                    userLat = userLat, userLng = userLng,
                )
            }
            // Calendar CTA below the prime slot when the rotated creative is an event with a date.
            // Sized with the same FilledTonalButton + leading icon as the inline / events surfaces
            // so it reads as the same affordance everywhere it appears.
            val openExternalUrl = rememberOpenExternalUrl()
            val calendarUrl = if (ad.isEvent) eventCreativeGoogleCalendarUrl(ad) else null
            if (calendarUrl != null) {
                Spacer(Modifier.height(8.dp))
                AddToCalendarButton(onClick = { openExternalUrl(calendarUrl) })
            }
        } else {
            FeaturedAdOfflineFallbackCard(onNavigateToAdvertise = onNavigateToAdvertise)
        }
    }
}

@Composable
private fun FeaturedAdOfflineFallbackCard(onNavigateToAdvertise: () -> Unit) {
    val openExternalUrl = rememberOpenExternalUrl()
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .wrapContentHeight()
            .clickable { onNavigateToAdvertise() },
        shape = RoundedCornerShape(20.dp),
        border = BorderStroke(1.dp, Color(0xFF00CED1).copy(alpha = 0.4f)),
        colors = CardDefaults.cardColors(containerColor = Color.White),
    ) {
        Column(
            modifier = Modifier
                .padding(horizontal = 12.dp, vertical = 10.dp)
                .fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "Promote your family-friendly business",
                    fontWeight = FontWeight.Bold,
                    fontSize = 14.sp,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Surface(shape = RoundedCornerShape(8.dp), color = Color(0xFF808080)) {
                    Text("Sample Ad", fontSize = 10.sp, color = Color.White, modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp))
                }
            }
            Text(
                "Reach local families while they discover playgrounds near you.",
                fontSize = 12.sp,
                color = Color(0xFF424242),
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
            )
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color(0xFF5E5E5E), RoundedCornerShape(10.dp)),
            ) {
                Text(
                    "Advertise with us — Tap to get started",
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Color.White,
                    modifier = Modifier
                        .padding(horizontal = 10.dp, vertical = 8.dp)
                        .fillMaxWidth(),
                    textAlign = TextAlign.Center,
                )
            }
            TextButton(
                onClick = { openExternalUrl(MarketingLinks.advertiserLanding()) },
                modifier = Modifier.align(Alignment.CenterHorizontally),
            ) {
                Text("Pricing & info on website", fontSize = 13.sp, color = Color(0xFF00838F))
            }
        }
    }
}

@Composable
private fun AdCardContent(
    ad: AdCreativePayload, adType: String,
    dailyViews: Int?, adCount: Int, currentIndex: Int,
    onAdClick: (String) -> Unit, onNavigateToAdvertise: () -> Unit,
    service: PlaygroundService, cityId: String,
    userLat: Double? = null, userLng: Double? = null,
) {
    val scope = rememberCoroutineScope()

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .wrapContentHeight(align = Alignment.Top)
            .clickable {
                scope.launch {
                    try {
                        service.trackAdEvent(type = "click", adId = ad.id, campaignId = ad.campaignId ?: "", cityId = cityId, placement = "featured_home")
                    } catch (_: Exception) {}
                }
                if (adType == "house") onNavigateToAdvertise() else onAdClick(ad.ctaUrl)
            },
        shape = RoundedCornerShape(20.dp),
        border = BorderStroke(1.dp, Color(0xFF00CED1).copy(alpha = 0.4f)),
        colors = CardDefaults.cardColors(containerColor = Color.White),
    ) {
        val businessTitle = ad.businessName.trim().let { bn ->
            if (bn.isBlank() || bn.equals("Your Business Name Here", ignoreCase = true)) "" else bn
        }
        val displayTitle = when {
            ad.isEvent && !ad.eventName.isNullOrBlank() -> ad.eventName!!.trim()
            businessTitle.isNotBlank() -> businessTitle
            ad.headline.isNotBlank() -> ad.headline.trim()
            else -> "Sponsored"
        }
        val ctaLabel = when (adType) {
            "house" -> "Advertise with us"
            else -> ad.ctaText.trim().ifBlank { "Learn more" }
        }

        // Half-width image column (layout start) + half-width copy: image height tracks text stack so the
        // creative fills the full vertical half (Crop), avoiding a short letterboxed strip on wide art.
        val layoutDir = LocalLayoutDirection.current
        val imageHalfShape = if (layoutDir == LayoutDirection.Rtl) {
            RoundedCornerShape(topStart = 0.dp, bottomStart = 0.dp, topEnd = 20.dp, bottomEnd = 20.dp)
        } else {
            RoundedCornerShape(topStart = 20.dp, bottomStart = 20.dp, topEnd = 0.dp, bottomEnd = 0.dp)
        }
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
                    .then(
                        if (!ad.imageUrl.isNullOrBlank()) {
                            Modifier.background(Color(0xFFEEEEEE))
                        } else {
                            Modifier
                        },
                    ),
            ) {
                if (!ad.imageUrl.isNullOrBlank()) {
                    // Fit keeps in-image text/artwork visible; grey backing matches [SponsoredListingCard] stack mode.
                    AsyncImage(
                        model = ad.imageUrl,
                        contentDescription = displayTitle,
                        modifier = Modifier.fillMaxSize(),
                        contentScale = ContentScale.Fit,
                        alignment = featuredCropAlignment(ad.imageAlignment),
                    )
                } else {
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .background(Color(0xFFB2EBF2).copy(alpha = 0.5f)),
                    )
                }
                if (adCount > 1) {
                    Row(
                        modifier = Modifier
                            .align(Alignment.BottomCenter)
                            .padding(bottom = 6.dp),
                        horizontalArrangement = Arrangement.Center,
                    ) {
                        repeat(adCount) { i ->
                            Box(
                                modifier = Modifier
                                    .padding(horizontal = 3.dp)
                                    .size(if (i == currentIndex) 7.dp else 5.dp),
                            ) {
                                Surface(
                                    shape = RoundedCornerShape(50),
                                    color = if (i == currentIndex) Color(0xFF00CED1) else Color(0xFFBDBDBD),
                                    modifier = Modifier.fillMaxSize(),
                                ) {}
                            }
                        }
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
                    .padding(start = 8.dp, end = 10.dp, top = 8.dp, bottom = 8.dp),
                verticalArrangement = Arrangement.SpaceBetween,
            ) {
                val dateReadable =
                    if (ad.isEvent) formatEventDateReadableLine(ad.eventDate, ad.isRecurring) else null
                // Format the prime/featured slot's When/Where to match SponsoredListingCardSplit:
                // bold "When:" / "Where:" labels in the same dark color, value text trailing.
                val whenLine = if (ad.isEvent) {
                    listOfNotNull(
                        dateReadable?.trim()?.takeIf { it.isNotEmpty() },
                        ad.eventTime?.trim()?.takeIf { it.isNotEmpty() },
                    ).joinToString(" at ").ifBlank { null }
                } else {
                    null
                }
                val whereLine = if (ad.isEvent) ad.eventLocation?.trim()?.takeIf { it.isNotEmpty() } else null

                Column(
                    modifier = Modifier.fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Text(
                        displayTitle,
                        fontWeight = FontWeight.Bold,
                        fontSize = 13.sp,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                        color = Color(0xFF212121),
                        lineHeight = 17.sp,
                    )

                    if (!whenLine.isNullOrBlank()) {
                        Text(
                            text = featuredEventLine("When:", whenLine),
                            fontSize = 12.sp,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                            lineHeight = 16.sp,
                        )
                    }
                    if (!whereLine.isNullOrBlank()) {
                        Text(
                            text = featuredEventLine("Where:", whereLine),
                            fontSize = 12.sp,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                            lineHeight = 16.sp,
                        )
                    }

                    if (ad.body.isNotBlank()) {
                        Text(
                            ad.body,
                            fontSize = 11.sp,
                            maxLines = 18,
                            overflow = TextOverflow.Clip,
                            color = Color(0xFF424242),
                            lineHeight = 14.sp,
                        )
                    }
                }

                Column(
                    modifier = Modifier.fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    horizontalAlignment = Alignment.Start,
                ) {
                    if (ad.showDistance && ad.businessLat != 0.0 && ad.businessLng != 0.0 && userLat != null && userLng != null) {
                        val distMeters = haversineMeters(userLat, userLng, ad.businessLat, ad.businessLng)
                        val distMiles = distMeters / 1609.34
                        val distText = if (distMiles < 0.1) "${distMeters.toInt()} m" else "%.1f mi".format(distMiles)
                        Text(
                            "📍 $distText",
                            fontSize = 9.sp,
                            color = Color(0xFF757575),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        when {
                            ad.isEvent -> EventBadgePill()
                            adType == "house" -> {
                                Surface(shape = RoundedCornerShape(6.dp), color = Color(0xFF808080)) {
                                    Text(
                                        "Sample",
                                        modifier = Modifier.padding(horizontal = 7.dp, vertical = 3.dp),
                                        fontSize = 10.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        color = Color.White,
                                    )
                                }
                            }
                            else -> AdIndicatorPill()
                        }
                        if (adType == "house") {
                            Box(
                                modifier = Modifier
                                    .weight(1f)
                                    .background(Color(0xFF5E5E5E), RoundedCornerShape(8.dp)),
                            ) {
                                Row(
                                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Text(
                                        ctaLabel,
                                        fontSize = 12.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        color = Color.White,
                                        modifier = Modifier.weight(1f),
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                    if (dailyViews != null && dailyViews > 0) {
                                        Text("👤 $dailyViews", fontSize = 9.sp, color = Color.White.copy(alpha = 0.85f))
                                    }
                                }
                            }
                        } else {
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
        }
    }
}

private fun featuredEventLine(
    label: String,
    value: String,
): androidx.compose.ui.text.AnnotatedString = buildAnnotatedString {
    withStyle(SpanStyle(fontWeight = FontWeight.Bold, color = Color(0xFF263238))) {
        append(label)
    }
    append(" ")
    withStyle(SpanStyle(color = Color(0xFF37474F))) {
        append(value)
    }
}
