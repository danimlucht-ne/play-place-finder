package org.community.playgroundfinder.ui.composables

import kotlinx.datetime.Clock
import kotlinx.datetime.DayOfWeek
import kotlinx.datetime.LocalDate
import kotlinx.datetime.Month
import kotlinx.datetime.TimeZone
import kotlinx.datetime.daysUntil
import kotlinx.datetime.todayIn

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

private fun todayLocal(): LocalDate =
    Clock.System.todayIn(TimeZone.currentSystemDefault())

/** Formats an event date for display in ad cards. */
fun formatEventDateDisplay(eventDate: String?, isRecurring: Boolean): String? {
    if (eventDate == null) return null
    val date = try {
        LocalDate.parse(eventDate.take(10))
    } catch (_: Exception) {
        return null
    }
    val today = todayLocal()
    val dayName = date.dayOfWeek.toEnglishFull()
    val monthName = date.month.toEnglishShort()
    val dayOfMonth = date.dayOfMonth
    if (isRecurring) return "Every $dayName"
    val daysUntil = today.daysUntil(date)
    return when {
        daysUntil == 0 -> "Today"
        daysUntil == 1 -> "Tomorrow"
        daysUntil in 2..6 -> "This $dayName, $monthName $dayOfMonth"
        else -> "$monthName $dayOfMonth"
    }
}

/** Returns countdown text when event is within 3 days, null otherwise. */
fun getEventCountdown(eventDate: String?): String? {
    if (eventDate == null) return null
    val date = try {
        LocalDate.parse(eventDate.take(10))
    } catch (_: Exception) {
        return null
    }
    val daysUntil = todayLocal().daysUntil(date)
    return when {
        daysUntil == 0 -> "Today!"
        daysUntil == 1 -> "Tomorrow!"
        daysUntil in 2..3 -> "In $daysUntil days!"
        else -> null
    }
}
