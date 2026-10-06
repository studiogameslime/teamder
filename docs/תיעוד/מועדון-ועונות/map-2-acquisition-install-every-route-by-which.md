### 0. Scope & method

Everything below was read from source in `/Users/matan/Projects/soccer`. Nothing was run on a device or fetched from the live web. Where behaviour cannot be determined from code alone it is listed in **Open questions**, not guessed at.

Hosting: **two** Firebase Hosting sites with byte-identical config — `teamderfc` (`firebase.json:11`) and `soccer-app-52b6b` (`firebase.json:49`). There is **no custom domain**; every public URL a user ever sees is `https://teamderfc.web.app/…`. The second origin (`https://soccer-app-52b6b.web.app`) serves all the same pages but is **not** in the app's `HOSTING_DOMAINS` allow-list (`src/services/deepLinkService.ts:36-41`), so any link on that origin parses to `null` and loses both deep-link routing and attribution. Nothing in the repo generates such a link, but the origin is live and indexable.

Store identifiers, from source:
- Android package `com.studiogameslime.soccerapp` — `app.json` (`expo.android.package`), Play URL `https://play.google.com/store/apps/details?id=com.studiogameslime.soccerapp` (`src/services/updateService.ts:9,14`).
- iOS App Store id `6775178022` — `src/services/updateService.ts:12`, `eas.json` (`submit.internal.ios.ascAppId`), web URL `https://apps.apple.com/app/id6775178022`.
- Both are also duplicated as Remote Config defaults: `store_url_ios` / `store_url_android` at `src/services/remoteConfigService.ts:54-56`.

---

### 1. The route table (what exists on the web)

`firebase.json:21-38`, site `teamderfc`:

| URL | Served by | Template | OG injected server-side? |
|---|---|---|---|
| `/` | static | `public/index.html` | no (static tags) |
| `/get` | static | `public/get.html` | no |
| `/app` | rewrite → `/invite.html` (`firebase.json:22`) | `public/invite.html` | **no** |
| `/go` | rewrite → `/invite.html` (`firebase.json:23`) | `public/invite.html` | **no** |
| `/session/**` | rewrite → `/invite.html` (`firebase.json:21`) | `public/invite.html` | **no** |
| `/team/**` | CF `serveCommunityPage` (`firebase.json:27-29`) | `functions/templates/invite.html` | **yes** (`functions/src/index.ts:10619-10678`) |
| `/c/**` | CF `serveCommunityPage` (`firebase.json:31-33`) | `functions/templates/community.html` | **yes** |
| `/i/**` | CF `serveInviteCode` (`firebase.json:35-37`) | `functions/templates/invite.html` | **yes** (`functions/src/index.ts:10687-10825`) |
| `/invite-preview` | CF `getInvitePreview` (`firebase.json:25`) | JSON API | n/a |
| `/track-click` | CF `trackLinkClick` (`firebase.json:24`) | 204 beacon | n/a |
| `/privacy`, `/delete-account` | static (`cleanUrls:true`, `firebase.json:18`) | `public/privacy.html`, `public/delete-account.html` | no |
| `/downloads/teamder-0.2.5.aab` | static | a 0.2.5-era Android App Bundle sitting in `public/downloads/` | n/a |
| `/terms.html` | **does not exist** — `public/` contains only `delete-account.html`, `get.html`, `index.html`, `invite.html`, `privacy.html` | — | — |

`functions/templates/invite.html` is byte-identical to `public/invite.html` (verified by `diff`), and `functions/templates/community.html` is byte-identical to `public/c/index.html`. Per `project_ios_invite_attribution` memory, the templates are **generated** from `public/` by `functions/scripts/copy-template.js` at `npm run build`, and `/i/` links only pick up an edit after `firebase deploy --only functions:serveInviteCode` — a hosting-only deploy does not update them.

---

### 2. Path-by-path, tap by tap

#### Path A — WhatsApp short invite link `/i/<code>` (the modern default; every in-app share produces this)

All six in-app share entry points call `createShortInviteUrl` (`src/services/inviteLinkService.ts:35-66`), which writes `inviteLinks/{code}` and returns `https://teamderfc.web.app/i/<7-char base62 code>` (`inviteLinkService.ts:16,22,58`), with `?invitedBy=<uid>` appended when an inviter is known (`inviteLinkService.ts:59-61`).

**A-Android, app not installed:**
1. Person taps the link inside WhatsApp → WhatsApp's in-app browser (Android WebView) loads `/i/<code>`. `serveInviteCode` reads `inviteLinks/{code}`, increments `clicks` and `inviteClicks/{inviter}` (`functions/src/index.ts:10712-10733`), injects `window.__INVITE__={type,id,invitedBy}` before the page's inline script (`index.ts:10804-10809`), and injects the situation-aware OG block (`index.ts:10744-10799`).
2. Page fires `/invite-preview?code=…` (`public/invite.html:244`) and repaints hero copy + a context card with date / time / field / club / free-spots (`invite.html:246`).
3. Person taps **`הצטרף למשחק`** / **`הצטרף ל־Teamder`** / **`הורד את Teamder`** (all three CTAs — header `hdrBtn`, hero `ctaBtn`, sticky `stickyBtn` — bound to the same `primary()` at `invite.html:232`).
4. `primary()` assigns `location.href = 'footy://session/<id>?invitedBy=…'` and starts a **1500 ms** fallback timer to the Play URL (`invite.html:231`). App absent → the WebView shows a scheme error for ~1.5 s, then redirects to Play with `&referrer=invite_session_<id>_by_<uid>` (`invite.html:229`).
5. Play Store → **התקן** → **פתח**.

**Taps: 4** (link, CTA, Install, Open) plus a ~1.5 s dead interval on step 4. Note `/c/index.html:1046-1057` uses the correct Chrome `intent://…#Intent;scheme=footy;package=…;S.browser_fallback_url=…;end` pattern; `invite.html` does **not** — it only has the raw-scheme-plus-timeout dance.

**A-iOS, app not installed:**
1-3 as above.
4. `primary()` detects iOS (`invite.html:230`), writes `clipUrl()` — `https://teamderfc.web.app/session/<id>?invitedBy=…` (`invite.html:219`) — to the clipboard, then goes **straight** to `https://apps.apple.com/app/id6775178022`. The inline comment at `invite.html:231` documents why the `footy://` attempt is deliberately skipped on iOS (Safari renders a visible "cannot open page" error for an unhandled scheme).
5. App Store → **קבל** (+ Face ID / password) → **פתח**.
6. First launch: `consumeClipboardInviteIfFresh` (`src/services/clipboardInviteService.ts:38-94`) gates on `Clipboard.hasUrlAsync()` (no prompt) then `getStringAsync()`, which raises the iOS system **"Allow Paste?"** prompt — a 5th interaction the person must approve or attribution is lost.

**Taps: 4-5 + one system paste prompt.**

#### Path B — long invite links `/session/<id>` and `/team/<id>`

Built by `deepLinkService.buildInviteUrl` (`src/services/deepLinkService.ts:203-213`) — `https://teamderfc.web.app/session/<id>?invitedBy=<uid>`. These are only used as the **`fallbackLong`** when the short-code write fails (`inviteLinkService.ts:62-65`), so in practice they appear only offline / rules-denied. Same tap count as Path A. Difference: `/session/**` is a **static** rewrite (`firebase.json:21`) with **no OG injection**, so its WhatsApp preview card is the generic `Teamder · מארגנים כדורגל בלי כאב ראש` (`public/invite.html:9`). `/team/**` goes through `serveCommunityPage` and does get the club's name, description and cover as OG (`functions/src/index.ts:10640-10650`, `10531-10554`).

#### Path C — `/get` (the "try my app" marketing link)

`public/get.html:3-7` documents the intent: Facebook-group posts. On Android it hides the iOS button and `location.replace(ANDROID)`; on iOS the reverse (`get.html:59-65`). Desktop shows both and does not redirect (`get.html:66`).
1. Tap link → auto-redirect to the store (0 extra taps).
2. Install. 3. Open.
**Taps: 3** — the cheapest path.
**But**: the Android URL at `get.html:52` has **no `&referrer=`**, and there is no clipboard write. A `/get` install is 100 % unattributed on both platforms.

#### Path D — the club showcase `/c/<groupId>`

`public/c/index.html`. On mobile it *auto-attempts* the deep link: Android Chrome via `intent://team/<id>#Intent;scheme=footy;package=com.studiogameslime.soccerapp;S.browser_fallback_url=<this page>;end` (`c/index.html:1046-1057`); everything else via `location.href='footy://team/'+id` (`c/index.html:1062`). Deliberately no store auto-redirect (comment at `c/index.html:1025-1032`) — the showcase renders and the person reads it first.
Store buttons: `heroDownload` (`c/index.html:845`, label `הורדת האפליקציה`) and `finalDownload` (`c/index.html:939`, label `הורד את Teamder`), both re-pointed at `PLAY_URL + '&referrer=invite_team_<id>'` on Android or bare `APP_STORE_URL` on iOS (`c/index.html:1069-1081`).
**Taps: 3-4.** iOS installs from `/c/` carry **no attribution at all** — no referrer equivalent and no clipboard write anywhere in this file.

#### Path E — `/app` and `/go` (generic app invite + paid/ad links)

`buildAppInviteUrl` → `https://teamderfc.web.app/app?invitedBy=<uid>` (`deepLinkService.ts:221-224`). `/go` is the dedicated acquisition path, both rewritten to the same static `invite.html` (`firebase.json:22-23`). `invite.html` treats both as `isApp` (`invite.html:211`) and sets the Play referrer to `invite_app` / `invite_app_by_<uid>` (`invite.html:229`).
Ad links add `?b=<base64url source>` / `?s=` / `?c=` / `?l=<linkId>` / `?g=<gameId>`; the page decodes `b` (`invite.html:206-208`), fires the `/track-click` beacon (`invite.html:209`), and switches the Play referrer to a UTM querystring `utm_source=…&utm_campaign=…&g=…&l=…` (`invite.html:229`). `parseReferrerInvite` reads that form back (`src/services/installReferrerService.ts:94-111`) and `parseInviteUrl` reads it off a live URL (`deepLinkService.ts:116-134`). The `b` token is explicitly described as the inverse of Pulse's `encodeSourceToken` (`deepLinkService.ts:52-56`); **the Pulse link-builder itself is in `~/Projects/pulse`, not this repo.**
**Taps: 4** (Android) / **4-5** (iOS), same dance as Path A.

#### Path F — organic store search / browse

No repo artefact. Play listing and App Store listing are configured outside the code; the only listing copy in-repo is `app-store-metadata.md`, which is a **paste-source draft, not the live listing** — and it still points at `https://teamder.app/privacy.html` and `https://teamder.app` (`app-store-metadata.md:178-179`), a domain that does not exist. Its "What's New" block is still the v1.0 launch text (`app-store-metadata.md:140-169`) while `app.json` is at version `1.1.10`.
**Taps: 3** (search, Install, Open) once the person already knows the name.

#### Path G — root domain `https://teamderfc.web.app/`

`public/index.html` is a **closed-beta recruitment page**. It has **zero store links**. The only CTAs are:
- `public/index.html:426-431` → anchor to `#beta`, label `הצטרפו כבודקי בטא`
- `public/index.html:563-568` → `https://wa.me/972546986121?text=…` pre-filled `היי, אני רוצה להצטרף לבטא של Teamder.\nהמייל שלי: `, label `שלחו את המייל בוואטסאפ`
- `public/index.html:569-575` → `mailto:studiogameslime@gmail.com?subject=הצטרפות לבטא Teamder&body=המייל שלי: `, label `או שליחה במייל`

The body copy at `public/index.html:556-561`:
> `בטא פתוחה · מקומות מוגבלים` / `רוצה להיות מהראשונים לנסות?` / `שלחו לי את כתובת המייל שלכם (זו שמחוברת לחשבון Google של המכשיר). אוסיף אתכם לרשימת הבודקים ותקבלו קישור להורדה.`

**Taps to install from the root domain: undefined — there is no install path.** Anyone who types the brand into a browser, or clicks the `לדף הבית` link on the community 404 state (`public/c/index.html:793`), lands here and is asked to email their address to join a beta of an app that is live in both stores.

#### Path H — `/downloads/teamder-0.2.5.aab`

A publicly-served 0.2.5 Android App Bundle. `.aab` is not sideloadable by a phone; tapping it downloads a file the OS cannot install. It is unreferenced by any page but reachable and crawlable.

#### Path I — club join code (not an install path)

`groupsSearchByCode: 'או הצטרף בעזרת קוד הזמנה'` (`src/i18n/he.ts:1255`), `groupJoinCodeLabel: 'קוד הזמנה'` (`he.ts:2871`), consumed by `groupService.requestJoinByCode` (`src/services/groupService.ts:722`) and by the first-run wizard (`src/services/onboardingService.ts:80-97`). This is post-install club discovery and carries **no `invitedBy`** — `applyInviteAttributionIfFresh` only reads the stored `PendingInvite` (`src/services/userService.ts:908-940`). A person who installs organically and types a friend's club code credits nobody.

---

### 3. The exact share text the app generates

Six call sites, all routed through `createShortInviteUrl`. Full inventory:

**(a) Game / match share — the one actually reachable.** `src/screens/games/MatchDetailsScreen.tsx:1652-1688` (`handleShare`), wired to the share icon in the match header (`MatchDetailsScreen.tsx:2702`, `src/components/match/MatchStadiumHero.tsx:132-148`) and to the bottom CTA in two roster states (`MatchDetailsScreen.tsx:1954`, `1970`). Builder: `he.sessionShareWhatsappBody` (`src/i18n/he.ts:302-316`):

```
⚽ {title} — מחפשים שחקנים!

🗓️ {when}
📍 {field}            ← only when game.fieldName is set
👥 חסרים עוד {missing} שחקנים   ← only when missing > 0

הצטרפו כאן 👇
{link}
```
Verbatim source strings: `` `⚽ ${args.title} — מחפשים שחקנים!` `` (`he.ts:309`), `` `📍 ${args.field.trim()}` `` (`he.ts:310`), `` `👥 חסרים עוד ${args.missing} שחקנים` `` (`he.ts:312`), `'הצטרפו כאן 👇'` (`he.ts:314`). Share sheet `title` is the raw game title (`MatchDetailsScreen.tsx:1677`).

**(b) Club / community share.** `src/screens/communities/CommunityDetailsScreen.tsx:453-488` (`handleInvite`), reached from the full-width CTA `CommunityShareInviteCta` (`CommunityDetailsScreen.tsx:1168`, label `communityMenuShareInvite: 'שתף הזמנה למועדון'` — `he.ts:1729`) and from the post-creation sheet (`CommunityDetailsScreen.tsx:1269-1277`). Builder `he.communityInviteShareBody` (`he.ts:1563-1573`):
```
הוזמנת להצטרף למועדון {name} ב־Teamder ⚽

{description}     ← only when set

{link}
```
Verbatim: `` `הוזמנת להצטרף למועדון ${args.name} ב־Teamder ⚽` `` (`he.ts:1568`). Subject: `inviteShareSubject: 'הצטרף למועדון הכדורגל שלנו ⚽'` (`he.ts:1770`).

The sheet that pushes this share says (`he.ts:469-473`):
- `inviteSheetTitle: (club) => `${club} מוכן. עכשיו צריך אנשים.``
- `inviteSheetBody: 'מועדון בלי חברים לא עושה כלום. שלחו את הקישור בוואטסאפ — מי שילחץ עליו מצטרף ישירות, בלי חיפושים.'`
- `inviteSheetCta: 'הזמינו חברים'`, `inviteSheetLater: 'אחר כך'`

`מצטרף ישירות` is not what happens: a `team` invite navigates a non-member to `CommunityDetailsPublic` (`src/navigation/navigationRef.ts:134-138`), a preview screen from which they must still *request* to join.

**(c) App invite from the profile card.** `src/screens/tabs/ProfileScreen.tsx:924-946` (`handleShareInvite`), reached from the always-visible bottom CTA (`ProfileScreen.tsx:1380-1393`, label `profileInviteFriendsCta: 'הזמן חברים לאפליקציה'` — `he.ts:3020`) and from the activation-checklist "invite" step (`ProfileScreen.tsx:695-708`, label `he.homeStepInvite`). Builder `he.profileInviteShareBody` (`he.ts:3021-3022`):
```
אני משחק כדורגל בעזרת אפליקציית Teamder ⚽
תוריד גם אתה ובוא לשחק:
{link}
```

**(d) Friends-tab empty state.** `src/screens/profile/FriendsScreen.tsx:307-326` — same subject + same `profileInviteShareBody`. Surrounding copy: `friendsEmptyCtaTitle: 'בנה לעצמך רשימת חברים'` (`he.ts:1661`), `friendsEmptyCtaBody: 'הזמן חברים מרשימת אנשי הקשר שלך — תוכל להזמין אותם ישירות למחזורים בלחיצה אחת.'` (`he.ts:1662`), `friendsEmptyCtaButton: 'הזמן חברים לאפליקציה'` (`he.ts:1663`).

**(e) First-run wizard share step.** `src/services/onboardingService.ts:121-132` (`shareInvite`) — same subject + `profileInviteShareBody`, but the `url` handed in is a **club** link built by `clubInviteUrl` (`onboardingService.ts:49-63`), so a message that reads "download the app" carries a club-join URL. The wizard HTML itself is a Joryio in-app message authored outside this repo.

**(f) Joryio in-app message share action.** `src/components/joryio/InAppMessageHost.tsx:188-202` — same pair, `url` from `vars.inviteUrl`.

**Dead / unreachable share text:**
- `he.sessionInviteShareBody` (`he.ts:296-297`) — `הוזמנת למחזור ב־Teamder ⚽\nהצטרף כאן:\n{link}` — only referenced by `handleInvitePlayers` (`MatchDetailsScreen.tsx:1462-1496`), and `handleInvitePlayers` has **no `onPress` anywhere** (grep for it returns the definition only). Its `game.visibility !== 'public'` guard (`MatchDetailsScreen.tsx:1468`) therefore never runs — the live `handleShare` has **no visibility check at all** (`MatchDetailsScreen.tsx:1653`), so a club-only game is shareable to the open internet.
- `he.inviteShareBody` (`he.ts:1771-1772`) — `הצטרף למועדון הכדורגל שלנו באפליקציה ⚽\nשם המועדון: {groupName}\nלחץ כאן כדי לבקש להצטרף: {link}` — zero call sites.
- `he.sessionActionShareLink: 'שיתוף קישור'` (`he.ts:293`) and `he.sessionShareWhatsapp: 'שתף בוואטסאפ'` (`he.ts:298`) and `he.inviteShareTitle: 'הזמן שחקנים'` (`he.ts:1769`) — no call sites.

**Non-invite share:** teams export to WhatsApp, `MatchDetailsScreen.tsx:2450-2473`, plain text `{game.title}\n\n{colour-dot} {team name}\n{first names}` — carries **no link at all**, so an organiser posting the split into WhatsApp generates zero acquisition surface.

---

### 4. Attribution — where `invitedBy` survives and where it dies

Three independent recovery mechanisms, plus the write:

1. **Live deep link** — `parseInviteUrl` reads `?invitedBy=` (`deepLinkService.ts:110-114`, `184-188`), `App.tsx:449-457` stashes it.
2. **Android, Play Install Referrer** — `invite.html:229` appends `&referrer=invite_<type>_<id>_by_<uid>`; `parseReferrerInvite` (`installReferrerService.ts:65-113`) reads three formats: `invite_app_by_<uid>` (line 68), `invite_(session|team)_<id>_by_<uid>` (line 76), legacy `invite_(session|team)_<id>` (line 84), plus the UTM form (line 94). Consumed once per install behind `installReferrerConsumed` (`installReferrerService.ts:146`).
3. **iOS, clipboard deferred deep link** — `invite.html:231` writes `clipUrl()` on the CTA tap; `clipboardInviteService.ts:38-94` reads it once on first launch, behind Remote Config `feature_ios_clipboard_invite` (default `true`, `remoteConfigService.ts:38`).

The write: `applyInviteAttributionIfFresh` (`src/services/userService.ts:908-940`), called from four fresh-user creation points (`userService.ts:155, 208, 252, 339`). Hard bails: mock mode, no pending invite, no `invitedBy`, self-invite, and **a user doc that already has `invitedBy`** (`userService.ts:920`). Writes `invitedBy`, `invitedByType`, `invitedByTargetId` (`'app'` placeholder for generic invites, `userService.ts:925`) and a server-stamped `invitedAt`.

**Where attribution is LOST, plainly:**

| Situation | Why |
|---|---|
| **Any install via `/get`** | No `&referrer=` on the Android URL (`get.html:52,61`); no clipboard write on iOS (`get.html:64`). Both platforms: nothing. |
| **Any install via `/c/<id>` on iOS** | `c/index.html:1075` sends iOS straight to the bare `APP_STORE_URL`; that file contains no clipboard write. Android is fine (`invite_team_<id>`, `c/index.html:1069`) but has **no inviter** — the referrer is the club, never `_by_<uid>`. |
| **Any install via the root `/`** | There is no install path at all. |
| **iOS, person taps the CTA before `/invite-preview` resolves AND the CF didn't inject `__INVITE__`** | `retarget()` (`invite.html:223-226`) hasn't run, so `pathPart` is still `'app'` and `clipUrl()` yields `/app?invitedBy=…`. The inviter survives; the **game/club target is lost**. |
| **iOS, person declines the "Allow Paste?" prompt** | `getStringAsync()` returns nothing usable; the `finally` block latches `clipboardInviteConsumed` anyway (`clipboardInviteService.ts:85-92`) — one shot, gone forever. |
| **iOS, the CTA's `navigator.clipboard.writeText` throws** | Swallowed silently (`invite.html:231` `try{…}catch(_){}`) — the person still reaches the App Store, unattributed, with no signal anywhere. |
| **Any install where the person opens the store directly instead of tapping the page CTA** | The referrer / clipboard is only set by `primary()`. Scrolling to the bottom and tapping the **`Google Play` / `App Store`** buttons (`invite.html:187-188`) uses `storeAndroid`'s href — which *does* carry the referrer after `invite.html:229`/`226` — but the **App Store anchor at `invite.html:188` is a static href with no clipboard write**, so an iOS visitor who uses that button instead of the CTA is unattributed. |
| **A user who already has `invitedBy` set** | Never overwritten (`userService.ts:920`) — correct, but means a re-install or a second invite is never re-credited. |
| **Join by club code** | Never touches `PendingInvite`. |
| **`/i/<code>` with neither `__INVITE__` injection nor `?invitedBy=`** | `type` stays `null`, `valid` is `false` (`invite.html:211`), `storeHref` gets no referrer at all (`invite.html:229` is guarded by `if(valid)`). |
| **A link on `soccer-app-52b6b.web.app`** | Not in `HOSTING_DOMAINS` (`deepLinkService.ts:36-41`) → `parseInviteUrl` returns `null`. |

**Click counting is inflated:** `serveInviteCode` increments `inviteLinks/{code}.clicks` and `inviteClicks/{inviter}.clicks` on **every GET** (`functions/src/index.ts:10712-10733`), including the WhatsApp / Telegram / Facebook link-preview crawler that fetches the page to build the card. The dashboard's "קליקים על הקישור" therefore counts crawler hits as human taps.

---

### 5. iOS vs Android

| | Android | iOS |
|---|---|---|
| Custom schemes registered | `footy`, `teamder`, `com.studiogameslime.soccerapp` (`app.json` `expo.scheme`; `android/app/src/main/AndroidManifest.xml:51-52`) | same three (`app.json` `expo.scheme`) |
| App Links / Universal Links declared | `autoVerify=true`, host `teamderfc.web.app`, **pathPrefix `/session`, `/team`, `/app` only** (`app.json` `expo.android.intentFilters`; `android/app/src/main/AndroidManifest.xml:55-59`) | `associatedDomains: ["applinks:teamderfc.web.app"]` (`app.json` `expo.ios.associatedDomains`), entitlement present locally at `ios/Teamder/Teamder.entitlements` |
| Hosting side | `public/.well-known/assetlinks.json`, package `com.studiogameslime.soccerapp`, two SHA-256 fingerprints (`D2:73:E1:…`, `E8:72:FE:…`) | `public/.well-known/apple-app-site-association`, appID `M7R8M498Z9.com.studiogameslime.soccerapp`, `"paths": ["/session/*", "/team/*", "/app"]`; served as `application/json` via `firebase.json:41-43` |
| Status per memory | **Shipped and working** since 1.0.30 | `project_app_links_setup` records Universal Links as **never having worked** on a shipped build — the `associatedDomains` key was stripped for 1.0.30 because the provisioning profile lacked the Associated Domains capability, and a real iOS user confirmed 2026-06-30 that the link opens Safari. The key was re-added to `app.json` the same day; the entitlement is in the local prebuild. Whether the currently-served binary carries it cannot be read from this repo. |
| Deferred attribution | Play Install Referrer (native module `react-native-play-install-referrer`, `installReferrerService.ts:42`) | clipboard bridge (`clipboardInviteService.ts`) + a system paste prompt |
| Landing CTA behaviour | scheme attempt → 1.5 s → Play (`invite.html:231`) | clipboard write → App Store immediately, **never** attempts the scheme (`invite.html:231`) |
| Store buttons shown on `invite.html` | both | **both** — an iPhone visitor is shown `הורד ב־Google Play` as the *first* button (`invite.html:187`), then `הורד ב־App Store` (`invite.html:188`). No platform hiding anywhere in this file. |
| Store buttons on `/c/` | Play, with referrer | rewritten to App Store (`c/index.html:1038-1041`, `1075`) |
| Store buttons on `/get` | irrelevant button hidden, auto-redirect | irrelevant button hidden, auto-redirect (`get.html:59-65`) |

**The gap that matters most on both platforms:** `/i/*` — the path *every* modern share produces — is **absent from `assetlinks.json`'s effective claim set and from the AASA `paths` array, and absent from the Android `intentFilters`**. `/go` and `/c/*` are likewise absent. So a short invite link **never** opens the installed app directly on either platform; it always renders the web landing page first, and the person must then tap a CTA that fires a custom scheme. Only the long `/session/*`, `/team/*` and `/app` forms — which the app almost never generates any more — are real App Links.

---

### 6. Opening an invite link on DESKTOP

**`/i/<code>`, `/session/<id>`, `/team/<id>`, `/app`, `/go`** → `invite.html`. No platform branch fires: `isIOS` is false (`invite.html:230`), so `primary()` takes the Android branch. Clicking any of the three CTAs assigns `location.href = 'footy://…'` — which a desktop browser answers with an "external protocol" dialog or a silent failure — and 1500 ms later the page redirects the **desktop** browser to the Google Play web listing (`invite.html:231`). A Mac user is sent to Google Play. There is no QR code anywhere in the repo (grep for `qr`/`QRCode` across `src`, `public`, `package.json` returns nothing), no "send yourself a link", no email capture. The two store buttons at the page bottom (`invite.html:187-188`) are the only usable desktop affordance, and they are below the fold on the CH-4 section.

The desktop page is otherwise fully rendered: the `@media (min-width:900px)` block (`invite.html:132-138`) widens the layout to a 900 px two-column hero, so it *looks* designed for desktop while its primary action is not.

**`/c/<groupId>`** → showcase renders normally (no deep-link attempt, no redirect), download buttons point at the Play web listing with `&referrer=invite_team_<id>` (`c/index.html:1070,1075`). This is the only route that reads coherently on a desktop.

**`/get`** → both buttons, no redirect (`get.html:66`). Coherent.

**`/`** → the beta page, with a `wa.me` link (opens WhatsApp Web) and a `mailto:`.

---

### 7. The landing-page copy, verbatim (`public/invite.html`)

Static defaults, shown before `/invite-preview` resolves and permanently when it fails:
- `<title>` `Teamder · מארגנים כדורגל בלי כאב ראש` (`:6`)
- `meta description` `פותחים משחק, החבר׳ה נרשמים ו־Teamder מטפלת בכל השאר — הרשמות, רשימת המתנה, חלוקת כוחות וסטטיסטיקות.` (`:7`)
- `og:description` `כל המשחק השבועי במקום אחד — אתה רק מגיע לשחק.` (`:10`), `og:image` `https://teamderfc.web.app/logo.png` (`:11`) — a **512×512 square** logo, while `twitter:card` is declared `summary_large_image` (`:13`). No 1200×630 share image exists in `public/`.
- header button `הורד` (`:154`)
- badge `ברוכים הבאים ל־Teamder` (`:159`), h1 `כדורגל קבוע. בלי כאב הראש של הארגון.` (`:160`), lead `פותחים משחק, החבר׳ה נרשמים ו־Teamder מטפלת בכל השאר.` (`:161`)
- CTA `הורד את Teamder` (`:163`), trust line `חינם · Android ו־iPhone · עברית מלאה` (`:164`)
- dead-link note `הקישור כבר לא זמין, אבל אפשר למצוא משחקים נוספים ב־Teamder.` (`:165`)
- CH2 h2 `מ־40 הודעות למשחק אחד מסודר` (`:172`), sub `במקום לרדוף אחרי תשובות בקבוצה, כולם רואים מי מגיע ומה מצב המשחק.` (`:173`)
- animated chat bubbles `מי מגיע?` / `חסר לנו אחד` / `מי מביא כדור?` (`:175`)
- mock order card `חמישי כדורגל` · `המשחק מלא` · `10/10 שחקנים` · `הקבוצות מוכנות · אתם רק מגיעים לשחק` (`:178-179`)
- CH3 h2 `פחות הודעות.<br>יותר כדורגל.` (`:184`), sub `כל מה שצריך כדי לארגן את המשחק הבא במקום אחד.` (`:185`)
- store buttons `הורד ב־` `Google Play` (`:187`) / `הורד ב־` `App Store` (`:188`)
- footer `© Teamder ·` `פרטיות` `תנאי שימוש` (`:191`) — **`תנאי שימוש` links to `/terms.html`, which does not exist.**
- sticky bar `הורד את Teamder` (`:193`)

**Note on structure:** the HTML comments still say `CH1 / CH2 / CH3` with `CH3: FINAL CTA` at `:182` — the CSS defines a whole `.action` / `.step` chapter (`:104-115`) with three numbered product steps and screenshots, and the IntersectionObserver still watches `.step` elements (`:255`), but **no `.step` markup exists in the body**. The page is a three-section page wearing the skeleton of a four-section one.

Four context variants, applied by `applyV` (`invite.html:233-238`):

| `ctxType` | badge | h1 | sub | CTA | final | hero shot |
|---|---|---|---|---|---|---|
| `personal_invite` | `הזמנה אישית`, or `{name} הזמין אותך` | `הוזמנת ל־Teamder`, or `{name} הזמין אותך ל־Teamder` | `האפליקציה שמארגנת את הכדורגל כדי שאתם רק תגיעו לשחק.` | `הצטרף ל־Teamder` | `הצטרף לחברים שלך ב־Teamder` | `/shot-home.jpg` |
| `game` | `הזמנה למשחק` | `הוזמנת למשחק כדורגל` | `משחק שכונתי מחכה לך. ראה מי מגיע והצטרף בלחיצה אחת.` | `פתח את המשחק` | `המשחק הבא שלך כבר מחכה` | `/shot-match.jpg` |
| `community` | `הזמנה למועדון` | `הוזמנת להצטרף למועדון` | `הצטרף לקבוצה קבועה וקבל עדכונים על משחקים חדשים.` | `פתח את המועדון` | `הצטרף למועדון דרך Teamder` | `/shot-games.jpg` |
| `generic` / `campaign` | `ברוכים הבאים ל־Teamder` | `כדורגל קבוע. בלי כאב הראש של הארגון.` | `פותחים משחק, החבר׳ה נרשמים ו־Teamder מטפלת בכל השאר.` | `הורד את Teamder` | `פחות הודעות.<br>יותר כדורגל.` | `/shot-match.jpg` |

The context card adds live tags from `/invite-preview` (`invite.html:246-247`): weekday+date, `HH:MM`, field or city, club name, and a green `{n} מקומות פנויים`, or for a club: city and `{n} חברים`. If the game has already started / finished / been cancelled, the page silently **retargets to the parent club** and switches to the `community` variant (`invite.html:246`).

**The screenshots are duplicates.** `md5`: `shot-games.jpg` ≡ `shot-home.jpg` (`131533864dd6074e6ad9c5f0f6f94552`) and `shot-match.jpg` ≡ `shot-teams.jpg` (`0e3bb2395149a1efe27feddd87bba418`). So the four variants above resolve to **two** distinct images, and the `personal_invite` and `community` variants show the identical picture. Both are 540×1134. Content: `shot-home.jpg` is the **משחקים** feed (three cards — `שישי בוקר חיפה`, `באר שבע יום שני`, `רביעי בלילה ירושלים` — with a `כאן יוצרים משחק חדש` coach-mark over the FAB); `shot-match.jpg` is **פרטי משחק** (`שישי בוקר חיפה`, `20.07.26`, `07:30`, weather `24°`, `75 דק׳`, `10/12 שחקנים`, roster, `נווט למגרש ב-Waze`, `בקש להצטרף`). Both are dated **20.07.26** and both use the old tab labels **`משחקים`** / **`מועדונים`**, while the current app vocabulary is **`מחזור`** (`he.ts:287`, `1577-1581`, `3012`). `public/app-preview.png` (1080×2400, 517 KB) is served but referenced by nothing.

Terminology also splits across the web surface: `invite.html` says **מועדון** (`:235`), but `c/index.html` still says **קהילה** throughout (`:7`, `:13`, `:791`, `:804`, `:834`, `:843`, `:919`), and the `serveCommunityPage` OG fallback says `מועדון ב־Teamder` (`functions/src/index.ts:10537`) while `getInvitePreview`'s sibling copy is unlabelled. `public/index.html` says **קהילות סגורות** (`:463`).

---

### 8. What the person meets AFTER install, before the thing they were invited to

Worth stating here because it belongs to the acquisition cost: the stashed invite is consumed by `RootNavigator` only when **`currentUser && profileComplete && hasCompletedOnboarding`** are all true (`src/navigation/RootNavigator.tsx:65`). So a person who tapped "join this match" walks the entire first run — onboarding carousel, Google/Apple sign-in, profile completion, the first-run wizard — before the match they were invited to appears (`RootNavigator.tsx:146-150` → `navigationRef.ts:109-140`). A generic `type: 'app'` invite navigates **nowhere at all**: the stash is cleared and the person is left on home (`RootNavigator.tsx:77-80`), and on a warm link the same (`App.tsx:492-495`). A dead target shows a **hardcoded** Hebrew literal, not an `he.ts` key: `'הקישור לא תקין או שהפריט כבר לא קיים'` (`RootNavigator.tsx:124`).

---

### 9. Summary table

| Path | Taps to install | Attribution survives? | Known breakage |
|---|---|---|---|
| **A. `/i/<code>` short link, Android** | 4 | ✅ `invite_<type>_<id>_by_<uid>` via Play referrer (`invite.html:229`) | ~1.5 s scheme-error interval; not an App Link, so an installed app is never opened directly; crawler inflates click counts |
| **A′. `/i/<code>` short link, iOS** | 4-5 + system paste prompt | ⚠️ only if the person taps the **CTA** (clipboard, `invite.html:231`) and approves "Allow Paste?"; lost if they use the bottom `App Store` button (`:188`) instead | Universal Links unverified on shipped binaries; clipboard failure is silent; iPhone users are shown a Google Play button first |
| **B. `/session/<id>` / `/team/<id>` long link** | 4-5 | same as A / A′ | `/session/**` is a static rewrite → **no game-specific WhatsApp preview** (generic OG); only reachable when the short-code write fails |
| **C. `/get`** | **3** (cheapest) | ❌ **none, either platform** — no referrer (`get.html:52,61`), no clipboard (`:64`) | none functionally; it is simply an unattributed funnel |
| **D. `/c/<groupId>`** | 3-4 | ⚠️ Android: club only, **never an inviter** (`c/index.html:1069`). iOS: ❌ nothing (`:1075`) | copy still says `קהילה` throughout; auto deep-link attempt fires before the person has read anything |
| **E. `/app` or `/go` (ad / campaign)** | 4-5 | ✅ UTM (`utm_source`/`utm_campaign`/`g`/`l`) on Android (`invite.html:229` → `installReferrerService.ts:94-111`); iOS via clipboard | `/go` is not an App Link (absent from AASA + intentFilters); static rewrite → no SSR OG |
| **F. Organic store search** | 3 | ❌ none by definition | in-repo listing draft (`app-store-metadata.md`) is stale: v1.0 release notes, dead `teamder.app` URLs |
| **G. Root `https://teamderfc.web.app/`** | **∞ — no install path exists** | n/a | a live-in-both-stores product still asks visitors to WhatsApp their email to join a closed beta (`index.html:556-575`); the community 404 state links *here* (`c/index.html:793`) |
| **H. `/downloads/teamder-0.2.5.aab`** | not installable | n/a | a phone cannot install an `.aab`; stale 0.2.5 artefact publicly served |
| **I. Club join code (post-install)** | n/a | ❌ never credits anyone | `inviteSheetBody` promises `מצטרף ישירות`, but a non-member lands on a request-to-join preview (`navigationRef.ts:134-138`) |
