package org.community.playgroundfinder

import org.community.playgroundfinder.util.ApiDevSettingsKeys
import org.community.playgroundfinder.util.AppSettings

/**
 * Debug builds only: optional override of [BuildConfig.SERVER_BASE_URL] so one APK can switch
 * between Wi‑Fi (e.g. http://192.168.1.10:8000) and USB + adb reverse (http://127.0.0.1:8000)
 * without editing local.properties. Release builds always use BuildConfig.
 */
internal object DevServerBaseOverride {
    @Volatile
    private var cachedOverride: String = ""

    fun syncFrom(settings: AppSettings) {
        if (!BuildConfig.DEBUG) return
        cachedOverride = settings.getString(ApiDevSettingsKeys.SERVER_BASE_URL_OVERRIDE, "").trim()
    }

    fun applyAndPersist(settings: AppSettings, value: String) {
        val t = value.trim()
        if (!BuildConfig.DEBUG) return
        settings.putString(ApiDevSettingsKeys.SERVER_BASE_URL_OVERRIDE, t)
        cachedOverride = t
    }

    fun effectiveServerBase(): String {
        val fromBuild = BuildConfig.SERVER_BASE_URL.trim().trimEnd('/')
        if (!BuildConfig.DEBUG) return fromBuild
        return cachedOverride.ifEmpty { fromBuild }.trim().trimEnd('/')
    }
}
