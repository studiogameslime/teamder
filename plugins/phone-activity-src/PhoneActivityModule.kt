package com.studiogameslime.soccerapp.phoneactivity

import android.content.Intent
import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.*
import com.facebook.react.ReactPackage
import com.facebook.react.uimanager.ViewManager

class PhoneActivityModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    override fun getName() = "PhoneActivity"
    private fun owned(uid: String) {
        if (PhoneActivityService.owner != uid) {
            PhoneActivityService.instance?.finish()
            PhoneActivityService.clear()
            PhoneActivityService.owner = uid
        }
    }
    @ReactMethod fun snapshot(uid: String, promise: Promise) { UiThreadUtil.runOnUiThread {
        owned(uid); promise.resolve(PhoneActivityService.snapshot())
    } }
    @ReactMethod fun start(uid: String, promise: Promise) { UiThreadUtil.runOnUiThread {
        if (uid.isBlank() || currentActivity == null || context.lifecycleState != com.facebook.react.common.LifecycleState.RESUMED) {
            promise.reject("foreground_required", "Open the measurement screen"); return@runOnUiThread
        }
        owned(uid)
        if (PhoneActivityService.running || PhoneActivityService.starting) {
            promise.reject("already_running", "Measurement already started"); return@runOnUiThread
        }
        PhoneActivityService.starting = true
        try {
            context.startForegroundService(Intent(context, PhoneActivityService::class.java).putExtra("owner", uid))
            val handler = Handler(Looper.getMainLooper())
            var attempts = 0
            val check = object : Runnable {
                override fun run() {
                    if (!PhoneActivityService.starting) promise.resolve(PhoneActivityService.snapshot())
                    else if (++attempts < 50) handler.postDelayed(this, 100)
                    else { PhoneActivityService.instance?.finish(); PhoneActivityService.starting = false; promise.reject("timeout", "Service did not start") }
                }
            }
            handler.post(check)
        } catch (_: Exception) { PhoneActivityService.starting = false; promise.reject("start_failed", "Cannot start measurement") }
    } }
    @ReactMethod fun stop(uid: String, promise: Promise) { UiThreadUtil.runOnUiThread {
        owned(uid); PhoneActivityService.instance?.finish(); promise.resolve(PhoneActivityService.snapshot())
    } }
    @ReactMethod fun clear(promise: Promise) { UiThreadUtil.runOnUiThread {
        PhoneActivityService.instance?.finish(); PhoneActivityService.clear(); promise.resolve(null)
    } }
}
class PhoneActivityPackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(PhoneActivityModule(context))
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
