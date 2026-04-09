package org.community.playgroundfinder.data

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.HttpRequestData
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import org.community.playgroundfinder.data.PlaygroundSaveOutcome
import org.community.playgroundfinder.events.paidEventCreativesSortedForCalendar
import org.community.playgroundfinder.models.AllAdsResponse
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.assertFailsWith

class PlaygroundServiceTest {

    private fun jsonClient(
        responseStatus: HttpStatusCode = HttpStatusCode.OK,
        responseBody: String,
        handler: suspend (HttpRequestData) -> Unit = {}
    ): HttpClient {
        val engine = MockEngine { request ->
            handler(request)
            respond(
                content = responseBody,
                status = responseStatus,
                headers = io.ktor.http.headersOf(HttpHeaders.ContentType, ContentType.Application.Json.toString())
            )
        }
        return HttpClient(engine) {
            install(ContentNegotiation) {
                json(Json {
                    ignoreUnknownKeys = true
                    coerceInputValues = true
                    isLenient = true
                })
            }
        }
    }

    @Test
    fun `searchPlaygrounds sets expected query params and auth header`() = runBlocking {
        var seenAuth: String? = null
        var seenPath: String? = null
        var seenEquipment: String? = null
        var seenHasShade: String? = null

        val service = PlaygroundService(
            tokenProvider = { "abc123" },
            client = jsonClient(
                responseBody = """{"message":"ok","data":[{"name":"Test Park","latitude":1.0,"longitude":2.0}]}"""
            ) { request ->
                seenAuth = request.headers[HttpHeaders.Authorization]
                seenPath = request.url.encodedPath
                seenEquipment = request.url.parameters["equipment"]
                seenHasShade = request.url.parameters["hasShade"]
                assertEquals(HttpMethod.Get, request.method)
            }
        )

        val result = service.searchPlaygrounds(
            lat = 1.1,
            lng = 2.2,
            equipment = listOf("Slides", "Swings"),
            hasShade = true
        )

        assertEquals("Bearer abc123", seenAuth)
        assertEquals("/playgrounds/search", seenPath)
        assertEquals("Slides,Swings", seenEquipment)
        assertEquals("true", seenHasShade)
        assertEquals(1, result.size)
    }

    @Test
    fun `createPlaygroundOrDuplicate returns Duplicate on conflict`() = runBlocking {
        val service = PlaygroundService(
            client = jsonClient(
                responseStatus = HttpStatusCode.Conflict,
                responseBody = """{"message":"duplicate"}"""
            )
        )

        val result = service.createPlaygroundOrDuplicate(Playground(name = "Dup Park", latitude = 1.0, longitude = 2.0))
        assertEquals(PlaygroundSaveOutcome.Duplicate, result)
    }

    @Test
    fun `createPlaygroundOrDuplicate returns PendingReview on accepted`() = runBlocking {
        val service = PlaygroundService(
            client = jsonClient(
                responseStatus = HttpStatusCode.Accepted,
                responseBody = """{"message":"queued","pendingReview":true,"queueId":"q_123"}"""
            )
        )

        val result = service.createPlaygroundOrDuplicate(Playground(name = "Review Park", latitude = 1.0, longitude = 2.0))
        assertTrue(result is PlaygroundSaveOutcome.PendingReview)
        result as PlaygroundSaveOutcome.PendingReview
        assertEquals("queued", result.message)
        assertEquals("q_123", result.queueId)
    }

    @Test
    fun `createPlaygroundOrDuplicate returns Saved on success`() = runBlocking {
        val service = PlaygroundService(
            client = jsonClient(
                responseStatus = HttpStatusCode.OK,
                responseBody = """{"message":"ok","data":{"name":"Saved Park","latitude":1.0,"longitude":2.0}}"""
            )
        )

        val result = service.createPlaygroundOrDuplicate(Playground(name = "Saved Park", latitude = 1.0, longitude = 2.0))
        assertTrue(result is PlaygroundSaveOutcome.Saved)
        result as PlaygroundSaveOutcome.Saved
        assertEquals("Saved Park", result.playground.name)
    }

    @Test
    fun `createPlaygroundOrDuplicate throws with server response for non-success statuses`() = runBlocking {
        val service = PlaygroundService(
            client = jsonClient(
                responseStatus = HttpStatusCode.InternalServerError,
                responseBody = """{"message":"boom"}"""
            )
        )

        val ex = assertFailsWith<IllegalStateException> {
            service.createPlaygroundOrDuplicate(Playground(name = "Fail Park", latitude = 1.0, longitude = 2.0))
        }

        assertTrue(ex.message?.contains("Create failed") == true)
        assertTrue(ex.message?.contains("500") == true)
    }

    @Test
    fun `reportIssue sends auth and succeeds on success status`() = runBlocking {
        var seenAuth: String? = null
        var seenPath: String? = null

        val service = PlaygroundService(
            tokenProvider = { "token-issue" },
            client = jsonClient(
                responseStatus = HttpStatusCode.OK,
                responseBody = """{"message":"ok"}"""
            ) { request ->
                seenAuth = request.headers[HttpHeaders.Authorization]
                seenPath = request.url.encodedPath
                assertEquals(HttpMethod.Post, request.method)
            }
        )

        service.reportIssue(placeId = "p1", type = "unsafe_equipment", description = "broken slide", userId = "u1")

        assertEquals("Bearer token-issue", seenAuth)
        assertEquals("/reports/issue", seenPath)
    }

    @Test
    fun `reportIssue throws on non-success response`() = runBlocking {
        val service = PlaygroundService(
            client = jsonClient(
                responseStatus = HttpStatusCode.BadRequest,
                responseBody = """{"message":"invalid report"}"""
            )
        )

        val ex = assertFailsWith<IllegalStateException> {
            service.reportIssue(placeId = "p1", type = "unsafe_equipment", description = "broken slide", userId = "u1")
        }

        assertTrue(ex.message?.contains("Report failed") == true)
        assertTrue(ex.message?.contains("400") == true)
    }

    @Test
    fun `submitSupportTicket returns success map on success status`() = runBlocking {
        var seenPath: String? = null
        var seenAuth: String? = null

        val service = PlaygroundService(
            tokenProvider = { "token-support" },
            client = jsonClient(
                responseStatus = HttpStatusCode.OK,
                responseBody = """{"message":"submitted"}"""
            ) { request ->
                seenPath = request.url.encodedPath
                seenAuth = request.headers[HttpHeaders.Authorization]
                assertEquals(HttpMethod.Post, request.method)
            }
        )

        val result = service.submitSupportTicket(
            ticketType = "general",
            message = "Need help",
            category = "billing",
            targetKind = "campaign",
            targetId = "c1",
            screenshotUrl = "https://example.com/s.png"
        )

        assertEquals("/support/tickets", seenPath)
        assertEquals("Bearer token-support", seenAuth)
        assertEquals("success", result["message"])
    }

    @Test
    fun `submitSupportTicket throws on non-success response`() = runBlocking {
        val service = PlaygroundService(
            client = jsonClient(
                responseStatus = HttpStatusCode.InternalServerError,
                responseBody = """{"message":"server error"}"""
            )
        )

        val ex = assertFailsWith<IllegalStateException> {
            service.submitSupportTicket(ticketType = "general", message = "Need help")
        }

        assertTrue(ex.message?.contains("Support ticket failed") == true)
        assertTrue(ex.message?.contains("500") == true)
    }

    @Test
    fun `getInlineAds returns list when ad payload is present`() = runBlocking {
        val service = PlaygroundService(
            client = jsonClient(
                responseBody = """
                    {
                      "message":"ok",
                      "data":{
                        "ad":{"id":"ad1","headline":"Sale","body":"Body","ctaText":"Tap","ctaUrl":"https://example.com","businessName":"Biz","businessCategory":"Food","placement":"inline_listing"},
                        "type":"sponsored"
                      }
                    }
                """.trimIndent()
            )
        )

        val ads = service.getInlineAds(cityId = "city-1", resultCount = 20)
        assertEquals(1, ads.size)
        assertEquals("ad1", ads.first().ad?.id)
    }

    @Test
    fun `getInlineAds returns empty when response ad is null`() = runBlocking {
        val service = PlaygroundService(
            client = jsonClient(
                responseBody = """{"message":"ok","data":{"ad":null,"type":"sponsored"}}"""
            )
        )

        val ads = service.getInlineAds(cityId = "city-1", resultCount = 20)
        assertTrue(ads.isEmpty())
    }

    @Test
    fun `getInlineAds returns empty on request exception`() = runBlocking {
        val failingClient = HttpClient(MockEngine { throw RuntimeException("network failure") }) {
            install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true }) }
        }

        val service = PlaygroundService(client = failingClient)
        val ads = service.getInlineAds(cityId = "city-1", resultCount = 20)
        assertTrue(ads.isEmpty())
    }

    @Test
    fun `getAllAds requests ads all with city_id and placement`() = runBlocking {
        var seenPath: String? = null
        var seenCity: String? = null
        var seenPlacement: String? = null
        val body = """
            {
              "message":"ok",
              "data":{
                "ads":[
                  {"id":"e1","headline":"H","isEvent":true,"eventDate":"2026-03-01","eventName":"Story time"}
                ],
                "type":"paid",
                "cityPhase":"growing"
              }
            }
        """.trimIndent()
        val service = PlaygroundService(
            client = jsonClient(responseBody = body) { request ->
                seenPath = request.url.encodedPath
                seenCity = request.url.parameters["city_id"]
                seenPlacement = request.url.parameters["placement"]
                assertEquals(HttpMethod.Get, request.method)
            },
        )

        val result = service.getAllAds("austin-tx", "inline_listing")

        assertTrue(seenPath!!.endsWith("ads/all"), "path was $seenPath")
        assertEquals("austin-tx", seenCity)
        assertEquals("inline_listing", seenPlacement)
        assertEquals("paid", result.type)
        assertEquals("growing", result.cityPhase)
        assertEquals(1, result.ads.size)
        assertEquals("e1", result.ads.first().id)
        val calendarRows = paidEventCreativesSortedForCalendar(result)
        assertEquals(1, calendarRows.size)
        assertEquals("Story time", calendarRows.first().eventName)
    }

    @Test
    fun `getAllAds returns empty envelope on decode or network failure`() = runBlocking {
        val failingClient = HttpClient(MockEngine { throw RuntimeException("network failure") }) {
            install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true }) }
        }
        val service = PlaygroundService(client = failingClient)
        val result = service.getAllAds("any", "inline_listing")
        assertEquals(AllAdsResponse(), result)
    }

    @Test
    fun `getDailyAdViews returns zero for json payload not decoded as numeric map`() = runBlocking {
        val service = PlaygroundService(
            client = jsonClient(
                responseBody = """{"data":{"todayViews":42}}"""
            )
        )

        assertEquals(0, service.getDailyAdViews("city-1"))
    }

    @Test
    fun `getDailyAdViews returns zero when response shape is missing today views`() = runBlocking {
        val service = PlaygroundService(
            client = jsonClient(
                responseBody = """{"data":{"unexpected":1}}"""
            )
        )

        assertEquals(0, service.getDailyAdViews("city-1"))
    }

    @Test
    fun `getDailyAdViews returns zero on exception`() = runBlocking {
        val failingClient = HttpClient(MockEngine { throw RuntimeException("network failure") }) {
            install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true }) }
        }

        val service = PlaygroundService(client = failingClient)
        assertEquals(0, service.getDailyAdViews("city-1"))
    }
}
