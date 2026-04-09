package org.community.playgroundfinder.ui.composables

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import org.community.playgroundfinder.util.MarketingLinks
import org.community.playgroundfinder.util.rememberOpenExternalUrl

/**
 * @param matchCarouselMinHeight When true, tile height matches the home carousel; list rows use
 * a full-width hero the same height as [PlaygroundItem] ([PlaygroundListCardImageHeight]).
 * @param compactCarouselHero When true with [matchCarouselMinHeight] and a creative image, uses a shorter
 * hero ([HomeDiscoverCarouselAdImageHeight]) so text and CTA have more room (home carousel only).
 * @param imageUrl Creative image from the campaign (optional).
 * @param showCategory When false, hides the category line (cleaner list/search cards).
 * @param imageContentScale [ContentScale.Fit] shows the full image in list mode with letterboxing; [ContentScale.Crop] fills the frame.
 */
@Composable
fun SponsoredListingCard(
    businessName: String,
    category: String?,
    description: String?,
    websiteUrl: String?,
    onLearnMore: (String) -> Unit,
    isSample: Boolean = false,
    onSampleTap: (() -> Unit)? = null,
    isEvent: Boolean = false,
    eventDate: String? = null,
    isRecurring: Boolean = false,
    userLat: Double? = null,
    userLng: Double? = null,
    businessLat: Double? = null,
    businessLng: Double? = null,
    showDistance: Boolean = false,
    matchCarouselMinHeight: Boolean = true,
    compactCarouselHero: Boolean = false,
    imageUrl: String? = null,
    showCategory: Boolean = false,
    imageContentScale: ContentScale = ContentScale.Crop,
) {
    val openExternalUrl = rememberOpenExternalUrl()
    val hasCreativeImage = !imageUrl.isNullOrBlank()
    val minTotalHeight = when {
        !matchCarouselMinHeight -> 0.dp
        compactCarouselHero && hasCreativeImage -> HomeDiscoverCarouselAdMinTotalHeight
        hasCreativeImage -> HomeDiscoverPlaygroundCardMinTotalHeight
        else -> HomeDiscoverInlineAdCompactMinTotalHeight
    }
    val imageHeight = when {
        !matchCarouselMinHeight && hasCreativeImage -> InlineListingSearchAdImageHeight
        !matchCarouselMinHeight -> PlaygroundListCardImageHeight
        compactCarouselHero && hasCreativeImage -> HomeDiscoverCarouselAdImageHeight
        hasCreativeImage -> HomeDiscoverHeroImageHeight
        else -> HomeDiscoverInlineAdImageHeight
    }

    val useFlexibleCarouselHeight = compactCarouselHero && matchCarouselMinHeight && minTotalHeight > 0.dp
    val cardModifier = Modifier
        .fillMaxWidth()
        .clip(RoundedCornerShape(16.dp))
        .then(
            if (isSample && onSampleTap != null) Modifier.clickable { onSampleTap() } else Modifier,
        )
        .then(
            when {
                useFlexibleCarouselHeight -> Modifier.heightIn(min = minTotalHeight)
                matchCarouselMinHeight && minTotalHeight > 0.dp -> Modifier.height(minTotalHeight)
                else -> Modifier.heightIn(min = 1.dp)
            },
        )

    Card(
        modifier = cardModifier,
        shape = RoundedCornerShape(16.dp),
        border = BorderStroke(1.5.dp, if (isEvent) Color(0xFFFF8F00) else Color(0xFF00CED1)),
        colors = CardDefaults.cardColors(containerColor = Color(0xFFFFFFFF)),
        elevation = CardDefaults.cardElevation(defaultElevation = if (matchCarouselMinHeight) 0.dp else 2.dp),
    ) {
        val topShape = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp)
        val packTightCarousel = useFlexibleCarouselHeight
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = if (matchCarouselMinHeight && minTotalHeight > 0.dp && !packTightCarousel) {
                Arrangement.SpaceBetween
            } else {
                Arrangement.Top
            },
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .then(
                        if (matchCarouselMinHeight && minTotalHeight > 0.dp && !packTightCarousel) {
                            Modifier.fillMaxHeight()
                        } else {
                            Modifier
                        },
                    ),
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(imageHeight)
                        .clip(topShape)
                        .then(
                            if (hasCreativeImage && imageContentScale == ContentScale.Fit) {
                                Modifier.background(Color(0xFFEEEEEE))
                            } else {
                                Modifier
                            },
                        ),
                ) {
                    if (hasCreativeImage) {
                        AsyncImage(
                            model = imageUrl,
                            contentDescription = null,
                            modifier = Modifier.fillMaxSize(),
                            contentScale = imageContentScale,
                        )
                    } else {
                        Box(
                            modifier = Modifier
                                .fillMaxSize()
                                .background(
                                    Brush.linearGradient(
                                        listOf(Color(0xFFB2EBF2), Color(0xFFE0F7FA)),
                                    ),
                                ),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                if (isEvent) "Event" else "Sponsored",
                                fontWeight = FontWeight.SemiBold,
                                fontSize = 13.sp,
                                color = Color(0xFF006064),
                            )
                        }
                    }
                }

                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    val badgeColor = when {
                        isSample -> Color(0xFF808080)
                        isEvent -> Color(0xFFFF8F00)
                        else -> Color(0xFF00CED1)
                    }
                    val badgeText = when {
                        isSample -> "Sample"
                        isEvent -> "Event"
                        else -> "Sponsored"
                    }
                    val eventDateTopLine = if (isEvent) formatEventDateDisplay(eventDate, isRecurring) else null
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            businessName,
                            fontWeight = FontWeight.Bold,
                            fontSize = 16.sp,
                            color = Color(0xFF212121),
                            maxLines = 3,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f),
                            lineHeight = 20.sp,
                        )
                        Spacer(Modifier.width(8.dp))
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            if (eventDateTopLine != null) {
                                Text(
                                    "\uD83D\uDCC5 $eventDateTopLine",
                                    fontSize = 12.sp,
                                    color = Color(0xFFFF8F00),
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                            Surface(shape = RoundedCornerShape(6.dp), color = badgeColor) {
                                Text(
                                    badgeText,
                                    fontSize = 11.sp,
                                    color = Color.White,
                                    fontWeight = FontWeight.Medium,
                                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                                )
                            }
                        }
                    }
                    if (showCategory && !category.isNullOrBlank()) {
                        Text(
                            category,
                            fontSize = 13.sp,
                            color = Color.Gray,
                            modifier = Modifier.fillMaxWidth(),
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    if (showDistance && businessLat != null && businessLat != 0.0 && businessLng != null && businessLng != 0.0 && userLat != null && userLng != null) {
                        val distMeters = haversineMeters(userLat, userLng, businessLat, businessLng)
                        val distMiles = distMeters / 1609.34
                        val distText = if (distMiles < 0.1) "${(distMeters).toInt()} m" else "%.1f mi".format(distMiles)
                        Text("📍 $distText", fontSize = 12.sp, color = Color(0xFF757575))
                    }
                    if (isEvent) {
                        val countdown = getEventCountdown(eventDate)
                        if (countdown != null) {
                            Text(countdown, fontSize = 11.sp, fontWeight = FontWeight.Bold, color = Color(0xFFFF8F00))
                        }
                    }
                    description?.let {
                        Text(
                            it,
                            fontSize = 13.sp,
                            color = Color(0xFF424242),
                            maxLines = 6,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.fillMaxWidth(),
                            lineHeight = 18.sp,
                        )
                    }
                }
            }

            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                if (isSample) {
                    Column(
                        modifier = Modifier.fillMaxWidth(),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Surface(
                            shape = RoundedCornerShape(10.dp),
                            color = Color(0xFF5E5E5E),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text(
                                "Advertise with us — tap to get started",
                                fontSize = 12.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = Color.White,
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                                textAlign = TextAlign.Center,
                            )
                        }
                        OutlinedButton(
                            onClick = { openExternalUrl(MarketingLinks.advertiserLanding()) },
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(12.dp),
                            border = BorderStroke(1.dp, Color(0xFF00CED1)),
                            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                        ) {
                            Text(
                                "Pricing & packages (website)",
                                fontSize = 13.sp,
                                color = Color(0xFF00CED1),
                                fontWeight = FontWeight.SemiBold,
                            )
                        }
                    }
                } else if (!websiteUrl.isNullOrBlank()) {
                    OutlinedButton(
                        onClick = { onLearnMore(websiteUrl) },
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                        border = BorderStroke(1.dp, Color(0xFF00CED1)),
                        contentPadding = PaddingValues(horizontal = 20.dp, vertical = 8.dp),
                    ) {
                        Text(
                            "Learn More",
                            fontSize = 13.sp,
                            color = Color(0xFF00CED1),
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.fillMaxWidth(),
                            textAlign = TextAlign.Center,
                        )
                    }
                }
            }
        }
    }
}
