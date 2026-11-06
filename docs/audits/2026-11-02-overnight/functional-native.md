# בדיקה תפקודית באנדרואיד, 3.11.2026

זהו סבב ממוקד של פעולות במוצר המקומי, בנפרד מסריקת התמונות וממארחי רכיבי המקור. היומן וסיכומי המקרים נמצאים ב-[קובץ הנתונים](functional-native.json). הצלחת מקרה אינה אישור שכל כפתור ומצב במסך נבדקו.

## סביבה וזמן

לפני קבוצות הפעולה נקראו `verify-runtime.js` ו-`platform.js`. התקבלו `USE_MOCK_DATA=true`, `FIREBASE_CONFIGURED=false`, כיווניות עברית וקנה מידה רגיל של גופן. המכשיר `Teamder_API_35`, מזהה `emulator-5554`, שרת ניפוי בפורט `5038` ושירות מקור מקומי בפורט `8081`. זו חבילת פיתוח קיימת `1.1.56-demo` עם מקור מקומי עדכני, לא בניית חנות חדשה ולא בדיקת אייפון.

כלי השעון החזיר `2026-11-02 22:56:10 UTC`. בקריאה מאוחרת יותר החזיר המכשיר `Mon Nov 2 22:56:44 GMT 2026`, ואזור הזמן שלו `GMT`. בישראל זה כבר 3.11.2026. לא שונו זמן או אזור זמן. תאריכי הדמו נבנים ביחס לשעון המכשיר ואינם ראיה לזמן שרת.

זהות ההתחלה הייתה `p7`. זהות `guest-mock` נבנתה בענף הדמו של שירות המשתמשים לצורך בדיקת אורח בלבד, עם גיבוי והשבה של הזהות וההקשר. לא נוצר חשבון אמיתי.

בסבב השלמה נפרד חודש אותו מכשיר במצב קריאה בלבד, ללא טעינת תמונת מצב וללא שמירתה. חבילת ההדגמה הקיימת הותקנה מחדש במופע הזמני, ושרת הפיתוח הופעל בדגלי דמו וניווט בדיקה. לא נבנה בינארי חדש. זהות המופע הטרי הייתה ריקה; `p7` נבחרה במתאם זהות מקומי והושבה לריקה לפני סגירת המכשיר. זמן המכשיר בסוף היה `Tue Nov 3 02:11:12 GMT 2026` ואזור הזמן `GMT`. לא שונו זמן או אזור זמן.

## היקף ותוצאות

נרשמו 42 מקרים: 41 עברו בגבולות המתוארים ו-1 מסומנים כלא בוצעו. רשימת המסלולים שקיבלו פעולה ממוקדת במכשיר נמצאת ב-`summary.verifiedProductRoutes`. פתיחת מסך ישירה משמשת להגעה בלבד. מארח רכיב מקור אינו מסך מוצר מלא.

המסלולים עם פעולה ממוקדת: `Profile`, `CommunitiesFeed`, `GamesList`, `ChatsList`, `MatchDetails`, `DirectChat`, `GameCreate`, `CommunityDetails`, `AvailabilityEdit`, `DraftSetup`, `ManagerDashboard`, `EveningSummary`, `AvailablePlayers`, `GuestHome`, `DraftBoard`, `Achievements`, `PlayerCompare`, `PlayerTimeline`, `CommunityPlayers`, `ProfileEdit`, `CommunityEdit`, `EmailAuth`, `Statistics`, `NotificationsSettings`. מסלולים חזותיים בלבד מהסבב: `PlayerCard`.

### `native-tabs-and-home-round-back`

עבר בגבולות המקרה.

מסלולים שנצפו בפועל: `Profile`, `CommunitiesFeed`, `GamesList`, `ChatsList`, `MatchDetails`.

פעולות ותוצאה:

- לחיצות במכשיר על מועדונים, מחזורים, חברים ובית; שמות המסלולים נקראו אחרי המעבר.
- לחיצה על פרטי המחזור מהבית וחזרת אנדרואיד החזירו לבית.

גבולות:

- לא נבדק כל מסלול עמוק מכל אחת מהלשוניות.

ראיה: יומן הפעולות וקריאות התוצאה בקובץ הנתונים.

### `direct-chat-from-real-friend-entry`

עבר בגבולות המקרה.

מסלולים שנצפו בפועל: `ChatsList`, `DirectChat`.

פעולות ותוצאה:

- נלחצו חברים, שיחה חדשה ואיתי לוי בממשק.
- נקרא convId=p7__qa-itay ונצפו הכותרת, מצב ריק יציב ושדה כתיבה.
- חזרת אנדרואיד החזירה לרשימת הבחירה.

גבולות:

- לא נשלחה הודעה.
- כלי עץ הנגישות לא הגיע למצב מנוחה בגלל תנועת המצב הריק. הצילום נפתח ונבדק.
- המסלול הישיר c1 מהסריקה הקודמת לא הוצג כהוכחת שיחה תקינה.

ראיות: [direct-chat-from-friend.png](../../../artifacts/overnight-2026-11-02/functional-native/direct-chat-from-friend.png).

### `game-wizard-three-steps-and-registration-validation`

עבר בגבולות המקרה.

מסלולים שנצפו בפועל: `GameCreate`.

פעולות ותוצאה:

- מגרש ריק חסם המשך והציג הסבר.
- המעבר מפרטים לחוקים ולמתקדם נעשה בלחיצות. נלחצו הגדלה והקטנה של מספר הקבוצות.
- זמן פתיחת הרשמה מאוחר מהמחזור הוזן במתאם להוראות השדה האמיתיות. לחיצה על יצירה ואישור הציגה תיקוף אמיתי.

גבולות:

- מגרש וכותרת בעברית וזמני הבדיקה הוזנו דרך props.set של שלב המקור, לא במקלדת המכשיר.
- נבדק תיקוף זמן הרשמה אחד; לא נבדקו כל השדות וכל צירופי הזמנים.

ראיות: [create-validation-after.png](../../../artifacts/overnight-2026-11-02/functional-native/create-validation-after.png).

### `game-created-with-partial-invitation-failure`

עבר בגבולות המקרה.

מסלולים שנצפו בפועל: `GameCreate`, `MatchDetails`.

פעולות ותוצאה:

- תוקנו שדות הטופס באמצעות הוראות השדה של המקור, ונבחרו שני מזהי חברי דמו.
- המשך ואישור יצירת המחזור נלחצו במכשיר. נוצר מחזור אחד והניווט הושלם לפרטיו.
- נקראו חזרה שתי קריאות: qa-itay החזיר invited:true; qa-daniel נכשל במתאם מקומי.
- המחזור נשאר קיים. שתי קבלות הדמו נשארו delivered:false.

גבולות:

- כשל הזמנה אחד הוזרק מקומית; אין הוכחת שרת או משלוח אמיתי.
- צילום הפרטים נשמר לאחר פקיעת ההודעה הזמנית ואינו מציג אותה.
- מתאם הקריאה המאוחרת הניח מבנה Promise שגוי ונכשל אחרי הצילום; ראיות הנתון והקריאות נשמרו בקריאה סינכרונית נפרדת.
- המחזור המקומי הוסר בהשבה מהגיבוי, לא באמצעות פעולת מחיקה במוצר.

ראיות: [create-partial-invitations-confirmed.png](../../../artifacts/overnight-2026-11-02/functional-native/create-partial-invitations-confirmed.png).

### `partial-invitation-feedback-source-component`

עבר בגבולות המקרה.

מסלולים שנצפו בפועל: מארח מקור בלבד, ללא מסלול מוצר עצמאי.

פעולות ותוצאה:

- במארח מקור מקומי נלחץ כפתור המציג את Toast המקורי עם אותו טקסט משוב.
- בוצע screencap מיד אחרי הלחיצה, בלי קריאת CDP או המתנת עץ בין הלחיצה לצילום.
- הצילום נפתח וההודעה המלאה נקראה.

גבולות:

- זו ראיית רכיב מקור נפרדת. אין זו תמונת רגע היצירה או הוכחת משלוח.

ראיות: [create-partial-toast.png](../../../artifacts/overnight-2026-11-02/functional-native/create-partial-toast.png).

### `community-tabs-and-actual-invite-sheet`

עבר בגבולות המקרה.

מסלולים שנצפו בפועל: `CommunityDetails`.

פעולות ותוצאה:

- נפתחה לשונית שחקנים במועדון g1.
- תפריט המועדון נפתח ונלחצה הזמנת חברים למועדון.
- נצפו שני חברי דמו וכפתור שליחה מושבת ללא בחירה; חזרת אנדרואיד סגרה את החלון.
- נלחצה לשונית סטטיסטיקות ונצפה תוכן עונה 2.

גבולות:

- לא נשלחה הזמנה, לא אושר חבר ולא נערך מועדון.
- חלונית זו היא של המועדון; מסך AddMembers של מחזור לא נחשב כיסוי שלה.
- לא נבדק שיתוף כרטיס עונת המועדון.

ראיות: [club-invite-real-sheet.png](../../../artifacts/overnight-2026-11-02/functional-native/club-invite-real-sheet.png).

### `player-card-singular-copy`

עבר בגבולות המקרה.

מסלולים שנצפו בפועל: `PlayerCard`.

פעולות ותוצאה:

- כרטיס p1 נפתח דרך מסלול בדיקה ונצפה הטקסט: 12 מחזורים משותפים, מועדון אחד משותף.

גבולות:

- זה אימות חזותי של הכרטיס בלבד. פעולות חברות, הזמנה והודעה לא נלחצו בכרטיס זה.

ראיות: [player-card-singular-after.png](../../../artifacts/overnight-2026-11-02/functional-native/player-card-singular-after.png).

### `empty-games-and-filter-sheet`

עבר בגבולות המקרה.

מסלולים שנצפו בפועל: `GamesList`.

פעולות ותוצאה:

- הוזרקו תשובות ריקות מקומיות לארבע שיטות רשימת מחזורים ולמונה הזמינות.
- נצפה מצב הרשימה הריקה עם כותרות מיושרות לימין וכרטיס הגדרת אזור.
- סינון נפתח בלחיצה וחזרת אנדרואיד סגרה אותו.
- שיטות השירות המקוריות הושבו באמצעות restore-fixtures.js.

גבולות:

- לא הופעל חיפוש מיקום ולא נבחרו תוצאות רשת.
- צילום המצב הריק הוא מצב מוכוון בנתוני בדיקה, לא ראיה שחשבון ייצור ריק.

ראיות: [games-empty-rtl-after.png](../../../artifacts/overnight-2026-11-02/functional-native/games-empty-rtl-after.png).

### `availability-grid-missing-area-and-unsaved-copy`

עבר בגבולות המקרה.

מסלולים שנצפו בפועל: `AvailabilityEdit`.

פעולות ותוצאה:

- הופעל המתג הגדרת אזור הבית שלי במכשיר, ללא בחירת מיקום.
- בוצעה גלילה במכשיר. נצפו שמות ימים בצד ימין וכפתור תחתית ללא חפיפת בועת עזרה.
- לחיצה על שמור העדפות הציגה אזהרה אמיתית שעדיין לא נבחר אזור בית.
- ניסיון לעזוב העלה מלל תמונה שגוי. לאחר תיקון הסוכן המקביל, אותו שחזור הציג שינוי זמינות.
- נבחר התעלם וצא עבור הטיוטה המקומית בלבד.

גבולות:

- לא נבחרו קואורדינטות ולא נשמר מיקום.
- לא נבדקה שמירת זמינות מול שרת או בקשת הרשאת מיקום.

ראיות: [availability-enabled-days-after.png](../../../artifacts/overnight-2026-11-02/functional-native/availability-enabled-days-after.png), [availability-home-area-warning-after.png](../../../artifacts/overnight-2026-11-02/functional-native/availability-home-area-warning-after.png), [availability-unsaved-wrong-copy-before.png](../../../artifacts/overnight-2026-11-02/functional-native/availability-unsaved-wrong-copy-before.png), [availability-unsaved-copy-after.png](../../../artifacts/overnight-2026-11-02/functional-native/availability-unsaved-copy-after.png).

### `join-open-round`

עבר בגבולות המקרה.

מסלולים שנצפו בפועל: `MatchDetails`.

פעולות ותוצאה:

- נפתח gv2-8 שאינו מכיל את p7.
- נלחץ הצטרף למחזור. נצפו נרשמת למחזור ו-4 מתוך 10 במקום 3 מתוך 10.
- נתון הדמו נקרא חזרה: p7 נוסף ל-players, בלי רשימת המתנה.

גבולות:

- בדיקה מקומית מנותקת בלבד. לא בוטלה הרשמה דרך פעולה הרסנית. הנתון הושב מהגיבוי.

ראיות: [round-joined-local.png](../../../artifacts/overnight-2026-11-02/functional-native/round-joined-local.png).

### `join-full-round-waitlist`

עבר בגבולות המקרה.

מסלולים שנצפו בפועל: `MatchDetails`.

פעולות ותוצאה:

- נפתח gv2-2 המלא עם 14 רשומים ועוד 2 אורחים.
- התנגשות מועדים עם מחזור דמו אחר חסמה תחילה הצטרפות כצפוי.
- הוזז startsAt בזיכרון המקומי בלבד לתאריך שאין בו התנגשות.
- נלחץ הצטרף לרשימת המתנה. נצפה מקום 1, והנתון נקרא חזרה: p7 ב-waitlist ולא ב-players.

גבולות:

- הסגל נשאר 14 רשומים ועוד 2 אורחים. אין טענה לעלייה למקום מאושר.
- המועד וההרשמות הושבו מהגיבוי בסיום.

ראיות: [round-waitlist-local.png](../../../artifacts/overnight-2026-11-02/functional-native/round-waitlist-local.png).

### `random-team-draft-creation`

עבר בגבולות המקרה.

מסלולים שנצפו בפועל: `DraftSetup`, `DraftBoard`.

רק במסלולים אלה הופעל פקד: `DraftSetup`.

פעולות ותוצאה:

- בוצעה גלילה ובחירה בחלוקה אקראית במכשיר.
- נלחצו לחלוקת הקבוצות וצור כוחות.
- התקבל DraftBoard עם 9 שחקנים בשתי קבוצות 5 ו-4.
- טיוטת המקור נקראה חזרה עם published:false.

גבולות:

- דירוג פנימי כבוי במועדון הדמו ולכן אפשרות אוטומטית הוצגה מושבתת.
- שחקן שיצא הביתה כבר היה בנתוני הדמו לפני סבב זה;9 הם שחקני החלוקה שנצפו.
- לא פורסמו קבוצות, לא הופעלו בחירת קפטנים או עריכה ידנית בסבב זה.
- פקדי DraftBoard עצמו לא נלחצו. הוא נצפה כתוצאת יצירת הטיוטה, בלי אימות תפקודי של פקדיו.
- הטיוטה הושבה מהגיבוי.

ראיות: [random-draft-created-local.png](../../../artifacts/overnight-2026-11-02/functional-native/random-draft-created-local.png).

### `manager-tabs-and-score-detail`

עבר בגבולות המקרה.

מסלולים שנצפו בפועל: `ManagerDashboard`.

פעולות ותוצאה:

- בלוח מנהל g1 נלחצו ציוד ודירוגים.
- נלחץ הצג נתונים, נצפו חמש שורות ציון, ונלחץ סגור.

גבולות:

- לא נערכו דירוגים, ציוד, הרשאות או תפקידים.

ראיות: [manager-data-sheet-after.png](../../../artifacts/overnight-2026-11-02/functional-native/manager-data-sheet-after.png).

### `personal-summary-explanation-and-system-share`

עבר בגבולות המקרה.

מסלולים שנצפו בפועל: `EveningSummary`.

פעולות ותוצאה:

- בסיכום qa-summary-top נלחץ איך מחושב ציון המחזור והחלון נסגר בהבנתי.
- בוצעה גלילה לכפתור שתף את הסיכום ונלחץ הכפתור המקורי.
- אנדרואיד פתח בחירת שיתוף תמונה עם תמונה ממוזערת. חלון המערכת נסגר בחזרה.

גבולות:

- לא נבחר נמען ולא נשלח תוצר.
- התמונה הממוזערת במערכת נבדקה, אך קובץ התמונה הארוך לא נפתח בנפרד ברזולוציית המקור.
- נתוני הסיכום הם נתוני דמו.

ראיות: [personal-score-explanation.png](../../../artifacts/overnight-2026-11-02/functional-native/personal-score-explanation.png), [personal-summary-share-outcome.png](../../../artifacts/overnight-2026-11-02/functional-native/personal-summary-share-outcome.png).

### `available-players-full-gate-filters-and-cancel`

עבר בגבולות המקרה.

מסלולים שנצפו בפועל: `AvailablePlayers`.

פעולות ותוצאה:

- במחזור מלא נצפה הסבר הזמנה ידנית להמתנה וכפתור שלח לכולם בפעימות disabled=true בעץ המכשיר.
- נלחצו טרם הוזמנו ובאותה עיר.
- במחזור פנוי נפתח חלון האישור המקורי בלחיצה על פעימות ונלחץ בטל.

גבולות:

- לא הופעל משלוח פעימות ולא נשלחה הזמנה ידנית.
- בנתוני התאריך המקומיים לא נמצאו מועמדים; פעולות על כרטיס מועמד לא נבדקו.
- החלפת gameId באותו מופע בזמן בקשה נבדקה במבחני מקור של הסוכן המקביל, ולא שוחזרה במכשיר.

ראיות: [available-players-full-guard-after.png](../../../artifacts/overnight-2026-11-02/functional-native/available-players-full-guard-after.png), [available-players-pulse-confirm-local.png](../../../artifacts/overnight-2026-11-02/functional-native/available-players-pulse-confirm-local.png).

### `guest-home-account-and-auth-gate`

עבר בגבולות המקרה.

מסלולים שנצפו בפועל: `GuestHome`, `Profile`.

פעולות ותוצאה:

- שירות הדמו בנה guest-mock ומצב הזהות המקומי הוחלף זמנית, עם גיבוי זהות והקשר.
- בבית האורח נלחץ החשבון שלי, ובפרופיל האורח נלחצה הרשמה.
- נפתחה חלונית התחברות מקורית, נסגרה בחזרת אנדרואיד, וזהות p7 וההקשר הושבו.

גבולות:

- אין יצירת חשבון אמיתי ואין התחברות לספק זהות.
- סיום הכניסה הראשונית סומן בזיכרון הבדיקה כדי להגיע לבית האורח; הערך המקורי הושב.

ראיות: [guest-home-local-identity.png](../../../artifacts/overnight-2026-11-02/functional-native/guest-home-local-identity.png), [guest-account-gate-local.png](../../../artifacts/overnight-2026-11-02/functional-native/guest-account-gate-local.png), [guest-contextual-auth-sheet.png](../../../artifacts/overnight-2026-11-02/functional-native/guest-contextual-auth-sheet.png).

### `signin-source-host`

עבר בגבולות המקרה.

מסלולים שנצפו בפועל: מארח מקור בלבד, ללא מסלול מוצר עצמאי.

פעולות ותוצאה:

- נפתח מסך המקור במארח הפיתוח הקיים ונסגר בחזרת אנדרואיד.

גבולות:

- לא נלחצו ספק התחברות, דואר או יצירת חשבון.

ראיות: [signin-source-host.png](../../../artifacts/overnight-2026-11-02/functional-native/signin-source-host.png).

### `profile-setup-source-host`

עבר בגבולות המקרה.

מסלולים שנצפו בפועל: מארח מקור בלבד, ללא מסלול מוצר עצמאי.

פעולות ותוצאה:

- נלחץ לכל הדמויות במכשיר במארח הפיתוח הקיים. נצפתה הרחבת מבחר האווטארים והחלון נסגר בחזרה.

גבולות:

- כפתור הצג פחות ירד מחוץ לתחום הגלוי. הכיווץ, בחירת דמות ושמירה לא נבדקו.

ראיות: [profile-setup-expanded-source-host.png](../../../artifacts/overnight-2026-11-02/functional-native/profile-setup-expanded-source-host.png).

### `entry-intent-readonly-host`

עבר בגבולות המקרה.

מסלולים שנצפו בפועל: מארח מקור בלבד, ללא מסלול מוצר עצמאי.

פעולות ותוצאה:

- נצפה רכיב הכניסה עם הזמנת p1 וארבע אפשרויות, במארח הקיים.

גבולות:

- המארח מוגדר pointerEvents=none. אין בו בדיקת לחיצה או בחירה עסקית.

ראיות: [entry-intent-readonly-source-host.png](../../../artifacts/overnight-2026-11-02/functional-native/entry-intent-readonly-source-host.png).

### `post-signin-source-host`

עבר בגבולות המקרה.

מסלולים שנצפו בפועל: מארח מקור בלבד, ללא מסלול מוצר עצמאי.

פעולות ותוצאה:

- נצפה מסך המקור במארח מקומי ונסגר בחזרת אנדרואיד.

גבולות:

- לא בוצעה הרשמה, שמירה, העלאת תמונה או שינוי פרופיל.

ראיות: [post-signin-source-host.png](../../../artifacts/overnight-2026-11-02/functional-native/post-signin-source-host.png).

### `bidi-source-dictionary-host`

עבר בגבולות המקרה.

מסלולים שנצפו בפועל: מארח מקור בלבד, ללא מסלול מוצר עצמאי.

פעולות ותוצאה:

- רכיב Text מקורי קרא ל-he.roundSummaryPairText עם דני ו-Eliran ועם דני ואלירן, ובשני המקרים 2 שערים.
- הצילום נפתח ונבדק, והבדיקה נסגרה בכפתור המקורי של המארח.

גבולות:

- זה מארח מחרוזת מקור, לא סיכום סטטיסטיקה מלא.

ראיות: [bidi-source-native.png](../../../artifacts/overnight-2026-11-02/functional-native/bidi-source-native.png).

### `wizard-date-picker-and-auto-team-time`

עבר בגבולות המקרה.

מסלולים שנצפו בפועל: `GameCreate`.

פעולות ותוצאה:

- בורר מועד המחזור נפתח בלחיצה, נסגר בחזרת אנדרואיד ונפתח שוב. נבחר יום 6 בנובמבר ונלחץ אישור; ערך startsAt נקרא חזרה כ-2026-11-06.
- פרטי טיוטה בעברית הוזנו דרך מתאם props.set מפורש. נלחצו שני שלבי המשך.
- ערך autoTeamsAt מאוחר מתחילת המחזור, ולאחריו ערך בעבר, הוזנו באמצעות מתאם ערך בלבד. בכל פעם נלחצו יצירת מחזור ואישור ויצירה, ונצפתה אזהרת התיקוף המתאימה במקום כתיבה.

גבולות:

- דירוג פנימי כבוי בנתוני המועדון המקוריים, ולכן המתג האוטומטי עצמו נשאר מושבת. נבדק תיקוף תוצאת הטופס, לא יצירת כוחות מתוזמנת או ביצוע שרת.
- לא נוצר מחזור. לא הופעלו משימות תזמון, ודגלי המועדון לא שונו.

ראיות: [gap-round-datetime-picker.png](../../../artifacts/overnight-2026-11-02/functional-native/gap-round-datetime-picker.png), [gap-round-date-selected.png](../../../artifacts/overnight-2026-11-02/functional-native/gap-round-date-selected.png), [gap-auto-teams-after-start.png](../../../artifacts/overnight-2026-11-02/functional-native/gap-auto-teams-after-start.png), [gap-auto-teams-past.png](../../../artifacts/overnight-2026-11-02/functional-native/gap-auto-teams-past.png).

### `captain-manual-and-published-team-modes`

עבר בגבולות המקרה.

מסלולים שנצפו בפועל: `DraftSetup`, `DraftBoard`, `MatchDetails`.

פעולות ותוצאה:

- במכשיר נבחרה בחירת קפטנים, נבחרו אלין ואלרואי ונבחר סדר מומלץ.
- בוצעו שבע בחירות שחקן באמצעות הקשות מקוריות. בגלל הנפשה רציפה העץ לא התייצב, ולכן גבולות הפקדים נמדדו ברכיבי המקור ונוסף היסט שורת מצב שנקרא מהמערכת. מצב המקור אישר שבעה מזהים שנבחרו, בלי הפעלת callbacks כתחליף להקשה.
- נלחץ סיים חלוקת כוחות ונקראה טיוטה שמורה עם תשעה שחקנים בשתי קבוצות 4 ו-5 ו-published:false.
- נפתח ערוך את הכוחות הקיימים, נלחץ שיבוץ נדב ונבחרו האדומים. נלחצה שמירת טיוטה, ונקראו קבוצות 5 ו-4 עםp4 בקבוצה האדומה בלבד.
- בלשונית שחקנים נלחץ פרסם כוחות, נקרא חלון האישור ונלחץ פרסם. בענף הדמו המקורי נקרא published:true; אין פעולת התראה בענף זה.

גבולות:

- בדמו בלבד, ללא מסירה או שרת. נתוני המחזור ומפתח הטיוטה המקומי גובו לפני השמירות ויושבו בסיום.
- שחקן שיצא הביתה היה במקור ולכן השתתפו תשעה מתוך עשרה רשומים.
- שגיאות הבודק נשמרו בנפרד: היסט מדידה חסר וקריאת רכיב יציאה שטרם סיים הנפשה. הן לא הוצגו כבחירה מאומתת עד קריאת מצב המקור.
- לא נבדקו גרירה, החלפת שחקן בקבוצה מלאה או פרסום לחשבונות אמיתיים.

ראיות: [gap-captain-draft-summary.png](../../../artifacts/overnight-2026-11-02/functional-native/gap-captain-draft-summary.png), [gap-manual-player-moved.png](../../../artifacts/overnight-2026-11-02/functional-native/gap-manual-player-moved.png), [gap-teams-published-local.png](../../../artifacts/overnight-2026-11-02/functional-native/gap-teams-published-local.png).

### `real-authentication-and-server-results`

לא בוצע או אינו מאומת בסבב זה.

מסלולים שנצפו בפועל: מארח מקור בלבד, ללא מסלול מוצר עצמאי.

גבולות:

- לא נוצר חשבון אמיתי, לא בוצעה התחברות לספק, ולא נבדקו מסירה, הרשאות או כתיבת ייצור.

ראיה: יומן הפעולות וקריאות התוצאה בקובץ הנתונים.

### `secondary-achievements`

עבר בגבולות המקרה.

מסלולים שנצפו בפועל: `Achievements`.

פעולות ותוצאה:

- נלחצו הישגים אישיים ואריח שערים; החלון נסגר בחזרת אנדרואיד.
- נלחצה תארי עונה והתוכן נקרא בחזרה.

גבולות:

- לא נוצר או הוענק הישג.

ראיות: [secondary-achievement-detail.png](../../../artifacts/overnight-2026-11-02/functional-native/secondary-achievement-detail.png).

### `secondary-player-compare-tabs`

עבר בגבולות המקרה.

מסלולים שנצפו בפועל: `PlayerCompare`.

פעולות ותוצאה:

- נלחצו ראש בראש ויחד והטקסט נקרא אחרי כל מעבר.

גבולות:

- בחירת תקופה ושיתוף טרם נבדקו.

ראיות: [secondary-player-compare-together.png](../../../artifacts/overnight-2026-11-02/functional-native/secondary-player-compare-together.png).

### `secondary-player-timeline`

עבר בגבולות המקרה.

מסלולים שנצפו בפועל: `PlayerTimeline`.

פעולות ותוצאה:

- נלחצו מסנני ציוד והכול; התוכן נקרא בחזרה.

גבולות:

- לא בוטל אירוע ולא נלחץ כרטיס משמעת.

ראיה: יומן הפעולות וקריאות התוצאה בקובץ הנתונים.

### `secondary-roster-filters-and-search`

עבר בגבולות המקרה.

מסלולים שנצפו בפועל: `CommunityPlayers`.

פעולות ותוצאה:

- נלחצו מנהלים ושחקנים ונקראו התוצאות.
- הוקלד zzzz במכשיר ונצפה מצב ללא תוצאות, ואז נוקה החיפוש במחיקה מקורית והסגל חזר.
- אפשרויות שחקן נפתחו ונסגרו בחזרת אנדרואיד.

גבולות:

- לא שונה חבר, תפקיד, דירוג או ציוד.

ראיות: [secondary-roster-search-empty.png](../../../artifacts/overnight-2026-11-02/functional-native/secondary-roster-search-empty.png).

### `conflict-pending-native-back-source-host`

עבר בגבולות המקרה.

מסלולים שנצפו בפועל: מארח מקור בלבד, ללא מסלול מוצר עצמאי.

פעולות ותוצאה:

- ברכיב המקור עם cancelBusy=true חזרת אנדרואיד סגרה לפני התיקון.
- אחרי התיקון חזרת אנדרואיד ולחיצה ברקע לא סגרו את החלון.
- כל callbacks היו מקומיים והמארח הוסר דרך מתאם הפיתוח בסיום.

גבולות:

- אין ביטול הרשמה, הצטרפות או שירות אמיתי.
- מצב ההמתנה חיצוני קבוע; הבטחה מקומית ונעילות נוספות מכוסות בבדיקות המקור של סוכן העיצוב, לא בסבב מכשיר זה.

ראיות: [conflict-busy-before.png](../../../artifacts/overnight-2026-11-02/functional-native/conflict-busy-before.png), [conflict-busy-before-back-closed.png](../../../artifacts/overnight-2026-11-02/functional-native/conflict-busy-before-back-closed.png), [conflict-busy-after-back-blocked.png](../../../artifacts/overnight-2026-11-02/functional-native/conflict-busy-after-back-blocked.png).

### `secondary-profile-edit-empty-name`

עבר בגבולות המקרה.

מסלולים שנצפו בפועל: `ProfileEdit`.

פעולות ותוצאה:

- השם רוקן באמצעות פקדי מקלדת מקוריים במכשיר.
- נצפה שם הוא שדה חובה וכפתור שמור והמשך מושבת.

גבולות:

- לא נשמר פרופיל. שם ריק אינו נחשב שינוי שם לשמירה בקוד הקיים.

ראיות: [secondary-profile-name-required.png](../../../artifacts/overnight-2026-11-02/functional-native/secondary-profile-name-required.png).

### `secondary-community-edit-empty-name`

עבר בגבולות המקרה.

מסלולים שנצפו בפועל: `CommunityEdit`.

פעולות ותוצאה:

- שם המועדון רוקן במקלדת המכשיר.
- כפתור המשך נבדק כמושבת. ניסיון יציאה פתח שומר ונבחר התעלם וצא.

גבולות:

- לא נלחצה שמירה ולא נכתב מועדון. מעקף תיקוף אפשרי דרך שמירה בחלון היציאה נמסר לראשי כממצא קוד, בלי הפעלה.
- לאחר מכן נבדקה גם שמירת היציאה ונחסמה הטיוטה הלא תקינה ללא ניסיון כתיבה, כמפורט במקרה האימות אחרי.
- לאחר מכן נבדקה גם שמירת היציאה ונחסמה הטיוטה הלא תקינה ללא ניסיון כתיבה, כמפורט במקרה האימות אחרי.

ראיות: [secondary-community-name-required.png](../../../artifacts/overnight-2026-11-02/functional-native/secondary-community-name-required.png).

### `secondary-email-empty-validation`

עבר בגבולות המקרה.

מסלולים שנצפו בפועל: `EmailAuth`.

פעולות ותוצאה:

- בטופס ריק נלחצו הרשמה וכניסה. נבדקו כפתורי יצירת חשבון וכניסה לחשבון כמושבתים.
- נלחצה עין סיסמה ריקה.
- שכחת סיסמה בטופס ריק הציג תיקוף כתובת, והחלון נסגר בהבנתי.

גבולות:

- לא הוזנו כתובת או סיסמה, לא נלחץ ספק זהות ולא נשלחה בקשת איפוס.

ראיות: [secondary-email-empty-validation.png](../../../artifacts/overnight-2026-11-02/functional-native/secondary-email-empty-validation.png).

### `secondary-finished-round-tabs`

עבר בגבולות המקרה.

מסלולים שנצפו בפועל: `MatchDetails`.

פעולות ותוצאה:

- במחזור שהסתיים נלחצו משחקים, סטטיסטיקות ושחקנים.
- התוכן ושמות המסלולים נקראו אחרי המעברים.

גבולות:

- לא שונתה תוצאה ולא הופעל תיקון שערים. הרחבות שאינן קיימות בלשוניות אלה לא הומצאו.

ראיה: יומן הפעולות וקריאות התוצאה בקובץ הנתונים.

### `secondary-statistics-share`

עבר בגבולות המקרה.

מסלולים שנצפו בפועל: `Statistics`.

פעולות ותוצאה:

- בוצעה גלילה ונלחץ שתף את הכרטיס שלי.
- חלון שיתוף התמונה של אנדרואיד נפתח ונקרא, ונסגר בחזרה.

גבולות:

- לא נבחר נמען ולא נמסר תוצר.
- זה מסך הנתונים המקומיים הרגיל ללא qaStatisticsPreview.

ראיות: [secondary-statistics-system-share.png](../../../artifacts/overnight-2026-11-02/functional-native/secondary-statistics-system-share.png).

### `secondary-player-compare-scope`

עבר בגבולות המקרה.

מסלולים שנצפו בפועל: `PlayerCompare`.

פעולות ותוצאה:

- מציגים נפתח, ונקראו כל הזמנים ועונה 1.
- אותו פקד נלחץ שוב ואפשרויות התקופה נעלמו.

גבולות:

- לא נבחרה תקופה ולא שותפה השוואה.

ראיה: יומן הפעולות וקריאות התוצאה בקובץ הנתונים.

### `draft-team-light-label-contrast-source-host`

עבר בגבולות המקרה.

מסלולים שנצפו בפועל: מארח מקור בלבד, ללא מסלול מוצר עצמאי.

פעולות ותוצאה:

- נפתח מארח עם שני DraftTeamCard מקוריים בענף הרגיל עבור הלבנים והצהובים.
- צילומי לפני ואחרי נפתחו ונבדקו. אחרי שינוי הצבע הכותרות כהות וקריאות, והנקודה והמסגרת נשארו בצבע הקבוצה.

גבולות:

- מארח רכיב מקור בלבד, לא משחק או חלוקה מלאים.
- אין שינוי נתונים או צבעי חולצות.

ראיות: [draft-team-contrast-before.png](../../../artifacts/overnight-2026-11-02/functional-native/draft-team-contrast-before.png), [draft-team-contrast-after.png](../../../artifacts/overnight-2026-11-02/functional-native/draft-team-contrast-after.png).

### `community-invalid-exit-save-after`

עבר בגבולות המקרה.

מסלולים שנצפו בפועל: `CommunityEdit`.

פעולות ותוצאה:

- שם המועדון רוקן במקלדת המכשיר.
- נפתחה אזהרת יציאה ונלחץ שמור.
- המסך נשאר בפרטים עם שם ריק, הסבר חסר והמשך מושבת.
- קריאה חוזרת הראתה אפס קריאות לשירות השמירה המוגן. הטיוטה נזרקה בהתעלם וצא.

גבולות:

- השירות הוחלף מקומית במחסום המתעד ודוחה כל כתיבה; לא הגיע אליו ניסיון.
- לא נבדקה שמירה תקינה ולא נכתב מועדון.

ראיות: [community-invalid-exit-save-after.png](../../../artifacts/overnight-2026-11-02/functional-native/community-invalid-exit-save-after.png).

### `availability-invalid-exit-save-after`

עבר בגבולות המקרה.

מסלולים שנצפו בפועל: `AvailabilityEdit`.

פעולות ותוצאה:

- הופעל אזור בית בלי בחירת מיקום.
- נפתחה אזהרת יציאה ונלחץ שמור.
- התקבלה אזהרה עדכנית שלא נבחר אזור בית, ואפס קריאות למחסום השמירה.
- הטיוטה נזרקה ללא שמירה.

גבולות:

- persistAvailability הוחלף מקומית במחסום כגיבוי לבדיקת האפס; לא הגיע אליו ניסיון.
- לא נבחרו קואורדינטות ולא נשמר אזור.

ראיות: [availability-invalid-exit-save-after.png](../../../artifacts/overnight-2026-11-02/functional-native/availability-invalid-exit-save-after.png).

### `cover-upload-pending-source-host`

עבר בגבולות המקרה.

מסלולים שנצפו בפועל: מארח מקור בלבד, ללא מסלול מוצר עצמאי.

פעולות ותוצאה:

- לפני התיקון הופעלה העלאה מקומית, נלחץ התא השני וחזרת אנדרואיד. קריאה חזרה הראתה c02, העלאה פעילה ובורר סגור.
- אחרי התיקון אותן פעולות השאירו c01, העלאה פעילה ובורר פתוח.
- המארח הוסר דרך מתאם הפיתוח וההבטחה המקומית נוקתה.

גבולות:

- כל העלאה הייתה Promise מקומי, בלי גלריית מכשיר, שירות או כתיבה.
- מיקום התא נקרא בעץ לפני התחלת ההעלאה; סידור הגלריה נשמר בצילום ההמתנה.
- שחרור לאחר סיום העלאה נבדק במבחני המקור של הסוכן, לא במכשיר בסבב זה.

ראיות: [cover-upload-before.png](../../../artifacts/overnight-2026-11-02/functional-native/cover-upload-before.png), [cover-upload-before-closed-confirmed.png](../../../artifacts/overnight-2026-11-02/functional-native/cover-upload-before-closed-confirmed.png), [cover-upload-after.png](../../../artifacts/overnight-2026-11-02/functional-native/cover-upload-after.png).

### `season-record-loading-error-source-host`

עבר בגבולות המקרה.

מסלולים שנצפו בפועל: מארח מקור בלבד, ללא מסלול מוצר עצמאי.

פעולות ותוצאה:

- במארח SeasonClubSummary המקורי הוזרקו טעינה ממתינה וכשל קריאה עבור מזהה סינתטי בלבד.
- לפני התיקון שניהם הציגו אין נתון מתועד.
- אחרי התיקון נצפו ענפי טעינה וכשל נפרדים. נלחץ נסה שוב וחזרה הודעת הכשל המקומי.
- מתאם הקריאה הושב בפירוק כל מארח.

גבולות:

- אלה מצבי רכיב מקור עם נתונים סינתטיים, לא כשל שרת אמיתי ולא מסך עונה מלא.
- לא בוצעה כתיבה או שליחה.

ראיות: [season-record-loading-before.png](../../../artifacts/overnight-2026-11-02/functional-native/season-record-loading-before.png), [season-record-error-before.png](../../../artifacts/overnight-2026-11-02/functional-native/season-record-error-before.png), [season-record-loading-after.png](../../../artifacts/overnight-2026-11-02/functional-native/season-record-loading-after.png), [season-record-error-after.png](../../../artifacts/overnight-2026-11-02/functional-native/season-record-error-after.png).

### `secondary-manager-workspace-not-completed`

עבר בגבולות המקרה.

מסלולים שנצפו בפועל: `ManagerDashboard`.

פעולות ותוצאה:

- נלחץ לתמונת המוכנות המלאה, נצפה סעיף מוכנות למחזור וחזרת אנדרואיד החזירה לסקירה.
- בוצעה גלילה ונלחץ לסגל ולהרגלי ההרשמה. נפתח שחקן מתוך שורת מידע ניהולי במכשיר.
- נצפה מידע ניהולי על שחקן, וחזרת אנדרואיד החזירה לתמונת הסגל בתוך אותו מסך.

גבולות:

- לא נערך דירוג, ציוד, תפקיד, בקשה או רישום.
- הבדיקה משלימה את סעיף סביבת המנהל שהתעכב בסבב הראשון, ואינה טענה לכל סעיפי המנהל.

ראיות: [gap-manager-player-workspace.png](../../../artifacts/overnight-2026-11-02/functional-native/gap-manager-player-workspace.png).

### `secondary-notification-settings-not-executed`

עבר בגבולות המקרה.

מסלולים שנצפו בפועל: `NotificationsSettings`.

פעולות ותוצאה:

- שער הרשאת המערכת המקורי נצפה והמתגים נבדקו כמושבתים. לא נלחץ אפשר התראות.
- תשובת getPushPermissionStatus הוחלפה בזיכרון בלבד ל-available:false. נלחץ מתג בקשות הצטרפות, נצפה false ונלחץ שמור הגדרות.
- קריאה חוזרת אישרה joinRequest:false בחנות המשתמש והמסלול Profile.
- לאחר הפעלה מחדש נבדק גם ניווט מוצר רגיל: תפריט הבית, התראות, שמירה ללא שינוי, חזרה לבית, פתיחה חוזרת מאותו תפריט וחזרת אנדרואיד. כל השלבים נקראו חזרה, ללא מתאם הרשאה וללא בקשת הרשאת מערכת.

גבולות:

- שירות השמירה המקורי בדמו אינו כותב למסד, והתצוגה בחנה העדפה מקומית בלבד.
- פתיחה מחדש מיד לאחר מכן נכשלה עם שגיאת Fabric addViewAt בחבילת הדמו הקיימת. גבול זה לא סומן כעובר.
- לא נלחצו מעקב, שיווק או הרשאת מערכת. הפעלה מחדש של חבילת הדמו הסירה את המתאם ואת נתוני המשתמש הזמניים.
- שגיאת Fabric מהניסיון הראשון לא חזרה במסלול התפריט הרגיל. סיבתה אינה ידועה, ואין לייחס אותה בוודאות לבינארי או לכלי הניווט.

ראיות: [gap-notifications-native-gate.png](../../../artifacts/overnight-2026-11-02/functional-native/gap-notifications-native-gate.png), [gap-notifications-draft.png](../../../artifacts/overnight-2026-11-02/functional-native/gap-notifications-draft.png), [gap-runtime-diagnostic.png](../../../artifacts/overnight-2026-11-02/gap-runtime-diagnostic.png), [gap-notifications-normal-menu-reopened.png](../../../artifacts/overnight-2026-11-02/functional-native/gap-notifications-normal-menu-reopened.png).

## צילומים, מתאמים וסקר חלונות

כל תמונות הסבב נשמרו בתיקיית `artifacts/overnight-2026-11-02/functional-native` חדשה. צילומי `native-final` ו-`census` לא נדרסו.

שני קבצים נשמרו כראיות ניסיון בלבד: `create-partial-invitations-after.png` מציג תיקוף חוזר אחרי כשל במתאם, ו-`partial-invitation-toast-source-host.png` מציג מארח אחרי פקיעת ההודעה. ההודעה המלאה והגלויה נשמרה בקובץ החדש `create-partial-toast.png`, בלי שינוי צילום קודם.

כשלים במתאמי הבדיקה נשמרו ביומן ולא סומנו כתקלה במוצר. המנוע לא קיבל תחביר `async` גולמי; הבטחה של סביבת הטלפון לא נקראה כמו הבטחה מקורית של המנפה; וכמה פקדים טרם נטענו או ירדו מחוץ לתחום הגלוי. עצי נגישות של תנועה מתמשכת לא תמיד הגיעו למנוחה. לא סומנה פעולה שלא הושלמה.

סקר 51 חלונות המקור נשמר בנפרד ב-[נתוני הצילום](../../../artifacts/overnight-2026-11-02/overlay-final/captures.json). הסקר פתח קישורי פיתוח קיימים, צילם ושמר עצים, ללא לחיצה עסקית. כל 51 הענפים זוהו ברכיב המקור;49 עצים היו עדכניים ושני כלים לא הגיעו למנוחה. שלושה פריטים הם פקדי פתיחה בלבד, ללא החלון הפנימי. סקירת הצילומים מחולקת בין הסוכנים; צילום וזיהוי ענף אינם אימות תפקודי של זרימה מלאה.

בהשלמה נפתח בורר המועד המקורי ונבחר יום, נבדקו שני זמני חלוקה לא תקינים, הושלמו קפטנים ושמירת טיוטה, הועבר שחקן בעריכה ידנית ופורסמו הכוחות בדמו. שבע בחירות השחקן היו הקשות אנדרואיד מקוריות. בגלל הנפשה רציפה שלא אפשרה עץ נגישות במנוחה, חלק מהגבולות נקראו באמצעות `measureInWindow` של רכיבי המקור עם היסט שורת המצב שנמדד במערכת. קריאות תוצאה מוקדמות כללו רכיב יציאה מונפש; רק לאחר קריאת מצב המקור נספרו שבע הבחירות. לא הופעל `onPress` במקומן.

לאחר פרסום מקומי מוצג נוסח ההצלחה הכללי שמזכיר התראה, אך ענף הדמו של `publishDraftTeams` משנה רק `published` ולא שולח התראה. הצילום אינו ראיית מסירה.

בניסיון הראשון לפתוח שוב את הגדרות ההתראות נצפתה שגיאת `Fabric addViewAt` ונעצר חיבור המנפה. [צילום האבחון](../../../artifacts/overnight-2026-11-02/gap-runtime-diagnostic.png) נשמר. לאחר חידוש חבילת הדמו נבדק גם מסלול התפריט הרגיל: פתיחה, שמירה ללא שינוי, חזרה, פתיחה חוזרת וחזרה. השגיאה לא חזרה בו. סיבתה אינה ידועה ולא שונה מקור בעקבותיה. שינוי המתג עצמו נבדק קודם עם מתאם תשובת הרשאה מקומי, ללא בקשת הרשאת מערכת.

## השבה ומסירה

בסבב הראשון המחזור החדש, ההרשמה, ההמתנה, המועד שהוזז והטיוטה הושבו מהגיבוי המקומי. נותרו 16 מחזורי הדמו המקוריים וזהות `p7`. מתאם ההזמנה הוסר, ושיטות הרשימות והיצוא המוחלף של חלונות המקור הושבו. קבלות התראות דמו שלא נמסרו והשיחה המקומית הריקה נשארו אז בזיכרון השירות. אין משלוח חי.

בסבב ההשלמה נקראו חזרה נתוני המשחקים, המחזורים ההיסטוריים, המועדונים והמשתמש ונמצאה התאמה מלאה לגיבוי. מפתח הטיוטה המקומית הושב ונקרא כריק כפי שהיה בגיבוי; לא נותר מתאם. זהות ההתחלה הריקה והקשר המועדון הריק הושבו ללא פעולת יציאה מחשבון. האימולטור ושרת הפיתוח נסגרו מסודר. מזהי התהליכים היו `10688` למפעיל האימולטור, `21548` למכשיר ו-`1840` לשרת הפיתוח. קריאה אחרי הסגירה לא מצאה את התהליכים, מאזין בפורט `8081` או מכשיר בשרת הבדיקה. [קבלת הסגירה](../../../artifacts/overnight-2026-11-02/gap-environment-closed.json). לא שונה מקור או מבחן בסבב זה.

השליטה באימולטור הוחזרה במפורש לסוכן הראשי לאחר סגירת המארחים ואימות ההשבה.

תוצאות הבדיקות הכוללות והמסירה מרוכזות ב-[דוח המשימה](../../changes/2026-11-03-overnight-mission.md).
