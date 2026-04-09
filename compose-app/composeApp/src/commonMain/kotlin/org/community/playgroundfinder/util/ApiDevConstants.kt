package org.community.playgroundfinder.util

/**
 * Canonical production API host for debug-only "switch to prod" (must match release
 * `SERVER_BASE_URL` default in composeApp/build.gradle.kts when unset).
 */
object ApiDevConstants {
    const val PRODUCTION_API_BASE_URL: String = "https://api.playplacefinder.com"
}
