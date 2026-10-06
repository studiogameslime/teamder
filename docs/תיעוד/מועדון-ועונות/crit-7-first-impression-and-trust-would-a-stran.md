### First-impression and trust — would a stranger believe this is a real product, and does the page answer "what is this" in five seconds

## The verdict in one line

Teamder has one landing page that a stranger would trust — and it is not the one at the root of the domain.

I checked both. `public/invite.html` (served at `/app`, `/go`, `/session/*`, `/team/*`, `/i/*`) opens with a real phone showing a real app screen, states the price, the platforms and the language in seven words, and ends with both store badges. A stranger knows what this is in about three seconds.

`public/index.html` — the page you reach by typing the brand name, the page a Facebook post links to, the page Google will rank — contains **zero pictures of the product** (grep for `src=` returns exactly `/logo2.png` and `/js/joryio.js`) and **zero links to either app store** (`grep -c "play.google.com\|apps.apple.com" public/index.html` → `0`). Its single conversion path is a WhatsApp message to a personal Israeli mobile number, asking the visitor to hand over the Google account email tied to their phone, in exchange for admission to a "closed beta" of an app that has been publicly downloadable on both stores for months. The iOS listing is real and live: `apps.apple.com/app/id6775178022`, `trackName: Teamder`, `version 1.1.7`.

That is the whole critique in miniature. The good work was done on the invite page and never carried back to the front door.

## The front door fails the five-second test twice over

A visitor who lands on `/` and gives it five seconds learns the tagline `מארגנים משחק כדורגל / בלי בלגן` and sees a blue button reading `הצטרפו כבודקי בטא`. They do not see the app. Not a screen, not a phone mock, not a single pixel of the product. Six feature cards describe it in prose next to generic line icons.

This is not a missing-asset problem. `public/app-preview.png` is 1080×2400, it is a product screenshot, it has sat in `public/` since June, and grepping the whole repo finds **not one reference to it**. The phone-mock markup and CSS that would frame it already exist, working, in `invite.html`. The raw material for fixing the homepage's worst problem is already in the same directory as the homepage.

Then the second failure: the section titled `מהורדה למשחק — שלוש דקות` promises a journey from download to game, on a page that never offers a download. Both hero CTAs are in-page anchors (`#beta`, `#features`). Nothing on the first screen leaves the page. A visitor who reads the heading, believes it, and looks for the download button will not find one anywhere on the 4,315 pixels of this document.

## The beta framing is the single biggest trust liability on the estate

Stack the signals a stranger receives from `public/index.html:553-579`:

- `בטא פתוחה · מקומות מוגבלים` — scarcity on a product with no scarcity
- `שלחו לי את כתובת המייל שלכם (זו שמחוברת לחשבון Google של המכשיר)` — a request for an identifier tied to the visitor's Google account
- the primary button goes to `wa.me/972546986121` — a personal mobile number
- the fallback is `mailto:studiogameslime@gmail.com` — a personal Gmail address
- the footer says `© Studio Games Lime · כל הזכויות שמורות`

Read that list without knowing it is legitimate. Personal phone, personal Gmail, a request for the email attached to your Google account, artificial scarcity, a company name that appears only in the copyright line, hosted on a raw `.web.app` Firebase subdomain. A cautious person closes the tab. A less cautious person WhatsApps a stranger their Google email and waits for a reply that a real product would never have needed.

And the thing being gated is not gated. The app is on Google Play and the App Store right now. The page is asking people to jump through a Play closed-test hoop (with, note, no iOS equivalent offered at all — an iPhone user who follows these instructions receives nothing) to obtain something they could install in one tap.

## The community showcase publishes an empty advert box

`public/c/index.html:911-913` renders, on every community page:

```
<div class="ad-slot" id="adSlot">
  <span>מקום שמור למודעה</span>
</div>
```

`adSlot` is referenced by nothing in the file's JavaScript — I grepped. It is never hidden. Confirmed live on a real club, `/c/0Vn55bS62vvA3iBZsa3A` ("כדורגל קריית עקרון"): a dashed grey rectangle in the middle of the page reading "space reserved for an advert."

This is the one public page with real data on it. On that page, the product is telling every visitor, in Hebrew, that its layout is unfinished. Nothing else on the estate does more damage per pixel, and nothing is cheaper to fix.

The same page compounds it. Rendered live, that club shows `1 משחקים`, `0 משחקים החודש`, `100% אחוז הצלחה` — a term defined nowhere on the page — and a podium whose second-place card sits **above** first place on mobile, because `renderPodium` builds DOM order `[silver, gold, bronze]` to centre gold in a 3-column grid, and `:352` collapses to one column at ≤720px without reordering. A visitor meets #2, then #1, then #3.

`1 משחקים` is the tell. The app itself gets this right — `src/i18n/he.ts:1574` reads `n === 1 ? 'שחקן אחד' : ${n} שחקנים`. The web page is out of step with the product's own standard, so the sloppiness reads as *web page nobody maintains*, which is exactly the inference you do not want a prospective member drawing about the club page their organiser just shared.

## The Hebrew on the homepage cannot decide who it is talking to

Within a single scroll, `public/index.html` uses three different modes of address.

The headings and the beta copy use plural imperative — `פותחים`, `מזמינים`, `הצטרפו`, `שלחו`. Three feature cards switch to masculine singular second person: `אתה רואה את המשחק הבא, נרשם, ויודע אם אתה ברשימה הראשית` (`:476`), `ואתה ראשון בהמתנה` (`:508`), `כמה משחקים שיחקת` (`:519`). And the beta card flips inside itself — the H2 is `רוצה להיות מהראשונים לנסות?` (masculine singular) and the body directly beneath it is `שלחו לי את כתובת המייל שלכם` (plural). One card, two people being addressed.

Layered on top, the voice swaps from corporate to one guy: `שלחו **לי**… **אוסיף** אתכם לרשימת הבודקים`, then `© Studio Games Lime` in the footer. A reader cannot tell whether Teamder is a company or someone's side project, because the page is written by both.

The invite page, by contrast, holds one voice throughout. Whoever wrote `invite.html` knew what they were doing; the homepage reads like it was assembled earlier, by a different hand, and never revised.

## Every link Teamder emits previews as a small square

`file public/logo.png` → 512×512. Every `og:image` on the estate points at it: `index.html:10`, `get.html:16`, `invite.html:11`, and the SSR functions fall back to it too — including `serveInviteCode`'s `session` branch, which sets no `og:image` at all.

WhatsApp renders a square image as a small thumbnail beside the text, not as the wide hero card that makes a forwarded link look like a real product. Since `/i/{code}` is the form of every share the app emits (`src/services/inviteLinkService.ts:58`), this is the first impression the majority of Teamder's new users actually receive — a tiny logo chip next to a `.web.app` URL. Meanwhile `invite.html:13` declares `twitter:card: summary_large_image`, requesting a wide card it has no wide image to fill; `index.html` declares no card type and no `og:locale` at all.

## What I would not touch

`public/invite.html` is good and it should be left alone.

The headline `כדורגל קבוע. בלי כאב הראש של הארגון.` followed by a real phone showing a real fixture screen answers "what is this" before the visitor has decided whether to keep reading. The trust line `חינם · Android ו־iPhone · עברית מלאה` (`:164`) resolves price, platform and language in one glance — three objections killed in seven words. The `מ־40 הודעות למשחק אחד מסודר` section (`:171-180`) does something rare: it renders the visitor's actual pain as three WhatsApp bubbles in their own words — `מי מגיע?`, `חסר לנו אחד`, `מי מביא כדור?` — and then answers them with a filled-game card. That is a person who has organised a weekly football game writing for people who organise weekly football games.

The iOS handling at `:231` deserves specific protection. The code skips the `footy://` attempt on iOS entirely, and the comment explains why: Safari shows a visible "cannot open page" error for an unhandled scheme, and an invite recipient never has the app yet. Someone noticed that the alternative was showing every new iPhone user an error dialog as their first interaction with the brand, and chose the App Store instead. That is precisely the trust instinct the rest of the estate needs, and it should not be "optimised" away by a later reviewer who notices that installed iOS users get bounced to the store.

One small thing does deserve a second look even here: `כאב הראש של הארגון` is slightly stiff — `הארגון` as a noun reads most naturally as "the organisation" (the body) rather than "organising", so the phrase momentarily parses as *the organisation's headache*. `בלי כאב הראש שבארגון`, or simply `בלי הבלגן` to echo the brand line, lands cleaner.

## The dead terms link

`invite.html:191` ends every invited user's page with `<a href="/terms.html">תנאי שימוש</a>`. `find` across the repo returns no `terms*.html` and the live URL returns **404**.

This is the page that receives every invited user Teamder has. Its footer offers Terms of Service, and Terms of Service is a Firebase 404 in English. For anyone who checks such things before installing — and the people who check are exactly the cautious ones you most need to convince — that is the answer they get.

## Where I would start

In order of trust recovered per hour spent:

1. Delete the ad placeholder (`c/index.html:911-913`). Minutes.
2. Fix or remove the dead terms link (`invite.html:191`). Minutes.
3. Replace the beta section on `/` with the two real store buttons that already exist in `invite.html:187-188`. Hours.
4. Put `app-preview.png` in the homepage hero, using the phone-mock CSS already in `invite.html`. Hours.
5. Make one pass over the homepage Hebrew for a single mode of address. Hours.
6. Produce one 1200×630 OG image and point every surface at it. Half a day.

Steps 1 through 4 are a day's work and they close the gap between what Teamder is and what a stranger thinks it is.