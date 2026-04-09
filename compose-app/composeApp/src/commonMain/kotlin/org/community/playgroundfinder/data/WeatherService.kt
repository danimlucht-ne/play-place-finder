package org.community.playgroundfinder.data

import io.ktor.client.*
import io.ktor.client.call.*
import io.ktor.client.plugins.contentnegotiation.*
import io.ktor.client.request.*
import io.ktor.serialization.kotlinx.json.*
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import org.community.playgroundfinder.AppConfig

@Serializable
data class WeatherInfo(
    val condition: String = "",
    val tempF: Double = 0.0,
    val iconUrl: String? = null,
)

@Serializable
data class WeatherEnvelope(
    val message: String = "",
    val data: WeatherInfo = WeatherInfo()
)

class WeatherService(
    private val client: HttpClient = HttpClient {
        install(ContentNegotiation) {
            json(Json { ignoreUnknownKeys = true })
        }
    }
) {

    suspend fun getWeather(lat: Double, lng: Double): WeatherInfo? {
        return try {
            client.get("${AppConfig.serverBaseUrl}/api/weather") {
                parameter("lat", lat)
                parameter("lng", lng)
            }.body<WeatherEnvelope>().data
        } catch (_: Exception) {
            null
        }
    }
}
