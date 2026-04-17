package org.community.playgroundfinder.data

import io.ktor.client.*
import io.ktor.client.call.*
import io.ktor.client.plugins.*
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.contentnegotiation.*
import io.ktor.client.plugins.logging.*
import io.ktor.client.request.*
import io.ktor.client.request.forms.*
import io.ktor.client.statement.*
import io.ktor.http.*
import io.ktor.serialization.kotlinx.json.*
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonNames
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import org.community.playgroundfinder.AppConfig
import org.community.playgroundfinder.models.CityPrediction
import org.community.playgroundfinder.models.AutocompleteResponse
import org.community.playgroundfinder.models.HybridSearchResponse
import org.community.playgroundfinder.models.ServerHealthResponse
import org.community.playgroundfinder.models.CreatePlayListEnvelope
import org.community.playgroundfinder.models.ListDetailResponse
import org.community.playgroundfinder.models.ListDetailData
import org.community.playgroundfinder.models.PlayListSummary
import org.community.playgroundfinder.models.PlayListListEnvelope
import org.community.playgroundfinder.models.QuickVerifyResponse
import org.community.playgroundfinder.models.RateResponse
import org.community.playgroundfinder.models.RegionSearchResult
import org.community.playgroundfinder.models.SeededRegionEnvelope
import org.community.playgroundfinder.models.AdSubmission
import org.community.playgroundfinder.models.AdCreative
import org.community.playgroundfinder.models.AdCampaign
import org.community.playgroundfinder.models.AdCampaignStats
import org.community.playgroundfinder.models.AdResponse
import org.community.playgroundfinder.models.AllAdsResponse
import org.community.playgroundfinder.models.DailyAdStats
import org.community.playgroundfinder.models.CityPhaseInfo
import org.community.playgroundfinder.models.PhasePrice
import org.community.playgroundfinder.models.CityPhaseListItem
import org.community.playgroundfinder.models.DiscountCode
import org.community.playgroundfinder.models.DiscountCodeListEnvelope
import org.community.playgroundfinder.models.DiscountCodeEnvelope
import org.community.playgroundfinder.models.DiscountValidationResult
import org.community.playgroundfinder.models.DiscountValidationEnvelope
import org.community.playgroundfinder.models.DiscountRedemption
import org.community.playgroundfinder.models.DiscountRedemptionListEnvelope
import org.community.playgroundfinder.models.AdminCampaignItem
import org.community.playgroundfinder.models.AdminCampaignListEnvelope
import org.community.playgroundfinder.models.LifecycleRunEnvelope
import org.community.playgroundfinder.models.LifecycleRunResult
import org.community.playgroundfinder.models.AdvertiserListItem
import org.community.playgroundfinder.models.AdvertiserListEnvelope
import org.community.playgroundfinder.models.Advertiser
import org.community.playgroundfinder.models.AdvertiserEnvelope
import org.community.playgroundfinder.models.RenewalResponse
import org.community.playgroundfinder.models.RenewalResponseEnvelope
import org.community.playgroundfinder.models.Receipt
import org.community.playgroundfinder.models.ReceiptEnvelope
import org.community.playgroundfinder.models.RadiusPreviewData
import org.community.playgroundfinder.models.RadiusPreviewResponse
import org.community.playgroundfinder.models.CancelResponse
import org.community.playgroundfinder.models.CancelResponseEnvelope
import org.community.playgroundfinder.models.RefundEstimate
import org.community.playgroundfinder.models.RefundEstimateEnvelope

@Serializable
data class PlaygroundResponse(
    val message: String = "",
    @Serializable(with = SafePlaygroundListSerializer::class)
    val data: List<Playground> = emptyList(),
    val nextCursor: String? = null
)

@Serializable
data class SinglePlaygroundResponse(
    val message: String = "",
    val data: Playground = Playground()
)

@Serializable
data class PendingPlaygroundApiResponse(
    val message: String = "",
    val pendingReview: Boolean = false,
    val queueId: String? = null,
)

sealed class PlaygroundSaveOutcome {
    data class Saved(val playground: Playground) : PlaygroundSaveOutcome()
    data class PendingReview(val message: String, val queueId: String?) : PlaygroundSaveOutcome()
    data object Duplicate : PlaygroundSaveOutcome()
}

@Serializable
data class ImageUploadResponse(
    val message: String? = null,
    val url: String = ""
)

@Serializable
data class PlaceSuggestion(
    val placeId: String = "",
    val name: String = "",
    val latitude: Double = 0.0,
    val longitude: Double = 0.0,
    val vicinity: String? = null,
    val types: List<String> = emptyList(),
    val distanceMeters: Int = 0,
    val alreadyInApp: Boolean = false
)

@Serializable
data class PlaceSuggestionsEnvelope(
    val message: String = "",
    val data: List<PlaceSuggestion> = emptyList()
)

@Serializable
data class ContributorProfile(
    val userId: String = "",
    /** Public contributor label; persisted on server `users.displayName`. */
    val displayName: String? = null,
    val score: Int = 0,
    val level: String = "New Explorer",
    val city: String? = null,
    val regionKey: String? = null,
    val adFree: Boolean = false,   // 5.7 — ad-free perk
    val rank: Int = 0,             // 5.4 — city-scoped rank
    val role: String? = null,      // "admin" for admin users
)

@Serializable
data class LeaderboardEntry(
    @kotlinx.serialization.SerialName("_id")
    val userId: String = "",
    val displayName: String? = null,
    val score: Int = 0,
    @Serializable(with = SafeStringSerializer::class)
    val level: String? = null,
    val city: String? = null,
    val regionKey: String? = null,
)

@Serializable
data class LeaderboardEnvelope(val message: String = "", val data: List<LeaderboardEntry> = emptyList())

/** Row from `GET /admin/trends/contributor-leaderboard` (period-scoped, with moderation rollups). */
@Serializable
data class ContributorLeaderboardEntry(
    val rank: Int = 0,
    val userId: String = "",
    val displayName: String? = null,
    val level: String? = null,
    val city: String? = null,
    val regionKey: String? = null,
    val lifetimeScore: Int = 0,
    val periodScore: Int = 0,
    val contributionCount: Int = 0,
    val photos: Int = 0,
    val edits: Int = 0,
    val newPlaygrounds: Int = 0,
    val reports: Int = 0,
    /** ISO-8601 string when the API serializes Mongo dates as JSON strings. */
    val lastContributionAt: String? = null,
    val approved: Int = 0,
    val rejected: Int = 0,
    val approvalRate: Double? = null,
)

@Serializable
data class ContributorLeaderboardEnvelope(
    val message: String = "",
    val data: List<ContributorLeaderboardEntry> = emptyList(),
)

@Serializable
data class ContributorProfileEnvelope(
    val message: String = "",
    val data: ContributorProfile = ContributorProfile()
)

// ─── Admin Analytics Data Classes ────────────────────────────────────────────

@Serializable
data class DailyTrendPoint(
    val date: String = "",
    val newPlaygrounds: Int = 0,
    val photosApproved: Int = 0,
    val crowdReports: Int = 0,
    val issueReports: Int = 0,
    val newUsers: Int = 0,
    val supportTickets: Int = 0,
)

@Serializable
data class ContributorSummary(
    val userId: String = "",
    val displayName: String? = null,
    val score: Int = 0,
    val level: String? = null,
    val city: String? = null,
)

@Serializable
data class CityGrowthEntry(
    val regionKey: String? = null,
    val city: String? = null,
    val state: String? = null,
    val totalPlaygrounds: Int = 0,
    val verifiedPlaygrounds: Int = 0,
    val seedStatus: String? = null,
)

@Serializable
data class DailyTrendsEnvelope(val message: String = "", val data: List<DailyTrendPoint> = emptyList())

@Serializable
data class TopContributorsEnvelope(val message: String = "", val data: List<ContributorSummary> = emptyList())

@Serializable
data class CityGrowthEnvelope(val message: String = "", val data: List<CityGrowthEntry> = emptyList())

/** Matches `GET /admin/trends/overview` → `data.contributions` from [adminDailyTrendsService.getContributionOverview]. */
@Serializable
data class AdminAnalyticsContributionOverview(
    val pointsAwarded: Int = 0,
    val contributionCount: Int = 0,
    val activeContributors: Int = 0,
    val photos: Int = 0,
    val edits: Int = 0,
    val newPlaygrounds: Int = 0,
    val reports: Int = 0,
    val approved: Int = 0,
    val rejected: Int = 0,
    val approvalRate: Double? = null,
)

@Serializable
data class AdminAnalyticsPlacementRow(
    val placement: String = "",
    val impressions: Int = 0,
    val clicks: Int = 0,
    val ctr: Double = 0.0,
    /** True when any impressions in this placement came from campaigns whose creative matches demo heuristics. */
    val includesDemoOrTestTraffic: Boolean = false,
)

@Serializable
data class AdminAnalyticsCampaignRow(
    val campaignId: String = "",
    val impressions: Int = 0,
    val clicks: Int = 0,
    val status: String = "",
    val label: String = "",
    val ctr: Double = 0.0,
    val isDemoCampaign: Boolean = false,
)

@Serializable
data class AdminAnalyticsCityRow(
    val cityId: String = "",
    val impressions: Int = 0,
    val clicks: Int = 0,
    val ctr: Double = 0.0,
)

/** Matches `GET /admin/trends/overview` → `data.ads` from [adminDailyTrendsService.getAdPerformanceOverview]. */
@Serializable
data class AdminAnalyticsAdsOverview(
    val activeCampaigns: Int = 0,
    val impressions: Int = 0,
    val clicks: Int = 0,
    val ctr: Double = 0.0,
    val uniqueReach: Int = 0,
    val frequency: Double = 0.0,
    val placements: List<AdminAnalyticsPlacementRow> = emptyList(),
    val topCampaigns: List<AdminAnalyticsCampaignRow> = emptyList(),
    val topCities: List<AdminAnalyticsCityRow> = emptyList(),
)

@Serializable
data class AdminAnalyticsOverview(
    val startDate: String = "",
    val endDate: String = "",
    val regionKey: String? = null,
    val contributions: AdminAnalyticsContributionOverview = AdminAnalyticsContributionOverview(),
    val ads: AdminAnalyticsAdsOverview = AdminAnalyticsAdsOverview(),
)

@Serializable
private data class AdminAnalyticsOverviewEnvelope(
    val message: String = "",
    val data: AdminAnalyticsOverview = AdminAnalyticsOverview(),
)

@Serializable
data class GeminiSummary(
    val confidence: Double = 0.0,
    val relevanceScore: Double = 0.0,
    val overviewScore: Double = 0.0,
    val notes: String? = null,
    val recommendedAction: String = "",
)

@Serializable
data class SeedReviewItem(
    val id: String = "",
    val playgroundId: String = "",
    val playgroundName: String = "",
    val regionKey: String = "",
    val photoUrl: String = "",
    val isTopPhoto: Boolean = false,
    val hasFaces: Boolean = false,
    val status: String = "",
    /** Populated by seed scrub for new items; explains why the row was queued. */
    val queueReasons: List<String> = emptyList(),
    val geminiSummary: GeminiSummary? = null,
)

@Serializable
data class SeedReviewEnvelope(val message: String = "", val data: List<SeedReviewItem> = emptyList())

// ─── Advertising Envelope Types ──────────────────────────────────────────────

@Serializable
data class AdSubmissionEnvelope(val message: String = "", val data: AdSubmission = AdSubmission())

@Serializable
data class AdSubmissionListEnvelope(val message: String = "", val data: List<AdSubmission> = emptyList())

@Serializable
data class AdAssetUploadEnvelope(val message: String = "", val data: AdAssetUploadData = AdAssetUploadData())

@Serializable
data class AdAssetUploadData(val imageUrl: String = "")

@Serializable
data class AdCreativeEnvelope(val message: String = "", val data: AdCreative = AdCreative())

@Serializable
data class CreatePaymentIntentEnvelope(val message: String = "", val data: CreatePaymentIntentData = CreatePaymentIntentData())

@OptIn(ExperimentalSerializationApi::class)
@Serializable
data class CreatePaymentIntentData(
    @JsonNames("clientSecret", "client_secret")
    val clientSecret: String = "",
    @JsonNames("paymentIntentId", "payment_intent_id")
    val paymentIntentId: String = "",
    /** True when total is $0 after a 100% code — use [completeFreeSubmission], not Stripe. */
    val freeCheckout: Boolean = false,
)

@Serializable
data class AdResponseEnvelope(val message: String = "", val data: AdResponse = AdResponse())

@Serializable
data class AllAdsResponseEnvelope(val message: String = "", val data: AllAdsResponse = AllAdsResponse())

@Serializable
data class AdCampaignListEnvelope(val message: String = "", val data: List<AdCampaignStats> = emptyList())

@Serializable
data class CampaignAnalyticsData(val campaign: AdCampaign = AdCampaign(), val analytics: CampaignDailyAnalytics = CampaignDailyAnalytics())

@Serializable
data class CampaignDailyAnalytics(val daily: List<DailyAdStats> = emptyList(), val impressions: Int = 0, val clicks: Int = 0, val ctr: Double = 0.0)

@Serializable
data class CampaignAnalyticsEnvelope(val message: String = "", val data: CampaignAnalyticsData = CampaignAnalyticsData())

// ─── City Phase & Pricing Envelope Types ─────────────────────────────────────

@Serializable
data class CityPhaseEnvelope(val message: String = "", val data: CityPhaseInfo = CityPhaseInfo())

@Serializable
data class PhasePriceEnvelope(val message: String = "", val data: PhasePrice = PhasePrice())

@Serializable
data class CityPhaseListEnvelope(val message: String = "", val data: List<CityPhaseListItem> = emptyList())

@Serializable
data class LightweightReseedPayload(val regionKey: String = "", val note: String = "")

@Serializable
data class LightweightReseedEnvelope(val message: String = "", val data: LightweightReseedPayload = LightweightReseedPayload())

@Serializable
data class SeedMapViewportPayload(
    val regionKey: String = "",
    val gridPointCount: Int = 0,
    val note: String = "",
)

@Serializable
data class SeedMapViewportEnvelope(val message: String = "", val data: SeedMapViewportPayload = SeedMapViewportPayload())

private val adminJson = Json {
    ignoreUnknownKeys = true
    isLenient = true
}

/** Flatten JsonObject for admin endpoints that return dynamic maps (Ktor cannot use Map<String, Any> with JSON). */
private fun jsonObjectToKotlinMap(o: JsonObject): Map<String, Any> {
    val out = mutableMapOf<String, Any>()
    o.forEach { (k, v) ->
        out[k] = when (v) {
            is JsonPrimitive -> when {
                v.booleanOrNull != null -> v.booleanOrNull!!
                v.doubleOrNull != null -> v.doubleOrNull!!
                v.contentOrNull != null -> v.content
                else -> v.toString()
            }
            is JsonObject -> mongoExtendedJsonObjectToKotlinValue(v)
            is JsonArray -> v.toString()
            else -> v.toString()
        }
    }
    return out
}

/** Single-key `{"$oid":"hex"}` from Mongo/Express → plain string so queue ids and URLs stay valid. */
private fun mongoExtendedJsonObjectToKotlinValue(v: JsonObject): Any {
    if (v.size == 1) {
        val oid = v["\$oid"]
        if (oid is JsonPrimitive && oid.contentOrNull != null) return oid.content
    }
    return jsonObjectToKotlinMap(v)
}

/** `{ "message", "data": [ {...}, ... ] }` — avoids `Map` serializer (same as admin moderation). */
private fun parseJsonEnvelopeDataArray(text: String): List<Map<String, Any>> {
    val root = runCatching { adminJson.parseToJsonElement(text).jsonObject }.getOrNull() ?: return emptyList()
    val dataEl = root["data"]?.jsonArray ?: return emptyList()
    return dataEl.mapNotNull { el ->
        val jo = el as? JsonObject ?: return@mapNotNull null
        jsonObjectToKotlinMap(jo)
    }
}

private fun parseJsonEnvelopeDataObject(text: String): Map<String, Any> {
    val root = runCatching { adminJson.parseToJsonElement(text).jsonObject }.getOrNull() ?: return emptyMap()
    val dataEl = root["data"]?.jsonObject ?: return emptyMap()
    return jsonObjectToKotlinMap(dataEl)
}

/** Recursively convert JsonElement for admin ad detail / dynamic payloads (lists, nested maps). */
private fun jsonElementToKotlin(el: JsonElement): Any? = when (el) {
    is JsonPrimitive -> when {
        el.booleanOrNull != null -> el.booleanOrNull
        el.doubleOrNull != null -> el.doubleOrNull
        el.contentOrNull != null -> el.content
        else -> el.toString()
    }
    is JsonObject -> jsonObjectToDeepMap(el)
    is JsonArray -> el.map { jsonElementToKotlin(it) }
    else -> null
}

private fun jsonObjectToDeepMap(o: JsonObject): Map<String, Any?> =
    o.entries.associate { (k, v) -> k to jsonElementToKotlin(v) }

/**
 * Admin POST bodies must not use [Map] with mixed value types (String / Boolean / Int): Ktor's JSON encoder throws
 * "Serializing collections of different element types is not yet supported".
 * Passing a pre-encoded JSON string avoids that; [setBody(JsonObject)] can still hit the same converter path on some targets.
 */
private fun encodeAdminJsonBody(build: kotlinx.serialization.json.JsonObjectBuilder.() -> Unit): String =
    buildJsonObject(build).toString()

class PlaygroundService(
    private val tokenProvider: suspend () -> String? = { null },
    private val client: HttpClient = HttpClient {
        install(ContentNegotiation) {
            json(Json { 
                ignoreUnknownKeys = true 
                coerceInputValues = true
                isLenient = true
                allowSpecialFloatingPointValues = true
            })
        }
        install(Logging) {
            level = LogLevel.HEADERS
        }
        install(HttpTimeout) {
            // After DB restarts / slow networks, 30s was too tight for some devices; connect timeout fails faster than hanging.
            requestTimeoutMillis = 60_000
            connectTimeoutMillis = 20_000
            socketTimeoutMillis = 60_000
        }
        defaultRequest {
            url("${AppConfig.serverBaseUrl}/api/")
        }
    }
) {
    private val serverBaseUrl: String get() = AppConfig.serverBaseUrl.trimEnd('/')

    /** Executes a request block with a fresh Authorization header. */
    private suspend fun HttpRequestBuilder.withAuth() {
        val token = tokenProvider()
        if (!token.isNullOrEmpty()) {
            header(HttpHeaders.Authorization, "Bearer $token")
        }
    }

    /** Fails fast on 4xx/5xx so error JSON is not coerced into empty envelope `data` (same class of bug as createPaymentIntent). */
    private suspend fun HttpResponse.requireHttpSuccess(context: String) {
        if (!status.isSuccess()) {
            val snippet = runCatching { bodyAsText() }.getOrNull().orEmpty().take(500)
            error("$context (${status.value}): $snippet")
        }
    }

    /**
     * Public GET `/api/health` — verifies [AppConfig.serverBaseUrl] and TLS reachability (no auth).
     * @throws if HTTP fails or server returns non-2xx (e.g. 503 unhealthy).
     */
    suspend fun fetchServerHealth(): ServerHealthResponse {
        val response = client.get("health")
        response.requireHttpSuccess("Server health")
        return response.body()
    }

    suspend fun hybridSearch(lat: Double, lng: Double): HybridSearchResponse {
        return client.post("search/hybrid") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(mapOf("lat" to lat, "lng" to lng))
            // Region seeding (Google + DB) often exceeds the default 30s client timeout.
            timeout {
                requestTimeoutMillis = 120_000
                connectTimeoutMillis = 20_000
                socketTimeoutMillis = 120_000
            }
        }.body()
    }

    suspend fun searchPlaygrounds(
        lat: Double? = null,
        lng: Double? = null,
        radius: Int? = 25,
        playgroundType: String? = null,
        /** Surfaces the place may have (OR): any token may match stored comma-separated `groundType`. */
        groundTypesInclude: List<String>? = null,
        /** Surfaces the place must not list (AND): excludes rows that contain any of these tokens. */
        groundTypesExclude: List<String>? = null,
        expense: String? = null,
        equipment: List<String>? = null,
        sportsCourts: List<String>? = null,
        swingTypes: List<String>? = null,
        hasBathrooms: Boolean? = null,
        hasShade: Boolean? = null,
        isFenced: Boolean? = null,
        isToddlerFriendly: Boolean? = null,
        hasSplashPad: Boolean? = null,
        isDogFriendly: Boolean? = null,
        hasParking: Boolean? = null,
        hasWifi: Boolean? = null,
        needsGripSocks: Boolean? = null,
        requiresWaiver: Boolean? = null,
        hasBenches: Boolean? = null,
        hasPicnicTables: Boolean? = null,
        hasTrashCans: Boolean? = null,
        isAccessible: Boolean? = null,
        hasWalkingTrail: Boolean? = null,
        hasWaterFountain: Boolean? = null,
        hasPlayground: Boolean? = null
    ): List<Playground> {
        val response: HttpResponse = client.get("playgrounds/search") {
            withAuth()
            timeout {
                requestTimeoutMillis = 90_000
                connectTimeoutMillis = 25_000
                socketTimeoutMillis = 90_000
            }
            if (lat != null) parameter("lat", lat)
            if (lng != null) parameter("lng", lng)
            if (radius != null) parameter("radius", radius)
            if (!playgroundType.isNullOrEmpty()) parameter("playgroundType", playgroundType)
            if (!groundTypesInclude.isNullOrEmpty()) {
                parameter("groundType", groundTypesInclude.joinToString(","))
            }
            if (!groundTypesExclude.isNullOrEmpty()) {
                parameter("groundTypeExclude", groundTypesExclude.joinToString(","))
            }
            if (!expense.isNullOrEmpty()) parameter("costRange", expense)
            if (!equipment.isNullOrEmpty()) parameter("equipment", equipment.joinToString(","))
            if (!sportsCourts.isNullOrEmpty()) parameter("sportsCourts", sportsCourts.joinToString(","))
            if (!swingTypes.isNullOrEmpty()) parameter("swingTypes", swingTypes.joinToString(","))
            
            if (hasBathrooms == true) parameter("hasBathrooms", "true")
            if (hasShade == true) parameter("hasShade", "true")
            if (isFenced == true) parameter("isFenced", "true")
            if (isToddlerFriendly == true) parameter("isToddlerFriendly", "true")
            if (hasSplashPad == true) parameter("hasSplashPad", "true")
            if (isDogFriendly == true) parameter("isDogFriendly", "true")
            if (hasParking == true) parameter("hasParking", "true")
            if (hasWifi == true) parameter("hasWifi", "true")
            if (needsGripSocks == true) parameter("needsGripSocks", "true")
            if (requiresWaiver == true) parameter("requiresWaiver", "true")
            if (hasBenches == true) parameter("hasBenches", "true")
            if (hasPicnicTables == true) parameter("hasPicnicTables", "true")
            if (hasTrashCans == true) parameter("hasTrashCans", "true")
            if (isAccessible == true) parameter("isAccessible", "true")
            if (hasWalkingTrail == true) parameter("hasWalkingTrail", "true")
            if (hasWaterFountain == true) parameter("hasWaterFountain", "true")
            if (hasPlayground == true) parameter("hasPlayground", "true")
        }
        if (!response.status.isSuccess()) {
            val text = runCatching { response.bodyAsText() }.getOrNull().orEmpty().take(500)
            error("Search failed (${response.status.value}): $text")
        }
        return response.body<PlaygroundResponse>().data
    }

    suspend fun getAllPlaygrounds(cursor: String? = null, limit: Int = 50): PlaygroundResponse {
        return client.get("playgrounds") {
            withAuth()
            if (cursor != null) parameter("cursor", cursor)
            parameter("limit", limit.toString())
        }.body<PlaygroundResponse>()
    }

    suspend fun getPlaygroundById(id: String): Playground {
        // Path-encode the id (Google place_id can contain +, /, etc.). Raw string interpolation can
        // break the URL or fail to match Mongo _id on the server.
        val response = client.get {
            url { appendPathSegments("playgrounds", id) }
            withAuth()
        }
        // 404 bodies like {"message":"Playground not found"} omit `data`; kotlinx.serialization then
        // fills SinglePlaygroundResponse.data with default empty Playground() — never apply that.
        if (!response.status.isSuccess()) {
            val snippet = runCatching { response.bodyAsText() }.getOrNull().orEmpty().take(200)
            error("Playground not found (${response.status.value}): $snippet")
        }
        return response.body<SinglePlaygroundResponse>().data
    }
    
    suspend fun createPlayground(playground: Playground): Playground {
        return client.post("playgrounds") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(playground)
        }.body<SinglePlaygroundResponse>().data
    }

    /** Google Places near the user (kid-friendly filter on server). */
    suspend fun getNearbyPlaceSuggestions(lat: Double, lng: Double): List<PlaceSuggestion> {
        return client.post("playgrounds/nearby-suggestions") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(mapOf("lat" to lat, "lng" to lng))
        }.body<PlaceSuggestionsEnvelope>().data
    }

    suspend fun searchPlacesForSubmission(query: String, lat: Double, lng: Double): List<PlaceSuggestion> {
        return client.post("playgrounds/place-search") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(mapOf("query" to query, "lat" to lat, "lng" to lng))
        }.body<PlaceSuggestionsEnvelope>().data
    }

    suspend fun createPlaygroundOrDuplicate(playground: Playground): PlaygroundSaveOutcome {
        val response = client.post("playgrounds") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(playground)
        }
        if (response.status == HttpStatusCode.Conflict) return PlaygroundSaveOutcome.Duplicate
        if (response.status == HttpStatusCode.Accepted) {
            val pending = response.body<PendingPlaygroundApiResponse>()
            return PlaygroundSaveOutcome.PendingReview(
                message = pending.message,
                queueId = pending.queueId,
            )
        }
        if (!response.status.isSuccess()) {
            val text = runCatching { response.bodyAsText() }.getOrNull().orEmpty()
            error("Create failed (${response.status}): $text")
        }
        val body = response.body<SinglePlaygroundResponse>()
        return PlaygroundSaveOutcome.Saved(body.data)
    }

    suspend fun updatePlayground(id: String, playground: Playground): PlaygroundSaveOutcome {
        val response = client.put {
            url { appendPathSegments("playgrounds", id) }
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(playground)
        }
        if (response.status == HttpStatusCode.Accepted) {
            val pending = response.body<PendingPlaygroundApiResponse>()
            return PlaygroundSaveOutcome.PendingReview(
                message = pending.message,
                queueId = pending.queueId,
            )
        }
        if (!response.status.isSuccess()) {
            val text = runCatching { response.bodyAsText() }.getOrNull().orEmpty()
            error("Update failed (${response.status}): $text")
        }
        val envelope = runCatching { response.body<SinglePlaygroundResponse>() }.getOrNull()
        val fromBody = envelope?.data
        if (fromBody != null && !fromBody.id.isNullOrBlank()) {
            return PlaygroundSaveOutcome.Saved(fromBody)
        }
        val fresh = getPlaygroundById(id)
        return PlaygroundSaveOutcome.Saved(fresh)
    }

    /** Current user's moderation queue rows (edits, photos, new listings). */
    suspend fun getMySubmissions(limit: Int = 50): List<Map<String, Any>> {
        val response = client.get("users/me/submissions") {
            withAuth()
            parameter("limit", limit)
        }
        if (!response.status.isSuccess()) {
            val t = runCatching { response.bodyAsText() }.getOrNull().orEmpty()
            error("Submissions failed (${response.status}): $t")
        }
        return parseJsonEnvelopeDataArray(response.bodyAsText())
    }
    
    suspend fun uploadImage(imageData: ByteArray, filename: String): String {
        val response = client.post("upload-image") {
            withAuth()
            setBody(MultiPartFormDataContent(formData {
                append("image", imageData, Headers.build {
                    append(HttpHeaders.ContentType, "image/jpeg")
                    append(HttpHeaders.ContentDisposition, "filename=\"$filename\"")
                })
            }))
        }
        return response.body<ImageUploadResponse>().url
    }

    suspend fun getFavorites(userId: String): List<Playground> {
        return client.get("favorites/$userId") { withAuth() }.body<PlaygroundResponse>().data
    }

    suspend fun getMyFavoriteIds(): Set<String> {
        @Serializable
        data class FavIdsEnvelope(val message: String = "", val data: List<String> = emptyList())
        return client.get("favorites/me/ids") { withAuth() }.body<FavIdsEnvelope>().data.toSet()
    }
    
    suspend fun toggleFavorite(placeId: String, userId: String) {
        client.post("favorites") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(mapOf("placeId" to placeId, "userId" to userId))
        }
    }

    suspend fun createList(name: String, color: String? = null): String {
        val body = buildMap {
            put("name", name)
            if (color != null) put("color", color)
        }
        val resp = client.post("lists") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(body)
        }.body<CreatePlayListEnvelope>()
        return resp.id
    }

    suspend fun deleteList(listId: String) {
        client.delete("lists/$listId") { withAuth() }
    }

    suspend fun getLists(): List<PlayListSummary> {
        return client.get("lists") { withAuth() }.body<PlayListListEnvelope>().data
    }
    
    suspend fun getListDetail(listId: String): ListDetailData {
        return client.get("lists/detail/$listId") { withAuth() }.body<ListDetailResponse>().data
    }

    suspend fun addToList(listId: String, placeId: String) {
        client.put("lists/$listId/add") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(mapOf("placeId" to placeId))
        }
    }

    suspend fun removeFromList(listId: String, placeId: String) {
        client.put("lists/$listId/remove") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(mapOf("placeId" to placeId))
        }
    }

    suspend fun getMyContributorProfile(): ContributorProfile {
        return client.get("users/me/contributor-profile") { withAuth() }
            .body<ContributorProfileEnvelope>()
            .data
    }

    /** Returns the contributor profile as a raw map (includes `role` field for admin check). */
    suspend fun getContributorProfile(): Map<String, Any?> {
        return client.get("users/me/contributor-profile") { withAuth() }
            .body<Map<String, Any?>>()
            .let {
                @Suppress("UNCHECKED_CAST")
                (it["data"] as? Map<String, Any?>) ?: emptyMap()
            }
    }

    suspend fun getModerationQueue(status: String): List<Map<String, Any>> {
        val response = client.get("$serverBaseUrl/admin/moderation") {
            withAuth()
            parameter("status", status)
        }
        if (!response.status.isSuccess()) {
            val t = runCatching { response.bodyAsText() }.getOrNull().orEmpty()
            error("Moderation queue failed (${response.status}): $t")
        }
        return parseJsonEnvelopeDataArray(response.bodyAsText())
    }

    suspend fun getModerationItem(queueId: String): Map<String, Any> {
        val response = client.get("$serverBaseUrl/admin/moderation/$queueId") { withAuth() }
        if (!response.status.isSuccess()) {
            val t = runCatching { response.bodyAsText() }.getOrNull().orEmpty()
            error("Moderation item failed (${response.status}): $t")
        }
        return parseJsonEnvelopeDataObject(response.bodyAsText())
    }

    suspend fun approveModeration(queueId: String) {
        val response = client.post("$serverBaseUrl/admin/moderation/$queueId/approve") { withAuth() }
        if (!response.status.isSuccess()) {
            val t = runCatching { response.bodyAsText() }.getOrNull().orEmpty()
            error("Approve failed (${response.status}): $t")
        }
    }

    suspend fun rejectModeration(queueId: String, reason: String) {
        val response = client.post("$serverBaseUrl/admin/moderation/$queueId/reject") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(mapOf("decisionReason" to reason))
        }
        if (!response.status.isSuccess()) {
            val t = runCatching { response.bodyAsText() }.getOrNull().orEmpty()
            error("Reject failed (${response.status}): $t")
        }
    }

    suspend fun approveEdit(queueId: String) {
        client.post("$serverBaseUrl/admin/moderation/$queueId/approve-edit") { withAuth() }
    }

    suspend fun rejectEdit(queueId: String, reason: String) {
        client.post("$serverBaseUrl/admin/moderation/$queueId/reject-edit") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(mapOf("reason" to reason))
        }
    }

    suspend fun approvePhoto(queueId: String) {
        client.post("$serverBaseUrl/admin/moderation/$queueId/approve-photo") { withAuth() }
    }

    suspend fun rejectPhoto(queueId: String, reason: String) {
        client.post("$serverBaseUrl/admin/moderation/$queueId/reject-photo") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(mapOf("reason" to reason))
        }
    }

    suspend fun approveNewPlayground(queueId: String) {
        client.post("$serverBaseUrl/admin/moderation/$queueId/approve-new-playground") { withAuth() }
    }

    suspend fun rejectNewPlayground(queueId: String, reason: String) {
        client.post("$serverBaseUrl/admin/moderation/$queueId/reject-new-playground") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(mapOf("reason" to reason))
        }
    }

    // --- Support tickets (general contact + targeted complaints/questions/requests) ---
    suspend fun submitSupportTicket(
        ticketType: String,
        message: String,
        category: String? = null,
        targetKind: String? = null,
        targetId: String? = null,
        screenshotUrl: String? = null
    ): Map<String, String> {
        val response = client.post("support/tickets") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(
                mapOf(
                    "ticketType" to ticketType,
                    "category" to (category ?: ""),
                    "message" to message,
                    "targetKind" to (targetKind ?: ""),
                    "targetId" to (targetId ?: ""),
                    "screenshotUrl" to (screenshotUrl ?: "")
                )
            )
        }
        if (!response.status.isSuccess()) {
            val text = runCatching { response.bodyAsText() }.getOrNull().orEmpty()
            error("Support ticket failed (${response.status}): $text")
        }
        return mapOf("message" to "success")
    }

    suspend fun getSupportQueue(status: String): List<Map<String, Any>> {
        val resp = client.get("$serverBaseUrl/admin/support-tickets") {
            withAuth()
            parameter("status", status)
        }
        val text = resp.bodyAsText()
        val parsed = Json.parseToJsonElement(text)
        val dataArray = parsed.jsonObject["data"]?.jsonArray ?: return emptyList()
        return dataArray.map { element ->
            val obj = element.jsonObject
            obj.entries.associate { (k, v) ->
                k to when {
                    v is JsonPrimitive && v.isString -> v.content
                    v is JsonPrimitive -> v.content
                    // Handle MongoDB ObjectId: {"$oid": "..."}
                    v is kotlinx.serialization.json.JsonObject && v.containsKey("\$oid") ->
                        (v["\$oid"] as? JsonPrimitive)?.content ?: v.toString()
                    else -> v.toString()
                } as Any
            }
        }
    }

    suspend fun getSupportTicket(id: String): Map<String, Any> {
        val resp = client.get("$serverBaseUrl/admin/support-tickets/$id") { withAuth() }
        val text = resp.bodyAsText()
        val parsed = Json.parseToJsonElement(text)
        val dataObj = parsed.jsonObject["data"]?.jsonObject ?: return emptyMap()
        return dataObj.entries.associate { (k, v) ->
            k to when {
                v is JsonPrimitive && v.isString -> v.content
                v is JsonPrimitive -> v.content
                v is kotlinx.serialization.json.JsonObject && v.containsKey("\$oid") ->
                    (v["\$oid"] as? JsonPrimitive)?.content ?: v.toString()
                else -> v.toString()
            } as Any
        }
    }

    suspend fun resolveSupportTicket(id: String, resolutionReason: String) {
        client.post("$serverBaseUrl/admin/support-tickets/$id/resolve") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(mapOf("resolutionReason" to resolutionReason))
        }
    }

    suspend fun rejectSupportTicket(id: String, resolutionReason: String) {
        client.post("$serverBaseUrl/admin/support-tickets/$id/reject") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(mapOf("resolutionReason" to resolutionReason))
        }
    }

    suspend fun getSeedReviewQueue(status: String = "PENDING_SEED_REVIEW", regionKey: String? = null): List<SeedReviewItem> {
        return client.get("$serverBaseUrl/admin/seed-review") {
            withAuth()
            parameter("status", status)
            if (!regionKey.isNullOrBlank()) parameter("regionKey", regionKey)
        }.body<SeedReviewEnvelope>().data
    }

    suspend fun getSeedReviewRegions(): List<Map<String, Any>> {
        val resp = client.get("$serverBaseUrl/admin/seed-review/regions") { withAuth() }.body<Map<String, Any>>()
        @Suppress("UNCHECKED_CAST")
        return resp["data"] as? List<Map<String, Any>> ?: emptyList()
    }

    suspend fun approveSeedReviewPhoto(id: String, setAsHero: Boolean = false) {
        client.post("$serverBaseUrl/admin/seed-review/$id/approve") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(mapOf("setAsHero" to setAsHero))
        }
    }

    suspend fun rejectSeedReviewPhoto(id: String, reason: String? = null) {
        client.post("$serverBaseUrl/admin/seed-review/$id/reject") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(mapOf("reason" to reason))
        }
    }

    suspend fun getPlaceStatus(placeId: String): Map<String, Any?> {
        return client.get("reports/$placeId") { withAuth() }.body<Map<String, Any?>>()
    }

    suspend fun reportCrowd(placeId: String, level: String, userId: String) {
        client.post("reports/crowd") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(mapOf("placeId" to placeId, "crowdLevel" to level, "userId" to userId))
        }
    }

    suspend fun reportIssue(placeId: String, type: String, description: String, userId: String) {
        val response = client.post("reports/issue") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(mapOf("placeId" to placeId, "issueType" to type, "description" to description, "userId" to userId))
        }
        if (!response.status.isSuccess()) {
            val text = runCatching { response.bodyAsText() }.getOrNull().orEmpty()
            error("Report failed (${response.status}): $text")
        }
    }

    suspend fun verifyPlayground(playgroundId: String, lat: Double, lng: Double): Map<String, Any?> {
        return client.post("playgrounds/$playgroundId/verify") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(mapOf("lat" to lat, "lng" to lng))
        }.body()
    }

    suspend fun getNearbySponsors(lat: Double, lng: Double): List<Map<String, String>> {
        val response: HttpResponse = client.get("sponsors/nearby") {
            parameter("lat", lat)
            parameter("lng", lng)
        }
        val data: Map<String, Any> = response.body()
        @Suppress("UNCHECKED_CAST")
        return (data["data"] as? List<Map<String, String>>) ?: emptyList()
    }

    suspend fun deleteAccount(): Map<String, Any?> {
        return client.delete("account") { withAuth() }.body<Map<String, Any?>>()
    }

    suspend fun setDisplayName(displayName: String): String {
        @Serializable
        data class DisplayNameResponse(val message: String = "", val displayName: String = "")
        val resp = client.put("users/me/display-name") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(mapOf("displayName" to displayName))
        }.body<DisplayNameResponse>()
        return resp.displayName
    }

    // ─── Admin Analytics ──────────────────────────────────────────────────────

    suspend fun getDailyTrends(startDate: String, endDate: String): List<DailyTrendPoint> {
        return client.get("${serverBaseUrl}/admin/trends/daily") {
            withAuth()
            parameter("startDate", startDate)
            parameter("endDate", endDate)
        }.body<DailyTrendsEnvelope>().data
    }

    suspend fun getTopContributors(startDate: String, endDate: String, limit: Int = 10): List<ContributorSummary> {
        return client.get("${serverBaseUrl}/admin/trends/top-contributors") {
            withAuth()
            parameter("startDate", startDate)
            parameter("endDate", endDate)
            parameter("limit", limit)
        }.body<TopContributorsEnvelope>().data
    }

    suspend fun getContributorLeaderboard(
        startDate: String,
        endDate: String,
        limit: Int = 25,
        regionKey: String? = null,
    ): List<ContributorLeaderboardEntry> {
        return client.get("${serverBaseUrl}/admin/trends/contributor-leaderboard") {
            withAuth()
            parameter("startDate", startDate)
            parameter("endDate", endDate)
            parameter("limit", limit)
            if (!regionKey.isNullOrBlank()) parameter("regionKey", regionKey)
        }.body<ContributorLeaderboardEnvelope>().data
    }

    suspend fun getCityGrowthSummary(): List<CityGrowthEntry> {
        return client.get("${serverBaseUrl}/admin/trends/city-growth") { withAuth() }
            .body<CityGrowthEnvelope>().data
    }

    suspend fun getAdminAnalyticsOverview(startDate: String, endDate: String): AdminAnalyticsOverview {
        return client.get("${serverBaseUrl}/admin/trends/overview") {
            withAuth()
            parameter("startDate", startDate)
            parameter("endDate", endDate)
        }.body<AdminAnalyticsOverviewEnvelope>().data
    }

    suspend fun getLeaderboard(regionKey: String? = null, limit: Int = 10): List<LeaderboardEntry> {
        return client.get("leaderboard") {
            withAuth()
            if (!regionKey.isNullOrBlank()) parameter("regionKey", regionKey)
            parameter("limit", limit)
        }.body<LeaderboardEnvelope>().data
    }

    // ─── City Completion Meter (9.10) ─────────────────────────────────────────

    @Serializable
    data class CityCompletion(
        val regionKey: String = "",
        val completionPercent: Int = 0,
        val totalPlaces: Int = 0,
        val verifiedPlaces: Int = 0,
    )

    @Serializable
    private data class CityCompletionEnvelope(val message: String = "", val data: CityCompletion = CityCompletion())

    suspend fun getCityCompletion(regionKey: String): CityCompletion {
        return client.get("cities/$regionKey/completion") {
            withAuth()
        }.body<CityCompletionEnvelope>().data
    }

    // ─── Advertiser Intake (7.6) ──────────────────────────────────────────────

    suspend fun submitAdvertiserIntake(
        businessName: String, contactEmail: String, category: String,
        city: String, websiteUrl: String?, description: String?,
    ) {
        client.post("advertisers") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(mapOf("businessName" to businessName, "contactEmail" to contactEmail,
                "category" to category, "city" to city, "websiteUrl" to websiteUrl, "description" to description))
        }
    }

    /** Fetches unread login-alert notifications (points awarded, rejections, etc.). */
    suspend fun getUnreadNotifications(): List<Map<String, Any?>> {
        val resp = client.get("users/me/notifications") { withAuth() }.body<Map<String, Any?>>()
        @Suppress("UNCHECKED_CAST")
        return (resp["data"] as? List<Map<String, Any?>>) ?: emptyList()
    }

    /** Marks all (or specific) notifications as read. */
    suspend fun markNotificationsRead(ids: List<String>? = null) {
        client.post("users/me/notifications/mark-read") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(if (ids != null) mapOf("ids" to ids) else emptyMap<String, Any>())
        }
    }

    /** Fetches approved custom category options (e.g. new amenities approved by admin). */
    suspend fun getCategoryOptions(category: String): List<String> {
        return try {
            val resp = client.get("playgrounds/category-options/$category") { withAuth() }
                .body<Map<String, Any?>>()
            @Suppress("UNCHECKED_CAST")
            (resp["data"] as? List<String>) ?: emptyList()
        } catch (_: Exception) {
            emptyList()
        }
    }

    /** Submits a user-initiated removal request (moderation queue; approve = archive). */
    suspend fun requestDeletePlayground(playgroundId: String, reason: String? = null) {
        client.post("playgrounds/$playgroundId/request-delete") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(
                buildJsonObject {
                    if (!reason.isNullOrBlank()) put("reason", reason.trim())
                },
            )
        }
    }

    // ─── Region Search & Admin Region Management ─────────────────────────────

    /** Searches for a region by city/state query, triggering auto-seed if needed. */
    suspend fun searchRegion(query: String): RegionSearchResult {
        return client.post("regions/search") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(mapOf("query" to query))
        }.body()
    }

    /**
     * Same as [searchRegion] but for device GPS: reverse-geocodes on the server and returns
     * merged regional + nearby DB places (used when there is no saved city string).
     */
    suspend fun searchRegionAtCoordinates(lat: Double, lng: Double): RegionSearchResult {
        return client.post("regions/search") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(mapOf("lat" to lat, "lng" to lng))
            timeout {
                requestTimeoutMillis = 90_000
                connectTimeoutMillis = 25_000
                socketTimeoutMillis = 90_000
            }
        }.body()
    }

    /** Autocomplete US locations (cities, addresses, zip codes) via Google Places. */
    suspend fun autocompleteLocation(input: String): List<CityPrediction> {
        val response: AutocompleteResponse = client.get("regions/autocomplete") {
            withAuth()
            parameter("input", input)
        }.body()
        return response.predictions
    }

    /** Fetches paginated playgrounds for a given regionKey. */
    suspend fun getPlaygroundsByRegion(regionKey: String, limit: Int = 50, skip: Int = 0): PlaygroundResponse {
        return client.get("regions/by-region") {
            withAuth()
            parameter("regionKey", regionKey)
            parameter("limit", limit)
            parameter("skip", skip)
        }.body()
    }

    /** Fetches all seeded regions (admin only). */
    suspend fun getSeededRegions(): SeededRegionEnvelope {
        return client.get("${serverBaseUrl}/admin/regions") { withAuth() }.body()
    }

    /** Triggers seeding for a new city/state region (admin only). */
    suspend fun adminSeedRegion(city: String, state: String): Map<String, String> {
        return client.post("${serverBaseUrl}/admin/regions/seed") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(mapOf("city" to city, "state" to state))
        }.body()
    }

    /** Deletes a region and all its playground data (admin only). */
    suspend fun adminDeleteRegion(regionKey: String) {
        client.delete("$serverBaseUrl/admin/ads/regions/$regionKey") { withAuth() }
    }

    /** Re-seeds an existing region (admin only). */
    suspend fun adminReseedRegion(regionKey: String) {
        client.post("$serverBaseUrl/admin/ads/regions/$regionKey/reseed") { withAuth() }
    }

    /** Expands a region's coverage radius and triggers re-seed (admin only). */
    suspend fun adminExpandRegion(regionKey: String) {
        client.post("$serverBaseUrl/admin/ads/regions/$regionKey/expand") { withAuth() }
    }

    /**
     * Schedules a lightweight Places re-crawl (grid + paginated Nearby Search, upserts only).
     * Admin region list — does not wipe data or run full merge/scrub.
     */
    suspend fun adminLightweightReseedRegion(regionKey: String): LightweightReseedPayload {
        val response = client.post("$serverBaseUrl/admin/ads/regions/$regionKey/lightweight-reseed") { withAuth() }
        response.requireHttpSuccess("Light re-seed failed")
        return response.body<LightweightReseedEnvelope>().data
    }

    /**
     * Admin: schedule a Google Places crawl for the **visible map** rectangle (current camera),
     * attributed to [regionKey]. Does not wipe data.
     */
    suspend fun adminSeedMapViewport(
        regionKey: String,
        southWestLat: Double,
        southWestLng: Double,
        northEastLat: Double,
        northEastLng: Double,
    ): SeedMapViewportPayload {
        val response = client.post("$serverBaseUrl/admin/ads/regions/$regionKey/seed-viewport") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(
                mapOf(
                    "southWestLat" to southWestLat,
                    "southWestLng" to southWestLng,
                    "northEastLat" to northEastLat,
                    "northEastLng" to northEastLng,
                ),
            )
        }
        response.requireHttpSuccess("Seed this map view failed")
        return response.body<SeedMapViewportEnvelope>().data
    }

    // ─── Rating & Quick Verify ───────────────────────────────────────────────

    suspend fun quickVerify(playgroundId: String, lat: Double, lng: Double, rating: Int? = null): QuickVerifyResponse {
        return client.post {
            url { appendPathSegments("playgrounds", playgroundId, "quick-verify") }
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(buildMap {
                put("lat", lat)
                put("lng", lng)
                if (rating != null) put("rating", rating)
            })
        }.body()
    }

    suspend fun ratePlayground(playgroundId: String, rating: Int): RateResponse {
        return client.post {
            url { appendPathSegments("playgrounds", playgroundId, "rate") }
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(mapOf("rating" to rating))
        }.body()
    }

    // ─── Advertising API ─────────────────────────────────────────────────────

    /** Creates a new ad submission with business info (step 1). */
    suspend fun createSubmission(
        businessName: String,
        category: String,
        city: String,
        state: String,
        contactEmail: String,
        websiteUrl: String? = null,
        description: String? = null,
        businessAddress: String? = null,
    ): AdSubmission {
        val response = client.post("ads/submissions") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(buildMap {
                put("businessName", businessName)
                put("category", category)
                put("city", city)
                put("state", state)
                put("contactEmail", contactEmail)
                if (websiteUrl != null) put("websiteUrl", websiteUrl)
                if (description != null) put("description", description)
                if (businessAddress != null) put("businessAddress", businessAddress)
            })
        }
        response.requireHttpSuccess("Create submission failed")
        return response.body<AdSubmissionEnvelope>().data
    }

    /** Updates a submission at the given step (steps 2–5). */
    suspend fun updateSubmission(id: String, stepData: Map<String, Any?>): AdSubmission {
        val response = client.put("ads/submissions/$id") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(stepData)
        }
        response.requireHttpSuccess("Submission update failed")
        return response.body<AdSubmissionEnvelope>().data
    }

    /** Updates a submission with a JsonObject body (avoids mixed-type serialization issues). */
    suspend fun updateSubmissionJson(id: String, body: JsonObject): AdSubmission {
        val response = client.put("ads/submissions/$id") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(body)
        }
        response.requireHttpSuccess("Submission update failed")
        return response.body<AdSubmissionEnvelope>().data
    }

    /** Uploads an image asset for an ad submission. */
    suspend fun uploadAdAsset(submissionId: String, imageBytes: ByteArray, filename: String): String {
        val partContentType = contentTypeForAdImageFilename(filename)
        val response = client.post("ads/submissions/$submissionId/assets") {
            withAuth()
            setBody(MultiPartFormDataContent(formData {
                append("image", imageBytes, Headers.build {
                    append(HttpHeaders.ContentType, partContentType.toString())
                    append(HttpHeaders.ContentDisposition, "filename=\"$filename\"")
                })
            }))
        }
        response.requireHttpSuccess("Ad image upload failed")
        return response.body<AdAssetUploadEnvelope>().data.imageUrl
    }

    /** Fetches a single submission by ID. */
    suspend fun getSubmission(id: String): AdSubmission {
        val response = client.get("ads/submissions/$id") { withAuth() }
        response.requireHttpSuccess("Load submission failed")
        return response.body<AdSubmissionEnvelope>().data
    }

    /** Permanently deletes a draft submission (no campaign, no completed payment). */
    suspend fun deleteDraftSubmission(submissionId: String) {
        val response = client.delete("ads/submissions/$submissionId") { withAuth() }
        response.requireHttpSuccess("Delete submission failed")
    }

    /** Cancels before launch: releases authorization or refunds per server rules; updates submission/campaign. */
    suspend fun prelaunchCancelSubmission(submissionId: String) {
        val response = client.post("ads/submissions/$submissionId/prelaunch-cancel") { withAuth() }
        response.requireHttpSuccess("Withdraw submission failed")
    }

    /** Fetches the creative linked to a submission. */
    suspend fun getAdCreative(submissionId: String): AdCreative {
        val response = client.get("ads/submissions/$submissionId/creative") { withAuth() }
        if (response.status.value != 200) {
            throw Exception("Failed to load creative (${response.status.value})")
        }
        val envelope = response.body<AdCreativeEnvelope>()
        if (envelope.data.headline.isBlank() && envelope.data.body.isBlank()) {
            throw Exception("Creative has no content — please go back and re-enter your ad details")
        }
        return envelope.data
    }

    /** Fetches the authenticated user's advertiser record. */
    suspend fun getMyAdvertiser(): Advertiser {
        return client.get("advertisers/me") { withAuth() }.body<AdvertiserEnvelope>().data
    }

    /** Creates a renewal submission from a previous submission. */
    suspend fun renewSubmission(previousSubmissionId: String): RenewalResponse {
        return client.post("ads/submissions/renew") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(mapOf("previousSubmissionId" to previousSubmissionId))
        }.body<RenewalResponseEnvelope>().data
    }

    /** Lists the current user's own ad (campaign) submissions. */
    suspend fun getMyAdSubmissions(): List<AdSubmission> {
        return client.get("ads/submissions/mine") { withAuth() }.body<AdSubmissionListEnvelope>().data
    }

    /** Accepts terms for a submission (step 5). */
    suspend fun acceptTerms(submissionId: String, termsVersion: String = "1.0"): AdSubmission {
        return updateSubmissionJson(submissionId, JsonObject(mapOf("step" to JsonPrimitive(5), "termsVersion" to JsonPrimitive(termsVersion))))
    }

    /** Creates a Stripe PaymentIntent for a submission. */
    suspend fun createPaymentIntent(submissionId: String, discountCode: String? = null): CreatePaymentIntentData {
        val body = buildMap<String, String> {
            put("submissionId", submissionId)
            if (discountCode != null) put("discountCode", discountCode)
        }
        val response = client.post("ads/payments/create-intent") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(body)
        }
        // Error JSON like `{ "error": "..." }` has no `data`; with coerceInputValues the envelope becomes empty
        // and clientSecret looks missing — same pattern as getPlaygroundById.
        if (!response.status.isSuccess()) {
            val snippet = runCatching { response.bodyAsText() }.getOrNull().orEmpty().take(500)
            error("Payment setup failed (${response.status.value}): $snippet")
        }
        val data = response.body<CreatePaymentIntentEnvelope>().data
        if (!data.freeCheckout && data.clientSecret.isBlank()) {
            error(
                "Server returned no client secret. Ensure server/.env has STRIPE_SECRET_KEY (secret key, not publishable), " +
                    "restart the API, and use the same test/live mode as STRIPE_PUBLISHABLE_KEY in local.properties.",
            )
        }
        return data
    }

    /** Best-effort: capture authorized PaymentIntent + run validation when webhooks didn’t (local dev). */
    suspend fun reconcileAdPaymentAfterCheckout(submissionId: String) {
        val response = client.post("ads/payments/reconcile/$submissionId") { withAuth() }
        if (!response.status.isSuccess()) {
            return
        }
    }

    /** Fetches the receipt for a succeeded payment. */
    suspend fun getReceipt(submissionId: String): Receipt {
        return client.get("ads/payments/receipt/$submissionId") {
            withAuth()
        }.body<ReceiptEnvelope>().data
    }

    /** Fetches an ad for a given city and placement. */
    suspend fun getAd(cityId: String, placement: String): AdResponse {
        return client.get("ads") {
            parameter("city_id", cityId)
            parameter("placement", placement)
        }.body<AdResponseEnvelope>().data
    }

    /** Fetches ALL active ads for a city + placement (shuffled), for timed rotation. */
    suspend fun getAllAds(cityId: String, placement: String): AllAdsResponse {
        return try {
            client.get("ads/all") {
                parameter("city_id", cityId)
                parameter("placement", placement)
            }.body<AllAdsResponseEnvelope>().data
        } catch (_: Exception) {
            AllAdsResponse()
        }
    }

    /** Fetches inline listing ads for search results. */
    suspend fun getInlineAds(cityId: String, resultCount: Int): List<AdResponse> {
        // The serving endpoint returns one ad per request; fetch one for inline placement.
        // The caller can decide how many slots to fill based on resultCount.
        return try {
            val ad = client.get("ads") {
                parameter("city_id", cityId)
                parameter("placement", "inline_listing")
                parameter("count", resultCount)
            }.body<AdResponseEnvelope>().data
            if (ad.ad != null) listOf(ad) else emptyList()
        } catch (_: Exception) {
            emptyList()
        }
    }

    /** Records an ad impression or click event. */
    suspend fun trackAdEvent(
        type: String,
        adId: String,
        campaignId: String,
        cityId: String,
        placement: String,
    ) {
        client.post("ads/events") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(mapOf(
                "type" to type,
                "adId" to adId,
                "campaignId" to campaignId,
                "cityId" to cityId,
                "placement" to placement,
            ))
        }
    }

    /** Lists the current advertiser's campaigns with stats. */
    suspend fun getMyCampaigns(): List<AdCampaignStats> {
        return client.get("ads/analytics/campaigns") { withAuth() }.body<AdCampaignListEnvelope>().data
    }

    /** Fetches detailed analytics for a specific campaign. */
    suspend fun getCampaignAnalytics(campaignId: String): CampaignAnalyticsData {
        return client.get("ads/analytics/campaigns/$campaignId") { withAuth() }.body<CampaignAnalyticsEnvelope>().data
    }

    /** Fetches the admin review queue of flagged submissions. */
    suspend fun getAdReviewQueue(): List<AdSubmission> {
        return client.get("$serverBaseUrl/admin/ads/submissions") {
            withAuth()
            parameter("status", "manual_review")
        }.body<AdSubmissionListEnvelope>().data
    }

    /** Fetches full detail for an admin ad submission review. */
    suspend fun getAdSubmissionDetail(id: String): Map<String, Any?> {
        val text = client.get("$serverBaseUrl/admin/ads/submissions/$id") { withAuth() }.bodyAsText()
        val root = runCatching { adminJson.parseToJsonElement(text).jsonObject }.getOrNull() ?: return emptyMap()
        val dataEl = root["data"]?.jsonObject ?: return emptyMap()
        return jsonObjectToDeepMap(dataEl)
    }

    /** Admin approves or rejects a flagged ad submission. */
    suspend fun reviewAdSubmission(id: String, decision: String, reason: String? = null) {
        client.post("$serverBaseUrl/admin/ads/submissions/$id/review") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(buildMap {
                put("decision", decision)
                if (reason != null) put("reason", reason)
            })
        }
    }

    /** Admin asks advertiser to revise creative; cancels uncaptured payment if present. */
    suspend fun requestAdSubmissionRevision(id: String, message: String) {
        client.post("$serverBaseUrl/admin/ads/submissions/$id/request-revision") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(mapOf("message" to message.trim()))
        }
    }

    /**
     * Admin: set submission [status] when the queue is wrong (e.g. reject failed at Stripe before DB).
     * Does not call Stripe; verify payment separately if needed.
     */
    suspend fun adminSetAdSubmissionStatus(submissionId: String, status: String, note: String? = null) {
        client.post("$serverBaseUrl/admin/ads/submissions/$submissionId/admin-set-status") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(
                encodeAdminJsonBody {
                    put("status", status.trim())
                    if (!note.isNullOrBlank()) put("note", note.trim())
                },
            )
        }
    }

    // ─── City Phase & Pricing API ────────────────────────────────────────────

    /** Fetches the current phase and slot info for a city. */
    suspend fun getCityPhase(regionKey: String): CityPhaseInfo {
        return client.get("ads/city-phase") {
            parameter("cityId", regionKey)
        }.body<CityPhaseEnvelope>().data
    }

    /** Fetches the current price for a placement in a city. */
    suspend fun getPhasePrice(regionKey: String, placement: String): PhasePrice {
        return client.get("ads/pricing") {
            parameter("cityId", regionKey)
            parameter("placement", placement)
        }.body<PhasePriceEnvelope>().data
    }

    /** Admin: lists all cities with phase and slot status. */
    suspend fun getAdminCityPhases(): List<CityPhaseListItem> {
        return client.get("$serverBaseUrl/admin/ads/cities") {
            withAuth()
        }.body<CityPhaseListEnvelope>().data
    }

    /** Admin: manually sets a city's phase. */
    suspend fun setAdminCityPhase(cityId: String, phase: String) {
        client.put("$serverBaseUrl/admin/ads/cities/$cityId/phase") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(mapOf("phase" to phase))
        }
    }

    /** Admin: opens a seeding (or legacy) city to advertising — growth slots and pricing. */
    suspend fun openCityAdvertising(cityId: String) {
        client.post("$serverBaseUrl/admin/ads/cities/$cityId/open-advertising") {
            withAuth()
        }
    }

    /** Fetches today's ad impression count for a city (public, no auth). */
    suspend fun getDailyAdViews(cityId: String): Int {
        return try {
            val resp = client.get("ads/daily-views") {
                parameter("cityId", cityId)
            }.body<Map<String, Any?>>()
            val dataValue = resp["data"] ?: return 0

            when (dataValue) {
                is Map<*, *> -> (dataValue["todayViews"] as? Number)?.toInt() ?: 0
                is JsonObject -> (dataValue["todayViews"] as? JsonPrimitive)?.content?.toIntOrNull() ?: 0
                else -> 0
            }
        } catch (_: Exception) { 0 }
    }

    // ─── Discount Code API ───────────────────────────────────────────────────

    /** Admin: lists all discount codes. */
    suspend fun getDiscountCodes(): List<DiscountCode> {
        return client.get("$serverBaseUrl/admin/ads/discounts") { withAuth() }.body<DiscountCodeListEnvelope>().data
    }

    /** Admin: creates a new discount code. Use [encodeAdminJsonBody] (not [mapOf]) so mixed types serialize on all Ktor targets. */
    suspend fun createDiscountCode(
        code: String,
        percentOff: Int,
        startDate: String,
        endDate: String,
        maxUses: Int = 0,
        regionKey: String? = null,
        advertiserId: String? = null,
        devOnly: Boolean = false,
        unlimitedValidity: Boolean = false,
    ): DiscountCode {
        return client.post("$serverBaseUrl/admin/ads/discounts") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(
                encodeAdminJsonBody {
                    put("code", code.trim())
                    put("percentOff", percentOff)
                    put("startDate", startDate.trim())
                    put("endDate", endDate.trim())
                    put("maxUses", maxUses)
                    if (!regionKey.isNullOrBlank()) put("regionKey", regionKey.trim())
                    if (!advertiserId.isNullOrBlank()) put("advertiserId", advertiserId.trim())
                    if (devOnly) put("devOnly", true)
                    if (unlimitedValidity) put("unlimitedValidity", true)
                },
            )
        }.body<DiscountCodeEnvelope>().data
    }

    /** Admin: soft-deletes (deactivates) a discount code. */
    suspend fun deactivateDiscountCode(id: String) {
        client.delete("$serverBaseUrl/admin/ads/discounts/$id") { withAuth() }
    }

    /** Admin: fetches redemption history for a discount code. */
    suspend fun getDiscountRedemptions(codeId: String): List<DiscountRedemption> {
        return client.get("$serverBaseUrl/admin/ads/discounts/$codeId/redemptions") { withAuth() }.body<DiscountRedemptionListEnvelope>().data
    }

    /** Validates a discount code for a given submission. */
    suspend fun validateDiscountCode(code: String, submissionId: String): DiscountValidationResult {
        return client.post("ads/discounts/validate") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(
                encodeAdminJsonBody {
                    put("code", code.trim())
                    put("submissionId", submissionId.trim())
                },
            )
        }.body<DiscountValidationEnvelope>().data
    }

    /** Completes a free submission (100% discount, no Stripe). */
    suspend fun completeFreeSubmission(submissionId: String, discountCode: String) {
        val response = client.post("ads/payments/free-submission") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(
                encodeAdminJsonBody {
                    put("submissionId", submissionId.trim())
                    put("discountCode", discountCode.trim())
                },
            )
        }
        if (!response.status.isSuccess()) {
            val snippet = runCatching { response.bodyAsText() }.getOrNull().orEmpty().take(500)
            error("Free checkout failed (${response.status.value}): $snippet")
        }
    }

    // ─── Radius Targeting & Campaign Management ──────────────────────────────

    /** Fetches radius preview showing reachable cities at each tier (uses advertiser regionKey — avoids city/state parse bugs). */
    suspend fun getRadiusPreview(regionKey: String): RadiusPreviewData {
        return client.get("ads/submissions/radius-preview") {
            withAuth()
            parameter("regionKey", regionKey)
        }.body<RadiusPreviewResponse>().data
    }

    /** Edits creative content on an active/scheduled campaign. */
    suspend fun editCampaignCreative(campaignId: String, fields: Map<String, Any?>) {
        client.put("ads/campaigns/$campaignId/creative") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(fields)
        }
    }

    /** Edits event fields on an event campaign. */
    suspend fun editCampaignEvent(campaignId: String, fields: Map<String, Any?>) {
        client.put("ads/campaigns/$campaignId/event") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(fields)
        }
    }

    /** Cancels a campaign and returns the refund info. */
    suspend fun cancelCampaign(campaignId: String): CancelResponse {
        return client.post("ads/campaigns/$campaignId/cancel") {
            withAuth()
        }.body<CancelResponseEnvelope>().data
    }

    /** Gets estimated refund amount for a campaign cancellation. */
    suspend fun getRefundEstimate(campaignId: String): RefundEstimate {
        return client.get("ads/campaigns/$campaignId/refund-estimate") {
            withAuth()
        }.body<RefundEstimateEnvelope>().data
    }

    // ─── Admin Lifecycle ─────────────────────────────────────────────────────

    /** Admin: manually triggers campaign lifecycle transitions and intro expirations. */
    suspend fun runLifecycle(): LifecycleRunResult {
        return client.post("${serverBaseUrl}/admin/ads/lifecycle/run") {
            withAuth()
        }.body<LifecycleRunEnvelope>().data
    }

    /** Admin: lists all advertisers with submission and campaign counts. */
    suspend fun getAdvertisers(): List<AdvertiserListItem> {
        return client.get("${serverBaseUrl}/admin/ads/advertisers") {
            withAuth()
        }.body<AdvertiserListEnvelope>().data
    }

    // ─── Admin Campaign Management ───────────────────────────────────────────

    /** Admin: lists campaigns with optional status filter and pagination. */
    suspend fun getAdminCampaigns(status: String? = null, page: Int = 1, limit: Int = 20): AdminCampaignListEnvelope {
        return client.get("$serverBaseUrl/admin/ads/campaigns") {
            withAuth()
            if (!status.isNullOrBlank()) parameter("status", status)
            parameter("page", page)
            parameter("limit", limit)
        }.body()
    }

    /** Admin: cancels a campaign with an optional reason. */
    suspend fun adminCancelCampaign(id: String, reason: String? = null) {
        client.post("$serverBaseUrl/admin/ads/campaigns/$id/cancel") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(buildMap {
                if (reason != null) put("reason", reason)
            })
        }
    }

    /** Admin: extends a campaign by a number of days with an optional reason. */
    suspend fun adminExtendCampaign(id: String, days: Int, reason: String? = null) {
        client.post("$serverBaseUrl/admin/ads/campaigns/$id/extend") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(buildMap {
                put("days", days)
                if (reason != null) put("reason", reason)
            })
        }
    }

    /** Admin: pauses an active campaign. */
    suspend fun adminPauseCampaign(id: String) {
        client.post("$serverBaseUrl/admin/ads/campaigns/$id/pause") { withAuth() }
    }

    /** Admin: unpauses a paused campaign. */
    suspend fun adminUnpauseCampaign(id: String) {
        client.post("$serverBaseUrl/admin/ads/campaigns/$id/unpause") { withAuth() }
    }

    /** Admin: refunds a campaign (full or partial). */
    suspend fun adminRefundCampaign(id: String, type: String, amountInCents: Int? = null, reason: String? = null) {
        client.post("$serverBaseUrl/admin/ads/campaigns/$id/refund") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(buildMap {
                put("type", type)
                if (amountInCents != null) put("amountInCents", amountInCents)
                if (reason != null) put("reason", reason)
            })
        }
    }

    /** Admin: soft-deletes (archives) a playground by id. */
    suspend fun adminDeletePlayground(playgroundId: String) {
        client.delete("$serverBaseUrl/admin/playgrounds/$playgroundId") { withAuth() }
    }

    /**
     * Admin: set [regionKey] on every playground whose name contains [nameContains] (substring, case-insensitive),
     * regardless of current region. Server treats [nameContains] as literal text (regex special chars escaped).
     */
    suspend fun adminBulkRegionTag(nameContains: String, regionKey: String, dryRun: Boolean): Map<String, Any?> {
        val text = client.post("$serverBaseUrl/admin/playgrounds/bulk-region-tag") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(
                encodeAdminJsonBody {
                    put("nameContains", nameContains)
                    put("regionKey", regionKey)
                    put("dryRun", dryRun)
                },
            )
        }.bodyAsText()
        val root = runCatching { adminJson.parseToJsonElement(text).jsonObject }.getOrNull()
            ?: return mapOf("error" to text)
        return jsonObjectToDeepMap(root)
    }

    /**
     * Admin: set [playgroundType] (Location type / activity, e.g. "Mini Golf") on every playground whose name
     * contains [nameContains] (substring, case-insensitive), in any region. Does not change [regionKey].
     */
    suspend fun adminBulkSetPlaygroundTypeByName(
        nameContains: String,
        playgroundType: String,
        dryRun: Boolean,
    ): Map<String, Any?> {
        val text = client.post("$serverBaseUrl/admin/playgrounds/bulk-set-playground-type-by-name") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(
                encodeAdminJsonBody {
                    put("nameContains", nameContains.trim())
                    put("playgroundType", playgroundType.trim())
                    put("dryRun", dryRun)
                },
            )
        }.bodyAsText()
        val root = runCatching { adminJson.parseToJsonElement(text).jsonObject }.getOrNull()
            ?: return mapOf("error" to text)
        return jsonObjectToDeepMap(root)
    }

    /** Admin: move all playgrounds from [fromRegionKey] to [targetRegionKey] (merge regions). */
    suspend fun adminReassignRegion(fromRegionKey: String, targetRegionKey: String, dryRun: Boolean): Map<String, Any?> {
        val text = client.post("$serverBaseUrl/admin/playgrounds/reassign-region") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(
                encodeAdminJsonBody {
                    put("fromRegionKey", fromRegionKey.trim())
                    put("targetRegionKey", targetRegionKey.trim())
                    put("dryRun", dryRun)
                },
            )
        }.bodyAsText()
        val root = runCatching { adminJson.parseToJsonElement(text).jsonObject }.getOrNull()
            ?: return mapOf("error" to text)
        return jsonObjectToDeepMap(root)
    }

    /** Admin: dry-run preview for proximity dedupe + campus/address sub-venue clusters (no writes). */
    suspend fun adminMergePreview(regionKey: String, distanceMeters: Int? = null): Map<String, Any?> {
        val text = client.get("$serverBaseUrl/admin/merge-preview") {
            withAuth()
            parameter("regionKey", regionKey.trim())
            if (distanceMeters != null) parameter("distanceMeters", distanceMeters)
            timeout {
                requestTimeoutMillis = 300_000
                socketTimeoutMillis = 300_000
            }
        }.bodyAsText()
        val root = runCatching { adminJson.parseToJsonElement(text).jsonObject }.getOrNull()
            ?: return mapOf("error" to text)
        return jsonObjectToDeepMap(root)
    }

    /**
     * Admin: run proximity dedupe (merge near-duplicate venues) and sub-venue grouping.
     * When [dryRun] is true, dedupe is simulated and grouping returns cluster previews only.
     */
    suspend fun adminMergeRegion(regionKey: String, dryRun: Boolean, distanceMeters: Int? = null): Map<String, Any?> {
        val text = client.post("$serverBaseUrl/admin/merge-region") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(
                encodeAdminJsonBody {
                    put("regionKey", regionKey.trim())
                    put("dryRun", dryRun)
                    if (distanceMeters != null) put("distanceMeters", distanceMeters!!)
                },
            )
            timeout {
                requestTimeoutMillis = 300_000
                socketTimeoutMillis = 300_000
            }
        }.bodyAsText()
        val root = runCatching { adminJson.parseToJsonElement(text).jsonObject }.getOrNull()
            ?: return mapOf("error" to text)
        return jsonObjectToDeepMap(root)
    }

    /**
     * Admin: preview merges for the same normalized address across different [regionKey]s (border duplicates).
     * No writes. Optional [maxDistanceMeters] (server default 150).
     */
    suspend fun adminMergeCrossRegionPreview(
        maxDistanceMeters: Int? = null,
        requireDistinctRegions: Boolean = true,
    ): Map<String, Any?> {
        val text = client.get("$serverBaseUrl/admin/merge-cross-region-preview") {
            withAuth()
            if (maxDistanceMeters != null) parameter("maxDistanceMeters", maxDistanceMeters)
            parameter("requireDistinctRegions", requireDistinctRegions)
            timeout {
                requestTimeoutMillis = 300_000
                socketTimeoutMillis = 300_000
            }
        }.bodyAsText()
        val root = runCatching { adminJson.parseToJsonElement(text).jsonObject }.getOrNull()
            ?: return mapOf("error" to text)
        return jsonObjectToDeepMap(root)
    }

    /**
     * Admin: merge cross-region duplicates by normalized address + distance.
     * Winner keeps its region; losers are archived. [requireDistinctRegions] true = only multi-region clusters.
     */
    suspend fun adminMergeCrossRegionAddresses(
        dryRun: Boolean = false,
        maxDistanceMeters: Int? = null,
        requireDistinctRegions: Boolean = true,
    ): Map<String, Any?> {
        val text = client.post("$serverBaseUrl/admin/merge-cross-region-addresses") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(
                encodeAdminJsonBody {
                    put("dryRun", dryRun)
                    put("requireDistinctRegions", requireDistinctRegions)
                    if (maxDistanceMeters != null) put("maxDistanceMeters", maxDistanceMeters!!)
                },
            )
            timeout {
                requestTimeoutMillis = 300_000
                socketTimeoutMillis = 300_000
            }
        }.bodyAsText()
        val root = runCatching { adminJson.parseToJsonElement(text).jsonObject }.getOrNull()
            ?: return mapOf("error" to text)
        return jsonObjectToDeepMap(root)
    }

    /** Admin: merge audit — merge type, normalized addresses, archived children (for unlink). */
    suspend fun adminMergeAudit(playgroundId: String): Map<String, Any?> {
        val id = playgroundId.trim()
        val text = client.get("$serverBaseUrl/admin/playgrounds/$id/merge-audit") {
            withAuth()
        }.bodyAsText()
        val root = runCatching { adminJson.parseToJsonElement(text).jsonObject }.getOrNull()
            ?: return mapOf("error" to text)
        root["error"]?.let { err ->
            val msg = (err as? JsonPrimitive)?.contentOrNull ?: err.toString()
            return mapOf("error" to msg)
        }
        val dataEl = root["data"]?.jsonObject ?: return mapOf("error" to "missing data")
        return jsonObjectToDeepMap(dataEl)
    }

    /** Admin: restore an archived venue row; removes it from parent subVenues / mergeInfo.mergedFrom. */
    suspend fun adminUnlinkSubvenue(parentId: String, childId: String): Map<String, Any?> {
        val text = client.post("$serverBaseUrl/admin/unlink-subvenue") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(
                encodeAdminJsonBody {
                    put("parentId", parentId.trim())
                    put("childId", childId.trim())
                },
            )
        }.bodyAsText()
        val root = runCatching { adminJson.parseToJsonElement(text).jsonObject }.getOrNull()
            ?: return mapOf("error" to text)
        root["error"]?.let { err ->
            val msg = (err as? JsonPrimitive)?.contentOrNull ?: err.toString()
            return mapOf("error" to msg)
        }
        val dataEl = root["data"]?.jsonObject ?: return mapOf("message" to (root["message"]?.toString() ?: "success"))
        return jsonObjectToDeepMap(dataEl)
    }

    /**
     * Admin: re-infer playgroundType from rules (after seeding or classification changes).
     * [scope]: seeded | missing | stale_on_seed | recheck_seed | all
     */
    suspend fun adminRecategorizeTypes(
        regionKey: String? = null,
        scope: String = "seeded",
        dryRun: Boolean = true,
        limit: Int? = null,
    ): Map<String, Any?> {
        val text = client.post("$serverBaseUrl/admin/playgrounds/recategorize-types") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(
                encodeAdminJsonBody {
                    put("scope", scope)
                    put("dryRun", dryRun)
                    if (!regionKey.isNullOrBlank()) put("regionKey", regionKey.trim())
                    if (limit != null) put("limit", limit!!)
                },
            )
            timeout {
                requestTimeoutMillis = 300_000
                socketTimeoutMillis = 300_000
            }
        }.bodyAsText()
        val root = runCatching { adminJson.parseToJsonElement(text).jsonObject }.getOrNull()
            ?: return mapOf("error" to text)
        return jsonObjectToDeepMap(root)
    }

    /**
     * Admin: dedupe/trim photo galleries. Server responds immediately and runs work in the background.
     * Pass [regionKey] null to process all regions.
     */
    suspend fun adminTrimGalleries(
        regionKey: String? = null,
        maxPhotos: Int = 25,
        dryRun: Boolean = true,
    ): Map<String, Any?> {
        val text = client.post("$serverBaseUrl/admin/trim-galleries") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(
                encodeAdminJsonBody {
                    if (!regionKey.isNullOrBlank()) put("regionKey", regionKey.trim())
                    put("maxPhotos", maxPhotos)
                    put("dryRun", dryRun)
                },
            )
        }.bodyAsText()
        val root = runCatching { adminJson.parseToJsonElement(text).jsonObject }.getOrNull()
            ?: return mapOf("error" to text)
        return jsonObjectToDeepMap(root)
    }

    /** Admin: temporarily block a user from submissions (requires non-blank reason). */
    suspend fun adminBlockUser(userId: String, reason: String) {
        client.post("$serverBaseUrl/admin/users/$userId/block") {
            withAuth()
            contentType(ContentType.Application.Json)
            setBody(mapOf("reason" to reason))
        }
    }

    suspend fun adminUnblockUser(userId: String) {
        client.post("$serverBaseUrl/admin/users/$userId/unblock") { withAuth() }
    }

    private fun contentTypeForAdImageFilename(filename: String): ContentType {
        return when (filename.substringAfterLast('.').lowercase()) {
            "png" -> ContentType.Image.PNG
            "gif" -> ContentType("image", "gif")
            "webp" -> ContentType("image", "webp")
            else -> ContentType.Image.JPEG
        }
    }
}
