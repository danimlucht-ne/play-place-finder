package org.community.playgroundfinder.ui.composables

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

@Composable
fun QuickVerifyDialog(
    needsDisplayName: Boolean,
    verifyFirstName: String,
    verifyLastInitial: String,
    onVerifyFirstNameChange: (String) -> Unit,
    onVerifyLastInitialChange: (String) -> Unit,
    verifyNameError: String?,
    onSubmit: (rating: Int?) -> Unit,
    onDismiss: () -> Unit,
    isLoading: Boolean = false,
    isSuccess: Boolean = false,
) {
    var selectedRating by remember { mutableStateOf<Int?>(null) }

    LaunchedEffect(isSuccess) {
        if (isSuccess) {
            delay(1500L)
            onDismiss()
        }
    }

    val nameFilled = verifyFirstName.trim().length >= 2 && verifyLastInitial.trim().isNotBlank()

    AlertDialog(
        onDismissRequest = { if (!isLoading) onDismiss() },
        title = { Text("Quick Verification", fontWeight = FontWeight.Bold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (isSuccess) {
                    Text(
                        "Verified! Thank you for helping keep this info accurate.",
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Medium,
                        color = FormColors.BodyText,
                    )
                } else {
                    Text(
                        "Does the information for this playground look correct?",
                        fontSize = 14.sp,
                        color = Color(0xFF424242),
                    )
                    Text(
                        "Your verification helps other families trust this listing.",
                        fontSize = 13.sp,
                        color = Color(0xFF757575),
                    )

                    if (needsDisplayName) {
                        Text(
                            "Public name (contributor board)",
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = Color(0xFF424242),
                        )
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            OutlinedTextField(
                                value = verifyFirstName,
                                onValueChange = { if (it.length <= 24) onVerifyFirstNameChange(it) },
                                label = { Text("First name") },
                                singleLine = true,
                                modifier = Modifier.weight(1f),
                                enabled = !isLoading,
                            )
                            OutlinedTextField(
                                value = verifyLastInitial,
                                onValueChange = { if (it.length <= 3) onVerifyLastInitialChange(it) },
                                label = { Text("Last initial") },
                                singleLine = true,
                                modifier = Modifier.weight(0.65f),
                                enabled = !isLoading,
                            )
                        }
                        verifyNameError?.let {
                            Text(it, fontSize = 12.sp, color = Color(0xFFE53935))
                        }
                    }

                    Spacer(Modifier.height(4.dp))
                    Button(
                        onClick = { onSubmit(selectedRating) },
                        enabled = !isLoading && (!needsDisplayName || nameFilled),
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = FormColors.PrimaryButton,
                            contentColor = FormColors.PrimaryButtonText,
                        ),
                    ) {
                        if (isLoading) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(18.dp),
                                color = FormColors.PrimaryButtonText,
                                strokeWidth = 2.dp,
                            )
                        } else {
                            Text("Yes, looks correct")
                        }
                    }

                    Spacer(Modifier.height(8.dp))
                    Text(
                        "Rate this place (optional)",
                        fontSize = 13.sp,
                        color = Color(0xFF424242),
                        modifier = Modifier.fillMaxWidth(),
                        textAlign = TextAlign.Center,
                    )
                    Row(
                        horizontalArrangement = Arrangement.Center,
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        (1..5).forEach { star ->
                            TextButton(
                                onClick = { selectedRating = star },
                                enabled = !isLoading,
                                contentPadding = PaddingValues(horizontal = 2.dp, vertical = 0.dp),
                            ) {
                                Text(
                                    if ((selectedRating ?: 0) >= star) "★" else "☆",
                                    fontSize = 30.sp,
                                    color = if ((selectedRating ?: 0) >= star) Color(0xFFFFB300) else Color(0xFFBDBDBD),
                                )
                            }
                        }
                    }
                    Text(
                        if (selectedRating == null) "No rating"
                        else "$selectedRating / 5 — ${ratingLabels[selectedRating!!] ?: ""}",
                        fontSize = 12.sp,
                        color = Color(0xFF757575),
                        modifier = Modifier.fillMaxWidth(),
                        textAlign = TextAlign.Center,
                    )
                }
            }
        },
        confirmButton = {},
        dismissButton = {
            if (!isSuccess) {
                TextButton(onClick = onDismiss, enabled = !isLoading) {
                    Text("Cancel")
                }
            }
        },
    )
}
