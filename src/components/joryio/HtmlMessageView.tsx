// HtmlMessageView — draws an `html` Joryio in-app campaign inside a WebView.
//
// WHY THIS EXISTS. The SDK's own web view never runs in React Native: the
// moment the host subscribes to onInAppMessage, native rendering is handed over
// to us. So an html campaign arrived, InAppMessageHost had nothing to draw it
// with, and it was logged and dropped — the campaign read as delivered and
// showed nobody anything. The dashboard's own advice for this ("turn on
// allowHtmlJsInAppMessages") is the wrong lever here: that flag describes the
// native SDK's views, which are exactly the ones that stopped running. What
// declares an RN app's ability is `capabilities` on onInAppMessage, and it can
// only honestly say `content.html` once something like this file exists.
//
// The document, the CSP and the `joryioBridge` surface are copied from the
// SDK's InAppWebMessageView / InAppMessageRenderer on purpose: a template the
// marketer authors once has to behave the same on web, Android, iOS and here.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, Linking, StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

/**
 * Author markup cannot execute. This policy is the ONLY thing stopping it.
 *
 * ⚠️ An earlier version of this comment said the server strips `<script>` and
 * every on* handler, and that this policy merely covered a sanitiser bypass.
 * It is not true: a campaign whose html carries `<script>`, `onclick` and
 * `onerror` stores and returns all three untouched (checked against the live
 * API, 2026-09-17). The dashboard is an unsanitised HTML pipe into this
 * WebView, and `script-src 'none'` is the whole of the defence.
 *
 * Which is why it stays. The document arrives from a marketing dashboard with
 * no code review between there and a user's phone, and it shares a JS world
 * with the shim below — author code could call `ReactNativeWebView.postMessage`
 * directly, forge a click, or fire a `footy://` deep link. `img-src https:` is
 * open by necessity, so script plus an image URL is an exfiltration channel.
 *
 * If an authored template ever needs to DO something (collect a form, say),
 * the lever is a new method on the shim — a capability we write and understand
 * — not `unsafe-inline`, which hands the dashboard arbitrary execution inside
 * the app. Identical to the SDK's policy, so a template that renders on web
 * renders here.
 */
const CSP =
  "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; " +
  "img-src https: data:; media-src https: data:; font-src https: data:; " +
  "connect-src 'none'; form-action 'none'; base-uri 'none'; upgrade-insecure-requests";

/** The shim runs BEFORE the document, injected by the WebView rather than
 *  written into the page — a <script> tag would be blocked by the very CSP
 *  above, which is the point. Same method names as the web SDK's bridge. */
function shim(campaignId: string, fullscreen: boolean): string {
  const cid = JSON.stringify(campaignId);
  return `(function(){
  var CID = ${cid};
  function post(method, args){
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        method: method, campaignId: CID, args: args || {}
      }));
    } catch (e) {}
  }
  try {
    document.documentElement.className +=
      (window.innerWidth <= 480 ? ' jr-vp-mobile' : ' jr-vp-desktop');
  } catch (e) {}
  window.joryioBridge = {
    trackClick: function(cid, action){ post('trackClick', { action: action }); },
    closeMessage: function(){ post('closeMessage', {}); },
    navigate: function(cid, url, target){ post('navigate', { url: url, target: target }); },
    setSize: function(cid, h){ post('setSize', { height: h }); }
  };

  // ── Fields out, without the document running a line of its own ──────────
  //
  // The author cannot script: script-src is 'none' and that is the only thing
  // standing between a marketing dashboard and arbitrary code inside the app.
  // So the document DECLARES and this shim ACTS. Markup says
  // a data-action attribute, and the behaviour belongs to us — one capability
  // we wrote and understand, rather than handing over execution.
  function collect(){
    var out = {};
    try {
      var els = document.querySelectorAll('[name]');
      for (var i = 0; i < els.length; i++) {
        var el = els[i], n = el.getAttribute('name');
        if (!n) continue;
        var t = (el.getAttribute('type') || '').toLowerCase();
        if (t === 'radio') { if (el.checked) out[n] = el.value || el.id || true; }
        else if (t === 'checkbox') { out[n] = !!el.checked; }
        else { out[n] = el.value; }
      }
    } catch (e) {}
    return out;
  }
  document.addEventListener('click', function(e){
    var t = e.target;
    // closest() so a tap on the label's own <b> still counts as the button.
    var el = t && t.closest ? t.closest('[data-action]') : null;
    if (!el) return;
    var a = el.getAttribute('data-action');
    if (a === 'go') {
      // Step navigation. It CANNOT be a label: the delivery pipeline strips
      // the for attribute off every label, so a CSS-only wizard walks
      // nowhere on a real device. Verified on an emulator — labels[for] came
      // back as 0 while the radios themselves survived.
      var target = document.getElementById(el.getAttribute('data-go') || '');
      if (target) target.checked = true;
    } else if (a === 'pick') {
      // The same problem for a choice: tick the named radio ourselves.
      var nm = el.getAttribute('data-name'), vl = el.getAttribute('data-value');
      var opts = document.getElementsByName(nm || '');
      for (var j = 0; j < opts.length; j++) {
        if (opts[j].value === vl) { opts[j].checked = true; break; }
      }
      var nx = el.getAttribute('data-go');
      if (nx) { var n2 = document.getElementById(nx); if (n2) n2.checked = true; }
    } else if (a === 'open') {
      // And anchors are stripped too, so a CTA that leaves the message asks
      // the host to do it.
      post('navigate', { url: el.getAttribute('data-url') || '' });
    } else if (a === 'submit') { post('submit', { fields: collect() }); }
    else if (a === 'share') { post('share', {}); }
    else return;
    e.preventDefault();
  }, true);

  // Values only the app knows — the signed-in person's invite link, their
  // name. Filled into the data-var elements once the host sends them, since
  // them are a network round-trip away and the document has already painted.
  window.__tdFill = function(vars){
    try {
      Object.keys(vars).forEach(function(k){
        var nodes = document.querySelectorAll('[data-var="' + k + '"]');
        for (var i = 0; i < nodes.length; i++) nodes[i].textContent = vars[k];
      });
    } catch (e) {}
  };
  // Move the wizard from outside it — used after a submit succeeds, so the
  // finish screen is reached only when there is something to finish.
  window.__tdGo = function(id){
    try { var r = document.getElementById(id); if (r) r.checked = true; } catch (e) {}
  };
  ${fullscreen ? '' : `function report(){
    try {
      var h = Math.max(
        document.body ? document.body.scrollHeight : 0,
        document.documentElement ? document.documentElement.scrollHeight : 0
      );
      if (h > 0) post('setSize', { height: h });
    } catch (e) {}
  }
  window.addEventListener('load', report);
  document.addEventListener('DOMContentLoaded', report);
  // Images and web fonts land after load and change the height, so one
  // measurement leaves a message clipped.
  if (window.ResizeObserver) {
    window.addEventListener('DOMContentLoaded', function(){
      if (document.body) new ResizeObserver(report).observe(document.body);
    });
  }
  setTimeout(report, 60);`}
  true;
})();`;
}

/** Our own url schemes, from app.json. A link on one of these is a request to
 *  go somewhere INSIDE the app, not out to a browser. */
const APP_SCHEMES = ['footy', 'teamder'];

interface Props {
  campaignId: string;
  html: string;
  css?: string;
  fullscreen: boolean;
  /** A link or an author `trackClick` — the host reports it and closes. */
  onClick: (url?: string) => void;
  /** `joryioBridge.closeMessage()` from inside the document. */
  onClose: () => void;
  /**
   * A `data-action="submit"` tap, with every named field in the document.
   *
   * Does NOT close the message: a wizard that submits halfway through has more
   * to say afterwards, and `onClick` above is the path that ends a message.
   * Return true to let the document carry on to `advanceTo`.
   */
  onSubmit?: (fields: Record<string, unknown>) => void;
  /** A `data-action="share"` tap. Also non-closing — the share sheet comes
   *  back and the person is still mid-flow. */
  onShare?: () => void;
  /** Values only the app knows, written into `[data-var="key"]` once they
   *  arrive. A short invite link is a network round-trip, and the document has
   *  painted long before it lands. */
  vars?: Record<string, string>;
  /** Radio id to check from outside — how a submit that succeeded moves the
   *  wizard on, and a submit that failed does not. */
  advanceTo?: string | null;
}

export function HtmlMessageView({
  campaignId,
  html,
  css,
  fullscreen,
  onClick,
  onClose,
  onSubmit,
  onShare,
  vars,
  advanceTo,
}: Props): React.ReactElement {
  // Typed to the one method the host needs rather than to WebView itself:
  // naming the class here narrows the element's props to its declared type,
  // and `backgroundColor` — a real native prop the library never declared —
  // stops compiling. The transparency it buys is what keeps a white rectangle
  // from painting over the card's rounded corners.
  const webRef = useRef<{ injectJavaScript: (js: string) => void } | null>(null);
  // Start at a readable minimum rather than 0: a message whose setSize never
  // arrives (an author who broke the layout, a font that never loads) is then
  // still visible and dismissible instead of a zero-height sliver.
  const [height, setHeight] = useState(220);
  // Guards a double-report when a template calls trackClick AND navigate for
  // the same tap, which the web SDK's own examples do.
  const clickedRef = useRef(false);

  const source = useMemo(
    () => ({
      html: `<!DOCTYPE html>
<html>
<head>
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>html,body{margin:0;padding:0;background:transparent;}${
        fullscreen ? 'html,body{height:100%;}' : ''
      }</style>
<style>${css ?? ''}</style>
</head>
<body>${html}</body>
</html>`,
    }),
    [html, css, fullscreen],
  );

  useEffect(() => {
    if (!vars || Object.keys(vars).length === 0) return;
    webRef.current?.injectJavaScript(
      `window.__tdFill && window.__tdFill(${JSON.stringify(vars)}); true;`,
    );
  }, [vars]);

  useEffect(() => {
    if (!advanceTo) return;
    webRef.current?.injectJavaScript(
      `window.__tdGo && window.__tdGo(${JSON.stringify(advanceTo)}); true;`,
    );
  }, [advanceTo]);

  const onMessage = useCallback(
    (e: WebViewMessageEvent) => {
      let parsed: { method?: string; args?: Record<string, unknown> };
      try {
        parsed = JSON.parse(e.nativeEvent.data);
      } catch {
        return; // not ours — a template may postMessage for its own reasons
      }
      const args = parsed.args ?? {};
      switch (parsed.method) {
        case 'setSize': {
          const h = Number(args.height);
          if (Number.isFinite(h) && h > 0) {
            // Never taller than the screen: an author's 2000px document must
            // scroll inside the card, not push the close button off-screen.
            setHeight(Math.min(h, Dimensions.get('window').height * 0.82));
          }
          break;
        }
        case 'closeMessage':
          onClose();
          break;
        case 'trackClick':
          if (clickedRef.current) break;
          clickedRef.current = true;
          onClick(undefined);
          break;
        case 'submit': {
          const f = args.fields;
          onSubmit?.(
            typeof f === 'object' && f !== null ? (f as Record<string, unknown>) : {},
          );
          break;
        }
        case 'share':
          onShare?.();
          break;
        case 'navigate': {
          const url = typeof args.url === 'string' ? args.url : undefined;
          if (clickedRef.current) break;
          clickedRef.current = true;
          onClick(url);
          break;
        }
        default:
          break;
      }
    },
    [onClick, onClose, onSubmit, onShare],
  );

  // A plain <a href> the author wrote. http(s) only and always OUT to the
  // browser — the same rule the SDK applies, and the reason is the same: the
  // message web view has no origin and no business becoming a browser.
  const onShouldStartLoad = useCallback(
    (req: { url: string; navigationType?: string }) => {
      if (req.url === 'about:blank' || req.url.startsWith('data:')) return true;
      const scheme = req.url.split(':')[0]?.toLowerCase();
      // The app's OWN schemes route INWARDS. Without this an authored CTA
      // pointing at a screen was swallowed silently — the tap did nothing, and
      // an html message could only ever inform, never send anyone anywhere.
      // Linking.openURL on our own scheme hands the url to the app's existing
      // deep-link routing, the same path a push tap takes.
      if (APP_SCHEMES.includes(scheme ?? '')) {
        if (!clickedRef.current) {
          clickedRef.current = true;
          onClick(undefined); // report the click; we navigate ourselves
        }
        void Linking.openURL(req.url).catch(() => undefined);
        return false;
      }
      if (scheme === 'http' || scheme === 'https') {
        if (!clickedRef.current) {
          clickedRef.current = true;
          onClick(req.url);
        } else {
          void Linking.openURL(req.url).catch(() => undefined);
        }
      }
      return false;
    },
    [onClick],
  );

  return (
    <View style={fullscreen ? styles.full : { height }}>
      <WebView
        ref={webRef as never}
        source={source}
        originWhitelist={['about:blank']}
        injectedJavaScriptBeforeContentLoaded={shim(campaignId, fullscreen)}
        onMessage={onMessage}
        onShouldStartLoadWithRequest={onShouldStartLoad}
        // The card behind it carries the campaign's background colour; a white
        // web view would paint a rectangle over rounded corners.
        style={styles.web}
        backgroundColor="transparent"
        scrollEnabled
        showsVerticalScrollIndicator={false}
        // Nothing here needs to leave the document.
        javaScriptCanOpenWindowsAutomatically={false}
        allowsInlineMediaPlayback
        mixedContentMode="never"
        // No cookies, no localStorage, no cache shared with anything else.
        incognito
        androidLayerType="hardware"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  full: { flex: 1 },
  web: { flex: 1, backgroundColor: 'transparent' },
});
