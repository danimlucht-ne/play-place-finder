package org.community.playgroundfinder

import android.app.Application
import android.content.Context
import coil3.ImageLoader
import coil3.SingletonImageLoader
import coil3.network.ktor3.KtorNetworkFetcherFactory
import coil3.request.crossfade

/**
 * Supplies Coil's default [ImageLoader] with the Ktor network fetcher so HTTPS playground photos load.
 * Coil discovers [SingletonImageLoader.Factory] on the application class automatically.
 */
class PlaygroundFinderApplication : Application(), SingletonImageLoader.Factory {

    override fun newImageLoader(context: Context): ImageLoader {
        return ImageLoader.Builder(context)
            .components {
                add(KtorNetworkFetcherFactory())
            }
            .crossfade(true)
            .build()
    }
}
