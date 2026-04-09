package org.community.playgroundfinder.util

private val letterWordsPattern = Regex("^[\\p{L}]+(?: [\\p{L}]+)*$")

/** Collapses internal whitespace and trims ends (use before save / strict checks). */
fun normalizeContributorDisplayName(value: String): String =
    value.trim().replace(Regex("\\s+"), " ")

/**
 * Public contributor display name: 2–30 characters after normalization, Unicode letters only,
 * one or more words separated by single spaces. No digits or punctuation.
 */
fun isValidContributorNameFormat(value: String): Boolean {
    val name = normalizeContributorDisplayName(value)
    if (name.length !in 2..30) return false
    return letterWordsPattern.matches(name)
}

fun contributorDisplayNameValidationMessage(): String =
    "Use 2–30 characters, letters only. Spaces between words are OK. No numbers or punctuation."

/** How the account appears on the contributor leaderboard when not posting anonymously. */
fun contributorPublicLabel(displayName: String?): String {
    val n = normalizeContributorDisplayName(displayName ?: "")
    return if (n.isEmpty()) "Anonymous" else n
}

/** One-line UI hint, e.g. `Verifying as Jamie` or `Submitting update as Anonymous`. */
fun contributorAttributionLine(verbPhrase: String, publicLabel: String): String =
    "$verbPhrase as $publicLabel"
