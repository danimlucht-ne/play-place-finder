package org.community.playgroundfinder

/** Build-time / platform configuration shared across KMP targets (Android: BuildConfig; iOS: plist later). */
expect object AppConfig {
    val serverBaseUrl: String
    /** Public marketing site (Vercel www, etc.) — advertise / legal pages for in-app browser links. */
    val marketingSiteBaseUrl: String
    val stripePublishableKey: String
    val googleWebClientId: String
    /** True for debug Android builds — shows dev-only discount UI (server still enforces). */
    val isDebugDevelopmentBuild: Boolean
}
