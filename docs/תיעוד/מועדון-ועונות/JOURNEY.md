# The first five minutes

**Everything a new Teamder user meets, from the link they are sent to the moment they could register for a game.**

A scan, not a proposal. Nothing in this document recommends a change; it records what exists on
20.09.2026 so that someone can decide what to change. Where two things do the same job, both are
described and neither is preferred.

---

## How this was produced

Everything below was observed on a real device against the real production backend, or read from
the source that runs it.

| | |
|---|---|
| **Device** | Android emulator, Pixel-class, 1080×2400, API 36, Hebrew locale, RTL |
| **Build** | `1.1.10`, versionCode **236**, `installerPackageName=com.android.vending` — installed **from the Google Play Store**, not sideloaded. This is the binary a real person downloads today. |
| **Starting state** | App fully uninstalled, then installed from Play. For the signup run, `pm clear` wiped all app data first. No account, no cache, no prior state. |
| **Account** | A brand-new account created during the run: `e2e.journey.1789851838@example.com`, display name `Bodek Masa`. Nothing was reused. |
| **Backend** | Live production, project `soccer-app-52b6b`. Every number quoted from the database was read at the time of the walk. |
| **Web** | The live host, `https://teamderfc.web.app`. There is no custom domain. |
| **Date** | 19–20.09.2026 |

### What was deliberately not done

Two things, both for the same reason.

**No game was actually joined.** The only public open game in the entire production database
belongs to `רבעי כדורגל בנחלים`, a real seven-member club with real players. Registering a test
account for it would have put a fake player in a real organiser's squad — which is precisely the
problem documented separately this week, where Google Play's pre-launch robot did exactly that
three times. The journey is therefore traced up to and including the join button and its every
state; the tap itself was not made.

**The name was typed in Latin characters.** `adb shell input text` cannot send Hebrew, and the
alternative keyboard breaks React Native form inputs. `Bodek Masa` therefore stands in for what a
real user would type. Nothing else in the run was substituted.

### A note on the ad slots

Every in-app screenshot shows a banner reading **`Test Ad`**. That is AdMob recognising an
emulator and serving its test placeholder; it is not what a real device shows. No conclusion about
real ad behaviour, placement pressure or revenue can be drawn from these images — only about the
space the banner occupies, which is real.

---

# Part 1 · The web estate

## Every public route, and what actually answers it

Seventeen routes were requested live and their responses measured. `cleanUrls` is on, so `/get`
and `/get.html` are the same document.

| Route | HTTP | Bytes | Served by | `<title>` |
|---|---|---:|---|---|
| `/` · `/index.html` | 200 | 21,253 | `public/index.html` | Teamder — מארגנים משחקי כדורגל בלי בלגן |
| `/get` · `/get.html` | 200 | 3,555 | `public/get.html` | Teamder · הורדה |
| `/app` | 200 | 25,741 | `public/invite.html` | Teamder · מארגנים כדורגל בלי כאב ראש |
| `/go` | 200 | 25,741 | `public/invite.html` | *(identical)* |
| `/invite.html` | 200 | 25,741 | `public/invite.html` | *(identical)* |
| `/session/<gameId>` | 200 | 25,741 | `public/invite.html` | *(identical)* |
| `/i/<code>` · app link | 200 | 25,818 | `serveInviteCode` CF | Eliran Tzabari מזמין אותך ל־Teamder |
| `/i/<code>` · game link | 200 | 25,831 | `serveInviteCode` CF | הוזמנת למשחק: רבעי כדורגל בנחלים |
| `/c/` · `/c/index.html` | 200 | 53,676 | `public/c/index.html` | קהילה ב־Teamder |
| `/c/<clubId>` | 200 | 53,556 | `serveCommunityPage` CF | מועדון שכחת שושי · Teamder |
| `/team/<clubId>` | 200 | **25,522** | `serveCommunityPage` CF | מועדון שכחת שושי · Teamder |
| `/privacy` | 200 | 29,069 | `public/privacy.html` | מדיניות פרטיות — Teamder |
| `/delete-account` | 200 | 9,603 | `public/delete-account.html` | מחיקת חשבון — Teamder |
| `/invite-preview` | 200 | 18 | `getInvitePreview` CF | *(JSON)* |

Two rows deserve to be read twice.

`/c/<clubId>` and `/team/<clubId>` are **the same club, from the same Cloud Function, rendered as
two completely different pages** — 53,556 bytes against 25,522. Requesting a club id that does not
exist returns 53,664 and 25,613 respectively, both titled `מועדון ב־Teamder`, which confirms both
paths reach `serveCommunityPage` and that the function branches on the prefix.

## How much of each page is the same page

Every route was fetched and compared byte-for-byte against every other. The figure is text
similarity; 100% means the documents are effectively the same file.

|  | `/` | `/get` | `/app` | `/i` app | `/i` game | `/team` | `/c/` | `/c/<id>` |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **`/`** | — | 28% | 66% | 66% | 66% | 66% | 54% | 54% |
| **`/get`** | 28% | — | 24% | 24% | 24% | 24% | 12% | 12% |
| **`/app`** | 66% | 24% | — | **100%** | **100%** | **100%** | 64% | 64% |
| **`/i` app** | 66% | 24% | **100%** | — | **100%** | 99% | 64% | 64% |
| **`/i` game** | 66% | 24% | **100%** | **100%** | — | 99% | 64% | 64% |
| **`/team`** | 66% | 24% | **100%** | 99% | 99% | — | 64% | 64% |
| **`/c/`** | 54% | 12% | 64% | 64% | 64% | 64% | — | **100%** |
| **`/c/<id>`** | 54% | 12% | 64% | 64% | 64% | 64% | **100%** | — |

Four families fall out of it:

1. **The invite template** — `/app`, `/go`, `/session/**`, `/invite.html`, `/i/<code>` in both its
   flavours, **and `/team/<clubId>`**. Six public entry points and one Cloud Function all render
   one file, `public/invite.html`, with at most 300 bytes of personalisation injected.
2. **The community template** — `/c/` and `/c/<clubId>`, identical to each other and 36% apart
   from the invite family.
3. **The homepage** — `public/index.html`, its own thing, two-thirds shared chrome.
4. **The download page** — `public/get.html`, 3.5 KB, sharing almost nothing with anything.

So a club shared through `/team/` and the same club shared through `/c/` are not variants of one
design. They are two products.

## The homepage — `/`

<div class="strip cols4">
  <figure><img src="web/P1-index-00.jpg" alt="The fold"><figcaption>The fold</figcaption></figure>
  <figure><img src="web/P1-index-01.jpg" alt="What you need"><figcaption>What you need</figcaption></figure>
  <figure><img src="web/P1-index-02.jpg" alt="Feature cards"><figcaption>Feature cards</figcaption></figure>
  <figure><img src="web/P1-index-03.jpg" alt="More cards"><figcaption>More cards</figcaption></figure>
</div>


<div class="strip cols4">
  <figure><img src="web/P1-index-04.jpg" alt="Three minutes"><figcaption>Three minutes</figcaption></figure>
  <figure><img src="web/P1-index-05.jpg" alt="The beta ask"><figcaption>The beta ask</figcaption></figure>
  <figure><img src="web/P1-index-06.jpg" alt="WhatsApp CTA"><figcaption>WhatsApp CTA</figcaption></figure>
  <figure><img src="web/P1-index-07.jpg" alt="Footer"><figcaption>Footer</figcaption></figure>
</div>


The primary button on the first screen is **`הצטרפו כבודקי בטא`** — join as beta testers. The
secondary is `מה יש באפליקציה`, an in-page anchor. Neither leaves the page, and neither is a
download: this document contains no link to Google Play or to the App Store at all. The page that
a person reaches by typing the brand name offers no way to get the app, while the app has been
publicly listed on both stores for months.

The conversion path instead is a WhatsApp message to a personal Israeli mobile number, asking the
visitor to send the Google account address attached to their device so they can be added to a
closed tester list.

## The download page — `/get`

<div class="strip cols4">
  <figure><img src="web/P2-get-00.jpg" alt="Top"><figcaption>Top</figcaption></figure>
  <figure><img src="web/P2-get-01.jpg" alt="Store buttons"><figcaption>Store buttons</figcaption></figure>
  <figure><img src="web/P2-get-02.jpg" alt="Below"><figcaption>Below</figcaption></figure>
  <figure><img src="web/P2-get-03.jpg" alt="End"><figcaption>End</figcaption></figure>
</div>

`/get` does not render on a phone. It sniffs the user agent and calls `location.replace()` on the
store URL, so an Android visitor is thrown to
`play.google.com/store/apps/details?id=com.studiogameslime.soccerapp` before the page paints —
which is why the frames above are the Play listing and not the page. The 3,555 bytes of
`Teamder · הורדה` are only ever seen on a desktop browser, where both store buttons are shown
side by side.

This makes `/get` the only surface on the estate whose sole job is to deliver the app, and nothing
on the homepage links to it.



## The invite template — `/app`, and the same file under five other names

<div class="strip cols4">
  <figure><img src="web/P3-app-generic-00.jpg" alt="`/app` fold"><figcaption>`/app` fold</figcaption></figure>
  <figure><img src="web/P3-app-generic-01.jpg" alt="Phone mock"><figcaption>Phone mock</figcaption></figure>
  <figure><img src="web/P3-app-generic-02.jpg" alt="Features"><figcaption>Features</figcaption></figure>
  <figure><img src="web/P3-app-generic-03.jpg" alt="Stores"><figcaption>Stores</figcaption></figure>
</div>


<div class="strip cols4">
  <figure><img src="web/P4-invite-app-00.jpg" alt="`/i/<code>` — personal invite"><figcaption>`/i/<code>` — personal invite</figcaption></figure>
  <figure><img src="web/P5-invite-game-00.jpg" alt="`/i/<code>` — game invite"><figcaption>`/i/<code>` — game invite</figcaption></figure>
  <figure><img src="web/P6-session-00.jpg" alt="`/session/<gameId>`"><figcaption>`/session/<gameId>`</figcaption></figure>
  <figure><img src="web/P8-club-team-00.jpg" alt="`/team/<clubId>`"><figcaption>`/team/<clubId>`</figcaption></figure>
</div>
<p class="stripcap">Four different URLs, four different purposes, one template. Only the headline and a line of subtext change; `/team/<clubId>` does not even name the club in its hero, which reads `הוזמנת להצטרף למועדון`.</p>


## The two club pages

<div class="strip cols4">
  <figure><img src="web/P7-club-c-00.jpg" alt="`/c/<id>` on arrival — a spinner reading `טוען את הקהילה...`"><figcaption>`/c/<id>` on arrival — a spinner reading `טוען את הקהילה...`</figcaption></figure>
  <figure><img src="web/P7-club-c-03.jpg" alt="`/c/<id>` once loaded"><figcaption>`/c/<id>` once loaded</figcaption></figure>
  <figure><img src="web/P8-club-team-00.jpg" alt="`/team/<id>` — server-rendered, dark"><figcaption>`/team/<id>` — server-rendered, dark</figcaption></figure>
  <figure><img src="web/P8-club-team-01.jpg" alt="`/team/<id>` below the fold"><figcaption>`/team/<id>` below the fold</figcaption></figure>
</div>
<p class="stripcap">The same club. Left pair: 53 KB, light, ships a Firebase SDK and fetches the club in the browser, so the visitor watches a spinner. Right pair: 25 KB, dark, the club's name already in the HTML five times.</p>


<div class="strip cols4">
  <figure><img src="web/P7-club-c-05.jpg" alt="Squad"><figcaption>Squad</figcaption></figure>
  <figure><img src="web/P7-club-c-08.jpg" alt="Table"><figcaption>Table</figcaption></figure>
  <figure><img src="web/P7-club-c-11.jpg" alt="Stats"><figcaption>Stats</figcaption></figure>
  <figure><img src="web/P7-club-c-14.jpg" alt="Footer"><figcaption>Footer</figcaption></figure>
</div>
<p class="stripcap">`/c/<clubId>` continued — the richer of the two pages, and the one a visitor waits for.</p>


## Privacy and account deletion

<div class="strip cols4">
  <figure><img src="web/P9-privacy-00.jpg" alt="`/privacy`"><figcaption>`/privacy`</figcaption></figure>
  <figure><img src="web/P9-privacy-02.jpg" alt="…"><figcaption>…</figcaption></figure>
  <figure><img src="web/PA-delete-00.jpg" alt="`/delete-account`"><figcaption>`/delete-account`</figcaption></figure>
  <figure><img src="web/PA-delete-01.jpg" alt="…"><figcaption>…</figcaption></figure>
</div>


---

# Part 2 · Getting the app

## The Play Store listing


<div class="strip cols4">
  <figure><img src="web/S1-playstore-listing.jpg" alt="The listing"><figcaption>The listing</figcaption></figure>
  <figure><img src="web/S2-store-00.jpg" alt="Screenshots"><figcaption>Screenshots</figcaption></figure>
  <figure><img src="web/S2-store-02.jpg" alt="Description"><figcaption>Description</figcaption></figure>
  <figure><img src="web/S2-store-04.jpg" alt="Ratings"><figcaption>Ratings</figcaption></figure>
</div>
<p class="stripcap">Listed as `Teamder - מארגנים כדורגל בקלות` by `Lime Studio Games`, flagged `Contains ads`. The *About this app* section rendered in English — `Organizing a soccer game without a headache`.</p>


## What the app itself sends people

The in-app share sheet, reached from `הזמן חברים לאפליקציה` on the home screen, produces exactly
this text:

```
אני משחק כדורגל בעזרת אפליקציית Teamder ⚽
תוריד גם אתה ובוא לשחק:
https://teamderfc.web.app/i/lttfR4K?invitedBy=tJINwzgzl6bXHW02WhhjbkbA8yx1
```


<div class="strip cols1">
  <figure><img src="web/H2-invite-sheet.jpg" alt="The share sheet, with the generated text"><figcaption>The share sheet, with the generated text</figcaption></figure>
</div>


Three things are visible in that string: the host is a raw `.web.app` Firebase subdomain; the
28-character sender uid travels in the query string in the clear; and the verb `תוריד` is
masculine singular, while the app's own onboarding two screens earlier used plural imperative
(`שחקו`, `גלו`).

The link resolves to `/i/<code>`, which is the invite template in Part 1 — the loop closes.

---

# Part 3 · The first run

The app was uninstalled, installed from Play, and opened. Everything from here is that session.

## Cold start


<div class="strip cols4">
  <figure><img src="web/A1-launch-t1s.jpg" alt="t+1s"><figcaption>t+1s</figcaption></figure>
  <figure><img src="web/A1-launch-t3s.jpg" alt="t+3s"><figcaption>t+3s</figcaption></figure>
  <figure><img src="web/A1-launch-t6s.jpg" alt="t+6s"><figcaption>t+6s</figcaption></figure>
  <figure><img src="web/A1-launch-t10s.jpg" alt="t+10s — first content"><figcaption>t+10s — first content</figcaption></figure>
</div>
<p class="stripcap">Roughly ten seconds from tap to the first onboarding slide on a cold start.</p>


## The onboarding carousel — three slides

<div class="strip cols3">
  <figure><img src="web/A2-onboard-01.jpg" alt="Slide 1"><figcaption>Slide 1</figcaption></figure>
  <figure><img src="web/A2-onboard-02.jpg" alt="Slide 2"><figcaption>Slide 2</figcaption></figure>
  <figure><img src="web/A2-onboard-03.jpg" alt="Slide 3"><figcaption>Slide 3</figcaption></figure>
</div>


| # | Heading | Body | Buttons |
|---|---|---|---|
| 1 | `שחקו עם אנשים בקרבת מקום` | `גלו מחזורי כדורגל פתוחים באזור שלכם והצטרפו בלחיצה — או פגשו שחקנים חדשים לידכם` | `דלג` · `הבא` |
| 2 | `מועדון קבוע, מחזור אוטומטי` | `בנו את הסגל הקבוע שלכם — והמחזור השבועי נפתח לבד עם הזמנה לכולם` | `דלג` · `הבא` |
| 3 | `הכל זורם מעצמו` | `מישהו ביטל? המקום מתמלא אוטומטית מרשימת ההמתנה עם תזכורות חכמות שדואגות שכולם יגיעו` | *(no skip)* · `המשך` |

The `דלג` link is present on slides 1 and 2 and **absent on slide 3**, where the button also
changes from `הבא` to `המשך`.

## The sign-in screen


<div class="strip cols1">
  <figure><img src="web/A3-after-carousel.jpg" alt="Three ways in"><figcaption>Three ways in</figcaption></figure>
</div>


```
בואו נכיר
התחבר כדי להירשם, להצטרף למועדון ולעקוב אחרי הסטטיסטיקות שלך.

   [ המשך עם Google ]
   [ המשך עם מייל   ]
   [ המשך כאורח     ]

באמצעות התחברות אתה מסכים לתנאי השימוש
```

The heading addresses a group (`בואו נכיר`) and the sentence beneath it addresses one man
(`התחבר… שלך`), two lines apart.

## Branch A — `המשך כאורח`


<div class="strip cols4">
  <figure><img src="web/A4-guest-01.jpg" alt="On entering guest mode"><figcaption>On entering guest mode</figcaption></figure>
  <figure><img src="web/A7-guest2-bayit.jpg" alt="Tab: בית"><figcaption>Tab: בית</figcaption></figure>
  <figure><img src="web/A7-guest2-moadonim.jpg" alt="Tab: מועדונים"><figcaption>Tab: מועדונים</figcaption></figure>
  <figure><img src="web/A7-guest2-machzorim.jpg" alt="Tab: מחזורים"><figcaption>Tab: מחזורים</figcaption></figure>
</div>
<p class="stripcap">Three of the four tabs render the identical wall.</p>


<div class="strip cols2">
  <figure><img src="web/A7-guest2-chats.jpg" alt="Tab: צ'אטים — the only tab with its own screen"><figcaption>Tab: צ'אטים — the only tab with its own screen</figcaption></figure>
  <figure><img src="web/A6-availability-modal.jpg" alt="The availability modal, which also fires for a guest"><figcaption>The availability modal, which also fires for a guest</figcaption></figure>
</div>


Every one of `בית`, `מועדונים` and `מחזורים` shows the same card:

```
הפרופיל שלך מחכה
אתה גולש כאורח. הירשם כדי לשמור מחזורים, להצטרף למועדונים ולבנות פרופיל שחקן.
                       [ הרשמה ]
```

Only `צ'אטים` renders anything of its own, and what it renders is
`אין עדיין שיחות / שיחות של מחזורים ומועדונים שאתה חבר בהם יופיעו כאן`. A guest can therefore see
one empty list and three copies of a sign-up prompt. The open-games feed, which is the thing the
first onboarding slide promised, is not among them.

## Branch B — `המשך עם מייל`


<div class="strip cols4">
  <figure><img src="web/B3-email-screen.jpg" alt="Opens in sign-IN mode"><figcaption>Opens in sign-IN mode</figcaption></figure>
  <figure><img src="web/B4-signup-mode.jpg" alt="After tapping `אין לך חשבון? הרשמה`"><figcaption>After tapping `אין לך חשבון? הרשמה`</figcaption></figure>
  <figure><img src="web/B5-signup-filled.jpg" alt="Filled"><figcaption>Filled</figcaption></figure>
  <figure><img src="web/B6-after-signup.jpg" alt="Google password manager"><figcaption>Google password manager</figcaption></figure>
</div>


The email screen opens as **`התחברות עם מייל`** — sign in — with `שכחת סיסמה?` and a `התחבר`
button. A person who has just chosen "continue with email" from a screen headed `בואו נכיר` is
looking at a login form for an account they do not have. The way forward is the last line on the
screen: `אין לך חשבון? הרשמה`.

Tapping it switches the same screen to `הרשמה עם מייל` and adds a third field, `אימות סיסמה`
(`הקלד שוב את הסיסמה`). Password rule: `לפחות 6 תווים`.

## What fires immediately after the account exists

<div class="strip cols4">
  <figure><img src="web/B8-push-prompt.jpg" alt="The push permission prompt"><figcaption>The push permission prompt</figcaption></figure>
  <figure><img src="web/B9-after-push.jpg" alt="`בוא נכיר` — the profile screen"><figcaption>`בוא נכיר` — the profile screen</figcaption></figure>
  <figure><img src="web/C1-profile-top.jpg" alt="Name and photo"><figcaption>Name and photo</figcaption></figure>
  <figure><img src="web/C2-profile-bottom.jpg" alt="25 avatars"><figcaption>25 avatars</figcaption></figure>
</div>


The order is: account created → Google's password-manager sheet → **the notification permission
prompt** → the profile screen. The push prompt arrives before the user has seen a single game, a
single club, or anything the app is for. It is the system dialog, so it is in English:
`Allow Teamder to send you notifications?`

The profile screen is headed `בוא נכיר` — masculine singular this time — with the subtitle
`מארגנים כדורגל שכונתי בלי בלגן — הרשמה, ספסל, קבוצות, שוערים וטיימר.` It asks for:

- **`שם *`** (`איך לקרוא לך?`) — required, the only required field
- **`תמונת השחקן`** — `העלאה מהגלריה`, optional
- **`או בחר אווטאר`** — a grid of **25** emoji avatars, one preselected

## The count

From the app icon to the home screen, with no detours:

| # | Action |
|---|---|
| 1 | Tap the icon; wait ~10 s |
| 2 | `הבא` (slide 1) |
| 3 | `הבא` (slide 2) |
| 4 | `המשך` (slide 3) |
| 5 | `המשך עם מייל` |
| 6 | `אין לך חשבון? הרשמה` |
| 7 | Tap the email field; **type an address** |
| 8 | Tap the password field; **type a password** |
| 9 | Tap the confirm field; **type it again** |
| 10 | `הרשמה` |
| 11 | Dismiss the Google password sheet |
| 12 | Answer the notification prompt |
| 13 | Tap the name field; **type a name** |
| 14 | `המשך` |

**Fourteen interactions, four of them text entry**, before the first screen that contains a game.
Choosing `דלג` on the carousel removes two, and Google sign-in removes the three text entries —
but on this emulator the only Google account available was the device owner's, so that branch was
not walked with a new identity.

---

# Part 4 · From an account to a game

## The home screen a brand-new user lands on


<div class="strip cols3">
  <figure><img src="web/C3-after-profile.jpg" alt="Top of home"><figcaption>Top of home</figcaption></figure>
  <figure><img src="web/C4-home-00.jpg" alt="Same, settled"><figcaption>Same, settled</figcaption></figure>
  <figure><img src="web/C4-home-01.jpg" alt="Lower half"><figcaption>Lower half</figcaption></figure>
</div>


```
הודעה מהמאמן
לילה טוב Bodek, יש כדורגל מסביבך 👀
הגיע הזמן למצוא את החבר׳ה שלך ⚽
                              [ גלה מועדונים ]

   [ הצטרף למחזור ]   [ סמן זמינות ]   [ פתח מחזור ]

רוצה לראות מי פנוי לשחק לידך?
הגדר את האזור והזמנים שנוח לך — ונראה לך כמה שחקנים פנויים בכל חלון, כדי לפתוח מחזור בקלות.
                              [ הגדר זמינות ]

בוא נתחיל ⚡                                            0/5
כמה צעדים קטנים כדי להפיק את המקסימום
   ▢ הוספת תמונת פרופיל
   ▢ סמן מתי אתה פנוי
   ▢ הצטרף או פתח מועדון
   ▢ הצטרף או צור מחזור ראשון
   ▢ הבא חבר למגרש

ידעת ש...
אפשר ליצור כוחות מאוזנים אוטומטית לפי דירוג השחקנים

                      [ הזמן חברים לאפליקציה ]
```

The coach card is not fixed text — on a later visit in the same session it read
`לילה טוב Bodek, ברוך הבא ל-Teamder! 👋`.

## The availability modal


<div class="strip cols2">
  <figure><img src="web/D1-games-tab.jpg" alt="Opening `מחזורים` for the first time"><figcaption>Opening `מחזורים` for the first time</figcaption></figure>
  <figure><img src="web/D2-availability-gate.jpg" alt="The modal, full"><figcaption>The modal, full</figcaption></figure>
</div>


Opening the `מחזורים` tab for the first time does not show games. It shows this, over them:

```
מתי בא לך לשחק? 📅
סמן את הימים שאתה פנוי לשחק — ונציע לך אוטומטית מחזורים שמתאימים בדיוק לזמן שלך.
   📅 הצעות מחזור לפי הימים שלך
   📢 מנהלים יראו שאתה פנוי ויזמינו אותך
   ⚽ פחות לפספס — יותר לשחק
              [ סמן את הימים שלי ]
                   אחר כך
```

It is the third separate prompt to set availability in this session — the home screen carries a
card for it and the `בוא נתחיל` checklist carries a row for it.

**An observation that needs a second look before it is treated as a bug.** In this session the
`אחר כך` link did not dismiss the modal. It is reported as `clickable=true` at (539, 1783); it was
tapped eight times over roughly twenty seconds, and the modal was still on screen after each. The
hardware back key closed it instantly. In the earlier guest-mode run the same link *did* dismiss
it. So this is not a dead control in every session — but in one of two runs, a new user's only way
past the modal was the back button. The modal is once-per-install, so it could not be re-triggered
to test a third time.

## The open-games feed


<div class="strip cols4">
  <figure><img src="web/D4-feed-00.jpg" alt="The feed, top"><figcaption>The feed, top</figcaption></figure>
  <figure><img src="web/D4-feed-01.jpg" alt="Below"><figcaption>Below</figcaption></figure>
  <figure><img src="web/D4-feed-03.jpg" alt="Clubs to join"><figcaption>Clubs to join</figcaption></figure>
  <figure><img src="web/D4-feed-06.jpg" alt="Further down"><figcaption>Further down</figcaption></figure>
</div>


This is the screen the first onboarding slide promised — `גלו מחזורי כדורגל פתוחים באזור שלכם`.
Under `מחזורים פתוחים` there is **one card**:

```
רבעי כדורגל בנחלים                                   1/15
📍 חרמון, נחלים
📅 23.09 · 20:00
[פתוח לכולם] [סינטטי] [5 × 5]                 [ בקש להצטרף ]
```

Beneath it: `לא מצאת מחזור מתאים? / צור מחזור חדש ותן לאחרים להצטרף`.

**That is not a filter artefact.** A query against production at the moment of the walk returned
every game in the database with `status: 'open'`:

| Starts | Visibility | Players | Title | Club |
|---|---|---:|---|---|
| 24.09 21:00 | `community` | 0/15 | הנגריה | `sEj71nwAJGpxX8oh4KlF` |
| 23.09 20:00 | **`public`** | 1/15 | רבעי כדורגל בנחלים | `aiOYt3TRTURBrXiEnYQa` |

Two open games exist in the whole of Teamder. One is community-only. **A new user anywhere in
Israel is shown exactly one joinable game, and it belongs to a seven-member club in נחלים with one
player signed up.**

This is worth connecting to a separate finding from the same week: Google Play's pre-launch robot
signed up 47 times between June and September and joined games in real clubs. Three of those
landed on this same Nahalim fixture. It was not choosing badly — it was taking the only door the
app opens.

## The game, and the join gate


<div class="strip cols4">
  <figure><img src="web/F1-game-detail.jpg" alt="`פרטי מחזור`"><figcaption>`פרטי מחזור`</figcaption></figure>
  <figure><img src="web/F2-detail-00.jpg" alt="Squad"><figcaption>Squad</figcaption></figure>
  <figure><img src="web/F2-detail-01.jpg" alt="Below"><figcaption>Below</figcaption></figure>
  <figure><img src="web/F2-detail-02.jpg" alt="End"><figcaption>End</figcaption></figure>
</div>


```
פרטי מחזור
רבעי כדורגל בנחלים
יום רביעי | 23.09.26 · 20:00

המחזור מחפש שחקנים להשלמה
הגש מועמדות — מנהל המחזור יאשר אותך ידנית.
                    [ בקש להצטרף ]

  מזג אוויר 25°      משך משחק 8 דק׳      שחקנים 1/15

ההרכב (1/15)                                  הצג הכל
   ⚽ עידן אלמליח · מנהל
```

This is where the walk stops, one tap short. The button is `בקש להצטרף`, the game requires manual
approval (`requiresApproval: true`), and a tap would put a test account in a real organiser's
approval queue.

## Creating a game instead


<div class="strip cols1">
  <figure><img src="web/E1-create-game-gate.jpg" alt="The `+` button's destination"><figcaption>The `+` button's destination</figcaption></figure>
</div>


```
יצירת מחזור חדש
לפני שתוכל ליצור מחזור, צריך להצטרף למועדון
   [ צור מחזור חד־פעמי ]
     בלי מועדון — מהיר, רק עבור המחזור
```

The screen states a requirement and then, one line down, offers the way around it.

## The clubs tab


<div class="strip cols4">
  <figure><img src="web/G1-clubs-00.jpg" alt="`מועדונים`, top"><figcaption>`מועדונים`, top</figcaption></figure>
  <figure><img src="web/G1-clubs-02.jpg" alt="Discovery"><figcaption>Discovery</figcaption></figure>
  <figure><img src="web/G1-clubs-05.jpg" alt="Further"><figcaption>Further</figcaption></figure>
  <figure><img src="web/G1-clubs-08.jpg" alt="End"><figcaption>End</figcaption></figure>
</div>


## The profile card


<div class="strip cols1">
  <figure><img src="web/H1-profile.jpg" alt="`ערוך כרטיס שחקן` — the same avatar grid as setup"><figcaption>`ערוך כרטיס שחקן` — the same avatar grid as setup</figcaption></figure>
</div>



---

# Part 5 · The same ground, read from the source

Part 3 and Part 4 are what a person sees. This part is what the code says, mapped file by file by
five independent readers working from the repository at `HEAD`. Every claim carries a `file:line`.
Where a reader could not settle a question from code alone it is listed as an open question at the
end of its section rather than guessed at.

Read this part when you want to know *why* a screen behaves as it does, or what a branch the
device walk did not take would have shown.


## 5.1 · In the app — first launch to a usable account

## The app from first launch to a usable account

Repo root `/Users/matan/Projects/soccer`. All paths below are absolute-from-repo-root. App version in `app.json` at the time of reading: `"version": "1.1.10"` (`/Users/matan/Projects/soccer/app.json`, `expo.version`).

Every Hebrew string is quoted verbatim from source with its `file:line`. Strings that live in `src/i18n/he.ts` are given as `key: 'value'` at their `he.ts` line, plus the line of the screen that renders them.

---

### 0. What runs before any pixel of ours is drawn

These fire at **module load of `App.tsx`**, i.e. before React mounts, before the user has seen or agreed to anything.

| Order | What | File:line | Notes |
|---|---|---|---|
| 1 | `void joryio.init();` | `App.tsx:17` | Joryio analytics/messaging SDK starts **before the first screen, before sign-in, before any consent UI**. Implementation: `src/services/joryio.ts:103-118` (`initJoryio` → `Joryio.initialize(KEY, API_HOST, {...})`). SDK keys are hardcoded literals as fallback at `src/services/joryio.ts:39-49`. |
| 2 | `ExpoSplash.preventAutoHideAsync()` | `App.tsx:19-21` | Holds the OS splash up until our React splash paints. |
| 3 | `LogBox.ignoreLogs([...])` | `App.tsx:29-39` | Dev-only noise suppression. |
| 4 | `Notifications.setNotificationHandler({...})` | `App.tsx:67-137` | Foreground push behaviour. Does **not** request permission. |
| 5 | `Notifications.setNotificationCategoryAsync('NEW_GAME_RSVP', [...])` | `App.tsx:164-175` | Registers the action button `buttonTitle: 'אני מגיע'` (`App.tsx:167`). |
| 6 | `Notifications.setNotificationCategoryAsync('SPOT_OFFER', [...])` | `App.tsx:180-193` | Action buttons `buttonTitle: 'מאשר/ת'` (`App.tsx:185`) and `buttonTitle: 'ויתור'` (`App.tsx:190`). |
| 7 | `I18nManager.allowRTL(true)` / `forceRTL(true)` | `App.tsx:253-258` | RTL forced on first launch. Comment at `App.tsx:256-257` notes a forced RTL switch normally needs a JS reload. |
| 8 | Global `Text` / `TextInput` `defaultProps` → `textAlign:'right'`, `writingDirection:'rtl'` | `App.tsx:274-295` | Every string in the app is right-aligned by default. |
| 9 | `installGlobalErrorHandlers()` | `App.tsx:305` | Crash + unhandled-rejection catch-all. |

**Firebase App Check** initialises lazily the first time `getFirebase()` runs — `src/firebase/config.ts:156-163` (`const { initAppCheck } = require('./appCheck'); void initAppCheck(_app);`).

**Firebase Analytics** is the native `@react-native-firebase/analytics` SDK (`src/services/analyticsService.ts:13-17`); there is no in-app analytics opt-in before it collects.

**There is no App Tracking Transparency prompt on iOS.** Verified by grep across `src`, `App.tsx`, `app.json`, `plugins`: no `requestTrackingPermissionsAsync`, no `expo-tracking-transparency`, no `NSUserTrackingUsageDescription`.

**There is no AdMob UMP / GDPR consent form.** `adsService.initializeAds()` (`src/services/adsService.ts:327-394`) calls `sdk.initialize()` (`:379`) and creates the app-open ad with `requestNonPersonalizedAdsOnly: true` (`:383`) — no consent-info-update, no form.

---

### 1. Screen 1 — Native OS splash

- **File / config:** `/Users/matan/Projects/soccer/app.json` → `expo.splash = {"image": "./splash-blank.png", "resizeMode": "contain", "backgroundColor": "#1E40AF"}`.
- **Shown:** always, at process start, on every launch.
- **Content:** the image file is literally named `splash-blank.png` — the visible result is a flat `#1E40AF` blue field.
- **Strings:** none.
- **Controls:** none. Not skippable, not backable.
- **Dismissed by:** `ExpoSplash.hideAsync()` called from inside our React splash's first effect — `src/screens/SplashScreen.tsx:372-374`. The comment at `App.tsx:393-397` explains this is deliberate, so there is no black flash between native dismiss and React first paint.
- Android adaptive icon / Android splash background also `#1E40AF` (`app.json`, `expo.android.adaptiveIcon.backgroundColor`).

---

### 2. Screen 2 — Animated splash (`SplashScreen`)

- **File:** `/Users/matan/Projects/soccer/src/screens/SplashScreen.tsx`
- **Mounted from:** `App.tsx:1006-1011` — `{!splashDone ? <SplashScreen ready={userHydrated && (!currentUserId || groupHydrated)} onFinish={handleSplashFinish} /> : null}`. It renders **over** `RootNavigator`, which mounts and hydrates behind it (`App.tsx:989-1005`).
- **Shown:** always, every cold start.
- **Duration:** minimum hold `const MIN_HOLD_MS = 1400;` (`src/screens/SplashScreen.tsx:41`), then a `FADE_MS = 320` fade-out (`:42`). The fade only starts once `ready` is true (`:376-398`). For a signed-out fresh install, `ready` = `userHydrated` alone, because of the `!currentUserId` short-circuit at `App.tsx:1008` (documented at `App.tsx:996-1005` — waiting on `groupHydrated` would pin the splash forever for a signed-out user, since `hydrateGroup` only runs once a `currentUser` exists, `RootNavigator.tsx:201-211`).
- **Animation sequence** documented at `src/screens/SplashScreen.tsx:3-13`: pitch lines draw on (~480-700ms), ball kicked at the camera from `KICK_AT = 440` (`:105`), wordmark rises at ~1100ms.
- **Strings, verbatim:**
  - `Teamder` — `src/screens/SplashScreen.tsx:285` (hardcoded, `allowFontScaling={false}`)
  - `המשחק הבא שלך מתחיל כאן` [your next game starts here] — `src/screens/SplashScreen.tsx:288` (hardcoded, **not** in `he.ts`)
  - Three pulsing dots, no text — `:290-294`
- **Controls:** none. No tap advances or skips it.
- **On finish:** `handleSplashFinish` (`App.tsx:871-903`). Critically, **the app-open ad is skipped entirely when there is no signed-in user** — `if (useUserStore.getState().currentUser) { ... }` at `App.tsx:879`, with the rationale at `App.tsx:872-878`: "a fresh install (incl. the Play reviewer) goes straight to the app, never sitting on the splash behind an ad." Even for signed-in users the ad is raced against a 3500ms hard timeout (`App.tsx:884-892`).
- **Second appearance:** `RootNavigator` renders the same visual again via `SplashVisual` (`src/navigation/RootNavigator.tsx:274`, `:287-289`) when `!groupHydrated` after sign-in. So a brand-new user sees the ball splash a **second** time between tapping "המשך" on the profile screen and landing on the tabs.

---

### 3. The decider — `RootNavigator`

**File:** `/Users/matan/Projects/soccer/src/navigation/RootNavigator.tsx`. This is the single branch point. Exact order of the gates (`:251-279`):

```
251  if (!userHydrated)                                  → <Splash />
253  if (!onboardingDone)                                → <OnboardingScreen />
255  if (!currentUser)                                   → <AuthStack initialRoute="SignIn" />
260  const isGuest = currentUser.isGuest === true
267  if (!isGuest && currentUser && !hasCompletedOnboarding) → <PostSignInOnboardingScreen />
271  if (!isGuest && !profileComplete)                   → <AuthStack initialRoute="ProfileSetup" />
274  if (!groupHydrated)                                 → <Splash />
279  return <MainTabs />
```

Gate definitions:
- `onboardingDone` — hydrated from AsyncStorage key `ONBOARDING_DONE: 'footy.onboarding.done'` (`src/services/storage.ts:7`, read at `:84-86`, written at `:88-90`). Loaded in `useUserStore.hydrate` (`src/store/userStore.ts:109-122`). **Sign-out does NOT clear it** (`src/store/userStore.ts:164-187` wipes group/game/chat stores only), so the intro slides are shown **once per install**, never again.
- `profileComplete` — `isProfileComplete: () => !!u && u.name.trim().length > 0` (`src/store/userStore.ts:243-246`).
- `hasCompletedOnboarding` — `!!u && u.onboardingCompleted === true` (`src/store/userStore.ts:248-251`).

Side-effects mounted here, with their firing conditions:
- `hydrateUser()` + `void initRemoteConfig()` + `adsService.initializeAds()` on mount — `RootNavigator.tsx:170-181`.
- App-open ad once on MainTabs, only when `membership === 'member' && gameStatus !== 'locked'` — `:186-193`.
- `hydrateGroup` / `subscribeGroups` / `hydratePlayers` once `currentUser` exists — `:201-218`.
- Live `/users/{uid}` listener — `:226-229`.
- **Push permission request** — `:235-248`. See §7.
- Pending-invite deep-link consumer — `:63-166`. Error toast string: `toast.error('הקישור לא תקין או שהפריט כבר לא קיים')` — `RootNavigator.tsx:124` (hardcoded, not in `he.ts`).

---

### 4. Screen 3 — Pre-sign-in onboarding (`OnboardingScreen`)

- **File:** `/Users/matan/Projects/soccer/src/screens/onboarding/OnboardingScreen.tsx`
- **Shown when:** `!onboardingDone` (`RootNavigator.tsx:253`) — i.e. exactly once per install, before any auth.
- **Skipped when:** the AsyncStorage flag is already `true`. A signed-out returning user on the same install goes **straight to SignIn**, never sees the slides again.
- **Layout:** full-screen `LinearGradient` with `const GRADIENT = ['#0F172A', '#1E3A8A', '#1E40AF']` (`:55`). Comment at `:1-6` records that this is a trim from an earlier **4-slide green** version to "the 3 highest-signal pitches".
- **Carousel:** horizontal paging `FlatList` with `inverted` (`:122-144`, `inverted` at `:129`) — inverted because of forced RTL, so the user swipes right-to-left.
- **Pagination:** three animated dots, width interpolating 8→24dp (`:146-150`, `Dot` at `:192-216`).

#### Slide contents (`SLIDES` array at `:43-47`)

**Slide 1** — preview `PreviewMatches` (`:44`)
- Image: `assets/images/onboarding/games.png` — `src/screens/onboarding/OnboardingPreviews.tsx:37`
- Title, rendered at `OnboardingScreen.tsx:139`: `onb1Title: 'שחקו עם אנשים בקרבת מקום'` — `src/i18n/he.ts:1781`
- Body, rendered at `:140`: `onb1Body: 'גלו מחזורי כדורגל פתוחים באזור שלכם והצטרפו בלחיצה — או פגשו שחקנים חדשים לידכם'` — `src/i18n/he.ts:1782`

**Slide 2** — preview `PreviewClub` (`:45`)
- Image: `assets/images/onboarding/club.png` — `OnboardingPreviews.tsx:41`
- `onb2Title: 'מועדון קבוע, מחזור אוטומטי'` — `src/i18n/he.ts:1783`
- `onb2Body: 'בנו את הסגל הקבוע שלכם — והמחזור השבועי נפתח לבד עם הזמנה לכולם'` — `src/i18n/he.ts:1784`

**Slide 3** — preview `PreviewLive` (`:46`)
- Image: `assets/images/onboarding/live.png` — `OnboardingPreviews.tsx:45`
- `onb3Title: 'הכל זורם מעצמו'` — `src/i18n/he.ts:1785`
- `onb3Body: 'מישהו ביטל? המקום מתמלא אוטומטית מרשימת ההמתנה עם תזכורות חכמות שדואגות שכולם יגיעו'` — `src/i18n/he.ts:1786`

The three previews are **real cropped screenshots of the live app** shown inside a drawn phone bezel — `OnboardingPreviews.tsx:1-5` ("REAL captures of the live app … Source PNGs live in assets/images/onboarding/ (600×1253, status bar / ad / gesture bar stripped)"), frame at `:28-34`, `FRAME_W = Math.min(236, SCREEN_W * 0.62)` (`:21`).

#### Controls

| Control | Label (verbatim) | he.ts line | Rendered at | Behaviour |
|---|---|---|---|---|
| Skip pill, top-leading | `onbSkip: 'דלג'` | `src/i18n/he.ts:1775` | `OnboardingScreen.tsx:117` | `handleSkip` (`:100-103`) → `logEvent(AnalyticsEvent.OnboardingSkipped, { slide: index + 1, total: SLIDES.length })` then `completeOnboarding()`. **Rendered only when `!isLast`** (`:115`) — there is no skip on slide 3. |
| Primary CTA, slides 1-2 | `onbNext: 'הבא'` | `src/i18n/he.ts:1776` | `OnboardingScreen.tsx:180` | `advance()` (`:73-77`) → `scrollToIndex(index+1)`. |
| Primary CTA, slide 3 | `onbCtaStart: 'המשך'` | `src/i18n/he.ts:1780` | `OnboardingScreen.tsx:167` | `handleStart` (`:84-94`) → `logEvent(AnalyticsEvent.OnboardingCompleted, { via: 'cta', slide: index + 1 })` → `await completeOnboarding()`. Disabled while `busy`. |

The slides are **purely informational** — no sign-in button lives here. Comment at `:79-83`: "This avoids the old duplication where both the last slide AND the sign-in screen carried login buttons."

#### Dead / unused strings still in `he.ts`
These exist but nothing on this screen renders them: `onbStart: 'בוא נתחיל'` (`:1777`), `onbCtaSignIn: 'התחבר עם Google'` (`:1778`), `onbCtaSignInApple: 'התחבר עם Apple'` (`:1779`), `onb4Title: 'בוא נתחיל'` (`:1789`), `onb4Body: 'התחבר ותתחיל לארגן מחזורים'` (`:1790`) — explicitly flagged as legacy at `he.ts:1787-1788`.

#### Required vs skippable, backing out
- Required: **no**. One tap on `'דלג'` clears the whole thing.
- Android hardware back on this screen: no stack to pop and we are not on a tab, so `useAndroidBack` (`App.tsx:352`, implementation `src/navigation/useAndroidBack.ts`) falls to rule 3 — first press arms + shows a toast `backAgainToExit: 'לחץ שוב כדי לצאת'` (`src/i18n/he.ts:51`), second press within `CONFIRM_WINDOW_MS = 2000` (`useAndroidBack.ts:47`) leaves the app. iOS: no hardware back (`useAndroidBack.ts:20-21, :69`).
- Once completed or skipped, **the slides are unreachable** — there is no "show intro again".

#### Permissions / SDK on this screen
None fire here. Joryio already started at module load (§0). No push prompt yet (guarded on `currentUser`, `RootNavigator.tsx:236`).

#### Error states
None. `handleStart` swallows failures (`:89-91` `catch { // no-op }`), so a failed AsyncStorage write silently leaves the user on the slides with the CTA re-enabled.

---

### 5. Screen 4 — Sign-in (`SignInScreen`)

- **File:** `/Users/matan/Projects/soccer/src/screens/auth/SignInScreen.tsx`
- **Shown when:** `onboardingDone && !currentUser` → `<AuthStack initialRoute="SignIn" />` (`RootNavigator.tsx:255`). Stack config: `src/navigation/AuthStack.tsx:19-29`, `screenOptions={{ headerShown: false }}` (`:23`).
- **Palette:** `const ACCENT = '#1E40AF'; const ACCENT_SOFT = '#DBEAFE';` (`:28-29`), deliberately not the legacy green `colors.primary` (`:24-27`).
- **Hero:** a 140dp circle (`:281-289`) containing `<Ionicons name="football-outline" size={72} color={ACCENT} />` (`:177`).

#### Strings, verbatim

| Element | Value | he.ts | Rendered |
|---|---|---|---|
| Title | `signInTitle: 'בואו נתחיל'` | `:1793` | `SignInScreen.tsx:179` |
| Subtitle | `signInSubtitle: 'התחבר כדי להירשם, להצטרף למועדון ולעקוב אחרי הסטטיסטיקות שלך.'` | `:1794` | `:180` |
| Google button | `signInGoogle: 'המשך עם Google'` | `:1795` | `:204` |
| Apple button | `signInApple: 'המשך עם Apple'` | `:1796` | `:229` |
| Email button | `signInEmail: 'המשך עם מייל'` | `:1797` | `:251` |
| Guest link | `signInGuest: 'המשך כאורח'` | `:1798` | `:269` |
| Footer | `signInPrivacy: 'באמצעות התחברות אתה מסכים לתנאי השימוש'` | `:1799` | `:272` |

Note the mixed voice: the title `'בואו נתחיל'` is plural/formal, the subtitle `'התחבר…'` is masculine-singular imperative. Same tension appears between the slides (`'שחקו'`, `'גלו'`, `'בנו'` — plural) and everything after sign-in (`'בוא נכיר'` — masculine singular).

**The privacy footer is a plain non-tappable `<Text>`** (`:272`, style `privacy` at `:324`). It is **not** a link. Grep across `src/i18n/he.ts` for privacy/terms returns only this one string. A `public/privacy.html` exists on the hosting site but nothing in the in-app sign-up flow links to it.

#### Controls and branches

1. **`'המשך עם Google'`** — `Pressable` at `:188-207`. `handlePress` (`:44-93`):
   - `logEvent(AnalyticsEvent.SignInAttempted, { method: 'google' })` (`:45`)
   - `setBusyProvider('google')` → in-button `<ActivityIndicator />` (`:199-200`)
   - `signIn()` → `userStore.signInWithGoogle` (`src/store/userStore.ts:130-134`) → `userService.signInWithGoogle` (`src/services/userService.ts:167-212`) → `src/firebase/auth.ts:79-...`:
     - Android only: `GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true })` (`auth.ts:93-95`) — can raise a **system Play Services update dialog**.
     - `GoogleSignin.signIn()` (`auth.ts:97`) — **system Google account chooser sheet**. One tap to pick an account.
     - `signInWithCredential` (`auth.ts:110`), plus `mirrorToNativeAuth` (`:112`) for the widget/watch.
   - New user → doc written at `userService.ts:181-194` with `name: fbUser.displayName ?? ''`, `email`, `avatarId: pickRandomAvatarId()`, `createdAt: Date.now()`, **`onboardingCompleted: false`** (`:187`). So a Google user arrives at the next screen **with their name pre-filled**.
   - Then `applyInviteAttributionIfFresh` + `applyAcquisitionIfFresh` (`:208-209`).
   - If the doc write fails, the user is **signed back out** (`:193-207`) to avoid an auth user with no `/users` doc.
   - `logEvent(AnalyticsEvent.SignInSuccess)` (`userStore.ts:133`).
   - Returning Google user → existing doc returned as-is (`userService.ts:176-180`), so `onboardingCompleted` stays `true` and the post-sign-in screen is skipped.

2. **`'המשך עם Apple'`** — `Pressable` at `:212-233`, wrapped in **`{Platform.OS === 'ios' && ...}`** (`:212`). **Android users never see this button.** `handleApple` (`:97-139`). New-user doc at `userService.ts:228-239`, `name: fbUser.displayName ?? fullName ?? ''` (`:234`) — the comment at `:230-233` notes Apple only returns the name on the *first* authorization. `usesAppleSignIn: true` in `app.json` (`expo.ios`).

3. **`'המשך עם מייל'`** — `Pressable` at `:236-252`. `logEvent(AnalyticsEvent.SignInAttempted, { method: 'email' })` then `nav.navigate('EmailAuth')` (`:238-239`). This is the **only** control here that is a navigation rather than an auth attempt. It carries no busy state (`:244-246` only dims when another provider is busy).

4. **`'המשך כאורח'`** — underlined text link, `Pressable` at `:255-271`, style `guestText` with `textDecorationLine: 'underline'` (`:330-335`). `handleGuest` (`:143-155`) → `userStore.signInAsGuest` (`userStore.ts:142-146`) → `userService.signInAsGuest` (`src/services/userService.ts:61-67`) → `fbSignInAnonymously` (`src/firebase/auth.ts:407-412`). Builds a **runtime-only** user (`userService.ts:44-53`): `name: ''`, `avatarId: pickRandomAvatarId()`, **`onboardingCompleted: true`**, `isGuest: true`. **No `/users` doc is created.** Rationale at `userService.ts:56-60` and `SignInScreen.tsx:141-142`: App Store guideline 5.1.1(v).
   - Consequence at `RootNavigator.tsx:260-271`: a guest **skips both the post-sign-in profile screen and the profile-setup screen** and lands on `MainTabs` in one tap.

#### Every error state on this screen

Error dialogs use `appAlert(he.error, ...)` where `error: 'שגיאה'` (`src/i18n/he.ts:188`). The message is resolved by `friendlySignInError` (`SignInScreen.tsx:158-171`):

| Condition | Message | he.ts |
|---|---|---|
| cancelled | `signInCancelled: 'ההתחברות בוטלה'` | `:1262` |
| `'OAuth client ID not configured'` | `signInConfigMissing: 'הגדרות Google עדיין לא מוגדרות'` | `:1263` |
| browser blocked (`isBrowserBlocked`) | `signInBrowserBlocked: 'לא ניתן לפתוח את הדפדפן במכשיר הזה, ולכן ההתחברות עם Google נחסמה. בדרך כלל זה מגיע מהגבלת תוכן ב"זמן מסך" או מפרופיל ניהול. אפשר להתחבר עם Apple או עם אימייל במקום.'` | `:1268-1269` |
| network / offline / `auth/network-request-failed` / `unavailable` | `signInNetworkError: 'אין חיבור לאינטרנט'` | `:1270` |
| anything else | `signInFailed: 'ההתחברות נכשלה. נסה שוב.'` | `:1264` |
| guest failure | `signInFailed` (direct, not via the mapper) | `SignInScreen.tsx:151` |

Important behavioural detail: **a user-cancelled Google or Apple chooser shows no dialog at all** — `if (!cancelled) { appAlert(...) }` at `:87-89` and `:133-135`. It just returns to the sign-in screen with the spinner cleared.

Analytics on failure paths: `SignInCancelled` / `SignInFailed` (`:78-82` Google, `:126-130` Apple, `:150` guest). Transient errors are deliberately kept out of the error panel (`:63-77` Google, `:113-125` Apple).

#### Required vs skippable, backing out
- Some auth choice is **required** to proceed past this screen — but "guest" satisfies it, so no account is strictly required to reach the app.
- Android back on SignIn: nothing to pop, not on a tab → the "press again to exit" toast path (`useAndroidBack.ts`).
- There is no way back to the onboarding slides from here.

---

### 6. Screen 5 (email branch only) — `EmailAuthScreen`

- **File:** `/Users/matan/Projects/soccer/src/screens/auth/EmailAuthScreen.tsx`
- **Shown when:** the user taps `'המשך עם מייל'` on SignIn (`SignInScreen.tsx:239`). Registered at `src/navigation/AuthStack.tsx:27`.
- **Mode:** `const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn')` — `:45`. **The screen opens in SIGN-IN mode.** A brand-new user must first tap the toggle link at the bottom to reach sign-up.
- **Header:** `<ScreenHeader title={isSignUp ? he.emailAuthSignUpTitle : he.emailAuthSignInTitle} />` (`:170-172`). `ScreenHeader` renders a back chevron when `navigation.canGoBack()` (`src/components/ScreenHeader.tsx:46, :59-64`; in RTL the back glyph is `chevron-forward`, `:61-62`) — so this is **the first screen in the whole flow with a visible back affordance**.
- `KeyboardAvoidingView` with `behavior='padding'` on iOS only (`:173-176`).

#### Strings, verbatim

| Element | Value | he.ts | Rendered |
|---|---|---|---|
| Title (sign-in mode) | `emailAuthSignInTitle: 'התחברות עם מייל'` | `:1813` | `:171` |
| Title (sign-up mode) | `emailAuthSignUpTitle: 'הרשמה עם מייל'` | `:1814` | `:171` |
| Email label | `emailAuthEmailLabel: 'כתובת מייל'` | `:1815` | `:178` |
| Email placeholder | `emailAuthEmailPlaceholder: 'name@example.com'` | `:1816` | `:182` |
| Password label | `emailAuthPasswordLabel: 'סיסמה'` | `:1817` | `:193` |
| Password placeholder | `emailAuthPasswordPlaceholder: 'לפחות 6 תווים'` | `:1818` | `:198` |
| Confirm label (sign-up only) | `emailAuthConfirmPasswordLabel: 'אימות סיסמה'` | `:1819` | `:226` |
| Confirm placeholder | `emailAuthConfirmPasswordPlaceholder: 'הקלד שוב את הסיסמה'` | `:1820` | `:231` |
| Inline mismatch error | `emailAuthPasswordMismatch: 'הסיסמאות לא תואמות'` | `:1821` | `:259` |
| Forgot link (sign-in only) | `emailAuthForgot: 'שכחת סיסמה?'` | `:1826` | `:266` |
| CTA (sign-in) | `emailAuthSignInCta: 'התחבר'` | `:1822` | `:284` |
| CTA (sign-up) | `emailAuthSignUpCta: 'הרשמה'` | `:1823` | `:284` |
| Toggle → sign-up | `emailAuthToggleToSignUp: 'אין לך חשבון? הרשמה'` | `:1824` | `:298` |
| Toggle → sign-in | `emailAuthToggleToSignIn: 'כבר יש לך חשבון? התחבר'` | `:1825` | `:298` |
| Eye button a11y | `'הצג סיסמה'` / `'הסתר סיסמה'` | hardcoded | `:212` and `:249` |

#### Controls
- **Email `TextInput`** (`:179-191`): `keyboardType="email-address"`, `autoCapitalize="none"`, `autoComplete="email"`, `textContentType="emailAddress"`, `textAlign="right"`.
- **Password `TextInput`** (`:195-207`): `secureTextEntry={!showPassword}`, `autoComplete` flips `'password-new'`/`'password'` by mode (`:203`).
- **Eye toggle** (`:208-219`, and a duplicate at `:245-256` for the confirm field) — one shared `showPassword` state (`:49`), positioned `left: spacing.md` (`:338-339`) i.e. the far side under RTL.
- **Confirm password field** — rendered only when `isSignUp` (`:224-262`).
- **`'שכחת סיסמה?'`** — rendered only when `!isSignUp` (`:264-268`).
- **Primary CTA** (`:270-287`): `disabled={!canSubmit}`, dimmed to `opacity: 0.5` when disabled (`:276`), `<ActivityIndicator />` while `busy` (`:280-281`).
- **Mode toggle link** (`:289-300`): `switchMode(...)` (`:64-70`, logs `AnalyticsEvent.AuthModeSwitched`) and clears the confirm field (`:292`).

#### Validation (all client-side, `:37, :52-60`)
- `EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/` (`:37`)
- `passwordOk = password.length >= 6` (`:54`)
- Sign-up additionally requires `passwordsMatch && confirmPassword.length > 0` (`:60`)
- `confirmError` only shows once the user has typed something into confirm (`:58`) — deliberate, per the comment at `:55-56`.
- **The CTA is disabled, not error-flagged**, until all of the above pass. There is no inline error for a bad email or a short password — only the disabled button.

#### Every error state
Resolved in `handleAuthError` (`:89-135`):

| Firebase code | Message | he.ts |
|---|---|---|
| `auth/invalid-email` | `emailAuthInvalidEmail: 'כתובת מייל לא תקינה'` | `:1827` |
| `auth/weak-password` | `emailAuthWeakPassword: 'הסיסמה חייבת להכיל לפחות 6 תווים'` | `:1828` |
| `auth/email-already-in-use` | `emailAuthAlreadyInUse: 'המייל הזה כבר רשום. אם נרשמת עם מייל וסיסמה — עבור להתחברות. אם נרשמת עם Google/Apple — חזור והשתמש בכפתור המתאים.'` with two actions: `cancel: 'בטל'` (`he.ts:52`) and `emailAuthSwitchToSignIn: 'עבור להתחברות'` (`he.ts:1834`) | `:1832-1833`, dialog at `:114-117` |
| `auth/wrong-password` / `auth/user-not-found` / `auth/invalid-credential` | `emailAuthWrongCredentials: 'מייל או סיסמה שגויים'` | `:1829` |
| `auth/too-many-requests` | `emailAuthTooManyAttempts: 'יותר מדי ניסיונות. נסה שוב בעוד כמה דקות.'` | `:1830` |
| `auth/network-request-failed` | `signInNetworkError: 'אין חיבור לאינטרנט'` | `:1270` |
| unknown | `emailAuthGenericError: 'משהו השתבש, נסה שוב'` + `logError` to the error panel | `:1831`, `:106`, `:131` |
| `EmailRegisteredWithProviderError` google | `emailAuthRegisteredWithGoogle: 'הכתובת הזו כבר רשומה דרך Google. התחבר עם Google.'` | `:1835`, thrown from `src/firebase/auth.ts:181-190` |
| `EmailRegisteredWithProviderError` apple | `emailAuthRegisteredWithApple: 'הכתובת הזו כבר רשומה דרך Apple. התחבר עם Apple.'` | `:1836` |

Password reset (`onForgotPassword`, `:137-166`):
- No/invalid email typed → `emailAuthResetNeedEmail: 'הקלד קודם את כתובת המייל שלך'` (`he.ts:1840`), logged as `PasswordResetRequested { result: 'blocked', reason: 'invalid_email' }` (`:139-142`).
- Success (and, deliberately, also `user-not-found` — anti-enumeration, `:161`) → title `emailAuthResetSentTitle: 'נשלח מייל איפוס'` (`he.ts:1837`), body `emailAuthResetSentBody: (email) => \`שלחנו קישור לאיפוס סיסמה אל ${email}. בדוק את תיבת הדואר (וגם ספאם).\`` (`he.ts:1838-1839`).

#### What the account looks like after email sign-up
`userService.signUpWithEmail` (`src/services/userService.ts:306-341`) writes `name: ''` (`:322`), `onboardingCompleted: false` (`:326`). A verification email is sent best-effort and **does not block usage** — `src/firebase/auth.ts:171-173`, and the comment at `userService.ts:303-304`. **There is no email-verification gate anywhere in the flow.**

Because `name` is empty, the email user must type their name on the next screen. The Google user does not.

#### Backing out
Back chevron pops to SignIn. Android back pops the same way (rule 1 in `useAndroidBack.ts:11-12`). Nothing is persisted — returning to this screen resets to sign-in mode with empty fields.

---

### 7. The push-permission prompt — fires **on top of** the next screen

`src/navigation/RootNavigator.tsx:235-248`:

```ts
useEffect(() => {
  if (!currentUser) return;
  if (currentUser.isGuest) return;          // :240
  notificationsService.requestAndRegisterPushToken(currentUser.id)
```

This effect runs the moment `currentUser` is set — which is the same render in which `RootNavigator` has already decided to show `PostSignInOnboardingScreen` (`:267-269`). So on a real device the **OS push-permission dialog appears over the "בוא נכיר" profile screen, immediately after the sign-in sheet closes**, before the user has typed anything.

Implementation `src/services/notificationsService.ts:634-696`:
- Bails out in Expo Go / storeClient (`:641-652`).
- `getPermissionsAsync()` (`:671`); only if not granted **and** `canAskAgain` does it call `requestPermissionsAsync()` (`:673-675`).
- Logs `AnalyticsEvent.PushPermissionResult { granted, can_ask_again }` (`:676-679`).
- Then `getFcmToken()` + `registerDeviceToken` (`:685-687`).
- Guests are skipped entirely — rationale at `RootNavigator.tsx:237-240`: "an anonymous session shouldn't trigger the OS push-permission prompt (App Store 5.1.1 friction)".
- `android.permissions` in `app.json` includes `"android.permission.POST_NOTIFICATIONS"` (so Android 13+ shows a runtime dialog).
- There is **no pre-prompt / priming screen** explaining why notifications matter. The system dialog is the first and only ask.
- Failure string used in the internal error panel: `requestAndRegisterPushToken: 'בקשת הרשאת התראות נכשלה'` (`src/services/errorLog.ts:185`).

`joryio.identify(user.uid, { email, name })` fires from the auth-state listener the first time a user appears — `src/firebase/auth.ts:466-474`, with the rationale at `:450-455` (a day-one user used to spend the whole first session as an anonymous Joryio record).

---

### 8. Screen 6 — Post-sign-in profile (`PostSignInOnboardingScreen`)

- **File:** `/Users/matan/Projects/soccer/src/screens/onboarding/PostSignInOnboardingScreen.tsx`
- **Shown when:** `!isGuest && currentUser && !hasCompletedOnboarding` (`RootNavigator.tsx:267-269`), i.e. every newly-created Google / Apple / email account.
- **Skipped when:** guest (`isGuest`), or a returning account whose `/users/{uid}.onboardingCompleted === true`.
- **History:** the header comment (`:1-6`) records that this used to be **three** screens (welcome → how it works → profile) and was collapsed to one because "the user already saw the value pitch on the pre-sign-in slides; repeating it here just adds taps before the app actually starts working."
- **Layout:** blue gradient hero with rounded bottom corners, `HERO_GRADIENT = ['#1E3A8A', '#1E40AF', '#3B82F6']` (`:32`), 132dp live avatar preview pulled up onto the hero (`:152-161`), then a form card, then a bottom-pinned CTA bar (`:221-235`).

#### Strings, verbatim

| Element | Value | he.ts | Rendered |
|---|---|---|---|
| Hero title | `psoProfileTitle: 'בוא נכיר'` | `:2839` | `:142` |
| Hero subtitle | `psoWelcomeBody: 'מארגנים כדורגל שכונתי בלי בלגן — הרשמה, ספסל, קבוצות, שוערים וטיימר.'` | `:2808-2809` | `:143` |
| Name field label | `profileName: 'שם'` | `:1847` | `:165` |
| Name placeholder | `profileNamePlaceholder: 'איך לקרוא לך?'` | `:1848` | `:168` |
| Photo section label | `profilePhotoLabel: 'תמונת השחקן'` | `:2810` | `:174` |
| Upload button | `profilePhotoUpload: 'העלאה מהגלריה'` | `:2811` | `:188` |
| Upload button after a photo is set | `profilePhotoChange: 'החלף תמונה'` | `:2812` | `:188` |
| Avatar grid label | `profileAvatarLabel: 'או בחר אווטאר'` | `:2813` | `:192` |
| CTA | `psoProfileSave: 'המשך'` | `:2840` | `:233` |

Note `psoWelcomeBody` is a **value pitch repeated after sign-up**, and it is worded in a different register (`'מארגנים'` — impersonal plural) from the hero title above it (`'בוא נכיר'` — masculine singular).

The user's email is shown as a small centred caption when present: `{user?.email ? <Text style={styles.email}>{user.email}</Text> : null}` (`:217`).

#### Controls

1. **Name `InputField`** (`:164-172`) — `maxLength={40}`, `icon="person-outline"`, `required` (`:171`). The `required` prop renders a **red asterisk** next to the label (`src/components/InputField.tsx:53-56`, `:103-109`). Pre-filled from `user?.name` (`:40`) — populated for Google (`userService.ts:183`) and usually for a first-time Apple authorization (`userService.ts:234`), **empty for email sign-up** (`userService.ts:322`).
2. **`'העלאה מהגלריה'`** (`:175-190`) → `handlePickPhoto` (`:63-96`) → `pickAndUploadAvatar(user.id)` (`src/services/photoService.ts`). This is where the **photo-library permission dialog** fires: `ImagePicker.requestMediaLibraryPermissionsAsync()` at `src/services/photoService.ts:123`, then `launchImageLibraryAsync` at `:131`. iOS prompt copy comes from `app.json` → `expo.ios.infoPlist.NSPhotoLibraryUsageDescription: "Teamder מבקשת גישה לתמונות שלך כדי שתוכל להעלות אווטאר אישי או תמונת קאבר לקהילה שלך."` (a camera string also exists: `NSCameraUsageDescription: "Teamder מבקשת גישה למצלמה כדי לצלם אווטאר אישי בלי לעזוב את האפליקציה."`).
3. **Avatar grid** (`:193-215`) — 24 procedurally-rendered avatars from `AVATARS` in `/Users/matan/Projects/soccer/src/data/avatars.ts:23-55` (coloured circle + emoji glyph: `⚽ 🏆 🎽 🥅`, then skin-tone/hair/age variants `👨🏻 👩🏻 … 🧓`). Selection ring `avatarCellActive` (`:336-338`). One is **pre-selected at random** on mount: `user?.avatarId ?? (user ? pickRandomAvatarId() : undefined)` (`:48-50`), and the sign-in services also assign a random `avatarId` at doc creation (`userService.ts:185, :236, :281, :324`).
4. Picking a photo clears the avatar (`:94`); picking an avatar clears the photo and best-effort deletes the uploaded file (`:99-106`).
5. **`'המשך'` CTA** (`:222-234`) — `disabled={!canSave}` where `canSave = name.trim().length > 0 && !busy && !uploading` (`:61`). Dimmed to `opacity: 0.5` (`:228`). `handleSave` (`:113-131`) → `completePostSignInOnboarding({ name, avatarId: photoUrl ? undefined : avatarId, photoUrl })` → `userService.completeOnboarding` → `logEvent(ProfileCreated)` + `logEvent(OnboardingCompleted)` (`src/store/userStore.ts:253-258`).

#### Required vs skippable
- **A name is required.** There is no skip link, no "later", no back chevron, no header at all. This screen is a hard gate.
- Android hardware back: no stack to pop and not on a tab → "press again to exit" then the app closes. **Backing out of this screen means leaving the app with an account that is signed in but has `onboardingCompleted: false`** — the next launch lands right back here.
- Photo and avatar are both optional (an avatar is pre-selected anyway).

#### Error states
- Photo cancelled or permission denied → **silent**, no dialog. Only analytics: `PhotoUploadAbandoned { source: 'onboarding', reason: 'permission_denied' | 'cancelled' }` (`:74-77`). The comment at `:69-72` says this is deliberate, per App Store guideline 5.1.1(iv) — never nag after a denial.
  - Note: `profilePhotoPermissionDenied: 'אין הרשאה לגישה לגלריה. אפשר לאשר בהגדרות הטלפון.'` exists in `he.ts:2814-2815` but is **not** shown on this screen.
- `reason === 'network'` → `appAlert(he.error, he.profilePhotoUploadFailed)` where `profilePhotoUploadFailed: 'העלאת התמונה נכשלה. נסה שוב.'` (`he.ts:2816`), at `:84-85`.
- `reason === 'unavailable'` → `profilePhotoUnavailable: 'בחירת תמונה לא זמינה כרגע. בחר אווטאר מוכן בינתיים.'` (`he.ts:2818-2819`), at `:86-87`.
- Save failure → `appAlert(he.error, he.signInFailed)` — i.e. **`'ההתחברות נכשלה. נסה שוב.'`, a sign-in message shown for a profile-save failure** (`:127`). Analytics `ProfileSaveFailed { source: 'post_signin_onboarding', code }` (`:123-126`).

---

### 9. Screen 7 (effectively unreachable for new users) — `ProfileSetupScreen`

- **File:** `/Users/matan/Projects/soccer/src/screens/auth/ProfileSetupScreen.tsx`. Registered at `src/navigation/AuthStack.tsx:26`.
- **Shown when:** `!isGuest && !profileComplete` — but only **after** the `!hasCompletedOnboarding` check has already passed (`RootNavigator.tsx:267` runs before `:271`). Since `completePostSignInOnboarding` can only be reached with a non-empty name (`PostSignInOnboardingScreen.tsx:61`), a newly-created account can never land here. It is reachable only by a grandfathered account that has `onboardingCompleted === true` **and** an empty `name` — e.g. a pre-existing user whose name was later cleared.
- **Strings:**
  - Title `profileTitle: 'בוא נכיר'` (`he.ts:1846`) — rendered `:69`. Identical copy to the post-sign-in hero.
  - Name label `profileName: 'שם'` (`he.ts:1847`) — `:77`
  - Placeholder `profileNamePlaceholder: 'איך לקרוא לך?'` (`he.ts:1848`) — `:80`
  - CTA `profileSave: 'שמור והמשך'` (`he.ts:1850`) — `:93`
  - Unused here but adjacent in `he.ts`: `profileNameRequired: 'שם הוא שדה חובה'` (`:1849`)
- **Layout:** `ScreenContainer` → centred `PlayerIdentity` preview card (`:71-73`) → name `InputField` with `required` and `maxLength={40}` (`:76-88`) → bottom `Button` (`:92-100`). `returnKeyType="done"` submits (`:84-87`).
- **Errors** (`:28-55`): `RESERVED_NAME` → `officialNameTaken: 'השם הזה שמור לחשבון הרשמי של Teamder. בחרו שם אחר.'` (`he.ts:640-641`); `EMAIL_NAME` → `emailNameNotAllowed: 'כתובת אימייל היא לא שם. איך קוראים לכם?'` (`he.ts:642-643`); otherwise `profileSaveError: 'לא הצלחנו לשמור את הפרטים. בדוק את החיבור ונסה שוב.'` (`he.ts:189`). Analytics `ProfileSaveFailed { source: 'profile_setup', code }` (`:41`).
  - **Note:** these two reserved-name errors are enforced on `ProfileSetupScreen` but the `PostSignInOnboardingScreen` save path shows only `he.signInFailed` (`PostSignInOnboardingScreen.tsx:127`) for the same underlying failures.
- **No back, no skip.** Hard gate, same as §8.

---

### 10. Overlays that can appear during any of the above

Mounted in `App.tsx`'s render tree (`:920-1054`) and therefore able to cover a first-run screen.

| Overlay | Mount | Active condition | Copy |
|---|---|---|---|
| `MockModeBanner` | `App.tsx:970` | dev/mock only, renders nothing in prod (`App.tsx:962-963`) | — |
| `AnnouncementBanner` | `App.tsx:971` | Remote Config `announcement_enabled` + non-empty `announcement_text` (`src/components/RemoteGates.tsx:35-67`) | server-authored `announcement_text`; dismissible ✕ (`:61-63`) |
| **Force update modal** | `App.tsx:1015-1017` | `splashDone && updateKind === 'force'` | title `updateForceTitle: 'נדרש עדכון'` (`he.ts:151`), body `updateForceBody: 'יש גרסה חדשה לאפליקציה. חובה לעדכן כדי להמשיך להשתמש.'` (`he.ts:152`), single CTA `updateNow: 'עדכן עכשיו'` (`he.ts:155`). **Not dismissible** — `onRequestClose={() => {}}` and backdrop press disabled (`src/components/UpdateModal.tsx:21, :25`). This can be the **first interactive thing a brand-new installer sees**, before the slides are even usable. |
| Optional update modal | `App.tsx:1018-1032` | `splashDone && updateKind === 'optional'` | `updateOptionalTitle: 'גרסה חדשה זמינה'` (`he.ts:153`), `updateOptionalBody: 'יש גרסה חדשה זמינה לאפליקציה.'` (`he.ts:154`), buttons `updateLater: 'אולי אחר כך'` (`he.ts:156`) + `updateNow: 'עדכן עכשיו'`. Dismissal snoozes 24h via `OPTIONAL_UPDATE_SNOOZE_KEY` (`App.tsx:300-301, :1025-1028`). |
| `MaintenanceGate` | `App.tsx:1036` | Remote Config `maintenance_mode` | full-screen blocking; title `'בתחזוקה'` hardcoded at `src/components/RemoteGates.tsx:28`; default body `'אנחנו עורכים תחזוקה קצרה ונחזור עוד מעט. תודה על הסבלנות 🙏'` at `:17-18`, overridable by `maintenance_message`. |
| `CampaignGate` | `App.tsx:1040` | `splashDone && updateKind === 'none' && !!currentUserId` — **no onboarding gate**, so it can fire while the user is still on the post-sign-in profile screen. 1200ms delay after becoming active (`src/components/CampaignGate.tsx:38-49`). | Pulse-authored `popupTitle` / `popupBody`; default button text `'הבנתי'` (`CampaignGate.tsx:80`). |
| **`WhatsNewGate`** | `App.tsx:1044-1051` | `splashDone && updateKind === 'none' && !!currentUserId && onboardingComplete` | On a **fresh install** `seen` is `null`, so `resolveWhatsNew` falls into the `baseline === null` branch and surfaces **the current version's highlights** (`src/services/whatsNewService.ts:78-84`). A brand-new user who has just finished signing up can therefore be shown a "what's new in this version" modal for a version they have never not had. The comment at `:72-77` acknowledges the fresh-install case explicitly. |
| `ScreenshotReportSheet` | `App.tsx:982` | **testers only** — `if (!isTester) return;` (`src/components/ScreenshotReportSheet.tsx:88-91`). Not part of a normal new user's run. | `screenshotReportTitle: 'צילמת מסך — לדווח על באג?'` (`he.ts:1751`) |
| `InAppMessageHost` (Joryio) | `App.tsx:986` | inside the navigator, so Joryio in-app campaigns can render at any point | server-authored |
| `BannerAd` | in the tab bar, `src/navigation/MainTabs.tsx:56-68` | gated only by `EXPO_PUBLIC_ADMOB_ENABLED` (`src/services/adsService.ts:123`), the Pulse master switch, and RC `banner_enabled` (`adsService.ts:516-519`) — **no new-user grace** | An ad banner is present on the home screen from the account's first second. The app-open ad, by contrast, *does* have a new-user grace: `Date.now() - opts.accountCreatedAt < rcNumber('app_open_new_user_grace_ms')` (`adsService.ts:442-443`). |

---

### 11. Screen 8 — the landing screen (`MainTabs` → "בית")

- **File:** `/Users/matan/Projects/soccer/src/navigation/MainTabs.tsx`, `initialRouteName="ProfileTab"` (`:91`), root screen `Profile` = `/Users/matan/Projects/soccer/src/screens/tabs/ProfileScreen.tsx` (`src/navigation/ProfileStack.tsx:16, :132`).
- Tab labels, right-to-left order (`MainTabs.tsx:30-32` explains index 0 = rightmost under RTL):
  - `tabHome: 'בית'` — `he.ts:2887`, used `MainTabs.tsx:129`
  - `tabCommunities: 'מועדונים'` — `he.ts:1273`, used `:137`
  - `tabGame: 'מחזורים'` — `he.ts:2885`, used `:150`
  - `tabChat: "צ'אטים"` — `he.ts:4049`, used `:159`
- **First thing a new account sees on this screen:** a time-based greeting (`greetingMorning: 'בוקר טוב'` `he.ts:3073`, `greetingNoon: 'צהריים טובים'` `:3074`, `greetingEvening: 'ערב טוב'` `:3075`, `greetingNight: 'לילה טוב'` `:3076`; used `ProfileScreen.tsx:787-790`), plus the **activation checklist** (`ProfileScreen.tsx:1366-1371`, rendered while `homeDataReady && !checklistComplete`).
- Checklist card (`/Users/matan/Projects/soccer/src/components/home/OnboardingChecklist.tsx:73-77`):
  - `homeChecklistTitle: 'בוא נתחיל'` + a `⚡` appended in JSX (`OnboardingChecklist.tsx:74-76`) — `he.ts:1990`
  - `homeChecklistSubtitle: 'כמה צעדים קטנים כדי להפיק את המקסימום'` — `he.ts:1991`
  - progress ring `${done}/${total}` (`:62`)
- The five steps (`ProfileScreen.tsx:641-710`), each tappable:
  1. `homeStepPhoto: 'הוספת תמונת פרופיל'` (`he.ts:1992`, `ProfileScreen.tsx:644`) → `ProfileEdit`. Done when `user.photoUrl` — **an avatar does not count**, so a user who picked an avatar on the post-sign-in screen still sees this step undone.
  2. `homeStepAvailability: 'סמן מתי אתה פנוי'` (`he.ts:1993`, `:657`) → `AvailabilityEdit`
  3. `homeStepCommunity: 'הצטרף או פתח מועדון'` (`he.ts:1994`, `:670`) → `CommunitiesTab`
  4. `homeStepGame: 'הצטרף או צור מחזור ראשון'` (`he.ts:1995`, `:683`) → `GameTab`
  5. `homeStepInvite: 'הבא חבר למגרש'` (`he.ts:1996`, `:696`) → share sheet; done only when someone actually joined via the link (`:698-701`)
- `homeStepPosition: 'בחר עמדה מועדפת'` (`he.ts:1997`) exists but is **not** in the rendered list.
- Note the third repetition of the same phrase: `'בוא נכיר'` (post-sign-in hero, `he.ts:2839`), `'בוא נכיר'` (ProfileSetup title, `he.ts:1846`), `'בוא נתחיל'` (checklist, `he.ts:1990`) and `'בואו נתחיל'` (SignIn title, `he.ts:1793`).

---

### 12. The guest branch, and the wall it ends at

A guest reaches `MainTabs` in **one tap** from SignIn (`SignInScreen.tsx:256`, `RootNavigator.tsx:260`, `:279`). They have no `/users` doc (`userService.ts:56-60`) and no push token (`RootNavigator.tsx:240`).

The moment they try to do anything that needs an account, `ensureNotGuest` (`/Users/matan/Projects/soccer/src/utils/guestGate.ts:39-63`) shows a dialog:
- Title `guestRegisterTitle: 'נדרשת הרשמה'` (`he.ts:1801`)
- Body, context-specific:
  - default `guestRegisterBody: 'כדי להשתמש בתכונה הזו צריך חשבון. רוצה להירשם עכשיו?'` (`he.ts:1802`)
  - joining a game `guestRegisterJoinGame: 'כדי להירשם למחזור צריך חשבון. רוצה להירשם עכשיו?'` (`he.ts:1803`) — used at `src/screens/games/MatchDetailsScreen.tsx:907`
  - joining a club `guestRegisterJoinCommunity: 'כדי להצטרף למועדון צריך חשבון. רוצה להירשם עכשיו?'` (`he.ts:1804`)
  - messaging an admin `guestRegisterChatAdmin: 'כדי לשלוח הודעה למנהל צריך חשבון. רוצה להירשם עכשיו?'` (`he.ts:1805`)
  - creating `guestRegisterCreate: 'כדי ליצור צריך חשבון. רוצה להירשם עכשיו?'` (`he.ts:1806`)
  - chat `guestRegisterChat: 'כדי להשתמש בצ׳אט צריך חשבון. רוצה להירשם עכשיו?'` (`he.ts:1807`)
- Buttons: `cancel: 'בטל'` (`he.ts:52`) and `guestRegisterCta: 'הרשמה'` (`he.ts:1808`)
- Choosing `'הרשמה'` stashes the return target then calls `signOut()` (`guestGate.ts:51-58`), which **tears down the whole navigator and drops the user back on SignIn** — they then re-run §5 → §8. The stashed target is replayed by the pending-invite consumer in `RootNavigator.tsx:63-166` once the new account is ready.
- The profile tab also shows a standing guest card: `guestProfileTitle: 'הפרופיל שלך מחכה'` (`he.ts:1809`) + `guestProfileBody: 'אתה גולש כאורח. הירשם כדי לשמור מחזורים, להצטרף למועדונים ולבנות פרופיל שחקן.'` (`he.ts:1810-1811`) + `'הרשמה'` button — `ProfileScreen.tsx:1116-1119`.

---

### 13. Deep-link / install-attribution entry points that alter the first run

Cold start, in strict priority order (`App.tsx:537-577`):
1. `Linking.getInitialURL()` → `handleCold` (`:539-541`, handler `:436-458`)
2. existing stash in storage — if present, **stop**, skip 3 and 4 (`:545-547`)
3. Android Play Install Referrer — `consumeInstallReferrerIfFresh()` (`:552-553`, `src/services/installReferrerService.ts`)
4. iOS clipboard deferred deep link — `consumeClipboardInviteIfFresh()` (`:568-569`, `src/services/clipboardInviteService.ts`). Rationale at `App.tsx:562-567`: Apple has no install-referrer API, so the landing page copies the invite URL to the clipboard.

An invite-opened launch calls `adsService.noteIntentfulOpen()` to suppress the next app-open ad (`App.tsx:452, :488`). A campaign link `footy://open/<where>` with a `role` query param records the role via `recordRole` (`App.tsx:444, :478` → `src/services/roleService.ts:23-30` → `joryio.setAttributes({ user_type: role })`). The pending-destination consumer deliberately **does not wait on auth** — comment at `App.tsx:583-586`: "the role picker shows on a first run, and the tab it opens is reachable before a profile is complete."

The invite target itself is only navigated to once the user is signed in, profile-complete **and** onboarded (`RootNavigator.tsx:65`) — so an invited user still walks the full slides → sign-in → profile flow before reaching the game or club they tapped.

URL schemes / domains (`app.json`): `scheme: ["footy", "teamder", "com.studiogameslime.soccerapp"]`; iOS `associatedDomains: ["applinks:teamderfc.web.app"]`; Android verified App Links on `https://teamderfc.web.app` with `pathPrefix` `/session`, `/team`, `/app`. **There is no custom domain** — the only host is the Firebase Hosting default `teamderfc.web.app`, and it appears verbatim in the app's iOS entitlement and Android intent filter.

---

### 14. Tap-by-tap counts

"Tap" = one deliberate user action. System-UI taps (Google chooser, OS permission dialogs) are marked **[OS]** and counted separately so they can be excluded if the consultant prefers.

#### Branch A — Google, new user, no deep link (the likeliest Android path)

| # | Screen | Action |
|---|---|---|
| — | Native splash | wait (~instant) |
| — | Animated splash | wait ≥1.4s + 0.32s fade |
| 1 | Onboarding slide 1 | tap `'הבא'` (or swipe) |
| 2 | Onboarding slide 2 | tap `'הבא'` (or swipe) |
| 3 | Onboarding slide 3 | tap `'המשך'` |
| 4 | SignIn | tap `'המשך עם Google'` |
| **[OS]** | Google account chooser | tap the account (+ a Play Services update dialog if stale, `auth.ts:93-95`) |
| **[OS]** | Push permission dialog (fires over the next screen) | tap Allow / Don't allow |
| 5 | `'בוא נכיר'` | tap `'המשך'` (name already pre-filled from Google) |
| — | Animated splash again | wait for `groupHydrated` (`RootNavigator.tsx:274`) |
| — | `'בית'` | arrived |

**5 in-app taps, 2 OS taps, 0 text entries, 6 distinct screens** (2 splashes + 3 slides as one screen + sign-in + profile + home). Minimum path if the user taps `'דלג'` on slide 1: **3 in-app taps** (דלג → Google → המשך), 2 OS taps, 0 text entries.

#### Branch B — Email sign-up, new user

| # | Screen | Action |
|---|---|---|
| 1-3 | Onboarding | `'הבא'`, `'הבא'`, `'המשך'` |
| 4 | SignIn | tap `'המשך עם מייל'` |
| 5 | EmailAuth (opens in **sign-in** mode, `:45`) | tap `'אין לך חשבון? הרשמה'` |
| **T1** | | type email |
| **T2** | | type password (≥6) |
| **T3** | | re-type password |
| 6 | | tap `'הרשמה'` |
| **[OS]** | | push permission dialog |
| **T4** | `'בוא נכיר'` | type name (**empty** — `userService.ts:322`) |
| 7 | | tap `'המשך'` |
| — | | splash → `'בית'` |

**7 in-app taps, 1 OS tap, 4 text entries, 7 distinct screens.** Add 1 tap if the user also picks an avatar, 2+ taps and an **[OS]** photo-permission dialog if they upload a photo. Minimum with `'דלג'`: **5 in-app taps**, 4 text entries.

#### Branch C — Apple, new user, iOS

Same shape as A. `'המשך עם Apple'` at `SignInScreen.tsx:229` (iOS only, `:212`). The Apple sheet itself typically costs 1-2 **[OS]** interactions (share/hide email choice, then Face ID / Touch ID / password) — **not verified on device**. Name arrives from `fullName` on the *first* authorization only (`userService.ts:230-234`), so a re-authorizing user may land on `'בוא נכיר'` with an empty name and need 1 text entry.
**5 in-app taps, 2-3 OS taps, 0-1 text entries.**

#### Branch D — Guest

| # | Screen | Action |
|---|---|---|
| 1-3 | Onboarding | `'הבא'`, `'הבא'`, `'המשך'` |
| 4 | SignIn | tap `'המשך כאורח'` |
| — | | straight to `'בית'` |

**4 in-app taps, 0 OS taps, 0 text entries, 4 screens.** No push prompt (`RootNavigator.tsx:240`). But the account is not usable: the first attempt to join a game triggers the §12 wall, whose "register" path **signs them out** and restarts at SignIn — so the real cost of the guest path for a converting user is 4 taps + the dialog + the whole of Branch A or B again.

#### Branch E — returning user, already signed in

Splash → (optional `groupHydrated` splash) → `'בית'`. **0 taps.** A "מה חדש" modal may appear after a version bump (`App.tsx:1044-1051`).

#### Branch F — returning user after sign-out, same install

`onboardingDone` survives sign-out (`src/store/userStore.ts:164-187` never touches it; key at `src/services/storage.ts:7`), so the slides are skipped: Splash → SignIn → (provider) → `'בית'`. **1 in-app tap + 1 OS tap.** `onboardingCompleted` is already `true` on their `/users` doc, so `'בוא נכיר'` is skipped too.

#### Screen count summary

Distinct full screens a new Google user meets: **6** (native splash, animated splash, onboarding carousel, sign-in, post-sign-in profile, home) — 7 counting the second splash appearance separately. A new email user meets **7** (adds EmailAuth). A guest meets **4**.

---

### 15. Branches I did NOT check

Stated explicitly, per the brief:
- **Nothing was run on a device or emulator.** Every claim above is read from source. The exact rendering, the real ordering of the OS push dialog against the profile screen's first paint, and the exact Apple/Google system-sheet copy are **not** verified on hardware.
- I did not verify that the Play Install Referrer path or the iOS clipboard deferred-link path actually fire in a real store install — only that the code calls them and in what order (`App.tsx:552-576`).
- I did not read the landing pages (`public/index.html`, `public/get.html`, `public/invite.html`, `public/c/`, `public/downloads/`) — out of this surface.
- I did not enumerate `MainTabs` beyond the landing screen and the activation checklist.
- I did not check mock mode (`USE_MOCK_DATA`) behaviour beyond noting that every auth path short-circuits to `mockCurrentUser` (`userService.ts:168-172, :215-218, :264-268, :307-311`), which means **mock QA does not exercise any of the real first-run auth branches**.
- I did not verify the Remote Config defaults for `maintenance_mode`, `announcement_enabled`, `banner_enabled`, or `app_open_new_user_grace_ms` — only the code that reads them.

### Open questions from this section

Things this reader could not settle from the code, listed rather than assumed.

- Real device ordering: does the OS push-permission dialog actually land on top of the 'בוא נכיר' screen, or does it appear a beat earlier/later? The effect at RootNavigator.tsx:235-248 fires on the same render that chooses PostSignInOnboardingScreen, but only a device run proves the visual ordering.
- Exact copy and tap count of the Google account chooser and the Apple Sign-In sheet — system UI, not in our source. Also whether the Android Play Services update dialog (auth.ts:93-95) ever fires in practice on current devices.
- Does Apple's fullName actually arrive on a first authorization in the production build, or do iOS users land on 'בוא נכיר' with an empty name and an extra text entry? userService.ts:230-234 hedges on this.
- On a genuine fresh install, does the 'מה חדש' modal actually appear right after sign-up? The fresh-install branch at src/services/whatsNewService.ts:78-84 says it will surface the current version's highlights, but it also depends on the live appConfig whatsNew doc having items for version 1.1.10.
- Live Remote Config values for maintenance_mode, announcement_enabled, banner_enabled and app_open_new_user_grace_ms — these decide whether a new user sees an ad banner on the home screen in their first seconds and whether any blocking overlay fires.
- Whether the Play Install Referrer (Android) and clipboard deferred-link (iOS) paths at App.tsx:552-576 actually recover an invite on a real store install — only the call order is verifiable from source.
- Is the intro carousel intended to be unreachable forever after the first skip/complete? The AsyncStorage flag 'footy.onboarding.done' survives sign-out and account deletion on the same install, and there is no 'show intro again' anywhere.
- Whether the optional-update or force-update modal is currently armed for version 1.1.10 — a force modal would be the first interactive element a brand-new installer meets, before the slides.

---


## 5.2 · Acquisition and install — every way in

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

### Open questions from this section

Things this reader could not settle from the code, listed rather than assumed.

- Does the currently shipped iOS binary actually carry the com.apple.developer.associated-domains entitlement? The key is in app.json (expo.ios.associatedDomains) and in the local prebuild at ios/Teamder/Teamder.entitlements, and AASA is hosted correctly with the right Content-Type (firebase.json:41-43) — but memory project_app_links_setup records it being stripped for 1.0.30 because the provisioning profile lacked the capability, and a real iOS user confirmed on 2026-06-30 that links still open Safari. Needs `codesign -d --entitlements` on the shipped IPA, or a device test.
- What the Play Store and App Store listings ACTUALLY say right now. The only listing copy in-repo (app-store-metadata.md) is a paste-source draft: it still carries v1.0 'What's New', references the non-existent domain teamder.app for Privacy Policy and Marketing URL (lines 178-179), and lists support as lior@hippocampus.me while the in-app support_email default is studiogameslime@gmail.com (remoteConfigService.ts:53). Needs a look at both consoles.
- Has anyone verified that the Play Install Referrer round-trip still works end to end on a real 1.1.x install? The parse side is covered by code, but the native module (react-native-play-install-referrer) is loaded via an indirect require that fails silently (installReferrerService.ts:37-51) and marks itself consumed — a missing pod would look identical to an organic install.
- Whether /i/*, /go and /c/* were ever INTENDED to be App Links / Universal Links. They are absent from both the AASA paths array and the Android intentFilters, which means the path every modern share produces never opens an installed app directly. Cannot tell from code whether this is a deliberate choice (keep the landing page in the funnel) or an oversight.
- Is https://soccer-app-52b6b.web.app publicly discoverable / indexed? It serves every page identically (firebase.json:49-85) but is not in HOSTING_DOMAINS, so any link on it is dead for deep-linking and attribution.
- Real-world volume split: how many installs arrive via /i/ vs /get vs organic store search vs the root page. The counters exist (inviteLinks.clicks, inviteClicks/{uid}, adLinks, linkClicks, metrics/linkClicks) but the numbers are in production Firestore, not in the repo — and serveInviteCode's counter is inflated by link-preview crawlers (functions/src/index.ts:10712-10733), so the ratio of crawler hits to human taps needs measuring before any of it is trusted.
- What the first-run onboarding wizard actually shows. It is a Joryio in-app HTML message authored in an external dashboard, not in this repo; only its submit handler is here (src/services/onboardingService.ts). Its screen order, copy and the w5 invite step's wording could not be quoted from source.
- Whether the Play Console listing's screenshots match the two landing-page screenshots. The web ones (shot-home.jpg / shot-match.jpg) are dated 20.07.26 and still use the pre-rename 'משחקים'/'מועדונים' tab labels; whether the store assets are equally stale is not determinable here.
- Does the WhatsApp in-app browser on iOS reliably permit navigator.clipboard.writeText inside the CTA tap? The whole iOS attribution chain depends on it and every failure is swallowed (invite.html:231). Needs a device test from inside WhatsApp, Telegram and Instagram's browsers specifically.
- Is the un-wired handleInvitePlayers (MatchDetailsScreen.tsx:1462) intended to come back? It carries the only `game.visibility !== 'public'` guard in the share path; the live handleShare has none, so a club-only game is currently shareable to anyone. Cannot tell from code whether that is a regression or a decision.

---


## 5.3 · Underneath signup — what the system does

> **Repo root:** `/Users/matan/Projects/soccer`. All paths below are absolute.
> **Live hosting domain:** `https://teamderfc.web.app` — there is no custom domain. Nothing in this surface depends on it, but the email-verification and password-reset emails Firebase sends are Firebase-hosted (`/Users/matan/Projects/soccer/src/firebase/auth.ts:171`, `:202`), so their links carry a `firebaseapp.com` action handler, not a Teamder domain.
> **Report scope:** the invisible half of signup. Everything a consultant cannot see by tapping through the app.

---

### 1. Every auth provider offered

There are **five** distinct entry paths into an identity, exposed by four buttons on one screen.

#### 1.1 The buttons on `SignInScreen`

`/Users/matan/Projects/soccer/src/screens/auth/SignInScreen.tsx:173-275`

| Order on screen | Label (verbatim) | Gloss | Handler | Platform |
|---|---|---|---|---|
| 1 | `'המשך עם Google'` | "Continue with Google" | `handlePress` — `SignInScreen.tsx:44-93` | Android + iOS |
| 2 | `'המשך עם Apple'` | "Continue with Apple" | `handleApple` — `SignInScreen.tsx:97-139` | **iOS only** — gated by `Platform.OS === 'ios'` at `SignInScreen.tsx:212` |
| 3 | `'המשך עם מייל'` | "Continue with email" | navigates to `EmailAuth` — `SignInScreen.tsx:236-252` | both |
| 4 | `'המשך כאורח'` | "Continue as guest" | `handleGuest` — `SignInScreen.tsx:143-155` | both |

Strings: `/Users/matan/Projects/soccer/src/i18n/he.ts:1795` `signInGoogle: 'המשך עם Google'`, `:1796` `signInApple: 'המשך עם Apple'`, `:1797` `signInEmail: 'המשך עם מייל'`, `:1798` `signInGuest: 'המשך כאורח'`.

Screen copy: `he.ts:1793` `signInTitle: 'בואו נכיר'` ["let's get started"], `he.ts:1794` `signInSubtitle: 'התחבר כדי להירשם, להצטרף למועדון ולעקוב אחרי הסטטיסטיקות שלך.'`, `he.ts:1799` `signInPrivacy: 'באמצעות התחברות אתה מסכים לתנאי השימוש'` ["by signing in you agree to the terms of use"] — rendered as plain `<Text>` at `SignInScreen.tsx:272`, **not a link**; nothing in this file opens a terms document.

Note the **title/subtitle grammar mix**: the title is plural/polite (`בואו`) and the subtitle is masculine-singular imperative (`התחבר`). Both are on screen at the same time.

Note also `he.ts:1846` `profileTitle: 'בוא נכיר'` and `he.ts:2839` `psoProfileTitle: 'בוא נכיר'` — the *next* screen's title ("let's get acquainted") is one character away from the sign-in title `'בואו נכיר'`.

#### 1.2 The five service-layer signup paths

All in `/Users/matan/Projects/soccer/src/services/userService.ts`:

1. **`signInAsGuest`** — `userService.ts:61-67` → `fbSignInAnonymously` (`/Users/matan/Projects/soccer/src/firebase/auth.ts:407-412`). **Writes no `/users` doc at all.**
2. **`signInWithGoogle`** — `userService.ts:167-212` → `signInWithGoogle` (`auth.ts:79-128`), native picker via `@react-native-google-signin/google-signin`.
3. **`signInWithApple`** — `userService.ts:214-256` → `signInWithApple` (`auth.ts:331-399`), `expo-apple-authentication` with a SHA-256 hashed nonce (`auth.ts:343-349`).
4. **`signInWithEmail`** (existing account) — `userService.ts:263-298` → `auth.ts:148-159`.
5. **`signUpWithEmail`** (new account) — `userService.ts:306-343` → `auth.ts:161-197`.

Plus a sixth, non-button path: **`getCurrentUser` lazy-create** — `userService.ts:140-158`. On cold start, if Firebase Auth restores a user but `/users/{uid}` does not exist, the doc is created there. Comment at `userService.ts:134-139` states the two cases it covers: a brand-new sign-in whose `setDoc` never ran, and recovery after a previous launch left an Auth user with no doc.

#### 1.3 Guest — what an anonymous session actually is

`buildGuestUser` — `userService.ts:44-53`:

```
{ id: uid, name: '', avatarId: pickRandomAvatarId(), createdAt: Date.now(),
  onboardingCompleted: true, isGuest: true }
```

This object exists **only in memory**. It is never written to Firestore, and `cacheAuthUser` explicitly refuses to persist it (`userService.ts:881-883`). `onboardingCompleted: true` is a lie told to the navigator so it skips the profile gate (`userService.ts:90-91`, `/Users/matan/Projects/soccer/src/navigation/RootNavigator.tsx:267`).

A guest hitting any account action gets a dialog from `ensureNotGuest` (`/Users/matan/Projects/soccer/src/utils/guestGate.ts:39-64`):
- Title `he.ts:1801` `guestRegisterTitle: 'נדרשת הרשמה'` ["registration required"]
- Default body `he.ts:1802` `guestRegisterBody: 'כדי להשתמש בתכונה הזו צריך חשבון. רוצה להירשם עכשיו?'`
- Per-action bodies: `he.ts:1803` `guestRegisterJoinGame: 'כדי להירשם למחזור צריך חשבון. רוצה להירשם עכשיו?'`; `:1804` `guestRegisterJoinCommunity: 'כדי להצטרף למועדון צריך חשבון. רוצה להירשם עכשיו?'`; `:1805` `guestRegisterChatAdmin: 'כדי לשלוח הודעה למנהל צריך חשבון. רוצה להירשם עכשיו?'`; `:1806` `guestRegisterCreate: 'כדי ליצור צריך חשבון. רוצה להירשם עכשיו?'`; `:1807` `guestRegisterChat: 'כדי להשתמש בצ׳אט צריך חשבון. רוצה להירשם עכשיו?'`
- Buttons: `he.ts:52` `cancel: 'בטל'` and `he.ts:1808` `guestRegisterCta: 'הרשמה'`

Choosing `'הרשמה'` **signs the guest out entirely** (`guestGate.ts:58`) — the whole navigator swaps and they land back on `SignInScreen`. The action they were attempting is stashed first as a pending invite (`guestGate.ts:51-57`) so `RootNavigator`'s consumer can resume it after signup (`RootNavigator.tsx:63-166`).

---

### 2. The exact document written to `/users/{uid}` on first signup

This is the single most commonly mis-stated fact about this codebase: **the object built in `userService` is not the object stored.** Every write goes through `docs.user(uid)` (`/Users/matan/Projects/soccer/src/firebase/firestore.ts:2039-2041`), which is `doc(col.users(), uid)`, and `col.users()` carries `.withConverter(userConverter)` (`firestore.ts:1911-1913`). So `setDoc(ref, fresh)` writes `userConverter.toFirestore(fresh)` (`firestore.ts:183-264`).

#### 2.1 The object the service builds

Google — `userService.ts:181-188`; Apple — `:228-239`; email sign-up — `:320-327`; email sign-in lazy-create — `:277-284`; cold-start lazy-create — `:140-147`.

| Field | Google `:183-187` | Apple `:234-238` | Email **sign-up** `:322-326` | Email **sign-in** lazy `:279-283` | Cold-start lazy `:142-146` |
|---|---|---|---|---|---|
| `name` | `fbUser.displayName ?? ''` | `fbUser.displayName ?? fullName ?? ''` | **`''` hardcoded** | `fbUser.displayName ?? ''` | `fbUser.displayName ?? ''` |
| `email` | `fbUser.email ?? undefined` | `fbUser.email ?? undefined` | `fbUser.email ?? email.trim()` | `fbUser.email ?? email.trim()` | `fbUser.email ?? undefined` |
| `avatarId` | `pickRandomAvatarId()` | same | same | same | same |
| `createdAt` | `Date.now()` | same | same | same | same |
| `onboardingCompleted` | `false` | `false` | `false` | `false` | `false` |

Apple's `fullName` is only available on the very first authorization; the comment at `userService.ts:230-233` and `auth.ts:326-329` both say so. `auth.ts:378-383` joins `givenName` + `familyName`.

`pickRandomAvatarId()` — `/Users/matan/Projects/soccer/src/data/avatars.ts:70-72` — picks uniformly from the 24 entries in `AVATARS` (`avatars.ts:23-55`), each an emoji glyph on a coloured circle (`a01` `⚽` … `a24` `🧓`). **Every new account therefore arrives with a randomly-assigned emoji avatar before the user has chosen anything.**

#### 2.2 The document that actually lands in Firestore

Produced by `userConverter.toFirestore` (`firestore.ts:183-264`). For a brand-new Google account:

| Firestore field | Initial value | Source line |
|---|---|---|
| `name` | the provider display name, or `''` | `firestore.ts:185` |
| `email` | the address, or `null` | `firestore.ts:186` |
| `avatarId` | `'a01'`…`'a24'` (random) | `firestore.ts:187` |
| `position` | `null` | `firestore.ts:188` |
| `createdAt` | device-clock epoch ms | `firestore.ts:189` |
| `updatedAt` | `Date.now()` (since `u.updatedAt` is undefined) | `firestore.ts:190` |
| `onboardingCompleted` | `false` | `firestore.ts:191` |
| `availability` | `null` | `firestore.ts:192-217` |
| `stats` | `null` | `firestore.ts:218-243` |
| `notificationPrefs` | `null` | `firestore.ts:250` |
| `dmFriendsOnly` | `false` | `firestore.ts:251` |
| `newGameSubscriptions` | `[]` | `firestore.ts:252` |
| `personalGroupId` | `null` | `firestore.ts:253` |
| `jersey` | `null` | `firestore.ts:254` |
| `achievements` | `null` | `firestore.ts:255` |
| `discipline` | `null` | `firestore.ts:256` |
| `invitedBy` | `null` | `firestore.ts:257` |
| `invitedByType` | `null` | `firestore.ts:258` |
| `invitedByTargetId` | `null` | `firestore.ts:259` |

**Fields deliberately NOT written on create**, each for a stated reason:
- `photoUrl` — absent from `toFirestore` entirely. The comment at `firestore.ts:274` says "photoUrl kept readable for legacy docs; never written by new code." **Consequence: the Google account photo is discarded at signup.** A new user's picture is the random emoji until they upload one on the onboarding screen.
- `fcmTokens` — moved to the self-only subdoc `/users/{uid}/private/push`; `firestore.ts:244-249` explains that writing them on the world-readable doc re-leaked every device token to any signed-in user.
- `invitedAt` — written separately with `serverTimestamp()` so a re-save cannot clobber the server time (`firestore.ts:260-263`, written at `userService.ts:934`).
- `friends` — read but never written; owned by the server-side accept/remove callables (`firestore.ts:294-298`).
- `qa`, `platform`, `lastSeenAt`, `acquisition`, `lastBroadcastAt` — none exist at create; each is added later by a different writer.

#### 2.3 Notification preferences on day one

`notificationPrefs` is `null` on the document. The **effective** defaults come from `defaultNotificationPrefs` (`/Users/matan/Projects/soccer/src/types/index.ts:405-424`): all 18 types default `true` except `growthMilestone: false` (`types/index.ts:414`). `marketingPush: true` (`types/index.ts:423`) — a new user is opted **in** to marketing push by default, with nothing on the signup screens saying so.

#### 2.4 What Firestore rules require of that create

`/Users/matan/Projects/soccer/firestore.rules:262-277`:

```
allow create: if isSelf(uid) &&
  (!('invitedBy' in request.resource.data) || request.resource.data.invitedBy != uid) &&
  isOptionalShortString(request.resource.data, 'name', 60) &&
  nameNotReserved(request.resource.data) &&
  nameNotEmail(request.resource.data) &&
  isOptionalShortString(request.resource.data, 'email', 200) &&
  isOptionalShortString(request.resource.data, 'photoUrl', 2048) &&
  isOptionalShortString(request.resource.data, 'avatarId', 80);
```

`isSelf` — `firestore.rules:31-33`. `isOptionalShortString` — `firestore.rules:124-127` (missing **or null** **or** short enough), which is what lets the converter's `null` placeholders through. `allow read: if isSignedIn()` (`firestore.rules:260`) — **every signed-in user can read every user document**, including a brand-new one. `allow delete: if false` (`firestore.rules:343`).

Two size mismatches worth naming: the rule caps `name` at **60** characters (`firestore.rules:272`) while both name inputs cap at **40** (`PostSignInOnboardingScreen.tsx:169`, `ProfileSetupScreen.tsx:81`).

---

### 3. Validation on the name field

There are **four** layers, and they do not all say the same thing.

#### 3.1 Layer 1 — the input itself

- `PostSignInOnboardingScreen.tsx:164-172`: `maxLength={40}`, `required`, label `he.profileName`, placeholder `he.profileNamePlaceholder`. **No `returnKeyType`/submit wiring.**
- `ProfileSetupScreen.tsx:76-88`: `maxLength={40}`, `required`, plus `returnKeyType="done"` and `onSubmitEditing` that saves (`ProfileSetupScreen.tsx:84-87`).
- Save CTA enabled only when `name.trim().length > 0` — `PostSignInOnboardingScreen.tsx:61`, `ProfileSetupScreen.tsx:27`.

Strings: `he.ts:1847` `profileName: 'שם'` ["name"], `he.ts:1848` `profileNamePlaceholder: 'איך לקרוא לך?'` ["what should we call you?"], `he.ts:1849` `profileNameRequired: 'שם הוא שדה חובה'` ["name is a required field"] — **`profileNameRequired` has no call site in either signup screen**; the CTA simply stays disabled instead.

#### 3.2 Layer 2 — sanitisation

`sanitizeDisplayString` — `/Users/matan/Projects/soccer/src/utils/validate.ts:111-119`. Strips C0 control characters + DEL, then zero-width and bidirectional-override characters (U+200B–U+200F, U+202A–U+202E, U+2060–U+206F, U+FEFF), then trims. Called at `userService.ts:363` (`completeOnboarding`) and `userService.ts:730` (`updateProfile`). The comment at `userService.ts:360-362` notes onboarding used to only `trim()`, so impersonation and layout-reversal characters persisted.

#### 3.3 Layer 3 — the reserved-brand and email-shaped checks (client)

`/Users/matan/Projects/soccer/src/utils/officialAccount.ts`.

**Reserved brand** — `officialAccount.ts:32`:
```
export const RESERVED_NAME_RE = /teamder|טימדר|טיאמדר|תימדר/i;
```
`isReservedName` (`officialAccount.ts:47-52`) strips whitespace, dots, underscores and hyphens first (`.replace(/[\s._-]/g, '')`) so `"T e a m d e r"` and `"team-der"` fall to the same test. Deliberately a **substring** match (`officialAccount.ts:25-32`): `"Teamder Support"`, `"teamder.app"` and `"צוות טימדר"` are all blocked. The Hebrew variants are `טימדר`, `טיאמדר`, `תימדר`.

**Email-shaped name** — `officialAccount.ts:62`:
```
const EMAIL_NAME_RE = /[^@\s]@[^@\s]+\.[a-z]{2,}/i;
```
`isEmailLikeName` — `officialAccount.ts:87-89`. The doc comment (`officialAccount.ts:64-86`) records why it exists: Google Play's **pre-launch report** robot (Firebase Test Lab) is handed the demo credentials from Play Console's "App access" page and types them into every text input it meets, including this name field. **47 accounts named `appstore.review@teamder.app` accumulated between 22.06 and 19.09.2026**, all Android, clustering on release days. Two of them played in a finished game of a real seven-player club and sit inside its statistics; a third was in that club's pending queue 75 seconds after signing up. Of 676 live accounts on 19.09.2026, not one real person had chosen an email-shaped name.

Thrown as opaque codes: `userService.ts:368` `throw new Error('RESERVED_NAME')`, `userService.ts:373` `throw new Error('EMAIL_NAME')` (in `completeOnboarding`); mirrored at `userService.ts:731-732` (in `updateProfile`).

#### 3.4 Layer 4 — Firestore rules (the actual enforcement)

`firestore.rules:148-152` `nameNotReserved`:
```
!(data.name.lower().replace('[\\s._-]', '').matches('.*(teamder|טימדר|טיאמדר|תימדר).*'))
```
`firestore.rules:182-185` `nameNotEmail`:
```
!(data.name.lower().matches('.*[^@\\s]@[^@\\s]+[.][a-z]{2,}.*'))
```
On **update** both are relaxed to fire only when the name actually changes — `nameNotNewlyReserved` (`firestore.rules:203-207`) and `nameNotNewlyEmail` (`firestore.rules:191-195`) — so an account already carrying such a name is not locked out of unrelated writes (FCM token refresh, availability). Rationale at `firestore.rules:187-190` and `:196-202`.

The rules comment at `firestore.rules:154-181` carries the same 47-account history and adds the specific hole that was closed: `nameNotReserved` **used to exempt any name containing `'@'`**, and `appstore.review@teamder.app` contains "teamder", so the `@` escape hatch was the entire vulnerability.

Pinned cases live in `/Users/matan/Projects/soccer/tests/rules/displayName.test.mjs` — blocked at `:95-100` (`appstore.review@teamder.app`, `hazelblake.54551@gmail.com`, uppercase, `+tag`, padded, and an address **embedded** in a Hebrew name `'מתן someone@gmail.com'`); allowed at `:110-113` (`'עידן @ נחלים'`, `'DJ @Khaled'`, `user@localhost`, `a@b.c`).

#### 3.5 The Hebrew error strings — and where they are and are not shown

| Code | String (verbatim) | he.ts line |
|---|---|---|
| `RESERVED_NAME` | `officialNameTaken: 'השם הזה שמור לחשבון הרשמי של Teamder. בחרו שם אחר.'` | `he.ts:640-641` |
| `EMAIL_NAME` | `emailNameNotAllowed: 'כתובת אימייל היא לא שם. איך קוראים לכם?'` | `he.ts:642-643` |
| generic | `profileSaveError: 'לא הצלחנו לשמור את הפרטים. בדוק את החיבור ונסה שוב.'` | `he.ts:189` |
| dialog title | `error: 'שגיאה'` | `he.ts:188` |

**`ProfileSetupScreen` maps all three correctly** — `ProfileSetupScreen.tsx:44-51`.

**`PostSignInOnboardingScreen` does not.** Its catch block is `PostSignInOnboardingScreen.tsx:121-130`, and it shows `appAlert(he.error, he.signInFailed)` unconditionally (`:127`). `he.signInFailed` is `he.ts:1264` `'ההתחברות נכשלה. נסה שוב.'` ["sign-in failed. try again."]. So on the screen **every new user actually passes through**, a user who types `"Teamder"` or their own email address as their name is told that *sign-in* failed — a sentence about a step they already completed, with no indication that the name is the problem, and the CTA re-enables so they can tap it again forever. `he.profileSaveFailed` (`he.ts:2817` `'שמירת הפרופיל נכשלה. נסה שוב.'`) exists and is not used here either.

`ProfileSetupScreen` — the screen with the correct messages — is reachable only when `onboardingCompleted === true` **and** `name` is empty (`RootNavigator.tsx:267-271`), i.e. legacy accounts. Since `completeOnboarding` sets both in one write (`userService.ts:392-396`), a new user in 2026 never sees it.

---

### 4. What fires automatically on signup

Grouped by when it runs relative to the user seeing the next screen.

#### 4.1 Inside the signup call, awaited — blocks the transition

For Google (`userService.ts:167-212`), Apple (`:214-256`) and email **sign-up** (`:306-343`), in this exact order:

1. `getDoc(ref)` — one read to check whether the doc already exists (`userService.ts:175`, `:222`, `:314`).
2. `setDoc(ref, fresh)` — the create (`:194`, `:241`, `:329`).
3. **`applyInviteAttributionIfFresh(fresh.id)`** — `userService.ts:208`, `:252`, `:339`; implementation `userService.ts:908-940`. Reads the stashed pending invite, re-reads the user doc, and if an inviter exists writes:
   ```
   { invitedBy, invitedByType, invitedByTargetId, invitedAt: serverTimestamp() }
   ```
   (`userService.ts:930-935`). Hard bails: mock mode, no pending invite, no `invitedBy`, self-invite, or `invitedBy` already set (`userService.ts:912-920`). A generic app invite has no target, so `'app'` is substituted so the rules' "type+target present" guard passes (`userService.ts:922-925`). `serverTimestamp()` not `Date.now()` so a wrong device clock cannot corrupt the ordering (`userService.ts:926-929`).
4. **`applyAcquisitionIfFresh(fresh.id)`** — `userService.ts:209`, `:253`, `:340`; implementation `:949-978`. Set-once. Writes:
   ```
   acquisition: { source, campaign?, linkId?, gameId?, at: Date.now() }
   ```
   (`userService.ts:965-973`). `source` is the channel label (whatsapp/facebook/…), `linkId` the specific tracked link `al_…` — shapes at `/Users/matan/Projects/soccer/src/services/storage.ts:67-73`.
5. `cacheAuthUser(fresh)` — `userService.ts:210`, `:254`, `:341`; implementation `:879-888`. Writes the user JSON to AsyncStorage key `'footy.auth.user'` (`storage.ts:8`) as the offline cold-start fallback.

**Both attribution helpers are `await`ed**, so on a slow network the user stares at the sign-in button's spinner through two extra Firestore reads and up to two writes. Both swallow their own errors (`userService.ts:936-939`, `:974-977`) so they cannot fail the signup — but they can delay it.

**Asymmetry:** `signInWithEmail` (`userService.ts:263-298`) **does not call either helper** — it goes straight from `setDoc` (`:286`) to `cacheAuthUser` (`:296`). So if an account is first materialised through the sign-in path rather than the sign-up path, its referral and acquisition attribution is silently lost. The cold-start lazy-create *does* call both (`userService.ts:155-156`).

#### 4.2 Fired in parallel, not awaited

**Joryio `identify`** — `/Users/matan/Projects/soccer/src/firebase/auth.ts:466-474`. The `onAuthStateChanged` listener registered by `waitForAuthRestore` (`auth.ts:442-481`) stays alive after the first `null` emission specifically so a later sign-in still reaches Joryio. On sign-in it calls:
```
joryio.identify(user.uid, { email: user.email ?? undefined, name: user.displayName ?? undefined })
```
`identify` (`/Users/matan/Projects/soccer/src/services/joryio.ts:130-150`) also stamps `platform` and `appVersion` as attributes (`joryio.ts:146-147`). The comment at `auth.ts:450-455` records the bug this fixed: on a fresh install the first emission is `null`, `unsub()` used to run right there, and "a day-one user spent their entire first session as an anonymous record with no email and no `push_permission` — which is precisely the attribute the onboarding journey branches on."

**Native auth mirror** — `mirrorToNativeAuth` at `auth.ts:112` (Google) and `auth.ts:387-389` (Apple); `mirrorEmailToNativeAuth` at `auth.ts:157` / `:174` (email, Android only — `auth.ts:225`). Establishes a parallel `@react-native-firebase/auth` session so the home widget and Wear relay can write the timer (`auth.ts:239-252`).

**Email verification** — `sendEmailVerification(cred.user)` at `auth.ts:171`, explicitly `.catch()`-ed and never awaited. Comment at `auth.ts:133-135`: verification "only proves inbox control, not that the address is 'real'", so usage is not blocked on it. **Nothing in the app ever checks `emailVerified`** for the signup flow.

#### 4.3 Analytics events

All go to **two sinks at once** — Firebase Analytics and Joryio — via `logEvent` (`/Users/matan/Projects/soccer/src/services/analyticsService.ts:569-591`): `void joryio.track(name, cleaned)` at `:583`, then `analytics().logEvent(...)` at `:585-586`. `cleanParams` stamps `platform` on every event (`analyticsService.ts:598-612`). Joryio renames some events on the way out via `NAME_OVERRIDES` (`joryio.ts:71-89`) — relevant here: `onboarding_completed → 'Onboarding Completed'` (`joryio.ts:85`).

In firing order for a Google signup:

| Event constant | Wire name | Fired at |
|---|---|---|
| `SignInAttempted` | `sign_in_attempted` (`analyticsService.ts:319`) | `SignInScreen.tsx:45`, params `{ method: 'google' }` |
| `SignInSuccess` | `sign_in_success` (`analyticsService.ts:24`) | `/Users/matan/Projects/soccer/src/store/userStore.ts:133` |
| `PushPermissionResult` | `push_permission_result` (`analyticsService.ts:332`) | `/Users/matan/Projects/soccer/src/services/notificationsService.ts:676-679`, params `{ granted, can_ask_again }` |
| `ProfileCreated` | `profile_created` (`analyticsService.ts:30`) | `userStore.ts:256` |
| `OnboardingCompleted` | `onboarding_completed` (`analyticsService.ts:27`) | `userStore.ts:257` |

Guest signup logs `SignInSuccess` with `{ method: 'guest' }` (`userStore.ts:145`) — so **guests are counted as successful sign-ins in both analytics systems**, with only a param distinguishing them.

Optional events on the onboarding screen: `PhotoUploaded` `photo_uploaded` (`PostSignInOnboardingScreen.tsx:95`), `AvatarChanged` `avatar_changed` (`:107-110`, params `{ source: 'onboarding', avatarId }`), `PhotoUploadAbandoned` `photo_upload_abandoned` (`:74-77`), `PhotoUploadFailed` `photo_upload_failed` (`:79-82`), `ProfileSaveFailed` `profile_save_failed` (`:123-126`).

Email-path events: `AuthModeSwitched` `auth_mode_switched` (`EmailAuthScreen.tsx:65-68`), `SignInProviderConflict` `sign_in_provider_conflict` (`:91`), `SignInFailed` `sign_in_failed` (`:101-105`), `PasswordResetRequested` `password_reset_requested` (`:139-142`, `:148`, `:155`, `:158`, `:162`).

#### 4.4 Push permission — when the OS prompt appears

`RootNavigator.tsx:235-248`. The effect keys on `currentUser?.id`, so it fires **the instant `currentUser` is set** — i.e. immediately after `signInWithGoogle` resolves, at the same moment `RootNavigator` renders `PostSignInOnboardingScreen`. So on a real device the OS push-permission dialog lands **on top of the "בוא נכיר" profile screen**, before the user has typed their name.

Guests are explicitly skipped (`RootNavigator.tsx:240`) with the stated reason at `:237-239`: an anonymous session should not trigger the prompt (App Store 5.1.1 friction) and would only register an orphan token.

`requestAndRegisterPushToken` (`notificationsService.ts:634-696`): checks existing permission (`:671`), requests if `canAskAgain` (`:673-680`), fetches the FCM token (`:685`), then `registerDeviceToken` (`:687`). `registerDeviceToken` (`notificationsService.ts:475-510`) does three things: mirrors the token to Joryio (`:479`), writes `{ fcmTokens: arrayUnion(token), devices: {…}, updatedAt }` to `/users/{uid}/private/push` (`:481-497`), and prunes any 64-hex APNs tokens (`:509`). `joryio.registerPushToken` (`joryio.ts:239-259`) also sets the `push_permission` attribute (`:252-257`).

There is **no pre-permission priming screen anywhere in this flow** — no explanation of why notifications matter before the OS dialog.

#### 4.5 Presence ping

`touchPresence` — `userService.ts:987-1005`, called fire-and-forget from `getCurrentUser` at `:126` when the doc already exists. Writes `{ platform: Platform.OS, lastSeenAt: now }`. Throttled to once per 6h (`userService.ts:987`, `:992-995`) and gated behind the `feature_campaigns` remote-config kill-switch (`:991`). **It does not run on the signup path** — only on subsequent launches — so `platform` and `lastSeenAt` are absent from a day-zero user document.

#### 4.6 Cloud Functions that fire on the new `/users` doc

Exactly **one** Firestore trigger fires on user creation. `grep` over `/Users/matan/Projects/soccer/functions/src` for `onDocumentCreated` returns one match on the users collection:

**`onNewUserJoined`** — `/Users/matan/Projects/soccer/functions/src/index.ts:12829-12896`.

- Reads `name`; falls back to `'משתמש חדש'` ["new user"] when the name is empty or the tombstone `'משתמש שהוסר'` (`index.ts:12833-12834`).
- **Polls for attribution**: because `applyInviteAttributionIfFresh` / `applyAcquisitionIfFresh` land as *separate client updates* 1–3s later, neither is on the doc at create time. The function sleeps and re-reads three times with waits of **3000, 5000, 6000 ms** (`index.ts:12845-12857`), breaking early once an inviter or campaign lands. An organic signup waits out the full **14 seconds** and burns 3 extra document reads.
- Builds a Hebrew "via" suffix (`index.ts:12863-12888`), precedence: tracked link → personal referral → campaign → bare source:
  - `' · דרך קישור ' + linkName` / `' · דרך קישור'` (`:12874`)
  - `' · דרך ' + invName` / `' · דרך הזמנה'` (`:12880`, `:12882`)
  - `' · דרך קמפיין ' + campaign` (`:12885`)
  - `' · דרך קישור ' + source` (`:12887`)
- Sends **to the founder, not to the user** — `pushToAdmins('newUser', 'Teamder', \`מישהו נרשם לאפליקציה! 🎉 (${name})${via}\`, { uid })` (`index.ts:12890-12895`). `pushToAdmins` (`/Users/matan/Projects/soccer/functions/src/adminPush.ts:12-…`) honours a per-type mute in `adminConfig/prefs` (`:22-29`) and a 20-second same-type flood latch (`:38-49`).

**There is no welcome push, no welcome email, and no welcome notification to the new user.** `grep -rni "welcome" /Users/matan/Projects/soccer/functions/src` returns nothing.

**No server-side Joryio integration exists.** `grep -rn "joryio" /Users/matan/Projects/soccer/functions/src` returns nothing — every Joryio identify/track/attribute call in this system is client-side.

#### 4.7 Campaign enrolment

There is no enrolment step. Campaigns are **evaluated against a segment at send time**, so a new user is eligible from the moment their doc exists.

- **Push campaigns**: `sweepDueCampaigns` (`/Users/matan/Projects/soccer/functions/src/adminUserPush.ts:422-435`) is run from the cron at `index.ts:13480`; it picks up to 10 queued campaigns whose `sendAt` has passed and calls `processCampaign` (`adminUserPush.ts:231-419`), which **reads the entire `/users` collection** (`adminUserPush.ts:311`) and matches each user against the segment.
- Segment fields relevant to a new signup (`adminUserPush.ts:320-344`): `daysSinceJoin` computed as `(now - u.createdAt) / DAY` (`:126`), `invited: !!u.invitedBy`, `platform: u.platform`, `inGroup`, `hasPush`.
- **`hasPush` is computed from the root `u.fcmTokens` field** (`adminUserPush.ts:341`) — which the converter no longer writes (`firestore.ts:244-249`). Actual delivery reads the private subdoc (`tokensFor`, `adminUserPush.ts:206-217`). So a brand-new user who granted push permission is `hasPush: false` for **targeting** while being perfectly reachable for **delivery**. The identical bug exists client-side for popup campaigns at `/Users/matan/Projects/soccer/src/services/campaignService.ts:131`.
- **Per-user daily cap**: anyone who received a broadcast in the last 24h is dropped (`adminUserPush.ts:356`), and `lastBroadcastAt` is stamped on everyone reached (`adminUserPush.ts:396-402`).

#### 4.8 The Joryio in-app onboarding wizard

A **second onboarding**, delivered as a Joryio in-app HTML campaign rather than as app code.

`/Users/matan/Projects/soccer/src/services/onboardingService.ts:1-12` describes it: an HTML document served under `script-src 'none'` — "it can show, it can branch, and it can hold what somebody typed, but it cannot call anything." A single `data-action="submit"` is turned into one call by the shim in `/Users/matan/Projects/soccer/src/components/joryio/InAppMessageHost.tsx:157`.

`submit` (`onboardingService.ts:72-118`):
- `role` is `'player'` or `'organiser'` (`:73`); `recordRole(role)` fires (`:74`).
- `clubMode === 'join'` → `groupService.requestJoinByCode(code)` (`:86`), advances to step `w6`.
- Otherwise creates a club via `groupService.createGroup` (`:105-110`) and advances to `w5` with a short invite link (`:112`).
- Error strings: `he.onboardingNeedCode` (`:83`), `he.onboardingBadCode` (`:88`), `he.onboardingNeedClubName` (`:102`), `he.error` (`:77`, `:95`, `:116`).

`recordRole` (`/Users/matan/Projects/soccer/src/services/roleService.ts:23-30`) writes the answer **both ways**: `logEvent(AnalyticsEvent.RoleSelected, { role })` (`:25`) and `joryio.setAttributes({ user_type: role })` (`:26`). The comment at `roleService.ts:13-22` explains why: "the event is the timestamp… the attribute is the state… Joryio gets no merge fields from us, so anything a future message wants to know has to be on the profile before it is sent."

The only channel an in-app message has is a link, because the document runs under `script-src 'none'` — `roleService.ts:3-6` gives the shape: `footy://open/create-community?role=organiser`.

**This means the "what kind of user are you?" question a consultant will look for is not in the binary.** It is authored in the Joryio console as an HTML campaign, and whether a given new user sees it depends on campaign targeting outside this repo.

#### 4.9 Organiser signals

`reportOrganiserState` — `/Users/matan/Projects/soccer/src/services/organiserSignals.ts:54-88`, called from `/Users/matan/Projects/soccer/src/store/groupStore.ts:158`. Sets Joryio attributes from the clubs the user **admins** (`organiserSignals.ts:60-62`) and raises `ClubRosterMilestone` / `ClubBecamePlayable` events (`:70-78`). Milestone high-water marks are kept in AsyncStorage under `'organiser:rosterBest:v1'` (`organiserSignals.ts:35`), so a reinstall re-sends one.

Two limitations stated in the file header (`organiserSignals.ts:9-18`): the facts are only as fresh as the last time the organiser opened a club screen, and it only ever reports clubs the person **admins** — "being told to grow somebody else's squad is the kind of message that gets an app muted."

A brand-new user has no clubs, so on signup this reports zero-length attribute arrays and fires no milestone.

#### 4.10 Ads

New accounts get an ad-free honeymoon: `showAppOpenAdIfAvailable({ accountCreatedAt: currentUser?.createdAt })` (`RootNavigator.tsx:189-191`), and the gate at `/Users/matan/Projects/soccer/src/services/adsService.ts:441-446` suppresses the app-open ad while `Date.now() - accountCreatedAt < rcNumber('app_open_new_user_grace_ms')`. Default **2 days** — `/Users/matan/Projects/soccer/src/services/remoteConfigService.ts:27`.

The app-open ad only runs once `membership === 'member'` (`RootNavigator.tsx:187`), so a user with no club never sees it regardless.

#### 4.11 Never called

`joryio.resetUser` exists (`joryio.ts:186-189`, exported at `joryio.ts:407`) but **has no call site anywhere in `src/` or `App.tsx`**. `userStore.signOut` (`userStore.ts:164-187`) clears the group, game and chat stores but does not reset the Joryio identity. So after sign-out the install stays bound in Joryio to the previous person, and a second person signing up on the same device is `identify`-ed over the top of the first.

---

### 5. Failure modes

#### 5.1 The `/users` doc write fails (rules denied, quota, network)

**Google / Apple / email-sign-up / email-sign-in** — `userService.ts:193-207` (Google), `:240-251` (Apple), `:285-295` (email sign-in), `:328-338` (email sign-up). All four do the same three things:
1. `logError('createUserDoc', err, { uid, provider, email })` — writes to the `/errors` collection via the buffered logger (`/Users/matan/Projects/soccer/src/services/errorLog.ts:235-275`), which in turn triggers the `onErrorLogged` founder alert (`functions/src/index.ts:13072`).
2. **Sign the user back out** — `signOutFirebase()` wrapped in its own try/catch (`userService.ts:201-205`). The stated reason at `:189-192`: otherwise we leave a Firebase Auth user with no `/users` doc and the next launch crashes on `currentUser.name`.
3. Re-throw.

The user then sees, from `SignInScreen.tsx:88` / `:134`: `appAlert(he.error, friendlySignInError(err))`. `friendlySignInError` (`SignInScreen.tsx:158-171`) has no branch for a Firestore permission error, so the message is the catch-all `he.ts:1264` `signInFailed: 'ההתחברות נכשלה. נסה שוב.'`. **The user is told sign-in failed when sign-in in fact succeeded and only the profile write failed** — and because they were silently signed out, retrying looks identical.

**Cold-start lazy-create** — `userService.ts:148-154`. Different behaviour: logs, and **returns `null`** instead of signing out. `hydrate` (`userStore.ts:115-120`) turns that into `currentUser: null`, and `RootNavigator.tsx:255` renders `AuthStack initialRoute="SignIn"`. A user with a valid Auth session is shown the sign-in screen with **no error message at all**.

#### 5.2 Offline

**Cold start, signed in, no network.** `getCurrentUser` races the `getDoc` against an **8-second timeout** (`userService.ts:104-109`). The comment at `:96-101` explains: with no offline persistence, an offline `getDoc` hangs forever and the boot awaits it, so the splash would spin indefinitely — "very common for this app: locker rooms / dead zones." On timeout it falls back to the AsyncStorage snapshot (`userService.ts:112-120`), but only if `cached.id === fbUser.uid` (`:116`) — the cross-account guard. If there is no snapshot, it returns `null` → sign-in screen.

`cacheAuthUser` (`userService.ts:879-888`) is what populates that snapshot. The comment at `:870-872` records that before it existed, the key was only ever written under `USE_MOCK_DATA`, so **the fallback was dead code in production** — every dead-zone cold start bounced a real signed-in user to SignIn.

**Signing up while offline.** The Google chooser will fail; `SignInScreen.tsx:63-70` classifies `code === 'unavailable'` and messages containing `'network'`/`'offline'` as *transient* and deliberately does not log them to the error panel (`:71-77`), but does show `he.ts:1270` `signInNetworkError: 'אין חיבור לאינטרנט'` ["no internet connection"] via `friendlySignInError` (`SignInScreen.tsx:165-169`).

**Sign-out while offline.** `removeDeviceTokenBeforeAuthTeardown` (`userStore.ts:84-96`) races the token-removal write against a 4-second cap (`userStore.ts:77`). The long comment at `userStore.ts:57-77` explains the stakes: the write is self-only, so it must land before auth is revoked; the previous 1500 ms cap let slow-but-online writes lose the race, leaving the token on the old account and **leaking the previous user's pushes — including lockscreen DM previews — to the next user on the phone**.

#### 5.3 The user cancels a Google sign-in

`auth.ts:98-100`: `if (!isSuccessResponse(result)) throw new Error('Sign-in cancelled')`.

`SignInScreen.tsx:53-54` detects cancellation three ways: the message contains `'cancel'`, the code contains `'cancel'`, or the code is Google's `'12501'`. Then:
- **No error log** (`SignInScreen.tsx:71-77`).
- `logEvent(AnalyticsEvent.SignInCancelled, { method: 'google' })` (`:79`).
- **No dialog** — `SignInScreen.tsx:85-89`: "Don't pop an error dialog when the USER cancelled the Google chooser… cancelling isn't a failure."
- The spinner clears in `finally` (`:90-92`) and the user is back on the sign-in screen with nothing said.

`he.signInCancelled: 'ההתחברות בוטלה'` exists at `he.ts:1262` and is returned by `friendlySignInError` (`SignInScreen.tsx:162`) — but the dialog is suppressed for exactly the cancelled case, so **this string is effectively unreachable on the Google path**.

**Apple cancellation**: `auth.ts:360-366` maps `ERR_REQUEST_CANCELED` / `ERR_CANCELED` to the same `'Sign-in cancelled'`; `SignInScreen.tsx:106-107` detects it; same silent handling (`:126-135`).

**Guest failure**: no cancellation concept; any error shows `he.signInFailed` (`SignInScreen.tsx:151`).

#### 5.4 The name is rejected

Covered in §3.5. In summary: on `PostSignInOnboardingScreen` — the screen every new user sees — a rejected name produces `'שגיאה'` / `'ההתחברות נכשלה. נסה שוב.'` (`PostSignInOnboardingScreen.tsx:127`), which does not describe the problem. The specific messages exist (`he.ts:640-643`) and are wired only on the legacy `ProfileSetupScreen` (`ProfileSetupScreen.tsx:44-51`). If the client check is somehow bypassed, `firestore.rules:273-274` denies the write and the user gets a raw permission error through the same generic path.

#### 5.5 Email-path failures

`handleAuthError` — `EmailAuthScreen.tsx:89-135`:

| Firebase code | Shown | he.ts |
|---|---|---|
| `auth/invalid-email` | `'כתובת מייל לא תקינה'` | `:1827` |
| `auth/weak-password` | `'הסיסמה חייבת להכיל לפחות 6 תווים'` | `:1828` |
| `auth/wrong-password`, `auth/user-not-found`, `auth/invalid-credential` | `'מייל או סיסמה שגויים'` | `:1829` |
| `auth/too-many-requests` | `'יותר מדי ניסיונות. נסה שוב בעוד כמה דקות.'` | `:1830` |
| `auth/network-request-failed` | `'אין חיבור לאינטרנט'` | `:1270` |
| anything else | `'משהו השתבש, נסה שוב'` + `logError` | `:1831`, `EmailAuthScreen.tsx:131` |

`auth/email-already-in-use` gets a two-button dialog (`EmailAuthScreen.tsx:109-118`): body `he.ts:1832-1833` `emailAuthAlreadyInUse: 'המייל הזה כבר רשום. אם נרשמת עם מייל וסיסמה — עבור להתחברות. אם נרשמת עם Google/Apple — חזור והשתמש בכפתור המתאים.'`, buttons `'בטל'` (`he.ts:52`) and `'עבור להתחברות'` (`he.ts:1834`).

There is a *better* message that usually cannot fire. `signUpWithEmail` (`auth.ts:176-196`) tries `fetchSignInMethodsForEmail` to detect a social-provider collision and throw `EmailRegisteredWithProviderError`, which maps to `he.ts:1835` `'הכתובת הזו כבר רשומה דרך Google. התחבר עם Google.'` or `he.ts:1836` (Apple). But the comment at `EmailAuthScreen.tsx:110-113` states plainly: **"Email-enumeration protection makes the provider undetectable (`fetchSignInMethodsForEmail` returns `[]`)"** — so in practice the generic `emailAuthAlreadyInUse` is what users get.

Password reset (`EmailAuthScreen.tsx:137-166`) deliberately reports success for `user-not-found` so account existence is not leaked (`:161-163`): `he.ts:1837` `emailAuthResetSentTitle: 'נשלח מייל איפוס'` + `he.ts:1838-1839` `emailAuthResetSentBody: (email) => \`שלחנו קישור לאיפוס סיסמה אל ${email}. בדוק את תיבת הדואר (וגם ספאם).\``. Tapping reset with an invalid address: `he.ts:1840` `emailAuthResetNeedEmail: 'הקלד קודם את כתובת המייל שלך'`.

Client-side gates before submit: `EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/` (`EmailAuthScreen.tsx:37`), password ≥ 6 (`:54`), confirm must match on sign-up (`:57-60`), mismatch shown inline as `he.ts:1821` `'הסיסמאות לא תואמות'` (`:258-260`).

#### 5.6 Photo upload failure during onboarding

`PostSignInOnboardingScreen.tsx:63-96`. On `res.reason === 'cancelled' | 'permission'` the screen **says nothing at all** (`:73-77`) — the comment cites App Store guideline 5.1.1(iv): do not nag or point to Settings. `'network'` → `he.ts:2816` `profilePhotoUploadFailed: 'העלאת התמונה נכשלה. נסה שוב.'`; `'unavailable'` → `he.ts:2818-2819` `profilePhotoUnavailable: 'בחירת תמונה לא זמינה כרגע. בחר אווטאר מוכן בינתיים.'`. `he.ts:2814-2815` `profilePhotoPermissionDenied: 'אין הרשאה לגישה לגלריה. אפשר לאשר בהגדרות הטלפון.'` exists but is **not used on this screen**.

#### 5.7 Boot hydration failure

`hydrate` (`userStore.ts:103-123`) wraps each of its two reads so neither can leave `hydrated: false` forever — the comment at `:104-108` notes `RootNavigator` gates the splash on that flag and "silent rejections meant a perma-splash that was unrecoverable without a force-close." Failures log `BootHydrateFailed` `boot_hydrate_failed` (`analyticsService.ts:328`) with `source: 'storage'` or `source: 'user_read'` (`userStore.ts:113`, `:117`).

---

### 6. The `onboardingCompleted` flag

#### 6.1 There are two separate onboarding flags

They are frequently confused. Both are read by `RootNavigator`.

| | `onboardingDone` | `onboardingCompleted` |
|---|---|---|
| Where it lives | AsyncStorage, key `'footy.onboarding.done'` (`/Users/matan/Projects/soccer/src/services/storage.ts:7`) | Firestore field on `/users/{uid}` |
| Scope | **per device install** | per account |
| Read by | `userStore.ts:110`, `RootNavigator.tsx:35` | `userStore.ts:248-251`, `RootNavigator.tsx:38` |
| Set by | `userStore.completeOnboarding` → `storage.setOnboardingDone(true)` (`userStore.ts:125-128`, `storage.ts:88-90`) | `userService.completeOnboarding` (`userService.ts:394`) |
| Gates | the pre-sign-in slides (`RootNavigator.tsx:253`) | the post-sign-in profile screen (`RootNavigator.tsx:267-269`) |
| Survives reinstall? | **No** | Yes |
| Survives account switch on one device? | Yes (device-scoped) | No |

#### 6.2 Who sets `onboardingCompleted`

**Written `false` on every create** — via the converter at `firestore.ts:191` (`u.onboardingCompleted ?? false`), from the `fresh` objects at `userService.ts:187`, `:238`, `:283`, `:326`, `:146`.

**Set `true` in exactly one place**: `userService.completeOnboarding` (`userService.ts:355-419`). The update at `userService.ts:392-396` is:
```
{ name: trimmedName, onboardingCompleted: true, updatedAt }
```
plus `avatarId` if given (`:397`) and `photoUrl` if given (`:398`). Called only from `userStore.completePostSignInOnboarding` (`userStore.ts:253-258`), which is called only from `PostSignInOnboardingScreen.handleSave` (`PostSignInOnboardingScreen.tsx:116-120`).

So: **name and `onboardingCompleted` are set in the same single write.** There is no partial state where a user has a name but has not "completed onboarding" — except for legacy accounts that pre-date the field.

**Read back** with a strict equality check: `onboardingCompleted: d.onboardingCompleted === true` (`firestore.ts:278`) and `u.onboardingCompleted === true` (`userStore.ts:250`). Missing or null reads as `false`.

Because `updateDoc` bypasses Firestore converters, this write sends exactly those four keys — it does not re-serialise the whole user object.

#### 6.3 What is gated on it

1. **`PostSignInOnboardingScreen`** — `RootNavigator.tsx:267-269`:
   ```
   if (!isGuest && currentUser && !hasCompletedOnboarding) return <PostSignInOnboardingScreen />;
   ```
   This is a **full-screen block with no back button, no skip and no dismiss**. There is no route out of it except saving a valid name. Guests bypass it entirely via the `isGuest` term (`RootNavigator.tsx:260`, and `buildGuestUser` hard-codes `onboardingCompleted: true` at `userService.ts:50`).

2. **`ProfileSetupScreen`** — `RootNavigator.tsx:271`, reached only when onboarding *is* complete but the name is empty. Effectively legacy-only (see §3.5).

3. **The pending-invite / deep-link consumer** — `RootNavigator.tsx:65`:
   ```
   if (!currentUser || !profileComplete || !hasCompletedOnboarding) return;
   ```
   **A user who arrived from an invite link to a specific game does not reach that game until they have finished onboarding.** The stash survives (`RootNavigator.tsx:68`), the navigation is simply deferred until all three conditions hold, then pre-flighted for existence (`:95-115`) and navigated (`:146-157`). If the target no longer exists the user gets a toast: `'הקישור לא תקין או שהפריט כבר לא קיים'` (`RootNavigator.tsx:124`) plus an `InviteLinkDead` `invite_link_dead` event (`:120-123`, `analyticsService.ts:329`).

`isProfileComplete` (`userStore.ts:243-246`) is the independent second condition: `!!u && u.name.trim().length > 0`.

**Grandfathering** is deliberate. `RootNavigator.tsx:262-266`: "Existing accounts that never had this field stay grandfathered as long as the converter writes `false` rather than promoting them — they'll see it once."

---

### 7. Order and timing — a complete trace of one Google signup on a fresh install

**T-∞ — process start, before any UI.** `/Users/matan/Projects/soccer/App.tsx:17` `void joryio.init()` fires at module scope, before `ExpoSplash.preventAutoHideAsync()` at `:19`. `initJoryio` (`joryio.ts:103-118`) starts the SDK with the platform key (`joryio.ts:39-55`, literals present as fallbacks because an env-only key resolved to `''` in a store build and shipped analytics silently off — `joryio.ts:31-37`).

**T0 — boot.** `RootNavigator` mounts; `hydrateUser()` + `initRemoteConfig()` + `adsService.initializeAds()` (`RootNavigator.tsx:170-181`). `hydrate` reads `onboardingDone` and calls `getCurrentUser` in parallel (`userStore.ts:109-121`). `getCurrentUser` → `waitForAuthRestore()` (`userService.ts:86`) registers the `onAuthStateChanged` listener (`auth.ts:458`); first emission is `null`, promise resolves, **listener stays alive** (`auth.ts:456-474`). Returns `null`.

**T0+ — deep-link / attribution resolution, in parallel.** `App.tsx:537-577`, strictly ordered: `Linking.getInitialURL()` (`:539`) → if a pending invite already exists, stop (`:545-547`) → Android Play Install Referrer `consumeInstallReferrerIfFresh()` (`:553`) → iOS clipboard deferred deep link `consumeClipboardInviteIfFresh()` (`:569`). Whatever lands is stashed under `PENDING_INVITE` in AsyncStorage, shape at `storage.ts:75-81`.

**T1 — pre-sign-in slides.** `RootNavigator.tsx:253` renders `OnboardingScreen` while `onboardingDone` is false. (Not this surface.)

**T2 — `SignInScreen`.** `RootNavigator.tsx:255`.

**T3 — user taps `'המשך עם Google'`.** `logEvent(SignInAttempted, { method:'google' })` (`SignInScreen.tsx:45`) → `setBusyProvider('google')` → spinner replaces the button content (`:199-206`).

**T4 — native picker.** `ensureGoogleConfigured()` (`auth.ts:90`, config `:59-68`); Android-only `hasPlayServices` (`auth.ts:93-95`); `GoogleSignin.signIn()` (`auth.ts:97`).

**T5 — Firebase credential exchange.** `signInWithCredential` (`auth.ts:110`) → `mirrorToNativeAuth` fire-and-forget (`auth.ts:112`).

**T5a — in parallel, the surviving listener fires.** `ensureNativeAuthMirror()` (`auth.ts:462`) then `joryio.identify(uid, { email, name })` (`auth.ts:468-471`), then `unsub()` (`auth.ts:473`).

**T6 — one read.** `getDoc(docs.user(uid))` (`userService.ts:175`). Does not exist.

**T7 — one write.** `setDoc(ref, converter(fresh))` (`userService.ts:194`). **This is the moment `onNewUserJoined` starts.**

**T8 — attribution, awaited.** `applyInviteAttributionIfFresh` (`userService.ts:208`): AsyncStorage read + Firestore read + possible write. Then `applyAcquisitionIfFresh` (`:209`): AsyncStorage read + Firestore read + possible write. Then `cacheAuthUser` (`:210`).

**T9 — store update.** `set({ currentUser: user })` (`userStore.ts:132`), `logEvent(SignInSuccess)` (`:133`).

**T10 — the user sees the next screen.** `RootNavigator` re-renders. `hasCompletedOnboarding` is `false` → `PostSignInOnboardingScreen` (`RootNavigator.tsx:267-269`).

**T10a — same tick, background effects.**
- `subscribeCurrentUser(uid)` attaches a live `onSnapshot` on `/users/{uid}` (`RootNavigator.tsx:226-229`, `userStore.ts:207-224`).
- `hydrateGroup` / `setGameCurrentUserId` / `hydratePlayers` / `subscribeGroups` (`RootNavigator.tsx:201-218`).
- **`requestAndRegisterPushToken`** (`RootNavigator.tsx:241-247`) → the **OS push-permission dialog appears on top of the onboarding screen**.

**T10b — server side, 3 to 14 seconds.** `onNewUserJoined` sleeps 3s, reads; 5s, reads; 6s, reads (`index.ts:12845-12857`); builds the `via` suffix; pushes `'מישהו נרשם לאפליקציה! 🎉 (…)'` to the founder's Pulse devices (`index.ts:12890-12895`).

**T11 — the user types a name and taps `'המשך'`** (`he.ts:2840` `psoProfileSave: 'המשך'`). `complete({ name, avatarId, photoUrl })` (`PostSignInOnboardingScreen.tsx:116-120`) → `completeOnboarding` → sanitize (`userService.ts:363`) → reserved check (`:368`) → email-shape check (`:373`) → one `updateDoc` (`:400`) → `cacheAuthUser` (`:417`) → `ProfileCreated` + `OnboardingCompleted` events (`userStore.ts:256-257`).

**T12 — the app opens.** `RootNavigator.tsx:274` waits on `groupHydrated`, then `MainTabs` (`:279`). No dedicated "you have no club" screen exists — the comment at `RootNavigator.tsx:275-278` says both that state and "pending request" fall through to `MainTabs` and surface inline.

**T13 — deferred deep link, once.** `consumedRef` fires the pending-invite consumer exactly once per launch (`RootNavigator.tsx:62-66`).

**Minimum required interactions from a cold Google install to `MainTabs`**: tap `'המשך עם Google'` → pick an account in the OS sheet → answer the OS push dialog → type a name → tap `'המשך'`. Five, of which two are OS dialogs and one is free-text entry. Everything else on `PostSignInOnboardingScreen` — photo upload, the 24-avatar grid — is optional.

---

### 8. Branch matrix — what differs by state

| Branch | Where decided | Behaviour |
|---|---|---|
| **Android vs iOS — provider set** | `SignInScreen.tsx:212` | Apple button renders on iOS only. Android users have Google / email / guest. |
| **Android vs iOS — Apple availability** | `auth.ts:310-317`, `auth.ts:338-340` | `isAppleSignInAvailable` returns false off iOS; `signInWithApple` throws `'Apple Sign-In is only available on iOS.'`. **`isAppleSignInAvailable` is not called by `SignInScreen`** — the button is shown on all iOS versions rather than gated on iOS 13+. |
| **Android vs iOS — Play Services** | `auth.ts:93-95` | `hasPlayServices({ showPlayServicesUpdateDialog: true })` on Android only. |
| **Android vs iOS — install attribution** | `App.tsx:549-576` | Android: Play Install Referrer. iOS: clipboard deferred deep link (Apple has no referrer API). |
| **Android vs iOS — native auth mirror** | `auth.ts:225`, `auth.ts:283` | Android only; feeds the home widget and Wear relay. |
| **Android vs iOS — Google sign-out on signOut** | `auth.ts:418` | `GoogleSignin.signOut()` runs on Android only, so the next iOS sign-in may silently re-use the cached account. |
| **Guest vs registered** | `RootNavigator.tsx:260` | Guest: no `/users` doc, no push prompt (`:240`), no onboarding screen (`:267`), no profile gate (`:271`) — straight to `MainTabs`. |
| **Has name from provider vs not** | `userService.ts:183` / `:234` / `:322` | Google pre-fills the name field (`PostSignInOnboardingScreen.tsx:40` seeds from `user?.name`); Apple pre-fills on first authorization only; **email sign-up always starts empty** (`:322` hard-codes `''`). |
| **First Apple authorization vs later** | `auth.ts:326-329`, `userService.ts:230-233` | Apple returns `fullName` only once, ever. A user who deletes the account and signs in again with Apple gets no name. |
| **New account vs existing doc** | `userService.ts:176` / `:223` / `:272` / `:315` | If the doc already exists, the existing one is returned and **no attribution or acquisition is applied** — correct for a returning user, and the reason re-installs do not re-attribute. |
| **Email sign-up vs email sign-in** | `userService.ts:339-340` vs `:296` | Sign-up runs both attribution helpers; sign-in does not. |
| **Has pending invite vs organic** | `userService.ts:914`, `:954` | Organic signups skip both writes entirely, and `onNewUserJoined` waits the full 14s for nothing (`index.ts:12845-12857`). |
| **Has club vs no club** | `RootNavigator.tsx:187`, `organiserSignals.ts:60` | No club → no app-open ad; no organiser attributes; no milestone events. |
| **Online vs offline cold start** | `userService.ts:104-122` | 8s race; falls back to the AsyncStorage snapshot, else SignIn. |
| **Legacy account (no `onboardingCompleted`)** | `firestore.ts:278`, `RootNavigator.tsx:262-266` | Reads as `false`; sees `PostSignInOnboardingScreen` exactly once. |
| **Account with an empty name but `onboardingCompleted: true`** | `RootNavigator.tsx:271` | Only path to `ProfileSetupScreen`, the one screen with correct name-rejection copy. |
| **Mock mode (`USE_MOCK_DATA`)** | `userService.ts:62`, `:168`, `:215`, `:264`, `:307` | Every path returns `mockCurrentUser` and writes AsyncStorage only. Attribution, presence, analytics delivery (`analyticsService.ts:579`) and Joryio (`joryio.ts:104`, `:124`, `:134`) are all no-ops. **Mock QA cannot exercise any of this surface.** |

**Branches I did not check:** web (`Platform.OS === 'web'`) — `auth.ts:83-87` throws for any platform other than android/ios and `auth.ts:9` notes web Google sign-in is "not yet wired"; I did not verify whether the app is ever built for web. I also did not check Expo Go behaviour beyond noting the explicit bail-outs at `notificationsService.ts:641-652`.

---

### 9. Facts a consultant will ask about that are worth stating plainly

1. **No terms-of-service or privacy-policy link exists on the sign-in screen.** `he.ts:1799` `'באמצעות התחברות אתה מסכים לתנאי השימוש'` is rendered as inert text at `SignInScreen.tsx:272`.
2. **No pre-permission priming for push.** The OS dialog is the first and only thing said about notifications, and it lands mid-onboarding (`RootNavigator.tsx:235-248`).
3. **`marketingPush` defaults to `true`** (`types/index.ts:423`) and is never surfaced during signup.
4. **The Google profile photo is discarded** — `photoUrl` is absent from the converter's write path (`firestore.ts:183-264`, note at `:274`).
5. **Every new user is a random emoji until they act** (`userService.ts:185` + `avatars.ts:70-72`).
6. **Every signed-in user can read every user document** (`firestore.rules:260`).
7. **The founder gets a push for every signup; the user gets nothing** (`index.ts:12890-12895`; no welcome anything anywhere in `functions/src`).
8. **`createdAt` is the device clock** (`userService.ts:185`, `firestore.ts:189`), and `daysSinceJoin` segmentation is computed from it (`adminUserPush.ts:126`). A phone with a wrong clock lands in the wrong segments.
9. **`hasPush` segmentation is broken for all new users** — it reads a root field the converter no longer writes (`adminUserPush.ts:341` vs `firestore.ts:244-249`; same at `campaignService.ts:131`).
10. **Joryio is never reset on sign-out** (`joryio.ts:186-189` has no caller), so shared devices cross-contaminate the marketing profile.
11. **The "are you an organiser or a player?" question is not in the app.** It is a Joryio in-app HTML campaign (`onboardingService.ts:1-12`, `roleService.ts:3-6`), so whether a new user is asked at all is decided outside this repo.
12. **The name-rejection copy on the screen everyone sees is wrong** (`PostSignInOnboardingScreen.tsx:127`), and the correct copy exists two files away (`ProfileSetupScreen.tsx:44-51`, `he.ts:640-643`).

### Open questions from this section

Things this reader could not settle from the code, listed rather than assumed.

- Does the Joryio in-app onboarding wizard actually fire for new users in production, and on which trigger? The renderer (InAppMessageHost.tsx:157) and the handler (onboardingService.ts:72-118) are in the binary, but the campaign, its segment and its HTML live in the Joryio console. Everything about when a new user meets that wizard — or whether they ever do — has to be read there, not here.
- Is the Google Play pre-launch report still enabled? officialAccount.ts:80-85 and firestore.rules:179-181 both state plainly that the name checks stop the robot completing a profile but do NOT stop it running — only unticking the pre-launch report in Play Console does. Needs a Play Console check, plus a count of accounts created after 19.09.2026 carrying an '@'.
- What does the Google account chooser actually look like on a device with zero Google accounts signed in, and what error code comes back? SignInScreen.tsx:63-70 classifies a long list of codes as transient, but I could not confirm which code that specific state produces or whether the user gets a usable message.
- Exact wall-clock cost of the awaited attribution block (userService.ts:208-209) on a real cellular connection. It is two Firestore reads plus up to two writes between the Google sheet closing and the next screen appearing; the code cannot tell me whether that is 300ms or 3s in the field.
- Whether the OS push-permission dialog on iOS lands before or after PostSignInOnboardingScreen has painted. The effect order in RootNavigator.tsx:235-248 says 'same tick as the render', but the actual visual sequence — and whether the user sees the dialog over a blank screen or over the hero — needs a device recording.
- Whether Apple's private-relay addresses appear in `email` for Apple signups in production, and what share of Apple accounts therefore have a relay address on the /users doc (userService.ts:235).
- Whether `emailVerified` is enforced anywhere downstream. auth.ts:171 sends the verification mail and auth.ts:133-135 says usage is not blocked on it; I found no read of the flag in src/, but I did not audit functions/src for one.
- Whether any real user has ever completed the email sign-up path. It is the only path that hard-codes name: '' (userService.ts:322), so it is also the one with the emptiest first impression — a usage split by provider from Firebase Auth would settle whether this matters.
- The real-world impact of the hasPush segmentation gap (adminUserPush.ts:341 reading a field firestore.ts:244-249 no longer writes): how many queued campaigns have used a hasPush rule, and how many users they wrongly excluded. Needs a query over /campaigns in production.
- Whether `latestVersion` / soft-update gating interacts with first launch for a brand-new install. Out of my reading scope here, but it is another thing that can draw a modal over the onboarding screen.

---


## 5.4 · From a fresh account to a registered game

## Surface: from a fresh account to registered for a game

Everything below is read from source at `/Users/matan/Projects/soccer`. Every Hebrew string is quoted verbatim with its `src/i18n/he.ts` key and line. Nothing was observed on a device — see Open Questions.

---

### 0. Where a brand-new signed-in user lands

`RootNavigator` is the decider, in this order (`src/navigation/RootNavigator.tsx:251-279`):

1. `if (!userHydrated) return <Splash />` — :251
2. `if (!onboardingDone) return <OnboardingScreen />` — :253
3. `if (!currentUser) return <AuthStack initialRoute="SignIn" />` — :255
4. `const isGuest = currentUser.isGuest === true` — :260
5. `if (!isGuest && currentUser && !hasCompletedOnboarding) return <PostSignInOnboardingScreen />` — :267
6. `if (!isGuest && !profileComplete) return <AuthStack initialRoute="ProfileSetup" />` — :271
7. `if (!groupHydrated) return <Splash />` — :274
8. `return <MainTabs />` — :279

Explicit comment, `src/navigation/RootNavigator.tsx:275-278`: *"No more dedicated full-screen views for 'pending request' or 'new user without community'. Both states fall through to MainTabs and surface their context inline (toasts on submit + a 'pending' tag in the communities feed)."*

**The landing tab is the Profile tab, which is "home".** `initialRouteName="ProfileTab"` at `src/navigation/MainTabs.tsx:110`; `ProfileTab` renders `ProfileStack` whose configured root is `Profile` (`src/navigation/MainTabs.tsx:190`), i.e. `src/screens/tabs/ProfileScreen.tsx`.

Tab registration order (`src/navigation/MainTabs.tsx:140-186`): `ProfileTab`, `CommunitiesTab`, `GameTab`, `ChatTab`. Index 0 is visual RIGHT under forceRTL, so right→left the bar reads **בית · מועדונים · מחזורים · צ'אטים**.

| key | value | line |
|---|---|---|
| `tabHome` | `'בית'` | `src/i18n/he.ts:2887` |
| `tabCommunities` | `'מועדונים'` | `src/i18n/he.ts:1273` |
| `tabGame` | `'מחזורים'` | `src/i18n/he.ts:2885` |
| `tabChat` | `"צ'אטים"` | `src/i18n/he.ts:4049` |

> ⚠️ The file's own header comment (`src/navigation/MainTabs.tsx:27-30`) describes a **different, 3-tab** layout — *"right: Communities → center: Games (primary) → left: Profile"* — which contradicts the code below it. The comment is stale; the code is the truth.

**Branch not checked:** the guest (anonymous) session bypasses steps 5 and 6 entirely (`src/navigation/RootNavigator.tsx:257-271`), and `ProfileScreen` renders a completely different screen for a guest (see §1.9). I did not verify how a guest is created (which button starts an anonymous session) — that is the auth/onboarding surface.

---

### 1. The home screen for a user with NO club and NO games

File: `src/screens/tabs/ProfileScreen.tsx`. This is the single most important screen in the report, so every block is listed in render order with its render condition.

#### 1.1 What data the screen fetches on focus, and what it returns for an empty account

All of these are `useFocusEffect` hooks that **short-circuit to empty when there is no club** — this is what makes the empty home empty:

| state | fetch | empty-account result | line |
|---|---|---|---|
| `nextGame`, `myGames`, `createdGames` | `gameService.getMyLiveOrUpcomingGames(uid)` | `null` / `[]` | `:294-336` |
| `justPlayed` | `gameService.getJustFinishedGame(uid)` | `null` | `:337-344` |
| `openToJoin` | `gameService.getCommunityGames(uid, myCommunities.map(...))` — **guarded by `myCommunities.length === 0` → `setOpenToJoin([])`** | `[]` | `:344-372` |
| `scheduledUpcoming` | `gameService.getMyUpcomingScheduledGames(...)` — **same club guard** | `[]` | `:376-399` |
| `inboxCount` | `getInboxCount(uid)` | `0` | `:402-422` |
| `availData` | `availabilityFeedService.getAvailabilityCounts()` | see §1.6 | `:436-453` |
| `playedThisWeek`, `lastPlayedMs` | `gameService.getPlayedGames(uid, 20)` | `0`, `null` | `:456-486` |
| `playedCount` | `gameService.getPlayedGamesCount(uid)` | `0` | `:489-512` |
| `clubInsight` | `assistantInsightsService.getClubInsight(...)` — guarded by `!groupId` | `null` | `:519-542` |
| `referralCount`, `referrals` | `userService.listInvitedUsers(uid)` | `0`, `[]` | `:260-291` |

Hero selection is a pure helper: `const heroPick = pickHomeHero<Game>([], openToJoin, scheduledUpcoming)` (`src/screens/tabs/ProfileScreen.tsx:167`). With no club both arrays are empty, so `pickHomeHero` returns `{ kind: 'none', game: null }` (`src/utils/homeHero.ts:34-39`).

#### 1.2 ① Top bar — always rendered

`<HomeTopBar />` at `src/screens/tabs/ProfileScreen.tsx:1152-1168`. Component: `src/components/home/HomeDashboardParts.tsx:27-67`.

- Visual RIGHT: the user's avatar + a `chevron-down` (`:43-46`), tap → `nav.navigate('ProfileEdit')` (`ProfileScreen.tsx:1167`).
- Visual LEFT: `menu` icon → opens the hamburger (`:50-52`), and `notifications-outline` with a red dot when `inboxCount > 0` (`:53-56`), tap → `nav.navigate('Requests')` (`ProfileScreen.tsx:1157-1164`).
- Absolutely-centred logo (`src/assets/images/logo.png`, `:23`) + text.
  - `homeBrandName: 'Teamder'` — `src/i18n/he.ts:2019`

For a brand-new user the bell dot is **off** (`inboxCount` is 0).

#### 1.3 ② "הודעה מהמאמן" — the assistant card. THIS IS THE ONLY WELCOME COPY.

`<AssistantCard message={assistantMessage} greeting={coachGreeting} onCta={handleAssistantCta} />` — `src/screens/tabs/ProfileScreen.tsx:1173-1178`. Component `src/components/home/AssistantCard.tsx:27-68`.

Card header: `assistantTitle: 'הודעה מהמאמן'` — `src/i18n/he.ts:3099`.
Line rendered = `` `${he.assistantGreeting(greeting)} ${message.text}` `` (`AssistantCard.tsx:40-42`), where `assistantGreeting: (greeting) => \`${greeting},\`` — `src/i18n/he.ts:3101`.

Greeting word by device clock (`ProfileScreen.tsx:769-775`):
- `greetingMorning: 'בוקר טוב'` (05:00–11:59) — `src/i18n/he.ts:3073`
- `greetingNoon: 'צהריים טובים'` (12:00–16:59) — `:3074`
- `greetingEvening: 'ערב טוב'` (17:00–21:59) — `:3075`
- `greetingNight: 'לילה טוב'` (22:00–04:59) — `:3076`

`coachGreeting = firstName ? \`${greetWord} ${firstName}\` : greetWord` — `ProfileScreen.tsx:784`.

**Which rule fires for a brand-new user with no club.** The resolver picks the single lowest-priority-number message (`src/utils/assistant/resolve.ts:68-88`); ties break on registration order in `ASSISTANT_RULES` (`src/utils/assistant/rules.ts:769-779`). Priority bands: `src/utils/assistant/types.ts:34-51`.

For an account with 0 clubs, 0 games, no availability, no stats:
- `gameDayRule` → null (no `nextGame`) — `rules.ts:115`
- `postGameRule` → null (`lastPlayedMs == null`) — `rules.ts:174`
- `availabilityMatchRule` → null (no `bestEvening`) — `rules.ts:223-224`
- `comebackRule` → null — `rules.ts:247`
- `clubIdleRule` → null (`ctx.communities.length === 0`) — `rules.ts:273`
- `statsRule` → depends on whether the user picked a preferred position during profile setup. `statsCandidates` pushes a `position` candidate whenever `ctx.user?.position` is set (`rules.ts:632-638`). If it is, `statsRule` fires at `STATS: 5` and **outranks the welcome line**, and the coach's first ever sentence becomes `he.assistantPositionLine(POSITION_LABEL[position])` plus a `'לסטטיסטיקה'` CTA (`assistantStatsCta`, `src/i18n/he.ts:3268`) pointing at an empty stats screen. If `position` is unset, `statsCandidates` returns `[]` and `statsRule` returns null (`rules.ts:663-671`).
- `joinClubRule` → fires at `DISCOVERY: 6` — `rules.ts:704-717`.

`joinClubRule` output:
- `assistantJoinClub` (one drawn per screen mount, `rules.ts:710`) — `src/i18n/he.ts:3288-3291`:
  - `'יש כדורגל מסביבך 👀'`
  - `'ברוך הבא ל-Teamder! 👋'`
- sub: `assistantJoinClubSub: 'הגיע הזמן למצוא את החבר׳ה שלך ⚽'` — `src/i18n/he.ts:3292`
- CTA: `assistantJoinClubCta: 'גלה מועדונים'` — `src/i18n/he.ts:3293` → `{ kind: 'discoverClubs' }` → `nav.navigate('CommunitiesTab')` (`ProfileScreen.tsx:924-926`)

So the full first line is one of:
- `בוקר טוב <שם>, יש כדורגל מסביבך 👀`
- `בוקר טוב <שם>, ברוך הבא ל-Teamder! 👋`

The draw is random per mount: `newAssistantNonce()` is `Math.floor(Math.random() * 0xffffffff)` (`src/utils/assistant/resolve.ts:56-58`), minted once per mount (`ProfileScreen.tsx:622`). **The welcome greeting is a coin flip** — half of first-time users never see `'ברוך הבא ל-Teamder! 👋'` at all.

`markAvailabilityRule` (`rules.ts:722-737`) also sits at `DISCOVERY: 6` but is registered *after* `joinClubRule`, and it self-suppresses anyway because `ctx.shown.availabilityPrompt` is true for this user (`rules.ts:725`; the flag is computed at `ProfileScreen.tsx:875-876`).

If `message` is null the card renders nothing at all (`AssistantCard.tsx:38`).

#### 1.4 The "just played" card — not shown

`justPlayed ? ... : null` at `ProfileScreen.tsx:1185-1215`. Never fires for a new account. Strings (unreachable here, listed for completeness):
- `homeJustPlayedTitle: 'המחזור האחרון'` — `src/i18n/he.ts:718`
- `homeJustPlayedBody: 'המחזור הסתיים — הציון, הגולים והדירוג שלך מחכים בפנים.'` — `:719`
- `homeJustPlayedCta: 'לפרטי המחזור'` — `:722`

#### 1.5 ③ The hero slot — RENDERS NOTHING

`{nextGame ? <HomeNextGameCard .../> : heroGame ? <UpcomingScheduledGameCard .../> : null}` — `src/screens/tabs/ProfileScreen.tsx:1228-1259`.

For a new user both are null, so **the hero slot renders literally nothing**. The screen jumps from the coach's line straight to the three action tiles.

> ⚠️ **Dead empty state.** `HomeNextGameCard` contains a fully-built empty state (`src/components/home/HomeNextGameCard.tsx:42-61`) with `homeNoGameTitle: 'אין לך מחזור קרוב'` (`src/i18n/he.ts:2026`), `homeNoGameBody: 'מצא מחזור פתוח או פתח מחזור חדש'` (`:2027`) and a button `homeNoGameCta: 'מצא מחזור'` (`:2028`). It is **unreachable**: the only caller in the app is `ProfileScreen.tsx:1230`, and it is inside a `nextGame ? ...` guard, so `game` is never null when the component mounts (`grep -rn "HomeNextGameCard" src` returns only that one call site plus two unrelated comments). The "no upcoming game" copy that was written for this screen never renders.

#### 1.6 ④ Recommended-day banner — hidden for a new user

`{availCardEnabled && recommended ? <HomeRecommendedDay .../> : null}` — `ProfileScreen.tsx:1267-1294`.

`recommended` requires `availReady` = `!!availData && !availData.error && availData.hasLocation && availData.days.length > 0` (`ProfileScreen.tsx:803-807`), and then at least one evening with `count > 0` (`:816-818`). `availData` comes from the `availabilityCounts` callable (`src/services/availabilityFeedService.ts:100-110`); on any error it returns `{ radiusKm: 0, hasLocation: false, days: [], error: true }` (`:124`). A brand-new account has no saved home city, so `hasLocation` is expected false → banner hidden.

Strings (not shown for a new user): `homeRecommendedTitle: 'היום המומלץ לפתיחת מחזור'` (`src/i18n/he.ts:2046`), `homeRecommendedLine: (day, n) => \`יום ${day}׳ • ${n} פנויים\`` (`:2047`).

`availCardEnabled` is a Pulse/server master switch read on focus, defaulting `true` (`ProfileScreen.tsx:176-177`, `:425-434`).

#### 1.7 ⑤ Three action tiles — ALWAYS rendered, unconditional

`<HomeActionTiles onOpen onAvailability onJoin />` — `ProfileScreen.tsx:1297-1324`. Component: `src/components/home/HomeDashboardParts.tsx:127-143`. Rendered right-to-left in that array order.

| tile | label | he.ts | destination |
|---|---|---|---|
| 1 (right) | `homeActionOpenTitle: 'פתח מחזור'` | `:2049` | `nav.navigate('GameTab', { screen: 'GamesList', params: { openCreate: true } })` — `ProfileScreen.tsx:1303-1306` |
| 2 | `homeActionAvailTitle: 'סמן זמינות'` | `:2050` | `nav.navigate('AvailabilityEdit')` — `:1313` |
| 3 (left) | `homeActionJoinTitle: 'הצטרף למחזור'` | `:2051` | `nav.navigate('GameTab')` — `:1321` |

There are no subtitles; the comment at `src/components/home/HomeDashboardParts.tsx:145-148` says they were removed because `"הצטרף למחזור"` was clipping in a ~110pt column.

#### 1.8 ⑥ Availability podium **or** the availability prompt card

`{availCardEnabled && podium.length > 0 ? <HomeAvailabilityWindows/> : !markedAvailability ? <AvailabilityPromptCard/> : null}` — `ProfileScreen.tsx:1326-1366`.

New user → `podium` empty (§1.6) and `markedAvailability` false (`ProfileScreen.tsx:798-799`), so the **prompt card renders**. Component `src/components/home/AvailabilityPromptCard.tsx:13-34`:

- `availFeedPromptTitle: 'רוצה לראות מי פנוי לשחק לידך?'` — `src/i18n/he.ts:2749`
- `availFeedPromptBody: 'הגדר את האזור והזמנים שנוח לך — ונראה לך כמה שחקנים פנויים בכל חלון, כדי לפתוח מחזור בקלות.'` — `:2750-2751`
- `availFeedPromptCta: 'הגדר זמינות'` — `:2752` → `nav.navigate('AvailabilityEdit')` (`ProfileScreen.tsx:1358-1362`)

Podium strings (not shown here): `homeWindowsTitle: 'פנויים לידך'` (`:2053`), `homeWindowsPlayersUnit: 'שחקנים'` (`:2054`), `homeWindowsShowWeek: 'הצג שבוע מלא'` (`:2055`), `homeDayLabel: (l) => \`יום ${l}׳\`` (`:2057`).

#### 1.9 ⑦ The activation checklist — "בוא נתחיל"

`{homeDataReady && !checklistComplete ? <OnboardingChecklist items={checklistItems} /> : null}` — `ProfileScreen.tsx:1370-1372`.

`homeDataReady = groupsHydrated && playedCount !== null && (localUser?.isGuest || referralCount !== null)` (`ProfileScreen.tsx:719-722`) — deliberately delays the card past first paint so it doesn't flash.

Card chrome (`src/components/home/OnboardingChecklist.tsx:74-77`), with a green done/total progress ring (`:62`):
- `homeChecklistTitle: 'בוא נתחיל'` rendered as `` `${he.homeChecklistTitle} ⚡` `` — `src/i18n/he.ts:1990`
- `homeChecklistSubtitle: 'כמה צעדים קטנים כדי להפיק את המקסימום'` — `:1991`

The five steps (`ProfileScreen.tsx:635-710`), in render order, all **undone** for a new user:

| # | label | he.ts | `done` condition | tap → |
|---|---|---|---|---|
| 1 | `homeStepPhoto: 'הוספת תמונת פרופיל'` | `:1992` | `!!user.photoUrl` | `ProfileEdit` (`:646`) |
| 2 | `homeStepAvailability: 'סמן מתי אתה פנוי'` | `:1993` | `preferredDays.length > 0` | `AvailabilityEdit` (`:660`) |
| 3 | `homeStepCommunity: 'הצטרף או פתח מועדון'` | `:1994` | `myCommunities.length > 0` | `CommunitiesTab` (`:673`) |
| 4 | `homeStepGame: 'הצטרף או צור מחזור ראשון'` | `:1995` | `totalGames > 0 \|\| myGames.length > 0` | `GameTab` (`:687`) |
| 5 | `homeStepInvite: 'הבא חבר למגרש'` | `:1996` | `(referralCount ?? 0) > 0` — i.e. someone actually signed up through the link, not merely that share was tapped (`:701-703`) | fires the share sheet (`:709`) |

A `done` row is rendered `disabled` (`src/components/home/OnboardingChecklist.tsx:85`) with a green `checkmark-circle`; an undone row shows an empty checkbox (`:106-110`).

Note the **ordering conflict**: the checklist is positioned *below* the hero and the action tiles by deliberate choice (comment at `ProfileScreen.tsx:1367-1369`: *"ALWAYS shown while incomplete … but positioned low"*). For a user with an empty hero slot (§1.5), the single most onboarding-relevant card on the screen sits fifth.

#### 1.10 ⑧ Rotating "ידעת ש..." tips — always rendered

`<DidYouKnowCard tips={homeTips} />` — `ProfileScreen.tsx:1376`. Component `src/components/home/DidYouKnowCard.tsx:19-60`; auto-advances every `ROTATE_MS = 6000` (`:17`, `:24-30`) with a dot indicator (`:48-58`).

Header: `homeDidYouKnowTitle: 'ידעת ש...'` — `src/i18n/he.ts:2004`.
The five tips (`ProfileScreen.tsx:723-729`):
1. `homeTipAutoTeams: 'אפשר ליצור כוחות מאוזנים אוטומטית לפי דירוג השחקנים'` — `:2005` → `CommunitiesTab`
2. `homeTipInternalRating: 'דירוג פנימי של שחקנים עוזר לאזן קבוצות הוגנות'` — `:2006` → `CommunitiesTab`
3. `homeTipAvailability: 'סמן מתי אתה פנוי — ומנהלים יזמינו אותך למחזורים'` — `:2007` → `AvailabilityEdit`
4. `homeTipScheduled: 'אפשר לתזמן מראש מתי נפתחת ההרשמה למחזור'` — `:2008` → `GameTab/GameCreate`
5. `homeTipCommunity: 'פתח מועדון כדי לנהל קבוצה קבועה עם דירוגים וכוחות'` — `:2009` → `CommunitiesTab`

All five describe **admin** features. None of them is actionable by a user who is not in a club.

#### 1.11 ⑨ Invite-friends CTA — always rendered, last block

`ProfileScreen.tsx:1379-1393`. `profileInviteFriendsCta: 'הזמן חברים לאפליקציה'` — `src/i18n/he.ts:3020`. Handler `handleShareInvite` (`ProfileScreen.tsx:948-971`) builds a short link via `createShortInviteUrl({ type: 'app', invitedBy: user.id, ... })` and shares:
- `profileInviteShareBody: (link) => \`אני משחק כדורגל בעזרת אפליקציית Teamder ⚽\\nתוריד גם אתה ובוא לשחק:\\n${link}\`` — `src/i18n/he.ts:3021-3022`

#### 1.12 The ☰ hamburger — the whole rest of the app

`<HamburgerMenu visible={menuOpen} sections={sections} />` — `ProfileScreen.tsx:1398-1401`; sections built at `ProfileScreen.tsx:975-1104`. Nothing here is on the home body. Sections and items:
- `profileMenuSectionProfile` — `profileSectionMyAchievements`, `statsMenuLabel`, `profileEdit`, `friendsTitle` (behind `rcBool('feature_friends')`, `:1013`), `referralsScreenTitle` (behind `rcBool('feature_referrals')`, `:1023`)
- `profileMenuSectionGames` — `profileSectionAvailability`, `profileSectionHistory`
- admin-only approvals section, only `if (isAdmin && pendingApprovals > 0)` (`:1050-1068`)
- `profileMenuSectionSystem` — notifications, blocked users
- `profileMenuSectionSupport` — report bug / suggest feature (behind `rcBool('feature_feedback')`), rate app
- `profileMenuSectionAccount` — sign out, delete account

#### 1.13 The GUEST branch of the same screen

`if (localUser?.isGuest) { ... }` returns a completely different screen and **none of the above renders** — `ProfileScreen.tsx:1109-1133`:
- `guestProfileTitle: 'הפרופיל שלך מחכה'` — `src/i18n/he.ts:1809`
- `guestProfileBody: 'אתה גולש כאורח. הירשם כדי לשמור מחזורים, להצטרף למועדונים ולבנות פרופיל שחקן.'` — `:1810-1811`
- Button `guestRegisterCta: 'הרשמה'` — `:1808` → **calls `signOut()`** (`ProfileScreen.tsx:1126`), which drops the guest back to the auth stack.

---

### 2. Every path onward from home, tap by tap

Six exits exist from the empty home screen. There are no others.

**A. Coach CTA → discover clubs.** Tap `'גלה מועדונים'` (`ProfileScreen.tsx:1177` → `handleAssistantCta` → `case 'discoverClubs': nav.navigate('CommunitiesTab')`, `:924-926`). **1 tap.**

**B. Tile "פתח מחזור" → create-game chooser.** `nav.navigate('GameTab', { screen: 'GamesList', params: { openCreate: true } })` (`ProfileScreen.tsx:1303-1306`). `GamesListScreen` consumes `openCreate` in an effect and calls `handleCreate()` (`src/screens/games/GamesListScreen.tsx:325-334`), which opens the chooser modal. **1 tap to the chooser.**

**C. Tile "סמן זמינות" → `AvailabilityEdit`** (`ProfileScreen.tsx:1313`). Also reachable from the availability prompt card (`:1358`) and checklist step 2 (`:660`).

**D. Tile "הצטרף למחזור" → `GameTab`** (`ProfileScreen.tsx:1321`), landing on `GamesList`.

**E. Checklist step 3 "הצטרף או פתח מועדון" → `CommunitiesTab`** (`ProfileScreen.tsx:673`).

**F. Bell → `Requests`** (`ProfileScreen.tsx:1164`). See §6 for why this is a dead end for a new user.

#### 2.1 Path: create a club

`CommunitiesTab` → `PublicGroupsFeedScreen`. Create is reachable three ways, all calling `handleCreate(source)` → `nav.navigate('CommunitiesCreate')` (`src/screens/communities/PublicGroupsFeedScreen.tsx:428-433`):
1. the floating `+` FAB, bottom-LEFT under RTL (`:866-884`), label `communitiesCreateGroup: 'צור מועדון חדש'` (`src/i18n/he.ts:1276`);
2. the `'המועדונים שלי'` empty-hint card's button (`:810-818`);
3. the whole-screen empty state's button (`:761-769`).
Buttons 2 and 3 read `communitiesCreateFirst: 'צור מועדון ראשון'` — `src/i18n/he.ts:1280`.

`CreateGroupScreen` (`src/screens/groups/CreateGroupScreen.tsx`) is a thin shell over `GroupWizardForm`, header `createGroupTitle: 'יצירת מועדון חדש'` (`src/i18n/he.ts:1296`), submit `createGroupSubmit: 'צור והיכנס'` (`:1401`).

**Two steps** (`src/screens/groups/GroupWizardForm.tsx:144`, indicator at `:263-267`):
- Step 1 `groupFormTabDetails: 'פרטים'` (`src/i18n/he.ts:542`)
  - section `groupSectionIdentity: 'פרטי המועדון'` (`:955`): `groupCreateName: 'שם המועדון'` (`:2866`, **required**, placeholder `'לדוגמה: חמישי כדורגל'` hardcoded at `GroupWizardForm.tsx:286`); `createGroupDescription: 'תיאור המועדון (לא חובה)'` (`:1304`); `communityDetailsRules: 'חוקי המועדון'` (`:1461`, placeholder hardcoded `'לדוגמה:\n- מגיעים בזמן\n- **אסור** לעשן במגרש'` at `GroupWizardForm.tsx:307`)
  - section `groupSectionLocation: 'מיקום ויצירת קשר'` (`:956`): `createGroupCity: 'עיר'` (`:1297`, **required**, placeholder `createGroupCityPlaceholder: 'התחל להקליד שם עיר'` `:1298`); `createGroupContactPhone: 'טלפון איש קשר'` (`:1390`, placeholder `'050-1234567'` `:1391`, hint `'יוצג כפתור "פתח ב־WhatsApp" במועדון'` `:1392`)
  - gate: `step1Valid` = name and city non-empty (`GroupWizardForm.tsx:212`); when blocked the disabled `'המשך'` is explained by `gameWizardMissingFields: (fields) => \`יש למלא: ${fields}\`` (`src/i18n/he.ts:857`, rendered `GroupWizardForm.tsx:432-436`)
- Step 2 `groupFormTabAdvanced: 'מתקדם'` (`src/i18n/he.ts:543`)
  - `groupSectionAccess: 'הצטרפות והרשאות'` (`:957`) with the single most consequential switch in the whole funnel: `createGroupIsOpen: 'מועדון פתוח'` (`:1307`), hint `createGroupIsOpenHint: 'כשמופעל — שחקנים חדשים מצטרפים אוטומטית. כבוי = דורש אישור מנהל.'` (`:1308`). Default is `false` — `EMPTY_GROUP_FORM_VALUES` feeds the create screen (`CreateGroupScreen.tsx:140`) and `submitJoinByPublic` reads `!!pub.isOpen` (`src/services/groupService.ts:2030`).
  - `groupSectionRating: 'דירוג וכרטיסים'` (`:958`) — internal rating, hide-rating, cards toggles.
- Footer buttons: `wizardStepBack: 'חזרה'` (`:1123`), `wizardStepNext: 'המשך'` (`:1124`).

On success it does `nav.replace('CommunityDetails', { groupId, celebrate: true })` (`CreateGroupScreen.tsx:92-95`).

**Tap count: `+` (1) → type name → type city → `המשך` (2) → `צור והיכנס` (3).** Three taps plus two text fields. Creating a club does **not** create a game and does **not** register the user for anything.

#### 2.2 Path: join a club

`PublicGroupsFeedScreen` (`src/screens/communities/PublicGroupsFeedScreen.tsx`). Layout per its own header comment (`:1-12`): hero, search+filter row, `המועדונים שלי`, `ממתינים לאישור`, `מועדונים פתוחים`, FAB.

Hero (`src/components/community/CommunitiesHero.tsx:63-66`): `communitiesTitle: 'מועדונים'` (`src/i18n/he.ts:1274`) + `communitiesHeroSubtitle: 'כל המועדונים במקום אחד'` (`:1408`).
Search placeholder: `communitiesCardSearchPlaceholder: 'חיפוש מועדון או עיר'` (`:1414`, used `:556`).
Controls row also carries a map button (`mapButtonLabel: 'תצוגת מפה'`, `:73`), a filter button (`gameFiltersButton: 'סינון'`, `:103`) and a `RequestsBell` (`:752`).

**Whole-screen empty state** when `totalKnown === 0 && !isSearching` (`:753-770`; `totalKnown = (items ?? []).length`, `:537`) — i.e. the public club directory is genuinely empty:
- `communitiesEmptyAll: 'אין עדיין מועדונים'` — `src/i18n/he.ts:1278`
- `communitiesEmptyAllSub: 'תהיה הראשון להקים מועדון כדורגל באזור שלך'` — `:1279`
- button `communitiesCreateFirst: 'צור מועדון ראשון'` — `:1280`
- the FAB is hidden in this state (`:870`)

**Normal state.** Section `communitiesSectionMember: 'המועדונים שלי'` (`:1405`) is **always rendered**, and for a new user shows an empty-hint card (`:795-820`):
- `communitiesEmptyMember: 'עדיין לא הצטרפת לאף מועדון'` — `:1416`
- `communitiesEmptyMemberSub: 'הצטרף למועדון מהרשימה למטה כדי לראות מחזורים, או פתח מועדון משלך.'` — `:1417-1418`

Section `communitiesSectionPending: 'ממתינים לאישור'` (`:1406`) renders only when `pendingItems.length > 0` (`:823`).

Section `communitiesSectionOpen: 'מועדונים פתוחים'` (`:1407`) is the discovery list. Empty → `communitiesEmptyOpenSection: 'אין מועדונים פתוחים נוספים'` (`:1419`). Windowed to `DISCOVERY_PAGE = 8` (`:74`) with `communitiesShowMore: (n) => \`הצג עוד מועדונים (${n})\`` (`:1422`, rendered `:844`).

**Search-mode**: no-match copy is `communitiesEmpty: 'לא מצאנו מועדון בשם זה. נסה לחפש לפי עיר או שם אחר.'` (`:1277`, rendered `:788`).

**The discovery query** is `groupService.listPublicGroups()` — an *unfiltered* `getDocs(col.groupsPublic())` with no `where` at all (`src/services/groupService.ts:634-647`). Filtering, windowing and sorting are all client-side:
- exclude clubs with an empty name (comment: partial `/groupsPublic` docs from hidden personal groups) — `PublicGroupsFeedScreen.tsx:304-308`
- exclude member / admin / pending — `:309-311`
- apply the user's filters (`passesDiscoveryFilters`) — `:312`
- sort: `gamesLast30` desc, then `gamesLast60` desc, then `memberCount` desc, then Hebrew name — `:329-335`. The long comment at `:317-328` explains this was changed away from member-count sorting because *"of 53 real clubs only 15 have ever opened a round, and the ones that never did are not the small ones — the biggest club in the app has 40 members and no fixture."*

**The card** is `src/components/community/ClubCard.tsx`, its state machine is the pure `resolveClubCard` (`src/utils/clubCard.ts:108-152`). CTA resolution (`src/utils/clubCard.ts:122-128`):

| relation | CTA value | label | he.ts |
|---|---|---|---|
| admin or member | `member` | `clubCardMember: 'חבר במועדון'` | `:3351` |
| pending | `requested` | `clubCardRequested: 'בקשה נשלחה'` | `:3354` |
| none + `isOpen` | `join` | `clubCardJoin: 'הצטרף'` | `:3352` |
| none + closed | `request` | `clubCardRequest: 'בקש להצטרף'` | `:3353` |

Only `join` and `request` are tappable (`ctxActs`, `ClubCard.tsx:95`, `:154`). Badges: `clubCardManager: 'מנהל'` (`:3355`), `clubCardRecommended: 'מתאים לך'` (`:3356`, = within 10 km **and** ≥10 members, `src/utils/clubCard.ts:64-65`, `:133-136`), and activity `clubCardVeryActive: 'פעיל מאוד'` / `clubCardActive: 'פעיל'` / `clubCardInactive: 'לא פעיל'` (`:3357-3359`) from `clubActivity` thresholds `VERY_ACTIVE_MIN = 4`, `ACTIVE_MIN = 2` over 30 days (`src/utils/clubCard.ts:83-98`). A club whose counters are null gets **no** badge (`:93`).
Member count line: `clubCardPlayers: (n) => \`${n} שחקנים\`` (`:3360`).

**Tapping the CTA** runs `handleRequest` (`PublicGroupsFeedScreen.tsx:345-424`):
- guest gate first: `ensureNotGuest(he.guestRegisterJoinCommunity, { type: 'team', id: item.id })` (`:347`) — `guestRegisterJoinCommunity: 'כדי להצטרף למועדון צריך חשבון. רוצה להירשם עכשיו?'` (`:1804`)
- `requestJoinById` → `submitJoinByPublic` (`src/services/groupService.ts:2024-2074`): reads `/groupsPublic/{id}`, branches on `isOpen`, enforces a capacity gate on `memberCount >= maxMembers` throwing `GROUP_FULL` (`:2033-2043`), then `writeJoin(groupId, userId, isOpen)` (`:2047`) and returns `status: isOpen ? 'joined' : 'pending'` (`:2072`)
- toasts (`PublicGroupsFeedScreen.tsx:376-423`):
  - pending → `toastJoinRequestSent: 'הבקשה נשלחה'` (`:228`)
  - joined → `toastJoinedGroup: 'ברוך הבא למועדון'` (`:229`)
  - already member → `groupAlreadyMember: 'אתה כבר במועדון הזה'` (`:2878`)
  - rejected → `toastJoinRejected: 'בקשתך למועדון זה נדחתה ולא ניתן לשלוח שוב.'` (`:242`)
  - `GROUP_FULL` → `toastGroupFull: 'המועדון מלא. לא ניתן לשלוח בקשה כרגע.'` (`:241`)
  - anything else → `toastRequestFailed: 'שליחת הבקשה נכשלה. נסה שוב.'` (`:237`)

**Tapping the card body** (not the CTA) for a non-member routes to `CommunityDetailsPublic` — the read-only preview, `src/screens/communities/CommunityDetailsPublicScreen.tsx`. It shows description + `communityDetailsAbout: 'תיאור המועדון'` (`:1452`), `communityDetailsCity: 'עיר'` (`:1454`), `communityDetailsField: 'מגרש'` (`:1453`), `communityDetailsPreferredDays: 'ימי מחזור'` (`:1455`), `communityDetailsPreferredHour: 'שעת מחזור'` (`:1456`), `communityDetailsMembers: 'שחקנים'` (`:1468`). Optional WhatsApp button `communityDetailsContactAdmin: 'צור קשר עם המנהל'` (`:1544`, shown only when `phoneValid`, `:341`). Primary button copy is `group.isOpen ? he.communityJoinAuto : he.communityRequestToJoin` (`:295`):
- `communityJoinAuto: 'הצטרף למועדון'` — `:1445`
- `communityRequestToJoin: 'בקש להצטרף'` — `:1446`
Once pending the button becomes `groupsActionPending: 'הבקשה נשלחה'` and is `disabled` (`:361-366`), with a secondary `communityCancelJoinRequest: 'בטל בקשת הצטרפות'` (`:1447`, rendered `:371`) whose success toast is `toastJoinRequestCancelled: 'בקשת ההצטרפות בוטלה'` (`:1448`).

**The public preview shows the club's upcoming games nowhere.** Nothing in `CommunityDetailsPublicScreen.tsx` renders a game list — a prospective member cannot see whether the club has a fixture this week before committing to a join request.

**Tap count (open club):** `CommunitiesTab` (1) → `הצטרף` on a card (2) = **2 taps, instant membership.**
**Tap count (closed club, the default):** same 2 taps, then an unbounded wait for an admin.

#### 2.3 Path: find an open game

`GameTab` → `GamesListScreen` (`src/screens/games/GamesListScreen.tsx`). Full breakdown in §3.

#### 2.4 Path: accept an invite

Two link shapes, both handled by the single consumer in `RootNavigator` (`src/navigation/RootNavigator.tsx:62-166`). Readiness gate: `if (!currentUser || !profileComplete || !hasCompletedOnboarding) return` (`:65`) — an invite therefore does **not** fire until the user has finished signup and post-signin onboarding, and `consumedRef` fires it at most once per launch (`:62`, `:66`).

- `pending.type === 'app'` — a generic app invite. It **clears the stash and does nothing else** (`:77-80`): *"Attribution already landed at signup … nothing to navigate to, so just clear the stash and leave the user on home."* A user who followed a friend's `profileInviteShareBody` link lands on the empty home screen with no acknowledgement.
- `pending.type === 'session'` → pre-flight `gameService.getGameById` (`:98`) → `navigateInvite(...)` → MatchDetails.
- `pending.type === 'team'` → pre-flight `groupService.getPublic` (`:100`) → CommunityDetails (member) or CommunityDetailsPublic (non-member), chosen by `cachedGroups.some(...)` (`:134-138`).
- Deleted target → `toast.error('הקישור לא תקין או שהפריט כבר לא קיים')` — **hardcoded Hebrew, not in he.ts**, `src/navigation/RootNavigator.tsx:124`.
- `ACCESS_BLOCKED` is treated as `exists = true` so the target screen can render its own blocked UI (`:107-110`).

The same stash is reused as the post-signup return target by the guest gate (`src/utils/guestGate.ts:39-63`): choosing `'הרשמה'` stashes the target and calls `signOut()` (`:51-58`).

---

### 3. The open-games feed: what a stranger sees

#### 3.1 The queries

`GamesListScreen.reload()` runs four in parallel (`src/screens/games/GamesListScreen.tsx:246-254`):

```
gameService.getMyLiveOrUpcomingGames(user.id)
gameService.getCommunityGames(user.id, myCommunityIds)
gameService.getOpenGames(user.id, myCommunityIds)
gameService.getMyUpcomingScheduledGames(user.id, myCommunityIds)
```

**`getOpenGames` is the only one that can return anything for a user with no club** (`src/services/gameService.ts:2517-2570`). The server-side query, verbatim (`:2547-2554`):

```js
query(
  col.games(),
  where('visibility', '==', 'public'),
  where('status',     '==', 'open'),
  where('startsAt',   '>',  now),
)
```

Then client-side (`:2561-2570`): re-check `status === 'open'`, `startsAt > now`, `!isStaleAfterStart(g)`, `!excludeCommunityIds.includes(g.groupId)`, and drop games where the user is already in `players` / `waitlist` / `pending`. Sorted `startsAt` ascending.

**So the answer to "what determines which games a stranger sees" is: `visibility === 'public'` AND `status === 'open'` AND `startsAt > now`, and nothing else.**

- **No city filter.** None.
- **No distance filter.** `EMPTY_GAME_FILTERS` has `nearby: false` (`src/utils/gameFilters.ts:25-33`); `DEFAULT_GAME_NEARBY_RADIUS_KM = 25` (`:23`) only applies once the user opts in through the filter sheet. Default feed shows a game in Eilat to a user in Haifa.
- **`acceptsFillers` plays no part in the feed.** `grep -rn "acceptsFillers" src` returns only the type (`src/types/index.ts:1549`, `:2028`), the create/edit wizard (`GameCreateScreen.tsx:134`, `:503-504`; `GameEditScreen.tsx:110`, `:340-341`; `GameWizardForm.tsx:195`, `:774`), the series scheduler (`src/utils/seriesSchedule.ts:201`, `:284`) and the admin review section (`src/components/match/FillerInterestsSection.tsx:10`). It is **not** in any feed query. Its only client-side consumer is the filler-candidate banner on MatchDetails (`src/screens/games/MatchDetailsScreen.tsx:810`) — i.e. it changes what you can do once you are *on* a game, not whether you can *see* it.
- `getCommunityGames` (`src/services/gameService.ts:2239-2313`) is `where('groupId','in',chunk) + where('status','==','open')`, chunked at 30, fail-soft per chunk, and drops games the user is already in (`:2304-2309`). `communityIds.length === 0 → return []` (`:2243`). Useless for a new user.
- `getMyUpcomingScheduledGames` (`:2328-2389`) is `where('groupId','in',chunk) + where('status','==','scheduled')`, same empty-club guard (`:2332`), sorted by `registrationOpensAt ?? startsAt` (`:2338`).

Render-layer visibility: `isVisibleInOpenGames(g)` = `isOpen(g) && (!hasStarted(g) || canJoinGame(g))` (`src/services/gameLifecycle.ts:310-315`) — a game stays in discovery for the 1h late-registration grace after kickoff.

#### 3.2 What the screen renders

Hero `MatchesHero` (`src/components/match/MatchesHero.tsx:38-81`), pinned outside the scroll:
- `gamesListTitle: 'מחזורים'` (`src/i18n/he.ts:793`) — the comment at `MatchesHero.tsx:39-41` notes the greeting was deliberately moved to Home
- `matchesHeroSubtitle: 'הצטרף למחזורים או צור מחזור חדש'` (`:3071`)

Floating controls row (`GamesListScreen.tsx:653-855`): map button, filter button with a count badge, requests bell with a count badge.

The list is **one sectioned scroll, no tabs** (comment `:654-655`), with three possible bodies:

**(a) `filteredToNothing`** — `isEmpty && filterCount > 0` (`GamesListScreen.tsx:578`) → `FullEmptyState` with `hasActiveFilters` (`:891-899`, component `:1324-1390`):
- `emptyHomeFilteredBody: 'אין מחזורים שתואמים לסינון'` — `:2853`
- button `emptyHomeClearFilters: 'נקה סינון'` — `:2854`
- the FAB is **hidden** in this state only (`:975`)
- (unreachable branches of the same component: `emptyHomeBody: 'צור מחזור חדש או הצטרף למחזור קיים'` `:2844`, `emptyHomeNoGamesAnywhere: 'אין מחזורים פתוחים כרגע — היה הראשון לפתוח מחזור למועדון שלך'` `:2850`, `emptyHomePrimary: 'צור מחזור'` `:2845`, `emptyHomeSecondary: 'מצא מחזורים'` `:2846` — `FullEmptyState` is now only ever called with `hasActiveFilters`, `GamesListScreen.tsx:891-899`)

**(b) `isEmpty` with no filters — THE NEW-USER CASE** (`GamesListScreen.tsx:900-912`):
- `gamesNoOpenTitle: 'אין כרגע מחזורים פתוחים שמתאימים לך'` — `src/i18n/he.ts:3371`
- `gamesNoOpenBody: 'אבל יש אנשים שרוצים לשחק — הנה איפה להתחיל'` — `:3372`
- then `upcomingSection` (empty for a new user), then `MatchEmptyHintCard`, then `discovery`

**(c) Non-empty** (`:913-965`) — `matchesSectionMine: 'המחזורים שלי'` (`:3365`), `homeUpcomingSectionTitle: 'בקרוב במועדונים שלך'` (`:2030`), `matchesSectionOpen: 'מחזורים פתוחים'` (`:3364`), then discovery below every real match.

`MatchEmptyHintCard` (`src/components/match/MatchEmptyHintCard.tsx:25-48`):
- `matchesEmptyCardTitle: 'לא מצאת מחזור מתאים?'` — `:3399`
- `matchesEmptyCardSub: 'צור מחזור חדש ותן לאחרים להצטרף'` — `:3400`

**The FAB** (`GamesListScreen.tsx:976-999`): pinned bottom-LEFT under RTL, `Breathing` pulse, accessibility label `matchesCreateFab: 'יצירת מחזור חדש'` (`:139`). A one-time device hint bubble points at it: `hintCreateGame: 'כאן יוצרים מחזור חדש'` (`:2857`), shown when `storage.getHintCreateGameSeen()` is false (`:225-232`).

**A first-visit modal also fires here.** `AvailabilityNudgeModal` (`GamesListScreen.tsx:1101-1115`) is armed when the user has no `preferredDays` and hasn't been shown it in 3 days (`:121-132`) — so a brand-new user's very first visit to the Games tab is interrupted by a popup before they see the list.

#### 3.3 The discovery blocks beneath the list

Shown when `!filteredToNothing && density !== 'many'` (`GamesListScreen.tsx:582`). Density from `feedDensity(visibleGamesCount, richMin)` (`src/utils/feedDensity.ts:38-41`): `0 → 'none'`, `>= richMin → 'many'`, else `'few'`. Defaults `richMin: 5`, `demandMin: 3`, `clubsMax: 3`, `clubsRadiusKm: 30`, `clubsMinMembers: 10` (`src/utils/feedDensity.ts:12-27`), each overridable by Remote Config (`src/config/gamesFeedDiscovery.ts:42-56`).

`AreaDemandCard` (`src/components/games/AreaDemandCard.tsx`) — without a saved home area it shows the prompt variant (`:114-126`):
- `gamesDemandPromptTitle: 'רוצה לדעת מי מחפש משחק לידך?'` — `src/i18n/he.ts:3391`
- `gamesDemandPromptBody: 'הגדר את אזור הבית והימים שנוח לך, ונראה לך כמה שחקנים פנויים בכל חלון — כדי לפתוח מחזור בדיוק מתי שיש ביקוש.'` — `:3392-3393`
- `gamesDemandPromptCta: 'הגדר אזור וזמינות'` — `:3394`
With data (`:150-216`): `gamesDemandTitle: 'ביקוש לכדורגל באזור שלך'` (`:3373`), `gamesDemandFreeHeadline: (n, day, window) => \`${n} שחקנים פנויים ${day} ${window} באזור שלך\`` (`:3383-3384`), `gamesDemandHeroSub: 'נראה שיש פה מחזור שמחכה לקרות'` (`:3385`), `gamesDemandOpenCta: (day) => \`פתח מחזור ל${day}\`` (`:3386`), `gamesDemandLookingHeadline` (`:3387-3388`), `gamesDemandImFreeCta: 'גם אני פנוי'` (`:3389`), `gamesDemandFoot: 'הספירה מבוססת על שחקנים שסימנו זמינות'` (`:3390`).

`NearbyClubsSection` (`src/components/games/NearbyClubsSection.tsx:186-194`):
- with location: `gamesClubsNearbyTitle: 'מועדונים באזור שלך'` (`:3395`) / `gamesClubsNearbySub: 'קהילות כדורגל שמשחקות בקביעות לידך — הצטרף ותשחק איתן'` (`:3396`)
- without: `gamesClubsAnyTitle: 'מועדונים שאפשר להצטרף אליהם'` (`:3397`) / `gamesClubsAnySub: 'הקהילות הפעילות באפליקציה — הגדר אזור בית כדי לראות את אלו שלידך'` (`:3398`)
It carries its own inline join with the identical toast set as the communities feed (`NearbyClubsSection.tsx:126-173`), so a club can be joined **without ever opening the Communities tab**.

#### 3.4 The card and its button, state by state

`MatchListCard` (`src/components/match/MatchListCard.tsx`). Occupancy counts registered players **plus active guests plus a held promotion reservation** (`:103-106`):
```js
occupancy = game.players.length + activeGuestCount(game.guests) + (game.pendingPromotion?.uid ? 1 : 0)
```
`ctaForGame` (`:63-86`), in order:
1. `status === 'joined'` → `cancel`
2. `status === 'waitlist'` → `leaveWaitlist`
3. `status === 'pending'` → `pending`
4. `g.status === 'scheduled'` → `none`
5. `occupancy >= g.maxPlayers` → `waitlist` — **occupancy is checked before `requiresApproval`**, with a long comment at `:71-78` explaining the production case: *"The one public game in the country is sitting at exactly 21/21 (1 player + 20 active guests) and has collected 7 such requests over 17 days, aged up to 18."*
6. `g.requiresApproval` → `requestJoin`
7. else → `join`

Only `join`/`requestJoin`/`waitlist` render a button (`showCta`, `:135-136`). The label is deliberately only two possibilities (`:139-140`):
- `gameCardRequestJoin: 'בקש להצטרף'` — `src/i18n/he.ts:808` (approval required)
- `matchCardJoinShort: 'הצטרף'` — `:3033` (everything else, **including a full game** — comment at `MatchListCard.tsx:137-138`: *"Even a full game's CTA just says 'הצטרף' … tappers land on the waitlist and then see the 'ברשימת המתנה' badge."*)

Otherwise a non-interactive status badge replaces the button (`:145-152`):
- joined → `matchStatusJoined: 'בהרכב'` (`:3048`), green
- waitlist → `matchCardInWaitlist: 'ברשימת המתנה'` (`:3034`), amber
- pending → `matchStatusPending: 'ממתין לאישור'` (`:3050`), grey

Other card copy: occupancy `matchCardOccupancy: (n, max) => \`${n}/${max}\`` (`:3041`); when-line `matchCardWhenToday: (t) => \`היום ב-${t}\`` (`:3037`), `matchCardWhenTomorrow: (t) => \`מחר ב-${t}\`` (`:3038`), `matchCardWhenDate: (d, t) => \`${d} · ${t}\`` (`:3039`); visibility chip `matchTagOpenToAll: 'פתוח לכולם'` (`:3052`) / `matchTagCommunityOnly: 'סגור למועדון'` (`:3053`) / `matchTagQuickClosed: 'מחזור מהיר'` (`:3054`) (`MatchListCard.tsx:159-167`).

Progress-bar urgency: red when full, amber at ≤3 spots, green otherwise (`:113`). Side stripe: green if joined, amber if waitlisted, blue otherwise (`:128-129`).

#### 3.5 Joining from the card

`handleCardPrimary` (`GamesListScreen.tsx:337-473`):
- `cancel` past the deadline → `ConfirmDestructiveModal` with `lateCancelTitle: 'ביטול קרוב מאוד למחזור'` (`:251`) / `lateCancelConfirm: 'אישור ביטול'` (`:254`)
- `cancel` otherwise → `appAlert(he.leaveGameConfirmTitle, he.leaveGameConfirmBody, ...)` (`:352-362`) — `leaveGameConfirmTitle: 'לבטל את ההרשמה?'` (`:3802`), `leaveGameConfirmBody: 'ההרשמה שלך למחזור תבוטל. תמיד אפשר להירשם שוב כל עוד יש מקום.'` (`:3803`), destructive label `matchMenuLeave: 'יציאה מהמחזור'` (`:3801`)
- `join | requestJoin | waitlist` → `gameService.requestJoinGame(game.id, user.id, 'games_list')` and then a toast keyed on the **returned bucket** (`:372-380`):
  - `toastGameJoinedWaitlist: 'נוספת לרשימת המתנה'` — `:234`
  - `toastGameJoinedPending: 'בקשת ההצטרפות נשלחה'` — `:235`
  - `toastGameJoined: 'הצטרפת למחזור'` — `:231`
- the card is then patched optimistically in place and reconciled after 2500 ms (`:381-419`), because the fair-queue seating is an async Cloud Function
- error branches (`:420-470`): `REGISTRATION_CONFLICT` → the conflict modal, fallback toast `registrationConflictTitle: 'אתה כבר רשום למחזור בזמן חופף'` (`:3816`); `GAME_JOIN_REJECTED` → `matchDetailsJoinRejected: 'בקשתך למחזור זה נדחתה ולא ניתן להירשם שוב.'` (`:3422`); `GAME_NOT_OPEN | GAME_STARTED | GAME_LIVE` → `gameNotJoinableToast: 'המחזור כבר לא פתוח להרשמה'` (`:3815`)

There is **no guest gate on the card join** — `ensureNotGuest` appears in `handleCreate` (`:315`) and `openCreateForSlot` (`:591`) but not in `handleCardPrimary`. A guest tapping `הצטרף` on a card goes straight into `requestJoinGame`.

---

### 4. Joining a game: every gate, with the button label in each state

#### 4.1 The lifecycle gate (shared contract)

`src/services/gameLifecycle.ts` is the single source, explicitly framed as *"the contract"* (`:1-5`).

`canJoinGame(game)` (`:150-157`) returns false unless all three hold:
1. `isOpen(game)` — `effectiveStatus === 'open'`; `status === 'open' && liveMatch.phase === 'live'` is normalised to `'active'` (`:43-48`, `:65-67`)
2. `!isPastLateRegistrationCutoff(game)` — `LATE_REG_GRACE_MS = 60 * 60 * 1000`, i.e. joining stays open **1 hour past kickoff** (`:120`, `:135-138`)
3. `!isRoundRunning(game)` — phases `'live'` and `'roundRunning'` (`:50-58`)

Capacity is explicitly **not** considered (comment `:147-148`): *"a full game still allows joining the waitlist."*

`canCancelRegistration(game)` = `isOpen(game) || isLocked(game)` (`:167-169`).
`isStaleAfterStart` = kickoff + 6 h (`:121`, `:129-132`).

#### 4.2 The write path

`requestJoinGame` (`src/services/gameService.ts:5136-5285`), fair-queue registration:
- `tappedAt = serverNow()` captured **before any await** (`:5141`) so latency can't reorder the queue
- Firestore pre-checks (`:5233-5265`), in order, each a thrown code:
  - doc missing → `'requestJoinGame: game not found'`
  - `data.status !== 'open'` → **`GAME_NOT_OPEN`** (`:5236`)
  - `data.startsAt + LATE_REG_GRACE_MS < Date.now()` → **`GAME_STARTED`** (`:5240`)
  - `data.liveMatch?.phase === 'live'` → **`GAME_LIVE`** (`:5242`)
  - `(data.rejectedPlayerIds ?? []).includes(userId)` → **`GAME_JOIN_REJECTED`** (`:5243-5247`)
  - already in `players`/`waitlist`/`pending` → returns that bucket, idempotent (`:5248-5258`)
  - `findRegistrationConflict` → **`REGISTRATION_CONFLICT`** with the clashing game attached (`:5259-5265`)
- then a contention-free per-user write to `games/{id}/joinRequests/{uid}` with `state: 'queued'` (`:5276-5281`), preceded by a `deleteDoc` so a re-join is always a fresh CREATE (rules forbid updating the doc — comment `:5268-5274`)
- returns an **optimistic** bucket from `predictBucket` / `assignJoins` (`:5145-5170`, `:5284`); the server reconciler is authoritative

Bucket prediction inputs (`:5159-5168`) include the key carve-out: `requiresApproval: g.requiresApproval === true && g.createdBy !== userId` — **the creator never has to approve themselves** — and `pendingOfferReservation: !!g.pendingPromotion?.uid`.

#### 4.3 The MatchDetails screen's button, every state

`src/screens/games/MatchDetailsScreen.tsx`.

`statusForUser` (`:154-159`): `joined` → `waitlist` → `pending` → `none`.
`wasRejected = (game.rejectedPlayerIds ?? []).includes(user.id)` (`:1375-1376`).
`isFull = totalParticipants + (pendingPromotion ? 1 : 0) >= maxPlayers` (`:1394-1395`) — includes guests (`:1378-1379`).
`needsApproval = game.requiresApproval === true && !isAdmin && !isInvitedToGame` (`:1445`), where `isInvitedToGame = (game.invitedUserIds ?? []).includes(user.id)` (`:1443-1444`) — comment at `:1439-1442`: *"the creator + an invited player both saw 'בקש להצטרף' on a game they were invited to."*

`primaryLabel` (`:1446-1451`), in order:

| condition | label | he.ts |
|---|---|---|
| `primaryDestructive` (joined / waitlist / pending) | `matchDetailsCancel: 'בטל הרשמה'` | `:3414` |
| `isFull && !needsApproval` | `gameStatusWaitlist: 'הצטרף לרשימת המתנה'` | `:821` |
| `needsApproval` | `gameCardRequestJoin: 'בקש להצטרף'` | `:808` |
| else | `matchDetailsJoin: 'הצטרף למחזור'` | `:3415` |

**But `primaryLabel` is not always what renders.** The `primary` builder (`:1912-2022`) can return `null` or override it:
1. `isTerminalGame(game)` → `null` (`:1913`)
2. `game.pendingPromotion?.uid === user.id` → `matchDetailsAcceptOffer: 'נפתח לך מקום — אשר הגעה'` (`:3416`), wins over everything (`:1916-1922`)
3. admin branches (`:1923-1981`): `sessionActionInvitePlayers: 'הזמן שחקנים'` (`:292`) or `sessionActionGoLive: 'עבור ללייב'` (`:295`)
4. registered participant + game active → `sessionActionGoLive` (`:1994-2005`)
5. `if (primaryDestructive) return null` (`:2008`) — **a registered, waitlisted or pending user gets NO button at all on this screen**
6. `if (wasRejected) return null` (`:2011`) — rejected users see no join CTA
7. `if (isFillerCandidate) return null` (`:2016`) — the filler banner owns that flow instead
8. else `{ title: primaryLabel, onPress: handlePrimary }` (`:2017-2021`)

`blockedByConflict = !!preCheckConflict && !!primary && status === 'none'` (`:2025-2026`). When true the sticky bar shows a locked, shake-on-tap button (`:2612-2622`) labelled `matchPrimaryConflict: 'יש לך מחזור אחר בזמן הזה'` (`:3784`).

**Cancelling is menu-only.** Comment at `:2641-2643`: *"the giant red 'בטל הרשמה' is gone; the only exit is the ☰ menu's 'יציאה מהמשחק'"*, gated on `primaryDestructive && canCancelRegistration(game)` (`:2245`), item label `matchMenuLeave: 'יציאה מהמחזור'` (`:3801`), and the confirm lives inside `handlePrimary` so every entry point gets it (`:1414-1434`).

#### 4.4 Pre-tap toasts when `canJoinGame` is false

`performPrimary` (`:901-1000`), branch order at `:917-932`:

| condition | toast | he.ts |
|---|---|---|
| `isFinished(game)` | `matchDetailsAlreadyFinished: 'המחזור הסתיים'` | `:3423` |
| `isCancelled(game)` | `matchDetailsAlreadyCancelled: 'המחזור בוטל'` | `:3424` |
| `isRoundRunning(game)` | `matchDetailsAlreadyLive: 'המחזור כבר במצב לייב'` | `:3421` |
| `startsAt < now` | `matchDetailsAlreadyStarted: 'המחזור כבר התחיל'` | `:3420` |
| `isScheduled(game)` + `registrationOpensAt` | `matchDetailsRegistrationOpensAt: (when) => \`ההרשמה עדיין לא נפתחה — היא תיפתח ב-${when}\`` | `:3418-3419` |
| `isScheduled(game)` without it | `communityNextGameLocked: 'ההרשמה תיפתח בקרוב'` | `:1589` |
| anything else | `matchDetailsClosedForRegistration: 'ההרשמה נסגרה'` | `:3417` |

Then the red-card gate (`:936-965`): `redBlocked` is re-verified against the server at tap time because the mount-time flag doesn't live-update, and on failure shows `redCardBlockToast: 'יש לך כרטיס אדום פעיל במועדון — לא ניתן להירשם'` (`:550`) as an **error** toast, not info.

Guest gate first of all (`:906-908`): `ensureNotGuest(he.guestRegisterJoinGame, { type: 'session', id: game.id })` — `guestRegisterJoinGame: 'כדי להירשם למחזור צריך חשבון. רוצה להירשם עכשיו?'` (`:1803`). The `{type:'session'}` stash is what brings the user back to this game after signup.

#### 4.5 Whole-screen blocked states

- **Not found** (`:1251-1280`): `matchDetailsDeletedTitle` / `matchDetailsDeletedBody` + `deletedTargetBackToMain`, resets to `GameTab/GamesList`.
- **Access blocked** — a non-member opened a community-only game and the rules denied the read (`:1282-1308`). Deliberately leaks nothing: header is the generic screen title, no group name, no fields.
  - `communityOnlyGameTitle: 'מחזור לסגל בלבד'` — `:3474`
  - `communityOnlyGameSubtitle: 'המחזור הזה פתוח רק לחברי המועדון'` — `:3475`
  - `communityOnlyGameBack: 'חזור'` — `:3476`
  - **This is a hard dead end.** There is no "request to join the club" affordance on this screen.
- **Load error** (`:1310-1340`): `matchDetailsLoadErrorTitle` / `matchDetailsLoadErrorBody` + `gameRetry`.

#### 4.6 Registration windows

Three independent timestamps on the `Game` doc:

- **`registrationOpensAt`** (`src/types/index.ts:1782`) — until it passes the game's `status` is `'scheduled'`, set at create time: `const isDeferred = typeof input.registrationOpensAt === 'number' && input.registrationOpensAt > now; const initialStatus = isDeferred ? 'scheduled' : 'open'` (`src/services/gameService.ts:2776-2779`). A Cloud Function (`flipScheduledGames`) flips it to `'open'`. While scheduled: the card CTA is `none` (`MatchListCard.tsx:70`), `getOpenGames` and `getCommunityGames` both filter it out (they require `status == 'open'`), and it appears only in the `'בקרוב במועדונים שלך'` teaser section for **members of that club** (`getMyUpcomingScheduledGames`, `src/services/gameService.ts:2328-2389`). A stranger cannot see a scheduled game at all.
- **`publicOpenAt`** (`src/types/index.ts:1830`) — ms-epoch when a CF flips `visibility` from `'community'` to `'public'`. Latch `publicOpenedAt` (`:1832`). Until it fires, non-members simply do not match the `getOpenGames` query. Set in the wizard at `src/screens/games/GameWizardForm.tsx:1109-1130`, summarised as the hardcoded Hebrew `` `המשחק ייפתח לכל האפליקציה ${when(...)}` `` (`GameWizardForm.tsx:1195` — **string not in he.ts**). Toggle label `wizardPublicOpenToggle: 'פתיחה לכלל האפליקציה בזמן מתוזמן'` (`src/i18n/he.ts:1165`).
- **`guestsOpenAt`** (`src/types/index.ts:1840`) — gates only *adding guests*, never joining. `canAddGuest` (`src/services/gameLifecycle.ts:184-201`): open-only, admins always allowed, otherwise the actor must be a participant (players ∪ waitlist) and `Date.now() >= (game.guestsOpenAt ?? 0)`.

**Rejected lists.** `rejectedPlayerIds` (`src/types/index.ts:1626`, doc-comment `:1620-1625`: *"Terminal: only an admin clears it."*) blocks both the client CTA (`MatchDetailsScreen.tsx:2011`) and the write (`gameService.ts:5243-5247`, and `:5181-5185` in mock).

**Waitlist / promotion offers.** `waitlistApprovalRequired` + `waitlistApprovalTimeoutMinutes` (`src/types/index.ts:1543-1544`). `cancelGameV2` sets `pendingPromotion` rather than auto-seating (comment `MatchDetailsScreen.tsx:1000-1010`). The offered user's CTA becomes `matchDetailsAcceptOffer: 'נפתח לך מקום — אשר הגעה'` (`:3416`), handled by `handleConfirmSpotOffer` (`:1518-1530`). The held reservation counts toward occupancy everywhere (`MatchListCard.tsx:106`, `MatchDetailsScreen.tsx:1394-1395`).

---

### 5. What the user sees after requesting, before an admin approves

#### 5.1 Pending on a GAME (`requiresApproval` → `pending[]`)

| surface | what renders | file:line |
|---|---|---|
| toast at the moment of the tap | `toastGameJoinedPending: 'בקשת ההצטרפות נשלחה'` | `src/i18n/he.ts:235`, `GamesListScreen.tsx:376` |
| the feed card's button | replaced by a grey non-interactive badge `matchStatusPending: 'ממתין לאישור'` | `:3050`, `MatchListCard.tsx:150-152` |
| MatchDetails hero badge | `matchStatusPending: 'ממתין לאישור'`, `tone="neutral"` | `MatchDetailsScreen.tsx:3924-3925` |
| MatchDetails status card **title** | `matchStatusCardYouRegistered: 'אתה רשום למחזור'` | `:3523`, chosen at `MatchDetailsScreen.tsx:333-335` via `const userIsIn = status !== 'none'` |
| MatchDetails status card subtitle | `matchStatusCardWaitingHelper: (n) => \`חסרים עוד ${n} שחקנים כדי להתחיל\`` when under `minPlayers` | `:3521-3522`, `MatchDetailsScreen.tsx:322-325` |
| MatchDetails button | **none.** `primary` returns `null` at `if (primaryDestructive) return null`, and `buildStatusCardProps` then returns `kind: 'none'`, which suppresses the whole actions row | `MatchDetailsScreen.tsx:2008`, `:356-362`; `src/components/match/MatchStatusCTACard.tsx:88` |
| the only way out | ☰ → `matchMenuLeave: 'יציאה מהמחזור'`, confirmed by `leaveGameConfirmTitle` / `leaveGameConfirmBody` | `:3801-3803`, `MatchDetailsScreen.tsx:2245-2257` |

> ⚠️ Factual mismatch worth flagging to the consultant: a user whose request is still **pending approval** is told **`'אתה רשום למחזור'`** ("you are registered for the match"), because `userIsIn` is computed as `status !== 'none'` (`MatchDetailsScreen.tsx:333`) and `'pending'` satisfies it. The hero badge one card above simultaneously says `'ממתין לאישור'`. Same screen, two contradictory claims.

There is **no timeline, no ETA, and no notification-status line** anywhere in the pending state. Nothing tells the user how long approval takes or who is deciding.

#### 5.2 Pending on a CLUB

- toast: `toastJoinRequestSent: 'הבקשה נשלחה'` (`:228`, `PublicGroupsFeedScreen.tsx:379`)
- the club moves into its own feed section `communitiesSectionPending: 'ממתינים לאישור'` (`:1406`, rendered only when non-empty, `PublicGroupsFeedScreen.tsx:823-830`)
- its card CTA becomes the non-tappable `clubCardRequested: 'בקשה נשלחה'` (`:3354`, resolved at `src/utils/clubCard.ts:124-125`), amber-tinted (`ClubCard.tsx:183`, `:190`)
- on the public details screen the primary button becomes `groupsActionPending: 'הבקשה נשלחה'` and is disabled, with `communityCancelJoinRequest: 'בטל בקשת הצטרפות'` beneath it (`CommunityDetailsPublicScreen.tsx:361-378`)
- **a pending member sees none of the club's games.** `getCommunityGames` / `getMyUpcomingScheduledGames` are keyed off `useGroupStore.groups` (members only), never `pendingGroups`.

#### 5.3 Pending as a FILLER candidate

`isFillerCandidate` = signed in, `game.acceptsFillers === true`, `game.status === 'open'`, not a member of the game's club, not already in the roster (`MatchDetailsScreen.tsx:808-819`). Banner at `:2724-2754`:
- `fillerApplyTitle: 'המחזור מחפש שחקנים להשלמה'` — `:3771`
- before: `fillerApplySub: 'הגש מועמדות — מנהל המחזור יאשר אותך ידנית.'` (`:3772`) + a full-width button labelled `gameCardRequestJoin: 'בקש להצטרף'` (`:808`)
- after: `fillerApplySentSub: 'הבקשה נשלחה. מנהל המחזור יחליט אם לאשר.'` (`:3775`) + chip `fillerApplySentChip: 'נשלח'` (`:3776`)
- toast on submit: `fillerApplySent: 'הבקשה נשלחה — ממתין לאישור המנהל'` (`:3774`); failure `fillerApplyError: 'לא הצלחנו לשלוח, נסו שוב'` (`:3777`)
- `fillerApplyCta: 'הגש מועמדות'` (`:3773`) exists in he.ts but the banner now renders `gameCardRequestJoin` instead (`MatchDetailsScreen.tsx:2746`) — an **orphaned string**
- the sticky CTA is suppressed for this user so the two request mechanisms don't co-exist (`:2012-2016`)
- `fillerState` is **local component state only** (`:821`). Navigating away and back re-renders `'idle'` and the button says `'בקש להצטרף'` again, with no record that a request is outstanding.

---

### 6. Dead ends where a new user gets stuck

**D1 — The empty home has no hero and no primary action.** With no club, `nextGame`, `openToJoin` and `scheduledUpcoming` are all empty (`ProfileScreen.tsx:344-399`), `pickHomeHero` returns `'none'` (`src/utils/homeHero.ts:38-39`), and the hero slot renders `null` (`ProfileScreen.tsx:1258`). The card written for exactly this moment — `'אין לך מחזור קרוב' / 'מצא מחזור פתוח או פתח מחזור חדש' / 'מצא מחזור'` — is unreachable (§1.5). What remains above the fold is a coach's one-liner and three equal-weight tiles.

**D2 — The outgoing-requests inbox does not exist.** The bell at `ProfileScreen.tsx:1157-1164` and `GamesListScreen.tsx:836-848` opens `RequestsScreen`, whose data is `getInboxCount` / `getInboxRequests` — `friendsService.listIncomingRequests` + `myAdminGroupsWithPending` + `myGamesWithPending` (`src/services/requestsService.ts:59-69`, `:72-97`). All three are **incoming, admin-side**. A new user's own pending club and game requests appear in **no inbox anywhere**. Empty state: `requestsEmpty: 'אין בקשות ממתינות'` (`:1668`), `requestsEmptyHint: 'בקשות חברות, הצטרפות למועדונים ולמחזורים יופיעו כאן.'` (`:1669`) — copy that reads as if it covers outgoing requests, and does not.

**D3 — A closed club with no admin response.** `isOpen` defaults false (§2.2). The user waits with no ETA, no reminder, no channel. The only escape is the `'בטל בקשת הצטרפות'` button on the public details screen (`CommunityDetailsPublicScreen.tsx:371`). WhatsApp contact exists only if the admin filled `contactPhone` (`:341`).

**D4 — Community-only game via an invite link.** The blocked screen (`MatchDetailsScreen.tsx:1282-1308`) shows `'מחזור לסגל בלבד'` / `'המחזור הזה פתוח רק לחברי המועדון'` and one button, `'חזור'`. It cannot name the club (by design, `:1283-1286`), so the user cannot go and request to join it.

**D5 — Rejected from a game.** `wasRejected` hides the CTA permanently (`:2011`), tapping anything that reaches the service yields `matchDetailsJoinRejected: 'בקשתך למחזור זה נדחתה ולא ניתן להירשם שוב.'` (`:3422`), and the field is terminal — *"only an admin clears it"* (`src/types/index.ts:1624`). No appeal path.

**D6 — "פתח מחזור" for a user with no club.** The tile routes to the chooser (`ProfileScreen.tsx:1303-1306`). `canCreateCommunityGame` requires admin of some club (`GamesListScreen.tsx:552-553`), so the `'מחזור למועדון'` card is rendered **locked** with a padlock and:
- `createGameChooseCommunityLocked: 'מחזור למועדון קבוע שלך — אבל עדיין אין לך מועדון. הקם מועדון ראשון כדי לפתוח לו מחזורים.'` — `:1158-1159`
- or, for a member who isn't an admin: `createGameChooseCommunityNotAdmin: 'רק מנהל מועדון יכול לפתוח מחזור למועדון. בקש מהמנהל שלכם לפתוח, או הקם מועדון משלך.'` — `:1160-1161`
A rescue CTA appears below it (`GamesListScreen.tsx:1178-1207`): `createGameCreateCommunityCta: 'הקמת מועדון ראשון'` (`:1162`) or `createGameCreateOwnCommunityCta: 'הקמת מועדון משלי'` (`:1163`). So it is an obstacle, not a true dead end — **provided `rcBool('feature_quick_games')` is on** (`GamesListScreen.tsx:1141`). If that flag is off, the chooser contains only the locked card and the escape button.

**D7 — Reaching `GameCreate` directly with no club.** Three separate full-screen gates (`GameCreateScreen.tsx:362-394`):
- `createGameNoCommunities: 'לפני שתוכל ליצור מחזור, צריך להצטרף למועדון'` (`:1196`) + `OrphanCta`
- `createGameNoAdmin: 'רק מנהלי מועדון יכולים ליצור מחזורים. בקש מהמנהל של המועדון ליצור עבורך מחזור.'` (`:1197-1198`) + `OrphanCta`
`OrphanCta` (`GameCreateScreen.tsx:668-701`) reads `createGameOrphanCta: 'צור מחזור חד־פעמי'` (`:1239`) / `createGameOrphanCtaSub: 'בלי מועדון — מהיר, רק עבור המחזור'` (`:1240`). Note the **contradiction**: `'לפני שתוכל ליצור מחזור, צריך להצטרף למועדון'` sits directly above a button that creates a game without one.

**D8 — Zero public games.** If `getOpenGames` returns nothing, the feed shows `'אין כרגע מחזורים פתוחים שמתאימים לך'` plus discovery blocks. Not a hard stop, but the only two exits are "create a game" and "join a club", and per the sort comment in `PublicGroupsFeedScreen.tsx:317-328`, most clubs in the directory have never opened a round.

**D9 — Generic app invite lands nowhere.** `pending.type === 'app'` clears the stash and returns, leaving the user on the empty home (`RootNavigator.tsx:77-80`). No "X invited you" acknowledgement.

**D10 — The guest cul-de-sac.** A guest browsing games hits `ensureNotGuest` on join (`MatchDetailsScreen.tsx:906`), creating a club (`GamesListScreen.tsx:315`) or joining one (`PublicGroupsFeedScreen.tsx:347`). Choosing `'הרשמה'` calls `signOut()` (`src/utils/guestGate.ts:58`), which unmounts the whole navigator. The return target survives only via the stash (`:51-57`) and only for `session` / `team` types.

---

### 7. Minimum tap count, account created → registered for a game

Counting discrete screen taps, not keystrokes. "Registered" = the user's uid is in `players[]`.

#### Best case — 6 taps (create a quick game; the creator is auto-registered)

The decisive line: `const autoSelfRegister = input.isOrphanContext === true && !isDeferred; const initialPlayers = autoSelfRegister ? [input.createdBy] : []` (`src/services/gameService.ts:2788-2790`), with the reasoning at `:2781-2787`: *"Quick games ('orphan context') are created by a user who wants to PLAY them — the wizard never asks whether to self-register, because it's implicit."*

| # | tap | file:line |
|---|---|---|
| 1 | home tile `'פתח מחזור'` → `GamesList` with `openCreate:true` → chooser opens automatically | `ProfileScreen.tsx:1303-1306`; `GamesListScreen.tsx:325-334` |
| 2 | `'מחזור מהיר'` in the chooser → `GameCreate { quick: true }` | `GamesListScreen.tsx:1155-1157`; label `:1700` |
| — | type a field location (`createGameField: 'מיקום המגרש'`, `:870`) — the only required field, `GameWizardForm.tsx:343` | |
| 3 | `wizardStepNext: 'המשך'` (step 1 → 2) | `:1124`; `GameWizardForm.tsx:554-562` |
| 4 | `'המשך'` (step 2 → 3) | same |
| 5 | `createGameSubmit: 'יצירת מחזור'` → opens the summary sheet | `:961`; `GameWizardForm.tsx:563-571` |
| 6 | `wizardSummaryConfirm: 'אישור ויצירה'` | `:1190`; `GameWizardForm.tsx:635-648` |

Result: `nav.replace('MatchDetails', { gameId, celebrate: true })` (`GameCreateScreen.tsx:545-548`) and the creator is already in `players[]`.

Caveats that can make it more: the quick path first provisions a hidden personal group (`groupService.ensurePersonalGroupId()`, `GameCreateScreen.tsx:192`) behind a spinner, `createGameQuickLoading: 'מכינים מחזור מהיר…'` (`:1242`, `GameCreateScreen.tsx:619-629`); the whole `'מחזור מהיר'` option is behind `rcBool('feature_quick_games')` (`GamesListScreen.tsx:1141`); and the app's own `overrides.quick` blanks the title field (`GameCreateScreen.tsx:62-65`, `:95`) so most users will type a name too.

This is "registered" in the bookkeeping sense only — there is no opponent yet.

#### Best case with another human — 2 taps (join an existing open public game)

| # | tap | file:line |
|---|---|---|
| 1 | home tile `'הצטרף למחזור'` → `GameTab` → `GamesList` | `ProfileScreen.tsx:1321` |
| 2 | `matchCardJoinShort: 'הצטרף'` on a card in `'מחזורים פתוחים'` | `:3033`; `MatchListCard.tsx:139-140`, handler `GamesListScreen.tsx:370-380` |

Requires all of: a public, open, future game exists (`gameService.ts:2547-2554`); it isn't full; `requiresApproval === false`; no schedule conflict; the user isn't in `rejectedPlayerIds`. Success toast `'הצטרפת למחזור'` (`:231`). Going via MatchDetails instead makes it 3 (card body → `'הצטרף למחזור'`, `:3415`).

#### Realistic case — 4 taps of user action plus an unbounded human wait

For a brand-new user the public feed is usually empty (§6 D8), so the real route is through a club:

| # | tap | file:line |
|---|---|---|
| 1 | `'גלה מועדונים'` on the coach card (or the `'מועדונים'` tab) → `CommunitiesFeed` | `ProfileScreen.tsx:924-926`; label `:3293` |
| 2 | `clubCardRequest: 'בקש להצטרף'` on a club card (default, because `isOpen` defaults false) | `:3353`; `src/utils/clubCard.ts:126-128` |
| **wait** | an admin approves. No inbox, no ETA, no reminder for the requester (§6 D2/D3). | |
| 3 | open the club's game — from home's hero if one is open (`UpcomingScheduledGameCard` / `HomeNextGameCard`, `ProfileScreen.tsx:1228-1259`) or from `'מחזורים פתוחים'` in the feed | |
| 4 | `'הצטרף'` / `'הצטרף למחזור'` | `:3033` / `:3415` |

And step 4 may not end it either. If the club's game carries `requiresApproval`, tap 4 produces `'בקשת ההצטרפות נשלחה'` (`:235`) and the user is `pending`, not registered — a **second** unbounded admin wait, during which the app tells them `'אתה רשום למחזור'` (§5.1). If the club's game is `scheduled`, there is no button at all until the CF flips it (`MatchListCard.tsx:70`).

**Summary:** 2 taps in the ideal supply case, 6 self-service taps to a match with nobody in it, and in the realistic case 4 taps spread across up to two open-ended human approvals that the app gives the new user no way to track.

### Open questions from this section

Things this reader could not settle from the code, listed rather than assumed.

- Does a brand-new account actually have `user.position` set at the end of profile setup? If it does, `statsCandidates` pushes a `position` candidate (src/utils/assistant/rules.ts:632-638), `statsRule` fires at priority STATS:5 and OUTRANKS the DISCOVERY:6 welcome rule — so the first sentence a new user ever reads would be a position line with a 'לסטטיסטיקה' CTA into an empty stats screen, and 'ברוך הבא ל-Teamder! 👋' would never appear. This flips the entire opening impression and can only be settled by checking ProfileSetup on a device.
- How many public, open, future games actually exist in production right now? `getOpenGames` (src/services/gameService.ts:2547-2554) is the ONLY query that can return anything for a user with no club, and a code comment at src/components/match/MatchListCard.tsx:73-76 says the one public game in the country is sitting at 21/21. If that is still true, the entire 2-tap best case is unreachable and every new user is forced down the club route.
- What does the `availabilityCounts` callable return for an account with no saved home city? The client only branches on `hasLocation` (src/screens/tabs/ProfileScreen.tsx:803-807); the server function is not in this repo's client source. If it happens to return `hasLocation: true` with generic counts, the recommended-day banner and the podium DO render on the empty home and my §1.6/§1.8 mapping is wrong.
- Current Remote Config values for `feature_quick_games`, `feature_friends`, `feature_referrals`, `feature_feedback`, and the five `games_feed_*` knobs. `feature_quick_games` in particular decides whether the create chooser offers any usable option at all to a user with no club (src/screens/games/GamesListScreen.tsx:1141).
- What proportion of clubs in /groupsPublic have `isOpen: true`? The default in the create wizard is OFF (src/i18n/he.ts:1307-1308 + src/services/groupService.ts:2030), which is what makes the realistic join path pass through an unbounded admin wait. The actual split decides whether that wait is the common case or the exception.
- Is a push notification sent to the requester when a club or game join request is approved or rejected? Nothing on the client renders an approval status, and the bell inbox is incoming-only (src/services/requestsService.ts:59-69), so push is the only possible channel — and it lives in the Cloud Functions source, not here.
- Does `PostSignInOnboardingScreen` (src/screens/onboarding/PostSignInOnboardingScreen.tsx) already introduce clubs/games before the user reaches home? I did not map it — it belongs to the onboarding surface — but whether it primes the 'join a club' concept changes how the empty home reads.
- Exactly what the three action tiles look like at real widths in Hebrew. The subtitles were removed because 'הצטרף למחזור' was clipping in a ~110pt column (src/components/home/HomeDashboardParts.tsx:145-148), and the titles still render with numberOfLines={1} (:166) — needs a device screenshot to confirm the longest label still fits.
- Whether a guest can reach the games feed and tap 'הצטרף' on a card. `ensureNotGuest` is present in GamesListScreen's handleCreate (:315) and openCreateForSlot (:591) but NOT in handleCardPrimary (:337), so the card join appears ungated for a guest. Needs a device check against the Firestore rules to see what the write actually does.

---


## 5.5 · The web landing pages, from the source

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

### Open questions from this section

Things this reader could not settle from the code, listed rather than assumed.

- Is the root landing page's closed-beta framing intentional? The app has been live on both stores for months (iOS 1.1.7 released 2026-09-16, Android live on Play production), yet teamderfc.web.app/ carries zero store links and routes every visitor to a WhatsApp message asking for a Google-account email. I could not determine from the code whether this is a forgotten page or a deliberate funnel; it needs an owner decision.
- What share of real traffic reaches each route? The code tells me /i/{code} is the form of every in-app share and that /get is hand-pasted into Facebook groups, but the actual split between /, /get, /i/, /session/, /team/ and /c/ can only come from the Joryio dashboard or Firebase Hosting logs.
- Does the iOS clipboard deferred deep link actually work end to end on a real device? The web write is inside a click handler, but navigator.clipboard.writeText is async and location.href fires immediately after (invite.html:231). Only a device test can confirm the write lands before navigation. Also unverified: whether the Remote Config flag feature_ios_clipboard_invite is currently ON in production.
- Does the Android intent:// auto-redirect on /c/{id} (c/index.html:1046-1057) behave well when the app is NOT installed? The S.browser_fallback_url points back at the same page, which should be a no-op, but I could not test this on a real Android device.
- On non-Chrome Android browsers and on desktop, does the raw footy:// scheme assignment produce a visible error dialog before the 1500ms store fallback fires (invite.html:231, c/index.html:1062)? The iOS path was explicitly changed to avoid exactly this, so the same risk on other platforms needs a device check.
- Should the public /downloads/teamder-0.2.5.aab (44MB, served live, returns 206) be removed? I verified it is downloadable but cannot tell whether it is still deliberately linked from somewhere outside this repo.
- Is 'אחוז הצלחה' (c/index.html:875, backed by organizationRatePct) a metric a visitor can interpret? It is never defined on the page and I could not find a user-facing definition anywhere.
- Which vocabulary should win, מועדון or קהילה? The app strings and the SSR function say מועדון; the entire /c/ showcase page and the privacy policy section 2.4 say קהילה. Both render on the same URL today. This needs an owner ruling before copy is fixed.
- Are the Open Graph previews actually rendering as intended in WhatsApp? I verified the served meta tags per route, but WhatsApp's crawler caches aggressively and no route supplies a wide image (every og:image is the 512x512 logo.png, and /i/ game links supply no og:image at all) — worth a real paste test.
- Does the /team/{id} route ever get shared in practice, or has the short link fully replaced it? It matters because its SSR fallback meta is community-showcase copy on a join-invite page (functions/src/index.ts:10535-10540).

---


# Part 6 · Eight readings

Each section is one reader with one question, arguing from the evidence in Parts 1–5. They ran
independently and were not shown each other's work, so where two agree they agree separately, and
where they disagree both readings are printed.

These are readings, not instructions. This document decides nothing.


### הבנה — האם גבר בן 40 ששיחק כדורגל חובבני וקיבל קישור מחבר מבין מה לעשות בכל מסך, והאם העברית טבעית

## העדשה: האם הוא מבין מה קורה כאן?

בדקתי את המסלול מרגע הפתיחה הראשונה ועד חשבון שמיש, דרך העיניים של דמות אחת: **גבר בן 40, משחק כדורגל שכונתי בימי שלישי, קיבל וואטסאפ מהמארגן ב־22:00 בלילה שלפני המשחק עם קישור.** הוא לא קורא מסכי הסבר, הוא מחפש תשובה אחת: "נרשמתי? יש לי מקום?"

פתחתי בעצמי כל קובץ שעליו בניתי ממצא. הכל למטה מצוטט מהקוד.

### השורה התחתונה

המסלול עצמו **קצר ונקי** — חמש הקשות מגוגל ועד המסך הראשי, בלי שאלון, בלי בחירת עמדה, בלי מספר חולצה. זו החלטה טובה ואסור לקלקל אותה. הבעיה היא לא האורך, אלא ש**הטקסט מדבר בשפה של מי שבנה את האפליקציה, לא בשפה של מי שנרשם למשחק**. שלוש חזיתות:

1. **מילה אחת שלא מוסברת לעולם** — "מחזור". היא מופיעה בשקופית הראשונה שהמשתמש רואה, היא שם של טאב, והיא לא מוגדרת באף מקום לאורך כל ההרשמה.
2. **הקישור נעלם** — האיש הגיע בגלל מועדון ספציפי, והאפליקציה לא מזכירה אותו אפילו פעם אחת עד שהוא כבר בפנים. השקופיות מוכרות לו "שחקנים חדשים לידכם", שזה בדיוק ההפך ממה שהוא בא בשבילו.
3. **אף אחד לא מדבר באותו קול** — השקופיות ברבים ("שחקו", "גלו", "בנו"), הכותרת בהתחברות ברבים ("בואו נתחיל"), השורה מתחתיה בזכר יחיד ("התחבר"), וכל מה שאחרי זה בזכר יחיד ("בוא נכיר", "אתה גולש כאורח"). ארבע וריאציות על "בוא נתחיל" מופיעות בארבעה מסכים רצופים, וזה קורא כמו לולאה.

### מה שעובד ואסור לגעת בו

יש כאן כתיבה טובה מאוד כשהיא נוגעת בכאב אמיתי: `onb3Body: 'מישהו ביטל? המקום מתמלא אוטומטית מרשימת ההמתנה עם תזכורות חכמות שדואגות שכולם יגיעו'` (`src/i18n/he.ts:1786`). זה בדיוק הסיטואציה שהאיש מכיר. וההודעה על מייל שכבר רשום (`he.ts:1832-1833`) היא דוגמה למופת — מסבירה שני מקרים ונותנת כפתור. הפער בין הטקסטים האלה לבין `psoWelcomeBody` מראה שהצוות יודע לכתוב; הוא פשוט לא עשה את זה בכל מקום.

### על הקצב

האורך עצמו סביר: 3 שקופיות + התחברות + שם = חמש הקשות. **ההמלצה שלי היא לא לקצר אלא להחליף תוכן** — השקופיות לא נכשלות כי הן ארוכות, אלא כי הן מוכרות משהו אחר ממה שהאיש בא בשבילו. שקופית אחת שאומרת "הזמינו אותך למועדון X" שווה יותר משלוש שקופיות על שחקנים באזור.

### מה הייתי מתקן קודם

בסדר הזה: (1) שם המועדון על המסך הראשון של מוזמן, (2) להסביר או להחליף את "מחזור", (3) לתקן את `signInSubtitle` ואת `guestRegisterJoinGame` — שתי שורות שבהן "להירשם" מופיע בשתי משמעויות, (4) להאחיד את הגוף הדקדוקי, (5) להפסיק לבקש תמונת פרופיל ממי שבחר אווטאר לפני 20 שניות.

---


### אורך וקצב — האם הפתיחה ארוכה מדי, קצרה מדי, או מבקשת דברים מוקדם מדי; כל מסך נשפט על השאלה אם הוא מצדיק את קיומו

## הפתיחה של Teamder — ביקורת קצב

**עדשה:** אורך וקצב בלבד. לא עיצוב, לא נגישות, לא באגים. השאלה היחידה בכל מסך היא: *מה המסך הזה קונה למשתמש, ומה הוא עולה לו?*

כל טענה כאן נבדקה מול הקוד (נתיבים מלאים ומספרי שורות). לא הורץ מכשיר — קבועי הזמן מצוטטים מהקוד, לא נמדדו בשטח.

---

### התמונה בגדול

הפתיחה עצמה **לא ארוכה**. גוגל־חדש = 5 הקשות בתוך האפליקציה, 0 הקלדות, 6 מסכים. זה קצר יחסית לכל אפליקציה מקבילה, והצוות כבר עשה כאן עבודת גיזום אמיתית: `PostSignInOnboardingScreen.tsx:1-6` מתעד שלושה מסכים שקוצצו לאחד, ו־`OnboardingScreen.tsx:1-6` מתעד ארבע שקופיות שקוצצו לשלוש.

הבעיה היא לא האורך הכולל. היא **הסדר**:

1. **המסלול היחיד שמייצר משתמשים באמת — קישור הזמנה מהמארגן — משלם בדיוק את אותו מחיר כמו הורדה אקראית מהחנות.** הקוד כבר יודע לאן הוא רוצה ללכת, ומחליט לא לקצר.
2. **האפליקציה מבקשת לפני שהיא נותנת.** דיאלוג ההתראות של מערכת ההפעלה קופץ על מסך "בוא נכיר", לפני שהמשתמש הקליד שם.
3. **הפתיחה לא נגמרת.** אחרי "בואו נתחיל" (התחברות) ו"בוא נכיר" (פרופיל), מסך הבית מקדם בפנים בכרטיס בשם **"בוא נתחיל"** עם חמש משימות. שלוש התחלות ברצף, ואף אחת מהן לא מסיימת.
4. **ובו בזמן הפתיחה קצרה מדי במקום אחד קריטי:** היא אף פעם לא שואלת אם אתה מארגן או שחקן, ואם כבר יש לך קבוצה. השאלה הזאת קיימת — אבל היא הוצאה החוצה לקמפיין Joryio מרוחק (`src/services/onboardingService.ts`), כלומר היא לא חלק מהמסלול ולא מובטח שתופיע בכלל.

---

### ציר הזמן, כפי שהוא בקוד

| # | מסך | הקשות | מה נקנה כאן | הערכה |
|---|---|---|---|---|
| 1 | ספלאש מערכת (`app.json`, `splash-blank.png`) | 0 | כחול ריק, מונע הבהוב | תקין |
| 2 | ספלאש מונפש (`SplashScreen.tsx`) — `MIN_HOLD_MS = 1400` + `FADE_MS = 320` | 0 | מיתוג + "המשחק הבא שלך מתחיל כאן" | מוצדק — **פעם אחת** |
| 3 | 3 שקופיות (`OnboardingScreen.tsx`) | 3 (או 1 עם "דלג") | הצעת הערך | מוצדק להורדה אקראית, **מיותר למוזמן** |
| 4 | התחברות (`SignInScreen.tsx`) | 1 | חשבון | מוצדק |
| — | בורר החשבון של גוגל | [OS] 1 | — | מוצדק |
| — | **דיאלוג התראות** (`RootNavigator.tsx:235-248`) | [OS] 1 | כלום, בשלב הזה | **מוקדם מדי** |
| 5 | "בוא נכיר" (`PostSignInOnboardingScreen.tsx`) | 1 | שם + אווטאר | מוצדק |
| 6 | **אותה אנימציית ספלאש שוב** (`RootNavigator.tsx:274,288`) | 0 | כלום | **לא מוצדק** |
| 7 | בית + כרטיס "בוא נתחיל" עם 5 משימות + באנר פרסומת | — | רשימת מטלות | **התחלה רביעית** |

מסלול המייל מוסיף מסך, 4 הקלדות והקשה מבוזבזת אחת (המסך נפתח במצב התחברות, `EmailAuthScreen.tsx:45`).

---

### מה לא לגעת בו

שני דברים כאן נכונים ולא צריך לשנות אותם:

**שלוש השקופיות באורך הזה.** `onb1Body: 'גלו מחזורי כדורגל פתוחים באזור שלכם והצטרפו בלחיצה — או פגשו שחקנים חדשים לידכם'` — זו עברית טבעית, קצרה, ומסבירה מוצר. שלוש שקופיות עם "דלג" גלוי הן החוזה הסטנדרטי שמשתמש ישראלי מזהה ויודע לדלג עליו. ההערה ב־`OnboardingScreen.tsx:1-6` שמתעדת את הקיצוץ מארבע היא שיפוט נכון. אל תקצצו לשתיים ואל תוסיפו רביעית.

**דילוג על פרסומת ה־app-open בהתקנה טרייה** (`App.tsx:872-879`) והפרדת ההתחברות מהשקופית האחרונה (`OnboardingScreen.tsx:79-83`). שתי החלטות קצב טובות, שתיהן מתועדות בקוד עם הנימוק. זה בדיוק סוג המשמעת שחסר בשלושה מקומות אחרים במסמך הזה.

---

### הפערים, לפי חומרה

**1. המוזמן משלם על פתיחה שלא נועדה לו.** ההזמנה כבר שמורה בדיסק ברגע הקר (`App.tsx:453`), אבל השער ב־`RootNavigator.tsx:65` דורש `hasCompletedOnboarding` לפני שמותר לפתוח את היעד. התוצאה: מי שלחץ על לינק למשחק ספציפי רואה שלוש שקופיות שמסבירות לו איך *למצוא* משחקים ואיך *לבנות* סגל — שתי בעיות שכבר נפתרו לו לפני שהוריד.

**2. ההתראות נדרשות לפני שניתן משהו.** האפקט ב־`RootNavigator.tsx:235-248` רץ ברגע ש־`currentUser` נקבע — אותו רנדר שבו הוחלט להציג את "בוא נכיר". אין מסך הכנה, אין הסבר. הערך של ההתראות הוסבר בשקופית 3 (`onb3Body`) — שתי מסכים קודם, לפני שהייתה סיבה להקשיב.

**3. השאלה החשובה לא נשאלת.** אין באפליקציה שום רגע שבו נשאל "מארגן או שחקן". האשף שעושה את זה חי ב־HTML של Joryio ומטופל ב־`onboardingService.ts:74`, בלי שום קשר למצב האונבורדינג המקומי.

**4. ארבע התחלות.** `'בואו נתחיל'` (`he.ts:1793`), `'בוא נכיר'` (`he.ts:2839`), `'בוא נתחיל'` (`he.ts:1990`) — ובנוסף גם `'בוא נכיר'` שני ב־`he.ts:1846`. גם המשלב קופץ: השקופיות ברבים (`'שחקו'`, `'גלו'`, `'בנו'`), הכותרת ברבים (`'בואו נתחיל'`), ומיד מתחתיה `'התחבר כדי להירשם...'` ביחיד זכר, ואז `'בוא נכיר'` ביחיד זכר עם כותרת משנה `'מארגנים כדורגל שכונתי בלי בלגן'` שחוזרת לרבים סתמי.

**5-9.** ספלאש כפול, מסך המייל שנפתח בצד הלא נכון, באנר פרסומת בשנייה הראשונה, מודאל "מה חדש" למי שהרגע התקין, ו"דלג" שנעלם בשקופית השלישית. פירוט מלא בממצאים.

---


### נטישה — ספירת הנקודות שבהן אדם שכבר רוצה את האפליקציה מפסיק בדרך אליה, מרגע הקלקה על הקישור ועד שהדבר שהזמינו אליו פתוח על המסך

## העדשה: איפה נושרים בדרך אל האפליקציה

בדקתי מסלול אחד בלבד: אדם *שכבר רוצה* — חבר שקיבל קישור למחזור בוואטסאפ, מישהו שראה פוסט בפייסבוק, מישהו שהקליד "Teamder" בגוגל. לא מדובר בשכנוע. מדובר בספירת המקומות שבהם הרצון הזה נשבר בין הלחיצה לבין המחזור הפתוח על המסך. פתחתי כל קובץ שעליו נשען ממצא.

### המשפך כפי שהוא באמת

| מסלול | לחיצות עד שהאפליקציה פתוחה | נקודות עצירה שספרתי |
|---|---|---|
| `/i/<code>` באנדרואיד (כל שיתוף מהאפליקציה) | 4 | שגיאת סכמה בדפדפן של וואטסאפ, 1.5 שניות מתות |
| `/i/<code>` באייפון | 4-5 | הקישור אף פעם לא פותח את האפליקציה — גם למי שהיא כבר מותקנת אצלו; חלון "Allow Paste?" |
| `/get` | **3** | אין |
| `/c/<id>` | 3-4 | — |
| חיפוש אורגני בחנות | 3 | — |
| **`teamderfc.web.app` (הדומיין הראשי)** | **אינסוף — אין בכלל כפתור הורדה** | הדף מבקש לשלוח מייל כדי להצטרף לבטא סגורה |
| אחרי ההתקנה, עד שרואים את המחזור | +3 מסכים | קרוסלה, התחברות, שם ותמונה — ואם בוחרים "המשך כאורח", ההזמנה נבלעת |

המסקנה החשובה ביותר בעדשה הזאת: **הפורמט שהמוצר מייצר בכל שיתוף — `/i/<code>` — הוא הפורמט היחיד שהאפליקציה עצמה לא מזהה.** הוא לא רשום ב-AASA, לא ב-`intentFilters`, ואין לו ענף ב-`parseInviteUrl`. כל שאר התקלות במסמך הזה הן תוצאה של זה: בגלל שהקישור לא נפתח באפליקציה, הוא חייב לרדת דרך דף נחיתה, ודף הנחיתה חייב לנחש סכמות, לכתוב ללוח, ולהמתין 1.5 שניות.

### מה טוב ואסור לגעת בו

`public/get.html` הוא הדף הכי טוב בכל המשפך ואסור לשנות בו כלום. שלוש לחיצות, זיהוי פלטפורמה כולל המקרה של אייפד שמדווח כמק (`get.html:62-63`), הסתרה של הכפתור הלא רלוונטי, `location.replace` מיידי, ושני כפתורים גלויים עם `לא נפתח אוטומטית? בחר/י את החנות שלך למעלה.` — שהוא, דרך אגב, המשפט היחיד בכל המשפך שפונה גם לנשים. גם ההחלטה ב-`public/c/index.html:1025-1032` לא להקפיץ אוטומטית לחנות היא שיקול דעת נכון ומתועד. שני הדפים האלה הם המטרה שאליה שאר המשפך צריך להתכנס, לא להפך.

---


### מחויבות ופרטיות — מה נדרש מהמשתמש לפני שקיבל ערך כלשהו, ואיך זה נקרא למי שזהיר

## העדשה: מה אנחנו דורשים לפני שנתנו משהו — ואיך זה נקרא למי שזהיר

בדקתי את המסלול מהרגע שאדם רואה קישור ועד שיש לו חשבון, ושאלתי שאלה אחת בלבד: **בכל נקודה, מה אנחנו מבקשים ממנו, ומה הוא קיבל עד אותו רגע?** לא מדדתי מספר מסכים — מדדתי את יחס החליפין. משתמש זהיר (וזה בדיוק הפרופיל של מי שמקבל קישור מחבר לקבוצת כדורגל שהוא לא מכיר) עושה את החשבון הזה אוטומטית.

המסקנה: **מבנה החליפין באפליקציה עצמה טוב מאוד. השכבה המשפטית והשיווקית סביבו שבורה.** מצב האורח הוא נכס אמיתי ומתוכנן היטב, והדרישות במסך ההרשמה מינימליות. אבל לפני שהמשתמש מגיע לשם, דף הנחיתה החי דורש ממנו את כתובת המייל שלו בוואטסאפ למספר פרטי, ובתוך האפליקציה אנחנו מצהירים שהוא מסכים למסמך שלא קיים, ומפנים למדיניות פרטיות שמתארת אפליקציה אחרת.

---

### 1. הדרישה הראשונה בכל המסע היא הכי כבדה — והיא מיותרת

`https://teamderfc.web.app/` — הדף שמתקבל כשמישהו מקליד את השם או מגיע מחיפוש — עדיין עמוד בטא סגורה. תחת התג `בטא פתוחה · מקומות מוגבלים` הוא מבקש:

> שלחו לי את כתובת המייל שלכם (זו שמחוברת לחשבון Google של המכשיר). אוסיף אתכם לרשימת הבודקים ותקבלו קישור להורדה.

והכפתור הראשי הוא `שלחו את המייל בוואטסאפ` → `wa.me/972546986121`.

זה הפוך מכל עיקרון בעדשה הזו. הבקשה הראשונה בכל המסע היא לחשוף גם מייל אישי **וגם מספר טלפון** (כי שליחת וואטסאפ חושפת את המספר של השולח) לאדם פרטי — בתמורה להבטחה. והאפליקציה בכלל חינמית ופתוחה בשתי החנויות; אין בטא, אין רשימה, אין מקומות מוגבלים. אנחנו גובים את המחיר הגבוה ביותר במסע עבור מוצר שאפשר פשוט להוריד.

`public/invite.html` — הדף שמקבל מי שהגיע מקישור הזמנה — עושה את זה **נכון**: `הורד את Teamder · חינם · Android ו־iPhone · עברית מלאה`, שני כפתורי חנות, אפס שדות. הפער בין שני הדפים הוא הראיה שהדף הראשי פשוט נשכח מאחור.

### 2. אנחנו מצהירים שהמשתמש הסכים לחוזה שלא קיים

`SignInScreen.tsx:272` מרנדר טקסט מת:

> `באמצעות התחברות אתה מסכים לתנאי השימוש`

זה לא קישור. אין מסמך תנאי שימוש בשום מקום — לא ב-`src`, לא ב-`public`. ו-`public/invite.html:191` כן מקשר אליו: `<a href="/terms.html">תנאי שימוש</a>` — שמחזיר **404 חי** היום.

למשתמש זהיר זו הנקודה שבה הוא עוצר. מישהו אומר לו "בלחיצה הזו אתה מסכים ל-X", ואין שום דרך לקרוא את X. גרוע מאי-הצגת תנאים בכלל: אי-הצגה זה חוסר; הצהרה ללא מסמך זה סימן שלא שולטים בפרטים. בנוסף `אתה` — לשון זכר יחיד — בשורה המשפטית היחידה במסך, כשהכותרת מעליה היא `בואו נתחיל` בלשון רבים.

### 3. המסמך היחיד שכן קיים מתאר אפליקציה אחרת

`public/privacy.html`, עדכון אחרון **29 במאי 2026**, כתוב היטב ומפורט מאוד (Health Connect, ווידג'ט, דפים ציבוריים — כל אלה מכוסים יפה). בדיוק בגלל זה שלוש הפערים בולטים:

- **שורה 251:** `פרטי חשבון: שם וכתובת אימייל — מתקבלים אוטומטית מ-Google בעת התחברות עם Google Sign-In.` זו הדרך היחידה שהמסמך מכיר. בפועל המסך מציע ארבעה כפתורים — Google, Apple, מייל וסיסמה, ואורח. מי שנרשם עם מייל וסיסמה לא מוזכר בכלל.
- **שורה 274:** `ב־iOS נבקש את האישור הזה דרך חלון App Tracking Transparency (ATT) של אפל בעת ההפעלה הראשונה`. אין ATT בקוד — לא חבילה, לא `NSUserTrackingUsageDescription`, לא קריאה. הבטחנו חלון שלא מופיע.
- **Joryio לא מוזכר במסמך אפילו פעם אחת.** `src/firebase/auth.ts:468-471` שולח בכניסה `joryio.identify(uid, { email, name })`, ו-`joryio.ts:146-147,252` מוסיף `platform`, `appVersion` ואת טוקן הפוש. זהו צד שלישי שמקבל מייל ושם של כל משתמש, לרבות משתמש **אורח** (ה-listener לא מבחין), והמסמך שמפרט את Firebase Storage ברמת רזולוציית התמונה שותק עליו לגמרי.

### 4. ההסכמה לפוש שיווקי נלקחת בדיאלוג שלא מדבר על שיווק

`types/index.ts:423` — `marketingPush: true` כברירת מחדל. מה שהמתג הזה מכסה, לפי הקופי שלנו עצמנו ב-`he.ts:3910-3911`: `טיפים ועדכונים` / `עצות למארגנים, תזכורת כשהמועדון שקט וכל מה שאנחנו שולחים ביוזמתנו`. הקופי הזה **ישר ומצוין** — "כל מה שאנחנו שולחים ביוזמתנו" זו אמירה הוגנת. הבעיה היא איפה הוא נמצא: במסך הגדרות, אחרי ההרשמה, כשהמתג כבר דלוק.

ההסכמה היחידה שנלקחה בפועל היא דיאלוג ההרשאות של מערכת ההפעלה, ש-`RootNavigator.tsx:235-248` מפעיל ברגע ש-`currentUser` נקבע — כלומר הוא נוחת **על גבי מסך `בוא נכיר`, לפני שהמשתמש הקליד את שמו**. אין מסך הכנה, אין משפט אחד שמסביר למה. המשתמש אישר "התראות" כשהוא חשב על תזכורת למשחק, וקיבל גם דיוור.

### 5. השם והמייל שדרשנו יושבים במסמך שכל משתמש רשום יכול לקרוא

`firestore.rules:260` — `allow read: if isSignedIn();` על `/users/{uid}`. המסמך כולל `email`. מסך `בוא נכיר` (`RootNavigator.tsx:267-269`) הוא חסימה מלאה בלי כפתור חזרה, בלי דילוג — השם הוא תנאי כניסה.

הצוות כבר זיהה בדיוק את הבעיה הזו והתמודד איתה נכון עבור טוקני הפוש: `firestore.ts:244-249` מסביר שכתיבתם למסמך הגלוי הדליפה טוקנים לכל מחובר, ולכן הועברו ל-`/users/{uid}/private/push`. אותו נימוק חל מילה במילה על `email`. התקדים קיים בקוד; רק לא הוחל.

### 6. מה שטוב — ואסור לגעת בו

**מצב האורח.** `המשך כאורח` יוצר סשן אנונימי שלא כותב מסמך משתמש בכלל (`userService.ts:44-53`), ומאפשר לגלוש במועדונים, בפיד ובפרטי משחק. החסימה מגיעה רק ברגע הפעולה, עם נוסח ספציפי לכל פעולה — `כדי להירשם למחזור צריך חשבון. רוצה להירשם עכשיו?`, `כדי להצטרף למועדון צריך חשבון...` — ולא בנוסח גנרי אחד. ומעל הכל: `guestGate.ts:47-57` שומר את היעד לפני היציאה, כך שאחרי ההרשמה המשתמש חוזר בדיוק למשחק שניסה להיכנס אליו.

זו בדיוק התשובה הנכונה לעדשה הזו — ערך לפני מחויבות, והמחויבות נדרשת רק ברגע שבו היא באמת נחוצה. גם ההימנעות מנדנוד כשהמשתמש דחה גישה לגלריה (`PostSignInOnboardingScreen.tsx:73-77`) ואי-חסימה על אימות מייל (`auth.ts:133-135`) הן החלטות נכונות מאותה משפחה. **אל תגעו בשום אחד מהם.**

### 7. מסך ההרשמה מבקש ולא מבטיח

`he.ts:1794` — `התחבר כדי להירשם, להצטרף למועדון ולעקוב אחרי הסטטיסטיקות שלך.` שלושת הדברים ברשימה הם דברים שהמשתמש צריך לעשות, לא דברים שהוא מקבל. לא נאמר שהאפליקציה חינמית, לא נאמר שאפשר להסתכל בלי חשבון — כפתור האורח קיים אבל מעוצב כטקסט אפור דהוי מתחת לשלושה כפתורים לבנים, מתחת לשורה המשפטית.

ובנוסף ערבוב רגיסטרים בשלושה מסכים רצופים: `בואו נתחיל` (רבים) → `התחבר` (זכר יחיד) → `בוא נכיר` (זכר יחיד). דובר עברית שם לב לזה, ולרוב זה קורא כמו מוצר שנכתב בכמה ידיים.

---

**סדר הטיפול שהייתי ממליץ:** דף הנחיתה (שעה עבודה, משנה את הדרישה הראשונה במסע) → מסמך תנאי שימוש + הפיכת השורה לקישור → עדכון מדיניות הפרטיות (Joryio, ארבעת מסלולי ההתחברות, הסרת הבטחת ה-ATT) → העברת `email` לתת-מסמך פרטי → משפט על התראות לפני דיאלוג ההרשאות.

---


### The empty state — a new user with no club and no games is the make-or-break moment; judge whether the app gives them anywhere to go

## המצב הריק: מה רואה מי שאין לו כלום

הלנס שלי הוא רגע אחד בלבד — משתמש שזה עתה סיים הרשמה, אין לו מועדון, אין לו משחק, אין לו חבר אחד באפליקציה. זה הרגע שבו הוא מחליט אם למחוק. שאלתי את הקוד שאלה אחת: **האם המסך הזה נותן לו לאן ללכת?**

התשובה מדויקת יותר ממה שציפיתי, והיא מפתיעה: **לאפליקציה יש מצב-ריק מצוין. הוא פשוט לא נמצא במסך שעליו המשתמש נוחת.**

---

### הממצא המרכזי: המסך הנכון קיים, טאב אחד משמאל

טאב "מחזורים" (`GamesListScreen.tsx:900-912`) מטפל בריקנות כמו שצריך: שורה כנה אחת — `'אין כרגע מחזורים פתוחים שמתאימים לך'` / `'אבל יש אנשים שרוצים לשחק — הנה איפה להתחיל'` — ומיד מתחתיה `NearbyClubsSection`, שמושכת מועדונים אמיתיים מהאזור, מציגה אותם בכרטיס האמיתי, ומאפשרת להצטרף inline בלי לעזוב את המסך. אם אין מה להציע — הרכיב לא מרנדר כותרת ריקה (`NearbyClubsSection.tsx:181`). זו עבודה טובה. זה **בדיוק** מה שמצב-ריק צריך להיות.

אבל `initialRouteName="ProfileTab"` (`MainTabs.tsx:91`). המשתמש החדש לא נוחת שם. הוא נוחת על מסך הבית, ומסך הבית למשתמש בלי מועדון מרנדר, בסדר הזה:

1. שורה אחת מהמאמן
2. **כלום** — חריץ ה-hero מחזיר `null` (`ProfileScreen.tsx:1228-1264`)
3. שלוש אריחי פעולה
4. כרטיס "הגדר זמינות"
5. צ'קליסט "בוא נתחיל" על 0/5
6. טיפ מתחלף
7. כפתור "הזמן חברים"

**אף מועדון אמיתי. אף משחק אמיתי. אף בן-אדם אחד.** שבעה בלוקים של ריהוט מסך, אפס היצע. כל מה שיש לו זה קישורים לשלוש פעולות שכולן דורשות ממנו להיות זה שמארגן.

---

### ההטיה הגדולה: כל ההשקעה במצב הריק מכוונת אותו להיות מארגן

ספרתי כמה פעמים האפליקציה מבקשת ממשתמש חדש לסמן זמינות בסשן הראשון:

| # | איפה | מחרוזת |
|---|---|---|
| 1 | אריח בבית | `'סמן זמינות'` |
| 2 | כרטיס בבית | `'רוצה לראות מי פנוי לשחק לידך?'` |
| 3 | צ'קליסט שלב 2 | `'סמן מתי אתה פנוי'` |
| 4 | טיפ 3 | `'סמן מתי אתה פנוי — ומנהלים יזמינו אותך למחזורים'` |
| 5 | פופאפ בכניסה לטאב מחזורים | `'מתי בא לך לשחק?'` |
| 6 | כרטיס בפיד | `'רוצה לדעת מי מחפש משחק לידך?'` |

שש בקשות לאותה פעולה. וזו הפעולה היחידה שהאפליקציה דוחפת בעקביות — יותר מ"הצטרף למועדון", שמופיע פעמיים.

ואז בדקתי מה קורה כשהוא באמת עושה אותה. שני ה-handlers שנפתחים אחרי שיש נתוני זמינות — `HomeRecommendedDay` (`ProfileScreen.tsx:1267-1294`) ו-`HomeAvailabilityWindows` (`:1326-1355`) — שניהם מנווטים ל-`GameCreate`. הכותרת היא `'היום המומלץ לפתיחת מחזור'`. הפרס על "סימנתי שאני פנוי" הוא **"עכשיו תפתח מחזור בעצמך"**.

ובדקתי גם מה לא קורה: `grep` על `preferredDays` מחזיר אפס צרכנים בשכבת הפיד. `getOpenGames` (`gameService.ts:2547-2554`) לא מסנן ולא ממיין לפי זמינות המשתמש. שום מסך לא מציג "המחזורים שמתאימים לימים שלך". המנגנון היחיד שכן קורא את זה הוא ה-filler pulse בצד השרת — שדורש שמנהל מועדון כלשהו יפתח מחזור, יסמן `acceptsFillers`, ויחסרו לו שחקנים. עד שזה יקרה, ההבטחה `'אנחנו נמצא לך מחזורים מתאימים!'` (`he.ts:2739`) לא מיוצגת בשום פיקסל.

זה מסביר את תחושת הריקנות טוב יותר מכל בעיית UI בודדת: **המצב הריק בנוי סביב הצרכים של הצד שחסר לאפליקציה (מארגנים), לא סביב הצד שהמשתמש נמצא בו (שחקן).**

---

### שלוש שגיאות שנראות כמו תאונות, לא כמו החלטות

**המצב-הריק של ה-hero נכתב ולא ניתן להגיע אליו.** `HomeNextGameCard.tsx:42-61` מכיל מצב-ריק שלם ומעוצב: `'אין לך מחזור קרוב'` / `'מצא מחזור פתוח או פתח מחזור חדש'` / כפתור `'מצא מחזור'`. הקורא היחיד בקוד נמצא בתוך `{nextGame ? <HomeNextGameCard game={nextGame} .../>}` — כלומר `game` לעולם לא `null`. מישהו כתב את הטקסט הנכון לרגע הזה, ואז שם אותו מאחורי תנאי שמבטיח שאיש לא יראה אותו.

**הרכיב שהוגדר כ-hero של המצב הריק מרונדר במקום השישי.** ההערה של `AvailabilityPromptCard.tsx:1-4` אומרת מפורשות: *"the home 'hero' shown when the user has NO upcoming game… Deliberately large and prominent."* בפועל הוא מרונדר ב-`ProfileScreen.tsx:1356`, מתחת לשלושת האריחים. הכוונה המקורית נכונה; הסידור סותר אותה.

**הצ'קליסט נפתח על 0/5 ופריט 1 הוא משהו שהאפליקציה כבר עשתה.** במסך ה-onboarding `pickRandomAvatarId()` (`PostSignInOnboardingScreen.tsx:49`) בוחר אווטאר אוטומטית; המשתמש לוחץ "המשך" בלי לגעת, ואז `handleSave` שומר `avatarId` ו-`photoUrl` נשאר `undefined` (`:118`). הצ'קליסט בודק `done: !!user.photoUrl` (`ProfileScreen.tsx:646`). המשתמש עובר מסך שבו בחרו לו תמונה, ומיד נוחת על כרטיס שאומר לו `'הוספת תמונת פרופיל'` — לא מסומן.

---

### מה קורה אחרי שהוא כן עושה משהו: שום דבר

זה החלק הכי חמור. נניח שהמסלול עבד: הוא לחץ `'גלה מועדונים'`, מצא מועדון, לחץ `'בקש להצטרף'` (ברירת המחדל — `isOpen` הוא `false`), קיבל טוסט `'הבקשה נשלחה'`, וחזר הביתה.

**מסך הבית שלו זהה לחלוטין למה שהיה לפני.** אותו `null` ב-hero, אותו צ'קליסט על 0/5 עם `'הצטרף או פתח מועדון'` לא מסומן, אותו `'הזמן חברים לאפליקציה'`. `myCommunities` סופר חברים בלבד, לא `pendingGroups`.

והפעמון? `requestsService.ts:32-47` — `myAdminGroupsWithPending` מסנן `adminIds.includes(userId)`, `myGamesWithPending` מסנן `createdBy === userId`. התיבה היא **incoming בלבד, לצד המנהל**. הבקשה שלו לא מופיעה בשום מקום. והמצב הריק של אותו מסך אומר: `'בקשות חברות, הצטרפות למועדונים ולמחזורים יופיעו כאן.'` — משפט שמשתמש סביר יקרא כהבטחה שהבקשה שלו תופיע שם.

כלומר: הפעולה החשובה ביותר שמשתמש חדש יכול לבצע באפליקציה **לא משאירה בה שום עקבה גלויה לו**. הוא לא יודע אם זה נשלח, כמה זמן זה לוקח, ומי מחליט.

---

### הערות על העברית

- `homeChecklistSubtitle: 'כמה צעדים קטנים כדי להפיק את המקסימום'` — "להפיק את המקסימום" הוא תרגומית עסקית ("get the most out of it"), ומקסימום ממה בכלל. במסך שכל תפקידו להביא בן-אדם למשחק, זה צריך להגיד את זה.
- `gamesNoOpenTitle: 'אין כרגע מחזורים פתוחים שמתאימים לך'` — עברית טובה, אבל "שמתאימים לך" מבטיח התאמה שלא קיימת: השאילתה היא `visibility == public && status == open && startsAt > now`, בלי עיר, בלי מרחק, בלי ימים. משתמש בחיפה רואה משחק באילת. או לממש התאמה, או להוריד את שתי המילים.
- `assistantJoinClubSub: 'הגיע הזמן למצוא את החבר׳ה שלך ⚽'` — זו העברית הכי טובה בכל המסך. טבעית, ישראלית, מדויקת לקהל. הכיוון הזה נכון.
- כל המצב הריק בלשון זכר (`'בוא נתחיל'`, `'אתה רשום'`, `'הצטרף'`). עקבי, ותואם את הקהל — אבל שווה החלטה מודעת ולא ברירת מחדל, כי זה בדיוק המסך שבו שחקנית מחליטה אם זו אפליקציה בשבילה.

---


### זמן-עד-ערך: כמה זמן עובר עד שהאדם מקבל את הדבר שהוא בא בשבילו — להיות רשום למחזור כדורגל

> **העדשה:** כמה זמן עובר מהרגע שהאדם פתח את האפליקציה ועד שהוא רשום למחזור כדורגל. לא "האם המסך יפה" ולא "האם הטקסט נכון" — רק השעון.

## התמונה בשורה אחת

**הכניסה לחשבון מהירה באופן יוצא דופן. ההגעה למחזור — לא.**

מדדתי את שני החצאים בנפרד, מהקוד:

**חצי ראשון — מהתקנה ועד חשבון פעיל: כארבע הקשות.**
שלושה שקפים עם `'דלג'` זמין מיד (`src/screens/onboarding/OnboardingScreen.tsx:113`), מסך התחברות אחד עם ארבע אפשרויות (`src/screens/auth/SignInScreen.tsx:188-271`), ומסך אחד אחרי ההתחברות — `'בוא נכיר'` — שמבקש שם ותמונה בלבד (`src/screens/onboarding/PostSignInOnboardingScreen.tsx:150-196`). השם מגיע כבר מלא מחשבון Google (`:44`), אז לרוב אין אפילו הקלדה. `ProfileSetupScreen` כמעט אף פעם לא נראה, כי `isProfileComplete` בודק רק שם (`src/store/userStore.ts:243-246`) והשם כבר נשמר. אין שאלות על עמדה, אין מספר חולצה, אין סקר העדפות. ההערה בקוד מעידה שזה נעשה בכוונה: *"The previous flow had three intermediate screens … Now it's one screen"* (`PostSignInOnboardingScreen.tsx:1-7`). זו החלטה מצוינת ואסור לגעת בה.

**חצי שני — מהחשבון ועד "אני רשום": כאן הכול דולף.**
האדם נוחת על טאב `'בית'` (`src/navigation/MainTabs.tsx:91`). במסך הזה, עבור חשבון בלי מועדון, **אין אף מחזור**. לא מחזור אחד. הסלוט המרכזי מחזיר `null` (`src/screens/tabs/ProfileScreen.tsx:1228-1259`), והמסך מציע במקום זאת אחת-עשרה נקודות מגע שכולן מובילות להגדרות, לבקשות ולהמתנה.

זה הפער שאני מתאר להלן: **האפליקציה בנויה לפתוח חשבון מהר ולהגיע למגרש לאט.** תשע נקודות, כולן מאומתות בקוד, אחת מהן שבח.

---

## הטיעון המרכזי: מסך הבית מסתיר נתונים שכבר יש לו

זו לא מטאפורה. `ProfileScreen` מריץ שישה שאילתות בפוקוס, ו**אף אחת מהן איננה `getOpenGames`** — חיפוש בקובץ מחזיר רק `getCommunityGames` (`ProfileScreen.tsx:360`), שחסומה מראש כשאין מועדון (`:344-372`). אותה `getOpenGames`, בטאב המחזורים, מחזירה כל מחזור ציבורי פתוח בעתיד בלי שום סינון נוסף (`src/services/gameService.ts:2547-2554`). כלומר: אם קיים בישראל מחזור ציבורי פתוח הערב, טאב המחזורים יראה אותו, ומסך הבית — שהוא המסך היחיד שהמשתמש החדש רואה כברירת מחדל — לא יידע עליו.

ומעל זה, הכרטיס שנכתב בדיוק לרגע הזה **לא ניתן להגעה**: `HomeNextGameCard` מכיל מצב ריק מלא עם `'אין לך מחזור קרוב'`, `'מצא מחזור פתוח או פתח מחזור חדש'` וכפתור `'מצא מחזור'` (`src/components/home/HomeNextGameCard.tsx:42-61`), אבל הקורא היחיד שלו בקוד נמצא בתוך `nextGame ? …` (`ProfileScreen.tsx:1230`) — כך ש-`game` לעולם אינו `null` כשהרכיב עולה. מישהו כתב את הפתרון וקבר אותו מאחורי תנאי.

## הטיעון השני: ההנחיה הראשונה מפנה למסלול האיטי ביותר משלושה

מהבית יש שלושה מסלולים אמיתיים: **מחזור ציבורי פתוח** (2 הקשות, מיידי), **יצירת מחזור מהיר** (6 הקשות, מיידי, אבל אין יריב), ו**הצטרפות למועדון** (2 הקשות ואז המתנה בלתי-מוגבלת לאדם אחר). ההודעה היחידה שהאפליקציה אומרת למשתמש חדש — `'הגיע הזמן למצוא את החבר׳ה שלך ⚽'` עם כפתור `'גלה מועדונים'` (`src/utils/assistant/rules.ts:704-717`) — מפנה לשלישי.

וזה גרוע משנשמע, כי **מועדון נוצר סגור כברירת מחדל**: `isOpen: false` ב-`EMPTY_GROUP_FORM_VALUES` (`src/screens/groups/GroupWizardForm.tsx:83`). לכן רוב הכרטיסים בפיד מציגים `'בקש להצטרף'` ולא `'הצטרף'` (`src/utils/clubCard.ts:122-128`), והאדם נכנס להמתנה. ההמתנה הזו **לא מופיעה בשום תיבה באפליקציה**: `getInboxRequests` בנוי משלושה מקורות שכולם נכנסים ואדמיניים — `listIncomingRequests`, `myAdminGroupsWithPending`, `myGamesWithPending` (`src/services/requestsService.ts:72-97`) — בעוד המסך שלו כותב `'בקשות חברות, הצטרפות למועדונים ולמחזורים יופיעו כאן.'` (`src/i18n/he.ts:1669`). ההבטחה הזו לא מתקיימת עבור הבקשות שהמשתמש עצמו שלח.

## הטיעון השלישי: הפעולה הכי מקודמת היא זו שאין לה תמורה הערב

ספרתי כמה פעמים אפליקציה מבקשת ממשתמש חדש לסמן זמינות לפני שהוא ראה מחזור אחד: **ארבע**. אריח בבית (`ProfileScreen.tsx:1313`), כרטיס מלא-רוחב `'רוצה לראות מי פנוי לשחק לידך?'` (`:1358`), שורה ברשימת `'בוא נתחיל'` (`:660`), ומודאל חוסם בכניסה הראשונה לטאב המחזורים (`src/screens/games/GamesListScreen.tsx:118-132`).

הקופי עצמו מודה שהתמורה עתידית: `'ונציע לך אוטומטית מחזורים שמתאימים בדיוק לזמן שלך'` ו-`'מנהלים יראו שאתה פנוי ויזמינו אותך'` (`src/i18n/he.ts:3081-3083`). המסך שנפתח הוא רשת 7×3, מתג מיקום, חיפוש עיר, רדיוס ושמירה (`src/screens/profile/AvailabilityEditScreen.tsx:345-600`). זו עבודה של דקה-שתיים שמניבה **אפס מחזורים היום**. היא צריכה לבוא אחרי ההרשמה הראשונה, לא לפניה — ובוודאי לא כמודאל שנפתח *מעל* הרשימה.

---

## מה הייתי מתקן קודם, לפי יחס תועלת-למאמץ

1. **המודאל בטאב המחזורים** (`GamesListScreen.tsx:121-132`) — שינוי של שורת תנאי אחת, מסיר חסימה מהמסך היחיד שמכיל מחזורים.
2. **הסלוט הריק בבית** (`ProfileScreen.tsx:1228`) — הרכיב והטקסטים כבר קיימים וכתובים.
3. **`getOpenGames` במסך הבית** — הרחבה אמיתית, אבל היא ההבדל בין "בית ריק" ל"בית שמראה מחזור הערב".
4. **`'אתה רשום למחזור'` במצב ממתין** (`MatchDetailsScreen.tsx:333`) — שורה אחת, מונע מאדם להפסיק לחפש.

ואת מה שלא לגעת בו: ההרשמה בשתי הקשות מהכרטיס בפיד, והכניסה בת ארבע ההקשות לחשבון. שני אלה כבר עושים בדיוק את מה שהעדשה הזו מבקשת.

---


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

---


### מכניקת המרה — חיכוך, בהירות ה־CTA, ומה קורה למבקר שלא נמצא על המכשיר הנכון

## המסקנה בשורה אחת

מערך הדפים של Teamder בנוי היטב — RTL תקין ב־390px, מטא־תגיות מוזרקות בצד השרת, ייחוס התקנות, ביקון קליקים. אבל **הצינור עצמו שבור בשלוש נקודות שונות, וכל אחת מהן חותכת קהל שלם**: מי שמגיע לדומיין הראשי לא מקבל קישור לחנות בכלל; מי שכבר מותקן אצלו האפליקציה נשלח לחנות; ומי שפותח דף מועדון מאייפון מקבל שגיאת Safari לפני שקרא מילה.

הבדיקות נעשו מול הקוד בריפו **וגם מול הפרודקשן החי** (`curl`, ו־lookup של App Store).

---

### 1. דף הבית מוכר בטא סגורה למוצר שחי בשתי החנויות כבר שלושה חודשים וחצי

זו הסתירה החדה ביותר בכל המערך, ולא צריך שום פרשנות כדי לראות אותה:

```
$ grep -c "play.google.com" public/index.html   →  0
$ grep -c "apps.apple.com"  public/index.html   →  0
$ curl -s https://teamderfc.web.app/ | grep -c "play.google.com"  →  0
```

```
$ curl -s "https://itunes.apple.com/lookup?id=6775178022"
  resultCount 1 · Teamder · 1.1.7 · releaseDate 2026-06-02
```

האפליקציה ציבורית ב־App Store מ־2 ביוני 2026 וב־Google Play. ובכל זאת, הדרך היחידה קדימה מהדומיין הראשי היא `בטא פתוחה · מקומות מוגבלים` (`index.html:556`), ובקשה לשלוח מייל בוואטסאפ למספר טלפון פרטי:

> `שלחו לי את כתובת המייל שלכם (זו שמחוברת לחשבון Google של המכשיר). אוסיף אתכם לרשימת הבודקים ותקבלו קישור להורדה.`

שלוש בעיות נפרדות נערמות כאן. הראשונה: המסלול היחיד שמוצע הוא מנגנון של Play closed test — **לבעל אייפון אין כאן שום מסלול**, והוא נשלח לשלוח כתובת Gmail שלא תעזור לו. השנייה: הכותרת של סעיף "איך זה עובד" מבטיחה `מהורדה למשחק — שלוש דקות` (`:530`) — הבטחה להורדה בדף שלא מציע הורדה. השלישית: הרישום `מקומות מוגבלים` הוא מסר הפוך לחלוטין — הוא אומר למבקר שהמוצר עוד לא באמת זמין לו.

נוסיף לזה שב־≤640px `‎.nav-links { display: none; }` (`:390`) מסתיר את כל הניווט, כך שבטלפון הפס העליון הוא לוגו בלבד בלי שום CTA, ושני כפתורי ה־hero הם עוגנים פנימיים (`href="#beta"`, `href="#features"`) — **שום דבר במסך הראשון לא עוזב את הדף**. הדף כולו 4,315px בטלפון.

### 2. כל קישור שיתוף שהאפליקציה מייצרת אינו רשום כ־app link

`src/services/inviteLinkService.ts:58` מחזיר `https://teamderfc.web.app/i/{code}` — זו הצורה של **כל** שיתוף במוצר (פרופיל, חברים, פרטי משחק, מועדון, onboarding). אבל:

```
public/.well-known/apple-app-site-association → paths: ["/session/*", "/team/*", "/app"]
app.json intentFilters → pathPrefix: /session, /team, /app
```

`/i/*` לא מופיע באף אחד מהם. התוצאה: מי שכבר מותקן אצלו Teamder ולוחץ על קישור של חבר **תמיד נוחת בדפדפן**, אף פעם לא באפליקציה.

ומכאן זה מחמיר. ב־iOS, `primary()` (`invite.html:231`) לא מנסה בכלל את הסכמה ושולח ישירות לחנות. ההערה בקוד מסבירה למה — ובצדק — אבל התוצאה היא שמשתמש אייפון **שהאפליקציה כבר אצלו** נשלח לדף App Store של אפליקציה שמותקנת לו. מנגנון ההצלה דרך הלוח מת גם הוא במקרה הזה: `src/services/clipboardInviteService.ts:42` נחסם על ידי `footy.clipboardInvite.consumed`, דגל AsyncStorage קבוע (`src/services/storage.ts:36`) שנצרב פעם אחת בהתקנה הראשונה ולא נפתח שוב לעולם.

בנוסף, `parseInviteUrl` (`src/services/deepLinkService.ts:103-194`) מטפל ב־`/session/*`, `/team/*`, `/app`, `/go` — ואין לו ענף `/i/`, כך שקישור קצר שהודבק ידנית לא ניתן לשחזור.

### 3. דף המועדון יורה `footy://` על כל אייפון — והקוד עצמו יודע שזו טעות

`public/c/index.html:1058-1062` מריץ, בטעינה, על כל מבקר מובייל שאינו Chrome/Android:

```js
// Other browsers: assign the custom scheme. If the app is
// there the OS hijacks navigation; otherwise the assign is
// a silent no-op and the user sees the showcase.
location.href = deepLink();          // footy://team/{id}
```

ההנחה ש"זה no-op שקט" סותרת ישירות את מה שכתוב בקובץ אחר באותו ריפו, `public/invite.html:231`:

> `iOS Safari throws a visible "cannot open page" error for an unhandled custom scheme (footy://) when the app isn't installed — and an invite recipient never has it yet.`

שני הקבצים מחזיקים אמונות סותרות לגבי אותה התנהגות של iOS, ואחד מהם טועה. הדף שטועה הוא בדיוק הדף עם התוכן — סטטיסטיקות, פודיום, משחקים אחרונים — כלומר הנכס השיווקי הכי חזק במערך.

### 4. מבקר דסקטופ מקבל שגיאת פרוטוקול ואז דף Google Play

ב־`invite.html:231` יש בדיקת `isIOS` בלבד. אין ענף דסקטופ. מבקר ב־Windows או ב־Mac נופל למסלול Android: `track('landing_app_open_attempt')` → `location.href = 'footy://...'` → ואחרי 1500ms `location.href = storeHref`, שהוא דף Google Play.

בישראל וואטסאפ ווב הוא ברירת מחדל במקומות עבודה. מבקר דסקטופ אינו מקרה קצה כאן — הוא נתח משמעותי מכל קישור שמפורסם בקבוצה.

### 5. הדף הטוב ביותר במערך הוא יתום

`public/get.html` עושה בדיוק את הדבר הנכון: ניתוב לפי פלטפורמה בלי אף הקשה, זיהוי iPadOS שמדווח כ־Mac (`:56`), והצגה של שני הכפתורים בדסקטופ. זה הדף היחיד במערך שמטפל נכון בכל שלוש הפלטפורמות.

```
$ grep -rn 'web.app/get\|"/get"' public/ src/ functions/src/
public/get.html:6:  ... Domain: teamderfc.web.app/get     ← ההערה של עצמו, וזהו
```

שום דף, שום שירות, שום כפתור לא מקשר אליו. הוא נגיש רק אם מדביקים את הכתובת ביד.

### 6. צ'יפ הדחיפות שובר עברית בדיוק ברגע הכי ממיר

`invite.html:246`:

```js
tg.push({txt: d.availableSpots + ' מקומות פנויים', cls:'free'})
```

כשנשאר מקום אחד זה מרנדר `1 מקומות פנויים`. וכש־`availableSpots` הוא 0 התנאי `> 0` מפיל את הצ'יפ לגמרי, כך שמשחק מלא ומשחק שלא נטען נראים זהים.

האפליקציה עצמה כבר פתרה את זה נכון, `src/i18n/he.ts:2025`:

```ts
homeSpotsLeft: (n) => n === 0 ? '0 מקומות פנויים'
                    : n === 1 ? 'מקום פנוי אחד'
                    : `${n} מקומות פנויים`
```

אותה תקלה חוזרת בדף המועדון: `1 משחקים` (`c/index.html:1228, 1242, 1301`), `1 שחקנים` (`:1264`), למרות ש־`he.ts:1574` עושה `n === 1 ? 'שחקן אחד' : ...`. הדפים פשוט לא מיישמים את התקן שלמוצר כבר יש.

### 7. קישור מת בפוטר של הדף שכל מוזמן רואה

`invite.html:191` מקשר ל־`/terms.html`. אין קובץ כזה בריפו, ובפרודקשן:

```
$ curl -o /dev/null -w "%{http_code}" https://teamderfc.web.app/terms.html   → 404
$ curl -o /dev/null -w "%{http_code}" https://teamderfc.web.app/terms        → 404
```

### 8. מה שעובד נכון ואסור לגעת בו

`invite.html:246` — כשקוד הזמנה מצביע על משחק שכבר הסתיים או בוטל, הדף לא מציג שגיאה. הוא בודק אם למשחק יש `communityId`, ואם כן מסיט בשקט את כל הדף להזמנה למועדון האם: משנה עותק, מושך עיר ומספר חברים, ומעדכן גם את ה־referrer להתקנה דרך `retarget()` (`:223-226`). קישור מת הופך להזמנה חיה, והייחוס נשמר. זו מכניקת המרה מהסוג הנכון וכדאי להרחיב אותה — לא לשנות אותה.

---

## סדר הטיפול המומלץ

| # | מה | מאמץ |
|---|---|---|
| 1 | להחליף את סעיף הבטא ב־`index.html` בשני כפתורי חנות | קטן |
| 2 | להוסיף `/i/*` ל־AASA ול־`app.json` | קטן |
| 3 | להסיר את ה־auto deep-link מ־`c/index.html` ב־iOS | טריוויאלי |
| 4 | ענף דסקטופ ב־`primary()` | קטן |
| 5 | להפנות כל CTA להורדה ל־`/get` | טריוויאלי |
| 6 | פונקציית ריבוי בשני דפי הווב | טריוויאלי |
| 7 | ליצור `terms.html` או להסיר את הקישור | טריוויאלי |

---


# Part 7 · Everything the readers flagged, in one table

**72** observations: 27 high, 31 medium, 14 low. Severity is each
reader's judgement of cost to a new user, not a bug priority — several "high" rows work exactly as
designed and are flagged because the design costs something.

| # | Sev | Where | Observation | Cost to a new user | Suggested change | Effort |
|--:|:--:|---|---|---|---|:--:|

| 1 | high | / (דף הבית) — public/index.html:426-434, 553-579 | אפס קישורים לחנויות בכל הקובץ: `grep -c "play.google.com" public/index.html` → 0, וכך גם `apps.apple.com`; אומת גם מול הפרודקשן ב-curl. ה-CTA הראשי הוא `הצטרפו כבודקי בטא` (:430) שהוא עוגן פנימי ל-`#beta`, שם מופיע `בטא פתוחה · מקומות מוגבלים` (:556) והבקשה `שלחו לי את כתובת המייל שלכם (זו שמחוברת ל | בעל אייפון בתל אביב שומע על Teamder מחבר, מחפש בגוגל, נוחת ב-teamderfc.web.app, גולל 4,315 פיקסלים של פיצ'רים — וההצעה היחידה בסוף היא לשלוח בוואטסאפ למספר טלפון פרטי את כתובת ה-Gmail של המכשיר שלו, מנגנון של Play closed test שאין לו שום מקבילה ב-iOS. הוא סוגר את הדף בלי להבין שהאפליקציה מחכה לו ב-A | ב-public/index.html: להחליף את שני כפתורי ה-hero (:426-434) בשני כפתורי חנות אמיתיים, ולמחוק את כל סעיף `beta` (:553-579) או להמיר אותו לשורת הורדה. הדרך הקצרה ביותר — להפנות את ה-CTA הראשי ל-`/get`, שכבר מנתב נכון לפי פלטפורמה. בנוסף להוסיף כפתור הורדה לפס העליון כך שיישרד את `.nav-links { display: | small |
| 2 | high | / — the root landing page hero. /Users/matan/Projects/soccer/public/in | `grep -o 'src="[^"]*"' public/index.html \| sort -u` returns exactly two results: `/logo2.png` and `/js/joryio.js`. There is no app screenshot, no phone mock, no product imagery of any kind on the 4,315px page — six feature cards describe the app in prose next to generic stroke icons. Meanwhile `pub | A woman organising her workplace's Thursday five-a-side opens the page on her phone during a break. She has thirty seconds and three competing apps open in other tabs. She can read that Teamder does registration and live team-picking, but she cannot see whether the registration screen is one tap or  | Copy the `.heroPhone` / `.phone` / `.notch` / `.screen` markup and CSS from public/invite.html:167 into the public/index.html hero (:414-443), pointing the `<img>` at the existing, currently orphaned `/app-preview.png`. If a second image is wanted for the how-it-works section, `/shot-games.jpg` and  | small |
| 3 | high | / — the root landing page. /Users/matan/Projects/soccer/public/index.h | The only conversion path on the entire page is `בטא פתוחה · מקומות מוגבלים` (:556) followed by `שלחו לי את כתובת המייל שלכם (זו שמחוברת לחשבון Google של המכשיר). אוסיף אתכם לרשימת הבודקים ותקבלו קישור להורדה.` (:559-560), with a primary button to `wa.me/972546986121` and a fallback to `mailto:studio | A man sees Teamder mentioned in a neighbourhood Facebook group, types the name into Google on Saturday night, and reaches this page. He is told places are limited, asked to WhatsApp a private Israeli mobile number, and asked to hand over the Google account email tied to his phone — the exact shape o | In public/index.html, delete the beta section (:553-579) and replace it with the two working store cards already written in public/invite.html:187-188. Change the hero primary CTA at :426-430 from `href="#beta"` / `הצטרפו כבודקי בטא` to `href="/get"` / `הורידו את Teamder` (get.html already UA-sniffs | small |
| 4 | high | /Users/matan/Projects/soccer/public/privacy.html:235, :251, :274 — מול | עדכון אחרון: `29 במאי 2026`. שורה 251: `פרטי חשבון: שם וכתובת אימייל — מתקבלים אוטומטית מ-Google בעת התחברות עם Google Sign-In.` — בפועל המסך מציע גם Apple, גם מייל וסיסמה וגם אורח. שורה 274: `ב־iOS נבקש את האישור הזה דרך חלון App Tracking Transparency (ATT) של אפל בעת ההפעלה הראשונה` — grep על app. | משתמש זהיר שנרשם עם מייל וסיסמה (דווקא כי הוא לא רצה לתת לנו את חשבון הגוגל שלו) פותח את מדיניות הפרטיות ומוצא מסמך שמתאר רק התחברות דרך Google — כלומר לא כתוב בשום מקום מה קורה לכתובת שהוא בדיוק הקליד. ומשתמש iOS שקרא שיישאל על מעקב "בעת ההפעלה הראשונה" ולא נשאל, מסיק אחד משניים: או שעוקבים אחריו ב | לעדכן את public/privacy.html: (א) לפצל את סעיף 2.1 לארבעת מסלולי ההתחברות שקיימים ב-SignInScreen.tsx:173-275; (ב) להסיר את משפט ה-ATT בשורה 274 עד שהחלון באמת ימומש, או לממש אותו; (ג) להוסיף סעיף על Joryio תחת "שיתוף עם צד שלישי" שמפרט בדיוק את ארבעת השדות שנשלחים ב-auth.ts:468-471 ו-joryio.ts:146-1 | medium |
| 5 | high | /c/{groupId} (דף תצוגת המועדון) — public/c/index.html:1058-1062 | בטעינת הדף, לכל מבקר מובייל שאינו Chrome/Android, מורץ `location.href = deepLink()` כלומר `footy://team/{id}` (:1015-1017, :1058-1062). ההערה מעליו טוענת: `otherwise the assign is a silent no-op and the user sees the showcase`. זה סותר ישירות את ההערה ב-public/invite.html:231 באותו ריפו: `iOS Safari | מנהל מועדון משתף בפייסבוק את עמוד המועדון שלו כדי למשוך שחקנים חדשים. גולש אייפון בלי האפליקציה פותח את הקישור ב-Safari, ולפני שהדף מספיק לצייר את הסטטיסטיקות והפודיום קופצת לו הודעת שגיאה של Safari על כתובת לא תקינה. הוא סוגר. הדף היחיד במערך שיש בו תוכן אמיתי לשכנע בו — כמה משחקים נערכו, מי הכי נא | ב-public/c/index.html:1058-1062 להסיר את ענף ה-else עבור iOS: לשמור את ה-`intent://` ל-Chrome/Android, ולתת למבקרי iOS פשוט לראות את הדף. ההסטה לאפליקציה תישאר זמינה דרך כפתור `פתח באפליקציה` (:772) שהמשתמש לוחץ ביוזמתו — לחיצה מפורשת היא הקשר שבו שגיאת הסכמה סבירה, טעינת דף היא לא. | trivial |
| 6 | high | /c/{id} — the community showcase. /Users/matan/Projects/soccer/public/ | The markup renders `<div class="ad-slot" id="adSlot"><span>מקום שמור למודעה</span></div>`, styled at :588-601 as a dashed grey box 90px tall. Grep confirms `adSlot` appears exactly once in the file — the id is never referenced by any JavaScript, so the `.ad-slot.hidden` class defined at :603 is neve | An organiser proudly WhatsApps his club's page to a player he is trying to recruit. The player scrolls past the attendance podium and hits a dashed grey rectangle that reads, in Hebrew, "space reserved for an advert." He now knows two things the organiser did not intend to tell him: the page is a te | In public/c/index.html, delete lines 909-914 (the comment, container and ad-slot div). If the slot is wanted for a future AdSense unit, change :911 to `<div class="ad-slot hidden" id="adSlot">` so the existing :603 rule hides it until real markup is injected — but do not leave the Hebrew placeholder | trivial |
| 7 | high | public/.well-known/apple-app-site-association (paths), app.json:61-77  | כל ששת נקודות השיתוף באפליקציה עוברות דרך createShortInviteUrl ומחזירות `https://teamderfc.web.app/i/<code>` (inviteLinkService.ts:57). אבל ה-AASA מצהיר רק על `"paths": ["/session/*", "/team/*", "/app"]`, ה-intentFilters ב-app.json מצהירים רק על אותם שלושה pathPrefix, ו-parseInviteUrl מזהה רק `segme | המארגן מפרסם בחמישי ב-22:00 את הקישור למחזור בקבוצת הוואטסאפ. תשעה מאחד-עשר הקבועים כבר עם Teamder על הטלפון. אצל כולם, בלי יוצא מן הכלל, הקישור לא פותח את האפליקציה — הוא פותח דף אינטרנט שעליו כתוב `פתח את המשחק`, ומשם הם צריכים ללחוץ שוב. מי שכבר משלם לך בנאמנות עובר את הדרך הארוכה ביותר. | שלוש נגיעות: (1) להוסיף `"/i/*"` (וגם `"/go"`) למערך paths ב-public/.well-known/apple-app-site-association; (2) להוסיף שני intentFilter מקבילים עם pathPrefix `/i` ו-`/go` ב-app.json:61-77; (3) להוסיף ב-src/services/deepLinkService.ts, ליד בדיקת `segments[0] === 'app' \|\| segments[0] === 'go'`, ענף  | medium |
| 8 | high | public/index.html:426-431 ו-553-576; public/c/index.html:793 | בכל public/index.html אין ולו קישור אחד ל-Google Play או ל-App Store. שלוש הקריאות לפעולה היחידות הן `הצטרפו כבודקי בטא` (עוגן ל-#beta), `שלחו את המייל בוואטסאפ` (wa.me למספר הפרטי) ו-`או שליחה במייל` (mailto). הטקסט: `בטא פתוחה · מקומות מוגבלים` / `שלחו לי את כתובת המייל שלכם (זו שמחוברת לחשבון Goo | מישהו שמע על Teamder מחבר בעבודה, הקליד את השם בגוגל בדרך הביתה והגיע לדומיין. האפליקציה חיה בשתי החנויות בגרסה 1.1.10, והדף מבקש ממנו לשלוח וואטסאפ עם כתובת המייל שמחוברת לחשבון הגוגל של המכשיר — בקשה שנשמעת, למי שלא מכיר Play Internal Testing, כמו הונאה. הוא סוגר את הדף. לא נשארה לו שום דרך להוריד | להחליף את סקשן #beta ב-public/index.html:553-576 בשני כפתורי חנות (אותם שני ה-href שכבר יושבים ב-public/get.html:52-53), ולשנות את שני ה-`href="#beta"` בשורות 408 ו-426 ל-`/get`. במקביל, לשנות את `public/c/index.html:793` מ-`href="/"` ל-`href="/get"` כדי שמצב שגיאה לא יזרוק אנשים אל קיר. | small |
| 9 | high | public/invite.html:231 (primary) | `function primary(){...if(isIOS){...location.href='https://apps.apple.com/app/id6775178022';return;}` — בענף ה-iOS אין ניסיון deep link בכלל, לא ל-footy:// ולא לקישור ה-https. ההערה בקוד מסבירה למה נזנח ה-footy:// (ספארי מציג שגיאה), אבל התוצאה היא שכפתור שכתוב עליו `פתח את המשחק` מוביל תמיד ל-App S | לשחקן יש Teamder על האייפון מאתמול. הוא לוחץ על הקישור למחזור, מגיע לדף שכתוב בו `הוזמנת למשחק כדורגל` ולוחץ `פתח את המשחק` — ונזרק לחנות האפליקציות, שמציגה לו את הכפתור `פתח`. הוא לוחץ עליו, Teamder נפתח על מסך הבית, והמחזור שבגללו לחץ מלכתחילה לא נמצא בשום מקום. הוא צריך לחפש אותו לבד או לחזור לוו | ב-public/invite.html:231, בענף ה-iOS ולפני ההפניה לחנות: לנווט קודם אל `clipUrl()` (קישור https, לא סכמה — ספארי לא מציג עליו שגיאה) ולהעמיד fallback של ~1200ms ל-App Store, בדיוק כמו בענף אנדרואיד. זה עובד רק אחרי שהממצא הקודם מבוצע ו-`/i/*` נכנס ל-AASA — לכן לבצע את השניים יחד. | small |
| 10 | high | public/invite.html:231 מול public/c/index.html:1046-1057 | `location.href=url` כאשר `url = 'footy://session/<id>'`, ואחריו `setTimeout(function(){if(!op){op=true;location.href=store;}},1500)`. בדפדפן הפנימי של וואטסאפ (WebView) סכמה לא מוכרת מציגה ERR_UNKNOWN_URL_SCHEME. באותו ריפו, `public/c/index.html:1046-1057` כבר משתמש בדפוס הנכון: `'intent://team/'+id | שחקן לוחץ על `הצטרף למשחק` בתוך וואטסאפ, ומקבל מסך שגיאה לבן באנגלית. הוא לא יודע שאם יחכה שנייה וחצי הוא יגיע לחנות — הוא מניח שהקישור שבור, לוחץ חזור, וכותב בקבוצה 'הקישור לא עובד'. במקרה הגרוע ה-WebView מחליף את הדף בשגיאה, הטיימר של 1.5 שניות מת יחד עם ההקשר, והוא לא מגיע לחנות לעולם. | ב-public/invite.html:231, להחליף בענף אנדרואיד את `location.href=url` + הטיימר בבניית intent:// זהה לזו שב-public/c/index.html:1046-1057, כאשר `S.browser_fallback_url` הוא `storeHref` (כולל ה-referrer שכבר נבנה בשורה 229) במקום הדף עצמו. זה מבטל את השגיאה ואת ההמתנה בבת אחת. | small |
| 11 | high | src/navigation/RootNavigator.tsx:65 ו-271; src/services/userService.ts | מסך ההתחברות מציע `המשך כאורח` (he.ts: signInGuest). buildGuestUser מייצר משתמש עם `name: ''`, ולכן `isProfileComplete()` — שבודק `u.name.trim().length > 0` — מחזיר false לאורח לנצח. הניתוב עצמו פוטר את האורח מהשערים (`if (!isGuest && !profileComplete)` בשורה 271), אבל צרכן ההזמנה בשורה 65 לא פוטר א | שחקן חדש קיבל קישור למחזור, התקין, ובמסך ההתחברות בחר `המשך כאורח` — בדיוק כי הוא רצה רק להציץ אם יש מקום פנוי לפני שהוא פותח חשבון. הוא נוחת על מסך בית ריק עם `אין לך עדיין מחזורים`. המחזור שהזמינו אותו אליו לא מופיע, ואין שום רמז שהוא קיים. האפשרות שנועדה להוריד חיכוך היא בדיוק זו שמאבדת אותו. | ב-src/navigation/RootNavigator.tsx:65 להחליף את התנאי ב-`if (!currentUser \|\| !hasCompletedOnboarding) return;` ולהוסיף `const isGuest = currentUser.isGuest === true;` עם דילוג על בדיקת profileComplete כשהוא true — buildGuestUser כבר מסמן `onboardingCompleted: true`, כך שאורח ינווט למחזור וייתקל בב | small |
| 12 | high | דף הבית של האתר החי — https://teamderfc.web.app/ , /Users/matan/Projec | מתחת לתג `בטא פתוחה · מקומות מוגבלים` כתוב: `שלחו לי את כתובת המייל שלכם (זו שמחוברת לחשבון Google של המכשיר). אוסיף אתכם לרשימת הבודקים ותקבלו קישור להורדה.` הכפתור הראשי הוא `שלחו את המייל בוואטסאפ` ומוביל ל-wa.me/972546986121. אין בדף שום קישור לחנויות. לשם השוואה, public/invite.html מציג `הורד א | מארגן ששמע על Teamder בקבוצת וואטסאפ, הקליד את השם בגוגל והגיע לדף הבית, מתבקש לשלוח הודעת וואטסאפ עם המייל האישי שלו למספר של אדם פרטי — כלומר לחשוף גם את המייל וגם את מספר הטלפון שלו — כדי לקבל "קישור להורדה" לאפליקציה שממילא חינמית ופתוחה בשתי החנויות. אדם זהיר סוגר את הטאב; אדם פחות זהיר שולח, מ | להחליף את הסקשן `#beta` ב-public/index.html:550-575 בשני כפתורי חנות — אותם קישורים שכבר קיימים ב-public/invite.html — ולהסיר את התג `בטא פתוחה · מקומות מוגבלים` בשורה 556 ואת הכפתור הראשי `הצטרפו כבודקי בטא` בשורה 426-431 (להחליף ל"הורידו את האפליקציה"). אם רוצים לשמר ערוץ קשר, להשאיר את הוואטסאפ ב | small |
| 13 | high | טאב 'מחזורים' — src/screens/games/GamesListScreen.tsx:118-132 ו-1101-1 | ה-effect רץ בעלייה הראשונה של המסך: אם למשתמש אין `preferredDays` ולא הוצג לו המודאל ב-3 הימים האחרונים, `setAvailNudge(true)` נקרא לפני שהרשימה נצבעת. AvailabilityNudgeModal מציג `availNudgeTitle: 'מתי בא לך לשחק?'`, `availNudgeBody: 'סמן את הימים שאתה פנוי לשחק — ונציע לך אוטומטית מחזורים שמתאימים | רן לחץ באריח 'הצטרף למחזור' בבית. הכוונה שלו מפורשת: להסתכל אם יש משחק. במקום הרשימה נפתח עליו חלון ששואל באילו ימים בשבוע הוא פנוי — שאלה על החודש הבא, ברגע שבו הוא שאל על הערב. אם ילחץ 'סמן את הימים שלי' הוא ינווט למסך אחר לגמרי (רשת 7×3, עיר, רדיוס) ויחזור, אם יחזור, אחרי דקה וחצי. אם ילחץ 'אחר כ | ב-src/screens/games/GamesListScreen.tsx:121-132 להוסיף לתנאי דרישה שהרשימה כבר נטענה ושאין בה מה להציע — למשל להזיז את `setAvailNudge(true)` ל-effect שתלוי ב-`!loading && isEmpty` (שני המשתנים כבר קיימים בקובץ, :578, :890), כך שהמודאל ייפתח רק כשבאמת אין מחזורים להראות. לחלופין להתנות אותו ב-flag חד | small |
| 14 | high | כל מסלול ההרשמה — src/navigation/RootNavigator.tsx:65 (תנאי הצריכה) מו | היעד של ההזמנה נצרך רק אחרי `if (!currentUser \|\| !profileComplete \|\| !hasCompletedOnboarding) return;` (RootNavigator.tsx:65). כלומר המוזמן עובר את כל שלוש השקופיות, את ההתחברות ואת "בוא נכיר" בלי שאף מחרוזת תזכיר את המועדון או את המשחק שהוא לחץ עליהם. קראתי את הצרכן במלואו (RootNavigator.tsx:80 | 22:10 בלילה. הוא לחץ על הקישור של המארגן, הוריד אפליקציה, וקיבל שלוש שקופיות על למצוא זרים באזור. אין שום סימן שהקישור עבד. הוא לא יודע אם הוא נמצא בתהליך הצטרפות לקבוצה של החברים שלו או פתח אפליקציה גנרית מאפס, ולכן הוא חוזר לוואטסאפ לשאול "זה הקישור הנכון? לא רואה כלום" — וזה בדיוק הרגע שבו מארגני | להעביר קריאה ל-`storage.getPendingInvite()` למעלה ב-`src/navigation/RootNavigator.tsx` (לפני גייט `!onboardingDone` בשורה 253), ולהזרים את שם המועדון כ-prop ל-`OnboardingScreen`. כשהוא קיים — להחליף את השקופית הראשונה בכרטיס יחיד: כותרת חדשה ב-he.ts בנוסח 'הוזמנת ל{שם המועדון}' וגוף 'עוד שתי דקות וא | medium |
| 15 | high | כל מסלול הפתיחה — /Users/matan/Projects/soccer/src/services/onboarding | קיים אשף פתיחה מלא — תפקיד, הצטרפות למועדון בקוד או פתיחת מועדון חדש, ואז שיתוף לינק — אבל הוא חי כמסמך HTML של קמפיין Joryio, ומטופל ב־`onboardingService.submit()` (שורות 71-115, כולל `groupService.createGroup` ו־`requestJoinByCode`). שום שער ב־RootNavigator לא מכיר אותו, שום דבר במסלול לא מפעיל או | דני הוא מארגן. הוא הוריד את האפליקציה כדי לארגן את המחזור של יום שלישי לחבר'ה שלו — 14 אנשים שכבר יש לו בוואטסאפ. הפתיחה שואלת אותו רק איך קוראים לו ואיזה אווטאר הוא רוצה, ואז מניחה אותו בבית מול רשימה של חמש מטלות שבה 'הצטרף או פתח מועדון' הוא פריט מספר שלוש, שווה במשקל ל'סמן מתי אתה פנוי'. המשימה  | להוסיף שאלה אחת למסך שכבר קיים, לא מסך חדש: ב־/Users/matan/Projects/soccer/src/screens/onboarding/PostSignInOnboardingScreen.tsx, מתחת לשדה השם (אחרי שורה 172), שתי צ'יפים — 'אני מארגן' / 'אני בא לשחק' — שקוראים ל־`recordRole()` שכבר קיים ב־src/services/roleService.ts:23. להעביר את הערך ל־MainTabs ו | large |
| 16 | high | כל קישור הזמנה — src/services/inviteLinkService.ts:58, public/.well-kn | `inviteLinkService.ts:58` מחזיר `https://teamderfc.web.app/i/{code}` והוא נקרא מ-ProfileScreen, FriendsScreen, MatchDetailsScreen, CommunityDetailsScreen ו-onboardingService — זו צורת כל שיתוף במוצר. אבל ה-AASA רושם `["/session/*", "/team/*", "/app"]` בלבד, ו-intentFilters ב-app.json רושם pathPrefix | המארגן מפרסם בקבוצת הוואטסאפ של המועדון בשעה 20:00 את הקישור למשחק של חמישי. חבר קבוע עם אייפון, שהאפליקציה מותקנת אצלו כבר חודשים, לוחץ — ונוחת בדפדפן. הוא קורא `הוזמנת למשחק כדורגל`, לוחץ `פתח את המשחק`, ומגיע לדף App Store של אפליקציה שכבר יש לו. הוא לוחץ `פתח`, האפליקציה נפתחת בטאב הבית, והמשחק  | להוסיף `"/i/*"` למערך ה-paths ב-public/.well-known/apple-app-site-association, ולהוסיף intentFilter רביעי עם `pathPrefix: "/i"` ב-app.json; להוסיף ענף `/i/` ל-`parseInviteUrl` ב-src/services/deepLinkService.ts:103-194. עד שהבילד יוצא — לשנות את תווית הכפתור ב-iOS מ-`פתח את המשחק` ל-`הורד כדי לראות א | medium |
| 17 | high | כרטיס 'הודעה מהמאמן' בבית — src/utils/assistant/rules.ts:704-717; פיד  | עבור חשבון בלי מועדון, בלי משחקים ובלי סטטיסטיקות, הכלל היחיד שיורה הוא joinClubRule: טקסט אחד מתוך `assistantJoinClub: ['יש כדורגל מסביבך 👀', 'ברוך הבא ל-Teamder! 👋']`, תת-שורה `'הגיע הזמן למצוא את החבר׳ה שלך ⚽'` וכפתור `'גלה מועדונים'` (src/i18n/he.ts:3288-3293). מועדון נוצר סגור כברירת מחדל — `is | אבי נרשם ביום שלישי בערב. המשפט היחיד שהאפליקציה אומרת לו שולח אותו לפיד המועדונים; הוא מוצא מועדון בעירו, לוחץ 'בקש להצטרף', ומקבל 'הבקשה נשלחה'. מכאן הכול תלוי באדם זר שאולי יסתכל מחר ואולי לא. בזמן שהוא ממתין ייתכן שיש מחזור ציבורי פתוח למחרת שהוא יכול היה להצטרף אליו בשתי הקשות — האפליקציה מעולם | להוסיף ל-ctx של מנוע המאמן שדה `openPublicGamesCount` (מאותה קריאת getOpenGames מהממצא הראשון), ולרשום ב-src/utils/assistant/rules.ts כלל חדש ב-DISCOVERY **לפני** joinClubRule שיורה כאשר הספירה גדולה מאפס, עם CTA `{ kind: 'browseGames' }` (ה-action כבר נתמך ב-engagementRule, :758) וטקסט בנוסח 'יש מח | medium |
| 18 | high | מסך הבית (ProfileTab, טאב הנחיתה) — src/screens/tabs/ProfileScreen.tsx | MainTabs.tsx:91 קובע initialRouteName="ProfileTab", כך שמשתמש חדש נוחת על ProfileScreen. שם חריץ ה-hero הוא {nextGame ? ... : heroGame ? ... : null} ושני התנאים ריקים למשתמש בלי מועדון, כך שהחריץ מרנדר null. כל שבעת הבלוקים שכן מרונדרים — AssistantCard, שלושת האריחים, AvailabilityPromptCard, Onboard | בחור בן 28 שחבר שלח לו קישור, הוריד, נרשם, ומגיע למסך הבית. הוא רואה 'בוקר טוב דני, יש כדורגל מסביבך 👀' — ואז לא רואה אף כדורגל. אין שם מועדון אחד, אין תאריך אחד, אין מספר שחקנים אחד. הוא צריך לנחש שיש טאב שני שבו נמצא ההיצע האמיתי. חלק ניכר מהמשתמשים פשוט יסגרו, כי המסך הראשון שלהם הוכיח להם שהאפלי | ב-src/screens/tabs/ProfileScreen.tsx, בענף ה-null של ה-hero (שורה 1264), לרנדר את <NearbyClubsSection radiusKm={...} limit={3} minMembers={...} onOpenClub={(id)=>nav.navigate('CommunityDetailsPublic',{groupId:id})} /> — הרכיב כבר עצמאי לחלוטין (src/components/games/NearbyClubsSection.tsx), מביא את ה | small |
| 19 | high | מסך הבית (טאב 'בית') — src/screens/tabs/ProfileScreen.tsx:294-399, 122 | ל-ProfileScreen יש שישה fetch-ים ב-useFocusEffect, ואף אחד מהם אינו getOpenGames — חיפוש בקובץ מחזיר רק `gameService.getCommunityGames` (ProfileScreen.tsx:360), שחסום מראש ב-`myCommunities.length === 0 → setOpenToJoin([])` (:344-372). לעומת זאת getOpenGames בטאב המחזורים שואל `where('visibility','== | יואב הוריד את האפליקציה בשש בערב אחרי שחבר סיפר לו עליה. תוך ארבע הקשות יש לו חשבון, והוא נוחת על 'בית'. באותו רגע קיים מחזור ציבורי פתוח בעירו שמתחיל בשמונה וחסרים בו שני שחקנים — השאילתה שתחזיר אותו רצה בטאב אחר, ואף אחד לא סיפר ליואב שהטאב הזה קיים. הוא רואה 'הודעה מהמאמן', שלושה אריחים ורשימת מש | ב-src/screens/tabs/ProfileScreen.tsx להוסיף useFocusEffect שקורא ל-`gameService.getOpenGames(user.id, myCommunities.map(c=>c.id))` כאשר `myCommunities.length === 0`, ולהזין את התוצאה כארגומנט השני של `pickHomeHero` בשורה 167 (הפרמטר openToJoin כבר קיים בחתימה). כך הכרטיס UpcomingScheduledGameCard/Ho | medium |
| 20 | high | מסך הבית + מסך הבקשות — src/services/requestsService.ts:32-47 ו-:58-70 | myAdminGroupsWithPending מסנן `(g.adminIds ?? []).includes(userId)`, ו-myGamesWithPending מסנן `g.createdBy === userId` — שניהם incoming, מצד המנהל. getInboxCount מחזיר 0 למשתמש שרק שלח בקשות, כך שהנקודה האדומה על הפעמון כבויה. myCommunities במסך הבית סופר חברים בלבד, לא pendingGroups, כך שהצ'קליסט  | מישהו ביקש להצטרף למועדון ביום שלישי בערב, ראה טוסט 'הבקשה נשלחה' לשתי שניות, וחזר למסך הבית. המסך זהה לחלוטין לזה שראה לפני הלחיצה. למחרת הוא פותח את האפליקציה כדי לבדוק — ושוב אותו מסך ריק, ופעמון בלי נקודה אדומה. אין לו דרך לדעת אם הבקשה נשלחה בכלל, אם מישהו ראה אותה, או כמה זמן זה לוקח. הוא יניח | שתי הוספות ב-src/services/requestsService.ts: (1) להוסיף ל-InboxRequests שדה `outgoing` שנבנה מ-useGroupStore.pendingGroups + המשחקים שבהם ה-uid נמצא ב-pending[], ולספור אותו ב-getInboxCount כדי שהפעמון יידלק; (2) ב-src/screens/tabs/ProfileScreen.tsx, כשיש pendingGroups ואין מועדונים, למלא את חריץ ה | medium |
| 21 | high | מסך הבית — src/screens/tabs/ProfileScreen.tsx:1267-1294 ו-:1326-1355;  | שש בקשות נפרדות לסמן זמינות בסשן הראשון: אריח 'סמן זמינות' (ProfileScreen.tsx:1311), AvailabilityPromptCard 'רוצה לראות מי פנוי לשחק לידך?' (:1356), צ'קליסט שלב 2 'סמן מתי אתה פנוי' (:658), טיפ 'סמן מתי אתה פנוי — ומנהלים יזמינו אותך למחזורים' (he.ts:2007), פופאפ AvailabilityNudgeModal בכניסה הראשונ | שחקן שהוריד את האפליקציה כדי לשחק, לא כדי לארגן, נלחץ שש פעמים לסמן זמינות. הוא נכנע, ממלא רשת של ימים ושעות ובוחר אזור בית על מפה — שתי דקות של עבודה. הוא חוזר למסך הבית ומקבל כרטיס שאומר לו 'היום המומלץ לפתיחת מחזור', ובלחיצה עליו נפתח אשף יצירת מחזור. הוא ביקש לשחק, האפליקציה גייסה אותו לארגן. הפ | בשלב ראשון — לפצל את התגמול לפי כוונה. ב-src/screens/tabs/ProfileScreen.tsx להוסיף בצד ה-onPress של HomeRecommendedDay/HomeAvailabilityWindows ענף למשתמש בלי מועדון שמנווט ל-GamesList ולא ל-GameCreate. בשלב שני — לסנן את הפיד בפועל: ב-src/screens/games/GamesListScreen.tsx להוסיף מיון משני של restLis | medium |
| 22 | high | מסך ההתחברות — /Users/matan/Projects/soccer/src/screens/auth/SignInScr | `signInPrivacy: 'באמצעות התחברות אתה מסכים לתנאי השימוש'` מרונדר כ-`<Text style={styles.privacy}>` — טקסט מת, לא קישור, ואין בקובץ שום פונקציה שפותחת מסמך. חיפוש על כל src ועל public מעלה אפס מסמכי תנאי שימוש. במקביל, הפוטר של דף ההזמנה מקשר `<a href="/terms.html">תנאי שימוש</a>` — והכתובת מחזירה 40 | שחקן שקיבל קישור מהמארגן ב-22:00, לחץ, הוריד, ועומד מול כפתור "המשך עם Google" — קורא בשורה התחתונה שהלחיצה מהווה הסכמה למסמך, מנסה ללחוץ עליו כדי לקרוא מה הוא מקבל על עצמו, ושום דבר לא קורה. אם הוא הגיע דרך דף ההזמנה ולחץ שם על "תנאי שימוש", הוא קיבל 404. זה בדיוק הסוג של דבר שגורם למישהו להחליט לב | ליצור public/terms.html על בסיס העיצוב של public/privacy.html (אותו header/footer), ואז להפוך את השורה ב-SignInScreen.tsx:272 ל-Pressable שקוראת Linking.openURL עם שני קישורים נפרדים — תנאי שימוש ומדיניות פרטיות. במקביל לשנות את he.ts:1799 לניסוח ניטרלי מגדרית: 'בהתחברות אתם מאשרים את תנאי השימוש ומ | medium |
| 23 | high | מסך השקופיות / הכרעת הניווט — /Users/matan/Projects/soccer/src/navigat | ההזמנה נשמרת לאחסון כבר בהפעלה הקרה: `await stashPendingInvite(parsed)` ב־App.tsx:453, לפני כל החלטת ניווט. אבל RootNavigator בודק `if (!onboardingDone) return <OnboardingScreen />;` (שורה 253) בלי להסתכל על ההזמנה השמורה בכלל, והצרכן שמנווט ליעד חוסם את עצמו ב־`if (!currentUser \|\| !profileComplet | רן מקבל ב-22:40 לינק בוואטסאפ מהמארגן: 'חסר לנו אחד למחר, תיכנס'. הוא מתקין, ובמקום המשחק הוא מקבל שקופית שמציעה לו 'לגלות מחזורי כדורגל פתוחים באזור שלכם', אחר כך שקופית שמציעה לו 'לבנות את הסגל הקבוע שלכם' — הוא לא רוצה לבנות סגל, יש לו כבר סגל, הוא רוצה לדעת אם נשאר מקום. חמש הקשות אחר כך הוא סוף | ב־/Users/matan/Projects/soccer/src/navigation/RootNavigator.tsx: להוסיף סטייט `hasPendingInvite` שנטען פעם אחת מ־`storage.getPendingInvite()` באותו אפקט mount שכבר קיים בשורות 170-181, ולשנות את שורה 253 ל־`if (!onboardingDone && !hasPendingInvite) return <OnboardingScreen />;` — בנוסף לקרוא `comple | small |
| 24 | high | מסך התחברות — src/i18n/he.ts:1794, נרנדר ב-src/screens/auth/SignInScre | `signInSubtitle: 'התחבר כדי להירשם, להצטרף למועדון ולעקוב אחרי הסטטיסטיקות שלך.'` — הפועל "להירשם" כאן אמור להיות "להירשם למחזור", אבל על מסך שכל כולו הרשמה/התחברות הוא נקרא כ"לפתוח חשבון". התוצאה: "התחבר כדי להירשם" = התחבר כדי להתחבר. הכותרת מעליו, `signInTitle: 'בואו נתחיל'` (he.ts:1793), היא ברב | האיש עומד מול מסך עם ארבעה כפתורים ורוצה לדעת למה הוא נדרש לחשבון בכלל. הטקסט היחיד שאמור לענות לו אומר משפט מעגלי. הוא מדלג עליו, ואז "המשך כאורח" נראה לו כמו הדרך המהירה — והוא נופל לתוך המבוי הסתום של מצב אורח (ראו ממצא נפרד). | ב-`src/i18n/he.ts:1794` לשנות ל-'עוד רגע אתה בפנים — חשבון מאפשר לשמור את המקום שלך במשחק, להצטרף למועדון ולראות את הסטטיסטיקות.' וב-he.ts:1793 להתאים את הכותרת לאותו גוף: 'בוא נתחיל'. | trivial |
| 25 | high | מעל מסך הפרופיל שאחרי ההתחברות — /Users/matan/Projects/soccer/src/navi | האפקט מותנה רק ב־`if (!currentUser) return;` ו־`if (currentUser.isGuest) return;` (שורות 239-240), ורץ באותו רנדר שבו RootNavigator כבר החליט להחזיר `<PostSignInOnboardingScreen />` (שורות 267-269). כלומר הדיאלוג של מערכת ההפעלה נוחת על מסך שכותרתו `psoProfileTitle: 'בוא נכיר'` (he.ts:2839) ותת־הכות | יוסי בחר חשבון גוגל, המסך התחלף, והוא מספיק לקרוא חצי משורה אחת לפני שאנדרואיד שואל אותו אם מותר לשלוח לו התראות. הוא עוד לא יודע מה האפליקציה עושה, לא הצטרף לשום מועדון, ואין לו שום סיבה להגיד כן — אז הוא לוחץ 'אל תאפשר'. חודש אחרי זה המארגן פותח מקום פנוי בדקה ה-90, המערכת שולחת פוש למילוי אוטומטי | ב־/Users/matan/Projects/soccer/src/navigation/RootNavigator.tsx:235-248 להוסיף `if (!hasCompletedOnboarding) return;` לתנאי היציאה של האפקט, כך שהבקשה תרוץ רק אחרי שהמשתמש לחץ 'המשך' ב'בוא נכיר' ונחת על הבית. השלב הבא (גדול יותר, לא חובה עכשיו): להזיז את הקריאה כך שתרוץ אחרי ההצטרפות הראשונה למחזור, | small |
| 26 | high | סלוט הגיבור במסך הבית — src/components/home/HomeNextGameCard.tsx:42-61 | ל-HomeNextGameCard יש ענף `if (!game)` מלא ומעוצב: אייקון כדור, `homeNoGameTitle: 'אין לך מחזור קרוב'`, `homeNoGameBody: 'מצא מחזור פתוח או פתח מחזור חדש'` וכפתור `homeNoGameCta: 'מצא מחזור'` (src/i18n/he.ts:2026-2028). הקורא היחיד ברחבי src נמצא בתוך `{nextGame ? <HomeNextGameCard …/> : …}` (Profil | מישהו בצוות כבר זיהה את הרגע הזה וכתב עבורו בדיוק את המשפט הנכון — 'אין לך מחזור קרוב · מצא מחזור פתוח או פתח מחזור חדש'. משתמש חדש היה מקבל בגובה העיניים משפט שמסביר את המצב וכפתור אחד שפותר אותו. במקום זה המסך פשוט מדלג, והמשתמש נשאר עם שורת מאמן ושלושה אריחים בעלי משקל חזותי זהה, בלי שום דבר שאומ | ב-src/screens/tabs/ProfileScreen.tsx:1228 להחליף את `{nextGame ? … : heroGame ? … : null}` ב-`{nextGame ? … : heroGame ? … : <HomeNextGameCard game={null} onOpen={…} onFind={() => nav.navigate('GameTab')} />}`. אפס קוד חדש — הרכיב והטקסטים כבר קיימים ומעוצבים. | trivial |
| 27 | high | שקופית אונבורדינג 1 + טאב ראשי — src/i18n/he.ts:1782, src/i18n/he.ts:2 | ההופעה הראשונה של המילה בכל חיי המשתמש היא בשקופית הראשונה: `onb1Body: 'גלו מחזורי כדורגל פתוחים באזור שלכם והצטרפו בלחיצה — או פגשו שחקנים חדשים לידכם'` (he.ts:1782). אחר כך היא שם של טאב: `tabGame: 'מחזורים'` (he.ts:2885). grep על `src/screens/onboarding/` ו-`src/screens/auth/` מחזיר אפס הופעות של | האיש קיבל מהמארגן "יש משחק מחר ב-20:30". הוא פותח את האפליקציה ורואה "גלו מחזורי כדורגל פתוחים". בעברית יומיומית "מחזור" זה מחזור בבית ספר, מחזור בליגה, או מיחזור — לא ערב הכדורגל שלו. הוא לא בטוח אם הטאב "מחזורים" הוא ההיסטוריה שלו, טבלת ליגה, או המקום שבו נרשמים למחר, ולכן הוא לוחץ על "בית" ומחפש  | שני מהלכים, לפי תיאבון. הזול: בשקופית הראשונה ב-`src/i18n/he.ts:1782` להחליף ל-'גלו משחקי כדורגל פתוחים באזור שלכם והצטרפו בלחיצה' ולהוסיף בסוגריים בגוף השקופית את ההגדרה — למשל `onb1Body` שמסתיים ב'(באפליקציה קוראים לערב משחק אחד "מחזור")'. היקר והנכון: לשנות את `tabGame` ב-he.ts:2885 ל'משחקים' ולה | medium |
| 28 | medium | / — feature cards and beta card. /Users/matan/Projects/soccer/public/i | Headings and beta copy use plural imperative — `פותחים`, `מזמינים`, `הצטרפו`, `שלחו`. Three feature cards switch to masculine singular second person: `אתה רואה את המשחק הבא, נרשם, ויודע אם אתה ברשימה הראשית או בהמתנה` (:476), `ואתה ראשון בהמתנה` (:508), `כמה משחקים שיחקת` (:519). The beta card flips | A woman reading the feature cards is told `אתה רואה את המשחק הבא` — the page is addressing a man. She is a regular in a mixed Thursday game and has just been told, grammatically, that this product pictures someone else using it. A second reader, deciding whether Teamder is a company he can rely on f | In public/index.html, rewrite :476 to `רואים את המשחק הבא, נרשמים, ויודעים אם אתם ברשימה הראשית או בהמתנה`, :508 to `…כשמישהו מבטל ואתם ראשונים בהמתנה`, and :519 to `כמה משחקים שיחקתם` — matching the plural already used in the headings. When the beta section is replaced (see the beta finding), the f | trivial |
| 29 | medium | /Users/matan/Projects/soccer/firestore.rules:260 (`allow read: if isSi | `userConverter.toFirestore` כותב `email` ישירות על /users/{uid} (firestore.ts:186), והכלל בשורה 260 מתיר קריאה של המסמך כולו לכל מי שמחובר. באותו קובץ ממש, firestore.ts:244-249, מתועדת ההחלטה ההפוכה לגבי טוקני הפוש: הם הועברו ל-/users/{uid}/private/push בדיוק כי כתיבתם על המסמך הגלוי "הדליפה כל טוקן | שחקן שהצטרף למועדון של שכונה כדי לשחק פעם בשבוע נתן לנו את כתובת המייל שלו כדי להיכנס, לא כדי לפרסם אותה. בפועל כל אחד מ-676 החשבונות באפליקציה — כולל חשבונות שנרשמו היום ואינם חברים באף מועדון שלו — יכול לקרוא את המסמך שלו ולשלוף את הכתובת. זה גם בדיוק הפער שיצוץ אם אי פעם ייכתב מסמך תנאי שימוש הגו | להעביר את email לתת-מסמך /users/{uid}/private/contact באותה תבנית בדיוק שכבר קיימת ל-fcmTokens: להסיר את השורה firestore.ts:186 מ-toFirestore, לכתוב את הכתובת ב-userService.ts (בקריאות ה-setDoc בשורות 194, 241, 286, 329) לתת-המסמך, ולהוסיף ב-firestore.rules כלל `match /users/{uid}/private/contact {  | medium |
| 30 | medium | /Users/matan/Projects/soccer/src/types/index.ts:423 ו-/Users/matan/Pro | `marketingPush: true` ב-defaultNotificationPrefs. מה שהמתג מכסה, לפי הקופי שלנו: `טיפים ועדכונים` / `עצות למארגנים, תזכורת כשהמועדון שקט וכל מה שאנחנו שולחים ביוזמתנו`. ה-effect ב-RootNavigator.tsx:235-248 תלוי ב-currentUser?.id, כלומר רץ באותו רנדר שבו מוצג PostSignInOnboardingScreen (RootNavigator | שחקן שאישר "התראות" חמש שניות אחרי שנכנס — בזמן שהוא עוד מנסה להבין למה מבקשים ממנו שם — התכוון לתזכורת שעה לפני המשחק. שבועיים אחר כך, בלי שהוא ביקש, מגיע אליו פוש "עצה למארגנים" בערב, והוא לא זוכר שאישר משהו כזה. לרוב האנשים זה לא מוביל לכיבוי המתג הנכון בהגדרות אלא לכיבוי כל ההתראות של Teamder —  | שתי פעולות נפרדות. (1) ב-RootNavigator.tsx:241 לדחות את הקריאה ל-requestAndRegisterPushToken עד אחרי completePostSignInOnboarding, ולהוסיף ב-PostSignInOnboardingScreen שורה אחת מעל הכפתור: 'נשלח לך תזכורת לפני המחזור ונודיע כשמתפנה מקום'. (2) להפוך את types/index.ts:423 ל-`marketingPush: false`, ולה | small |
| 31 | medium | /app, /go, /session/*, /team/*, /i/* — the shared invite footer. /User | The footer reads `© Teamder · <a href="/privacy.html">פרטיות</a><a href="/terms.html">תנאי שימוש</a>`. `find . -iname "terms*"` across the repo returns nothing, and `curl -o /dev/null -w "%{http_code}" https://teamderfc.web.app/terms.html` returns **404**. Because one file backs all five invite rout | A careful player is sent a link to join his brother-in-law's club. Before installing anything that will hold his name, phone and city, he taps `תנאי שימוש` — and gets a Firebase 404 page in English. The people who check terms before installing are precisely the cautious ones who most need convincing | Either write public/terms.html (the existing public/privacy.html is a good structural template — same nav, same eyebrow/H1/date pattern), or, as a same-day stop-gap, delete the `<a href="/terms.html">תנאי שימוש</a>` anchor from public/invite.html:191. Note the sibling link on that line points at `/p | trivial |
| 32 | medium | /c/{id} — the community showcase. /Users/matan/Projects/soccer/public/ | Rendered live on a real club: `1 משחקים` — "1 games". Sources are `(entry.p.gamesPlayed \|\| 0) + '</strong> משחקים · '` (:1228), `(g.attendedCount \|\| 0) + ' שחקנים'` (:1264), and `games + ' משחקים'` (:1301) — no singular branch anywhere. The app itself handles this correctly: `src/i18n/he.ts:1574 | A player opens the club page his friend sent, reads `1 משחקים` in the very first card, and registers — correctly — that nobody has proofread this. He then reads the leaderboard top-to-bottom and congratulates the wrong man on topping the attendance table. He never finds out what `100% אחוז הצלחה` me | In public/c/index.html, add a `plural(n, one, many)` helper next to `escapeHtml` and use it at :1228, :1264 and :1301 — mirroring `src/i18n/he.ts:1574-1575` so web and app agree. For the podium, add `#podium > *:nth-child(1){order:2} #podium > *:nth-child(2){order:1} #podium > *:nth-child(3){order:3 | small |
| 33 | medium | /get — public/get.html:53-65; חיפוש קישורים בכל הריפו | הדף עושה את הדבר הנכון בשלוש הפלטפורמות: אנדרואיד — `location.replace(ANDROID)` באפס הקשות (:60-61); iOS — `location.replace(IOS)` (:63-64), כולל זיהוי iPadOS שמדווח כ-Mac דרך `(/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)` (:56); דסקטופ — שני הכפתורים מוצגים ואין הפניה. אבל `grep -rn 'web. | בעל המוצר מפרסם בקבוצת פייסבוק של כדורגל שכונתי ורוצה לצרף קישור הורדה. הקישור שהוא ימצא בקלות הוא הדומיין הראשי — שמוביל לבקשת בטא בוואטסאפ (ממצא 1). הדף שהיה מוריד לו את האפליקציה באפס הקשות קיים, עובד, ופרוס בפרודקשן — אבל הוא צריך לזכור את הכתובת בעל פה כדי להשתמש בו. | לא לגעת ב-public/get.html — הלוגיקה שלו נכונה. במקום זה להפוך אותו לכתובת ההורדה הרשמית: להפנות אליו את ה-CTA ב-public/index.html:426, להוסיף אותו לפוטר של public/invite.html:191 ושל public/c/index.html:965, ולהשתמש בו כיעד הדסקטופ מממצא 4. כדאי גם להעביר אליו את פרמטרי הייחוס (`?invitedBy=`) כדי שה | trivial |
| 34 | medium | All surfaces. public/index.html:10, public/get.html:16, public/invite. | `file public/logo.png` reports 512×512. Every `og:image` on the estate points at it. public/index.html additionally declares no `og:type`, no `og:locale` and no twitter card, while public/invite.html:13 declares `twitter:card: summary_large_image` — requesting a wide card it has no wide image to fil | An organiser pastes this week's game link into his club's WhatsApp group at 21:00. Instead of a wide card showing the fixture, the group sees one line of text next to a small square logo and a `teamderfc.web.app` URL — visually indistinguishable from a forwarded spam link. Two of the twelve players  | Produce one 1200×630 OG image (the existing app-preview.png screenshot on the brand navy from invite.html, with the `מארגנים כדורגל בלי בלגן` line) as public/og-cover.png, then point `og:image` at it in public/index.html:10, public/get.html:16 and public/invite.html:11. Add `og:type`, `og:locale he_ | small |
| 35 | medium | functions/src/index.ts:10770-10777 (ענף session) מול public/invite.htm | בענף `type === 'session'` הפונקציה בונה כותרת ותיאור אבל משאירה `ogImage = null`, ולכן נשאר ה-og:image הסטטי: `https://teamderfc.web.app/logo.png` — קובץ 512×512. בשורה שאחריה מוצהר `<meta name="twitter:card" content="summary_large_image" />`, כלומר מוכרז כרטיס רחב עם תמונה ריבועית. אין בכל public/  | בקבוצת וואטסאפ שבה רצות ארבעים הודעות בערב, ההזמנה של המארגן מופיעה כשורת טקסט עם תמונונת ריבועית בגודל אייקון. השחקן גולל מעליה בלי לעצור, ובשמונה בבוקר המארגן עדיין חסר שניים ושולח הודעה שנייה. | לייצר תמונת שיתוף 1200×630 (אפשר לגזור אותה מ-public/app-preview.png שכבר יושב בשרת ואף אחד לא מפנה אליו), לשמור כ-public/og-cover.jpg, ולהחליף את public/invite.html:11 לכתובת החדשה. בנוסף, ב-functions/src/index.ts:10770 להשים ל-ogImage את תמונת המגרש או הלוגו של המועדון של המחזור כשקיימת, כמו שכבר  | small |
| 36 | medium | public/invite.html:160-164 ו-234 | באותו מסך עצמו: הכותרת והליד בגוף רבים ניטרלי — `כדורגל קבוע. בלי כאב הראש של הארגון.` / `פותחים משחק, החבר׳ה נרשמים ו־Teamder מטפלת בכל השאר.` — ומיד מתחתיהם הכפתור בציווי זכר יחיד: `הורד את Teamder`. בגרסת ההזמנה למשחק (שורה 234): `משחק שכונתי מחכה לך. ראה מי מגיע והצטרף בלחיצה אחת.` — שלוש צורות  | שחקנית שקיבלה קישור למשחק מעורב קוראת `ראה מי מגיע והצטרף` ומבינה, נכון או לא, שהיא לא קהל היעד. במקביל, מארגן ליגה שבועית רצינית ששיתף את הקישור מגלה שהדף מכנה את המחזור שלו `משחק שכונתי` — הקטנה של בדיוק הדבר שהוא ניסה למכור לחברים שלו. ו-`עברית מלאה` כטיעון מכירה מרמז לישראלי שמדובר במוצר מתורגם, | ב-public/invite.html: להחליף את שורה 163 ואת `cta` בכל חמשת הווריאנטים (שורות 233-237) לצורות ניטרליות — `להורדת Teamder`, `לפתיחת המשחק`, `לפתיחת המועדון`; לשכתב את שורה 234 ל-`משחק מחכה לך. אפשר לראות מי מגיע ולהצטרף בלחיצה אחת.`; ולהחליף בשורה 164 את `עברית מלאה` ב-`בלי הרשמה לאתר` או להשמיט. | trivial |
| 37 | medium | public/invite.html:187-191 | בסקשן האחרון יושבים שני כפתורי חנות זה לצד זה: `<small>הורד ב־</small><b>Google Play</b>` ואחריו `<small>הורד ב־</small><b>App Store</b>`. בניגוד ל-get.html ול-c/index.html, אין בקובץ הזה שום הסתרה לפי פלטפורמה — רק שורה 229 שמעדכנת את ה-href של הכפתור האנדרואידי. בשורה שמתחת: `<a href="/privacy.htm | בעל אייפון שגלל עד סוף הדף רואה כפתור הורדה ל-Google Play כאפשרות ראשונה. אם ילחץ עליו הוא יגיע לדף Play במובייל ספארי שיאמר לו שהאפליקציה לא זמינה למכשיר שלו — והוא יסיק שהאפליקציה היא אנדרואיד בלבד. מי שכן ירצה לבדוק במה הוא מסתבך לפני ההורדה ילחץ `תנאי שימוש` ויקבל 404 — בדיוק ברגע שבו הוא שוקל ל | ב-public/invite.html להוסיף לסקריפט, מיד אחרי `var isIOS=...` בשורה 230, הסתרה של הכפתור הלא רלוונטי (`document.getElementById('storeAndroid').style.display='none'` באייפון, ולתת id לכפתור ה-App Store ולהסתירו באנדרואיד) — אותה לוגיקה בת שלוש שורות שכבר קיימת ב-public/get.html:59-65. ובמקביל: או ליצ | trivial |
| 38 | medium | src/components/home/HomeNextGameCard.tsx:42-61, נקרא רק מ-src/screens/ | HomeNextGameCard מקבל `game: Game \| null` ופותח ב-`if (!game)` עם מצב-ריק מלא: אייקון כדור, `homeNoGameTitle: 'אין לך מחזור קרוב'` (he.ts:2026), `homeNoGameBody: 'מצא מחזור פתוח או פתח מחזור חדש'` (:2027) וכפתור `homeNoGameCta: 'מצא מחזור'` (:2028) שמנווט ל-GameTab. grep -rn "HomeNextGameCard" src  | מישהו כבר כתב בדיוק את המשפט הנכון למשתמש החדש — 'אין לך מחזור קרוב · מצא מחזור פתוח או פתח מחזור חדש' עם כפתור — וזה יושב בקוד חודשים בלי שאף משתמש ראה אותו. במקום זה, המשתמש החדש רואה חור. השקעת העיצוב כבר שולמה; רק החיווט חסר. | ב-src/screens/tabs/ProfileScreen.tsx לשנות את שורה 1228 מ-`{nextGame ? (<HomeNextGameCard game={nextGame} .../>) : heroGame ? (...) : null}` ל-`{nextGame ? (...) : heroGame ? (...) : <HomeNextGameCard game={null} communityName={undefined} onOpen={()=>{}} onFind={()=>nav.navigate('GameTab')} />}`. שי | trivial |
| 39 | medium | src/navigation/RootNavigator.tsx:253-271; src/i18n/he.ts:1775-1790, 28 | סדר השערים: `if (!onboardingDone) return <OnboardingScreen />` (קרוסלה של שלושה שקפים — `שחקו עם אנשים בקרבת מקום` / `מועדון קבוע, מחזור אוטומטי` / `הכל זורם מעצמו`), אחריה `<AuthStack initialRoute="SignIn" />`, אחריה `<PostSignInOnboardingScreen />` עם `psoProfileTitle: 'בוא נכיר'`. רק אחרי ששלושתם | שחקן קיבל קישור בעשר בלילה ורצה לדעת דבר אחד: אם נשאר מקום למחר בשבע בבוקר. הוא מתקין, ומקבל שלושה שקפי שיווק על יתרונות מועדון קבוע, בקשה להתחבר עם Google, ואז בקשה לבחור שם ותמונת שחקן. רק אחרי כל זה נפתח המחזור. אם הוא נטש בשקף השני — הוא התקין את האפליקציה, שילם את כל מחיר הרכישה, ומעולם לא ראה  | ב-src/screens/onboarding/OnboardingScreen.tsx לקרוא את `storage.getPendingInvite()` בעליית המסך, וכשקיים pending מסוג session להחליף את הכותרת של השקף הראשון בשורת הקשר אמיתית (למשל `מחכים לך במחזור — עוד רגע נכניס אותך`) ולהציג כפתור `דלג` בולט שמקפיץ ישר ל-SignIn. השקפים הגנריים נשארים למי שהגיע א | medium |
| 40 | medium | src/screens/communities/CommunityDetailsPublicScreen.tsx:91-98 (שליפה) | המסך קורא ל-gameService.getUpcomingPublicGamesForGroup(groupId) ושומר את התוצאה ב-upcomingGames. השימוש היחיד בנתון הזה הוא גזירת שני צ'יפים: derivedDaysList (אילו ימי שבוע מופיעים) ו-derivedHour (השעה השכיחה), שמרונדרים כשורות מטא 'ימי מחזור' ו'שעת מחזור'. רשימת המשחקים עצמה — תאריכים ממשיים, כמה מ | משתמש חדש פותח את הכרטיס של מועדון שהאפליקציה הציעה לו, ורואה: תיאור, עיר, 'ימי מחזור: ה׳', '40 שחקנים'. הוא לא יכול לדעת אם המועדון הזה שיחק פעם אחרונה השבוע או לפני חצי שנה. הוא שולח בקשת הצטרפות למועדון שאולי מת, מחכה שלושה ימים בלי שום מעקב (ראו הממצא על הבקשות היוצאות), ומגלה בסוף שהצטרף למקום  | ב-src/screens/communities/CommunityDetailsPublicScreen.tsx, מתחת לכרטיס הפרטים (אחרי שורה 343), לרנדר את upcomingGames.slice(0,2) כשורות קריאה-בלבד — תאריך, שעה ותפוסה — עם כותרת חדשה ב-src/i18n/he.ts בסגנון 'המחזורים הקרובים'. הנתונים כבר בזיכרון ואינם דורשים קריאה נוספת. כשהמערך ריק, לרנדר שורה כנ | small |
| 41 | medium | src/screens/tabs/ProfileScreen.tsx:641-655 (שלב photo) מול src/screens | במסך ה-onboarding שאחרי ההרשמה, avatarId מאותחל ל-`user?.avatarId ?? (user ? pickRandomAvatarId() : undefined)` — כלומר אווטאר נבחר אוטומטית לכל משתמש חדש. handleSave שומר `avatarId: photoUrl ? undefined : avatarId, photoUrl` (:118), כך שבמסלול ברירת המחדל (לחיצה על 'המשך' בלי לגעת בסקשן התמונה) pho | משתמש עובר מסך שבו האפליקציה בחרה לו אווטאר, לוחץ 'המשך', ומיד נוחת על כרטיס ירוק שמראה לו טבעת התקדמות ריקה ואומר 'הוספת תמונת פרופיל' — הדבר שהוא בדיוק סיים. הכרטיס שנועד לתת לו תחושת התקדמות נותן לו תחושה שכלום ממה שעשה לא נספר. ואפילו אם הוא בולע את זה ומתחיל מלמעלה, הצעד הראשון שהאפליקציה מבקשת | ב-src/screens/tabs/ProfileScreen.tsx: (1) לשנות את התנאי בשורות 646 ו-650 ל-`done: !!user.photoUrl \|\| !!user.avatarId` כך שבחירת אווטאר נספרת; (2) להעביר את הפריט key:'community' לראש מערך checklistItems (כרגע שורות 666-679) ולהוריד את key:'photo' למקום הרביעי, כך שהצעד הראשון הוא הצעד שפותח את הא | trivial |
| 42 | medium | אשף יצירת מחזור — src/screens/games/GameWizardForm.tsx:490-570; src/sc | היוצר של מחזור מהיר נרשם אוטומטית (`autoSelfRegister` ב-src/services/gameService.ts:2788-2790), ולכן זה המסלול היחיד שמבטיח 'אני רשום' בלי אדם אחר. אבל הוא עובר `StepIndicator` עם שלושה שלבים — `wizardStep1: 'פרטים'`, `wizardStep2: 'חוקים'`, `wizardStep3: 'מתקדם'` (src/i18n/he.ts:1117-1119) — ורק שד | אורי רוצה לארגן משחק לחמישי עם החבר'ה מהעבודה. הוא בוחר 'מחזור מהיר', מקליד שם מגרש — ואז עובר שני מסכים שמדברים על 'מצב מתקדם', 'אישור כניסה מרשימת המתנה' ו'פתיחה לכלל האפליקציה בזמן מתוזמן', מושגים שאין לו דרך להעריך כי הוא בדקה השלישית שלו באפליקציה. הוא לא משנה שום ערך — אין שם שום דבר שהוא צריך | ב-src/screens/games/GameWizardForm.tsx:552-570, כאשר `quick === true`, להציג את כפתור השליחה כבר בשלב 1 (`step < 3 && !quick ? <Next/> : <Submit/>`) ולהסתיר את StepIndicator, עם קישור טקסטואלי 'הגדרות מתקדמות' שמוביל לשלבים 2-3 למי שרוצה. כל הערכים כבר מגיעים עם ברירות מחדל תקינות מ-GameCreateScreen | medium |
| 43 | medium | אתחול האפליקציה — src/navigation/RootNavigator.tsx:235-247; src/servic | ה-effect רץ ברגע ש-currentUser קיים ואינו אורח, ו-`requestAndRegisterPushToken` קורא ישירות ל-`Notifications.requestPermissionsAsync()` בלי שום מסך הסבר מקדים. באותו רגע `hasCompletedOnboarding` עדיין false, ולכן המסך שמתחתיו הוא PostSignInOnboardingScreen — `psoProfileTitle: 'בוא נכיר'` (src/i18n/h | נועם בדיוק הקליד את שמו במסך הראשון של האפליקציה, ועוד לפני שראה מסך אחד של תוכן קופץ דיאלוג מערכת ששואל אם מותר לשלוח לו התראות. הוא לא יודע עדיין מה האפליקציה עושה, אז הוא לוחץ 'אל תאפשר' — התגובה ההגיונית. שלוש דקות אחר כך הוא מבקש להצטרף למועדון ונכנס להמתנה. המנהל מאשר אותו למחרת בבוקר, אבל הדח | להעביר את הקריאה מ-src/navigation/RootNavigator.tsx:235-247 לרגע שבו יש ערך מוחשי: לקרוא ל-`notificationsService.requestAndRegisterPushToken(user.id)` בסיום מוצלח של `handleRequest` ב-src/screens/communities/PublicGroupsFeedScreen.tsx:376-380 ושל ההצטרפות ב-src/screens/games/GamesListScreen.tsx:370- | small |
| 44 | medium | בין 'המשך' ב'בוא נכיר' לבין מסך הבית — /Users/matan/Projects/soccer/sr | `if (!groupHydrated) return <Splash />;` (שורה 274) מרנדר `<SplashVisual />` (שורה 288) — אותו קומפוננט מדויק של הבוט, לא לואדר קטן. SplashVisual מתחיל את כל הרצף מאפס בכל mount: קווי המגרש ב־480ms ו־700ms, בעיטה ב־`KICK_AT = 440`, הwordmark ועמו `'המשחק הבא שלך מתחיל כאן'` (SplashScreen.tsx:288) עו | מאיה לוחצת 'המשך' אחרי שהקלידה את השם שלה, מצפה להיכנס — והמסך חוזר למסך הפתיחה של האפליקציה, עם הכדור והסלוגן 'המשחק הבא שלך מתחיל כאן' שוב. הרגע הזה נקרא כמו קריסה וטעינה מחדש: היא לא יודעת אם השמירה עברה או שהאפליקציה נפלה וחזרה, והיא בהחלט לא יודעת כמה זמן זה ייקח. זו האנימציה שאומרת 'אנחנו מתחי | ב־/Users/matan/Projects/soccer/src/navigation/RootNavigator.tsx:286-289: להחליף את הפולבק השני בלואדר שקט — רקע בצבע הרקע של הטאבים עם `<ActivityIndicator />` במרכז, או עוד יותר טוב, לרנדר את MainTabs עם שלד ולתת ל־groupHydrated להתמלא מתחתיו. להשאיר את SplashVisual אך ורק לשימוש של App.tsx:1007 בבו | small |
| 45 | medium | התחברות → פרופיל → בית: he.ts:1793 (SignInScreen.tsx:179), he.ts:2839  | ארבע כותרות שאומרות את אותו דבר: `signInTitle: 'בואו נתחיל'`, `psoProfileTitle: 'בוא נכיר'`, `profileTitle: 'בוא נכיר'` (כפילות מדויקת), `homeChecklistTitle: 'בוא נתחיל'` — האחרונה עם `homeChecklistSubtitle: 'כמה צעדים קטנים כדי להפיק את המקסימום'` וחמישה פריטים. בנוסף המשלב מתנדנד בתוך מסך יחיד: `s | אבי סיים את מה שהוא חשב שזה ההרשמה — הקליד שם, בחר אווטאר, לחץ 'המשך'. המסך הבא מקדם אותו ב'בוא נתחיל ⚡' ובחמש משימות שרק אחת מהן (0/5) קשורה למה שהוא רצה. התחושה היא שהוא לא סיים כלום, שההרשמה הייתה רק הטופס ועכשיו מתחילה העבודה האמיתית. מבחינת קצב הפתיחה נגמרת ברגע שהוא נוחת על הבית — וכאן היא מתח | שינוי מחרוזות בלבד ב־/Users/matan/Projects/soccer/src/i18n/he.ts: `signInTitle` → 'מתחברים ומתחילים לשחק' (נשאר ברבים כמו השקופיות), ולשנות את `signInSubtitle` ל־'התחברו כדי להירשם למחזורים, להצטרף למועדון ולעקוב אחרי הסטטיסטיקות שלכם.'; `homeChecklistTitle` (שורה 1990) → 'להשלים את הפרופיל' עם תת־כ | trivial |
| 46 | medium | התחברות → פרופיל → מסך הבית — src/i18n/he.ts:1793, :1846, :2839, :1990 | `signInTitle: 'בואו נתחיל'` (he.ts:1793) ← `psoProfileTitle: 'בוא נכיר'` (he.ts:2839) ← `profileTitle: 'בוא נכיר'` (he.ts:1846, אותו נוסח בדיוק במסך אחר) ← `homeChecklistTitle: 'בוא נתחיל'` (he.ts:1990, נרנדר ב-src/components/home/OnboardingChecklist.tsx:74). וקיימות עוד שתי מחרוזות מתות עם אותו נוס | הוא מסיים את הפרופיל, לוחץ "המשך", רואה שוב את ספלאש הכדור, ונוחת על מסך שהכרטיס הראשון בו כתוב בו "בוא נתחיל ⚡" — אותה כותרת שראה במסך ההתחברות לפני חצי דקה. התחושה היא שהוא חזר אחורה או שההרשמה לא נקלטה, ולא שהוא סיים והגיע הביתה. | לתת לכל מסך את הפעולה שלו: `he.ts:1793` → 'בוא נתחיל', `he.ts:2839` → 'איך קוראים לך?', `he.ts:1990` → 'להשלים את הפרופיל' (או 'עוד כמה דברים קטנים'). ולמחוק את `onbStart` (he.ts:1777), `onb4Title`/`onb4Body` (he.ts:1789-1790), `onbCtaSignIn`/`onbCtaSignInApple` (he.ts:1778-1779) — כולן מחרוזות מתות | trivial |
| 47 | medium | חסם מצב אורח — src/i18n/he.ts:1803, ההתנהגות ב-src/utils/guestGate.ts: | `guestRegisterJoinGame: 'כדי להירשם למחזור צריך חשבון. רוצה להירשם עכשיו?'` — "להירשם" פעמיים במשפט אחד, בשתי משמעויות שונות. ההתנהגות בקוד: לחיצה על `guestRegisterCta: 'הרשמה'` (he.ts:1808) שומרת את היעד ואז מריצה `await useUserStore.getState().signOut()` (guestGate.ts:58). שום מחרוזת בדיאלוג לא מז | הוא בחר "המשך כאורח" כי זו נראתה הדרך המהירה, מצא את המשחק של שלישי, לחץ "אני מגיע" — וקיבל דיאלוג מבלבל. הוא לוחץ "הרשמה" ופתאום הוא שוב על מסך ההתחברות, בלי המשחק, בלי הסבר. הוא חושב שהאפליקציה קרסה או שהוא נמחק. | שתי עריכות. בטקסט, `src/i18n/he.ts:1803` → 'כדי לשמור לך מקום במשחק צריך חשבון. נפתח אחד עכשיו? ניקח אותך חזרה לאותו משחק.' (ובאותה מידה he.ts:1802 ו-1804-1807, שכולן סובלות מאותה כפילות). בכפתור, `he.ts:1808` → 'פתח חשבון'. ההבטחה "ניקח אותך חזרה" כבר נכונה טכנית — היעד נשמר ב-guestGate.ts:51-56 ומ | small |
| 48 | medium | כל נתיבי ההזמנה — /app, /go, /session/{id}, /team/{id}, /i/{code} — pu | ב-`primary()` הבדיקה היחידה היא `var isIOS=/iPhone\|iPad\|iPod/i.test(navigator.userAgent\|\|'')`. אין ענף דסקטופ. מבקר Windows או Mac (ללא מסך מגע) נופל למסלול אנדרואיד: `track('landing_app_open_attempt')`, טיימר של 1500ms ל-`location.href = store`, ואז `location.href = 'footy://...'`. גם משתמש Mac | שחקן קבוע קורא את קבוצת הוואטסאפ של המועדון דרך WhatsApp Web במחשב בעבודה ורואה את ההזמנה למשחק של חמישי. הוא לוחץ, רואה `הוזמנת למשחק כדורגל`, לוחץ `פתח את המשחק` — Chrome מקפיץ שגיאה שאי אפשר לפתוח footy://, ושנייה וחצי אחר כך הוא על דף Google Play במחשב Windows. הוא לא יכול להתקין משם, אין לו דרך | ב-public/invite.html:231 להוסיף בתחילת `primary()` ענף `isDesktop` (לא Android ולא iOS): לדלג על הסכמה, ובמקום הפניה — להציג שכבה עם קוד QR של `clipUrl()` ושני כפתורי חנות. אפשר להסתפק בגרסה מינימלית: להפנות דסקטופ ל-`/get`, שכבר מציג את שתי החנויות ולא מנסה סכמה. | small |
| 49 | medium | כרטיס 'הודעה מהמאמן' במסך הבית — src/utils/assistant/rules.ts:704-717, | joinClubRule הוא הכלל היחיד שנורה למשתמש בלי מועדון (כל הכללים שמעליו מחזירים null, ו-statsRule מחזיר null כי position לא נאסף באף שלב בהרשמה — PostSignInOnboardingScreen אוסף שם ותמונה בלבד). הטקסט שלו הוא `pickVariant(he.assistantJoinClub, 'joinClub', ctx.nonce)` (:710) מתוך מערך של שתיים (he.ts:3 | בערך מחצית מהמשתמשים החדשים אף פעם לא מקבלים ברכת פתיחה. השורה הראשונה שהאפליקציה אומרת להם היא 'בוקר טוב דני, יש כדורגל מסביבך 👀' — משפט שמבטיח היצע במסך שלא מציג אף משחק, ואז הם מרעננים ומקבלים 'ברוך הבא' ביום השני שלהם. הרגע היחיד שבו ברכת פתיחה שווה משהו נשרף על הגרלה. | ב-src/utils/assistant/rules.ts:704-717, לפצל את joinClubRule לפי ותק: אם `ctx.user?.createdAt` צעיר מ-24 שעות להחזיר קבוע את he.assistantJoinClub[1] ('ברוך הבא ל-Teamder! 👋'), אחרת להמשיך עם pickVariant על השאר. שינוי של שלוש שורות בתוך הכלל, בלי לגעת ב-resolver. | trivial |
| 50 | medium | כרטיס ההקשר בדף ההזמנה — public/invite.html:246; וכן public/c/index.ht | השורה היא `tg.push({txt: d.availableSpots + ' מקומות פנויים', cls:'free'})` מאחורי התנאי `d.availableSpots > 0`. כשנשאר מקום אחד זה מרנדר `1 מקומות פנויים`; כש-0 הצ'יפ לא נוצר כלל, כך שמשחק מלא ומשחק שההקשר שלו לא נטען נראים זהים. האפליקציה עצמה כבר פותרת את זה נכון ב-src/i18n/he.ts:2025: `n === 0 ? | המארגן שולח את הקישור בדיוק כי נשאר מקום אחד והוא צריך למלא אותו עכשיו. השחקן שמקבל אותו ב-22:00 בלילה לפני המשחק רואה `1 מקומות פנויים` — ניסוח שדובר עברית לא כותב, שנקרא כתקלה ולא כדחיפות, ומחליש בדיוק את הצ'יפ הירוק שכל תפקידו לגרום לו למהר. ובמקרה ההפוך, כשהמשחק כבר מלא, הוא לא רואה כלום ולא יוד | ב-public/invite.html:246 להחליף את הביטוי בפונקציה קטנה בתוך הסקריפט: `function spots(n){return n===1?'מקום פנוי אחד':n+' מקומות פנויים';}` — העתק מדויק של הלוגיקה ב-src/i18n/he.ts:2025. להוריד את התנאי `> 0` ולהציג במקומו צ'יפ `המשחק מלא` (אותו ניסוח שכבר קיים ב-invite.html:179). להחיל את אותו תיקו | trivial |
| 51 | medium | כרטיס מחזור בפיד — src/components/match/MatchListCard.tsx:63-86, 137-1 | ctaForGame בודק תפוסה לפני אישור: `if (occupancy >= g.maxPlayers) return 'waitlist'`, כאשר התפוסה כוללת אורחים פעילים והזמנת קידום מוחזקת (:79-83). אבל התווית נשארת אחת משתיים בלבד — `matchCardJoinShort: 'הצטרף'` לכל דבר שאינו requiresApproval, כולל מחזור מלא. ההערה בקוד מודה בזה: *"Even a full game | עידן פותח את טאב המחזורים, רואה כרטיס אחד ועליו כפתור ירוק 'הצטרף', ולוחץ. שנייה אחר כך עולה טוסט שנעלם תוך שלוש שניות ומודיע שהוא ברשימת המתנה — כלומר, המסלול המהיר ביותר באפליקציה, שתי הקשות, הניב לו בפועל לא-מחזור. לפי ההערה בקוד זה בדיוק מה שקורה בשטח: המחזור הציבורי היחיד עומד על 21/21, כך שכל  | ב-src/components/match/MatchListCard.tsx:139-140 להרחיב את ctaLabel לשלוש אפשרויות: `cta === 'waitlist' ? he.gameStatusWaitlist : cta === 'requestJoin' ? he.gameCardRequestJoin : he.matchCardJoinShort`. המחרוזת `gameStatusWaitlist: 'הצטרף לרשימת המתנה'` כבר קיימת (src/i18n/he.ts:821) ומשמשת כבר את מ | trivial |
| 52 | medium | לאורך כל המסלול — src/i18n/he.ts:1781-1786 (רבים) מול :1794, :2839, :1 | השקופיות ברבים: 'שחקו', 'גלו', 'בנו' (he.ts:1781-1785). ההתחברות מתחילה ברבים — 'בואו נתחיל' (he.ts:1793) — וממשיכה בזכר יחיד בשורה הבאה: 'התחבר כדי להירשם' (he.ts:1794). מכאן והלאה הכל זכר יחיד: 'בוא נכיר' (he.ts:2839), 'סמן מתי אתה פנוי' (he.ts:1993), 'אתה גולש כאורח. הירשם כדי לשמור מחזורים' (he. | החבר שלו מביא גם את אשתו למשחק המעורב של שלישי. היא פותחת את אותה אפליקציה, מקבלת 'בוא נכיר' ו'אתה גולש כאורח' בשלושת המסכים הראשונים שלה, ומבינה תוך עשר שניות שהמוצר לא נכתב בשבילה — בלי שאף פיצ'ר חסם אותה. | לבחור קול אחד ולעבור על he.ts שורה-שורה. הזול ביותר שגם פותר את ההדרה: גוף שני רבים בכל האונבורדינג וההרשמה, כמו שהשקופיות כבר עושות — `he.ts:1794` → 'התחברו כדי לשמור מקום במשחק...', `he.ts:2839` → 'בואו נכיר', `he.ts:1993` → 'סמנו מתי אתם פנויים', `he.ts:1810-1811` → 'אתם גולשים כאורחים'. לפחות לת | medium |
| 53 | medium | מסך הבית מיד אחרי ההרשמה — /Users/matan/Projects/soccer/src/navigation | ה־BannerAd מסונן רק על `HIDE_ADS`, `ADS_ENABLED`, מתג ה-Pulse ו־`rcBool('banner_enabled')` (adsService.ts:515-519) — אין שום התחשבות בגיל החשבון. לעומת זאת לפרסומת ה-app-open יש בדיוק את ההגנה הזאת: `if (opts?.accountCreatedAt && Date.now() - opts.accountCreatedAt < rcNumber('app_open_new_user_grace | שלוש שניות אחרי שנועם השלים הרשמה — עוד לפני שהצטרף למועדון אחד או ראה מחזור אחד — הוא רואה כרטיס 'בוא נתחיל' עם חמש מטלות, ומתחתיו באנר פרסומת. הרושם הראשון מהמוצר הוא שהוא עוד לא קיבל כלום וכבר מוכרים לו. ההיגיון שכבר יושב בקוד לפרסומת אחת (אל תפגע במשתמש חדש) פשוט לא הוחל על השנייה. | ב־/Users/matan/Projects/soccer/src/services/adsService.ts, ברכיב BannerAd (סביב שורה 515), להוסיף בדיקה זהה ל-app-open: לקרוא את `createdAt` מ־`useUserStore.getState().currentUser` ולהחזיר null כל עוד `Date.now() - createdAt < rcNumber('app_open_new_user_grace_ms')`. מפתח Remote Config קיים, אין צור | trivial |
| 54 | medium | מסך הבית — src/screens/tabs/ProfileScreen.tsx:641-650 מול src/screens/ | הצעד הראשון בצ'קליסט הוא `homeStepPhoto: 'הוספת תמונת פרופיל'` (he.ts:1992), והסימון שלו הוא `done: !!user.photoUrl` (ProfileScreen.tsx:645). במסך "בוא נכיר" שקדם לו, בחירת אווטאר מתוך 24 האפשרויות (PostSignInOnboardingScreen.tsx:193-215) שומרת `avatarId` ומנקה `photoUrl` — כך שאווטאר לעולם לא מסמן  | הוא בחר אווטאר במסך הקודם כי האפליקציה הציעה לו 'או בחר אווטאר' (he.ts:2813) כחלופה שוות ערך. עכשיו המסך הראשי אומר לו שהוא 0/5 ושחסרה לו תמונת פרופיל. הוא מסיק שמה שעשה לא נשמר, נכנס שוב לפרופיל לבדוק, ומגלה שהאווטאר שם. האפליקציה שיקרה לו בדבר הראשון שהיא אמרה לו אחרי ההרשמה. | ב-`src/screens/tabs/ProfileScreen.tsx:645` לשנות ל-`done: !!user.photoUrl \|\| !!user.avatarId` (או, אם התמונה האמיתית חשובה, לשנות את `he.ts:1992` ל-'העלה תמונה אמיתית במקום האווטאר'). במקביל, `he.ts:1993` → 'סמן באילו ימים אתה פנוי — נודיע לך רק על משחקים שמתאימים לך', ו-`he.ts:1996` → 'שלח הזמנה  | small |
| 55 | medium | מסך הבית, בלוק אחרון לפני כפתור ההזמנה — src/screens/tabs/ProfileScree | homeTips הוא מערך קבוע של חמישה טיפים שמוצגים ללא תנאי (<DidYouKnowCard tips={homeTips} /> ב-:1376, מתחלף כל 6 שניות): 'אפשר ליצור כוחות מאוזנים אוטומטית לפי דירוג השחקנים', 'דירוג פנימי של שחקנים עוזר לאזן קבוצות הוגנות', 'סמן מתי אתה פנוי — ומנהלים יזמינו אותך למחזורים', 'אפשר לתזמן מראש מתי נפתחת | משתמש חדש גולל עד תחתית מסך הבית הריק ומקבל, כתוכן האחרון לפני 'הזמן חברים', קרוסלה שמסבירה לו איך לאזן כוחות לפי דירוג פנימי ואיך לתזמן פתיחת הרשמה. הוא לא מכיר אף שחקן באפליקציה ואין לו מועדון. במקום ללמד אותו מה לעשות עכשיו, הקרוסלה מלמדת אותו שהאפליקציה היא כלי ניהול למישהו אחר — ומחזקת בדיוק את | ב-src/screens/tabs/ProfileScreen.tsx:723 להפוך את homeTips לתלוי-מצב: `const homeTips: Tip[] = myCommunities.length === 0 ? NEW_USER_TIPS : homeTipsAdmin;`, כאשר NEW_USER_TIPS הם שלושה טיפים שמסבירים למי שאין לו מועדון מה קורה הלאה (איך נראית בקשת הצטרפות, שאפשר להצטרף למחזור פתוח בלי מועדון, ומה זה | small |
| 56 | medium | מסך ההתחברות עם מייל — /Users/matan/Projects/soccer/src/screens/auth/E | `const [mode, setMode] = useState<'signIn' \| 'signUp'>('signIn');`. הכותרת שנטענת היא `emailAuthSignInTitle: 'התחברות עם מייל'` (he.ts:1813), ה־CTA הוא `emailAuthSignInCta: 'התחבר'` (he.ts:1822), וכדי להירשם צריך למצוא את `emailAuthToggleToSignUp: 'אין לך חשבון? הרשמה'` (he.ts:1824) — קישור טקסט בת | עמית סיים עכשיו את שלוש שקופיות ההיכרות של אפליקציה שהתקין לפני 40 שניות. הוא בוחר 'המשך עם מייל' ומקבל מסך שכותרתו 'התחברות עם מייל' עם כפתור 'התחבר'. הוא ממלא מייל וסיסמה שהמציא, לוחץ 'התחבר' — ונופל על `emailAuthWrongCredentials: 'מייל או סיסמה שגויים'`. עכשיו הוא לא יודע אם הוא טעה בסיסמה של חשב | ב־/Users/matan/Projects/soccer/src/screens/auth/EmailAuthScreen.tsx:45 להתחיל ב־`useState<'signIn'\|'signUp'>('signUp')`, ובמקביל להעלות את מתג המצב לראש המסך כ־segmented control מעל שדה המייל (להזיז את הבלוק משורות 289-300 לתוך ה־ScrollView מעל שורה 178), כדי ששני הכיוונים יהיו גלויים במבט אחד ולא  | trivial |
| 57 | medium | מסך פרופיל שאחרי ההתחברות — src/i18n/he.ts:2839 ו-he.ts:2808-2809, נרנ | כותרת: `psoProfileTitle: 'בוא נכיר'`. מיד מתחתיה: `psoWelcomeBody: 'מארגנים כדורגל שכונתי בלי בלגן — הרשמה, ספסל, קבוצות, שוערים וטיימר.'`. שלוש בעיות באותן שתי שורות: (א) הכותרת פונה אליו ישירות בזכר יחיד והשורה מתחתיה בגוף סתמי-רבים ('מארגנים'), (ב) התוכן הוא פיץ' מוצר על מסך שהפעולה היחידה בו היא | הוא בדיוק לחץ "המשך עם Google", השם שלו כבר מולא אוטומטית, וכל מה שנשאר זה ללחוץ "המשך". במקום זה הוא מקבל כותרת שמבטיחה היכרות ורשימת חמישה מונחים. הוא עוצר לקרוא, לא מבין מה "ספסל" עושה כאן ומה הקשר לשם שלו, ומבזבז את שלוש השניות שבהן הוא עוד היה מוכן לשים תמונה. | ב-`src/i18n/he.ts:2808-2809` להחליף את `psoWelcomeBody` בשורה שמסבירה את המסך הזה בלבד: 'איך יקראו לך במגרש? ככה החברים יזהו אותך ברשימה.' ולוותר על הפיץ' — הוא כבר נאמר בשקופיות. אם קיימת הזמנה ממתינה, לשים שם את שם המועדון (ראו הממצא על המוזמן). | trivial |
| 58 | medium | מסך פרטי מחזור — src/screens/games/MatchDetailsScreen.tsx:333-335 | `const userIsIn = status !== 'none'` — ו-'pending' מקיים את התנאי. לכן כותרת כרטיס הסטטוס נקבעת ל-`matchStatusCardYouRegistered: 'אתה רשום למחזור'` (src/i18n/he.ts:3523) גם כשהבקשה עדיין ממתינה, בזמן שהתג בגיבור באותו מסך אומר `matchStatusPending: 'ממתין לאישור'` (:3050). בנוסף `primary` מחזיר null  | דני ביקש להצטרף למחזור של יום חמישי וקורא 'אתה רשום למחזור'. הוא מפסיק לחפש, מפנה את הערב, ומספר בבית שיש לו משחק. ביום חמישי הוא לא מופיע ברשימה — הבקשה נדחתה או שהמנהל פשוט לא נכנס לאפליקציה. מבחינת השעון של העדשה הזו זה הגרוע מכול: לא רק שהוא לא הגיע למחזור, הוא גם חדל לחפש אחד אחר בגלל מה שהמסך  | ב-src/screens/games/MatchDetailsScreen.tsx:333 לשנות ל-`const userIsIn = status === 'joined' \|\| status === 'waitlist';` ולהוסיף ענף `if (status === 'pending') title = he.matchStatusCardPending;` עם מחרוזת חדשה ב-src/i18n/he.ts בנוסח 'הבקשה שלך ממתינה לאישור המנהל' — כך שני הרכיבים באותו מסך יאמרו  | trivial |
| 59 | low | /Users/matan/Projects/soccer/src/i18n/he.ts:1793-1794 (מרונדר ב-SignIn | `signInTitle: 'בואו נתחיל'` (רבים) ומיד מתחתיו `signInSubtitle: 'התחבר כדי להירשם, להצטרף למועדון ולעקוב אחרי הסטטיסטיקות שלך.'` (זכר יחיד), ובמסך הבא `psoProfileTitle: 'בוא נכיר'` (זכר יחיד). כל שלושת הפריטים בתת-הכותרת הם פעולות שעל המשתמש לבצע — להירשם, להצטרף, לעקוב — ולא דברים שהוא מקבל. לא נאמ | שחקנית שקיבלה קישור מהמארגן מגיעה למסך שפונה אליה בשלוש צורות דקדוקיות שונות תוך שני מסכים, ואומר לה שהיא צריכה להתחבר כדי לעשות שלושה דברים — בלי לומר לה שזה חינם ובלי לומר לה שהיא יכולה קודם להסתכל. כל שלוש השורות הן דרישות; אין ולו הבטחה אחת בתמורה. | לשכתב את he.ts:1793-1794 לרגיסטר אחיד (רבים, כמו רוב הקופי החדש באפליקציה) ולהפוך את תת-הכותרת להבטחה: `signInTitle: 'בואו נתחיל'` / `signInSubtitle: 'חינם, בלי פרסומות בהתחלה — מתחברים פעם אחת ורואים את המחזור הבא של החבר׳ה.'` ולהתאים את he.ts:2839 ל-`בואו נכיר` כדי ששלושת המסכים ידברו באותו קול. | trivial |
| 60 | low | /Users/matan/Projects/soccer/src/screens/auth/SignInScreen.tsx:143-155 | `המשך כאורח` יוצר סשן אנונימי שלא כותב מסמך /users בכלל (buildGuestUser, userService.ts:44-53), מדלג על מסך הפרופיל ועל דיאלוג ההתראות (RootNavigator.tsx:240, :267), ומאפשר גלישה בפיד המשחקים, במועדונים הציבוריים ובפרטי משחק. החסימה מופיעה רק ברגע הפעולה, ובנוסח ספציפי לפעולה ולא גנרי: `כדי להירשם ל | זה החלק שלא עולה כלום — ולכן חשוב לומר אותו במפורש לפני שמישהו "ייעל" אותו. שחקן שקיבל קישור מחבר ורצה רק לראות אם יש מקום פנוי למחר יכול לעשות בדיוק את זה, בלי חשבון, ובלי שנכתבה עליו שורה אחת בשרת. כשהוא מחליט להירשם, הוא חוזר בדיוק לאותו משחק. זו התשובה הנכונה לשאלה "מה נתנו לפני מה שביקשנו", והי | לא לשנות את ההתנהגות. השינוי היחיד ששווה לשקול הוא ויזואלי בלבד: ב-SignInScreen.tsx:252-271 כפתור האורח מעוצב כטקסט אפור (styles.guestText) מתחת לשלושה כפתורים לבנים מלאים — להעלות אותו למשקל של כפתור outline, כדי שמי שלא רוצה לתת חשבון ימצא את הדרך שכבר הכנו לו. | trivial |
| 61 | low | /Users/matan/Projects/soccer/src/screens/onboarding/OnboardingScreen.t | שלוש החלטות קצב שכבר נלקחו נכון ומתועדות בקוד: הקיצוץ מארבע שקופיות לשלוש ('this trims to the 3 highest-signal pitches', שורות 1-6); `if (useUserStore.getState().currentUser) { ... }` ב־App.tsx:879 שמונע פרסומת app-open מהתקנה טרייה, עם נימוק מפורש בשורות 872-878; והאיחוד של welcome → how it works → | זו לא עלות אלא הגנה מפני 'שיפור' עתידי: אם יועץ חיצוני ימליץ להוסיף שקופית רביעית על סטטיסטיקות, או להחזיר כפתור התחברות לשקופית האחרונה, או להראות פרסומת app-open גם למשתמש חדש — כל אחת מההמלצות האלה תבטל שיפוט שכבר נעשה נכון פעם אחת, על בסיס ניסיון, ומתועד. מי שעובר על הפתיחה צריך לדעת שהחלקים האל | לא לשנות. ספציפית: להשאיר את SLIDES ב־OnboardingScreen.tsx:43-47 על שלושה פריטים, לא לגעת בתנאי ב־App.tsx:879, ולא לפצל מחדש את PostSignInOnboardingScreen. המחרוזות המתות שנשארו ב־he.ts:1777-1779 ו־1789-1790 (`onbStart`, `onbCtaSignIn`, `onbCtaSignInApple`, `onb4Title`, `onb4Body`) הן שרידי הגרסה הי | trivial |
| 62 | low | /app, /go, /session/*, /team/*, /i/* — /Users/matan/Projects/soccer/pu | The hero pairs `כדורגל קבוע. בלי כאב הראש של הארגון.` (:160) with a phone mock showing a real fixture screen (:167), then answers price, platform and language in seven words: `חינם · Android ו־iPhone · עברית מלאה` (:164). The `מ־40 הודעות למשחק אחד מסודר` section (:171-180) renders the reader's own  | This is what is working. A player tapping his organiser's link at 22:00 knows within three seconds what the app is, that it is free, that it runs on his phone, and that it is in Hebrew — and on iPhone he is never shown an error dialog as his first interaction with the brand, because someone chose th | Do not change public/invite.html's hero, problem section, store row, or the iOS branch at :231 — leave the comment in place so the decision survives. The only edit worth making here is the slightly stiff `כאב הראש של הארגון` at :160, where `הארגון` reads first as "the organisation" rather than "orga | trivial |
| 63 | low | public/downloads/teamder-0.2.5.aab | בתיקיית ההגשה הציבורית יושב `teamder-0.2.5.aab` — פורמט חבילה של Play, לא APK. אף דף בריפו לא מפנה אליו, אבל הוא מוגש ב-`https://teamderfc.web.app/downloads/teamder-0.2.5.aab` וניתן לאינדוקס. | מי שיחפש "Teamder הורדה" ויגיע לקובץ יוריד 40 מגה, ילחץ עליו, ויקבל מהאנדרואיד הודעה שאי אפשר לפתוח את הקובץ. הוא יסיק שהאפליקציה שבורה — וזו גם גרסת 0.2.5, קדם-היסטורית ביחס ל-1.1.10. | למחוק את public/downloads/ ולפרוס מחדש את האחסון, או להוסיף rewrite ב-firebase.json מ-`/downloads/**` אל `/get`. | trivial |
| 64 | low | public/get.html:52-70 (וגם public/c/index.html:1025-1032) | ‎get.html מזהה פלטפורמה כולל המקרה של אייפד שמדווח כמק (`(/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)`), מסתיר את הכפתור הלא רלוונטי, עושה `location.replace` מיידי לחנות הנכונה, ובכל זאת משאיר שני כפתורים גלויים עם `לא נפתח אוטומטית? בחר/י את החנות שלך למעלה.` — נוסח שהוא גם רשת ביטחון וגם | זה הדף שאדם מפוסט בפייסבוק פוגש, והוא מגיע לאפליקציה בזמן הקצר ביותר במשפך — בלי שגיאת סכמה, בלי המתנה, בלי כפתור חנות שגוי. הסיכון היחיד הוא ששיפור כללי של 'אחידות הדפים' יהרוס אותו. | לא לשנות את public/get.html. להשתמש בשורות 59-65 שלו כמקור להעתקה אל public/invite.html (הסתרת כפתור החנות הלא רלוונטי), ולהפנות אליו את שתי הקריאות לפעולה בדף הבית ואת קישור השגיאה ב-public/c/index.html:793. שווה גם להוסיף לו `&referrer=` לכתובת ה-Play בשורה 61 — כרגע כל התקנה משם היא אנונימית לחלו | trivial |
| 65 | low | src/screens/games/GamesListScreen.tsx:900-912 ו-:632-650; src/componen | כשאין מחזורים פתוחים ואין פילטרים פעילים, המסך לא מציג empty-state ענק וחלול. הוא מציג שתי שורות — `gamesNoOpenTitle: 'אין כרגע מחזורים פתוחים שמתאימים לך'` ו-`gamesNoOpenBody: 'אבל יש אנשים שרוצים לשחק — הנה איפה להתחיל'` — ומיד מתחתיהן את בלוק ה-discovery: AreaDemandCard ו-NearbyClubsSection. Near | זו לא עלות — זו הנקודה שממנה צריך למדוד את כל השאר. משתמש שמגיע לטאב הזה ואין אף מחזור עדיין רואה שלושה מועדונים אמיתיים עם שמות, ערים ומספרי שחקנים, ויכול להצטרף לאחד מהם בלחיצה בלי לעזוב את המסך. זו ההגדרה של מצב ריק שעובד. | לא לגעת בלוגיקה. שני תיקונים זעירים בלבד: (1) ב-src/i18n/he.ts:3371 להוריד את 'שמתאימים לך' — getOpenGames (src/services/gameService.ts:2547-2554) לא מסנן לפי עיר, מרחק או ימים, כך שהמילים האלה מבטיחות התאמה שלא קיימת ומשתמש בחיפה עלול לראות מחזור באילת; (2) להעתיק את אותו דפוס בדיוק למסך הבית (ראו  | trivial |
| 66 | low | טאב 'מחזורים' — src/screens/games/GamesListScreen.tsx:370-419; src/ser | לחיצה על `matchCardJoinShort: 'הצטרף'` בכרטיס מריצה `requestJoinGame` ישירות מהרשימה — בלי מעבר למסך פרטים, בלי טופס. הטוסט נגזר מה-bucket שחזר בפועל: `'הצטרפת למחזור'` / `'נוספת לרשימת המתנה'` / `'בקשת ההצטרפות נשלחה'` (:372-380). הכרטיס מתוקן אופטימית במקום ומתואם מחדש אחרי 2500ms, עם הערה שמסבירה | זה החצי שעובד. משתמש שכבר מצא מחזור מתאים עובר ממנו ל'אני רשום' בשתי הקשות ובלי אף שדה למלא, ורואה מיד את המצב האמיתי שלו — כולל המקרה הלא-נוח שבו הוא הגיע לרשימת ההמתנה. כל שאר הממצאים במסמך הזה עוסקים בכך שקשה להגיע *עד* לרגע הזה; הרגע עצמו מעוצב נכון. | לא לגעת. בפרט, אם מישהו יציע להוסיף כאן אישור ('האם אתה בטוח?') או לנתב את ההצטרפות דרך מסך הפרטים — זה יהפוך את המסלול המהיר היחיד באפליקציה למסלול של שלוש-ארבע הקשות. שווה לשמר את הדפוס הזה גם בהצטרפות למועדון מתוך NearbyClubsSection, שכבר עובדת באותה צורה (src/components/games/NearbyClubsSection. | trivial |
| 67 | low | טיפול בתשובת /invite-preview — public/invite.html:246, עם retarget() ב | כשהקוד מזהה `gpast` (סטטוס `finished`/`cancelled` או `startsAt < Date.now()`), הדף לא מציג שגיאה. אם למשחק יש `communityId` הוא קורא ל-`retarget('team', d.communityId)`, מחליף עותק ל-`הוזמנת להצטרף למועדון`, בונה צ'יפים של עיר ומספר חברים דרך `ctxCard(d.communityName\|\|'מועדון כדורגל', pc)`, ומדווח | זה המקרה שבו המערכת מרוויחה במקום להפסיד: מישהו מוצא בקבוצת וואטסאפ ישנה קישור למשחק מלפני שבועיים, לוחץ, ובמקום `הקישור כבר לא זמין` הוא מקבל הזמנה חיה למועדון עם שם, עיר ומספר חברים — והתקנה שלו עדיין תיזקף לזכות המזמין המקורי. קישור מת שווה אפס; הקישור הזה עדיין שווה חבר. | לא לשנות את ההתנהגות הזו. אם כבר — להרחיב אותה: ב-public/invite.html:246, כשאין `communityId` הקוד נופל ל-`toGeneric()`; שווה לשקול להציג שם במקום זאת רשימת משחקים פתוחים באזור. והכי חשוב — לוודא שכל שינוי עתידי בלוגיקת ה-preview שומר על הקריאה ל-`retarget()` לפני `applyV()`, כי היא זו ששומרת את היי | trivial |
| 68 | low | מסך השקופיות — /Users/matan/Projects/soccer/src/screens/onboarding/Onb | `{!isLast ? (<Pressable onPress={handleSkip} ...><Text style={styles.skip}>{he.onbSkip}</Text></Pressable>) : null}` — `onbSkip: 'דלג'` (he.ts:1775) קיים בשקופיות 1 ו-2 ונעלם ב-3, שם ה-CTA הוא `onbCtaStart: 'המשך'` (he.ts:1780). כלומר האזור הפינתי שהעין כבר למדה לחפש בו מתרוקן בדיוק בשקופית שבה המשת | תומר החליק שתי שקופיות במהירות, מחפש את 'דלג' בפינה בפעם השלישית ולא מוצא אותו — לרגע הוא חושב שהוא נתקע. בפועל 'המשך' עושה בדיוק אותו דבר, אבל הוא לא יודע את זה: 'המשך' נקרא כמו 'המשך בתהליך', לא כמו 'סיימנו'. בנוסף, בגלל שהדילוג נספר אנליטית רק דרך handleSkip (שורה 101), כל הנטישות מהשקופית האחרונ | ב־/Users/matan/Projects/soccer/src/screens/onboarding/OnboardingScreen.tsx:115 להסיר את התנאי `!isLast` כך ש'דלג' יופיע בשלוש השקופיות, ולשנות את `onbCtaStart` ב־he.ts:1780 מ'המשך' ל'יאללה, מתחילים' כדי שה-CTA האחרון ייקרא כסיום ולא כשלב נוסף. | trivial |
| 69 | low | מסך התחברות — src/i18n/he.ts:1799, נרנדר כ-Text רגיל ב-src/screens/aut | `signInPrivacy: 'באמצעות התחברות אתה מסכים לתנאי השימוש'` מרונדר כ-`<Text style={styles.privacy}>{he.signInPrivacy}</Text>` (SignInScreen.tsx:272) — לא Pressable, לא לינק, בלי שום ניווט. grep על he.ts מחזיר את זה כמחרוזת היחידה בנושא בכל תהליך ההרשמה, ומדיניות פרטיות לא מוזכרת בכלל, למרות ש-`public/ | הוא רואה משפט שאומר שהוא מסכים למשהו, מנסה ללחוץ עליו כדי לראות למה, ושום דבר לא קורה. זה לא עוצר אותו מלהמשיך, אבל זו הנקודה היחידה בכל המסלול שבה האפליקציה מבקשת ממנו אמון ואז מסרבת להראות לו את הבסיס לו — בדיוק לפני שהוא מוסר חשבון גוגל. | ב-`src/screens/auth/SignInScreen.tsx:272` לפצל לשני `Pressable` עם `Linking.openURL` לכתובות שכבר קיימות בהוסטינג, ולעדכן את `he.ts:1799` ל-'בהתחברות אתה מאשר את תנאי השימוש ומדיניות הפרטיות' עם שני המונחים כלינקים מודגשים. | small |
| 70 | low | מעל מסך הבית מיד אחרי ההרשמה — /Users/matan/Projects/soccer/src/servic | בהתקנה טרייה `seen` הוא null, ולוגיקת החלון היא `if (baseline) return compareVersions(v, baseline) > 0; return compareVersions(v, current) === 0;` — כלומר מוצגות ההדגשות של הגרסה הנוכחית. השער ב־App.tsx:1044-1051 דורש `splashDone && updateKind === 'none' && !!currentUserId && onboardingComplete` — ב | רועי סיים הרשמה, מגיע לבית בפעם הראשונה בחייו באפליקציה, ומקבל מודאל שמספר לו מה חדש ב-1.1.10 — גרסה שהוא מעולם לא היה בלעדיה. הוא צריך לסגור עוד חלון לפני שהוא רואה את המסך הראשון, והתוכן שלו חסר משמעות עבורו לחלוטין. זה הביט הרביעי ברצף (ספלאש שני → בית → צ'קליסט → מודאל) שעומד בין 'סיימתי להירשם' | ב־/Users/matan/Projects/soccer/src/services/whatsNewService.ts, בענף שבו `seen == null` (סביב שורות 78-84): להשוות את `currentUser.createdAt` לזמן הנוכחי, ואם החשבון נוצר בפחות מ-24 שעות — לקרוא ל־`storage.setWhatsNewSeenVersion(current)` ולהחזיר null בשקט. משתמש ותיק שעובר לראשונה לגרסה עם הפיצ'ר י | small |
| 71 | low | פוטר דף ההזמנה — public/invite.html:191 | `<a href="/terms.html">תנאי שימוש</a>`. `find` על כל הריפו לא מוצא שום קובץ `terms*`, ובפרודקשן שתי הכתובות מחזירות 404: `curl -o /dev/null -w "%{http_code}" https://teamderfc.web.app/terms.html` → 404, וכך גם `/terms`. זהו הקובץ שמשרת את `/app`, `/go`, `/session/**`, `/team/**` ו-`/i/**` — כלומר כל | שחקן זהיר שקיבל קישור ממישהו שהוא לא מכיר היטב רוצה לבדוק למי הוא מוסר פרטים לפני שהוא מוריד. הוא לוחץ על `תנאי שימוש` בפוטר ומקבל דף שגיאה גנרי של Firebase. הסיגנל שהוא מקבל הוא שהמוצר לא גמור, בדיוק ברגע שבו הוא חיפש אישור שהוא כן. | או ליצור `public/terms.html` על בסיס התבנית של `public/privacy.html` (אותו עיצוב, אותו פוטר), או — אם אין תנאי שימוש — להסיר את הקישור מ-public/invite.html:191 ולהשאיר רק `פרטיות`. אין סיבה להשאיר קישור מת בדף שכל משתמש חדש עובר דרכו. | small |
| 72 | low | שקופית אונבורדינג 3 — src/i18n/he.ts:1786; שגיאת מייל כפול — src/i18n/ | `onb3Body: 'מישהו ביטל? המקום מתמלא אוטומטית מרשימת ההמתנה עם תזכורות חכמות שדואגות שכולם יגיעו'` — עברית מדוברת, פותחת בשאלה שהאיש מכיר מהקבוצה שלו, ומתארת תוצאה ולא פיצ'ר. וכן `emailAuthAlreadyInUse: 'המייל הזה כבר רשום. אם נרשמת עם מייל וסיסמה — עבור להתחברות. אם נרשמת עם Google/Apple — חזור והשת | זה הרווח, לא העלות: כשהוא מגיע לשקופית השלישית הוא סוף סוף מזהה את הכאב שלו — הבן אדם שמבטל בערב המשחק. ובמסלול המייל, המקום היחיד שבו אנשים באמת נתקעים (נרשמתי פעם בגוגל או במייל?) הוא היחיד עם הודעה שפותרת את זה בלי לשאול אף אחד. | לא לגעת. ולהשתמש בשתי המחרוזות האלה כאמת מידה כשמתקנים את שאר הממצאים כאן — במיוחד `psoWelcomeBody` (he.ts:2808) ו-`signInSubtitle` (he.ts:1794), שנכתבו בדיוק בקול ההפוך. | trivial |


---

# Appendix · Screenshot index

Every frame in this document, in capture order. All are full-resolution 1080×2400 PNGs in
`~/Desktop/teamder-journey/shots/`; the embedded copies are downscaled.

| Prefix | What it shows | Frames |
|---|---|--:|

| `W1b` | Chrome first-run (device setup, not the product) | 1 |
| `P1` | Homepage `/` | 8 |
| `P2` | `/get` — redirects to Play on Android | 4 |
| `P3` | `/app` — the invite template | 6 |
| `P4` | `/i/<code>` personal invite | 3 |
| `P5` | `/i/<code>` game invite | 3 |
| `P6` | `/session/<gameId>` | 3 |
| `P7` | `/c/<clubId>` community page | 16 |
| `P8` | `/team/<clubId>` the other club page | 4 |
| `P9` | `/privacy` | 6 |
| `PA` | `/delete-account` | 3 |
| `S1` | Play Store listing | 1 |
| `S2` | Play listing, scrolled | 5 |
| `A1` | Cold start | 4 |
| `A2` | Onboarding carousel | 3 |
| `A3` | Sign-in screen | 1 |
| `A4` | Guest mode | 1 |
| `A5` | Guest tabs, first pass | 4 |
| `A6` | Availability modal | 1 |
| `A7` | Guest tabs, second pass | 4 |
| `B1` | Fresh launch | 1 |
| `B2` | Sign-in | 1 |
| `B3` | Email, sign-in mode | 1 |
| `B4` | Email, sign-up mode | 1 |
| `B5` | Form filled | 1 |
| `B6` | Password manager | 1 |
| `B7` | Post-signup | 1 |
| `B8` | Push prompt | 1 |
| `B9` | Profile screen | 1 |
| `C1` | Profile top | 1 |
| `C2` | Profile avatars | 1 |
| `C3` | Home, first paint | 1 |
| `C4` | Home, full | 2 |
| `D1` | Games tab, first open | 1 |
| `D2` | Availability modal | 1 |
| `D3` | Games feed | 1 |
| `D4` | Games feed scrolled | 10 |
| `E1` | Create-game gate | 1 |
| `F1` | Game detail | 1 |
| `F2` | Game detail scrolled | 3 |
| `G1` | Clubs tab | 10 |
| `H1` | Edit player card | 1 |
| `H2` | Invite share sheet | 1 |