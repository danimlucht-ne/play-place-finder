package org.community.playgroundfinder

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.core.content.FileProvider
import com.yalantis.ucrop.UCrop
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream

/** Pick → UCrop → JPEG bytes for ad upload (max [MAX_UPLOAD_BYTES]). */
object AdImageCropFlow {
    const val MAX_UPLOAD_BYTES = 2 * 1024 * 1024

    /**
     * UCrop often cannot read picker content:// URIs across providers.
     * Copy to a cache file first so cropping uses a stable FileProvider URI.
     */
    fun copyPickerToCacheFile(context: Context, sourceUri: Uri): Uri? {
        return try {
            val destFile = File(context.cacheDir, "ad_pick_${System.currentTimeMillis()}.jpg")
            context.contentResolver.openInputStream(sourceUri)?.use { input ->
                FileOutputStream(destFile).use { output -> input.copyTo(output) }
            } ?: return null
            FileProvider.getUriForFile(
                context,
                "${context.packageName}.fileprovider",
                destFile,
            )
        } catch (_: Exception) {
            null
        }
    }

    /**
     * Last resort: read all bytes from the picker URI and write a cache .jpg.
     * Handles providers that block streaming or return odd MIME types.
     */
    fun readPickerUriToCacheFile(context: Context, sourceUri: Uri): Uri? {
        return try {
            val bytes = context.contentResolver.openInputStream(sourceUri)?.use { it.readBytes() } ?: return null
            if (bytes.isEmpty()) return null
            val destFile = File(context.cacheDir, "ad_pick_${System.currentTimeMillis()}.jpg")
            FileOutputStream(destFile).use { it.write(bytes) }
            FileProvider.getUriForFile(
                context,
                "${context.packageName}.fileprovider",
                destFile,
            )
        } catch (_: Exception) {
            null
        }
    }

    /** Fallback when direct copy fails (some providers / photo pickers). */
    fun copyUriViaStreamWithMime(context: Context, sourceUri: Uri): Uri? {
        return try {
            val mime = context.contentResolver.getType(sourceUri) ?: "image/jpeg"
            val ext = when {
                mime.contains("png", ignoreCase = true) -> "png"
                mime.contains("webp", ignoreCase = true) -> "webp"
                mime.contains("gif", ignoreCase = true) -> "gif"
                else -> "jpg"
            }
            val destFile = File(context.cacheDir, "ad_pick_${System.currentTimeMillis()}.$ext")
            context.contentResolver.openInputStream(sourceUri)?.use { input ->
                FileOutputStream(destFile).use { output -> input.copyTo(output) }
            } ?: return null
            FileProvider.getUriForFile(
                context,
                "${context.packageName}.fileprovider",
                destFile,
            )
        } catch (_: Exception) {
            null
        }
    }

    fun buildCropIntent(context: Context, sourceUri: Uri): Intent {
        val destFile = File(context.cacheDir, "ad_crop_${System.currentTimeMillis()}.jpg")
        val destUri = FileProvider.getUriForFile(
            context,
            "${context.packageName}.fileprovider",
            destFile,
        )
        val options = UCrop.Options().apply {
            setCompressionFormat(Bitmap.CompressFormat.JPEG)
            setCompressionQuality(88)
            setFreeStyleCropEnabled(true)
            setMaxBitmapSize(4096)
            setToolbarTitle("Crop ad image")
            // Opaque bars + light toolbar widgets — avoids translucent overlap with gesture areas.
            setToolbarColor(0xFF212121.toInt())
            setStatusBarColor(0xFF212121.toInt())
            setToolbarWidgetColor(0xFFFFFFFF.toInt())
            setActiveControlsWidgetColor(0xFF90CAF9.toInt())
        }
        val intent = UCrop.of(sourceUri, destUri)
            .withOptions(options)
            .withMaxResultSize(2560, 1440)
            .getIntent(context)
        intent.setClass(context, FixedUCropActivity::class.java)
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        // Let UCrop read the source URI (FileProvider or content).
        intent.clipData = ClipData.newUri(context.contentResolver, "source", sourceUri)
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        return intent
    }

    fun readCroppedJpegBytes(context: Context, resultIntent: Intent): ByteArray? {
        val uri = UCrop.getOutput(resultIntent) ?: return null
        return context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
    }

    /** Re-encode / scale so the JPEG fits under the server limit after cropping. */
    fun ensureJpegUnderMaxBytes(jpegBytes: ByteArray): ByteArray {
        if (jpegBytes.size <= MAX_UPLOAD_BYTES) return jpegBytes
        var bmp: Bitmap? = BitmapFactory.decodeByteArray(jpegBytes, 0, jpegBytes.size) ?: return jpegBytes
        try {
            val out = ByteArrayOutputStream()
            var quality = 85
            while (quality >= 50) {
                out.reset()
                if (!bmp!!.compress(Bitmap.CompressFormat.JPEG, quality, out)) break
                if (out.size() <= MAX_UPLOAD_BYTES) return out.toByteArray()
                quality -= 10
            }
            var scale = 0.85f
            while (scale >= 0.45f) {
                val w = (bmp!!.width * scale).toInt().coerceAtLeast(1)
                val h = (bmp!!.height * scale).toInt().coerceAtLeast(1)
                if (w >= bmp!!.width && h >= bmp!!.height) break
                val scaled = Bitmap.createScaledBitmap(bmp!!, w, h, true)
                if (scaled !== bmp) {
                    bmp!!.recycle()
                    bmp = scaled
                }
                out.reset()
                if (bmp!!.compress(Bitmap.CompressFormat.JPEG, 82, out) && out.size() <= MAX_UPLOAD_BYTES) {
                    return out.toByteArray()
                }
                scale -= 0.1f
            }
            out.reset()
            bmp!!.compress(Bitmap.CompressFormat.JPEG, 55, out)
            return out.toByteArray()
        } finally {
            bmp?.recycle()
        }
    }
}
