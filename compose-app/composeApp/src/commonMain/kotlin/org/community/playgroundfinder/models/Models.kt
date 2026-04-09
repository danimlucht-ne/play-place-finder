package org.community.playgroundfinder.models

import kotlinx.serialization.Serializable
import org.community.playgroundfinder.data.Playground
import org.community.playgroundfinder.data.SafePlaygroundListSerializer

@Serializable
data class HybridSearchResponse(
    val message: String = "",
    @Serializable(with = SafePlaygroundListSerializer::class)
    val places: List<Playground> = emptyList(),
    val seeded: Boolean = false,
    val regionKey: String? = null,
)

/** Subset of GET `/api/health` JSON; extra server fields are ignored. */
@Serializable
data class ServerHealthDatabase(
    val connected: Boolean = false,
)

/** Public health payload from the API (no auth). */
@Serializable
data class ServerHealthResponse(
    val status: String = "",
    val timestamp: String? = null,
    val database: ServerHealthDatabase? = null,
    val responseTimeMs: Int? = null,
    val nodeVersion: String? = null,
)

@Serializable
data class PlayListSummary(
    val id: String = "",
    val name: String = "",
    val color: String? = null,
    val placeCount: Int = 0,
)

@Serializable
data class PlayListListEnvelope(
    val message: String = "",
    val data: List<PlayListSummary> = emptyList(),
)

@Serializable
data class CreatePlayListEnvelope(
    val message: String = "",
    val id: String = "",
)

@Serializable
data class ListDetailData(
    val id: String = "",
    val name: String = "",
    @Serializable(with = SafePlaygroundListSerializer::class)
    val places: List<Playground> = emptyList(),
)

@Serializable
data class ListDetailResponse(
    val message: String = "",
    val data: ListDetailData = ListDetailData(),
)

@Serializable
data class LatLng(
    val lat: Double = 0.0,
    val lng: Double = 0.0,
)

@Serializable
data class RegionSearchResult(
    val regionKey: String = "",
    val city: String = "",
    val state: String = "",
    val center: LatLng? = null,
    val seeded: Boolean = false,
    val seedingTriggered: Boolean = false,
    @Serializable(with = SafePlaygroundListSerializer::class)
    val places: List<Playground> = emptyList(),
)

@Serializable
data class SeededRegion(
    val regionKey: String = "",
    val city: String = "",
    /** App-normalized display city (falls back to [city] in API when absent). */
    val displayCity: String = "",
    val state: String = "",
    val seedStatus: String = "",
    val placeCount: Int = 0,
    val seededAt: String? = null,
)

@Serializable
data class SeededRegionEnvelope(
    val message: String = "",
    val data: List<SeededRegion> = emptyList(),
)

@Serializable
data class QuickVerifyResponse(
    val message: String = "",
    val data: QuickVerifyData = QuickVerifyData()
)

@Serializable
data class QuickVerifyData(
    val lastVerifiedAt: String? = null,
    val verificationCount: Int = 0,
    val averageRating: Double? = null,
    val ratingCount: Int = 0
)

@Serializable
data class RateResponse(
    val message: String = "",
    val data: RateData = RateData()
)

@Serializable
data class RateData(
    val averageRating: Double? = null,
    val ratingCount: Int = 0
)

@Serializable
data class CityPrediction(
    val description: String = "",
    val placeId: String = "",
)

@Serializable
data class AutocompleteResponse(
    val predictions: List<CityPrediction> = emptyList(),
)

// --- Advertising Models ---

@Serializable
data class Advertiser(
    val _id: String = "",
    val userId: String = "",
    val businessName: String = "",
    val contactEmail: String = "",
    val contactPhone: String? = null,
    val category: String = "",
    val city: String = "",
    val state: String = "",
    val regionKey: String = "",
    val websiteUrl: String = "",
    val description: String = "",
    val businessAddress: String = "",
    val businessLat: Double = 0.0,
    val businessLng: Double = 0.0,
    val status: String = "active",
    val createdAt: String = "",
    val updatedAt: String = "",
)

@Serializable
data class AdPackage(
    val type: String = "",
    val priceInCents: Int = 0,
    val durationDays: Int = 30,
)

@Serializable
data class ValidationResult(
    val decision: String = "",
    val flags: List<String> = emptyList(),
    val checkedAt: String? = null,
)

@Serializable
data class AdSubmission(
    val _id: String = "",
    val advertiserId: String = "",
    val status: String = "draft",
    val currentStep: Int = 1,
    /** Admin queue: headline or business name from linked creative. */
    val reviewDisplayName: String = "",
    val `package`: AdPackage? = null,
    val creativeId: String? = null,
    val contractId: String? = null,
    /** Stripe / checkout: e.g. authorization_pending, payment_method_saved, captured */
    val paymentStatus: String? = null,
    val paymentIntentId: String? = null,
    val validationResult: ValidationResult? = null,
    val rejectionReason: String? = null,
    val submittedAt: String? = null,
    val paidAt: String? = null,
    val approvedAt: String? = null,
    val rejectedAt: String? = null,
    val createdAt: String = "",
    val updatedAt: String = "",
    val durationMonths: Int = 1,
    val startDate: String = "",
    val discountPercent: Int = 0,
    val totalPriceInCents: Int = 0,
)

@Serializable
data class AdCreative(
    val _id: String = "",
    val submissionId: String = "",
    val advertiserId: String = "",
    val headline: String = "",
    val body: String = "",
    val imageUrl: String = "",
    val additionalImageUrls: List<String> = emptyList(),
    val ctaText: String = "",
    val ctaUrl: String = "",
    val businessName: String = "",
    val businessCategory: String = "",
    val templateType: String = "standard",
    val status: String = "draft",
    val createdAt: String = "",
    val updatedAt: String = "",
)

@Serializable
data class CampaignCreativePreview(
    val headline: String = "",
    val body: String = "",
    val imageUrl: String? = null,
    val ctaText: String = "",
    val ctaUrl: String = "",
    val businessName: String = "",
)

@Serializable
data class AdCampaign(
    val _id: String = "",
    val submissionId: String = "",
    val advertiserId: String = "",
    val creativeId: String = "",
    val status: String = "",
    val placement: String = "",
    val startDate: String = "",
    val endDate: String = "",
    /** Stable YYYY-MM-DD for display (avoids timezone shifts from ISO datetimes). */
    val startDateCalendar: String = "",
    val endDateCalendar: String = "",
    val impressions: Int = 0,
    val clicks: Int = 0,
    val cityId: String = "",
    val targetedRegionKeys: List<String> = emptyList(),
    /** Resolved labels from seeded_regions (e.g. "Omaha, NE"). */
    val targetedCityLabels: List<String> = emptyList(),
    val targetingRadiusMiles: Int = 20,
    val creativePreview: CampaignCreativePreview? = null,
    val pricingLock: PricingLock? = null,
    val cityPhaseAtPurchase: String? = null,
    val cancelledAt: String? = null,
    val cancelledBy: String? = null,
    val cancellationReason: String? = null,
    val pausedAt: String? = null,
    val unpausedAt: String? = null,
    val isEvent: Boolean = false,
    val createdAt: String = "",
    val updatedAt: String = "",
    val isDemoCampaign: Boolean = false,
)

@Serializable
data class AdEvent(
    val _id: String = "",
    val type: String = "",
    val adId: String = "",
    val campaignId: String = "",
    val cityId: String = "",
    val placement: String = "",
    val userId: String? = null,
    val deviceId: String? = null,
    val timestamp: String = "",
    val metadata: Map<String, String> = emptyMap(),
)

@Serializable
data class AdAnalytics(
    val campaigns: List<AdCampaignStats> = emptyList(),
)

@Serializable
data class AdCampaignStats(
    val _id: String = "",
    val submissionId: String = "",
    val impressions: Int = 0,
    val clicks: Int = 0,
    val ctr: Double = 0.0,
    val headline: String = "",
    val imageUrl: String? = null,
    val businessName: String = "",
    val placement: String = "",
    val status: String = "",
    val targetedRegionKeys: List<String> = emptyList(),
    val targetedCityLabels: List<String> = emptyList(),
    val startDateCalendar: String = "",
    val endDateCalendar: String = "",
    val targetingRadiusMiles: Int = 20,
    /** Advertiser home region for this campaign (renew navigation). */
    val cityId: String = "",
    /** True when server infers sandbox / placeholder creative (not a typical paid live buy). */
    val isDemoCampaign: Boolean = false,
)

@Serializable
data class DailyAdStats(
    val date: String = "",
    val impressions: Int = 0,
    val clicks: Int = 0,
    val ctr: Double = 0.0,
)

@Serializable
data class ReviewFlag(
    val _id: String = "",
    val submissionId: String = "",
    val flagType: String = "",
    val description: String = "",
    val severity: String = "medium",
    val autoGenerated: Boolean = true,
    val resolvedAt: String? = null,
    val resolvedBy: String? = null,
    val resolution: String? = null,
    val createdAt: String = "",
)

@Serializable
data class AdResponse(
    val ad: AdCreativePayload? = null,
    val type: String = "",
    val cityPhase: String? = null,
    val slotsRemaining: Int? = null,
)

@Serializable
data class AllAdsResponse(
    val ads: List<AdCreativePayload> = emptyList(),
    val type: String = "",
    val cityPhase: String? = null,
    val slotsRemaining: Int? = null,
)

@Serializable
data class AdCreativePayload(
    val id: String = "",
    val campaignId: String? = null,
    val headline: String = "",
    val body: String = "",
    val imageUrl: String? = null,
    val ctaText: String = "",
    val ctaUrl: String = "",
    val businessName: String = "",
    val businessCategory: String = "",
    val placement: String = "",
    val isFoundingAdvertiser: Boolean = false,
    val isEvent: Boolean = false,
    val eventName: String? = null,
    val eventDate: String? = null,
    val eventTime: String? = null,
    val isRecurring: Boolean = false,
    val eventLocation: String? = null,
    val businessLat: Double = 0.0,
    val businessLng: Double = 0.0,
    val showDistance: Boolean = false,
)

// --- City Phase & Pricing Models ---

@Serializable
data class CityPhaseInfo(
    val phase: String = "seeding",
    val slotsRemaining: SlotCounts = SlotCounts(),
    val pricing: PhasePricingInfo? = null,
)

@Serializable
data class SlotCounts(
    val featured: Int = 0,
    val sponsored: Int = 0,
)

@Serializable
data class PhasePricingInfo(
    val featured: Int = 0,
    val sponsored: Int = 0,
)

@Serializable
data class PhasePrice(
    val priceInCents: Int = 0,
    val isIntroPrice: Boolean = false,
    val standardPriceInCents: Int = 0,
    val introDurationMonths: Int = 0,
)

@Serializable
data class CityPhaseListItem(
    val cityId: String = "",
    val phase: String = "seeding",
    val slots: CitySlots = CitySlots(),
    val phaseChangedAt: String? = null,
)

@Serializable
data class CitySlots(
    val featured: SlotInfo = SlotInfo(),
    val sponsored: SlotInfo = SlotInfo(),
)

@Serializable
data class SlotInfo(
    val max: Int = 0,
    val remaining: Int = 0,
)

@Serializable
data class PricingLock(
    val introPrice: Int = 0,
    val standardPrice: Int = 0,
    val introDurationMonths: Int = 3,
    val priceLockedUntil: String? = null,
    val isFoundingAdvertiser: Boolean = false,
)

// --- Discount Code Models ---

@Serializable
data class DiscountCode(
    val _id: String = "",
    val code: String = "",
    val percentOff: Int = 0,
    val startDate: String = "",
    val endDate: String = "",
    val maxUses: Int = 0,
    val usageCount: Int = 0,
    val createdBy: String = "",
    val active: Boolean = true,
    val createdAt: String = "",
    val updatedAt: String = "",
    /** When set, code only applies to advertisers in this region (normalized regionKey). */
    val regionKey: String? = null,
    /** When set, code only applies to this advertiser account. */
    val advertiserId: String? = null,
    /** Created only in non-production (or ALLOW_DEV_DISCOUNT_CODES); invalid in production at redemption. */
    val devOnly: Boolean = false,
    /** Wide validity window; only created with [devOnly]. */
    val unlimitedValidity: Boolean = false,
)

@Serializable
data class DiscountCodeListEnvelope(
    val message: String = "",
    val data: List<DiscountCode> = emptyList(),
)

@Serializable
data class DiscountCodeEnvelope(
    val message: String = "",
    val data: DiscountCode = DiscountCode(),
)

@Serializable
data class DiscountValidationResult(
    val percentOff: Int = 0,
    val originalAmountInCents: Int = 0,
    val discountedAmountInCents: Int = 0,
)

@Serializable
data class DiscountValidationEnvelope(
    val message: String = "",
    val data: DiscountValidationResult = DiscountValidationResult(),
)

@Serializable
data class DiscountRedemption(
    val _id: String = "",
    val discountCodeId: String = "",
    val code: String = "",
    val submissionId: String = "",
    val advertiserId: String = "",
    val userId: String = "",
    val percentOff: Int = 0,
    val originalAmountInCents: Int = 0,
    val discountedAmountInCents: Int = 0,
    val redeemedAt: String = "",
)

@Serializable
data class DiscountRedemptionListEnvelope(
    val message: String = "",
    val data: List<DiscountRedemption> = emptyList(),
)


// --- Radius Targeting Models ---

@Serializable
data class Receipt(
    val businessEntity: String = "",
    val appName: String = "",
    val packageType: String = "",
    val packageDurationDays: Int = 0,
    val amountInCents: Int = 0,
    val currency: String = "usd",
    val advertiserBusinessName: String = "",
    val advertiserEmail: String = "",
    val paidAt: String = "",
    val receiptNumber: String = "",
)

@Serializable
data class ReceiptEnvelope(
    val message: String = "",
    val data: Receipt = Receipt(),
)

@Serializable
data class RadiusTier(
    val radiusMiles: Int = 20,
    val count: Int = 0,
    val cities: List<String> = emptyList(),
    val surchargeInCents: Int = 0,
    val userCount: Int = 0,
    val selectable: Boolean = true,
)

@Serializable
data class RadiusPreviewData(
    val homeCityName: String = "",
    val tiers: List<RadiusTier> = emptyList(),
    val selectableRadii: List<Int> = emptyList(),
)

@Serializable
data class RadiusPreviewResponse(
    val message: String = "",
    val data: RadiusPreviewData = RadiusPreviewData(),
)

// --- Campaign Management Models ---

@Serializable
data class CancelResponse(
    val cancelled: Boolean = false,
    val refundAmountInCents: Int = 0,
)

@Serializable
data class CancelResponseEnvelope(
    val message: String = "",
    val data: CancelResponse = CancelResponse(),
)

@Serializable
data class RefundEstimate(
    val refundAmountInCents: Int = 0,
    val remainingDays: Int = 0,
    val totalDays: Int = 0,
)

@Serializable
data class RefundEstimateEnvelope(
    val message: String = "",
    val data: RefundEstimate = RefundEstimate(),
)

// --- Admin Campaign Management Models ---

@Serializable
data class AdminCampaignItem(
    val _id: String = "",
    val submissionId: String = "",
    val advertiserId: String = "",
    val status: String = "",
    val placement: String = "",
    val startDate: String = "",
    val endDate: String = "",
    val impressions: Int = 0,
    val clicks: Int = 0,
    val cityId: String = "",
    val targetedRegionKeys: List<String> = emptyList(),
    val targetingRadiusMiles: Int = 20,
    val businessName: String = "",
    val headline: String = "",
    val cancelledAt: String? = null,
    val pausedAt: String? = null,
    val createdAt: String = "",
    val updatedAt: String = "",
)

@Serializable
data class AdminCampaignListEnvelope(
    val message: String = "",
    val data: List<AdminCampaignItem> = emptyList(),
    val total: Int = 0,
    val page: Int = 1,
    val limit: Int = 20,
)


// --- Lifecycle Run Models ---

@Serializable
data class LifecycleRunResult(
    val activated: Int = 0,
    val completed: Int = 0,
    val eventExpired: Int = 0,
    val expired: Int = 0,
)

@Serializable
data class LifecycleRunEnvelope(
    val message: String = "",
    val data: LifecycleRunResult = LifecycleRunResult(),
)


// --- Advertiser List Models ---

@Serializable
data class AdvertiserListItem(
    val _id: String = "",
    val businessName: String = "",
    val regionKey: String = "",
    val submissionCount: Int = 0,
    val campaignCount: Int = 0,
)

@Serializable
data class AdvertiserListEnvelope(
    val message: String = "",
    val data: List<AdvertiserListItem> = emptyList(),
)


// --- Campaign Renewal Models ---

@Serializable
data class AdvertiserEnvelope(val message: String = "", val data: Advertiser = Advertiser())

@Serializable
data class RenewalResponse(val submissionId: String = "", val creative: AdCreative? = null)

@Serializable
data class RenewalResponseEnvelope(val message: String = "", val data: RenewalResponse = RenewalResponse())
