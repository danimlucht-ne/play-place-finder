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

    private val ALL_AMENITIES = OptionCatalogDefaults.amenities

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
        "parks" to TypeConfig(true, true, true, true, ALL_AMENITIES),
        "school" to TypeConfig(true, true, true, false, ALL_AMENITIES),
        "indoor" to TypeConfig(false, false, false, false, ALL_AMENITIES),
        "water" to TypeConfig(false, false, false, false, ALL_AMENITIES),
        "active" to TypeConfig(false, false, false, false, ALL_AMENITIES),
        "learning" to TypeConfig(false, false, false, false, ALL_AMENITIES),
        "zoo" to TypeConfig(false, false, false, false, ALL_AMENITIES),
        "nature" to TypeConfig(false, false, false, false, ALL_AMENITIES),
        "skate" to TypeConfig(false, false, false, false, ALL_AMENITIES),
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