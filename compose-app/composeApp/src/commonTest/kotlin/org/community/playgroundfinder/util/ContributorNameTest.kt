package org.community.playgroundfinder.util

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ContributorNameTest {

    @Test
    fun `accepts single word and multi word names`() {
        assertTrue(isValidContributorNameFormat("Jamie"))
        assertTrue(isValidContributorNameFormat("Jamie Thomas"))
        assertTrue(isValidContributorNameFormat("Jamie T"))
        assertTrue(isValidContributorNameFormat("Mary Jane Watson"))
    }

    @Test
    fun `normalizes surrounding and repeated spaces`() {
        assertEquals("Jamie Smith", normalizeContributorDisplayName("  Jamie   Smith  "))
        assertTrue(isValidContributorNameFormat("  Jamie   Smith  "))
    }

    @Test
    fun `rejects blank too short too long digits punctuation`() {
        assertFalse(isValidContributorNameFormat(""))
        assertFalse(isValidContributorNameFormat("J"))
        assertFalse(isValidContributorNameFormat("Jamie 12"))
        assertFalse(isValidContributorNameFormat("Jamie-T"))
        assertFalse(isValidContributorNameFormat("O'Connor"))
        assertFalse(isValidContributorNameFormat("Jamie_"))
    }

    @Test
    fun `rejects over 30 letters after normalize`() {
        val thirtyOne = "a".repeat(31)
        assertFalse(isValidContributorNameFormat(thirtyOne))
        assertTrue(isValidContributorNameFormat("a".repeat(30)))
    }
}
