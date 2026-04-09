package org.community.playgroundfinder.util

private val firstNamePattern = Regex("^[A-Za-z][A-Za-z'\\-]*\$")
private val lastInitialPattern = Regex("^[A-Za-z]\\.?\$")

/** Expected format: first name + last initial (e.g. "Jamie T." or "Jamie T"). */
fun isValidContributorNameFormat(value: String): Boolean {
    val parts = value.trim().split(Regex("\\s+"))
    if (parts.size != 2) return false

    val firstName = parts[0]
    val lastInitial = parts[1]
    val letterCount = firstName.count { it.isLetter() }

    return letterCount >= 2 &&
        firstNamePattern.matches(firstName) &&
        lastInitialPattern.matches(lastInitial)
}

