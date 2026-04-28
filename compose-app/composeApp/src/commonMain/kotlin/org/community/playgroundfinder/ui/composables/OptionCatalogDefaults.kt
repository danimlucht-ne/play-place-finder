package org.community.playgroundfinder.ui.composables

/**
 * App-side baseline labels for option catalogs. Server-approved custom options are merged
 * on top of these defaults at runtime from category_options.
 */
object OptionCatalogDefaults {
    val equipment = listOf(
        "Swings",
        "Slide",
        "Climbing Wall",
        "Monkey Bars",
        "Sandbox",
        "Seesaw",
        "Spring Riders",
        "Balance Beam",
        "Zip Line",
    )

    val swingTypes = listOf("Belt", "Bucket", "Tire", "Accessible")

    val sportsCourts = listOf(
        "Football",
        "Basketball",
        "Soccer",
        "Tennis",
        "Pickleball",
        "Volleyball",
        "Sand Volleyball",
        "Baseball",
        "Softball",
    )

    val exerciseEquipment = listOf(
        "Pull-up Bar",
        "Fitness Station",
        "Walking Trail Exercise Stops",
        "Outdoor Gym",
        "Balance Beam",
        "Parallel Bars",
    )

    val amenities = setOf(
        "Bathrooms",
        "Shade",
        "Fenced",
        "Toddler Friendly",
        "Dog Friendly",
        "Parking",
        "Splash Pad",
        "Accessible",
        "WiFi",
        "Walking Trail",
        "Bottle Filler",
        "Benches",
        "Picnic Tables",
        "Trash Cans",
        "Requires Grip Socks",
        "Requires Waiver",
        "Outdoor Shower",
        "Changing Rooms",
        "Lockers",
        "Nursing Room",
        "Party Room",
        "Covered Seating",
        "Food Services",
        "Snack Bar",
        "Alcohol On Site",
        "Gift Shop",
        "Rental Equipment",
        "Card Only",
        "ATM",
        "Height/Age Restrictions",
        "Arcade Games",
        "Stroller Friendly",
        "Sunscreen Station",
        "Bug Spray Station",
        "EV Charging",
    )

    /**
     * Normalized amenity labels that map to dedicated boolean fields.
     * Mirrors server-side AMENITY_LABEL_TO_FIELD keys for dedupe of custom amenities.
     */
    val hardcodedAmenityKeys = setOf(
        "bathrooms", "shade", "fenced", "toddler friendly", "dog friendly", "parking",
        "splash pad", "accessible", "wifi", "wi fi", "walking trail", "water fountain",
        "bottle filler", "benches", "picnic tables", "trash cans",
        "requires grip socks", "needs grip socks", "requires waiver",
        "outdoor shower", "changing rooms", "lockers", "nursing room", "party room",
        "covered seating", "food services", "snack bar", "alcohol on site",
        "gift shop", "rental equipment", "card only", "atm",
        "height/age restrictions", "height age restrictions",
        "arcade games", "stroller friendly", "sunscreen station", "bug spray station",
        "ev charging",
    )
}
