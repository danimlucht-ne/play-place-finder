package org.community.playgroundfinder

actual object AppConfig {
    actual val serverBaseUrl: String get() = DevServerBaseOverride.effectiveServerBase()
    actual val marketingSiteBaseUrl: String get() = BuildConfig.MARKETING_SITE_BASE_URL.trim().trimEnd('/')
    actual val stripePublishableKey: String get() = BuildConfig.STRIPE_PUBLISHABLE_KEY
    actual val googleWebClientId: String get() = BuildConfig.GOOGLE_WEB_CLIENT_ID
    actual val isDebugDevelopmentBuild: Boolean get() = BuildConfig.DEBUG
}
