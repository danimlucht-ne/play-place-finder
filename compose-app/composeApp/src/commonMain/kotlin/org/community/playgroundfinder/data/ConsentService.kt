package org.community.playgroundfinder.data

import io.ktor.client.*
import io.ktor.client.call.*
import io.ktor.client.plugins.*
import io.ktor.client.plugins.contentnegotiation.*
import io.ktor.client.request.*
import io.ktor.http.*
import io.ktor.serialization.kotlinx.json.*
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import org.community.playgroundfinder.AppConfig

@Serializable
data class ConsentRequirementsResponse(
    val message: String = "",
    val data: ConsentData = ConsentData()
)

@Serializable
data class ConsentData(
    @SerialName("adult_terms") val adultTerms: ConsentDetail = ConsentDetail(),
    @SerialName("location_services") val locationServices: ConsentDetail = ConsentDetail()
)

@Serializable
data class ConsentDetail(
    val required: Boolean = false,
    val accepted: Boolean? = null,
    val consentVersion: Int? = null,
    val requiredVersion: Int = 1
)

class ConsentService(
    private val tokenProvider: suspend () -> String?,
    private val client: HttpClient = HttpClient {
        install(ContentNegotiation) {
            json(Json { ignoreUnknownKeys = true })
        }
        install(HttpTimeout) { requestTimeoutMillis = 15000 }
        defaultRequest {
            url("${AppConfig.serverBaseUrl}/api/")
        }
    }
) {

    suspend fun getConsentRequirements(): ConsentRequirementsResponse {
        return client.get("consents/required") {
            val token = tokenProvider()
            if (!token.isNullOrEmpty()) header(HttpHeaders.Authorization, "Bearer $token")
        }.body()
    }
}
