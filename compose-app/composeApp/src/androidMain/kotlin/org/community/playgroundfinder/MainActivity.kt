package org.community.playgroundfinder

import android.Manifest
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import com.stripe.android.PaymentConfiguration
import com.stripe.android.paymentsheet.PaymentSheet
import com.stripe.android.paymentsheet.PaymentSheetResult
import org.community.playgroundfinder.ui.screens.advertising.PaymentResult

class MainActivity : ComponentActivity() {

    lateinit var paymentSheet: PaymentSheet
        private set

    var paymentResultCallback: ((PaymentResult) -> Unit)? = null

    // Request both coarse and fine location on first launch.
    // The result is intentionally ignored here — LocationService will
    // re-check at call time. This just ensures the OS dialog is shown.
    private val locationPermissionRequest = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { /* no-op — LocationService handles the result */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Initialize Stripe SDK with publishable key (Android: BuildConfig via AppConfig)
        val stripeKey = AppConfig.stripePublishableKey
        if (stripeKey.isNotBlank()) {
            PaymentConfiguration.init(this, stripeKey)
        }

        // Create PaymentSheet registered to the activity lifecycle
        paymentSheet = PaymentSheet(this) { result ->
            val mapped = when (result) {
                is PaymentSheetResult.Completed -> PaymentResult.Success
                is PaymentSheetResult.Canceled -> PaymentResult.Cancelled
                is PaymentSheetResult.Failed -> PaymentResult.Error(
                    result.error.localizedMessage ?: "Payment failed"
                )
            }
            paymentResultCallback?.invoke(mapped)
        }

        locationPermissionRequest.launch(
            arrayOf(
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
            )
        )
        setContent {
            App()
        }
    }
}
