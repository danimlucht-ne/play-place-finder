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

/** Full calendar line for ad cards (high contrast body text), e.g. "Wednesday, Apr 16, 2026". */
fun formatEventDateReadableLine(eventDate: String?, isRecurring: Boolean): String? {
    if (eventDate == null) return null
    val date = try {
        LocalDate.parse(eventDate.take(10))
    } catch (_: Exception) {
        return null
    }
    if (isRecurring) return "Every ${date.dayOfWeek.toEnglishFull()}"
    val dow = date.dayOfWeek.toEnglishFull()
    val monthName = date.month.toEnglishShort()
    return "$dow, $monthName ${date.dayOfMonth}, ${date.year}"
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

/**
 * Strips event metadata from the stored [body] when the UI already shows **When** / **Where** lines
 * and structured event fields, so the paragraph is not a duplicate of those rows (mirrors
 * [FeaturedAdCard] and listing split cards).
 */
fun eventBodyTextForDisplay(
    body: String,
    isEvent: Boolean,
    eventName: String? = null,
    eventDate: String? = null,
    eventTime: String? = null,
    eventLocation: String? = null,
): String {
    if (!isEvent) return body.trim()
    var t = body.trim()
    if (t.isEmpty()) return t
    t = t.split("\n").map { it.trim() }.filter { line ->
        !line.matches(Regex("(?i)Date:\\s*.+")) &&
            !line.matches(Regex("(?i)Time:\\s*.+")) &&
            !line.matches(Regex("(?i)Location:\\s*.+"))
    }.joinToString("\n").trim()
    t = t.replace(Regex("(?i)\\bDate:\\s*[^.!\\n]+[.!?]?\\s*"), " ")
    t = t.replace(Regex("(?i)\\bTime:\\s*[^.!\\n]+[.!?]?\\s*"), " ")
    t = t.replace(Regex("(?i)\\bLocation:\\s*[^.!\\n]+[.!?]?\\s*"), " ")
    val en = eventName?.trim()
    if (!en.isNullOrEmpty() && en.length >= 2) {
        t = t.replace(Regex("(?i)Join us for\\s*" + Regex.escape(en) + "\\s*[.!?]?\\s*"), " ")
    }
    val ymd = eventDate?.trim()?.take(10)
    if (!ymd.isNullOrEmpty() && ymd.length >= 8) {
        t = t.replace(Regex("\\b" + Regex.escape(ymd) + "\\b"), " ")
    }
    val time = eventTime?.trim()
    if (!time.isNullOrEmpty() && time.length >= 3) {
        t = t.replace(time, " ")
    }
    val loc = eventLocation?.trim()
    if (!loc.isNullOrEmpty() && loc.length >= 3) {
        t = t.replace(loc, " ")
    }
    return t
        .replace(Regex("\\s+"), " ")
        .replace(Regex("\\s+\\."), ".")
        .trim()
        .trim('.')
        .trim()
}
