package org.community.playgroundfinder.ui.screens.admin

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.community.playgroundfinder.util.ApiDevConstants
import org.community.playgroundfinder.util.ApiDevSettingsKeys
import org.community.playgroundfinder.util.AppSettings
import org.community.playgroundfinder.ui.composables.FormColors

/**
 * Debug-only entry from Admin Hub. Lets you switch API base URL without rebuilding
 * (e.g. LAN IP for Wi‑Fi vs 127.0.0.1 with adb reverse for USB).
 */
@Composable
fun DevApiEndpointScreen(
    settings: AppSettings,
    gradleDefaultUrl: String,
    /** When true (Android debug only), show one-tap Test vs Production API switches. */
    showTestProdQuickSwitch: Boolean = false,
    onPersistOverride: (String) -> Unit,
    onBack: () -> Unit,
) {
    var field by remember {
        mutableStateOf(settings.getString(ApiDevSettingsKeys.SERVER_BASE_URL_OVERRIDE, "").trim())
    }
    val effectiveHint = remember(field, gradleDefaultUrl) {
        field.trim().ifEmpty { gradleDefaultUrl.trim() }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Dev API base URL", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        if (showTestProdQuickSwitch) {
            Text(
                "Quick switch — applies immediately. Test uses your Gradle debug default; Production uses the live API host.",
                fontSize = 12.sp,
                color = Color(0xFF616161),
                lineHeight = 16.sp,
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                OutlinedButton(
                    onClick = {
                        field = ""
                        onPersistOverride("")
                    },
                    modifier = Modifier.weight(1f),
                ) { Text("Test (Gradle)", maxLines = 2, fontSize = 12.sp) }
                OutlinedButton(
                    onClick = {
                        val prod = ApiDevConstants.PRODUCTION_API_BASE_URL.trimEnd('/')
                        field = prod
                        onPersistOverride(prod)
                    },
                    modifier = Modifier.weight(1f),
                ) { Text("Production", maxLines = 2, fontSize = 12.sp) }
            }
            Text(
                "Stripe / Google client IDs still come from this debug build — use keys that match the server you call.",
                fontSize = 11.sp,
                color = Color(0xFF757575),
                lineHeight = 15.sp,
            )
            Spacer(Modifier.height(4.dp))
        }
        Text(
            "Leave empty to use the value from local.properties (shown below). " +
                "Set a full URL with no trailing slash, e.g. http://192.168.1.10:8000 for Wi‑Fi or " +
                "http://127.0.0.1:8000 with adb reverse tcp:8000 tcp:8000.",
            fontSize = 13.sp,
            color = Color(0xFF616161),
            lineHeight = 18.sp,
        )
        Text("Gradle / BuildConfig default:", fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
        Text(gradleDefaultUrl, fontSize = 12.sp, color = FormColors.PrimaryButton)
        Text("Effective after save (preview):", fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
        Text(effectiveHint, fontSize = 12.sp, color = Color(0xFF424242))
        OutlinedTextField(
            value = field,
            onValueChange = { field = it },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Override (optional)") },
            placeholder = { Text("Empty = use default above") },
            singleLine = true,
        )
        Button(
            onClick = {
                onPersistOverride(field.trim())
                onBack()
            },
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(
                containerColor = FormColors.PrimaryButton,
                contentColor = FormColors.PrimaryButtonText,
            ),
        ) { Text("Save & back") }
        Button(
            onClick = {
                field = ""
                onPersistOverride("")
                onBack()
            },
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(
                containerColor = Color(0xFF757575),
                contentColor = Color.White,
            ),
        ) { Text("Clear override (use Gradle default)") }
        Spacer(Modifier.height(8.dp))
    }
}
