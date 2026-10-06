### 0. Method, and what is verified against production

Everything below was read from the files in `/Users/matan/Projects/soccer` **and** checked against the live site with `curl` and headless Chrome at a true 390px CSS viewport.

**Repo and production are in sync.** `curl` of `/`, `/get` and `/app` returned bytes identical to `public/index.html`, `public/get.html`, `public/invite.html`. The two SSR templates are also in sync: `public/invite.html` is byte-identical to `functions/templates/invite.html`, and `public/c/index.html` to `functions/templates/community.html`, kept so by `functions/scripts/copy-template.js:20-29`, run from the build script at `functions/package.json:10` (`node scripts/copy-template.js && tsc`).

**There is no custom domain.** Every share link the app emits is built on `const HOSTING_ORIGIN = 'https://teamderfc.web.app'` — `src/services/deepLinkService.ts:44`, `src/services/inviteLinkService.ts:16`. The reason is on record at `src/services/deepLinkService.ts:30-35`: *"The bare 'teamder' subdomain was reserved by another Firebase project before we owned the brand, so we ship under 'teamderfc' (fc = football club)."* So every WhatsApp invite a real user sends shows a raw `.web.app` Firebase URL.

Screenshots at a true 390px viewport are in `/Users/matan/Projects/soccer/.landing-shots/`: `01-home-390.png` (`/`), `02-get-desktop-390.png` (`/get`, desktop rendering — mobile auto-redirects), `03-app-invite-generic-390.png` (`/app`), `04-privacy-390.png` (top 2400px of 11403px), `05-delete-account-390.png`, `06-community-showcase-390.png` (`/c/0Vn55bS62vvA3iBZsa3A`, a real live community), `07-community-notfound-390.png`.

A caution on Chrome: headless clamps its window to a 500px minimum, so naive `--window-size=390` screenshots are a 390px **crop of a 500px layout** and look falsely broken. All shots above were taken through a 390px iframe harness instead.

---

### 1. Routing — every public route and what answers it

From `firebase.json`. Two hosting targets, `teamderfc` and `soccer-app-52b6b`, carry **identical** rewrite blocks (`firebase.json:9-49` and `:50-90`), so both origins behave the same. `cleanUrls: true` and `trailingSlash: false` are set on both.

| Route | Answered by | firebase.json |
|---|---|---|
| `/` | static `public/index.html` | (no rewrite; static) |
| `/get` | static `public/get.html` | (no rewrite; static) |
| `/app` | rewrite → static `/invite.html` | `:13` |
| `/go` | rewrite → static `/invite.html` | `:14` |
| `/session/**` | rewrite → static `/invite.html` | `:12` |
| `/i/**` | CF `serveInviteCode` (us-central1) | `:44-47` |
| `/c/**` | CF `serveCommunityPage` | `:40-43` |
| `/team/**` | CF `serveCommunityPage` | `:36-39` |
| `/track-click` | CF `trackLinkClick` | `:15` |
| `/invite-preview` | CF `getInvitePreview` | `:16` |
| `/privacy` | static `public/privacy.html` (via cleanUrls) | — |
| `/delete-account` | static `public/delete-account.html` | — |

Verified live status codes: `/` 200, `/get` 200, `/app` 200, `/go` 200, `/privacy` 200, `/delete-account` 200, `/c` 200, `/session/FAKEID` 200, `/team/FAKEID` 200, `/i/FAKEC0D` 200, `/c/FAKEID` 200.

Two routing details worth flagging:

- **`/c` (bare) is not the function.** Firebase serves a matching static file before applying a rewrite, and `public/c/index.html` exists. So `/c` serves that file directly with **no SSR meta injection**, while `/c/{groupId}` falls through to `serveCommunityPage`. With no groupId the page's own script hits `if (!groupId) { setState('error'); return; }` (`public/c/index.html:1006`) and renders the "not found" state.
- **`/terms.html` does not exist.** `find` across the repo returns no `terms*.html`, and the live URL returns **404**. The invite page footer links to it anyway (see §4.1).

---

### 2. `/` — the root landing page (`public/index.html`)

`<html lang="he" dir="rtl">` at `:2`; viewport `width=device-width, initial-scale=1.0` at `:5`. Font Heebo via Google Fonts `:14`.

**The single most consequential fact about this page: it contains zero links to either app store.** Grep counts across `public/index.html`: `play.google.com` → 0, `apps.apple.com` → 0. The only conversion path is a WhatsApp message asking to be added to a closed beta — while the app is in fact live on both stores (§6).

#### 2.1 Content, top to bottom, verbatim

**Top nav** (`:400-411`) — logo `logo2.png` `:403`; links `פיצ׳רים` `:406`, `איך זה עובד` `:407`, `הצטרפות לבטא` `:408`. All three are in-page anchors (`#features`, `#how`, `#beta`). At ≤640px the entire link group is hidden by `.nav-links { display: none; }` (`:390`), so **on a phone the top bar is a bare logo with no navigation and no CTA**.

**Hero** (`:414-443`) — logo image `:416`; H1 across two lines: `מארגנים משחק כדורגל` `:418` and, gradient-filled, `בלי בלגן` `:419`. Lead `:422-423`: `קבוצה אחת, רישום למשחק בקליק, בחירת קבוצות חיה ודירוג חברים. הכול במקום אחד — בלי קבוצות וואטסאפ אינסופיות.` Two CTAs: primary `הצטרפו כבודקי בטא` → `href="#beta"` `:426,430`; secondary `מה יש באפליקציה` → `href="#features"` `:432-434`. Below them a pill `חינמי לחלוטין` `:440`.

Note both hero CTAs are **in-page anchors**. Nothing on the first screen leaves the page.

**Features** (`:446-524`) — eyebrow `פיצ׳רים` `:448`; H2 `כל מה שצריך כדי לארגן משחק` `:449`; sub `סוף ל"מי שיחק שבוע שעבר?" ול"אין לי מספיק שחקנים".` `:450`. Six cards:

1. `קהילות סגורות` `:463` — `פותחים קבוצה לחבר׳ה הקבועים, מזמינים בקוד, ובלי זרים. אדמין מאשר חברים חדשים.` `:464`
2. `רישום למשחק בקליק` `:475` — `אתה רואה את המשחק הבא, נרשם, ויודע אם אתה ברשימה הראשית או בהמתנה. בלי לעקוב אחרי וואטסאפ.` `:476`
3. `בחירת קבוצות חיה` `:486` — `על המגרש: גוררים שחקנים בין קבוצות, מסמנים שוערים, ו־shuffle אוטומטי כשרוצים לערבב — מותאם 5v5/6v6/7v7.` `:487`
4. `דירוגים בקהילה` `:496` — `כל חבר מדרג את האחרים בסקייל 1–5. הממוצעים אנונימיים, ועוזרים לאזן קבוצות אוטומטית.` `:497`
5. `התראות חכמות` `:507` — `תזכורת שעה לפני, התראה כשמישהו מבטל ואתה ראשון בהמתנה, וכשפותחים משחק חדש בקבוצה שלך.` `:508`
6. `הישגים וסטטיסטיקות` `:518` — `כמה משחקים שיחקת, אחוז נוכחות, רצפים — וכרטיסי הישגים שמתפתחים עם השנים.` `:519`

Card 4 is factually stale against the shipped product. It promises peer rating on a 1–5 scale; per `project_rating_1to10`, peer/crowd rating was deleted on 2026-06-24 and replaced by admin-only internal rating on a 1–10 scale.

**How it works** (`:527-550`) — eyebrow `איך זה עובד` `:529`; H2 `מהורדה למשחק — שלוש דקות` `:530`. Steps: 1 `פותחים קבוצה` `:535` / `שם, מגרש, תדירות. שולחים קוד הזמנה לחבר׳ה — ובאמת זה הכול.` `:536`; 2 `פותחים משחק` `:540` / `בוחרים תאריך, שעה, פורמט (5v5/6v6/7v7), והאפליקציה דואגת לרישום ולתזכורות.` `:541`; 3 `מגיעים ומשחקים` `:545` / `על המגרש פותחים את מסך ה־Live, מחלקים קבוצות בכמה שניות, ומתחילים. הסטטיסטיקות נשמרות אוטומטית.` `:546`.

Step 3 says the Live screen is where you split teams. Per `project_evening_flow_spec` the live match became timer-only in 2026-05 with teams/rotation removed, so this too is stale. The H2 also promises "from download to game", but the page never offers a download.

**Beta section** (`:553-579`) — badge `בטא פתוחה · מקומות מוגבלים` `:556`; H2 `רוצה להיות מהראשונים לנסות?` `:557`; body `:559-560`: `שלחו לי את כתובת המייל שלכם (זו שמחוברת לחשבון Google של המכשיר). אוסיף אתכם לרשימת הבודקים ותקבלו קישור להורדה.`

Two CTAs. Primary `שלחו את המייל בוואטסאפ` `:567` → `https://wa.me/972546986121?text=…` `:563`; the pre-filled text decodes to `היי, אני רוצה להצטרף לבטא של Teamder.\nהמייל שלי: `. Secondary `או שליחה במייל` `:574` → `mailto:studiogameslime@gmail.com?subject=הצטרפות לבטא Teamder&body=המייל שלי: ` `:569`.

Note the copy is first-person singular ("שלחו **לי**", "אוסיף אתכם") while the footer is corporate ("Studio Games Lime"). It asks for the device's **Google** account email — a Play closed-test mechanic with no iOS equivalent offered. A personal mobile number and a personal Gmail address are the only two contact channels.

**Footer** (`:582-599`) — brand `· מארגנים משחקי כדורגל בלי בלגן` `:587`; links `מדיניות פרטיות` → `/privacy` `:590`, `מחיקת חשבון` → `/delete-account` `:591`, `צור קשר` → mailto `:592`; copyright `© Studio Games Lime · כל הזכויות שמורות` `:596`.

#### 2.2 CTA behaviour by platform

Identical on Android, iOS and desktop — no UA sniffing on this page. `#beta` and `#features` scroll in-page. `wa.me` opens WhatsApp (app on mobile, web on desktop). `mailto:` opens the mail client.

#### 2.3 Meta / WhatsApp preview

`<title>` `:6` `Teamder — מארגנים משחקי כדורגל בלי בלגן`; description `:7` `Teamder היא האפליקציה לארגון משחקי כדורגל שכונתיים: קבוצות, רישום, בחירת קבוצות חיה ודירוג חברים — הכול במקום אחד.`; `og:title` `:8` same as title; `og:description` `:9` `קבוצות, רישום למשחק, בחירת קבוצות חיה ודירוגים. הכול במקום אחד.`; `og:image` `:10` `https://teamderfc.web.app/logo.png`. No `og:type`, no `og:locale`, no twitter card. `logo.png` is 512×512 square, so the WhatsApp card renders as a small thumbnail, not a wide hero.

#### 2.4 RTL / 390px

Measured at a true 390px viewport: `scrollWidth` 390, `body.scrollWidth` 390, **0 overflowing elements**, document height 4315px. RTL is document-level via `dir="rtl"` with no per-element overrides. The step number badge uses the logical property `inset-inline-start: 28px` (`:253`), which is RTL-correct. Nothing breaks at 390px.

---

### 3. `/get` — the smart store link (`public/get.html`)

Its own header comment states the intent (`:2-7`): *"clean, marketing-friendly smart store link. Detects the platform and redirects straight to the right store… No invite framing, no app-open attempt — purpose-built for 'try my app' posts (Facebook groups etc.)"*.

Nothing in `src/` references `/get`; grep for `web.app/get` across the repo returns nothing. It is a hand-pasted marketing URL only.

#### 3.1 Content

`<html lang="he" dir="rtl">` `:8`. Title `Teamder · הורדה` `:12`. Logo `:40`; H1 `Teamder` `:41`; body `:42` `מארגנים כדורגל בלי בלגן ⚽` then, on a second line, `פותח לך את החנות…`. Two buttons: `🍏 הורדה ל-iPhone` `:44` and `🤖 הורדה ל-Android` `:45`. Hint `:47` `לא נפתח אוטומטית? בחר/י את החנות שלך למעלה.`

The Hebrew mixes hyphen forms: `ל-iPhone` / `ל-Android` here use an ASCII hyphen, while the rest of the estate uses the maqaf `ב־` / `ל־` (e.g. `invite.html:159`).

#### 3.2 Store URLs and platform behaviour

Both defined twice — as `href` and again as JS constants: iOS `https://apps.apple.com/app/id6775178022` (`:44`, `:51`), Android `https://play.google.com/store/apps/details?id=com.studiogameslime.soccerapp` (`:45`, `:52`).

UA sniffing at `:53-65`: `isAndroid = /Android/i.test(ua)`; `isIOS = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)` — the second clause deliberately catches iPadOS 13+, which reports as Mac (`:56` comment).

- **Android**: hides the iOS button, then `location.replace(ANDROID)` `:60-61`. Zero taps.
- **iOS / touch Mac**: hides the Android button, then `location.replace(IOS)` `:63-64`. Zero taps.
- **Desktop**: no redirect, both buttons shown (`:66` comment). This is what `02-get-desktop-390.png` shows.

No install referrer and no `invitedBy` is attached on this path, so a `/get` install is attributed to nothing.

#### 3.3 Meta

Title `:12`; description `:13` `Teamder — מארגנים כדורגל בלי בלגן. הורד עכשיו.`; `og:title` `:14` `Teamder · כדורגל בלי בלגן`; `og:description` `:15` `מארגנים משחק, מחלקים כוחות ומוצאים שחקנים — באפליקציה אחת.`; `og:image` `:16` `/logo.png`.

#### 3.4 RTL / 390px

Measured: `scrollWidth` 390, 0 overflowing elements. `body` is a flex centering box with `min-height:100vh` (`:21-23`), card `max-width:380px` (`:25`) — fits 390px with 24px body padding. Buttons are a full-width column (`:29`).

---

### 4. The invite landing page (`public/invite.html`) — four routes, five copy variants

One 25KB file backs `/app`, `/go`, `/session/**` (all static rewrites), `/i/**` (via `serveInviteCode`) and `/team/**` (via `serveCommunityPage`). It is the page that actually receives invited users, so it carries the most behaviour.

#### 4.1 Static content

`<html lang="he" dir="rtl">` `:2`; viewport includes `viewport-fit=cover` `:5`; `theme-color #0B1B3B` `:16`; font Assistant `:19`.

**Header** (`:152-155`) — logo pair; button `הורד` `:154`.

**Hero** (`:157-168`) — badge `ברוכים הבאים ל־Teamder` `:159`; H1 `כדורגל קבוע. בלי כאב הראש של הארגון.` `:160`; lead `פותחים משחק, החבר׳ה נרשמים ו־Teamder מטפלת בכל השאר.` `:161`; an empty context card `:162`; CTA `הורד את Teamder` `:163`; trust line `חינם · Android ו־iPhone · עברית מלאה` `:164`; a hidden note `הקישור כבר לא זמין, אבל אפשר למצוא משחקים נוספים ב־Teamder.` `:165`; phone mock with `/shot-match.jpg` `:167`.

**Problem → solution** (`:171-180`) — H2 `מ־40 הודעות למשחק אחד מסודר` `:172`; `במקום לרדוף אחרי תשובות בקבוצה, כולם רואים מי מגיע ומה מצב המשחק.` `:173`; three chat bubbles `מי מגיע?`, `חסר לנו אחד`, `מי מביא כדור?` `:175`; then the payoff card `:178-179`: `חמישי כדורגל`, badge `המשחק מלא`, `10/10 שחקנים`, `הקבוצות מוכנות · אתם רק מגיעים לשחק`.

**Final CTA** (`:183-190`) — H2 `פחות הודעות.<br>יותר כדורגל.` `:184`; `כל מה שצריך כדי לארגן את המשחק הבא במקום אחד.` `:185`; two store cards, each `הורד ב־` over the store name: Google Play `:187`, App Store `:188`.

**Footer** (`:191`) — `© Teamder · ` then `פרטיות` → `/privacy.html` and **`תנאי שימוש` → `/terms.html`**. That file does not exist in the repo and the live URL returns **404**. Every invited user sees a dead "Terms of Service" link.

**Sticky bar** (`:193`) — appears once the hero has scrolled off and the final CTA is not yet near, per `:262`.

Note the CSS carries a whole unused chapter: `.action`, `.step`, `.stepN`, `.step .shot` (`:104-115`) are styled, and `:255` observes `.step` elements — but no `.step` markup exists in the body. A three-step section was removed and its CSS left behind. So the page is only hero → problem → store, with no explanation of what the app does between them.

#### 4.2 The five variants

Defined at `:233-237`, applied by `applyV()` `:238` and called unconditionally at `:239`.

| Variant | badge | title | CTA | final | shot |
|---|---|---|---|---|---|
| `personal_invite` `:233` | `הזמנה אישית` | `הוזמנת ל־Teamder` | `הצטרף ל־Teamder` | `הצטרף לחברים שלך ב־Teamder` | `/shot-home.jpg` |
| `game` `:234` | `הזמנה למשחק` | `הוזמנת למשחק כדורגל` | `פתח את המשחק` | `המשחק הבא שלך כבר מחכה` | `/shot-match.jpg` |
| `community` `:235` | `הזמנה למועדון` | `הוזמנת להצטרף למועדון` | `פתח את המועדון` | `הצטרף למועדון דרך Teamder` | `/shot-games.jpg` |
| `generic` `:236` | `ברוכים הבאים ל־Teamder` | `כדורגל קבוע. בלי כאב הראש של הארגון.` | `הורד את Teamder` | `פחות הודעות.<br>יותר כדורגל.` | `/shot-match.jpg` |
| `campaign` `:237` | identical to `generic` in all five fields | | | | `/shot-match.jpg` |

Subtitles: personal `האפליקציה שמארגנת את הכדורגל כדי שאתם רק תגיעו לשחק.`; game `משחק שכונתי מחכה לך. ראה מי מגיע והצטרף בלחיצה אחת.`; community `הצטרף לקבוצה קבועה וקבל עדכונים על משחקים חדשים.`; generic/campaign `פותחים משחק, החבר׳ה נרשמים ו־Teamder מטפלת בכל השאר.`

With an inviter name resolved, `:238` overrides badge to `{name} הזמין אותך` and title to `{name} הזמין אותך ל־Teamder`.

**The five variants resolve to only two distinct images.** `md5` over `public/`: `shot-home.jpg` and `shot-games.jpg` are byte-identical (`131533864dd6074e6ad9c5f0f6f94552`), and `shot-match.jpg` and `shot-teams.jpg` are byte-identical (`0e3bb2395149a1efe27feddd87bba418`). So personal and community show the same picture, and game/generic/campaign show the same picture. All four are 540×1134. `shot-teams.jpg` is referenced by nothing (grep over `public/` finds no reference) yet is served live (200).

Variant selection is at `:214`: `session`→`game`, `team`→`community`, else `invitedBy`→`personal_invite`, else `source||campaign`→`campaign`, else `generic`.

#### 4.3 Per-route behaviour

Type resolution `:200-213`: `window.__INVITE__` wins if the server injected it, otherwise the first path segment.

- **`/app`** — static. `type='app'`, `isApp=true`, `valid=true`, `pathPart='app'`. No `code`, so no preview fetch. Renders `generic` (verified — `03-app-invite-generic-390.png`).
- **`/app?invitedBy=<uid>`** — `ctxType='personal_invite'` via `:214`. Title is the generic `הוזמנת ל־Teamder`; the **inviter's name is never resolved** on this path, because the name only arrives from `/invite-preview`, which `:244` gates on `code`.
- **`/go`** — `pathPart='go'`, deep link `footy://go`. Same `generic` copy as `/app`.
- **`/session/{id}`** — static, so **no OG injection**; `ctxType='game'` from the path, so the `game` copy applies, but the detail card (date / pitch / free spots) never renders, again because there is no `code`.
- **`/team/{id}`** — SSR'd by `serveCommunityPage`, which injects OG but **not** `__INVITE__`; `ctxType='community'` from the path. Community name, city and member count never render, same cause.
- **`/i/{code}`** — the only route that gets the full experience: `serveInviteCode` injects `__INVITE__` **and** per-link OG, and `code` is set so the preview fetch runs and fills the detail card.

Since `src/services/inviteLinkService.ts:58` makes `/i/{code}` the form of every share the app emits, the rich path is the common one — and `/session/`, `/team/`, `/app` are the degraded fallbacks used when the short-link write fails (`:62-65`).

#### 4.4 The `/invite-preview` fetch and the context card

`:244-250`. Only when `code` is truthy. On response:

- `type==='game'` and not past → `retarget('session', d.id)`, `game` copy, and a chip row built from `startsAt` (weekday + time via `Intl.DateTimeFormat('he-IL')` `:240-241`), `fieldName` or `city`, `communityName`, and `{n} מקומות פנויים` styled green when `availableSpots > 0` `:246`.
- `type==='game'` and **past** (`finished` / `cancelled` / `startsAt < now`) → if the game has a `communityId`, it **silently re-points to the parent community** (`retarget('team', …)`, `community` copy, chips for city and `{n} חברים`); otherwise `toGeneric()` `:246`. A neat save: a stale game link becomes a community invite rather than a dead end.
- `type==='community'` → `community` copy plus city and `{n} חברים` chips `:247`.
- `type==='personal'` → `personal_invite` with the inviter's name `:248`.
- anything else, or a fetch rejection → `toGeneric(wasGameLink||wasCommLink)` `:249-250`, which reverts the copy, hides the card, and shows `הקישור כבר לא זמין, אבל אפשר למצוא משחקים נוספים ב־Teamder.` `:243,165`.

#### 4.5 The primary CTA — `primary()` at `:231`

Wired to all three buttons (`ctaBtn`, `stickyBtn`, `hdrBtn`) at `:232`.

**iOS.** Writes the canonical https invite to the clipboard via `navigator.clipboard.writeText(clipUrl())`, then goes **straight to the App Store** — it never attempts `footy://`. The inline comment at `:231` explains why: *"iOS Safari throws a visible 'cannot open page' error for an unhandled custom scheme (footy://) when the app isn't installed — and an invite recipient never has it yet."* Consequence: **an iOS user who already has Teamder installed is still sent to the App Store**, not into the app.

**Android and desktop.** `:231`: fire `track('landing_app_open_attempt')`, arm a 1500ms timer to `location.href = storeHref`, register a `visibilitychange` listener that cancels the timer if the page hides (the app opened), then `location.href = 'footy://…'`. On desktop this attempts an unknown protocol — browser-dependent, typically an error prompt — and then lands on the Google Play **web** listing 1.5s later.

If `valid` is false, it skips the scheme and goes straight to the store.

#### 4.6 Attribution machinery

**Play install referrer** `:229`. With a campaign `source`, the referrer is `utm_source=…&utm_campaign=…&g=<gameId>&l=<linkId>`; otherwise `invite_app` or `invite_{type}_{id}`, with `_by_{invitedBy}` appended. `retarget()` `:223-226` rewrites it once the preview resolves the real entity. Consumed on first launch by `src/services/installReferrerService.ts`.

**iOS clipboard deferred deep link.** The web side writes `https://teamderfc.web.app/{pathPart}{appQuery}` (`clipUrl()` `:219`). The app side is `src/services/clipboardInviteService.ts`: iOS only (`:39`), behind the Remote Config kill-switch `feature_ios_clipboard_invite` (`:40`), latched to one read per install (`:42`), skipped if a pending invite already exists (`:46-50`), and gated behind `Clipboard.hasUrlAsync()` (`:56`) — which, per the comment at `:52-55`, checks for a URL **without** triggering iOS 16's "Allow Paste?" prompt. On a match it stashes the invite and blanks the clipboard (`:67-72`); a non-matching URL is left alone (`:70`).

**`localStorage.pendingInvite`** `:227` — written by the web page. Web `localStorage` is not readable by the native app, so this cannot serve attribution; it is only useful to the page itself on a return visit.

**Click beacon** `:209`. If any of `source`, `linkId` or `invitedBy` is present, fires `navigator.sendBeacon('/track-click?l=…&s=…&inviter=…')`, falling back to `fetch(…, {mode:'no-cors', keepalive:true})`.

#### 4.7 Analytics

`track()` `:198` pushes to `window.dataLayer` and calls `gtag` if present. Events: `landing_view` `:216`, `landing_primary_cta_click` `:231`, `landing_app_open_attempt` `:231`, `landing_store_click` `:231`, `landing_context_loaded` `:246-248`, `landing_context_failed` `:243`, `landing_scroll_depth` at 25/50/75/100% `:260`.

`window.__AB__` `:215` carries `context_type`, `campaign_source`, `platform` (`android`/`ios`/`web`), `has_inviter`, `has_game`, `has_community`.

A campaign source may arrive base64url-encoded as `?b=` and is decoded at `:206-207`, falling back to `?s=` then `?utm_source=`.

#### 4.8 Meta / WhatsApp preview

Static defaults: title `:6` `Teamder · מארגנים כדורגל בלי כאב ראש`; description `:7` `פותחים משחק, החבר׳ה נרשמים ו־Teamder מטפלת בכל השאר — הרשמות, רשימת המתנה, חלוקת כוחות וסטטיסטיקות.`; `og:title` `:9`; `og:description` `:10` `כל המשחק השבועי במקום אחד — אתה רק מגיע לשחק.`; `og:image` `:11` `/logo.png`; `og:locale he_IL` `:12`; `twitter:card summary_large_image` `:13`.

Verified live, `/session/FAKEID` returns exactly these static tags — **no per-game injection**, because that route is a static rewrite.

#### 4.9 RTL / 390px

Measured: `scrollWidth` 390, 0 overflowing elements, document height 2021px. One content width `--cw:342px` with `max-width: calc(100% - 44px)` (`:25,47`) — 342px fits inside 390px. Headings are explicitly right-aligned at `:48`. Sticky bar respects `env(safe-area-inset-bottom)` `:128`. A `prefers-reduced-motion` block at `:139-143` forces all revealed content to `opacity:1`.

I checked the reveal animations specifically, since the bubbles and payoff card start at `opacity:0` and depend on an IntersectionObserver (`:253`, threshold 0.28). Measured over time in a 390px viewport: bubbles reach opacity 1, `.down` 1, `.order` 1 by t≈1600ms. **They work** — an early screenshot that appeared to show them missing was a capture-timing artifact, not a defect.

---

### 5. `/i/**` — `serveInviteCode` (`functions/src/index.ts:10687-10825`)

Resolves a 7-char base62 code (`src/services/inviteLinkService.ts:17-28`) against `inviteLinks/{code}` `:10699`. A pure alias, no redirect, so the short URL stays in the address bar (`:10680-10686`).

**Side effects on every hit** (`:10711-10740`): increments `clicks` and `lastClickAt` on the link doc; increments `inviteClicks/{invitedBy}` when an inviter is known — the comment at `:10718-10724` records that short links used to skip this, so a person's profile counter read 7 while the aggregate read 15; and bumps the cross-source daily aggregate via `bumpLinkClickAggregate`.

**SSR OG by link type** (`:10748-10799`):
- `team` → `loadShowcaseSummary` → `{name} · Teamder` plus the group description, or `מועדון כדורגל ב־Teamder · {city} · {n} משחקים · {n} חברי סגל` (`:10542-10552`), with the group cover as `og:image`.
- `session` → reads `games/{id}`; title `הוזמנת למשחק: {title}` or `הוזמנת למשחק כדורגל ב־Teamder`; description `משחק כדורגל ב־Teamder · {where} · ראה מי מגיע והצטרף בלחיצה.` or `משחק כדורגל ב־Teamder · ראה מי מגיע והצטרף בלחיצה אחת.` (`:10772-10777`). **No `og:image`** — game links fall back to the 512×512 logo.
- inviter only → reads the user's name; `{name} מזמין אותך ל־Teamder` or `הזמנה אישית ל־Teamder`; description `הצטרף לחברים שלך ב־Teamder — האפליקציה שמארגנת את הכדורגל כדי שרק תגיעו לשחק.` (`:10788-10792`).
- else → `Teamder · כדורגל קבוע בלי כאב ראש` / `פותחים משחק, החבר׳ה נרשמים ו־Teamder מטפלת בכל השאר.` (`:10794-10798`).

Note the OG copy says `מזמין אותך` (`:10789`) while the page body says `הזמין אותך` (`invite.html:238`) — present vs past tense for the same person.

Injects `<script>window.__INVITE__={…}</script>` before `</head>` `:10804-10809`. `Cache-Control: public, max-age=60, s-maxage=60` `:10813`. On error, serves the bare template `:10817-10819` — which silently drops attribution; `src/services/inviteLinkService.ts:52-57` compensates by also putting `?invitedBy=` in the URL.

Verified live: `/i/FAKEC0D` returns title `Teamder · כדורגל קבוע בלי כאב ראש` and `__INVITE__={"type":"app","id":"","invitedBy":""}`. **An unknown code degrades silently to the generic page with a 200** — no "this link expired" state.

---

### 6. `/c/**` and `/team/**` — `serveCommunityPage` (`functions/src/index.ts:10619-10678`)

One function, two templates, chosen by `isInvite = parts[0] === 'team'` `:10630`: `/team/{id}` → `invite.html`, `/c/{id}` → `community.html` `:10636-10638`. `Cache-Control: public, max-age=300, s-maxage=600` `:10657-10660`.

**The fallback meta is wrong for `/team/`.** `buildMetaBlock` `:10531-10554` returns, when no showcase doc exists, title `מועדון ב־Teamder` and description `צפו בסטטיסטיקות המועדון, השחקנים הכי נאמנים, והמשחקים האחרונים.` That is *browse-the-stats* copy, correct for `/c/` and wrong for `/team/`, which is a *join* invite. Verified live: `/team/FAKEID` returns exactly that description.

#### 6.1 The showcase page (`public/c/index.html`)

**No in-app entry point.** Grep across the whole repo for `web.app/c/` finds one match, a comment at `functions/src/index.ts:9977`. Nothing in `src/` ever shares a `/c/{id}` URL. The page is reachable only by hand-built link.

**Vocabulary conflict.** The page says *קהילה* throughout — `<title>` `:7` `קהילה ב־Teamder`, `og:title` `:12`, error `הקהילה לא נמצאה` `:791`, empty `הקהילה עדיין נבנית` `:804`, CTA `הצטרפו לקהילה` `:843`, section `הקהילה` `:919`, `רוצים להצטרף?` body `:931`. The SSR function that renders it says *מועדון* (`:10537`, `:10551`). Verified live at `/c/FAKEID`: SSR title `מועדון ב־Teamder`, page body `הקהילה לא נמצאה`. The app's own strings also say מועדון (`src/i18n/he.ts:1568`, `:1770`).

**Content.** Nav logo + `פתח באפליקציה` `:772`. Loading `טוען את הקהילה…` `:782`. Error `הקהילה לא נמצאה` `:791` / `ייתכן שהקישור שגוי או שהקהילה הוסרה. נסו לפתוח את הקישור מחדש.` `:792` / `לדף הבית` `:793`. Empty `הקהילה עדיין נבנית` `:804` / `אחרי המשחק הראשון תהיה כאן עמוד יפה עם סטטיסטיקות. חזרו בקרוב.` `:805` / `פתח באפליקציה` `:806`.

Hero: eyebrow `קהילת כדורגל פעילה` `:834`; H1 from data `:835`; chips for city, pitch, `מאז {year}` `:1157`; CTAs `הצטרפו לקהילה` `:843` and `הורדת האפליקציה` `:846`.

Stats `:853-886`: `משחקים שנערכו` `:861`, `חברים פעילים` `:868`, `אחוז הצלחה` `:875`, `משחקים החודש` `:882`. `אחוז הצלחה` is never defined anywhere on the page; it maps to `organizationRatePct` `:1171`.

Sections: `הכי נאמנים למגרש` / `אלופי הנוכחות` / `השחקנים שהכי הופיעו למשחקים בשנה האחרונה.` `:891-893`; `משחקים אחרונים` / `מה קרה לאחרונה` / `כל משחק עם תאריך ומספר שחקנים שהגיעו.` `:902-904`; `הקהילה` / `מי משחק כאן` / `חברי הקהילה — מנהלים מסומנים בזהב.` `:919-921`; final `רוצים להצטרף?` / `פתחו את הקישור באפליקציית Teamder ותצטרפו ישר לקהילה — בלי קבוצות וואטסאפ אינסופיות.` `:930-931` with `פתח באפליקציה` `:937` and `הורד את Teamder` `:945`.

Footer `:955-972`: `עמוד ראשי` `:963`, `מדיניות פרטיות` `:964`, `הורד את האפליקציה` → **hardcoded Google Play** `:965`.

**A live ad placeholder.** `:911-913` renders `<div class="ad-slot"><span>מקום שמור למודעה</span></div>` — a dashed grey box reading "space reserved for an advert", styled at `:588-601`, visible on real community pages. Confirmed in `06-community-showcase-390.png`. `public/app-ads.txt` carries a real AdSense publisher id.

**Store links.** The markup has five `play.google.com` links and one `apps.apple.com` — the latter only as the JS constant `APP_STORE_URL` `:985`. Two JS passes patch this: `:1038-1041` rewrites every `a[href*="play.google.com"]` to the App Store on iOS, and `:1075-1081` re-resolves `heroDownload` and `finalDownload` per platform (the comment at `:1071-1074` notes the first pass would otherwise be undone). The **footer** link `:965` is covered by the first pass. So iOS is handled, but only by JS — with JS disabled every visitor gets Google Play.

**Auto deep-link on every mobile visit** `:1042-1064`. On Android Chrome it fires `location.replace('intent://team/{id}#Intent;scheme=footy;package=…;S.browser_fallback_url=<this page>;end')`. On other mobile browsers it assigns `footy://team/{id}` — which, on browsers that surface unhandled schemes, shows an error for a visitor without the app. Unlike invite.html there is no store fallback, by design (`:1025-1032`).

**Data.** Fetched client-side from the Firestore REST API with a public API key `:982-983`, `:1084-1087`. A 404 sets the error state, a doc with no `name` sets empty `:1096-1098`.

#### 6.2 Two defects confirmed live at 390px

Both verified on a real community, `/c/0Vn55bS62vvA3iBZsa3A` ("כדורגל קריית עקרון"), in `06-community-showcase-390.png`.

1. **The podium puts 2nd place above 1st on mobile.** `renderPodium` builds DOM order `[silver, gold, bronze]` (`:1217-1220`) precisely so a 3-column grid centres gold (`:1214-1216`, grid at `:347`). At ≤720px `:352-353` collapses it to `grid-template-columns: 1fr`, and the DOM order becomes vertical order — so the reader meets the #2 card, then #1, then #3. The screenshot shows the silver "2" card (מתן לוי) stacked above the gold "1" card.
2. **Hebrew singular is never handled.** Rendered live: `1 משחקים` ("1 games"). Sources: `:1228` `'<strong>' + (entry.p.gamesPlayed || 0) + '</strong> משחקים · '`, `:1242`, `:1264` `(g.attendedCount || 0) + ' שחקנים'`, `:1301` `games + ' משחקים'`. The app itself does this correctly — `src/i18n/he.ts:1574-1575` `communityMembersCount: (n) => n === 1 ? 'שחקן אחד' : \`${n} שחקנים\`` — so the web page is out of step with the product's own standard.

#### 6.3 `/c/` responsive

Breakpoints at `:269` (stats 4→2 cols), `:352` (podium→1 col), `:751-758` (padding). Members grid `repeat(auto-fill, minmax(140px,1fr))` `:530`; recent-games titles ellipsis at `:505-506`.

---

### 7. `/invite-preview` — `getInvitePreview` (`functions/src/index.ts:13124-13254`)

CORS-enabled `:13125`, `Cache-Control: public, max-age=60` `:13127`. Returns `{type:'generic'}` for a missing or absent code `:13131-13139`, and — notably — for **any** internal error too `:13249-13251` (*"Never leak an internal error — degrade to the generic page"*).

- `session` `:13150-13207`: computes occupancy as `players + non-cancelled non-waitlisted guests + pendingPromotion` `:13157-13165`, returns `availableSpots = max(0, maxPlayers - occ)`, plus title, `startsAt`, `fieldName`, `city`, `status`, and the parent community from `groupsPublic` so a past game can fall back to it (`:13166-13169`).
- `team` `:13209-13229`: name, city, cover, `memberCount`.
- personal `:13234-13245`: returns **only** the inviter's display name — the comment at `:13231-13233` notes no uid or phone is exposed.

### 8. `/track-click` — `trackLinkClick` (`functions/src/index.ts:13256-13301`)

Reads `?l=` (ad link), `?s=` (legacy source), `?inviter=` (uid). Writes `adLinks/{l}.clicks` or `linkClicks/{s}.clicks` `:13269-13278`, always bumps `inviteClicks/{inviter}` when present `:13280-13284`, and bumps the daily aggregate `:13289-13294`. Always returns **204** with `Cache-Control: no-store` `:13298-13299`; every failure is swallowed (*"best-effort beacon — never error the user's redirect"* `:13296`).

---

### 9. Cross-cutting

#### 9.1 Deep-link registration — short links never open the installed app

`app.json` registers schemes `footy`, `teamder`, `com.studiogameslime.soccerapp`. Verified Android intent filters cover exactly three path prefixes on `teamderfc.web.app`: `/session`, `/team`, `/app` (`autoVerify: true`). iOS `associatedDomains` is `applinks:teamderfc.web.app`, and `public/.well-known/apple-app-site-association` lists paths `["/session/*", "/team/*", "/app"]`.

**Neither platform registers `/i/*` or `/go`.** But `/i/{code}` is the form of *every* share the app emits (`src/services/inviteLinkService.ts:58`, called from `ProfileScreen.tsx:929`, `FriendsScreen.tsx:314`, `MatchDetailsScreen.tsx:1472` and `:1655`, `CommunityDetailsScreen.tsx:456`, `onboardingService.ts:53`). So a recipient who **already has Teamder installed** and taps a shared link always lands in the browser on invite.html first, and must tap the CTA to be handed off.

Compounding it, `parseInviteUrl` (`src/services/deepLinkService.ts:103-194`) handles `/session/*`, `/team/*`, `/app`, `/go` — but has no `/i/` branch, so it returns `null` for a short link. This is currently harmless because the clipboard path writes the **long** form (`invite.html:219`), but it means a pasted short link cannot be recovered.

`assetlinks.json` declares two SHA-256 fingerprints (upload + Play signing).

#### 9.2 Joryio web tracking (`public/js/joryio.js`)

Loaded with `defer` on index `:601`, get `:69`, invite `:267`, delete-account `:323`. **Not** on `privacy.html` and **not** on `public/c/index.html` — so the community showcase, the one page with real content worth measuring, is untracked.

It posts to `https://hippomation-backend.fly.dev/api/v1/track` `:19` with a hardcoded bearer key `:20`. Anonymous id in `localStorage`, regenerated per-session in private mode `:30-34`. It wraps `dataLayer.push` and replays earlier pushes `:118-127`, converting snake_case to Title Case `:110-114`. It emits its own `Landing View` only when `__INVITE__` is absent or empty — the comment at `:129-133` flags the trap that *"the pages define it as `{}` when there is no invite, and an empty object is truthy."* A capture-phase click listener `:138-147` classifies outbound links into `Store Link Clicked` (with `store: android|ios`), `App Deep Link Clicked`, `Whatsapp Link Clicked`.

#### 9.3 Legal pages

**`/privacy`** (`public/privacy.html`) — title `:6` `מדיניות פרטיות — Teamder`; eyebrow `משפטי` `:233`; H1 `מדיניות פרטיות` `:234`; `תאריך עדכון אחרון: 29 במאי 2026 · Teamder · Studio Games Lime` `:235`. Eleven sections `:244-403`: `מי אנחנו`, `מה אנחנו אוספים` (with `פרטים שאתם מספקים ישירות` `:249`, `פרטים שנאספים אוטומטית` `:263`, `שעון Wear OS וווידג'ט הטלפון` `:278`, `דפי קהילה ציבוריים` `:288`, `נתוני בריאות וכושר (Health Connect / HealthKit)` `:291`), `למה משמש המידע`, `עם מי המידע משותף`, `היכן המידע נשמר`, `כמה זמן נשמר המידע`, `הזכויות שלכם`, `ילדים`, `אבטחה`, `שינויים במדיניות`, `יצירת קשר`. **11,403px tall at 390px** — roughly 13.5 phone screens. No OG tags, no analytics. The nav still points at `/#features`, `/#how`, `/#beta` (`:223-225`).

Two staleness notes: the date is 29 May 2026, predating the Wear OS removal, the rating change, and the Joryio SDK; and §2.4 is headed `דפי קהילה ציבוריים` while the SSR calls the same thing מועדון.

**`/delete-account`** (`public/delete-account.html`) — title `:6`; eyebrow `חשבון` `:258`; H1 `מחיקת חשבון` `:259`; lead `אפשר למחוק את החשבון ואת הנתונים שלכם בכל רגע, ישירות מתוך האפליקציה.` `:260`.

Steps `:271-274`: `פתחו את Teamder והיכנסו לחשבון.` / `עברו לטאב "הפרופיל שלי".` / `גללו לתחתית המסך והקישו על "מחיקת חשבון".` / `אשרו את הפעולה. החשבון יימחק תוך מספר שניות.`

Table `מה נמחק ומה נשמר` `:279-297`: `נמחק מיד` — `פרטי הפרופיל (שם, אימייל, טלפון, עיר, רמת מיומנות)` / `תוך שניות`; `נמחק מיד` — `חברויות בקבוצות והיסטוריית הרשמות` / `תוך שניות`; `נשמר` — `דוחות קריסה אנונימיים (Crashlytics) ותעבורה אנונימית (Analytics)` / `עד 14 חודשים`; `נשמר` — `משחקים שיצרת/ניהלת — נשארים בקבוצה אך ללא שמך (מוחלף ב־"משתמש שהוסר")` / `קבוע`.

This page describes deletion as in-app only and offers no web form, which is a gap against Google Play's data-deletion URL requirement (the URL must let a user *request* deletion without the app).

#### 9.4 Exposed and orphaned assets

- **A pre-release Android build is publicly downloadable.** `public/downloads/teamder-0.2.5.aab`, 44,061,763 bytes, served live (range request returned **206**). Anyone who guesses or finds the path gets a v0.2.5 build of the app.
- `public/app-preview.png` (1080×2400) and `public/shot-teams.jpg` are referenced by nothing in `public/` yet both return 200.
- `logo.png` is 512×512; `logo2.png` is 1969×799. Every `og:image` on the estate points at the square `logo.png`, so no surface produces a wide WhatsApp hero card.

#### 9.5 Store URLs — both real

Android `https://play.google.com/store/apps/details?id=com.studiogameslime.soccerapp` — live, 200.

iOS `https://apps.apple.com/app/id6775178022` — **real, not a placeholder.** The iTunes lookup API returns `resultCount: 1`, `trackName: Teamder`, `bundleId: com.studiogameslime.soccerapp`, `version: 1.1.7`, released `2026-09-16`. (A direct `curl` returns 429 rate-limiting, not a 404.) The same id appears at `get.html:44,51`, `invite.html:188,231`, `c/index.html:985`.

Which makes the root landing page's closed-beta framing (§2.1) the estate's sharpest contradiction: the app has been publicly downloadable on both stores for months, and `teamderfc.web.app` still asks visitors to WhatsApp a phone number for a Play test-track invite.

---

### 10. Summary table

| Route | Rendered by | Primary CTA (Hebrew) | Where that CTA sends an **Android** user |
|---|---|---|---|
| `/` | static `public/index.html` | `הצטרפו כבודקי בטא` (`:430`) → anchor `#beta`, then `שלחו את המייל בוואטסאפ` (`:567`) | **WhatsApp chat to +972546986121** — never a store |
| `/get` | static `public/get.html` | none needed | **Auto `location.replace` → Google Play** (0 taps, `:60-61`) |
| `/app` | rewrite → static `invite.html` | `הורד את Teamder` (`:163`) | `footy://app`, then Google Play after 1500ms (`:231`), referrer `invite_app` |
| `/go` | rewrite → static `invite.html` | `הורד את Teamder` | `footy://go`, then Google Play after 1500ms |
| `/session/{id}` | rewrite → static `invite.html` (no SSR) | `פתח את המשחק` (`:234`) | `footy://session/{id}`, then Google Play, referrer `invite_session_{id}[_by_{uid}]` |
| `/i/{code}` | CF `serveInviteCode` | variant-dependent: `פתח את המשחק` / `פתח את המועדון` / `הצטרף ל־Teamder` | `footy://{type}/{id}`, then Google Play with the retargeted referrer (`:223-226`) |
| `/team/{id}` | CF `serveCommunityPage` → invite template | `פתח את המועדון` (`:235`) | `footy://team/{id}`, then Google Play, referrer `invite_team_{id}` |
| `/c/{id}` | CF `serveCommunityPage` → community template | `הצטרפו לקהילה` (`:843`) / `הורדת האפליקציה` (`:846`) | Auto `intent://team/{id}` on Chrome (`:1046-1057`); download button → Google Play + `referrer=invite_team_{id}` (`:1069-1070`) |
| `/c` (bare) | static `public/c/index.html` | — | Error state `הקהילה לא נמצאה` |
| `/privacy` | static | — | — |
| `/delete-account` | static | — | — |
| `/invite-preview` | CF `getInvitePreview` | — | JSON |
| `/track-click` | CF `trackLinkClick` | — | 204 |
| `/terms.html` | **nothing — 404** | — | Linked from `invite.html:191` |