package org.community.playgroundfinder.data

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject

@Serializable
data class FeatureSet(
    val equipment: List<String> = emptyList(),
    val swingTypes: List<String> = emptyList(),
    val sportsCourts: List<String> = emptyList(),
    val amenities: List<String> = emptyList(),
    val groundSurface: String? = null,
)

@Serializable
data class PhotoValidation(
    val confirmed: FeatureSet = FeatureSet(),
    val missingFromRecord: FeatureSet = FeatureSet(),
    val noPhotoEvidence: FeatureSet = FeatureSet(),
    val dataQualityScore: Double = 0.0,
    val photoCount: Int = 0,
    val validatedAt: String? = null,
)

@Serializable
data class SubVenue(
    val id: String = "",
    val name: String = "",
    val playgroundType: String? = null,
    val features: List<String> = emptyList(),
    val equipment: List<String> = emptyList(),
    val originalGooglePlaceId: String? = null,
)

@Serializable
data class Playground(
    val id: String? = null,
    val name: String = "",
    val description: String = "",
    val latitude: Double = 0.0,
    val longitude: Double = 0.0,
    val address: String? = null,
    val city: String? = null,
    val state: String? = null,
    val zipCode: String? = null,
    val playgroundType: String? = null,
    val groundType: String? = null,
    val expense: String? = null,
    val costRange: String? = null,
    val costToEnter: String? = null,
    val imageUrls: List<String> = emptyList(),
    val equipment: List<String> = emptyList(),
    val sportsCourts: List<String> = emptyList(),
    val swingTypes: List<String> = emptyList(),
    val hasBathrooms: Boolean? = null,
    val hasShade: Boolean? = null,
    val isFenced: Boolean? = null,
    val isToddlerFriendly: Boolean? = null,
    val hasSplashPad: Boolean? = null,
    val isDogFriendly: Boolean? = null,
    val hasParking: Boolean? = null,
    val hasWifi: Boolean? = null,
    val needsGripSocks: Boolean? = null,
    val requiresWaiver: Boolean? = null,
    val hasBenches: Boolean? = null,
    val hasPicnicTables: Boolean? = null,
    val hasTrashCans: Boolean? = null,
    val isAccessible: Boolean? = null,
    val hasWalkingTrail: Boolean? = null,
    val hasWaterFountain: Boolean? = null,
    val hasPlayground: Boolean? = null,
    // New amenity fields — Facilities
    val hasOutdoorShower: Boolean? = null,
    val hasChangingRooms: Boolean? = null,
    val hasLockers: Boolean? = null,
    val hasNursingRoom: Boolean? = null,
    val hasPartyRoom: Boolean? = null,
    val hasCoveredSeating: Boolean? = null,
    // Services
    val hasFoodServices: Boolean? = null,
    val hasSnackBar: Boolean? = null,
    val hasAlcoholOnSite: Boolean? = null,
    val hasGiftShop: Boolean? = null,
    val hasRentalEquipment: Boolean? = null,
    // Payment/Access
    val isCardOnly: Boolean? = null,
    val hasATM: Boolean? = null,
    val hasHeightAgeRestrictions: Boolean? = null,
    // Entertainment
    val hasArcadeGames: Boolean? = null,
    // Convenience
    val isStrollerFriendly: Boolean? = null,
    val hasSunscreenStation: Boolean? = null,
    val hasBugSprayStation: Boolean? = null,
    val hasEVCharging: Boolean? = null,
    val verificationCount: Int = 0,
    val crowdLevel: String? = null,
    val openIssues: Int = 0,
    val isFavorited: Boolean = false,
    val submittedBy: String? = null,
    val notesForAdmin: String? = null,
    val status: String? = null,
    val badges: List<String> = emptyList(),
    val trustScores: Map<String, Double>? = null,
    val regionKey: String? = null,
    /** Derived from server `normalized.citySlug` for grouping (null for legacy rows). */
    val normalizedCitySlug: String? = null,
    val normalizedCounty: String? = null,
    val normalizedNeighborhood: String? = null,
    val locationNeedsReview: Boolean? = null,
    val website: String? = null,
    val phoneNumber: String? = null,
    val hours: String? = null,
    val ageRange: String? = null,
    val rating: Double? = null,
    val ratingCount: Int = 0,
    val lastVerifiedAt: String? = null,   // ISO date string from server
    val crossStreets: String? = null,     // e.g. "Oak St & Main Ave"
    val distanceMeters: Double? = null,   // populated by search/hybrid endpoints
    val parentVenueId: String? = null,    // sub-venue: ID of the parent venue
    val parentVenueName: String? = null,  // sub-venue: display name of the parent venue
    val exerciseEquipment: List<String> = emptyList(), // pull-up bars, fitness stations, etc.
    val lastVerifiedSource: String? = null, // "seed" | "reseed" | "human"
    val verifiers: List<PlaygroundVerifier> = emptyList(), // top 5 recent verifiers
    val photoValidation: PhotoValidation? = null,
    val subVenues: List<SubVenue> = emptyList(),
)

@Serializable
data class PlaygroundVerifier(
    val userId: String = "",
    val displayName: String? = null,
    val isTopContributor: Boolean = false,
    val verifiedAt: String? = null,
)

/** Tolerates a null or non-array value in the `data` field. */
object SafePlaygroundListSerializer : KSerializer<List<Playground>> {
    private val delegate = ListSerializer(Playground.serializer())

    override val descriptor: SerialDescriptor = delegate.descriptor

    override fun serialize(encoder: Encoder, value: List<Playground>) =
        delegate.serialize(encoder, value)

    override fun deserialize(decoder: Decoder): List<Playground> {
        val jsonDecoder = decoder as? JsonDecoder ?: return delegate.deserialize(decoder)
        return when (val element: JsonElement = jsonDecoder.decodeJsonElement()) {
            is JsonArray -> jsonDecoder.json.decodeFromJsonElement(delegate, element)
            is JsonNull -> emptyList()
            is JsonObject -> {
                // Some endpoints wrap the list in { "places": [...] }
                val arr = element.jsonObject["places"]
                if (arr is JsonArray) jsonDecoder.json.decodeFromJsonElement(delegate, arr)
                else emptyList()
            }
            else -> emptyList()
        }
    }
}

/** Tolerates a non-string value (e.g. {} from corrupted data) by returning null. */
object SafeStringSerializer : KSerializer<String?> {
    override val descriptor: SerialDescriptor =
        kotlinx.serialization.descriptors.PrimitiveSerialDescriptor("SafeString", kotlinx.serialization.descriptors.PrimitiveKind.STRING)

    override fun serialize(encoder: Encoder, value: String?) {
        if (value != null) encoder.encodeString(value) else encoder.encodeNull()
    }

    override fun deserialize(decoder: Decoder): String? {
        val jsonDecoder = decoder as? JsonDecoder ?: return decoder.decodeString()
        return when (val element = jsonDecoder.decodeJsonElement()) {
            is kotlinx.serialization.json.JsonPrimitive -> element.content
            is JsonNull -> null
            else -> null // Object or array — treat as null
        }
    }
}