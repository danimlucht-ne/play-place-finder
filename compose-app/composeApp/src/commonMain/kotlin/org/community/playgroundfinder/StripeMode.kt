package org.community.playgroundfinder

/** True when the embedded Stripe publishable key is a live key (real charges). */
fun isLiveStripePublishableKey(publishableKey: String): Boolean =
    publishableKey.trim().startsWith("pk_live")
