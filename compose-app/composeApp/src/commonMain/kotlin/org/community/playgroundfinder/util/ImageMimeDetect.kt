package org.community.playgroundfinder.util

/**
 * Detects image type from magic bytes so multipart Content-Type matches file contents
 * (screenshots are often PNG/WebP; the server rejects a declared `image/jpeg` mismatch).
 */
fun detectImageContentTypeAndExtension(imageData: ByteArray): Pair<String, String> {
    if (imageData.size >= 3 &&
        imageData[0] == 0xFF.toByte() &&
        imageData[1] == 0xD8.toByte() &&
        imageData[2] == 0xFF.toByte()
    ) {
        return "image/jpeg" to "jpg"
    }
    if (imageData.size >= 8 &&
        imageData[0] == 0x89.toByte() &&
        imageData[1] == 0x50.toByte() &&
        imageData[2] == 0x4E.toByte() &&
        imageData[3] == 0x47.toByte()
    ) {
        return "image/png" to "png"
    }
    if (imageData.size >= 6 &&
        imageData[0] == 0x47.toByte() &&
        imageData[1] == 0x49.toByte() &&
        imageData[2] == 0x46.toByte() &&
        imageData[3] == 0x38.toByte() &&
        (imageData[4] == 0x37.toByte() || imageData[4] == 0x39.toByte()) &&
        imageData[5] == 0x61.toByte()
    ) {
        return "image/gif" to "gif"
    }
    if (imageData.size >= 12 &&
        imageData[0] == 0x52.toByte() &&
        imageData[1] == 0x49.toByte() &&
        imageData[2] == 0x46.toByte() &&
        imageData[3] == 0x46.toByte() &&
        imageData[8] == 0x57.toByte() &&
        imageData[9] == 0x45.toByte() &&
        imageData[10] == 0x42.toByte() &&
        imageData[11] == 0x50.toByte()
    ) {
        return "image/webp" to "webp"
    }
    return "image/jpeg" to "jpg"
}
