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

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Dimensions, Linking, StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

/** Author markup cannot execute: the server strips <script> and every on*
 *  handler, and this policy makes a sanitiser bypass inert rather than
 *  merely unlikely. Identical to the SDK's, so a template that renders on
 *  web renders here. */
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

interface Props {
  campaignId: string;
  html: string;
  css?: string;
  fullscreen: boolean;
  /** A link or an author `trackClick` — the host reports it and closes. */
  onClick: (url?: string) => void;
  /** `joryioBridge.closeMessage()` from inside the document. */
  onClose: () => void;
}

export function HtmlMessageView({
  campaignId,
  html,
  css,
  fullscreen,
  onClick,
  onClose,
}: Props): React.ReactElement {
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
    [onClick, onClose],
  );

  // A plain <a href> the author wrote. http(s) only and always OUT to the
  // browser — the same rule the SDK applies, and the reason is the same: the
  // message web view has no origin and no business becoming a browser.
  const onShouldStartLoad = useCallback(
    (req: { url: string; navigationType?: string }) => {
      if (req.url === 'about:blank' || req.url.startsWith('data:')) return true;
      const scheme = req.url.split(':')[0]?.toLowerCase();
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
