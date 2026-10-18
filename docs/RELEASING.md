# Shipping an Android build to Google Play

## הפצה פנימית1.1.56 — 18.10.2026

הבעלים אישר מחזור בדיקה נוסף ובנייה והגשה פנימית. `1.1.56/289` הוגשה ואומתה במסלול הפנימי, ממקור נקי `96e94cf3066c5bcafa80fc304f654f025ea90872`. הייצור נשאר `1.1.46/279`, ויתר המסלולים ללא שינוי. עברו4,961 בדיקות יישום, בדיקת טיפוסים,213 אימותי נתונים במחזור חדש של11 מול11 ובדיקות הרכיב המקורי; שדרוג מקומי שימר חשבון וסשן, והתראת בדיקה אחת התקבלה ונפתחה.38 התיקונים שויכו לגרסה ביומן השחרורים. אין קידום לייצור. [תוצאות, מקור, צילומים ומגבלות](changes/2026-10-18-internal-1.1.56.md).

שתי הראיות שחסרו בדוח ההכנה הקודם הושלמו: בינארי מקורי חדש, ורצף שימור בסיס→מעבר→השלמה קבועה→החזרה מול השרת. התקנת הבדיקה נגזרה מאותה חבילת ההגשה ונחתמה בחתימת הבדיקה הקיימת; אינה הוכחת שדרוג דרך Play. בדיקת מכשיר פיזי ושדרוג בחתימת החנות נשארות הצעד המומלץ לפני החלטת ההפצה של הבעלים. אין אישור לפריסה או קידום נוסף הנובע מהתיעוד הזה.

## השלמת חסמי מוכנות — 18.10.2026

הושלמו שמירת הכרעה חלופית ופנדלים באותה עסקה, מניעת כפילות יצירה ושחזור טיוטה אחרי תשובה שאבדה, קישור סדרה שבועית אטומי ותיקון סשן חסר ברכיב ההתראות המקורי באנדרואיד. `commitRoundStats` ו־`createGroupCallable` נפרסו ואומתו מול136 קבצים;95 הפונקציות האחרות לא השתנו. עברו4,961 בדיקות יישום ב־417 חבילות, בדיקת טיפוסים ו־352 בדיקות כללים בסדרה. הכללים נשארו ללא שינוי.

אין בנייה, הגשה או קידום מסלול במסגרת הכנה זו. נדרשת גרסה פנימית חדשה כדי לבדוק את רכיב האנדרואיד המתוקן ואת הלקוח מול השרת המעודכן; לקוחות ישנים אינם מקבלים אטומיות חלופית מן התאימות בלבד. מצב הבדיקות, הראיות והפערים לפני ייצור מרוכזים ב־[דוח ההשלמה](changes/2026-10-18-production-blockers.md).

## ביקורת מקצה לקצה ופריסת תיקונים — 18.10.2026

תחילה הועלתה כל העבודה הקיימת למאגר, ואחריה בוצעה ביקורת הכוחות, הלייב, הסיכומים והכניסה. שלושת מחזורי הבדיקה החדשים הסתיימו מול השרת האמיתי. נפרסו באישור רק `commitRoundStats` ו־`onGameRosterChanged`, ומקור שתיהן אומת מול הקבצים המקומיים. לא שונו כללים ולא בוצעו בנייה, העלאה או קידום מסלול. שינויי הלקוח החדשים עדיין דורשים בינארי חדש ובדיקת המסלול הפנימי לפני החלטת ייצור. [הדוח, הראיות, כשל ההרכב שנשמר ומגבלות האימות](changes/2026-10-18-preproduction-end-to-end.md).

## הפצה פנימית 1.1.55 — 17.10.2026

הועלתה ואומתה `1.1.55 / 288` במסלול הפנימי באנדרואיד. הייצור נשאר `1.1.46 / 279`, ושאר המסלולים ללא שינוי. כל 16 דיווחי בדיקת 1.1.53 טופלו, כולל עיצוב החלוניות ובדיקת מסך קטן בגופן 140%. `onGameRosterChanged` נפרסה באישור מפורש, והסיכום המדווח התאושש אוטומטית ללא כתיבת תיקון ידנית. 4,494 בדיקות יישום ו־350 בדיקות כללים עברו. שגיאת ספק ההתראות ובדיקות מכשיר שלא בוצעו נשארות פתוחות. [הפצה, ראיות ומגבלות](changes/2026-10-17-internal-1.1.55.md).


## הפצה פנימית 1.1.53 — 17.10.2026

הועלתה ואומתה `1.1.53 / 286` במסלול הפנימי באנדרואיד. הייצור נשאר `1.1.46 / 279`, ויתר המסלולים ללא שינוי. נפרסה רק `ensurePersonalGroup` ונבדקו שירותי החברים והפרטיות; כללי ההרשאות הפעילים נשמרו לתאימות. 4,480 בדיקות יישום ו־347 בדיקות כללים עברו. כוללת את חלונית עדכון החנות ותמונת התמיכה המקורית. [מקור, בדיקות, אישור גוגל ומגבלות](changes/2026-10-17-internal-1.1.53.md).


## סקירת הכנה לגרסה פנימית — 17.10.2026

נבדקו השינויים המקומיים וכל 73 פריטי הפולס הפתוחים שאינם רעיונות חונים. הוכנו שבעה תיקונים חדשים; עברו 4,450 בדיקות יישום ו־347 בדיקות הרשאות, לצד טיפוסי הלקוח, השרת והפולס. אין בנייה או העלאה בסבב זה. [דוח, ראיות, מגבלות והחלטות מוצר](changes/2026-10-17-preinternal-audit.md).

בעת סקירת ההכנה `ensurePersonalGroup` כללה עסקה אטומית מקומית שטרם נפרסה. הסטטוס הזה הוחלף בהפצת1.1.53 לעיל, וב־18.10 אומת שוב שגוף הפונקציה הפעיל זהה לתיקון המקומי. בדיקות הקוד ההיסטוריות אינן מוכיחות שתוקנו רישום רכיב ספק ההתראות, אי־התגובה ללחיצות במכשיר המדווח וכניסת אפל. משטר התאימות של הכללים והפצת החברים נשמר כמתואר להלן.

## הכנת שרת בלבד — 17.10.2026

באישור מפורש נפרסו שמונה שירותים: שמירת משחק, חתימת סיכום, הוספה וביטול של גול בדיעבד, קליטת בקשות הצטרפות ותיעוד תהליך הכניסה. כללי ההרשאות נשארו ללא שינוי לשמירת תאימות. לא נבנתה ולא הועלתה גרסה פנימית. [היקף, אימות מקור, בדיקות ומגבלות](changes/2026-10-17-server-preparation.md).

## עדכון אחרון — 15.10.2026

גרסה פנימית `1.1.50/283` הושלמה ואומתה בגוגל; הייצור נשאר `1.1.46/279` ויתר המסלולים לא השתנו. נפרסה שליחת התמיכה האנושית ונבנה פולס `1.0.95/102`. כללי ההרשאות לא ננעלו, לשמירת תאימות הלקוחות הישנים. [מקור, בדיקות וגבולות ההפצה](changes/2026-10-15-internal-1.1.50.md).

## הפצה קודמת — 13.10.2026

גרסה פנימית `1.1.49/282` הושלמה ואומתה בגוגל; הייצור נשאר `1.1.46/279`. נפרסו תשעה שירותים לתיקונים שאושרו, תוך שמירת התאימות וללא נעילת כללי ההרשאות. פירוט המקור, הבדיקות, הפריסה והחלופה לשמירת היסטוריית היומן: [יומן ההפצה](changes/2026-10-13-internal-1.1.49.md). זו ההפצה המאוחרת שמחליפה את סטטוס ״טרם נפרס״ במסמכי התיקונים המקומיים הרלוונטיים; אינה פריסה של כל היקף האבטחה העתידי.

The exact sequence, as actually run for 1.1.32 (versionCode 267) on
06.10.2026. Read [`AGENTS.md`](../AGENTS.md) §6 first — the rules there
override anything convenient you find here.

---

## What you need before you start

| | Where it lives | Notes |
|---|---|---|
| **EAS login** | `eas login` → `studiogameslime` | **This is what unlocks the Android keystore.** |
| **Android keystore** | On Expo's servers, not on disk | Build Credentials `Qlpwp6SIuv`. **Irreplaceable** — lose it and this app can never be updated again, only republished under a new package name. |
| **Play service account** | `credentials/gplay-service-account.json` | Gitignored. Must be copied by hand onto any new machine. |
| **Build env vars** | The EAS `preview` environment | Pulled down by the build; nothing to do locally. |
| `.env.local` | Repo root, gitignored | Only needed to RUN the app locally, not to build a release. |
| **Toolchain** | Node 20, Java 17 | Verified working combination. |

Check you are ready:

```bash
npx eas whoami                              # must print studiogameslime
ls credentials/gplay-service-account.json   # must exist
java -version                               # 17
```

---

## 1. Before the build

<a id="social-privacy-release"></a>

### הפצת חברים ופרטיות — הנחיה לבקשת הגרסה הבאה

ב־11.10.2026 הבעלים הורה: ״פעם הבאה שאנחנו אומרים לך להעלות גרסה,
תטפל במה שצריך ותפרוס את זה״. זו הרשאה מתועדת לפריסת השינויים הבאים
כחלק מבקשת העלאת הגרסה הבאה, ללא בקשת אישור חוזרת על אותו היקף.
אין לפרוס עכשיו מכוח ההנחיה בלבד. מסלול החנות ייקבע לפי בקשת ההפצה;
בקשה פנימית אינה אישור למסלול ייצור.

- לפרוס את `getPlayerIdentities`, `getMyPlayerReferrals`,
  `findAvailableSocialPlayers`, `checkSocialMessaging`,
  `sendSocialFriendRequest`, `searchSocialPlayers`, `getSocialPlayerProfile`,
  `setSocialPrivacy`, `inviteSocialPlayerToClub`, ואת עדכוני
  `acceptFriendRequest` ו־`sendGameInvite`.
- לכלול את שינויי `firestore.rules` שאושרו לפיצ׳ר זה, לאחר בדיקת ההבדל
  בפועל. ההנחיה אינה אישור אוטומטי לכל שינוי אחר שנוסף לקובץ המשותף.
- לבדוק מחדש טיפוסים, בדיקות כלליות, מלוא כללי המסד בסדרה ובדיקות
  הפונקציות המקומיות. לפרוס את השירותים הדרושים לפני שהלקוח החדש תלוי בהם.
- לתאם את החלפת ההרשאות עם הפצת הלקוח: גרסאות ישנות קוראות מסמכי
  משתמש פרטיים לצורך סגלים, ולכן פריסת הכללים לבדם תפגע בהן. אין לנעול
  את הכללים לפני שנקבע ונבדק פתרון תאימות או עדכון לקוחות. אם הדבר דורש
  שינוי מדיניות מוצר שלא הוסכם, להציג את ההחלטה הנדרשת לבעלים.
- לאמת אחרי הפריסה סגלים, חברים, הפניות, חיפוש, פרטיות והודעות, ולרשום
  מה נפרס ומה נבדק בפועל. אין לסמן בדיקה מקומית כאימות בייצור.

היקף המימוש והראיות: [השלמת הרשאות החברים והפרטיות](changes/2026-10-11-social-permissions-proposal.md).
אין בהנחיה אישור להסבת נתוני ייצור או לשינויים שאינם קשורים לפיצ׳ר.

**Read the production error log and triage it.** This is a gate, not a
courtesy — ask before fixing anything you find.

```bash
TOKEN=$(gcloud auth print-access-token)
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
 "https://firestore.googleapis.com/v1/projects/soccer-app-52b6b/databases/(default)/documents:runQuery" \
 -d '{"structuredQuery":{"from":[{"collectionId":"errors"}],
      "orderBy":[{"field":{"fieldPath":"lastSeen"},"direction":"DESCENDING"}],"limit":40}}'
```

Errors are keyed by `lastSeen`, not `createdAt`. An item is open unless its
`status` is `resolved`.

**See what is live right now**, so you know what the next version number is:

```bash
python3 scripts/play-tracks.py    # prints every track + versionCode
```

**Bump the version.** Edit `expo.version` in `app.json` by hand. The
`versionCode` is NOT in `app.json` — EAS increments it remotely
(`autoIncrement: true`), so leave it alone.

**Green before you build:**

```bash
npx tsc --noEmit
npx jest
```

---

## 2. Build

A local build. The cloud quota is exhausted, and local is what the last
several releases used.

```bash
EAS_BUILD_NO_EXPO_GO_WARNING=true npx eas build \
  --platform android --profile production --local \
  --output /tmp/teamder-<version>.aab --non-interactive
```

- `--profile production` here selects the **build** profile. It does not mean
  the production track; that is decided at submit time.
- Expect ~8 minutes. A build that had to re-run `prebuild` recompiles the
  native libraries through CMake and takes longer than one that did not.
- Confirm in the log: `Incremented versionCode from N to N+1`, then
  `BUILD SUCCESSFUL`.

---

## 3. Submit — internal, not production

```bash
npx eas submit --platform android --profile internal \
  --path /tmp/teamder-<version>.aab --non-interactive
```

> **The trap that has already cost one accidental production release:**
> `eas.json` keeps SEPARATE build and submit profile lists. On *submit*,
> `--profile production` means the production **track**. For an internal
> upload the profile is `internal`. Read the `Release track:` line the
> command prints back before it starts.

> **Never query the Play API while a submit is running.** It opens an edit of
> its own and deletes the one fastlane is holding, failing the submit.

Promoting internal → production happens only on the owner's explicit
approval, and is a separate action.

---

## 4. Verify — from Play, not from the EAS log

```bash
python3 scripts/play-tracks.py
```

Confirm `internal` now carries the new version and versionCode, and that
`production` has **not** moved.

Also confirm the binary came from the commit you think it did. A release has
already gone out frozen at a pre-fix commit while everyone believed
otherwise — compare the build time against `git log` in UTC, and prefer
building from a clean tree so the commit is a real anchor.

---

## 5. After the ship

**Log every change to `appConfig/releaseLog`**, same turn. Any visual change
carries a proof screenshot: write the JPEG base64 to `releaseShots/{id}` and
reference it from the item's `shotId`.

**Prune the Pulse versions tab.** Keep, for each surface, its live version and
anything newer, plus `next`; drop the rest. The floor is the oldest version
still live in a store — on 06.10.2026 that was iOS 1.1.22, so everything
below it went.

---

## iOS, in one line

`eas submit -p ios` only reaches TestFlight. The App Store version must also
be created and submitted through the App Store Connect API — there is a
script for it under `~/.teamder-update-watch/`. A crash-on-launch justifies
asking Apple for an expedited review.

## בדיקת קבצים מקומית לפני התחלת שחרור

אפשר להריץ בדיקה שאינה בונה, אינה מגישה ואינה פונה לרשת:

```powershell
node scripts/release-preflight.cjs --platform android --build-profile production --submit-profile internal
node scripts/release-preflight.cjs --platform ios --profile production
```

פרופילי הבנייה וההגשה נפרדים בכוונה: למסלול הפנימי באנדרואיד בונים בפרופיל `production` ומגישים בפרופיל `internal`. ניתן להוסיף `--json` לפלט מובנה. קוד יציאה 1 מציין קובץ חסר; קוד 0 מעיד רק על קיום הקבצים שנבדקו, ולא על תקפות חתימה, הרשאות חנות או תקינות הבנייה. הסקריפט אינו מציג מפתחות או סיסמאות.

ב־10.10.2026 במחשב Windows הנוכחי בדיקת Android עברה את בדיקות קיום הקבצים. בדיקת iOS מצאה שני חסרים: `credentials.json`, הנדרש משום שהפרופיל מגדיר חתימה מקומית, ומפתח ההגשה שמופיע ב־`eas.json` בנתיב `/Users/matan/.teamder-update-watch/AuthKey_SQBY46Q3DC.p8`. יש להשלים חתימה ומפתח אמיתיים במקום ליצור נתיבים או מפתחות מדומים, או לבצע את שלב Apple במחשב שבו האישורים זמינים. זו תמונת מצב מקומית מתוארכת; יש להריץ שוב לפני בנייה.


## תיקון הזמנות — מקור מקומי 11.10.2026

לקראת ההפצה הבאה יש לכלול גם את [מסלול ההזמנות ואישור ההצטרפות](changes/2026-10-11-invitation-admission.md): פונקציות ההזמנה, `joinSocialClub`, `getReceivedInvitations`, `reconcileJoinsTask`, יצירת מחזור חוזר ושינוי כללי `games/{id}/joinRequests`. אישור המשימה הנוכחית הוא למימוש ולהרשאות מקומיות בלבד; לא בוצעה פריסה. יש לבדוק את היקף אישור הפריסה בעת בקשת הגרסה ולהתאים את הלקוח לשרת לפני שחרור. הזמנת מחזור ישנה ללא grant מפורש אינה אישור מראש, משום שאותו שדה ישן כולל גם מועמדי השלמה.


## הפצה מדורגת 1.1.47 — אישור הבעלים

בהפצה הפנימית נשמרת תאימות לגרסאות הישנות. הקריאה החדשה לדירוג נעשית דרך `getClubAdminRatings` והעדכון דרך `setClubAdminRating`. דגל השרת `TEAMDER_LEGACY_CLUB_RATINGS_COMPAT=true` משאיר את `groups.adminRatings` כמקור הנתונים המשותף, בלי יצירת עותק פרטי ובלי הסבת נתוני ייצור. מנהל רשאי לקרוא ולעדכן; חבר קורא רק כשהדירוג גלוי; משתמש חיצוני אינו רשאי לקרוא. כללי ההרשאות המחמירים והסבת הדירוגים נדחים להפצה נפרדת, ולכן אין לראות בשלב זה סגירה מלאה של פרצות ההרשאות. אכיפת אימות מקור האפליקציה נשארת כבויה. כניסת פולס החדשה וביטול מפתחותיה אינם חלק מההפצה הזו.

היקף פונקציות ההפצה המדורגת: `getPlayerIdentities`, `getMyPlayerReferrals`, `findAvailableSocialPlayers`, `checkSocialMessaging`, `sendSocialFriendRequest`, `searchSocialPlayers`, `getSocialPlayerProfile`, `setSocialPrivacy`, `inviteSocialPlayerToClub`, `joinSocialClub`, `getReceivedInvitations`, `recordClientError`, `setClubAdminRating`, `getClubAdminRatings`, `acceptFriendRequest`, `sendGameInvite`, `inviteFriendsToGroup`, `promoteOrphanToGroup`, `reconcileJoinsTask`. כללי מסד הנתונים, פונקציות סגירת העונות, שער הניהול החדש לפולס וביטול מפתחות אינם נפרסים בשלב הזה. תיקוני העונות שבקוד המקומי מחייבים הפצה נפרדת ומתואמת; אין לסמן אותם כתיקוני שרת שכבר עלו.

הבקרה האוטומטית דחתה את הכללת `cronEvery5Min` משום שזו פונקציה מתוזמנת רחבה. היא הוצאה מההפצה; 19 הפונקציות הממוקדות בלבד נכללות, ללא שינוי התהליך המתוזמן.

שרת הניהול העתידי לפולס הופרד לנקודת כניסה `functions/src/pulseEntry.ts` שאינה מיוצאת מהפריסה של טימדר. כך פריסה ממוקדת של טימדר אינה דורשת סודות פולס שטרם הוגדרו. פריסת פולס העתידית תחייב הגדרת נקודת כניסה נפרדת וסודות מורשים; לא נוצרו סודות ולא בוטלו מפתחות קיימים.


## הפצה פנימית 1.1.51 — 15.10.2026

הופצה ואומתה 1.1.51 / 284 במסלול הפנימי באנדרואיד. הייצור ושאר המסלולים נשארו כפי שהיו. חמש פונקציות ממוקדות נפרסו ואומתו, ללא כללים או הסבת נתונים; נשמרה תאימות לגרסאות הישנות. הבנייה בוצעה מקומית בגלל מכסת הענן, ונחתמה בתעודת ההעלאה הקיימת. פירוט מקור, בדיקות ומגבלות: [דוח ההפצה](changes/2026-10-15-internal-1.1.51.md).


## הפצה פנימית 1.1.52 — 15.10.2026

הופצה ואומתה 1.1.52 / 285 במסלול הפנימי. הייצור נשאר 1.1.46 / 279. [מקור, בדיקות ומגבלות](changes/2026-10-15-internal-1.1.52.md).
