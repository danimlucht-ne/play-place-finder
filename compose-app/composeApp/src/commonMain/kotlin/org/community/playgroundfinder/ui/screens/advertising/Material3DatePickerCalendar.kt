package org.community.playgroundfinder.ui.screens.advertising

import kotlinx.datetime.Instant
import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone
import kotlinx.datetime.atStartOfDayIn
import kotlinx.datetime.toLocalDateTime

/**
 * Material3 [androidx.compose.material3.DatePicker] stores [androidx.compose.material3.DatePickerState.selectedDateMillis]
 * as start-of-day UTC for the chosen Gregorian calendar date (not the device zone’s midnight).
 *
 * Always convert with UTC calendar parts for [initialSelectedDateMillis] and when reading the selection.
 */
internal fun datePickerUtcMillisToLocalDate(ms: Long): LocalDate {
    val utc = Instant.fromEpochMilliseconds(ms).toLocalDateTime(TimeZone.UTC)
    return LocalDate(utc.year, utc.monthNumber, utc.dayOfMonth)
}

internal fun localDateToDatePickerUtcMillis(d: LocalDate): Long =
    d.atStartOfDayIn(TimeZone.UTC).toEpochMilliseconds()
