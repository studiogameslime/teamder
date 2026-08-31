package io.joryio.sdk.ui

import android.annotation.SuppressLint
import android.app.Activity
import android.app.Dialog
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.net.Uri
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import io.joryio.sdk.models.InAppCampaign
import io.joryio.sdk.models.ButtonAction
import io.joryio.sdk.models.InAppContent
import io.joryio.sdk.models.MessageType

/**
 * Renders an in-app campaign's HTML in a WebView.
 *
 * Mirrors `packages/sdk-web/src/core/inapp.ts` deliberately rather than
 * inventing a second behaviour. That renderer is the proven one - the same
 * documents, authored in the same editor, already display through it on the
 * web - so anywhere the two could differ (bridge method names, per-type
 * placement, URL safety rules) this follows it.
 *
 * The message document is UNTRUSTED in the same sense a web page is: it is
 * authored in the dashboard, but it is arbitrary HTML/JS running inside the
 * host app. So it gets no file access, no ability to navigate the app, and it
 * reaches the SDK only through the four explicit bridge methods below.
 */
internal class InAppMessageRenderer(
    /**
     * Whether HTML in-app messages may run. See
     * JoryioConfig.allowHtmlJsInAppMessages - off by default, because an
     * HTML message executes author-supplied JavaScript inside the host app.
     */
    private val allowHtmlJsInAppMessages: Boolean = false,
) {
    /** Bridge object name. Must match the web SDK and the authored templates. */
    private companion object {
        const val BRIDGE = "joryioBridge"
        const val DEFAULT_MODAL_MARGIN_DP = 24
    }

    private var current: Dialog? = null

    fun isShowing(): Boolean = current?.isShowing == true

    /**
     * Display [campaign] over [activity].
     *
     * @param onEvent impression/click/dismiss, forwarded to the manager for
     *   `/v1/in-app/track`. Called on the main thread.
     * @return false when the campaign carries nothing renderable - the caller
     *   must not count an impression in that case.
     */
    @SuppressLint("SetJavaScriptEnabled")
    fun show(
        activity: Activity,
        campaign: InAppCampaign,
        onEvent: (action: String, meta: Map<String, Any?>) -> Unit,
    ): Boolean {
        val content = campaign.content
        if (content == null) {
            // An empty modal the user must dismiss is worse than no message, and
            // counting an impression for it would inflate the campaign's reach.
            UiLog.warn("Campaign ${campaign.id} has no renderable content; skipping")
            return false
        }

        // `custom` means the HOST app places the content. Rendering our own
        // container would override the very decision the type expresses.
        if (campaign.type == MessageType.CUSTOM) {
            UiLog.debug("Campaign ${campaign.id} is type=custom; host app renders it")
            return false
        }

        // Native content takes an entirely different path: real Android views,
        // no WebView. See InAppNativeView for why that is the point rather than
        // an optimisation.
        if (content is InAppContent.Native) {
            return showNative(activity, campaign, content, onEvent)
        }
        val html = content as InAppContent.Html

        // HTML runs author-supplied JavaScript in this app's process. An app
        // that has not opted in never reaches a WebView at all - and this is a
        // SKIP, not a failure: native campaigns keep displaying, so the channel
        // stays usable rather than becoming all-or-nothing.
        if (!allowHtmlJsInAppMessages) {
            UiLog.warn(
                "Campaign ${campaign.id} is an HTML in-app message, but " +
                    "JoryioConfig.allowHtmlJsInAppMessages is false - not displaying it.",
            )
            return false
        }

        val webView = WebView(activity).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            // No filesystem or content-provider reach from message JS.
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            setBackgroundColor(Color.TRANSPARENT)
            isVerticalScrollBarEnabled = false
            isHorizontalScrollBarEnabled = false
        }

        val dialog = Dialog(activity, android.R.style.Theme_Translucent_NoTitleBar).apply {
            requestWindowFeature(Window.FEATURE_NO_TITLE)
            setContentView(wrap(activity, webView, campaign.type))
            // Back button dismisses, like tapping the backdrop. A message the
            // user cannot escape is a trap, whatever the campaign says.
            setCancelable(true)
            setOnCancelListener { onEvent("dismissed", mapOf("reason" to "back")) }
            window?.apply {
                setBackgroundDrawable(ColorDrawable(backdropColor(campaign.type)))
                setLayout(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT,
                )
                setGravity(gravityFor(campaign.type))
            }
        }

        webView.addJavascriptInterface(
            Bridge(
                campaignId = campaign.id,
                type = campaign.type,
                webView = webView,
                dismiss = { reason ->
                    activity.runOnUiThread {
                        dialog.dismiss()
                        current = null
                        onEvent("dismissed", mapOf("reason" to reason))
                    }
                },
                onEvent = { action, meta -> activity.runOnUiThread { onEvent(action, meta) } },
                openUrl = { url -> activity.runOnUiThread { openExternally(activity, url) } },
            ),
            BRIDGE,
        )

        webView.webViewClient = object : WebViewClient() {
            // Any top-level navigation leaves the message. Hand it to the
            // system browser instead of letting the campaign replace the app UI
            // with an arbitrary page.
            override fun shouldOverrideUrlLoading(
                view: WebView?,
                request: WebResourceRequest?,
            ): Boolean {
                val url = request?.url?.toString() ?: return true
                if (isSafeUrl(url)) {
                    openExternally(activity, url)
                    onEvent("clicked", mapOf("action" to "link", "url" to url))
                }
                return true
            }
        }

        webView.loadDataWithBaseURL(
            null,
            buildDocument(campaign.id, html, campaign.type),
            "text/html",
            "UTF-8",
            null,
        )

        current?.dismiss()
        current = dialog
        dialog.show()
        onEvent("displayed", emptyMap())
        return true
    }

    fun dismiss(reason: String = "programmatic") {
        current?.dismiss()
        current = null
    }


    /**
     * Display structured content using the app's own views.
     *
     * Shares the dialog, placement and backdrop rules with the HTML path -
     * those are properties of the message TYPE, not of its content - and
     * differs only in what goes inside.
     */
    private fun showNative(
        activity: Activity,
        campaign: InAppCampaign,
        content: InAppContent.Native,
        onEvent: (action: String, meta: Map<String, Any?>) -> Unit,
    ): Boolean {
        var dialog: Dialog? = null

        val host = object : InAppNativeView.Host {
            override fun onButton(buttonId: String, action: ButtonAction, url: String?) {
                onEvent("clicked", mapOf("action" to buttonId.ifBlank { "button" }))
                when (action) {
                    ButtonAction.URL, ButtonAction.DEEP_LINK -> url?.let { openExternally(activity, it) }
                    ButtonAction.REQUEST_PUSH_PERMISSION ->
                        // Reflective: joryio-ui must not gain a compile-time
                        // dependency on the base SDK's Joryio class - the split
                        // between the two artifacts is the whole point. The base
                        // SDK is always present at runtime when this renders.
                        requestPushPermission(activity)
                    ButtonAction.DISMISS -> Unit
                }
                // EVERY button dismisses. A message the user has acted on and
                // which stays on screen reads as broken, and an unknown action
                // decodes to DISMISS precisely so a future action type cannot
                // trap someone in a modal.
                dialog?.dismiss()
                current = null
                onEvent("dismissed", mapOf("reason" to "button"))
            }

            override fun onClose(reason: String) {
                dialog?.dismiss()
                current = null
                onEvent("dismissed", mapOf("reason" to reason))
            }
        }

        val body = InAppNativeView.build(activity, content, campaign.type, host)

        val d = Dialog(activity, android.R.style.Theme_Translucent_NoTitleBar).apply {
            requestWindowFeature(Window.FEATURE_NO_TITLE)
            setContentView(wrap(activity, body, campaign.type))
            // Honour the author's choice, but the back button ALWAYS works:
            // backdropDismissible=false must not become "cannot be closed".
            setCancelable(true)
            setCanceledOnTouchOutside(content.backdropDismissible)
            setOnCancelListener { onEvent("dismissed", mapOf("reason" to "back")) }
            window?.apply {
                setBackgroundDrawable(ColorDrawable(backdropColor(campaign.type)))
                setLayout(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT,
                )
                setGravity(gravityFor(campaign.type))
            }
        }
        dialog = d

        current?.dismiss()
        current = d
        d.show()
        onEvent("displayed", emptyMap())
        return true
    }

    // ── Presentation ────────────────────────────────────────────────────────

    /** Placement per type, matching the web renderer. */
    private fun gravityFor(type: MessageType): Int = when (type) {
        MessageType.BANNER -> Gravity.TOP
        MessageType.SLIDEUP -> Gravity.BOTTOM
        else -> Gravity.CENTER
    }

    /**
     * Only the screen-blocking types dim the app behind them. A banner or
     * slide-up that dimmed the screen would read as blocking when its whole
     * point is that the app stays usable.
     */
    private fun backdropColor(type: MessageType): Int = when (type) {
        MessageType.MODAL, MessageType.FULLSCREEN -> Color.argb(102, 0, 0, 0)
        else -> Color.TRANSPARENT
    }

    private fun wrap(activity: Activity, body: View, type: MessageType): View {
        val density = activity.resources.displayMetrics.density
        val margin = (DEFAULT_MODAL_MARGIN_DP * density).toInt()

        return FrameLayout(activity).apply {
            setBackgroundColor(Color.TRANSPARENT)
            val lp = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                if (type == MessageType.FULLSCREEN) {
                    ViewGroup.LayoutParams.MATCH_PARENT
                } else {
                    // Height tracks the content, driven by the bridge's setSize.
                    ViewGroup.LayoutParams.WRAP_CONTENT
                },
            ).apply {
                gravity = gravityFor(type)
                if (type == MessageType.MODAL) {
                    leftMargin = margin
                    rightMargin = margin
                }
            }
            addView(body, lp)
        }
    }

    // ── Document ────────────────────────────────────────────────────────────

    /**
     * Compose the document the WebView loads: the campaign's CSS, its HTML, and
     * a small shim that (a) tags the device class so the editor's "mobile only"
     * / "desktop only" rules resolve, and (b) reports content height back so a
     * non-fullscreen message is exactly as tall as its content.
     */
    private fun buildDocument(campaignId: String, content: InAppContent.Html, type: MessageType): String {
        val cid = jsString(campaignId)
        /*
         * A fresh, unpredictable nonce per message.
         *
         * The server strips <script> and every on* handler before this HTML is
         * sent, so no author JavaScript runs today. The residual risk is a
         * sanitiser bypass, and this WebView has JavaScript enabled because the
         * bootstrap below needs it. The nonce means only that bootstrap can
         * execute - anything that survives sanitisation still cannot.
         *
         * SecureRandom, not Random: a guessable nonce is one an attacker can
         * put on their own injected <script>, which defeats the point entirely.
         */
        val nonce = java.math.BigInteger(128, java.security.SecureRandom()).toString(16)
        return """
            <!DOCTYPE html>
            <html>
            <head>
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-$nonce'; style-src 'unsafe-inline'; img-src https: data:; media-src https: data:; font-src https: data:; connect-src 'none'; form-action 'none'; base-uri 'none'; upgrade-insecure-requests">
            <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
            <style>
              html,body{margin:0;padding:0;background:transparent;}
              /* Responsive by default - see the iOS renderer for why. Before
                 the author stylesheet, so an explicit width still wins. */
              img,video{max-width:100%;height:auto;}
              ${if (type == MessageType.FULLSCREEN) "html,body{height:100%;}" else ""}
            </style>
            <style>${content.css}</style>
            </head>
            <body>
            ${content.html}
            <script nonce="$nonce">
            (function(){
              var CID = $cid;
              // The editor emits jr-vp-* classes for per-device visibility. On
              // mobile the message viewport IS the device, so this is simply the
              // width - unlike web, where the iframe is message-sized and the
              // host page width has to be read instead.
              try {
                document.documentElement.className +=
                  (window.innerWidth <= 480 ? ' jr-vp-mobile' : ' jr-vp-desktop');
              } catch (e) {}

              function report() {
                try {
                  var h = Math.max(
                    document.body ? document.body.scrollHeight : 0,
                    document.documentElement ? document.documentElement.scrollHeight : 0
                  );
                  if (h > 0 && window.$BRIDGE) window.$BRIDGE.setSize(CID, h);
                } catch (e) {}
              }
              window.addEventListener('load', report);
              // Images and web fonts land after load and change the height, so
              // a single measurement would leave the message clipped.
              if (window.ResizeObserver && document.body) {
                new ResizeObserver(report).observe(document.body);
              }
              setTimeout(report, 60);
            })();
            </script>
            </body>
            </html>
        """.trimIndent()
    }

    /**
     * Hand the primer's "yes" to the base SDK, which owns the permission flow.
     *
     * Called by reflection so this UI artifact keeps zero compile-time coupling
     * to `io.joryio.sdk.Joryio`. A failure here is logged and swallowed: the
     * message has already been acted on, and no primer is worth crashing an app.
     */
    private fun requestPushPermission(activity: android.app.Activity) {
        try {
            val joryio = Class.forName("io.joryio.sdk.Joryio")
            val instance = joryio.getMethod("getInstance").invoke(null)
            joryio.getMethod(
                "requestPushPermission",
                android.app.Activity::class.java,
                kotlin.jvm.functions.Function1::class.java,
            ).invoke(instance, activity, null)
        } catch (t: Throwable) {
            UiLog.warn("Could not request push permission: ${t.message}")
        }
    }

    private fun openExternally(activity: Activity, url: String) {
        if (!isSafeUrl(url)) return
        try {
            activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        } catch (e: Exception) {
            UiLog.warn("No activity to open $url: ${e.message}")
        }
    }

    /**
     * http(s) only.
     *
     * Same rule as the web renderer, for the same reason: a campaign document
     * is authored content, and `javascript:`, `data:`, `file:` and `intent:`
     * URLs are how authored content escapes its container. Deep links are
     * deliberately routed through the host app's own click handler rather than
     * being opened here.
     */
    private fun isSafeUrl(url: String): Boolean =
        url.startsWith("http://", ignoreCase = true) || url.startsWith("https://", ignoreCase = true)

    /** JSON-safe string literal for embedding in the shim. */
    private fun jsString(value: String): String =
        "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"").replace("<", "\\u003c") + "\""

    // ── Bridge ──────────────────────────────────────────────────────────────

    /**
     * The ONLY surface message JS can reach. Method names match the web SDK's
     * `joryioBridge` so a template authored once works on both.
     */
    private class Bridge(
        private val campaignId: String,
        private val type: MessageType,
        private val webView: WebView,
        private val dismiss: (String) -> Unit,
        private val onEvent: (String, Map<String, Any?>) -> Unit,
        private val openUrl: (String) -> Unit,
    ) {
        @JavascriptInterface
        fun trackClick(cid: String, action: String?) {
            if (cid != campaignId) return
            onEvent("clicked", mapOf("action" to (action ?: "click")))
        }

        @JavascriptInterface
        fun closeMessage(cid: String) {
            if (cid != campaignId) return
            dismiss("bridge_close")
        }

        @JavascriptInterface
        fun navigate(cid: String, url: String?, target: String?) {
            if (cid != campaignId || url == null) return
            openUrl(url)
        }

        /**
         * Size the container to the content.
         *
         * Fullscreen ignores this - it already fills the screen, and honouring a
         * reported height there would shrink it to its content and leave a
         * dimmed backdrop with a floating strip.
         */
        @JavascriptInterface
        fun setSize(cid: String, height: Int) {
            if (cid != campaignId || height <= 0 || type == MessageType.FULLSCREEN) return
            webView.post {
                val density = webView.resources.displayMetrics.density
                val px = (height * density).toInt()
                val max = (webView.resources.displayMetrics.heightPixels * 0.9).toInt()
                webView.layoutParams = webView.layoutParams?.apply {
                    this.height = minOf(px, max)
                } ?: return@post
                webView.requestLayout()
            }
        }
    }
}
