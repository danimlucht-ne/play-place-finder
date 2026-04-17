package org.community.playgroundfinder.ui.composables

import androidx.compose.ui.unit.dp

/** Hero image height on home "Popular Near You" carousel tiles. */
val HomeDiscoverHeroImageHeight = 200.dp

/**
 * Shorter hero for **sponsored** tiles in that same carousel ([SponsoredListingCard]) so title, body,
 * and the Learn More button are not squeezed by a full 200dp image.
 */
val HomeDiscoverCarouselAdImageHeight = 128.dp

/** Hero height on vertical lists (e.g. All Sites) — matches [PlaygroundItem] image block. */
val PlaygroundListCardImageHeight = 160.dp

/** Taller hero for inline sponsored rows in long lists (letterboxed image, less aggressive crop). */
val InlineListingSearchAdImageHeight = 200.dp

/**
 * Spacer between hero image and title row — must match [HomeScreen] carousel tiles
 * so playground and ad slots share the same vertical rhythm.
 */
val HomeDiscoverCardBelowHeroSpacing = 12.dp

val HomeDiscoverCarouselAdMinTotalHeight =
    HomeDiscoverCarouselAdImageHeight + HomeDiscoverCardBelowHeroSpacing + 56.dp

/**
 * Lower bound for a carousel tile: hero + [HomeDiscoverCardBelowHeroSpacing] + ~two lines
 * of title/meta (no sub-venues, no list chips). This is the smallest realistic playground card.
 *
 * **Inline listing** (`SponsoredListingCard`) uses this as a fixed total height.
 */
val HomeDiscoverPlaygroundCardMinTotalHeight =
    HomeDiscoverHeroImageHeight + HomeDiscoverCardBelowHeroSpacing + 56.dp

/** Inline / event ads in the home carousel: shorter tile when there is no hero creative image. */
val HomeDiscoverInlineAdImageHeight = 132.dp

val HomeDiscoverInlineAdCompactMinTotalHeight =
    HomeDiscoverInlineAdImageHeight + HomeDiscoverCardBelowHeroSpacing + 56.dp

/**
 * Fallback hero height for [FeaturedAdCard] when constraints are not yet known.
 * Live height is ~[HomeDiscoverFeaturedAdHeroWidthFraction] of card width, clamped to
 * [HomeDiscoverFeaturedAdHeroMinHeight]..[HomeDiscoverFeaturedAdHeroMaxHeight] — enough for wide
 * banners under [ContentScale.Fit] without letting square art dominate the whole card.
 */
val HomeDiscoverFeaturedAdHeroHeight = 120.dp

const val HomeDiscoverFeaturedAdHeroWidthFraction = 0.36f
val HomeDiscoverFeaturedAdHeroMinHeight = 112.dp
val HomeDiscoverFeaturedAdHeroMaxHeight = 168.dp

/** Spacer between featured hero and text block. */
val HomeDiscoverFeaturedAdBelowHeroSpacing = 2.dp
