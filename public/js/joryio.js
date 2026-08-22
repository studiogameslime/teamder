/* Joryio web tracking for the Teamder landing pages.
 *
 * The pages already classify every visit — invite.html computes `__AB__` with
 * context_type (game / community / personal_invite / campaign / generic), the
 * inviter, the campaign source and the platform — and pushes named events
 * (landing_view, landing_primary_cta_click, landing_store_click …) into
 * dataLayer. All of that was going to GTM only.
 *
 * So this does not invent its own event set: it wraps dataLayer.push and
 * forwards what the page already decided, with the invite context attached.
 * Anything the pages add later flows through for free.
 *
 * Joryio's web SDK is not published to npm, and these are static pages with no
 * bundler, so this speaks the SDK wire protocol directly:
 *   POST /v1/track  { type: <EVENT NAME>, anonymousId, properties, timestamp }
 * The event name goes in `type` — `name` is ignored by that endpoint.
 */
(function () {
  var BASE = 'https://hippomation-backend.fly.dev/api';
  var KEY = 'jry_sdk_web_32fb87e179b49a5b6312788d557b247de189c0d416f33a9f';
  var STORE = 'joryio_anonymous_id';

  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  var anon;
  try {
    anon = localStorage.getItem(STORE);
    if (!anon) { anon = uuid(); localStorage.setItem(STORE, anon); }
  } catch (e) { anon = uuid(); }   // private mode — session-only id

  function qp(k) {
    try { return (new URLSearchParams(location.search).get(k) || '').trim(); }
    catch (e) { return ''; }
  }
  function b64d(t) {
    try {
      var b = String(t || '').replace(/-/g, '+').replace(/_/g, '/');
      while (b.length % 4) b += '=';
      return decodeURIComponent(escape(atob(b)));
    } catch (e) { return ''; }
  }

  /* The same parse invite.html does, so a plain page (index/get) still knows
   * what kind of link brought the visitor. `__INVITE__` is server-injected on
   * the short-link path and wins when present. */
  function inviteContext() {
    var INV = window.__INVITE__ || {};
    var parts = (location.pathname || '').split('/').filter(Boolean);
    var type = INV.type
      || (parts[0] === 'session' ? 'session'
        : parts[0] === 'team' ? 'team'
        : parts[0] === 'app' ? 'app'
        : parts[0] === 'go' ? 'go' : '');
    var id = INV.id || INV.targetId
      || ((parts[0] === 'session' || parts[0] === 'team') ? (parts[1] || '') : '');
    var invitedBy = (INV.invitedBy || qp('invitedBy') || '').trim();
    if (!type && invitedBy) type = 'app';

    // session/team are the internal surface names; spell them out, because
    // these land in a dashboard that humans read.
    var via = type === 'session' ? 'game'
      : type === 'team' ? 'community'
      : type === 'app' || type === 'go' ? 'app' : '';

    var ctx = {
      page: location.pathname || '/',
      inviteVia: via || undefined,
      inviteTargetId: id || undefined,
      invitedBy: invitedBy || undefined,
      inviteCode: (parts[0] === 'i' ? (parts[1] || '') : qp('code')) || undefined,
      campaignSource: (qp('b') ? b64d(qp('b')) : (qp('s') || qp('utm_source'))) || undefined,
      campaign: (qp('c') || qp('utm_campaign')) || undefined,
      linkId: qp('l') || undefined,
      referrer: document.referrer || undefined,
    };
    for (var k in ctx) if (ctx[k] === undefined) delete ctx[k];
    return ctx;
  }

  var CTX = inviteContext();

  function send(name, props) {
    var p = {};
    var k;
    for (k in CTX) p[k] = CTX[k];
    // Whatever invite.html already worked out about this visit.
    var ab = window.__AB__ || {};
    for (k in ab) if (ab[k] !== undefined) p[k] = ab[k];
    if (props) for (k in props) if (props[k] !== undefined && k !== 'event') p[k] = props[k];
    try {
      fetch(BASE + '/v1/track', {
        method: 'POST',
        keepalive: true,            // survive the navigation being reported
        headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: name, anonymousId: anon,
          properties: p, timestamp: new Date().toISOString(),
        }),
      }).catch(function () {});
    } catch (e) {}
  }

  /* snake_case → the Title Case the workspace already uses, so landing events
   * sit next to the app's instead of forming a parallel set. */
  function pretty(n) {
    return String(n || '').split('_').filter(Boolean).map(function (w) {
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(' ');
  }

  // Forward everything the page pushes to GTM. Existing pushes that happened
  // before this script loaded are replayed once.
  var dl = (window.dataLayer = window.dataLayer || []);
  var nativePush = dl.push.bind(dl);
  function forward(o) {
    if (o && typeof o === 'object' && o.event) send(pretty(o.event), o);
  }
  dl.forEach(forward);
  dl.push = function () {
    for (var i = 0; i < arguments.length; i++) forward(arguments[i]);
    return nativePush.apply(dl, arguments);
  };

  // invite.html pushes its own `landing_view`, which the dataLayer hook above
  // forwards; index.html and get.html push nothing, so they need this. Test the
  // CONTENT of __INVITE__, not its presence: the pages define it as `{}` when
  // there is no invite, and an empty object is truthy.
  var injected = window.__INVITE__ && Object.keys(window.__INVITE__).length > 0;
  if (!injected && !dl.some(function (o) { return o && o.event === 'landing_view'; })) {
    send('Landing View', {});
  }

  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a') : null;
    if (!a || !a.href) return;
    var h = a.href, name = null, store;
    if (h.indexOf('play.google.com') > -1) { name = 'Store Link Clicked'; store = 'android'; }
    else if (h.indexOf('apps.apple.com') > -1) { name = 'Store Link Clicked'; store = 'ios'; }
    else if (h.indexOf('footy://') === 0) name = 'App Deep Link Clicked';
    else if (h.indexOf('wa.me') > -1 || h.indexOf('whatsapp') > -1) name = 'Whatsapp Link Clicked';
    if (name) send(name, { store: store, href: h.slice(0, 200) });
  }, true);

  window.joryioTrack = send;
})();
