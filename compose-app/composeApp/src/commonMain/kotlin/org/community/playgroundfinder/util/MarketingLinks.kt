package org.community.playgroundfinder.util

import org.community.playgroundfinder.AppConfig

/** Canonical paths on the public marketing site (Vercel). Host comes from [AppConfig.marketingSiteBaseUrl]. */
object MarketingLinks {
    private fun base(): String = AppConfig.marketingSiteBaseUrl.trim().trimEnd('/')

    /** Product / pricing page for prospective advertisers (create matching route on the web app). */
    fun advertiserLanding(): String = "${base()}/advertise"

    /** Hosted privacy policy (Play Console / legal; keep in sync with in-app copy or replace app text with a WebView). */
    fun privacyPolicy(): String = "${base()}/privacy"

    /** Hosted terms of service. */
    fun termsOfService(): String = "${base()}/terms"

    /** Public marketing / product home (same host as legal pages). */
    fun playplaceHome(): String = base()

    /** Developer / parent company site (Play Spotter is a Lucht Applications project). */
    fun luchtApplications(): String = "https://www.luchtapplications.com"

    const val SUPPORT_EMAIL: String = "playplacefinder@gmail.com"

    fun mailtoSupport(): String = "mailto:$SUPPORT_EMAIL"
}
