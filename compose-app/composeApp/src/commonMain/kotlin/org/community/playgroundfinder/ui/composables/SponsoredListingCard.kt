package org.community.playgroundfinder.ui.composables

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons as MaterialIcons
import androidx.compose.material.icons.filled.NearMe
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.LayoutDirection
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

private fun cropAlignmentFromLabel(s: String?): Alignment = when (s?.lowercase()) {
    "top" -> Alignment.TopCenter
    "bottom" -> Alignment.BottomCenter
    else -> Alignment.Center
}

/**
 * @param matchCarouselMinHeight When true, tile height matches the home carousel; list rows use
 * a full-width hero the same height as [PlaygroundItem] ([PlaygroundListCardImageHeight]).
 * @param compactCarouselHero When true with [matchCarouselMinHeight] and a creative image, uses a shorter
 * hero ([HomeDiscoverCarouselAdImageHeight]) so text and CTA have more room (home carousel only).
 * @param imageUrl Creative image from the campaign (optional).
 * @param showCategory When false, hides the category line (cleaner list/search cards).
 * @param imageContentScale [ContentScale.Fit] shows the full image in list mode with letterboxing; [ContentScale.Crop] fills the frame.
 * @param useSplitLayout When true, uses the same image-leading / copy-trailing half-and-half layout as [FeaturedAdCard]
 * (hero uses [imageContentScale], defaulting to a letterboxed fit in split so in-image art stays visible).
 * For the legacy top/bottom stack, pass [useSplitLayout] `false` (e.g. previews). Product surfaces use split by default.
 * Ad/Event/Sample chips sit in the same row as the main CTA.
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
    useSplitLayout: Boolean = true,
    /** Server: top | center | bottom — vertical focal in the image half (with [ContentScale.Fit] in split). */
    imageAlignment: String? = null,
) {
    val openExternalUrl = rememberOpenExternalUrl()
    val hasCreativeImage = !imageUrl.isNullOrBlank()
    /** Same rhythm as [PlaygroundItem] on All Sites / long lists — not the home carousel tile. */
    val listMode = !matchCarouselMinHeight && !useSplitLayout

    if (useSplitLayout) {
        SponsoredListingCardSplit(
            businessName = businessName,
            category = category,
            description = description,
            websiteUrl = websiteUrl,
            onLearnMore = onLearnMore,
            isSample = isSample,
            onSampleTap = onSampleTap,
            isEvent = isEvent,
            eventDate = eventDate,
            isRecurring = isRecurring,
            userLat = userLat,
            userLng = userLng,
            businessLat = businessLat,
            businessLng = businessLng,
            showDistance = showDistance,
            matchCarouselMinHeight = matchCarouselMinHeight,
            hasCreativeImage = hasCreativeImage,
            imageUrl = imageUrl,
            showCategory = showCategory,
            imageContentScale = imageContentScale,
            imageAlignment = imageAlignment,
        )
        return
    }
    val minTotalHeight = when {
        !matchCarouselMinHeight -> 0.dp
        compactCarouselHero && hasCreativeImage -> HomeDiscoverCarouselAdMinTotalHeight
        hasCreativeImage -> HomeDiscoverPlaygroundCardMinTotalHeight
        else -> HomeDiscoverInlineAdCompactMinTotalHeight
    }
    val imageHeight = when {
        listMode -> PlaygroundListCardImageHeight
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
        border = if (listMode) {
            null
        } else {
            BorderStroke(1.5.dp, if (isEvent) Color(0xFFFF8F00) else Color(0xFF00CED1))
        },
        colors = CardDefaults.cardColors(containerColor = Color(0xFFFFFFFF)),
        elevation = CardDefaults.cardElevation(
            defaultElevation = when {
                listMode -> 2.dp
                matchCarouselMinHeight -> 0.dp
                else -> 2.dp
            },
        ),
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
                            when {
                                listMode && (hasCreativeImage && imageContentScale == ContentScale.Fit || !hasCreativeImage) ->
                                    Modifier.background(FormColors.CardBackground)
                                hasCreativeImage && imageContentScale == ContentScale.Fit ->
                                    Modifier.background(Color(0xFFEEEEEE))
                                else -> Modifier
                            },
                        ),
                ) {
                    if (hasCreativeImage) {
                        AsyncImage(
                            model = imageUrl,
                            contentDescription = null,
                            modifier = Modifier.fillMaxSize(),
                            contentScale = imageContentScale,
                            alignment = cropAlignmentFromLabel(imageAlignment),
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
                        }
                    }
                }

                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = if (listMode) 12.dp else 10.dp),
                    verticalArrangement = Arrangement.spacedBy(if (listMode) 4.dp else 6.dp),
                ) {
                    val eventDateReadable = if (isEvent) formatEventDateReadableLine(eventDate, isRecurring) else null
                    if (listMode) {
                        Text(
                            businessName,
                            fontWeight = FontWeight.Bold,
                            fontSize = 16.sp,
                            color = Color(0xFF212121),
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.fillMaxWidth(),
                            lineHeight = 20.sp,
                        )
                    } else {
                        Text(
                            businessName,
                            fontWeight = FontWeight.Bold,
                            fontSize = 16.sp,
                            color = Color(0xFF212121),
                            maxLines = 3,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.fillMaxWidth(),
                            lineHeight = 20.sp,
                        )
                        if (!eventDateReadable.isNullOrBlank()) {
                            Text(
                                "\uD83D\uDCC5 $eventDateReadable",
                                fontSize = 12.sp,
                                color = Color(0xFF212121),
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                                lineHeight = 16.sp,
                            )
                        }
                    }
                    if (listMode && !eventDateReadable.isNullOrBlank()) {
                        Text(
                            "\uD83D\uDCC5 $eventDateReadable",
                            fontSize = 12.sp,
                            color = Color(0xFF212121),
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                            lineHeight = 16.sp,
                        )
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
                    if (!listMode && showDistance && businessLat != null && businessLat != 0.0 && businessLng != null && businessLng != 0.0 && userLat != null && userLng != null) {
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
                            maxLines = 24,
                            overflow = TextOverflow.Clip,
                            modifier = Modifier.fillMaxWidth(),
                            lineHeight = 18.sp,
                        )
                    }
                    if (listMode && showDistance && businessLat != null && businessLat != 0.0 && businessLng != null && businessLng != 0.0 && userLat != null && userLng != null) {
                        val distMeters = haversineMeters(userLat, userLng, businessLat, businessLng)
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(2.dp),
                            modifier = Modifier.padding(top = 2.dp),
                        ) {
                            Icon(MaterialIcons.Filled.NearMe, null, modifier = Modifier.size(13.dp), tint = Color.Gray)
                            Text(distanceText(distMeters), fontSize = 12.sp, color = Color.Gray)
                        }
                    }
                }
            }

            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = if (listMode) 8.dp else 8.dp),
                horizontalAlignment = if (listMode) Alignment.Start else Alignment.CenterHorizontally,
                verticalArrangement = if (listMode) Arrangement.spacedBy(6.dp) else Arrangement.Top,
            ) {
                if (isSample) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.Top,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Surface(shape = RoundedCornerShape(6.dp), color = Color(0xFF808080)) {
                            Text(
                                "Sample",
                                fontSize = 11.sp,
                                color = Color.White,
                                fontWeight = FontWeight.Medium,
                                modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                            )
                        }
                        Column(
                            modifier = Modifier.weight(1f),
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
                    }
                } else if (!websiteUrl.isNullOrBlank()) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        if (isEvent) EventBadgePill() else AdIndicatorPill()
                        OutlinedButton(
                            onClick = { onLearnMore(websiteUrl) },
                            modifier = Modifier.weight(1f),
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
}

@Composable
private fun SponsoredListingCardSplit(
    businessName: String,
    category: String?,
    description: String?,
    websiteUrl: String?,
    onLearnMore: (String) -> Unit,
    isSample: Boolean,
    onSampleTap: (() -> Unit)?,
    isEvent: Boolean,
    eventDate: String?,
    isRecurring: Boolean,
    userLat: Double?,
    userLng: Double?,
    businessLat: Double?,
    businessLng: Double?,
    showDistance: Boolean,
    matchCarouselMinHeight: Boolean,
    hasCreativeImage: Boolean,
    imageUrl: String?,
    showCategory: Boolean,
    imageContentScale: ContentScale,
    imageAlignment: String? = null,
) {
    val openExternalUrl = rememberOpenExternalUrl()
    val layoutDir = LocalLayoutDirection.current
    val corner = 16.dp
    val imageHalfShape = if (layoutDir == LayoutDirection.Rtl) {
        RoundedCornerShape(topStart = 0.dp, bottomStart = 0.dp, topEnd = corner, bottomEnd = corner)
    } else {
        RoundedCornerShape(topStart = corner, bottomStart = corner, topEnd = 0.dp, bottomEnd = 0.dp)
    }

    val dateReadable = if (isEvent) formatEventDateReadableLine(eventDate, isRecurring) else null
    // List/search split mode must use a *bounded* height so [Column] children with [Modifier.weight]
    // do not get infinite max constraints (which collapses the text block to zero height in practice).
    val sizeModifier = if (matchCarouselMinHeight) {
        Modifier.height(HomeDiscoverPlaygroundCardMinTotalHeight)
    } else {
        Modifier.height(PlaygroundListCardImageHeight)
    }
    val titleToShow = businessName.ifBlank { if (isSample) "Sample" else "Sponsored" }
    val bodyMaxLines = if (matchCarouselMinHeight) 24 else 6

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(corner))
            .then(sizeModifier)
            .then(
                if (isSample && onSampleTap != null) Modifier.clickable { onSampleTap() } else Modifier,
            ),
        shape = RoundedCornerShape(corner),
        border = BorderStroke(1.5.dp, if (isEvent) Color(0xFFFF8F00) else Color(0xFF00CED1)),
        colors = CardDefaults.cardColors(containerColor = Color(0xFFFFFFFF)),
        elevation = CardDefaults.cardElevation(defaultElevation = if (matchCarouselMinHeight) 0.dp else 2.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxSize(),
            verticalAlignment = Alignment.Top,
        ) {
            Box(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxHeight()
                    .clip(imageHalfShape)
                    .then(
                        if (hasCreativeImage && imageUrl != null) {
                            Modifier.background(Color(0xFFEEEEEE))
                        } else {
                            Modifier.background(
                                Brush.linearGradient(
                                    listOf(Color(0xFFB2EBF2), Color(0xFFE0F7FA)),
                                ),
                            )
                        },
                    ),
            ) {
                if (hasCreativeImage && imageUrl != null) {
                    AsyncImage(
                        model = imageUrl,
                        contentDescription = null,
                        modifier = Modifier.fillMaxSize(),
                        contentScale = imageContentScale,
                        alignment = cropAlignmentFromLabel(imageAlignment),
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
            ) {
                Column(
                    modifier = Modifier
                        .weight(1f, fill = true)
                        .fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Text(
                        titleToShow,
                        fontWeight = FontWeight.Bold,
                        fontSize = 14.sp,
                        color = Color(0xFF212121),
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                        lineHeight = 18.sp,
                    )
                    if (!dateReadable.isNullOrBlank()) {
                        Text(
                            "\uD83D\uDCC5 $dateReadable",
                            fontSize = 12.sp,
                            color = Color(0xFF212121),
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                            lineHeight = 17.sp,
                        )
                    }
                    if (isEvent) {
                        val countdown = getEventCountdown(eventDate)
                        if (countdown != null) {
                            Text(
                                countdown,
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold,
                                color = Color(0xFFFF8F00),
                            )
                        }
                    }
                    if (showCategory && !category.isNullOrBlank()) {
                        Text(
                            category,
                            fontSize = 11.sp,
                            color = Color.Gray,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    description?.let { body ->
                        Text(
                            body,
                            fontSize = 12.sp,
                            color = Color(0xFF424242),
                            maxLines = bodyMaxLines,
                            overflow = if (matchCarouselMinHeight) TextOverflow.Clip else TextOverflow.Ellipsis,
                            lineHeight = 17.sp,
                        )
                    }
                }

                Column(
                    modifier = Modifier.fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    horizontalAlignment = Alignment.Start,
                ) {
                    if (showDistance && businessLat != null && businessLat != 0.0 && businessLng != null && businessLng != 0.0 && userLat != null && userLng != null) {
                        val distMeters = haversineMeters(userLat, userLng, businessLat, businessLng)
                        val distMiles = distMeters / 1609.34
                        val distText = if (distMiles < 0.1) "${distMeters.toInt()} m" else "%.1f mi".format(distMiles)
                        Text(
                            "📍 $distText",
                            fontSize = 9.sp,
                            color = Color(0xFF757575),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                    when {
                        isSample && onSampleTap != null -> {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                Surface(shape = RoundedCornerShape(6.dp), color = Color(0xFF808080)) {
                                    Text(
                                        "Sample",
                                        modifier = Modifier.padding(horizontal = 7.dp, vertical = 3.dp),
                                        fontSize = 10.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        color = Color.White,
                                    )
                                }
                                Column(
                                    modifier = Modifier.weight(1f),
                                    verticalArrangement = Arrangement.spacedBy(8.dp),
                                ) {
                                    Surface(
                                        shape = RoundedCornerShape(8.dp),
                                        color = Color(0xFF5E5E5E),
                                        modifier = Modifier.fillMaxWidth(),
                                    ) {
                                        Text(
                                            "Advertise with us — tap to get started",
                                            fontSize = 11.sp,
                                            fontWeight = FontWeight.SemiBold,
                                            color = Color.White,
                                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp),
                                            textAlign = TextAlign.Center,
                                        )
                                    }
                                    OutlinedButton(
                                        onClick = { openExternalUrl(MarketingLinks.advertiserLanding()) },
                                        modifier = Modifier.fillMaxWidth(),
                                        shape = RoundedCornerShape(10.dp),
                                        border = BorderStroke(1.dp, Color(0xFF00CED1)),
                                        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
                                    ) {
                                        Text(
                                            "Pricing & packages",
                                            fontSize = 12.sp,
                                            color = Color(0xFF00CED1),
                                            fontWeight = FontWeight.SemiBold,
                                        )
                                    }
                                }
                            }
                        }
                        !websiteUrl.isNullOrBlank() -> {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                if (isEvent) {
                                    EventBadgePill()
                                } else {
                                    AdIndicatorPill()
                                }
                                OutlinedButton(
                                    onClick = { onLearnMore(websiteUrl) },
                                    modifier = Modifier.weight(1f),
                                    shape = RoundedCornerShape(10.dp),
                                    border = BorderStroke(1.dp, Color(0xFF00CED1)),
                                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
                                ) {
                                    Text(
                                        "Learn More",
                                        fontSize = 12.sp,
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
        }
    }
}
