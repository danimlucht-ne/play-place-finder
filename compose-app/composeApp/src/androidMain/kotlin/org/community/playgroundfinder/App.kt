package org.community.playgroundfinder

import androidx.compose.animation.Crossfade
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons as MaterialIcons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import org.community.playgroundfinder.data.ConsentService
import org.community.playgroundfinder.data.Playground
import org.community.playgroundfinder.data.PlaygroundService
import org.community.playgroundfinder.data.WeatherService
import org.community.playgroundfinder.util.rememberSettings
import org.community.playgroundfinder.ui.screens.home.HomeScreen
import org.community.playgroundfinder.ui.screens.onboarding.OnboardingScreen
import org.community.playgroundfinder.ui.screens.privacy.PrivacyScreen
import org.community.playgroundfinder.ui.screens.auth.LoginScreen
import org.community.playgroundfinder.ui.screens.auth.AdultTermsScreen
import org.community.playgroundfinder.ui.screens.map.MapScreen
import org.community.playgroundfinder.ui.screens.events.NearbyEventsCalendarScreen
import org.community.playgroundfinder.ui.screens.add.AddEditPlaygroundScreen
import org.community.playgroundfinder.ui.screens.favorites.FavoritesScreen
import org.community.playgroundfinder.ui.screens.details.PlaygroundDetailScreen
import org.community.playgroundfinder.ui.screens.lists.*
import org.community.playgroundfinder.ui.screens.admin.*
import org.community.playgroundfinder.ui.screens.me.MySubmissionsScreen
import org.community.playgroundfinder.ui.screens.advertising.*
import org.community.playgroundfinder.ui.composables.*
import com.google.firebase.auth.FirebaseAuth
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import org.community.playgroundfinder.models.AdCreativePayload
import org.community.playgroundfinder.models.AllAdsResponse
import org.community.playgroundfinder.models.HybridSearchResponse
import org.community.playgroundfinder.models.RegionSearchResult
import org.community.playgroundfinder.util.rememberLocationService
import android.app.Activity
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import com.yalantis.ucrop.UCrop
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import com.stripe.android.paymentsheet.PaymentSheet
import org.community.playgroundfinder.ui.screens.advertising.PaymentResult
import org.community.playgroundfinder.BuildConfig

sealed class Screen {
    data object Onboarding : Screen()
    data object Privacy : Screen()
    data object AdultTerms : Screen()
    data object Login : Screen()
    data object Home : Screen()
    data class Map(
        val initialPlaces: List<Playground> = emptyList(),
        val useInitialAsAuthoritative: Boolean = false,
        val filterSummary: String? = null,
        /** When set, map shows only these markers (no full-catalog fetch). Overrides [useInitialAsAuthoritative]. */
        val filteredPlaygrounds: List<Playground>? = null,
    ) : Screen()
    /** Sponsored events calendar for the user’s current discovery region (same ads as inline listings). */
    data class NearbyEvents(
        val regionKey: String,
        val regionLabel: String,
        /** From Home’s inline fetch when [regionKey] matches discovery region — skips duplicate GET on open. */
        val preloadedInlineListingAds: AllAdsResponse? = null,
    ) : Screen()
    data class PlaygroundList(
        val initialPlaces: List<Playground> = emptyList(),
        val useInitialAsAuthoritative: Boolean = false,
        val filterSummary: String? = null
    ) : Screen()
    data object Favorites : Screen()
    data object PlayLists : Screen()
    data class PlayListDetail(val id: String, val name: String) : Screen()
    data object SeedReview : Screen()
    data object AdminQueue : Screen()
    data class AdminDetail(val id: String) : Screen()
    data object AdminSupportQueue : Screen()
    data class AdminSupportDetail(val id: String) : Screen()
    data object SupportTicket : Screen()
    data class SupportTicketForPlace(val placeId: String) : Screen()
    data object AdminHub : Screen()
    data object AdminAnalytics : Screen()
    data object AdminRegionSwitcher : Screen()
    data class RegionPlaygrounds(val regionKey: String, val regionLabel: String) : Screen()
    data class SearchResults(val response: HybridSearchResponse) : Screen()
    data class PlaygroundDetail(val playground: Playground) : Screen()
    data class EditPlayground(val playground: Playground) : Screen()

    // Advertising onboarding flow
    data object AdvertiserEntry : Screen()
    data object BusinessInfo : Screen()
    data class PackageSelection(val submissionId: String, val regionKey: String) : Screen()
    data class CreativeContent(val submissionId: String) : Screen()
    data class AdPreview(val submissionId: String) : Screen()
    data class Terms(val submissionId: String) : Screen()
    data class Payment(val submissionId: String) : Screen()
    data class SubmissionStatus(val submissionId: String) : Screen()
    data object AdvertiserDashboard : Screen()
    data object AdReviewQueue : Screen()
    data class AdSubmissionReview(val submissionId: String) : Screen()
    data object AdminDiscountHub : Screen()
    data object AdminCampaignManagement : Screen()
    data object AdminLeaderboard : Screen()
    data object AdminBulkTools : Screen()
    data object AdminRegionMaintenance : Screen()
    /** Debug: switch API base URL (Wi‑Fi vs USB) without rebuilding. */
    data object DevApiEndpoint : Screen()
    data object MySubmissions : Screen()
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun App() {
    val settings = rememberSettings()
    remember(settings) {
        DevServerBaseOverride.syncFrom(settings)
        Unit
    }
    
    // Auth State
    var userId by remember { mutableStateOf(settings.getString("userId", "")) }
    var authToken by remember { mutableStateOf(settings.getString("authToken", "")) }

    // Always fetch a fresh Firebase ID token — they expire after 1 hour.
    // forceRefresh=true ensures we never send an expired token.
    // If currentUser is null (no active session), return null so the server
    // receives no Authorization header and returns 401, which the LaunchedEffect
    // below catches to redirect to login. Never fall back to the stale stored token.
    val tokenProvider: suspend () -> String? = {
        try {
            FirebaseAuth.getInstance().currentUser?.getIdToken(true)?.await()?.token
        } catch (_: Exception) {
            null
        }
    }

    val service = remember { PlaygroundService(tokenProvider) }

    // Image picker state — shared across edit screens
    val context = LocalContext.current
    var pendingImageBatch by remember { mutableStateOf<List<ByteArray>?>(null) }
    val imagePickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetMultipleContents(),
    ) { uris ->
        if (uris.isNullOrEmpty()) return@rememberLauncherForActivityResult
        val list = mutableListOf<ByteArray>()
        for (uri in uris) {
            try {
                context.contentResolver.openInputStream(uri)?.use { input ->
                    val bytes = input.readBytes()
                    if (bytes.isNotEmpty()) list.add(bytes)
                }
            } catch (_: Exception) {}
        }
        if (list.isNotEmpty()) pendingImageBatch = list
    }

    // Stripe payment result state
    val activity = context as MainActivity
    var currentPaymentResult by remember { mutableStateOf<PaymentResult?>(null) }

    // Ad creative: gallery pick → UCrop → JPEG bytes (separate from playground edit picker)
    var adImageBytes by remember { mutableStateOf<ByteArray?>(null) }
    var adImageName by remember { mutableStateOf<String?>(null) }
    val adCropLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        when (result.resultCode) {
            Activity.RESULT_OK -> {
                val data = result.data ?: return@rememberLauncherForActivityResult
                try {
                    val raw = AdImageCropFlow.readCroppedJpegBytes(context, data) ?: run {
                        Toast.makeText(context, "Could not read cropped image", Toast.LENGTH_SHORT).show()
                        return@rememberLauncherForActivityResult
                    }
                    val finalBytes = AdImageCropFlow.ensureJpegUnderMaxBytes(raw)
                    if (finalBytes.size > AdImageCropFlow.MAX_UPLOAD_BYTES) {
                        Toast.makeText(
                            context,
                            "Image is still too large. Try cropping tighter or a simpler photo.",
                            Toast.LENGTH_LONG,
                        ).show()
                        return@rememberLauncherForActivityResult
                    }
                    adImageBytes = finalBytes
                    adImageName = "ad_creative.jpg"
                } catch (_: Exception) {
                    Toast.makeText(context, "Could not process image", Toast.LENGTH_SHORT).show()
                }
            }
            UCrop.RESULT_ERROR -> {
                val err = result.data?.let { UCrop.getError(it) }
                Toast.makeText(context, err?.message ?: "Crop failed", Toast.LENGTH_SHORT).show()
            }
            else -> { /* user cancelled */ }
        }
    }
    /** When user picks 2+ images, upload without UCrop; single pick still opens crop for banner framing. */
    var adImageDirectBatch by remember { mutableStateOf<List<ByteArray>?>(null) }
    val adImagePickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetMultipleContents(),
    ) { uris ->
        if (uris.isNullOrEmpty()) return@rememberLauncherForActivityResult
        if (uris.size == 1) {
            val uri = uris.first()
            try {
                val local = AdImageCropFlow.copyPickerToCacheFile(context, uri)
                    ?: AdImageCropFlow.copyUriViaStreamWithMime(context, uri)
                    ?: AdImageCropFlow.readPickerUriToCacheFile(context, uri)
                    ?: uri
                adCropLauncher.launch(AdImageCropFlow.buildCropIntent(context, local))
            } catch (e: Exception) {
                Toast.makeText(context, "Could not open crop editor: ${e.message ?: e.javaClass.simpleName}", Toast.LENGTH_LONG).show()
            }
        } else {
            val list = mutableListOf<ByteArray>()
            for (uri in uris) {
                try {
                    context.contentResolver.openInputStream(uri)?.use { input ->
                        val bytes = input.readBytes()
                        if (bytes.isNotEmpty()) list.add(bytes)
                    }
                } catch (_: Exception) {}
            }
            if (list.isNotEmpty()) adImageDirectBatch = list
        }
    }

    // Top-level location state — fetched once, threaded into screens
    var userLat by remember { mutableStateOf<Double?>(null) }
    var userLng by remember { mutableStateOf<Double?>(null) }

    // Admin role state
    var isAdmin by remember { mutableStateOf(settings.getBoolean("isAdmin", false)) }

    // Email verification state — Google users are always considered verified
    var isEmailVerified by remember { mutableStateOf(true) }

    // Unread notification dialog state
    var pendingNotifications by remember { mutableStateOf<List<Map<String, Any?>>>(emptyList()) }
    var showNotificationDialog by remember { mutableStateOf(false) }

    // Initial state check
    val startScreen = remember {
        if (!settings.getBoolean("onboardingCompleted", false) ||
            !settings.getBoolean("isAdultConfirmed", false)) {
            Screen.Onboarding
        } else if (userId.isEmpty()) {
            Screen.Login
        } else {
            Screen.Home
        }
    }

    var currentScreen by remember { mutableStateOf<Screen>(startScreen) }
    /** Set when leaving All Sites (etc.) so Home opens the filter sheet after [navigateBack]. */
    var openFilterSheetWhenHomeAppears by remember { mutableStateOf(false) }
    /** When true with the above, Apply & Search returns to the interactive map instead of staying on Home. */
    var openFilterReturnToMap by remember { mutableStateOf(false) }

    // ── Back stack ────────────────────────────────────────────────────────────
    // Screens that should NOT be pushed onto the back stack (navigating "back"
    // from them exits the app or goes to Home, not the previous screen).
    val noBackScreens = setOf(Screen.Home)

    val backStack = remember { mutableStateListOf<Screen>() }

    fun Screen.isAdSubmissionPipelineBackEntry(): Boolean = when (this) {
        is Screen.AdvertiserEntry,
        is Screen.BusinessInfo,
        is Screen.PackageSelection,
        is Screen.CreativeContent,
        is Screen.AdPreview,
        is Screen.Terms,
        is Screen.Payment -> true
        else -> false
    }

    /** After payment (or free checkout), show status without keeping Payment → Terms → … on the back stack. */
    fun completeAdSubmissionAndShowStatus(submissionId: String) {
        while (backStack.isNotEmpty() && backStack.last().isAdSubmissionPipelineBackEntry()) {
            backStack.removeLast()
        }
        currentScreen = Screen.SubmissionStatus(submissionId)
    }

    fun navigateTo(screen: Screen) {
        if (currentScreen !in noBackScreens) backStack.add(currentScreen)
        currentScreen = screen
    }

    fun navigateBack() {
        try {
            if (backStack.isNotEmpty()) {
                currentScreen = backStack.removeLast()
            } else if (currentScreen !is Screen.Home && currentScreen !is Screen.Login && currentScreen !is Screen.Onboarding) {
                currentScreen = if (userId.isEmpty()) Screen.Login else Screen.Home
            }
        } catch (_: Exception) {
            // Safety net: if anything goes wrong, go home
            currentScreen = if (userId.isEmpty()) Screen.Login else Screen.Home
            backStack.clear()
        }
    }

    // Intercept Android system back button — only when not on a root screen
    androidx.activity.compose.BackHandler(enabled = currentScreen !is Screen.Home && currentScreen !is Screen.Login && currentScreen !is Screen.Onboarding) {
        navigateBack()
    }

    // If we have a stored userId but Firebase has no current user (e.g. after
    // an app reinstall or token cache clear), force re-login immediately.
    LaunchedEffect(Unit) {
        if (userId.isNotBlank() && FirebaseAuth.getInstance().currentUser == null) {
            settings.putString("userId", "")
            settings.putString("authToken", "")
            userId = ""
            authToken = ""
            currentScreen = Screen.Login
        }
    }

    // Fetch location once at app level so all screens can use it
    val getLocation = rememberLocationService()
    LaunchedEffect(userId) {
        if (userId.isBlank()) return@LaunchedEffect
        try {
            val loc = getLocation()
            if (loc != null) {
                userLat = loc.latitude
                userLng = loc.longitude
            }
        } catch (_: Exception) {}
    }

    // Fetch admin role — check Firebase token claim + MongoDB role
    LaunchedEffect(userId) {
        if (userId.isBlank()) {
            isAdmin = false
            settings.setBoolean("isAdmin", false)
            return@LaunchedEffect
        }
        try {
            val tokenResult = com.google.firebase.auth.FirebaseAuth.getInstance()
                .currentUser?.getIdToken(true)?.await()
            val claimAdmin = tokenResult?.claims?.get("admin") as? Boolean ?: false
            val profileAdmin = try {
                service.getMyContributorProfile().role == "admin"
            } catch (_: Exception) { false }
            val admin = claimAdmin || profileAdmin
            isAdmin = admin
            settings.setBoolean("isAdmin", admin)
        } catch (_: Exception) {}
    }

    // Check for unread notifications after login (points awarded, rejections, etc.)
    LaunchedEffect(userId) {
        if (userId.isBlank()) return@LaunchedEffect
        // Check email verification status — Google users are always verified
        try {
            val currentUser = FirebaseAuth.getInstance().currentUser
            if (currentUser != null) {
                val providerIds = currentUser.providerData.map { it.providerId }
                val isGoogleUser = providerIds.contains("google.com")
                isEmailVerified = if (isGoogleUser) true else currentUser.isEmailVerified
            }
        } catch (_: Exception) {}
        try {
            kotlinx.coroutines.delay(1000) // let auth settle
            val notifications = service.getUnreadNotifications()
            if (notifications.isNotEmpty()) {
                pendingNotifications = notifications
                showNotificationDialog = true
            }
        } catch (_: Exception) {}
    }

    // Force the user back into the re-consent flow only if consent VERSION has changed.
    // We skip this check for brand-new users (accepted == null means no record exists yet —
    // they just completed onboarding and haven't had a chance to POST their consent yet).
    // Key only on userId (not authToken) to avoid firing twice on login.
    LaunchedEffect(userId) {
        if (userId.isBlank()) return@LaunchedEffect

        // Small delay to ensure Firebase SDK has finished signing in before we
        // request a token — signInWithEmailAndPassword is async and currentUser
        // may not be set yet at the exact moment userId state changes.
        kotlinx.coroutines.delay(500)

        try {
            val consentService = ConsentService(tokenProvider)
            val requirements = consentService.getConsentRequirements()

            // accepted == null means no server record yet (new user). Don't force re-consent.
            val adultStale = requirements.data.adultTerms.accepted != null &&
                requirements.data.adultTerms.required
            val locationStale = requirements.data.locationServices.accepted != null &&
                requirements.data.locationServices.required

            if (adultStale || locationStale) {
                settings.setBoolean("isAdultConfirmed", false)
                settings.setBoolean("locationConsentAccepted", false)
                currentScreen = Screen.Login
            }
        } catch (_: Exception) {
            // If we can't check, don't force re-login (fail open).
        }
    }

    MaterialTheme(
        colorScheme = lightColorScheme(
            primary = Color(0xFF00CED1),
            onPrimary = Color.White,
            primaryContainer = Color(0xFFB2EBF2),
            onPrimaryContainer = Color(0xFF004D4F),
            secondary = Color(0xFFFFFFFF),
            onSecondary = Color(0xFF00CED1),
            tertiary = Color(0xFFFFD54F),
            error = Color(0xFFE53935),
            background = Color(0xFF00CED1),
            surface = Color(0xFFFFFFFF),
            onBackground = Color.White,
            surfaceVariant = Color(0xFFE0F7F8),
            onSurfaceVariant = Color(0xFF424242),
        )
    ) {
        Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            val scope = rememberCoroutineScope()

            // ── Unread notification dialog ────────────────────────────────────
            if (showNotificationDialog && pendingNotifications.isNotEmpty()) {
                AlertDialog(
                    onDismissRequest = {},
                    title = { Text("You have updates!") },
                    text = {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            pendingNotifications.forEach { n ->
                                val msg = n["message"] as? String ?: return@forEach
                                Text("• $msg", fontSize = 13.sp)
                            }
                        }
                    },
                    confirmButton = {
                        TextButton(onClick = {
                            showNotificationDialog = false
                            scope.launch {
                                try { service.markNotificationsRead() } catch (_: Exception) {}
                            }
                        }) { Text("Got it") }
                    }
                )
            }
            // Gray containerColor is not a theme token, so contentColorFor() falls back to
            // LocalContentColor from the parent Surface (teal + onBackground=white) — fix body text contrast.
            Scaffold(
                containerColor = FormColors.ScreenBackground,
                contentColor = FormColors.BodyText,
                topBar = {
                    if (currentScreen !is Screen.Home && currentScreen !is Screen.Onboarding && currentScreen !is Screen.Login) {
                        TopAppBar(
                            title = {
                                Text(when (currentScreen) {
                                    is Screen.Privacy -> "Adult Privacy"
                                    is Screen.AdultTerms -> "Terms and Conditions"
                                    is Screen.PlaygroundList -> "Find Play Places"
                                    is Screen.Map -> "Interactive Map"
                                    is Screen.NearbyEvents -> "Events near you"
                                    is Screen.SearchResults -> "Search Results"
                                    is Screen.PlaygroundDetail -> "Place Details"
                                    is Screen.EditPlayground -> if ((currentScreen as Screen.EditPlayground).playground.id != null) "Edit / Update Play Place" else "New Play Place"
                                    is Screen.Favorites -> "My Favorites"
                                    is Screen.PlayLists -> "My Play Lists"
                                    is Screen.PlayListDetail -> (currentScreen as Screen.PlayListDetail).name
                                    is Screen.AdminQueue -> "Moderation Queue"
                                    is Screen.SeedReview -> "Seed Photo Review"
                                    is Screen.AdminDetail -> "Review Submission"
                                        is Screen.AdminSupportQueue -> "Support Queue"
                                        is Screen.AdminSupportDetail -> "Review Ticket"
                                        is Screen.SupportTicket -> "Contact / Support"
                                        is Screen.SupportTicketForPlace -> "Contact / Support"
                                        is Screen.AdminHub -> "Admin Hub"
                                        is Screen.AdminAnalytics -> "Analytics"
                                        is Screen.AdminRegionSwitcher -> "Region Switcher"
                                        is Screen.RegionPlaygrounds -> "Region: ${(currentScreen as Screen.RegionPlaygrounds).regionLabel}"
                                    is Screen.AdvertiserEntry -> "Advertise"
                                    is Screen.BusinessInfo -> "Business Info"
                                    is Screen.PackageSelection -> "Select Package"
                                    is Screen.CreativeContent -> "Creative Content"
                                    is Screen.AdPreview -> "Ad Preview"
                                    is Screen.Terms -> "Terms & Conditions"
                                    is Screen.Payment -> "Payment"
                                    is Screen.SubmissionStatus -> "Submission Status"
                                    is Screen.AdvertiserDashboard -> "My Campaigns"
                                    is Screen.AdReviewQueue -> "Ad Review Queue"
                                    is Screen.AdSubmissionReview -> "Review Submission"
                                    is Screen.AdminDiscountHub -> "Discount Hub"
                                    is Screen.AdminCampaignManagement -> "Campaign Management"
                                    is Screen.AdminLeaderboard -> "Leaderboard"
                                    is Screen.AdminBulkTools -> "Merge & activity by name"
                                        is Screen.AdminRegionMaintenance -> "Region tools"
                                        is Screen.DevApiEndpoint -> "Dev API URL"
                                        is Screen.MySubmissions -> "My Submissions"
                                    else -> ""
                                }, fontWeight = FontWeight.Bold)
                            },
                            navigationIcon = {
                                IconButton(onClick = { navigateBack() }) {
                                    Icon(MaterialIcons.Filled.ArrowBack, contentDescription = "Back")
                                }
                            },
                            colors = TopAppBarDefaults.topAppBarColors(
                                containerColor = MaterialTheme.colorScheme.primary,
                                titleContentColor = Color.White,
                                navigationIconContentColor = Color.White
                            )
                        )
                    }
                }
            ) { paddingValues ->
                Box(modifier = Modifier.padding(paddingValues).fillMaxSize()) {
                    val screen = currentScreen
                    when (screen) {
                            is Screen.Onboarding -> OnboardingScreen(
                                onComplete = { navigateTo(if (userId.isEmpty()) Screen.Login else Screen.Home) },
                                onNavigateToPrivacy = { navigateTo(Screen.Privacy) },
                                onNavigateToAdultTerms = { navigateTo(Screen.AdultTerms) }
                            )
                            is Screen.Privacy -> PrivacyScreen()
                            is Screen.AdultTerms -> AdultTermsScreen(version = 1, onBack = { navigateBack() })
                            is Screen.Login -> LoginScreen(
                                onLoginSuccess = { id, token ->
                                    settings.putString("userId", id)
                                    settings.putString("authToken", token)
                                    userId = id
                                    authToken = token
                                    currentScreen = Screen.Home
                                },
                                onNavigateToAdultTerms = { navigateTo(Screen.AdultTerms) },
                                onNavigateToPrivacy = { navigateTo(Screen.Privacy) }
                            )
                            is Screen.Home -> HomeScreen(
                                service = service,
                                isAdmin = isAdmin,
                                isEmailVerified = isEmailVerified,
                                onResendVerification = {
                                    scope.launch {
                                        try {
                                            val email = FirebaseAuth.getInstance().currentUser?.email ?: return@launch
                                            // Use a simple URL connection to avoid Ktor import issues
                                            val url = java.net.URL("${AppConfig.serverBaseUrl}/api/users/resend-verification")
                                            val conn = url.openConnection() as java.net.HttpURLConnection
                                            conn.requestMethod = "POST"
                                            conn.setRequestProperty("Content-Type", "application/json")
                                            conn.doOutput = true
                                            conn.outputStream.write("{\"email\":\"$email\"}".toByteArray())
                                            conn.responseCode // trigger the request
                                            conn.disconnect()
                                        } catch (_: Exception) {}
                                    }
                                },
                                onNavigateToSearch = { response -> navigateTo(Screen.SearchResults(response)) },
                                onNavigateToMap = { places, summary ->
                                    navigateTo(
                                        Screen.Map(
                                            filteredPlaygrounds = places,
                                            filterSummary = summary,
                                        ),
                                    )
                                },
                                onNavigateToAdd = { navigateTo(Screen.EditPlayground(Playground())) },
                                onNavigateToAll = { places, summary ->
                                    navigateTo(
                                        Screen.PlaygroundList(
                                            initialPlaces = places,
                                            useInitialAsAuthoritative = true,
                                            filterSummary = summary
                                        )
                                    )
                                },
                                onNavigateToDetail = { navigateTo(Screen.PlaygroundDetail(it)) },
                                onNavigateToPrivacy = { navigateTo(Screen.Privacy) },
                                onNavigateToSupportTicket = { navigateTo(Screen.SupportTicket) },
                                onNavigateToAdminHub = { navigateTo(Screen.AdminHub) },
                                onNavigateToFavorites = { navigateTo(Screen.Favorites) },
                                onNavigateToMySubmissions = { navigateTo(Screen.MySubmissions) },
                                onNavigateToLists = { navigateTo(Screen.PlayLists) },
                                onNavigateToRegionPlaygrounds = { regionKey, label ->
                                    navigateTo(Screen.RegionPlaygrounds(regionKey, label))
                                },
                                onNavigateToNearbyEvents = { regionKey, label, preloaded ->
                                    navigateTo(Screen.NearbyEvents(regionKey, label, preloaded))
                                },
                                onNavigateToAdvertise = { navigateTo(Screen.AdvertiserEntry) },
                                onNavigateToMyAds = { navigateTo(Screen.AdvertiserDashboard) },
                                onAdClick = { url ->
                                    try {
                                        val intent = android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(url))
                                        context.startActivity(intent)
                                    } catch (_: Exception) { }
                                },
                                openFilterSheetRequest = openFilterSheetWhenHomeAppears,
                                openFilterReturnToMap = openFilterReturnToMap,
                                onConsumedOpenFilterSheetRequest = {
                                    openFilterSheetWhenHomeAppears = false
                                    openFilterReturnToMap = false
                                },
                                onLogout = {
                                    settings.putString("userId", "")
                                    settings.putString("authToken", "")
                                    userId = ""
                                    authToken = ""
                                    isAdmin = false
                                    settings.setBoolean("isAdmin", false)
                                    settings.setBoolean("isAdultConfirmed", false)
                                    settings.setBoolean("locationConsentAccepted", false)
                                    settings.setBoolean("onboardingCompleted", false)
                                    currentScreen = Screen.Login
                                }
                            )
                            is Screen.Map -> MapScreen(
                                service = service,
                                initialPlaces = screen.initialPlaces,
                                useInitialAsAuthoritative = screen.useInitialAsAuthoritative,
                                filterSummary = screen.filterSummary,
                                filteredPlaygrounds = screen.filteredPlaygrounds,
                                userLat = userLat,
                                userLng = userLng,
                                onPlaygroundClick = { navigateTo(Screen.PlaygroundDetail(it)) },
                                onAddPlaygroundAt = { lat, lng ->
                                    navigateTo(
                                        Screen.EditPlayground(
                                            Playground(latitude = lat, longitude = lng),
                                        ),
                                    )
                                },
                                onOpenFilters = if (screen.filteredPlaygrounds != null) {
                                    {
                                        openFilterReturnToMap = true
                                        openFilterSheetWhenHomeAppears = true
                                        navigateBack()
                                    }
                                } else null,
                                onPromotedMapPinUrl = { url ->
                                    try {
                                        val intent = android.content.Intent(
                                            android.content.Intent.ACTION_VIEW,
                                            android.net.Uri.parse(url),
                                        )
                                        context.startActivity(intent)
                                    } catch (_: Exception) {}
                                },
                            )
                            is Screen.NearbyEvents -> NearbyEventsCalendarScreen(
                                playgroundService = service,
                                regionKey = screen.regionKey,
                                regionLabel = screen.regionLabel,
                                userLat = userLat,
                                userLng = userLng,
                                preloadedInlineListingAds = screen.preloadedInlineListingAds,
                                onAdClick = { url ->
                                    try {
                                        val intent = android.content.Intent(
                                            android.content.Intent.ACTION_VIEW,
                                            android.net.Uri.parse(url),
                                        )
                                        context.startActivity(intent)
                                    } catch (_: Exception) {}
                                },
                                onAdvertise = { navigateTo(Screen.AdvertiserEntry) },
                            )
                            is Screen.PlaygroundList -> PlaygroundListScreen(
                                service = service,
                                initialPlaces = screen.initialPlaces,
                                useInitialAsAuthoritative = screen.useInitialAsAuthoritative,
                                filterSummary = screen.filterSummary,
                                userLat = userLat,
                                userLng = userLng,
                                onPlaygroundClick = { navigateTo(Screen.PlaygroundDetail(it)) },
                                onAddClick = { navigateTo(Screen.EditPlayground(Playground())) },
                                onNavigateToAdvertise = { navigateTo(Screen.AdvertiserEntry) },
                                onOpenFilters = if (screen.useInitialAsAuthoritative) {
                                    {
                                        openFilterSheetWhenHomeAppears = true
                                        navigateBack()
                                    }
                                } else null,
                            )
                            is Screen.SearchResults -> PlaygroundListScreen(
                                service = service,
                                initialPlaces = screen.response.places,
                                useInitialAsAuthoritative = true,
                                filterSummary = "Search results",
                                userLat = userLat,
                                userLng = userLng,
                                onPlaygroundClick = { navigateTo(Screen.PlaygroundDetail(it)) },
                                onAddClick = { navigateTo(Screen.EditPlayground(Playground())) },
                                onNavigateToAdvertise = { navigateTo(Screen.AdvertiserEntry) },
                                onOpenFilters = {
                                    openFilterSheetWhenHomeAppears = true
                                    navigateBack()
                                },
                            )
                            is Screen.PlaygroundDetail -> PlaygroundDetailScreen(
                                service = service,
                                playground = screen.playground,
                                userId = userId,
                                userLat = userLat,
                                userLng = userLng,
                                onEditClick = { navigateTo(Screen.EditPlayground(it)) },
                                onNavigateToSupportTicket = { placeId ->
                                    if (placeId != null) navigateTo(Screen.SupportTicketForPlace(placeId))
                                    else navigateTo(Screen.SupportTicket)
                                },
                                onNavigateToMap = { pg ->
                                    navigateTo(
                                        Screen.Map(
                                            filteredPlaygrounds = listOf(pg),
                                            filterSummary = pg.name,
                                        ),
                                    )
                                }
                            )
                            is Screen.EditPlayground -> AddEditPlaygroundScreen(
                                service = service,
                                playgroundToEdit = screen.playground,
                                onComplete = { navigateBack() },
                                launchImagePicker = { imagePickerLauncher.launch("image/*") },
                                pendingImageBatch = pendingImageBatch,
                                onImageBatchConsumed = { pendingImageBatch = null },
                            )
                            is Screen.Favorites -> FavoritesScreen(
                                service = service,
                                userId = userId,
                                userLat = userLat,
                                userLng = userLng,
                                onPlaygroundClick = { navigateTo(Screen.PlaygroundDetail(it)) },
                            )
                            is Screen.MySubmissions -> MySubmissionsScreen(service = service)
                            is Screen.PlayLists -> PlayListsScreen(service, userId, onListClick = { id, name -> navigateTo(Screen.PlayListDetail(id, name)) }, onFavoritesClick = { navigateTo(Screen.Favorites) })
                            is Screen.PlayListDetail -> PlayListDetailScreen(
                                service = service,
                                listId = screen.id,
                                listName = screen.name,
                                userLat = userLat,
                                userLng = userLng,
                                onPlaygroundClick = { navigateTo(Screen.PlaygroundDetail(it)) },
                                onDeleteList = { navigateBack() },
                            )
                            is Screen.AdminQueue -> AdminQueueScreen(
                                service = service,
                                onItemClick = { navigateTo(Screen.AdminDetail(it)) },
                                onNavigateToSupportQueue = { navigateTo(Screen.AdminSupportQueue) }
                            )
                            is Screen.AdminDetail -> AdminDetailScreen(service, screen.id, onComplete = { navigateBack() })
                            is Screen.AdminSupportQueue -> org.community.playgroundfinder.ui.screens.admin.SupportQueueScreen(
                                service = service,
                                onItemClick = { navigateTo(Screen.AdminSupportDetail(it)) }
                            )
                            is Screen.AdminSupportDetail -> org.community.playgroundfinder.ui.screens.admin.SupportDetailScreen(
                                service = service,
                                ticketId = screen.id,
                                onComplete = { navigateBack() }
                            )
                            is Screen.SupportTicket -> org.community.playgroundfinder.ui.screens.SupportTicketScreen(
                                service = service
                            ) {
                                navigateBack()
                            }
                            is Screen.SupportTicketForPlace -> org.community.playgroundfinder.ui.screens.SupportTicketScreen(
                                service = service,
                                initialPlaceId = screen.placeId,
                                initialTicketType = "CONTENT_ISSUE"
                            ) {
                                navigateBack()
                            }
                            is Screen.AdminHub -> AdminHubScreen(
                                service = service,
                                onNavigateToModerationQueue = { navigateTo(Screen.AdminQueue) },
                                onNavigateToSupportQueue = { navigateTo(Screen.AdminSupportQueue) },
                                onNavigateToSeedReview = { navigateTo(Screen.SeedReview) },
                                onNavigateToAnalytics = { navigateTo(Screen.AdminAnalytics) },
                                onNavigateToLeaderboard = { navigateTo(Screen.AdminLeaderboard) },
                                onNavigateToRegionSwitcher = { navigateTo(Screen.AdminRegionSwitcher) },
                                onNavigateToAdReviewQueue = { navigateTo(Screen.AdReviewQueue) },
                                onNavigateToDiscountHub = { navigateTo(Screen.AdminDiscountHub) },
                                onNavigateToCampaignManagement = { navigateTo(Screen.AdminCampaignManagement) },
                                onNavigateToRegionMaintenance = { navigateTo(Screen.AdminRegionMaintenance) },
                                showDevApiEndpointTile = BuildConfig.DEBUG,
                                onNavigateToDevApiEndpoint = { navigateTo(Screen.DevApiEndpoint) },
                            )
                            is Screen.DevApiEndpoint -> org.community.playgroundfinder.ui.screens.admin.DevApiEndpointScreen(
                                settings = settings,
                                gradleDefaultUrl = BuildConfig.SERVER_BASE_URL,
                                showTestProdQuickSwitch = BuildConfig.DEBUG,
                                onPersistOverride = { v -> DevServerBaseOverride.applyAndPersist(settings, v) },
                                onBack = { navigateBack() },
                            )
                            is Screen.AdminBulkTools -> AdminBulkToolsScreen(service = service)
                            is Screen.AdminRegionMaintenance -> org.community.playgroundfinder.ui.screens.admin.AdminRegionMaintenanceScreen(
                                service = service,
                                onOpenRegionSwitcher = { navigateTo(Screen.AdminRegionSwitcher) },
                                onOpenMergeTools = { navigateTo(Screen.AdminBulkTools) },
                                onOpenSeedReview = { navigateTo(Screen.SeedReview) },
                                onBack = { navigateBack() },
                            )
                            is Screen.AdminAnalytics -> AdminAnalyticsScreen(service = service)
                            is Screen.AdminRegionSwitcher -> AdminRegionSwitcherScreen(
                                service = service,
                                onRegionSelected = { region ->
                                    navigateTo(Screen.RegionPlaygrounds(
                                        regionKey = region.regionKey,
                                        regionLabel = "${region.city}, ${region.state}"
                                    ))
                                },
                                onNavigateBack = { navigateBack() }
                            )
                            is Screen.RegionPlaygrounds -> {
                                val rp = screen as Screen.RegionPlaygrounds
                                RegionPlaygroundsScreen(
                                    service = service,
                                    regionKey = rp.regionKey,
                                    userLat = userLat,
                                    userLng = userLng,
                                    onPlaygroundClick = { navigateTo(Screen.PlaygroundDetail(it)) },
                                )
                            }
                            is Screen.SeedReview -> SeedReviewScreen(
                                service = service,
                                onComplete = { navigateBack() }
                            )

                            is Screen.AdvertiserEntry -> AdvertiserEntryScreen(
                                onNavigateToBusinessInfo = { navigateTo(Screen.BusinessInfo) }
                            )
                            is Screen.BusinessInfo -> BusinessInfoScreen(
                                playgroundService = service,
                                onSubmissionCreated = { submissionId, regionKey ->
                                    navigateTo(Screen.PackageSelection(submissionId, regionKey))
                                },
                                onBack = { navigateBack() }
                            )
                            is Screen.PackageSelection -> {
                                val s = screen as Screen.PackageSelection
                                PackageSelectionScreen(
                                    playgroundService = service,
                                    submissionId = s.submissionId,
                                    regionKey = s.regionKey,
                                    onPackageSelected = { navigateTo(Screen.CreativeContent(s.submissionId)) },
                                    onBack = { navigateBack() }
                                )
                            }
                            is Screen.CreativeContent -> {
                                val sid = (screen as Screen.CreativeContent).submissionId
                                CreativeContentScreen(
                                    playgroundService = service,
                                    submissionId = sid,
                                    onCreativeSubmitted = { navigateTo(Screen.AdPreview(sid)) },
                                    onBack = {
                                        // Only clear ad image bytes when leaving the creative step backward
                                        adImageBytes = null
                                        adImageName = null
                                        adImageDirectBatch = null
                                        navigateBack()
                                    },
                                    selectedImageBytes = adImageBytes,
                                    selectedImageName = adImageName,
                                    onPickImage = { adImagePickerLauncher.launch("image/*") },
                                    onImageUploadComplete = {
                                        adImageBytes = null
                                        adImageName = null
                                    },
                                    pendingDirectImageBatch = adImageDirectBatch,
                                    onDirectBatchConsumed = { adImageDirectBatch = null },
                                )
                            }
                            is Screen.AdPreview -> {
                                val sid = (screen as Screen.AdPreview).submissionId
                                AdPreviewScreen(
                                    playgroundService = service,
                                    submissionId = sid,
                                    onContinueToTerms = { navigateTo(Screen.Terms(sid)) },
                                    onBack = { navigateBack() }
                                )
                            }
                            is Screen.Terms -> {
                                val sid = (screen as Screen.Terms).submissionId
                                TermsScreen(
                                    playgroundService = service,
                                    submissionId = sid,
                                    onTermsAccepted = { navigateTo(Screen.Payment(sid)) },
                                    onBack = { navigateBack() }
                                )
                            }
                            is Screen.Payment -> {
                                val sid = (screen as Screen.Payment).submissionId
                                // Set up the payment result callback to update state
                                DisposableEffect(sid) {
                                    activity.paymentResultCallback = { result ->
                                        currentPaymentResult = result
                                    }
                                    onDispose {
                                        activity.paymentResultCallback = null
                                        currentPaymentResult = null
                                    }
                                }
                                PaymentScreen(
                                    playgroundService = service,
                                    submissionId = sid,
                                    onSubmissionWithdrawn = { navigateBack() },
                                    onConfirmPayment = { clientSecret ->
                                        if (AppConfig.stripePublishableKey.isBlank()) {
                                            currentPaymentResult = PaymentResult.Error("Stripe is not configured. Set STRIPE_PUBLISHABLE_KEY in local.properties.")
                                        } else if (clientSecret.isBlank()) {
                                            currentPaymentResult = PaymentResult.Error("Missing payment client secret from server.")
                                        } else {
                                            val cfg = PaymentSheet.Configuration(
                                                merchantDisplayName = "PlayPlace Finder",
                                            )
                                            // SetupIntent secrets look like seti_…_secret_…; PaymentIntent like pi_…_secret_…
                                            if (clientSecret.startsWith("seti_")) {
                                                activity.paymentSheet.presentWithSetupIntent(clientSecret, cfg)
                                            } else {
                                                activity.paymentSheet.presentWithPaymentIntent(clientSecret, cfg)
                                            }
                                        }
                                    },
                                    onPaymentComplete = { completeAdSubmissionAndShowStatus(sid) },
                                    onBack = { navigateBack() },
                                    paymentResult = currentPaymentResult,
                                )
                            }
                            is Screen.SubmissionStatus -> {
                                val sid = (screen as Screen.SubmissionStatus).submissionId
                                SubmissionStatusScreen(
                                    playgroundService = service,
                                    submissionId = sid,
                                    onNavigateToDashboard = { navigateTo(Screen.AdvertiserDashboard) },
                                    onSubmissionRemoved = { navigateBack() },
                                    onBack = { navigateBack() }
                                )
                            }
                            is Screen.AdvertiserDashboard -> AdvertiserDashboardScreen(
                                playgroundService = service,
                                onNavigateToAdvertise = { navigateTo(Screen.AdvertiserEntry) },
                                onRenew = { submissionId, regionKey ->
                                    navigateTo(Screen.PackageSelection(submissionId, regionKey))
                                },
                                onBack = { navigateBack() }
                            )
                            is Screen.AdReviewQueue -> AdReviewQueueScreen(
                                playgroundService = service,
                                onItemClick = { submissionId -> navigateTo(Screen.AdSubmissionReview(submissionId)) },
                                onBack = { navigateBack() }
                            )
                            is Screen.AdSubmissionReview -> {
                                val sid = (screen as Screen.AdSubmissionReview).submissionId
                                AdSubmissionDetailScreen(
                                    playgroundService = service,
                                    submissionId = sid,
                                    onComplete = { navigateBack() },
                                    onBack = { navigateBack() }
                                )
                            }
                            is Screen.AdminDiscountHub -> AdminDiscountHubScreen(
                                playgroundService = service,
                                onBack = { navigateBack() },
                            )
                            is Screen.AdminCampaignManagement -> AdminCampaignManagementScreen(
                                service = service,
                                onBack = { navigateBack() },
                            )
                            is Screen.AdminLeaderboard -> AdminLeaderboardScreen(
                                service = service,
                            )
                            else -> {
                                // Safety fallback for unknown screen states
                                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                                    Text("Loading...")
                                }
                            }
                        }
                }
            }
        }
    }
}

@Composable
fun PlaygroundListScreen(
    service: PlaygroundService,
    initialPlaces: List<Playground> = emptyList(),
    useInitialAsAuthoritative: Boolean = false,
    filterSummary: String? = null,
    onPlaygroundClick: (Playground) -> Unit,
    onAddClick: () -> Unit,
    onNavigateToAdvertise: () -> Unit = {},
    /** When non-null on filtered / home-driven lists, show a filter control that returns to Home and opens the filter sheet. */
    onOpenFilters: (() -> Unit)? = null,
    adFree: Boolean = false,
    userLat: Double? = null,
    userLng: Double? = null,
) {
    val settings = rememberSettings()
    var playgrounds by remember { mutableStateOf(initialPlaces) }
    var isLoading by remember { mutableStateOf(false) }
    var isLoadingMore by remember { mutableStateOf(false) }
    var nextCursor by remember { mutableStateOf<String?>(null) }
    var sponsoredBusiness by remember { mutableStateOf<Map<String, Any?>?>(null) }
    /** Paid + house inline creatives from `/ads/all` (same rule as Home carousel). */
    var inlineListingAds by remember { mutableStateOf<List<AdCreativePayload>>(emptyList()) }
    var listMembership by remember { mutableStateOf<Map<String, List<Pair<String, String?>>>>(emptyMap()) }
    val scope = rememberCoroutineScope()
    var listCityIdState by remember {
        mutableStateOf(
            initialPlaces.firstOrNull { !it.regionKey.isNullOrBlank() }?.regionKey
                ?: settings.getString("home_ads_region_key", "").trim().takeIf { it.isNotBlank() },
        )
    }
    LaunchedEffect(playgrounds) {
        val fromPg = playgrounds.firstOrNull { !it.regionKey.isNullOrBlank() }?.regionKey?.trim()?.takeIf { it.isNotBlank() }
        if (fromPg != null) {
            listCityIdState = fromPg
            try {
                settings.putString("home_ads_region_key", fromPg)
            } catch (_: Exception) {}
        } else if (listCityIdState == null) {
            val s = settings.getString("home_ads_region_key", "").trim().takeIf { it.isNotBlank() }
            if (s != null) listCityIdState = s
        }
    }
    // All Sites uses initial list as authoritative — rows may omit regionKey; resolve from GPS like Home.
    LaunchedEffect(useInitialAsAuthoritative, adFree, userLat, userLng) {
        if (!useInitialAsAuthoritative || adFree) return@LaunchedEffect
        if (listCityIdState != null) return@LaunchedEffect
        val lat = userLat ?: return@LaunchedEffect
        val lng = userLng ?: return@LaunchedEffect
        try {
            val r = service.searchRegionAtCoordinates(lat, lng)
            val k = r.regionKey.trim().takeIf { it.isNotBlank() } ?: return@LaunchedEffect
            listCityIdState = k
            try {
                settings.putString("home_ads_region_key", k)
            } catch (_: Exception) {}
        } catch (_: Exception) {}
    }
    val listCityId = listCityIdState
    fun distanceForSort(pg: Playground): Double {
        return if (userLat != null && userLng != null && pg.latitude != 0.0 && pg.longitude != 0.0) {
            haversineMeters(userLat, userLng, pg.latitude, pg.longitude)
        } else {
            pg.distanceMeters ?: Double.MAX_VALUE
        }
    }

    // Load more pages for infinite scroll
    fun loadMore() {
        if (isLoadingMore || nextCursor == null) return
        scope.launch {
            isLoadingMore = true
            try {
                val resp = service.getAllPlaygrounds(cursor = nextCursor)
                val combined = playgrounds + resp.data
                // Re-sort entire list by distance
                playgrounds = combined.sortedBy { pg -> distanceForSort(pg) }
                nextCursor = resp.nextCursor
            } catch (_: Exception) {} finally { isLoadingMore = false }
        }
    }

    LaunchedEffect(Unit) {
        if (useInitialAsAuthoritative) {
            playgrounds = initialPlaces.sortedBy { pg -> distanceForSort(pg) }
            isLoading = false
            nextCursor = null
            return@LaunchedEffect
        }
        // Always fetch the full list — initialPlaces is just a preview from the home screen
        isLoading = initialPlaces.isEmpty()
        try {
            val resp = service.getAllPlaygrounds()
            val all = resp.data
            nextCursor = resp.nextCursor
            playgrounds = all.sortedBy { pg -> distanceForSort(pg) }
        } catch (e: Exception) {
            // If fetch fails and we have initial places, keep showing those
            if (initialPlaces.isNotEmpty() && playgrounds.isEmpty()) {
                playgrounds = initialPlaces.sortedBy { pg -> distanceForSort(pg) }
            }
        } finally { isLoading = false }
    }

    // Fetch user list membership for chips
    LaunchedEffect(Unit) {
        scope.launch {
            try {
                val lists = service.getLists()
                val map = mutableMapOf<String, MutableList<Pair<String, String?>>>()
                lists.forEach { list ->
                    try {
                        val detail = service.getListDetail(list.id)
                        detail.places.forEach { place ->
                            val pid = place.id ?: return@forEach
                            map.getOrPut(pid) { mutableListOf() }.add(list.name to list.color)
                        }
                    } catch (_: Exception) {}
                }
                listMembership = map
            } catch (_: Exception) {}
        }
    }

    // Inline listing campaigns (same source as home carousel) when we know a region key
    LaunchedEffect(listCityId, adFree) {
        if (adFree || listCityId.isNullOrBlank()) {
            inlineListingAds = emptyList()
        } else {
            inlineListingAds = try {
                val r = service.getAllAds(listCityId, "inline_listing")
                if (r.type == "paid" || r.type == "house") r.ads else emptyList()
            } catch (_: Exception) {
                emptyList()
            }
        }
    }

    // Fetch one nearby sponsor if not ad-free (fallback when no paid inline).
    // Prefer searched/list location, then fall back to device location.
    LaunchedEffect(adFree, userLat, userLng, playgrounds) {
        val anchor = playgrounds.firstOrNull()
        val anchorLat = anchor?.latitude?.takeIf { it != 0.0 } ?: userLat
        val anchorLng = anchor?.longitude?.takeIf { it != 0.0 } ?: userLng
        if (!adFree && anchorLat != null && anchorLng != null) {
            try {
                val sponsors = service.getNearbySponsors(anchorLat, anchorLng)
                sponsoredBusiness = sponsors.firstOrNull()
            } catch (_: Exception) {}
        }
    }
    val context = LocalContext.current

    Box(modifier = Modifier.fillMaxSize()) {
        if (isLoading) {
            CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
        } else {
            LazyColumn(modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp)) {
                if (!filterSummary.isNullOrBlank()) {
                    item {
                        FilterSummaryBanner(
                            summary = filterSummary,
                            modifier = Modifier.fillMaxWidth(),
                        )
                        Spacer(modifier = Modifier.height(12.dp))
                    }
                }
                itemsIndexed(playgrounds) { index, playground ->
                    // Sponsored rows every 6 organic items (first break after five listings: index 5, 11, …)
                    val inlineSlot = index >= 5 && (index - 5) % 6 == 0
                    if (inlineSlot && !adFree) {
                        val slotOrdinal = (index - 5) / 6
                        val cityForTrack = listCityId.orEmpty()
                        val ads = inlineListingAds
                        when {
                            ads.isNotEmpty() -> {
                                val creative = ads[slotOrdinal % ads.size]
                                LaunchedEffect(creative.id, slotOrdinal, cityForTrack) {
                                    if (cityForTrack.isNotBlank()) {
                                        try {
                                            service.trackAdEvent(
                                                type = "impression",
                                                adId = creative.id,
                                                campaignId = creative.campaignId ?: "",
                                                cityId = cityForTrack,
                                                placement = "inline_listing",
                                            )
                                        } catch (_: Exception) {}
                                    }
                                }
                                val title = creative.eventName?.takeIf { it.isNotBlank() }
                                    ?: creative.businessName.ifBlank { creative.headline }
                                SponsoredListingCard(
                                    businessName = title,
                                    category = creative.businessCategory.takeIf { it.isNotBlank() },
                                    description = creative.body.takeIf { it.isNotBlank() },
                                    websiteUrl = creative.ctaUrl.takeIf { it.isNotBlank() },
                                    imageUrl = creative.imageUrl?.takeIf { it.isNotBlank() },
                                    onLearnMore = { url: String ->
                                        scope.launch {
                                            try {
                                                if (cityForTrack.isNotBlank()) {
                                                    service.trackAdEvent(
                                                        type = "click",
                                                        adId = creative.id,
                                                        campaignId = creative.campaignId ?: "",
                                                        cityId = cityForTrack,
                                                        placement = "inline_listing",
                                                    )
                                                }
                                            } catch (_: Exception) {}
                                            runCatching {
                                                val intent = android.content.Intent(
                                                    android.content.Intent.ACTION_VIEW,
                                                    android.net.Uri.parse(url),
                                                )
                                                context.startActivity(intent)
                                            }
                                        }
                                    },
                                    isEvent = creative.isEvent,
                                    eventDate = creative.eventDate,
                                    isRecurring = creative.isRecurring,
                                    userLat = userLat,
                                    userLng = userLng,
                                    businessLat = creative.businessLat.takeIf { it != 0.0 },
                                    businessLng = creative.businessLng.takeIf { it != 0.0 },
                                    showDistance = creative.showDistance,
                                    matchCarouselMinHeight = false,
                                    showCategory = false,
                                    imageContentScale = ContentScale.Fit,
                                    useSplitLayout = true,
                                    onAdvertiseWithUs = onNavigateToAdvertise,
                                )
                            }
                            sponsoredBusiness != null -> {
                                val biz = sponsoredBusiness!!
                                SponsoredListingCard(
                                    businessName = biz["name"] as? String ?: "",
                                    category = biz["category"] as? String,
                                    description = biz["description"] as? String,
                                    websiteUrl = biz["websiteUrl"] as? String,
                                    onLearnMore = { url: String ->
                                        runCatching {
                                            val intent = android.content.Intent(
                                                android.content.Intent.ACTION_VIEW,
                                                android.net.Uri.parse(url),
                                            )
                                            context.startActivity(intent)
                                        }
                                    },
                                    matchCarouselMinHeight = false,
                                    showCategory = false,
                                    imageContentScale = ContentScale.Fit,
                                    useSplitLayout = true,
                                    onAdvertiseWithUs = onNavigateToAdvertise,
                                )
                            }
                            else -> {
                                SponsoredListingCard(
                                    businessName = "Happy Feet Dance Studio",
                                    category = "Kids Activities",
                                    description = "Ballet, hip-hop & creative movement for ages 2–12. First class free!",
                                    websiteUrl = null,
                                    onLearnMore = {},
                                    isSample = true,
                                    onSampleTap = onNavigateToAdvertise,
                                    matchCarouselMinHeight = false,
                                    showCategory = false,
                                    useSplitLayout = true,
                                )
                            }
                        }
                        Spacer(modifier = Modifier.height(16.dp))
                    }
                    PlaygroundItem(playground, userLat = userLat, userLng = userLng, listNames = listMembership[playground.id] ?: emptyList(), onClick = { onPlaygroundClick(playground) })
                    Spacer(modifier = Modifier.height(16.dp))

                    // Trigger loading more when near the end of the list
                    if (!useInitialAsAuthoritative && index >= playgrounds.size - 5 && nextCursor != null && !isLoadingMore) {
                        LaunchedEffect(nextCursor) { loadMore() }
                    }
                }

                // Loading more indicator
                if (isLoadingMore) {
                    item {
                        Box(modifier = Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator(modifier = Modifier.size(24.dp))
                        }
                    }
                }
            }
        }

        Column(
            modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp),
            horizontalAlignment = Alignment.End,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (useInitialAsAuthoritative && onOpenFilters != null) {
                FloatingActionButton(
                    onClick = onOpenFilters,
                    containerColor = FormColors.FabSurface,
                    contentColor = FormColors.FabContent,
                ) {
                    Icon(MaterialIcons.Filled.Tune, contentDescription = "Search filters")
                }
            }
            FloatingActionButton(
                onClick = onAddClick,
                containerColor = FormColors.FabSurface,
                contentColor = FormColors.FabContent,
            ) {
                Icon(MaterialIcons.Filled.Add, contentDescription = "Add Playground")
            }
        }
    }
}



@Composable
fun RegionPlaygroundsScreen(
    service: PlaygroundService,
    regionKey: String,
    userLat: Double? = null,
    userLng: Double? = null,
    onPlaygroundClick: (Playground) -> Unit,
) {
    var playgrounds by remember { mutableStateOf<List<Playground>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var errorMsg by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(regionKey) {
        isLoading = true
        errorMsg = null
        try {
            val response = service.getPlaygroundsByRegion(regionKey)
            playgrounds = response.data
        } catch (e: Exception) {
            errorMsg = e.message ?: "Failed to load playgrounds"
        } finally {
            isLoading = false
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        when {
            isLoading -> CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
            errorMsg != null -> Text(
                "Error: $errorMsg",
                color = Color.Red,
                modifier = Modifier.align(Alignment.Center).padding(16.dp)
            )
            playgrounds.isEmpty() -> Text(
                "No playgrounds found for this region.",
                modifier = Modifier.align(Alignment.Center).padding(16.dp)
            )
            else -> {
                val sorted = remember(playgrounds, userLat, userLng) {
                    if (userLat != null && userLng != null) {
                        playgrounds.sortedBy { pg ->
                            if (pg.latitude != 0.0 && pg.longitude != 0.0) {
                                haversineMeters(userLat, userLng, pg.latitude, pg.longitude)
                            } else {
                                Double.MAX_VALUE
                            }
                        }
                    } else {
                        playgrounds
                    }
                }
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(16.dp)
                ) {
                    items(sorted) { playground ->
                        PlaygroundItem(
                            playground,
                            userLat = userLat,
                            userLng = userLng,
                            onClick = { onPlaygroundClick(playground) },
                        )
                        Spacer(modifier = Modifier.height(16.dp))
                    }
                }
            }
        }
    }
}
