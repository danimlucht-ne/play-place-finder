package org.community.playgroundfinder.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SafeSerializersTest {

    private val json = Json { ignoreUnknownKeys = true }

    @Serializable
    private data class PlaygroundListEnvelope(
        @Serializable(with = SafePlaygroundListSerializer::class)
        val data: List<Playground> = emptyList()
    )

    @Serializable
    private data class SafeStringEnvelope(
        @Serializable(with = SafeStringSerializer::class)
        val value: String? = null
    )

    @Test
    fun `SafePlaygroundListSerializer decodes a valid array`() {
        val decoded = json.decodeFromString<PlaygroundListEnvelope>(
            """{"data":[{"name":"Sunny Park","latitude":1.0,"longitude":2.0}]}"""
        )

        assertEquals(1, decoded.data.size)
        assertEquals("Sunny Park", decoded.data.first().name)
    }

    @Test
    fun `SafePlaygroundListSerializer returns empty list when data is null`() {
        val decoded = json.decodeFromString<PlaygroundListEnvelope>(
            """{"data":null}"""
        )

        assertTrue(decoded.data.isEmpty())
    }

    @Test
    fun `SafePlaygroundListSerializer supports wrapped places field`() {
        val decoded = json.decodeFromString<PlaygroundListEnvelope>(
            """{"data":{"places":[{"name":"Wrapped Park","latitude":3.0,"longitude":4.0}]}}"""
        )

        assertEquals(1, decoded.data.size)
        assertEquals("Wrapped Park", decoded.data.first().name)
    }

    @Test
    fun `SafePlaygroundListSerializer returns empty list for object without places`() {
        val decoded = json.decodeFromString<PlaygroundListEnvelope>(
            """{"data":{"unexpected":"shape"}}"""
        )

        assertTrue(decoded.data.isEmpty())
    }

    @Test
    fun `SafePlaygroundListSerializer returns empty list for primitive`() {
        val decoded = json.decodeFromString<PlaygroundListEnvelope>(
            """{"data":"bad-payload"}"""
        )

        assertTrue(decoded.data.isEmpty())
    }

    @Test
    fun `SafeStringSerializer decodes plain string`() {
        val decoded = json.decodeFromString<SafeStringEnvelope>(
            """{"value":"top_contributor"}"""
        )

        assertEquals("top_contributor", decoded.value)
    }

    @Test
    fun `SafeStringSerializer decodes numeric primitive as string content`() {
        val decoded = json.decodeFromString<SafeStringEnvelope>(
            """{"value":123}"""
        )

        assertEquals("123", decoded.value)
    }

    @Test
    fun `SafeStringSerializer returns null for null json value`() {
        val decoded = json.decodeFromString<SafeStringEnvelope>(
            """{"value":null}"""
        )

        assertNull(decoded.value)
    }

    @Test
    fun `SafeStringSerializer returns null for object payload`() {
        val decoded = json.decodeFromString<SafeStringEnvelope>(
            """{"value":{"corrupted":"data"}}"""
        )

        assertNull(decoded.value)
    }
}
