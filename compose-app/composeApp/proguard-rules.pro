# Keep Kotlinx Serialization
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt
-keepclassmembers class kotlinx.serialization.json.** { *** Companion; }
-keepclasseswithmembers class **$$serializer { *; }
-keep @kotlinx.serialization.Serializable class * { *; }

# Keep Ktor
-keep class io.ktor.** { *; }
-dontwarn io.ktor.**

# Keep Coil
-keep class coil3.** { *; }
-dontwarn coil3.**

# Google Maps / Maps Compose (release minify)
-keep class com.google.android.gms.maps.** { *; }
-keep class com.google.maps.android.** { *; }
-dontwarn com.google.android.gms.**

# Keep app data classes (used by Ktor deserialization)
-keep class org.community.playgroundfinder.data.** { *; }
-keep class org.community.playgroundfinder.models.** { *; }
