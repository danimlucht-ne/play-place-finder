package org.community.playgroundfinder.models

import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ModelEnvelopeDecodingTest {

    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `HybridSearchResponse defaults to empty list for malformed places`() {
        val decoded = json.decodeFromString<HybridSearchResponse>(
            """
            {
              "message": "ok",
              "seeded": true,
              "regionKey": "austin_tx",
              "places": {"unexpected":"payload"}
            }
            """.trimIndent()
        )

        assertTrue(decoded.places.isEmpty())
        assertEquals(true, decoded.seeded)
        assertEquals("austin_tx", decoded.regionKey)
    }

    @Test
    fun `ListDetailResponse decodes places when wrapped as places array`() {
        val decoded = json.decodeFromString<ListDetailResponse>(
            """
            {
              "message": "ok",
              "data": {
                "id": "list-1",
                "name": "Weekend picks",
                "places": {
                  "places": [
                    {"name":"Pocket Park","latitude":40.0,"longitude":-74.0}
                  ]
                }
              }
            }
            """.trimIndent()
        )

        assertEquals("list-1", decoded.data.id)
        assertEquals(1, decoded.data.places.size)
        assertEquals("Pocket Park", decoded.data.places.first().name)
    }

    @Test
    fun `RegionSearchResult decodes even when places is null`() {
        val decoded = json.decodeFromString<RegionSearchResult>(
            """
            {
              "regionKey":"phoenix_az",
              "city":"Phoenix",
              "state":"AZ",
              "seeded":false,
              "seedingTriggered":true,
              "places":null
            }
            """.trimIndent()
        )

        assertEquals("phoenix_az", decoded.regionKey)
        assertTrue(decoded.places.isEmpty())
        assertEquals(true, decoded.seedingTriggered)
    }
}
