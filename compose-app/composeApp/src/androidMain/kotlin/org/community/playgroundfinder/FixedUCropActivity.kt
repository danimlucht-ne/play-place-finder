package org.community.playgroundfinder

import android.os.Bundle
import androidx.core.view.WindowCompat
import com.yalantis.ucrop.UCropActivity

/**
 * uCrop 2.x predates Android 15 edge-to-edge defaults. Without this, the toolbar (cancel / crop)
 * and bottom controls draw under the status and navigation bars and do not receive touches.
 */
class FixedUCropActivity : UCropActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        WindowCompat.setDecorFitsSystemWindows(window, true)
        super.onCreate(savedInstanceState)
    }
}
