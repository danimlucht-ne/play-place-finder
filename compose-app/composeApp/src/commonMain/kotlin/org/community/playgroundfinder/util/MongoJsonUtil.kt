package org.community.playgroundfinder.util

/** Resolves Mongo extended JSON / API map shapes to a hex id string. */
fun Any?.mongoIdString(): String? {
    return when (this) {
        null -> null
        is String -> this.takeIf { it.isNotBlank() }
        is Map<*, *> -> {
            @Suppress("UNCHECKED_CAST")
            val m = this as Map<String, Any?>
            (m["\$oid"] as? String) ?: (m["oid"] as? String)
        }
        else -> toString().takeIf { it.isNotBlank() }
    }
}
