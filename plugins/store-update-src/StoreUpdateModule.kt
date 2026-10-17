package com.studiogameslime.soccerapp.storeupdate

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.install.model.UpdateAvailability

/** Queries Google Play availability for this installation/account/track. Never installs anything. */
class StoreUpdateModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "TeamderStoreUpdate"

  @ReactMethod
  fun check(promise: Promise) {
    try {
      AppUpdateManagerFactory.create(reactApplicationContext).appUpdateInfo
      .addOnSuccessListener { info ->
        val result = Arguments.createMap()
        result.putBoolean("available", info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE)
        result.putInt("versionCode", info.availableVersionCode())
        promise.resolve(result)
      }
      .addOnFailureListener { error -> promise.reject("STORE_UNAVAILABLE", error) }
    } catch (error: Exception) {
      promise.reject("STORE_UNAVAILABLE", error)
    }
  }
}
