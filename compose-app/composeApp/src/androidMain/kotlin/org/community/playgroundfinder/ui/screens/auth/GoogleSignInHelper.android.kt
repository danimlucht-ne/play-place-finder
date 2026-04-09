package org.community.playgroundfinder.ui.screens.auth

import android.app.Activity
import android.content.Intent
import android.util.Log
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.auth.api.signin.GoogleSignInOptions
import com.google.android.gms.common.api.ApiException
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.GoogleAuthProvider
import kotlinx.coroutines.tasks.await
import org.community.playgroundfinder.BuildConfig

/**
 * Builds the Google Sign-In intent to be launched via ActivityResultLauncher.
 */
fun buildGoogleSignInIntent(activity: Activity, webClientId: String): Intent {
    val gso = GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
        .requestIdToken(webClientId)
        .requestEmail()
        .build()
    val client = GoogleSignIn.getClient(activity, gso)
    // Sign out first to force account picker every time
    client.signOut()
    return client.signInIntent
}

/**
 * Exchanges the Google Sign-In result intent for a Firebase ID token.
 * Returns the Firebase ID token string on success, throws on failure.
 */
suspend fun handleGoogleSignInResult(data: Intent?): Pair<String, String> {
    return try {
        val task = GoogleSignIn.getSignedInAccountFromIntent(data)
        val account = task.getResult(ApiException::class.java)
        val idToken = account.idToken
        if (idToken == null) {
            if (BuildConfig.DEBUG) {
                Log.w(
                    "AuthGoogle",
                    "Google account has null idToken (check Web client ID in requestIdToken and Firebase SHA-1); email=${account.email}",
                )
            }
            throw Exception("Google Sign-In returned no ID token")
        }
        val credential = GoogleAuthProvider.getCredential(idToken, null)
        val authResult = FirebaseAuth.getInstance().signInWithCredential(credential).await()
        val user = authResult.user ?: throw Exception("Firebase sign-in returned no user")
        val firebaseIdToken = user.getIdToken(false).await().token
            ?: throw Exception("Could not retrieve Firebase ID token")
        if (BuildConfig.DEBUG) {
            Log.d("AuthGoogle", "Firebase user ok uid=${user.uid} idTokenLen=${firebaseIdToken.length}")
        }
        Pair(user.uid, firebaseIdToken)
    } catch (e: ApiException) {
        if (BuildConfig.DEBUG) {
            Log.e("AuthGoogle", "GoogleSignIn ApiException status=${e.statusCode}", e)
        }
        throw Exception("Google Sign-In failed (Play Services code ${e.statusCode}): ${e.message}")
    }
}
