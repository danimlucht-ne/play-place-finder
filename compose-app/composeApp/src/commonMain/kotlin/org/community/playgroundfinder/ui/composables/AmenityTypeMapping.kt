package org.community.playgroundfinder.ui.composables

data class TypeConfig(
    val showPlaygroundEquipment: Boolean,
    val showSwingTypes: Boolean,
    val showSportsCourts: Boolean,
    val showExerciseEquipment: Boolean,
    val visibleAmenities: Set<String>,
)

object AmenityTypeMapping {

    private val TYPE_GROUP_MAP = mapOf(
        "Public Park" to "parks",
        "Neighborhood Park" to "parks",
        "Private Park" to "parks",
        "Elementary School" to "school",
        "Indoor Play" to "indoor",
        "Splash Pad" to "water",
        "Pool / Water Park" to "water",
        "Skate Park" to "skate",
        "Ice Skating Rink" to "active",
        "Mini Golf" to "active",
        "Amusement Park" to "active",
        "Bowling Alley" to "active",
        "Library" to "learning",
        "Museum / Science Center" to "learning",
        "Zoo / Aquarium" to "zoo",
        "Nature Trail" to "nature",
        "Beach" to "nature",
        "Botanical Garden" to "nature",
    )

    // All amenity names (existing + new) — the full superset
    private val ALL_AMENITIES = setOf(
        // Existing
        "Bathrooms", "Shade", "Fenced", "Toddler Friendly", "Dog Friendly",
        "Parking", "Splash Pad", "Accessible", "WiFi", "Walking Trail",
        "Bottle Filler", "Benches", "Picnic Tables", "Trash Cans",
        "Requires Grip Socks", "Requires Waiver",
        // New — Facilities
        "Outdoor Shower", "Changing Rooms", "Lockers", "Nursing Room",
        "Party Room", "Covered Seating",
        // New — Services
        "Food Services", "Snack Bar", "Alcohol On Site", "Gift Shop", "Rental Equipment",
        // New — Payment/Access
        "Card Only", "ATM", "Height/Age Restrictions",
        // New — Entertainment
        "Arcade Games",
        // New — Convenience
        "Stroller Friendly", "Sunscreen Station", "Bug Spray Station", "EV Charging",
    )

    private val PARKS_AMENITIES = setOf(
        "Bathrooms", "Shade", "Fenced", "Toddler Friendly", "Dog Friendly",
        "Parking", "Splash Pad", "Accessible", "Walking Trail", "Bottle Filler",
        "Benches", "Picnic Tables", "Trash Cans", "Snack Bar", "EV Charging",
    )

    private val SCHOOL_AMENITIES = setOf(
        "Bathrooms", "Shade", "Fenced", "Accessible", "Bottle Filler", "Benches",
    )

    private val INDOOR_AMENITIES = setOf(
        "Bathrooms", "Parking", "Accessible", "Toddler Friendly", "WiFi",
        "Requires Grip Socks", "Requires Waiver", "Food Services", "Snack Bar",
        "Arcade Games", "Lockers", "Nursing Room", "Party Room", "Card Only",
        "ATM", "Height/Age Restrictions", "Stroller Friendly", "Alcohol On Site",
    )

    private val WATER_AMENITIES = setOf(
        "Bathrooms", "Shade", "Parking", "Accessible", "Toddler Friendly",
        "Picnic Tables", "Benches", "Bottle Filler", "Trash Cans",
        "Requires Waiver", "Changing Rooms", "Outdoor Shower", "Lockers",
        "Food Services", "Snack Bar", "Sunscreen Station", "Card Only",
        "Height/Age Restrictions", "Stroller Friendly",
    )

    private val ACTIVE_AMENITIES = setOf(
        "Bathrooms", "Parking", "Accessible", "Toddler Friendly", "WiFi",
        "Requires Waiver", "Food Services", "Snack Bar", "Arcade Games",
        "Gift Shop", "Rental Equipment", "Card Only", "ATM", "Party Room",
        "Height/Age Restrictions", "Alcohol On Site", "Covered Seating",
        "Lockers", "Requires Grip Socks",
    )

    private val LEARNING_AMENITIES = setOf(
        "Bathrooms", "Parking", "Accessible", "Toddler Friendly", "WiFi",
        "Benches", "Gift Shop", "Nursing Room", "Stroller Friendly",
        "Food Services", "Card Only", "EV Charging", "Covered Seating",
    )

    private val ZOO_AMENITIES = setOf(
        "Bathrooms", "Shade", "Parking", "Accessible", "Toddler Friendly",
        "Walking Trail", "Benches", "Picnic Tables", "Bottle Filler", "Trash Cans",
        "Food Services", "Snack Bar", "Gift Shop", "Stroller Friendly",
        "Nursing Room", "Sunscreen Station", "Covered Seating", "Card Only",
        "ATM", "EV Charging",
    )

    private val NATURE_AMENITIES = setOf(
        "Bathrooms", "Shade", "Parking", "Accessible", "Dog Friendly",
        "Walking Trail", "Picnic Tables", "Benches", "Bottle Filler", "Trash Cans",
        "Outdoor Shower", "Changing Rooms", "Sunscreen Station", "Bug Spray Station",
        "EV Charging",
    )

    private val SKATE_AMENITIES = setOf(
        "Bathrooms", "Shade", "Parking", "Accessible", "Benches",
        "Bottle Filler", "Trash Cans", "EV Charging",
    )

    private val FULL_SUPERSET = TypeConfig(
        showPlaygroundEquipment = true,
        showSwingTypes = true,
        showSportsCourts = true,
        showExerciseEquipment = true,
        visibleAmenities = ALL_AMENITIES,
    )

    /** Stored [playgroundType] values (Location type / activity). For admin bulk tools and pickers. */
    val knownPlaygroundTypeLabels: List<String> get() = TYPE_GROUP_MAP.keys.sorted()

    private val GROUP_CONFIGS = mapOf(
        "parks" to TypeConfig(true, true, true, true, PARKS_AMENITIES),
        "school" to TypeConfig(true, true, true, false, SCHOOL_AMENITIES),
        "indoor" to TypeConfig(false, false, false, false, INDOOR_AMENITIES),
        "water" to TypeConfig(false, false, false, false, WATER_AMENITIES),
        "active" to TypeConfig(false, false, false, false, ACTIVE_AMENITIES),
        "learning" to TypeConfig(false, false, false, false, LEARNING_AMENITIES),
        "zoo" to TypeConfig(false, false, false, false, ZOO_AMENITIES),
        "nature" to TypeConfig(false, false, false, false, NATURE_AMENITIES),
        "skate" to TypeConfig(false, false, false, false, SKATE_AMENITIES),
    )

    fun getConfigForType(playgroundType: String?): TypeConfig {
        if (playgroundType.isNullOrBlank()) return FULL_SUPERSET
        val group = TYPE_GROUP_MAP[playgroundType] ?: return FULL_SUPERSET
        return GROUP_CONFIGS[group] ?: FULL_SUPERSET
    }

    fun getTypeGroup(playgroundType: String?): String? {
        if (playgroundType.isNullOrBlank()) return null
        return TYPE_GROUP_MAP[playgroundType]
    }
}