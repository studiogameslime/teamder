// ScreenCaptureModule — captures the *rendered surface* of the current
// activity window via PixelCopy (API 24+) instead of drawing the React view
// hierarchy to a Canvas (what react-native-view-shot does). PixelCopy reads
// the real GPU surface, so it captures hardware-accelerated content that the
// Canvas path renders black/blank: maps, video, GL, and secure-flag views.
//
// Caveat: PixelCopy on activity.window captures only THAT window's surface.
// Content in a separate window — a React Native <Modal> renders as its own
// Dialog window — is NOT included. In-tree overlays/toasts (part of the
// activity's view tree) ARE captured. Full multi-window coverage needs
// MediaProjection (a per-session consent dialog), which we deliberately avoid.
//
// Copied into the generated android/ project by plugins/withScreenCapture.js
// on every prebuild (android/ is gitignored).

package com.studiogameslime.soccerapp.screencapture

import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.view.PixelCopy
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.ByteArrayOutputStream

class ScreenCaptureModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "ScreenCapture"

  // Returns a base64 JPEG (no data: prefix) of the current window, or rejects.
  // quality: 0..1 JPEG quality. maxWidth: downscale target in px (0 = none).
  @ReactMethod
  fun captureFullScreen(quality: Double, maxWidth: Double, promise: Promise) {
    val activity = currentActivity
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "No current activity")
      return
    }
    val window = activity.window
    if (window == null) {
      promise.reject("NO_WINDOW", "No window")
      return
    }
    activity.runOnUiThread {
      try {
        val decor = window.decorView
        val width = decor.width
        val height = decor.height
        if (width <= 0 || height <= 0) {
          promise.reject("NO_SIZE", "View not laid out yet")
          return@runOnUiThread
        }
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          PixelCopy.request(
            window,
            bitmap,
            { result ->
              if (result == PixelCopy.SUCCESS) {
                try {
                  promise.resolve(encode(bitmap, quality, maxWidth))
                } catch (e: Exception) {
                  promise.reject("ENCODE", e)
                }
              } else {
                promise.reject("PIXELCOPY", "PixelCopy failed: $result")
              }
            },
            Handler(Looper.getMainLooper()),
          )
        } else {
          // Pre-O fallback: draw the view hierarchy (no hardware surfaces).
          decor.draw(Canvas(bitmap))
          promise.resolve(encode(bitmap, quality, maxWidth))
        }
      } catch (e: Exception) {
        promise.reject("CAPTURE", e)
      }
    }
  }

  private fun encode(src: Bitmap, quality: Double, maxWidth: Double): String {
    var bmp = src
    if (maxWidth > 0 && src.width > maxWidth) {
      val scale = maxWidth / src.width.toDouble()
      bmp = Bitmap.createScaledBitmap(
        src,
        maxWidth.toInt(),
        (src.height * scale).toInt().coerceAtLeast(1),
        true,
      )
    }
    val out = ByteArrayOutputStream()
    val q = (quality * 100).toInt().coerceIn(1, 100)
    bmp.compress(Bitmap.CompressFormat.JPEG, q, out)
    return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
  }
}
