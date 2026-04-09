package org.community.playgroundfinder.ui.composables

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.res.painterResource
import org.community.playgroundfinder.R

@Composable
actual fun playgroundPlaceholderPainter(playgroundType: String?): Painter {
    return painterResource(placeholderDrawableRes(playgroundType))
}

private fun placeholderDrawableRes(playgroundType: String?): Int {
    val t = (playgroundType ?: "").lowercase().trim()
    return when {
        t.contains("public") -> R.drawable.public_playground_placeholder_v2
        t.contains("neighborhood") -> R.drawable.neighborhood_playground_placeholder_v2
        t.contains("private") -> R.drawable.private_park_placeholder_v2
        t.contains("nature") || t.contains("trail") -> R.drawable.nature_trail_placeholder_v2
        t.contains("splash") -> R.drawable.splash_pad_placeholder_v2
        t.contains("beach") -> R.drawable.beach_play_placeholder_v2
        t.contains("botanical") || t.contains("garden") -> R.drawable.botanical_garden_placeholder_v2
        t.contains("indoor") || t.contains("trampoline") || t.contains("arcade") -> R.drawable.indoor_play_placeholder_v2
        t.contains("pool") || t.contains("water park") || t.contains("swim") -> R.drawable.water_park_pool_placeholder_v2
        t.contains("skate") && !t.contains("ice") -> R.drawable.skate_park_placeholder_v2
        t.contains("ice skat") || t.contains("skating rink") -> R.drawable.ice_skating_placeholder_v2
        t.contains("mini golf") || t.contains("putt") -> R.drawable.mini_golf_placeholder_v2
        t.contains("amusement") -> R.drawable.amusement_park_placeholder_v2
        t.contains("bowling") -> R.drawable.indoor_play_placeholder_v2
        t.contains("library") -> R.drawable.library_placeholder_v2
        t.contains("museum") || t.contains("science") -> R.drawable.museum_science_center_placeholder_v2
        t.contains("zoo") || t.contains("aquarium") -> R.drawable.zoo_aquarium_placeholder_v2
        t.contains("school") || t.contains("elementary") -> R.drawable.elementary_school_placeholder_v2
        else -> R.drawable.public_playground_placeholder_v2
    }
}
