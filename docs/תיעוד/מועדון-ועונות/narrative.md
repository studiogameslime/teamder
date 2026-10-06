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

