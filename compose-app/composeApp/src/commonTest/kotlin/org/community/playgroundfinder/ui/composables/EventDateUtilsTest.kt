package org.community.playgroundfinder.ui.composables

import kotlinx.datetime.Clock
import kotlinx.datetime.DatePeriod
import kotlinx.datetime.DayOfWeek
import kotlinx.datetime.LocalDate
import kotlinx.datetime.Month
import kotlinx.datetime.TimeZone
import kotlinx.datetime.plus
import kotlinx.datetime.todayIn
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class EventDateUtilsTest {

    private fun today(): LocalDate = Clock.System.todayIn(TimeZone.currentSystemDefault())

    private fun DayOfWeek.toEnglishFull(): String = when (this) {
        DayOfWeek.MONDAY -> "Monday"
        DayOfWeek.TUESDAY -> "Tuesday"
        DayOfWeek.WEDNESDAY -> "Wednesday"
        DayOfWeek.THURSDAY -> "Thursday"
        DayOfWeek.FRIDAY -> "Friday"
        DayOfWeek.SATURDAY -> "Saturday"
        DayOfWeek.SUNDAY -> "Sunday"
    }

    private fun Month.toEnglishShort(): String = when (this) {
        Month.JANUARY -> "Jan"
        Month.FEBRUARY -> "Feb"
        Month.MARCH -> "Mar"
        Month.APRIL -> "Apr"
        Month.MAY -> "May"
        Month.JUNE -> "Jun"
        Month.JULY -> "Jul"
        Month.AUGUST -> "Aug"
        Month.SEPTEMBER -> "Sep"
        Month.OCTOBER -> "Oct"
        Month.NOVEMBER -> "Nov"
        Month.DECEMBER -> "Dec"
    }

    @Test
    fun `formatEventDateDisplay returns null for null date`() {
        assertNull(formatEventDateDisplay(eventDate = null, isRecurring = false))
    }

    @Test
    fun `formatEventDateDisplay returns null for invalid date`() {
        assertNull(formatEventDateDisplay(eventDate = "not-a-date", isRecurring = false))
    }

    @Test
    fun `formatEventDateDisplay supports full ISO datetime by trimming first 10 chars`() {
        val today = today().toString()
        val withTime = "${today}T17:45:00Z"

        assertEquals("Today", formatEventDateDisplay(eventDate = withTime, isRecurring = false))
    }

    @Test
    fun `formatEventDateDisplay returns recurring text regardless of date distance`() {
        val eventDate = today().plus(DatePeriod(days = 25))
        val dayName = eventDate.dayOfWeek.toEnglishFull()

        assertEquals(
            expected = "Every $dayName",
            actual = formatEventDateDisplay(eventDate = eventDate.toString(), isRecurring = true),
        )
    }

    @Test
    fun `formatEventDateDisplay returns Today for same day`() {
        val today = today().toString()
        assertEquals("Today", formatEventDateDisplay(eventDate = today, isRecurring = false))
    }

    @Test
    fun `formatEventDateDisplay returns Tomorrow for next day`() {
        val tomorrow = today().plus(DatePeriod(days = 1)).toString()
        assertEquals("Tomorrow", formatEventDateDisplay(eventDate = tomorrow, isRecurring = false))
    }

    @Test
    fun `formatEventDateDisplay returns This day for dates within a week`() {
        val inThreeDays = today().plus(DatePeriod(days = 3))
        val result = formatEventDateDisplay(eventDate = inThreeDays.toString(), isRecurring = false)

        val dayName = inThreeDays.dayOfWeek.toEnglishFull()
        val monthName = inThreeDays.month.toEnglishShort()
        assertEquals("This $dayName, $monthName ${inThreeDays.dayOfMonth}", result)
    }

    @Test
    fun `formatEventDateDisplay returns month and day for dates beyond 6 days`() {
        val inTenDays = today().plus(DatePeriod(days = 10))
        val result = formatEventDateDisplay(eventDate = inTenDays.toString(), isRecurring = false)

        val monthName = inTenDays.month.toEnglishShort()
        assertEquals("$monthName ${inTenDays.dayOfMonth}", result)
    }

    @Test
    fun `getEventCountdown returns null for null input`() {
        assertNull(getEventCountdown(null))
    }

    @Test
    fun `getEventCountdown returns null for invalid input`() {
        assertNull(getEventCountdown("2026-99-99"))
    }

    @Test
    fun `getEventCountdown returns Today for same day`() {
        assertEquals("Today!", getEventCountdown(today().toString()))
    }

    @Test
    fun `getEventCountdown returns Tomorrow for next day`() {
        assertEquals("Tomorrow!", getEventCountdown(today().plus(DatePeriod(days = 1)).toString()))
    }

    @Test
    fun `getEventCountdown returns In N days for 2 or 3 days`() {
        assertEquals("In 2 days!", getEventCountdown(today().plus(DatePeriod(days = 2)).toString()))
        assertEquals("In 3 days!", getEventCountdown(today().plus(DatePeriod(days = 3)).toString()))
    }

    @Test
    fun `getEventCountdown returns null for 4 or more days`() {
        assertNull(getEventCountdown(today().plus(DatePeriod(days = 4)).toString()))
    }

    @Test
    fun `getEventCountdown returns null for past dates`() {
        assertNull(getEventCountdown(today().plus(DatePeriod(days = -1)).toString()))
    }

    @Test
    fun `formatEventDateReadableLine returns full calendar line`() {
        assertEquals(
            "Thursday, Aug 20, 2026",
            formatEventDateReadableLine(eventDate = "2026-08-20", isRecurring = false),
        )
    }

    @Test
    fun `formatEventDateReadableLine recurring uses weekday`() {
        assertEquals(
            "Every Thursday",
            formatEventDateReadableLine(eventDate = "2026-08-20", isRecurring = true),
        )
    }

    @Test
    fun `formatEventDateReadableLine null for invalid`() {
        assertNull(formatEventDateReadableLine(eventDate = "not-a-date", isRecurring = false))
    }
}
