package org.community.playgroundfinder.ui.composables

import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.community.playgroundfinder.data.PlaygroundService
import org.community.playgroundfinder.models.AdCreativePayload
import org.community.playgroundfinder.models.AllAdsResponse
import org.community.playgroundfinder.util.MarketingLinks
import org.community.playgroundfinder.util.rememberOpenExternalUrl

@Composable
fun FeaturedAdCard(
    service: PlaygroundService,
    cityId: String?,
    onAdClick: (url: String) -> Unit,
    onNavigateToAdvertise: () -> Unit,
    userLat: Double? = null,
    userLng: Double? = null,
) {
    var allAdsResponse by remember { mutableStateOf<AllAdsResponse?>(null) }
    var loadFailed by remember { mutableStateOf(false) }
    var dailyViews by remember { mutableStateOf<Int?>(null) }
    var currentIndex by remember { mutableStateOf(0) }

    // Fetch all ads on load
    LaunchedEffect(cityId) {
        if (cityId == null) {
            allAdsResponse = null
            loadFailed = false
            return@LaunchedEffect
        }
        try {
            allAdsResponse = service.getAllAds(cityId, "featured_home")
            loadFailed = false
        } catch (_: Exception) {
            loadFailed = true
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
    val openExternalUrl = rememberOpenExternalUrl()

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(max = HomeDiscoverFeaturedHomeAdMaxTotalHeight)
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
        Column(Modifier.fillMaxWidth()) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(HomeDiscoverFeaturedAdHeroHeight)
                    .clip(RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp)),
            ) {
                if (!ad.imageUrl.isNullOrBlank()) {
                    AsyncImage(
                        model = ad.imageUrl,
                        contentDescription = ad.headline,
                        modifier = Modifier.fillMaxSize(),
                        contentScale = ContentScale.Crop,
                    )
                } else {
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .background(Color(0xFFB2EBF2).copy(alpha = 0.5f)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text("Sponsored", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Color(0xFF00838F))
                    }
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

            Spacer(Modifier.height(HomeDiscoverFeaturedAdBelowHeroSpacing))

            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 10.dp, vertical = 6.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        ad.headline,
                        fontWeight = FontWeight.Bold,
                        fontSize = 13.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    Spacer(Modifier.width(4.dp))
                    val badgeColor = when {
                        adType == "house" -> Color(0xFF808080)
                        ad.isEvent -> Color(0xFFFF8F00)
                        else -> Color(0xFF00CED1)
                    }
                    val badgeText = when {
                        adType == "house" -> "Sample"
                        ad.isEvent -> "Event"
                        else -> "Ad"
                    }
                    Surface(shape = RoundedCornerShape(6.dp), color = badgeColor) {
                        Text(badgeText, fontSize = 9.sp, color = Color.White, modifier = Modifier.padding(horizontal = 4.dp, vertical = 1.dp))
                    }
                }

                if (ad.businessName.isNotBlank() && !ad.businessName.equals("Your Business Name Here", ignoreCase = true)) {
                    Text(
                        ad.businessName,
                        fontSize = 10.sp,
                        color = Color.Gray,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }

                if (ad.showDistance && ad.businessLat != 0.0 && ad.businessLng != 0.0 && userLat != null && userLng != null) {
                    val distMeters = haversineMeters(userLat, userLng, ad.businessLat, ad.businessLng)
                    val distMiles = distMeters / 1609.34
                    val distText = if (distMiles < 0.1) "${distMeters.toInt()} m" else "%.1f mi".format(distMiles)
                    Text("📍 $distText", fontSize = 10.sp, color = Color(0xFF00CED1), maxLines = 1, overflow = TextOverflow.Ellipsis)
                }

                if (ad.isEvent) {
                    val dateDisplay = formatEventDateDisplay(ad.eventDate, ad.isRecurring)
                    if (dateDisplay != null) {
                        Text("\uD83D\uDCC5 $dateDisplay", fontSize = 10.sp, color = Color(0xFFFF8F00), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }

                if (ad.body.isNotBlank()) {
                    Text(
                        ad.body,
                        fontSize = 11.sp,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                        color = Color(0xFF424242),
                    )
                }

                if (adType == "house") {
                    // Box instead of Surface so no shadow/tonal overlap on the body text above.
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(Color(0xFF5E5E5E), RoundedCornerShape(8.dp)),
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                "Advertise with us",
                                fontSize = 11.sp,
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
                    TextButton(
                        onClick = { openExternalUrl(MarketingLinks.advertiserLanding()) },
                        modifier = Modifier.align(Alignment.Start),
                        contentPadding = PaddingValues(horizontal = 4.dp, vertical = 0.dp),
                    ) {
                        Text("View packages on website", fontSize = 11.sp, color = Color(0xFF00838F))
                    }
                }

                Spacer(Modifier.height(4.dp))
            }
        }
    }
}
