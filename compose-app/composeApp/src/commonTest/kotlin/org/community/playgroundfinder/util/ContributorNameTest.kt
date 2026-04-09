package org.community.playgroundfinder.util

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ContributorNameTest {

    @Test
    fun `accepts first name plus last initial`() {
        assertTrue(isValidContributorNameFormat("Jamie T"))
        assertTrue(isValidContributorNameFormat("Jamie T."))
        assertTrue(isValidContributorNameFormat("Anne-Marie J"))
        assertTrue(isValidContributorNameFormat("O'Connor P."))
    }

    @Test
    fun `rejects blank or malformed names`() {
        assertFalse(isValidContributorNameFormat(""))
        assertFalse(isValidContributorNameFormat("Jamie"))
        assertFalse(isValidContributorNameFormat("J T"))
        assertFalse(isValidContributorNameFormat("Jamie Thomas"))
        assertFalse(isValidContributorNameFormat("Jamie 12"))
    }
}

