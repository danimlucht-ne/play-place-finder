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

class ConsentServiceTest {

    private fun testClient(handler: suspend (HttpRequestData) -> Unit): HttpClient {
        val engine = MockEngine { request ->
            handler(request)
            respond(
                content = """{"message":"ok","data":{"adult_terms":{"required":true},"location_services":{"required":false}}}""",
                status = HttpStatusCode.OK,
                headers = io.ktor.http.headersOf(HttpHeaders.ContentType, ContentType.Application.Json.toString())
            )
        }
        return HttpClient(engine) {
            install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true }) }
        }
    }

    @Test
    fun `getConsentRequirements sends auth header when token exists`() = runBlocking {
        var authHeader: String? = null

        val service = ConsentService(
            tokenProvider = { "token-123" },
            client = testClient { request ->
                authHeader = request.headers[HttpHeaders.Authorization]
                assertEquals("/consents/required", request.url.encodedPath)
            }
        )

        val result = service.getConsentRequirements()

        assertEquals("Bearer token-123", authHeader)
        assertEquals(true, result.data.adultTerms.required)
    }

    @Test
    fun `getConsentRequirements omits auth header when token missing`() = runBlocking {
        var authHeader: String? = "present"

        val service = ConsentService(
            tokenProvider = { null },
            client = testClient { request ->
                authHeader = request.headers[HttpHeaders.Authorization]
            }
        )

        service.getConsentRequirements()

        assertNull(authHeader)
    }
}
