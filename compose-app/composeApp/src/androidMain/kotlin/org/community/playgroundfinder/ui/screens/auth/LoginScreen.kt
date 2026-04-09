package org.community.playgroundfinder.ui.screens.auth

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons as MaterialIcons
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.ktor.client.*
import io.ktor.client.call.*
import io.ktor.client.plugins.contentnegotiation.*
import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*
import io.ktor.serialization.kotlinx.json.*
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import org.community.playgroundfinder.AppConfig

/** Unwraps ContextWrapper chain to find the underlying Activity. */
private fun Context.findActivity(): Activity {
    var ctx = this
    while (ctx is ContextWrapper) {
        if (ctx is Activity) return ctx
        ctx = ctx.baseContext
    }
    error("No Activity found in context chain")
}

@Serializable
private data class AuthResponse(
    val message: String = "",
    val token: String = "",
    val userId: String = "",
)

@Serializable
private data class ApiErrorBody(val error: String = "")

@Composable
fun LoginScreen(
    onLoginSuccess: (userId: String, token: String) -> Unit,
    onNavigateToAdultTerms: () -> Unit,
    onNavigateToPrivacy: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var isLoading by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var passwordError by remember { mutableStateOf<String?>(null) }
    var isRegister by remember { mutableStateOf(false) }
    var passwordVisible by remember { mutableStateOf(false) }

    val client = remember {
        HttpClient {
            install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true }) }
        }
    }

    // 4.5.4 — Google Sign-In launcher
    val googleSignInLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.StartActivityForResult()
    ) { result ->
        scope.launch {
            isLoading = true
            errorMessage = null
            try {
                // handleGoogleSignInResult is defined in GoogleSignInHelper.android.kt
                val (uid, firebaseToken) = handleGoogleSignInResult(result.data)
                // Upsert user doc on server (same flow as email/password login)
                val response: HttpResponse = client.post(
                    "${AppConfig.serverBaseUrl}/api/users/google-signin"
                ) {
                    contentType(ContentType.Application.Json)
                    setBody<Map<String, String>>(mapOf("idToken" to firebaseToken))
                }
                if (response.status.isSuccess()) {
                    val resp = response.body<AuthResponse>()
                    onLoginSuccess(resp.userId.ifBlank { uid }, resp.token.ifBlank { firebaseToken })
                } else {
                    errorMessage = "Google sign-in failed: ${response.bodyAsText()}"
                }
            } catch (e: Exception) {
                errorMessage = "Google sign-in failed: ${e.message}"
            } finally {
                isLoading = false
            }
        }
    }

    // 4.5.1 — password strength (keep in sync with server passwordPolicy.js)
    fun validatePassword(pw: String): String? = when {
        pw.length < 12 -> "At least 12 characters"
        pw.length > 128 -> "At most 128 characters"
        !pw.any { it.isLowerCase() } -> "Include a lowercase letter"
        !pw.any { it.isUpperCase() } -> "Include an uppercase letter"
        !pw.any { it.isDigit() } -> "Include a number"
        !pw.any { !it.isLetterOrDigit() } -> "Include a special character"
        else -> null
    }

    // 4.5.3 — registration success dialog
    var showVerificationDialog by remember { mutableStateOf(false) }

    // 4.5.5 — forgot password dialog
    var showForgotPasswordDialog by remember { mutableStateOf(false) }
    var forgotEmail by remember { mutableStateOf("") }
    var forgotMessage by remember { mutableStateOf<String?>(null) }
    var forgotLoading by remember { mutableStateOf(false) }

    // 4.5.3 — show "check your email" dialog after successful registration
    if (showVerificationDialog) {
        var resendLoading by remember { mutableStateOf(false) }
        var resendMessage by remember { mutableStateOf<String?>(null) }
        AlertDialog(
            onDismissRequest = { showVerificationDialog = false },
            title = { Text("Account Created") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("We sent a verification link to your email. Please check your inbox and verify your address before logging in.")
                    resendMessage?.let { Text(it, fontSize = 13.sp) }
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    showVerificationDialog = false
                    isRegister = false
                }) { Text("OK") }
            },
            dismissButton = {
                TextButton(
                    enabled = !resendLoading,
                    onClick = {
                        scope.launch {
                            resendLoading = true
                            try {
                                val response: HttpResponse = client.post(
                                    "${AppConfig.serverBaseUrl}/api/users/resend-verification"
                                ) {
                                    contentType(ContentType.Application.Json)
                                    setBody<Map<String, String>>(mapOf("email" to email))
                                }
                                resendMessage = if (response.status.isSuccess())
                                    "Verification email resent! Check your inbox."
                                else
                                    "Could not resend. Try again later."
                            } catch (e: Exception) {
                                resendMessage = "Network error. Please try again."
                            } finally {
                                resendLoading = false
                            }
                        }
                    }
                ) { Text(if (resendLoading) "Sending..." else "Resend") }
            }
        )
    }

    // 4.5.5 — forgot password dialog
    if (showForgotPasswordDialog) {
        AlertDialog(
            onDismissRequest = { showForgotPasswordDialog = false; forgotMessage = null },
            title = { Text("Reset Password") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Enter your email and we'll send a reset link.")
                    OutlinedTextField(
                        value = forgotEmail,
                        onValueChange = { forgotEmail = it; forgotMessage = null },
                        label = { Text("Email") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    forgotMessage?.let { Text(it, fontSize = 13.sp) }
                }
            },
            confirmButton = {
                TextButton(
                    enabled = forgotEmail.isNotBlank() && !forgotLoading,
                    onClick = {
                        scope.launch {
                            forgotLoading = true
                            try {
                                val response: HttpResponse = client.post(
                                    "${AppConfig.serverBaseUrl}/api/users/reset-password"
                                ) {
                                    contentType(ContentType.Application.Json)
                                    setBody<Map<String, String>>(mapOf("email" to forgotEmail))
                                }
                                forgotMessage = if (response.status.isSuccess())
                                    "Reset link sent! Check your email."
                                else
                                    "Could not send reset email. Try again."
                            } catch (e: Exception) {
                                forgotMessage = "Network error. Please try again."
                            } finally {
                                forgotLoading = false
                            }
                        }
                    }
                ) { Text(if (forgotLoading) "Sending..." else "Send Reset Link") }
            },
            dismissButton = {
                TextButton(onClick = { showForgotPasswordDialog = false; forgotMessage = null }) {
                    Text("Cancel")
                }
            }
        )
    }

    Box(
        modifier = Modifier.fillMaxSize().background(
            Brush.verticalGradient(listOf(Color(0xFF33CCBF), Color(0xFF1A8F86)))
        ),
        contentAlignment = Alignment.Center
    ) {
        Card(
            modifier = Modifier.padding(24.dp).fillMaxWidth(),
            shape = RoundedCornerShape(24.dp)
        ) {
            Column(
                modifier = Modifier
                    .padding(24.dp)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Text(
                    if (isRegister) "Create Your Account" else "Sign In",
                    fontSize = 24.sp, fontWeight = FontWeight.Bold
                )

                OutlinedTextField(
                    value = email,
                    onValueChange = { email = it; errorMessage = null },
                    label = { Text("Email") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true
                )

                OutlinedTextField(
                    value = password,
                    onValueChange = {
                        password = it
                        errorMessage = null
                        if (isRegister) passwordError = validatePassword(it)
                    },
                    label = { Text("Password") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    visualTransformation = if (passwordVisible) VisualTransformation.None else PasswordVisualTransformation(),
                    trailingIcon = {
                        IconButton(onClick = { passwordVisible = !passwordVisible }) {
                            Icon(
                                imageVector = if (passwordVisible) MaterialIcons.Filled.Visibility else MaterialIcons.Filled.VisibilityOff,
                                contentDescription = if (passwordVisible) "Hide password" else "Show password"
                            )
                        }
                    },
                    isError = isRegister && passwordError != null,
                    supportingText = when {
                        isRegister && passwordError != null -> {
                            { Text(passwordError!!, color = MaterialTheme.colorScheme.error) }
                        }
                        isRegister -> {
                            {
                                Text(
                                    "12+ characters with upper & lower case, a number, and a symbol.",
                                    fontSize = 12.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                        else -> null
                    },
                )

                errorMessage?.let {
                    Text(it, color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
                }

                Button(
                    onClick = {
                        // 4.5.1 — block submission if password fails validation on register
                        if (isRegister) {
                            val err = validatePassword(password)
                            if (err != null) { passwordError = err; return@Button }
                        }
                        scope.launch {
                            isLoading = true
                            errorMessage = null
                            val endpoint = if (isRegister) "register" else "login"
                            try {
                                val url = "${AppConfig.serverBaseUrl}/api/users/$endpoint"
                                val response: HttpResponse = client.post(url) {
                                    contentType(ContentType.Application.Json)
                                    setBody<Map<String, String>>(mapOf("email" to email, "password" to password))
                                }
                                if (response.status.isSuccess()) {
                                    val resp = response.body<AuthResponse>()
                                    if (isRegister) {
                                        showVerificationDialog = true
                                    } else {
                                        // Sign into Firebase client-side so the session persists across app restarts
                                        try {
                                            com.google.firebase.auth.FirebaseAuth.getInstance()
                                                .signInWithEmailAndPassword(email, password)
                                                .await()
                                        } catch (_: Exception) {
                                            // Non-fatal: server auth succeeded, Firebase local sign-in is for persistence only
                                        }
                                        onLoginSuccess(resp.userId, resp.token)
                                    }
                                } else {
                                    val raw = response.bodyAsText()
                                    val detail = try {
                                        Json.decodeFromString<ApiErrorBody>(raw).error.ifBlank { raw }
                                    } catch (_: Exception) {
                                        raw
                                    }
                                    errorMessage = if (isRegister) {
                                        "Could not create account: $detail"
                                    } else {
                                        "Login failed: $detail"
                                    }
                                }
                            } catch (e: Exception) {
                                errorMessage = "Network error: ${e.message}"
                            } finally {
                                isLoading = false
                            }
                        }
                    },
                    modifier = Modifier.fillMaxWidth().height(50.dp),
                    shape = RoundedCornerShape(12.dp),
                    enabled = !isLoading
                ) {
                    if (isLoading) CircularProgressIndicator(color = Color.White, modifier = Modifier.size(24.dp))
                    else Text(if (isRegister) "Sign Up" else "Login")
                }

                if (!isRegister) {
                    TextButton(
                        onClick = { showForgotPasswordDialog = true },
                        modifier = Modifier.align(Alignment.End)
                    ) {
                        Text("Forgot Password?", fontSize = 14.sp)
                    }
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.Center
                ) {
                    Text(if (isRegister) "Already have an account? " else "Don't have an account? ")
                    TextButton(onClick = { isRegister = !isRegister; errorMessage = null }) {
                        Text(if (isRegister) "Login" else "Sign Up", color = Color(0xFF5E5E5E))
                    }
                }

                HorizontalDivider(modifier = Modifier.padding(vertical = 8.dp))

                // 4.5.4 — Google Sign-In button
                OutlinedButton(
                    onClick = {
                        val activity = context.findActivity()
                        // buildGoogleSignInIntent is defined in GoogleSignInHelper.android.kt
                        googleSignInLauncher.launch(buildGoogleSignInIntent(activity, AppConfig.googleWebClientId))
                    },
                    modifier = Modifier.fillMaxWidth().height(50.dp),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Text("Continue with Google")
                }

                Spacer(modifier = Modifier.height(8.dp))

                Column(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text("By continuing, you agree to our", fontSize = 12.sp, color = Color.Gray)
                    Row {
                        TextButton(onClick = onNavigateToAdultTerms) {
                            Text("Terms of Service", fontSize = 12.sp, color = Color(0xFF5E5E5E))
                        }
                        Text(" & ", fontSize = 12.sp, color = Color.Gray, modifier = Modifier.align(Alignment.CenterVertically))
                        TextButton(onClick = onNavigateToPrivacy) {
                            Text("Privacy Policy", fontSize = 12.sp, color = Color(0xFF5E5E5E))
                        }
                    }
                }
            }
        }
    }
}
