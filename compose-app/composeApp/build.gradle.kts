import org.jetbrains.kotlin.gradle.ExperimentalKotlinGradlePluginApi
import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import java.io.File
import java.util.Properties

private fun Properties.mergeFrom(file: File) {
    if (file.exists()) file.inputStream().use { load(it) }
}

/** Trim + strip optional quotes (common .properties / editor mistakes). */
private fun Properties.stringProp(name: String): String {
    var v = getProperty(name) ?: return ""
    v = v.trim()
    if (v.length >= 2) {
        if ((v.startsWith("\"") && v.endsWith("\"")) || (v.startsWith("'") && v.endsWith("'"))) {
            v = v.substring(1, v.length - 1).trim()
        }
    }
    return v
}

private fun String.escapeForBuildConfig(): String =
    replace("\\", "\\\\").replace("\"", "\\\"")

// Merge repo-root + module local.properties (Studio often creates only composeApp/local.properties with sdk.dir).
val localProps = Properties().apply {
    mergeFrom(File(rootProject.projectDir, "local.properties"))
    mergeFrom(File(File(rootProject.projectDir, "composeApp"), "local.properties"))
}

plugins {
    alias(libs.plugins.kotlinMultiplatform)
    alias(libs.plugins.androidApplication)
    alias(libs.plugins.composeMultiplatform)
    alias(libs.plugins.composeCompiler)
    alias(libs.plugins.kotlinSerialization)
    alias(libs.plugins.googleServices)
}

kotlin {
    androidTarget {
        @OptIn(ExperimentalKotlinGradlePluginApi::class)
        compilerOptions {
            jvmTarget.set(JvmTarget.JVM_11)
        }
    }

    sourceSets {
        androidMain.dependencies {
            implementation(libs.androidx.activity.compose)
            implementation(libs.kotlinx.coroutines.android)

            // Google Maps (Android-only)
            implementation(libs.maps.compose)
            implementation(libs.play.services.maps)
            implementation(libs.play.services.location)

            // Google Sign-In (4.5.4)
            implementation("com.google.android.gms:play-services-auth:21.2.0")

            // Stripe Android SDK for payment processing
            implementation("com.stripe:stripe-android:20.+")

            // Ad creative: pick then crop (banner-friendly); AppCompat theme for UCropActivity
            implementation("androidx.appcompat:appcompat:1.7.0")
            implementation("com.github.yalantis:ucrop:2.2.8")
        }

        commonMain.dependencies {
            implementation(compose.runtime)
            implementation(compose.foundation)
            implementation(compose.material3)
            implementation(compose.materialIconsExtended)
            implementation(compose.ui)
            implementation(compose.components.resources)
            implementation(compose.components.uiToolingPreview)

            // Ktor HTTP client
            implementation(libs.ktor.client.core)
            implementation(libs.ktor.client.cio)
            implementation(libs.ktor.client.content.negotiation)
            implementation(libs.ktor.client.logging)
            implementation(libs.ktor.serialization.kotlinx.json)

            // Kotlinx
            implementation(libs.kotlinx.serialization.json)
            implementation(libs.kotlinx.coroutines.core)
            implementation(libs.kotlinx.datetime)

            // Coil image loading
            implementation(libs.coil.compose)
            implementation(libs.coil.network.ktor)

            // Multiplatform key-value settings (rememberSettings)
            implementation(libs.multiplatform.settings)
            implementation(libs.multiplatform.settings.no.arg)
        }

        commonTest.dependencies {
            implementation(kotlin("test"))
            implementation(libs.kotlinx.datetime)
            implementation(libs.ktor.client.mock)
            implementation(libs.ktor.client.content.negotiation)
            implementation(libs.ktor.serialization.kotlinx.json)
        }
    }
}

android {
    namespace = "org.community.playgroundfinder"
    compileSdk = libs.versions.compileSdk.get().toInt()
    // Pin NDK so AGP can run llvm-objcopy when extracting native symbol tables. Matches common AGP 8.7+ installs.
    // (SDK Manager → NDK, or first Gradle build may download this side-by-side NDK.)
    ndkVersion = "27.0.12077973"

    defaultConfig {
        applicationId = "org.community.playgroundfinder.android"
        minSdk = libs.versions.minSdk.get().toInt()
        targetSdk = libs.versions.targetSdk.get().toInt()
        // Must increase for every upload to Play Console (internal integer; unrelated to git tags).
        versionCode = 3
        versionName = "1.0.0-beta1"
        // Overridden per buildType; release must not allow cleartext HTTP.
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        // Play wants native debug metadata when the bundle ships .so files (Compose/Skia, SQLite, Maps, etc.).
        // https://developer.android.com/build/include-native-symbols — many Maven AARs only ship stripped .so, so the
        // Console may still show a non-blocking warning until/unless extractReleaseNativeSymbolTables produces symbols.
        ndk {
            debugSymbolLevel = "SYMBOL_TABLE"
        }
    }

    buildFeatures {
        buildConfig = true
        compose = true
    }

    buildTypes {
        debug {
            isDebuggable = true
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            buildConfigField(
                "String",
                "SERVER_BASE_URL",
                "\"${localProps.stringProp("SERVER_BASE_URL").ifEmpty { "http://10.0.2.2:8000" }.escapeForBuildConfig()}\""
            )
            buildConfigField(
                "String",
                "GOOGLE_WEB_CLIENT_ID",
                "\"${localProps.stringProp("GOOGLE_WEB_CLIENT_ID").escapeForBuildConfig()}\""
            )
            buildConfigField(
                "String",
                "STRIPE_PUBLISHABLE_KEY",
                "\"${localProps.stringProp("STRIPE_PUBLISHABLE_KEY").escapeForBuildConfig()}\""
            )
            buildConfigField(
                "String",
                "MARKETING_SITE_BASE_URL",
                "\"${localProps.stringProp("MARKETING_SITE_BASE_URL").ifEmpty { "https://www.play-spotter.com" }.escapeForBuildConfig()}\"",
            )
            manifestPlaceholders["GOOGLE_MAPS_API_KEY"] =
                localProps.stringProp("GOOGLE_MAPS_API_KEY")
            buildConfigField(
                "boolean",
                "HAS_GOOGLE_MAPS_API_KEY",
                if (localProps.stringProp("GOOGLE_MAPS_API_KEY").isNotBlank()) "true" else "false",
            )
        }
        release {
            isMinifyEnabled = true
            manifestPlaceholders["usesCleartextTraffic"] = "false"
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            buildConfigField(
                "String",
                "SERVER_BASE_URL",
                "\"${localProps.stringProp("SERVER_BASE_URL").ifEmpty { "https://api.play-spotter.com" }.escapeForBuildConfig()}\""
            )
            buildConfigField(
                "String",
                "GOOGLE_WEB_CLIENT_ID",
                "\"${localProps.stringProp("GOOGLE_WEB_CLIENT_ID").escapeForBuildConfig()}\""
            )
            buildConfigField(
                "String",
                "STRIPE_PUBLISHABLE_KEY",
                "\"${localProps.stringProp("STRIPE_PUBLISHABLE_KEY").escapeForBuildConfig()}\""
            )
            buildConfigField(
                "String",
                "MARKETING_SITE_BASE_URL",
                "\"${localProps.stringProp("MARKETING_SITE_BASE_URL").ifEmpty { "https://www.play-spotter.com" }.escapeForBuildConfig()}\"",
            )
            manifestPlaceholders["GOOGLE_MAPS_API_KEY"] =
                localProps.stringProp("GOOGLE_MAPS_API_KEY")
            buildConfigField(
                "boolean",
                "HAS_GOOGLE_MAPS_API_KEY",
                if (localProps.stringProp("GOOGLE_MAPS_API_KEY").isNotBlank()) "true" else "false",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
}

// Firebase must be declared outside the KMP sourceSets block to use platform() with version catalog.
dependencies {
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.auth)
    debugImplementation(compose.uiTooling)
}
