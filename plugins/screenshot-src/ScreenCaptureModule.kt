// ScreenCaptureModule — captures the *rendered surface* of the current
// activity window via PixelCopy (API 24+) instead of drawing the React view
// hierarchy to a Canvas (what react-native-view-shot does). PixelCopy reads
// the real GPU surface, so it captures hardware-accelerated content that the
// Canvas path renders black/blank: maps, video, GL, and secure-flag views.
//
// Multi-window coverage: PixelCopy on activity.window captures only THAT
// window's surface — a React Native <Modal> (menus, confirm popups, bottom
// sheets) renders as its OWN Dialog window and was previously dropped, so any
// overlay open at screenshot time was missing from the report image. We now
// composite every on-screen app window in z-order: PixelCopy the main window
// (keeps maps/GL/video), then software-draw each overlay window's decorView on
// top at its on-screen position (menus/dialogs are plain views, so a Canvas
// draw renders them correctly, including their in-tree dim scrim). Full GPU
// multi-window coverage would need MediaProjection (a per-session consent
// dialog), which we deliberately avoid.
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
import android.view.View
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
                  // Composite any Dialog/popup windows (RN <Modal>) on top of
                  // the main-window capture so open menus/sheets/confirm popups
                  // ride along instead of being cropped out.
                  compositeOverlayWindows(decor, bitmap)
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
          compositeOverlayWindows(decor, bitmap)
          promise.resolve(encode(bitmap, quality, maxWidth))
        }
      } catch (e: Exception) {
        promise.reject("CAPTURE", e)
      }
    }
  }

  // Draws every OTHER attached app window (dialogs, popup menus, RN <Modal>s)
  // over `base`, in the framework's back-to-front add order, each positioned by
  // its on-screen location relative to the main decor view. Best-effort:
  // reflection failures or a bad window are swallowed so the base capture is
  // still returned. Must run on the UI thread (called from the PixelCopy
  // callback / pre-O path, both already on the main looper).
  private fun compositeOverlayWindows(mainDecor: View, base: Bitmap) {
    val overlays = try {
      collectOverlayDecorViews(mainDecor)
    } catch (e: Throwable) {
      return // WindowManagerGlobal internals unavailable — keep base capture.
    }
    if (overlays.isEmpty()) return
    val canvas = Canvas(base)
    val mainLoc = IntArray(2)
    mainDecor.getLocationOnScreen(mainLoc)
    val loc = IntArray(2)
    for (v in overlays) {
      try {
        v.getLocationOnScreen(loc)
        canvas.save()
        canvas.translate(
          (loc[0] - mainLoc[0]).toFloat(),
          (loc[1] - mainLoc[1]).toFloat(),
        )
        v.draw(canvas)
        canvas.restore()
      } catch (e: Throwable) {
        // Skip a window that won't draw; keep the rest.
      }
    }
  }

  // Reflects WindowManagerGlobal.mViews (the process-wide list of window root
  // views, ordered back-to-front) and returns the visible ones that aren't the
  // main decor view — i.e. the overlay Dialog/popup windows on top of it.
  @Suppress("UNCHECKED_CAST")
  private fun collectOverlayDecorViews(mainDecor: View): List<View> {
    val wmgClass = Class.forName("android.view.WindowManagerGlobal")
    val wmg = wmgClass.getMethod("getInstance").invoke(null)
    val viewsField = wmgClass.getDeclaredField("mViews").apply { isAccessible = true }
    val views = viewsField.get(wmg) as? List<View> ?: return emptyList()
    // Copy first — the live list can mutate on the UI thread mid-iteration.
    return ArrayList(views).filter { v ->
      v !== mainDecor &&
        v.windowToken != null &&
        v.isShown &&
        v.width > 0 &&
        v.height > 0
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
