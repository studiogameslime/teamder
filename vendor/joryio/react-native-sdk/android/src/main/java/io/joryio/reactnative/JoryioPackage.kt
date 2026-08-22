package io.joryio.reactnative

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * React Native package that registers the Joryio native module.
 *
 * Add to MainApplication.kt:
 * ```kotlin
 * override fun getPackages() = PackageList(this).packages.apply {
 *     add(JoryioPackage())
 * }
 * ```
 */
class JoryioPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        return listOf(JoryioModule(reactContext))
    }

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
        return emptyList()
    }
}
