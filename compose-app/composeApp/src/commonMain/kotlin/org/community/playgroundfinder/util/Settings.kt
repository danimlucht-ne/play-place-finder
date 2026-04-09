package org.community.playgroundfinder.util

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import com.russhwolf.settings.Settings

/** Thin wrapper so screens can read/write persistent key-value settings. */
interface AppSettings {
    fun getString(key: String, default: String = ""): String
    fun putString(key: String, value: String)
    fun getBoolean(key: String, default: Boolean = false): Boolean
    fun setBoolean(key: String, value: Boolean)
}

private class AppSettingsImpl(private val settings: Settings) : AppSettings {
    override fun getString(key: String, default: String) = settings.getString(key, default)
    override fun putString(key: String, value: String) = settings.putString(key, value)
    override fun getBoolean(key: String, default: Boolean) = settings.getBoolean(key, default)
    override fun setBoolean(key: String, value: Boolean) = settings.putBoolean(key, value)
}

@Composable
fun rememberSettings(): AppSettings {
    return remember { AppSettingsImpl(Settings()) }
}
