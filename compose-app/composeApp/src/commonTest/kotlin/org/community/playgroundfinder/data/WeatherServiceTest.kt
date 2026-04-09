package org.community.playgroundfinder.data

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.HttpRequestData
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class WeatherServiceTest {

    private fun successClient(handler: suspend (HttpRequestData) -> Unit): HttpClient {
        val engine = MockEngine { request ->
            handler(request)
            respond(
                content = """{"message":"ok","data":{"condition":"Sunny","tempF":75.5,"iconUrl":"icon.png"}}""",
                status = HttpStatusCode.OK,
                headers = io.ktor.http.headersOf(HttpHeaders.ContentType, ContentType.Application.Json.toString())
            )
        }
        return HttpClient(engine) {
            install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true }) }
        }
    }

    @Test
    fun `getWeather sends lat and lng query params and decodes response`() = runBlocking {
        var latParam: String? = null
        var lngParam: String? = null

        val service = WeatherService(
            client = successClient { request ->
                latParam = request.url.parameters["lat"]
                lngParam = request.url.parameters["lng"]
                assertEquals("/api/weather", request.url.encodedPath)
            }
        )

        val weather = service.getWeather(lat = 30.27, lng = -97.74)

        assertEquals("30.27", latParam)
        assertEquals("-97.74", lngParam)
        assertEquals("Sunny", weather?.condition)
        assertEquals(75.5, weather?.tempF)
    }

    @Test
    fun `getWeather returns null when request fails`() = runBlocking {
        val failingClient = HttpClient(MockEngine { throw IllegalStateException("network down") }) {
            install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true }) }
        }

        val service = WeatherService(client = failingClient)

        assertNull(service.getWeather(1.0, 2.0))
    }
}
