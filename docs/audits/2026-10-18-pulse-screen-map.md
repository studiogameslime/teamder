# מיפוי מפורט של מסכי הפולס ורכיבי העומק

צילום מבנה לפני השינויים, 18.10.2026. נותח עץ התחביר של כל 35 המסכים ושל כל 15 קובצי הרכיבים. זהו מיפוי סטטי של קוד אמיתי; אינו הצהרה שכל המצבים הורצו. [המסקנות והחלטות המבנה](2026-10-18-pulse-structure.md).

לכל מסך מפורטים רכיבי עומק, מקורות, משתני מצב, אירועי פעולה וניווט. משתני מצב אינם הוכחה לטיפול תקין במצב: כשל שאינו נתפס כאן עשוי להיות מטופל בשירות או להישאר לא מטופל. מלאי מכני מפורט עם מספרי שורות וקוד פעולות נמצא ב־[קובץ הראיות](evidence/pulse-structure/screen-inventory.json).

## מסכים

### AdminLoginScreen.tsx

[קוד](../../pulse/src/screens/AdminLoginScreen.tsx)

מקורות: `../services/adminSession`.

רכיבי תצוגה ועומק: `View`, `Text`, `TextInput`, `Pressable`, `ActivityIndicator`.

מצבים מקומיים: `[email, setEmail]`; `[password, setPassword]`; `[busy, setBusy]`; `[error, setError]`.

תוכן ופעולות מזוהים: ההתחברות לא הצליחה · פולס · כניסה מאובטחת לחשבון מנהל מורשה · כתובת דואר אלקטרוני · דואר אלקטרוני · סיסמה · כניסה · כניסה עם גוגל · הגישה מיועדת לחשבונות שאושרו מראש בלבד.

ניווט מפורש: אין מעבר למסך אחר בקוד המקומי; בדקו חלוניות וקריאות חזרה במלאי הראיות.

אירועי ממשק מחוברים: 4. מסלולי תפיסת כשל מפורשים בקובץ: 1. פירוט מלא ומיקומים במלאי הראיות.

### AdsScreen.tsx

[קוד](../../pulse/src/screens/AdsScreen.tsx)

מקורות: `../services/adsConfig`.

רכיבי תצוגה ועומק: `Screen`, `Card`, `View`, `Ionicons`, `Text`, `ActivityIndicator`, `Switch`.

מצבים מקומיים: `[enabled, setEnabled]`; `[busy, setBusy]`; `[banner, setBanner]`; `[bannerBusy, setBannerBusy]`.

תוכן ופעולות מזוהים: מודעות · שליטה על מודעות האפליקציה · מודעת פתיחה · מוצגת למשתמשים · כבויה — לא מוצגת לאף אחד · כשכבוי — מודעת הפתיחה לא תוצג לאף משתמש. כשדולק — היא תוצג לפי כל           הכללים הקיימים (זמן המתנה בין הצגות, מקסימום ליום, וחסד למשתמשים חדשים). · באנר · מוצג למשתמשים · כבוי — לא מוצג לאף אחד · כשכבוי — באנר המודעות לא יוצג בשום מסך. כשדולק — הבאנרים מוצגים כרגיל. · * המתגים נשמרים מיד ונכנסים לתוקף באפליקציה מהגרסה שמאזינה אליהם ואילך..

ניווט מפורש: אין מעבר למסך אחר בקוד המקומי; בדקו חלוניות וקריאות חזרה במלאי הראיות.

אירועי ממשק מחוברים: 2. מסלולי תפיסת כשל מפורשים בקובץ: 4. פירוט מלא ומיקומים במלאי הראיות.

### AnalyticsScreen.tsx

[קוד](../../pulse/src/screens/AnalyticsScreen.tsx)

מקורות: `../services/analyticsFull`.

רכיבי תצוגה ועומק: `Text`, `Card`, `View`, `Ionicons`, `Delta`, `Screen`, `RefreshControl`, `Pressable`, `Kpi`, `Funnel`, `Donut`, `LegendRow`, `PushStat`.

מצבים מקומיים: `[data, setData]`; `[loading, setLoading]`; `[refreshing, setRefreshing]`; `[range, setRange]`; `[showAllActions, setShowAllActions]`.

תוכן ופעולות מזוהים: היום · אתמול · 7 ימים · כל הזמנים · % מהתקופה הקודמת · אנליטיקה · Google Analytics + נתוני אפליקציה · משתמשים פעילים · משתמשים חדשים · שיעור חזרה · זמן ממוצע באפליקציה · מעורבות משתמשים · בקהילה · ללא קהילה · יצרו משחק · נרשמו למשחק · יצרו קהילה · פעולות מובילות באפליקציה · הצג פחות ▲ · מקורות גיוס משתמשים · התרעות (Push) · נשלחו · נפתחו · שיעור פתיחה · חברויות · אושרו · שיעור אישור · מכשירים · טוען….

ניווט מפורש: אין מעבר למסך אחר בקוד המקומי; בדקו חלוניות וקריאות חזרה במלאי הראיות.

אירועי ממשק מחוברים: 3. מסלולי תפיסת כשל מפורשים בקובץ: 0. פירוט מלא ומיקומים במלאי הראיות.

### AvailabilityScreen.tsx

[קוד](../../pulse/src/screens/AvailabilityScreen.tsx)

מקורות: `../services/homeConfig`; `../services/availabilityService`.

רכיבי תצוגה ועומק: `Screen`, `ScrollView`, `RefreshControl`, `Card`, `View`, `Ionicons`, `Text`, `ActivityIndicator`, `Switch`, `Pressable`, `Modal`, `SafeAreaView`.

מצבים מקומיים: `[data, setData]`; `[city, setCity]`; `[loading, setLoading]`; `[sel, setSel]`; `[cardOn, setCardOn]`; `[cardBusy, setCardBusy]`.

תוכן ופעולות מזוהים: זמינות שחקנים · מבט-על · יומן "פנויים לשחק לידך" בבית · תצוגת היומן מוצגת במסך הבית · כבוי — היומן לא מוצג · מכבה/מדליק רק את תצוגת היומן השבועי במסך הבית של Teamder. ההנעה             "הגדר זמינות" (למי שעדיין לא סימן) ממשיכה להופיע כרגיל. המתג נשמר מיד,             ונכנס לתוקף החל מהגרסה הבאה של Teamder (1.0.55+); על 1.0.54 היומן עדיין מוצג. · הכל · · יום · סה״כ · סימנו זמינות בלי לבחור חלק-יום — נספרו כזמינים לכל היום. · קריאה מסוננת בצד-שרת — נספרים רק מי שסימן זמינות, לא כל המשתמשים. · הקש על תא כדי לראות מי זמין. · כל היום · זמינים.

ניווט מפורש: אין מעבר למסך אחר בקוד המקומי; בדקו חלוניות וקריאות חזרה במלאי הראיות.

אירועי ממשק מחוברים: 9. מסלולי תפיסת כשל מפורשים בקובץ: 3. פירוט מלא ומיקומים במלאי הראיות.

### CampaignsScreen.tsx

[קוד](../../pulse/src/screens/CampaignsScreen.tsx)

מקורות: `../services/firebase`; `../services/segments`; `../services/savedSegments`; `../services/campaigns`; `../services/firestoreRest`.

רכיבי תצוגה ועומק: `View`, `Text`, `Screen`, `Ionicons`, `Pressable`, `Card`, `Stat`, `Arrow`, `Dropdown`, `ActivityIndicator`, `TextInput`, `UserPicker`.

מצבים מקומיים: `[tab, setTab]`; `[type, setType]`; `[segments, setSegments]`; `[segId, setSegId]`; `[count, setCount]`; `[audTotal, setAudTotal]`; `[calcBusy, setCalcBusy]`; `[title, setTitle]`; `[body, setBody]`; `[btn, setBtn]`; `[action, setAction]`; `[actionValue, setActionValue]`; `[scheduled, setScheduled]`; `[inHours, setInHours]`; `[pickerOpen, setPickerOpen]`; `[testing, setTesting]`; `[rate, setRate]`; `[sending, setSending]`; `[list, setList]`.

תוכן ופעולות מזוהים: נוצר · הקמפיין תוזמן ✓ · הפוש נשלח ✓ · הפופ-אפ פעיל ✓ · שגיאה · יצירת הקמפיין נכשלה · חסר · כתוב כותרת · לשלוח פוש? · להפעיל פופ-אפ? · כל המשתמשים · ביטול · שלח · כתוב קודם כותרת ותוכן · נשלח טסט ✓ · נכשל · קמפיינים · שלח פוש או פופ-אפ לקהל לפי יעד · הקמפיינים שלי · יצירת קמפיין · אין עדיין · · טסט · בקהל · נשלחו · נפתחו · ראו · לחצו · סגרו · סוג קמפיין · פוש (התראה) · פופ-אפ · קהל יעד · בחר קהל · חשב כמה יקבלו · תוכן · כותרת · טקסט · פופ-אפ — הגדרות · טקסט כפתור · הצטרף עכשיו · פעולת הכפתור · פעולה · קישור · שם מסך · מזהה · כותרת הפופ-אפ · הטקסט יוצג כאן · הבנתי · תזמון · שליחה עכשיו · בעוד · שעות · מגבלות בטיחות · כל משתמש מקבל מקסימום פוש אחד ביום · אי אפשר לתזמן שני פושים לאותו זמן · תזמן קמפיין · שלח קמפיין עכשיו · הפעל פופ-אפ · שלח טסט למשתמש.

ניווט מפורש: אין מעבר למסך אחר בקוד המקומי; בדקו חלוניות וקריאות חזרה במלאי הראיות.

אירועי ממשק מחוברים: 18. מסלולי תפיסת כשל מפורשים בקובץ: 3. פירוט מלא ומיקומים במלאי הראיות.

### ChatMessagesScreen.tsx

[קוד](../../pulse/src/screens/ChatMessagesScreen.tsx)

מקורות: `../services/chatMonitorService`.

רכיבי תצוגה ועומק: `Screen`, `RefreshControl`, `View`, `Pressable`, `Text`, `ActivityIndicator`, `Empty`, `Card`, `Ionicons`.

מצבים מקומיים: `[items, setItems]`; `[loading, setLoading]`; `[refreshing, setRefreshing]`; `[filter, setFilter]`.

תוכן ופעולות מזוהים: הכל · מועדונים · משחקים · מועדון · משחק · הודעות צ'אט · כל הודעה שנשלחה בצ׳אטים — שולח, היכן, ומה נכתב · אין הודעות להצגה · משתמש.

ניווט מפורש: אין מעבר למסך אחר בקוד המקומי; בדקו חלוניות וקריאות חזרה במלאי הראיות.

אירועי ממשק מחוברים: 2. מסלולי תפיסת כשל מפורשים בקובץ: 1. פירוט מלא ומיקומים במלאי הראיות.

### ChatReportsScreen.tsx

[קוד](../../pulse/src/screens/ChatReportsScreen.tsx)

מקורות: `../services/chatMonitorService`.

רכיבי תצוגה ועומק: `Screen`, `RefreshControl`, `View`, `Stat`, `Pressable`, `Text`, `ActivityIndicator`, `Empty`, `Ionicons`, `Card`.

מצבים מקומיים: `[items, setItems]`; `[loading, setLoading]`; `[refreshing, setRefreshing]`; `[filter, setFilter]`.

תוכן ופעולות מזוהים: חדש · נבדק · טופל · הכל · פתוחים · טופלו · מועדון · משחק · למחוק דיווח? · משתמש · ביטול · מחק · דיווחי צ'אט · הודעות שדווחו כפוגעניות — מי שלח, מי דיווח, ומה נכתב · סה״כ · אין דיווחים בקטגוריה הזו · (ההודעה ללא טקסט) · דווח ע״י.

ניווט מפורש: אין מעבר למסך אחר בקוד המקומי; בדקו חלוניות וקריאות חזרה במלאי הראיות.

אירועי ממשק מחוברים: 4. מסלולי תפיסת כשל מפורשים בקובץ: 3. פירוט מלא ומיקומים במלאי הראיות.

### ChatsScreen.tsx

[קוד](../../pulse/src/screens/ChatsScreen.tsx)

מקורות: `../services/chatMonitorService`.

רכיבי תצוגה ועומק: `Screen`, `RefreshControl`, `View`, `Pressable`, `Ionicons`, `Text`, `ActivityIndicator`, `Card`, `Empty`.

מצבים מקומיים: `[seg, setSeg]`; `[messages, setMessages]`; `[reports, setReports]`; `[blocks, setBlocks]`; `[refreshing, setRefreshing]`.

תוכן ופעולות מזוהים: הודעות · דיווחים · חסימות · חדש · נבדק · טופל · מועדון · משחק · צ'אטים · הודעות, דיווחים וחסימות — כל מה שקורה בצ׳אטים של Teamder · משתמש · אין הודעות להצגה · (ההודעה ללא טקסט) · · דווח ע״י · אין דיווחים · חסם את · אין חסימות.

ניווט מפורש: אין מעבר למסך אחר בקוד המקומי; בדקו חלוניות וקריאות חזרה במלאי הראיות.

אירועי ממשק מחוברים: 4. מסלולי תפיסת כשל מפורשים בקובץ: 5. פירוט מלא ומיקומים במלאי הראיות.

### DevInboxScreen.tsx

[קוד](../../pulse/src/screens/DevInboxScreen.tsx)

מקורות: אין שירות נתונים מיובא ישירות; נתונים מתקבלים בפרמטרים או ברכיבים פנימיים..

רכיבי תצוגה ועומק: `SafeAreaView`, `View`, `Text`, `Pressable`, `ErrorsBody`, `FeaturesBody`, `ReportsBody`, `QaUsersBody`.

מצבים מקומיים: `[seg, setSeg]`.

תוכן ופעולות מזוהים: שגיאות · פיצרים · דיווחים · תיבת פיתוח.

ניווט מפורש: אין מעבר למסך אחר בקוד המקומי; בדקו חלוניות וקריאות חזרה במלאי הראיות.

אירועי ממשק מחוברים: 1. מסלולי תפיסת כשל מפורשים בקובץ: 0. פירוט מלא ומיקומים במלאי הראיות.

### ErrorDetailScreen.tsx

[קוד](../../pulse/src/screens/ErrorDetailScreen.tsx)

מקורות: `../services/errorsService`; `../services/errorCatalog`; `../services/firebase`.

רכיבי תצוגה ועומק: `View`, `Text`, `SafeAreaView`, `Pressable`, `Ionicons`, `ActivityIndicator`, `ScrollView`, `Card`, `DiagnosticTimeline`, `Field`.

מצבים מקומיים: `[rec, setRec]`; `[loading, setLoading]`; `[linkedUser, setLinkedUser]`.

תוכן ופעולות מזוהים: שגיאה · השגיאה לא נמצאה · איפה · תוכן · למה · מקרים · ממתין · בטיפול · תוקן · מה ניסו לעשות · נראתה לראשונה · נראתה לאחרונה · פעולה (operation) · מסך (raw) · משתמש · פלטפורמה · גרסת אפליקציה · הודעת שגיאה גולמית · הקשר מלא (JSON) · תוקן ✓ · בטיפול 🛠️ · ממתין לטיפול · · הסטטוס מתעדכן אוטומטית כשמטפלים בתקלה.

ניווט מפורש: `(nav as any).getParent()?.navigate('Users', {       screen: 'UserDetail',       params: { userId: rec.userId },     })`.

אירועי ממשק מחוברים: 2. מסלולי תפיסת כשל מפורשים בקובץ: 0. פירוט מלא ומיקומים במלאי הראיות.

### ErrorsScreen.tsx

[קוד](../../pulse/src/screens/ErrorsScreen.tsx)

מקורות: `../services/errorsService`; `../services/errorCatalog`.

רכיבי תצוגה ועומק: `Card`, `View`, `Text`, `ScrollView`, `RefreshControl`, `StatTile`, `Pressable`, `ErrorItem`, `Empty`.

מצבים מקומיים: `[errors, setErrors]`; `[loading, setLoading]`; `[refreshing, setRefreshing]`; `[filter, setFilter]`.

תוכן ופעולות מזוהים: ממתין · בטיפול 🛠️ · תוקן ✓ · פעילות · הכל · תוקנו · פתוחות · סוגי שגיאות · סה״כ מקרים · אין שגיאות בקטגוריה זו · אין שגיאות 🎉.

ניווט מפורש: `nav.navigate('ErrorDetail', { id: e.id })`.

אירועי ממשק מחוברים: 3. מסלולי תפיסת כשל מפורשים בקובץ: 0. פירוט מלא ומיקומים במלאי הראיות.

### FeaturesScreen.tsx

[קוד](../../pulse/src/screens/FeaturesScreen.tsx)

מקורות: `../services/featuresService`.

רכיבי תצוגה ועומק: `ScrollView`, `RefreshControl`, `Card`, `View`, `Pressable`, `Ionicons`, `Text`, `TextInput`, `Image`, `ActivityIndicator`, `Empty`.

מצבים מקומיים: `[items, setItems]`; `[loading, setLoading]`; `[refreshing, setRefreshing]`; `[kind, setKind]`; `[text, setText]`; `[imgs, setImgs]`; `[saving, setSaving]`.

תוכן ופעולות מזוהים: חדש · בעבודה · בוצע · דרושה הרשאה · אשר גישה לגלריה כדי לצרף תמונות. · חסר תוכן · כתוב טקסט או צרף תמונה. · שמירה נכשלה · נסה שוב. · למחוק? · הפריט יימחק לצמיתות. · ביטול · מחק · באג · פיצר · מה לבנות / מה לתקן? כתוב חופשי… · מקס׳ תמונות · הוסף תמונה · שמור · אין עדיין פריטים — הוסף את הראשון 👆.

ניווט מפורש: אין מעבר למסך אחר בקוד המקומי; בדקו חלוניות וקריאות חזרה במלאי הראיות.

אירועי ממשק מחוברים: 8. מסלולי תפיסת כשל מפורשים בקובץ: 1. פירוט מלא ומיקומים במלאי הראיות.

### GamesScreen.tsx

[קוד](../../pulse/src/screens/GamesScreen.tsx)

מקורות: `../services/gamesService`.

רכיבי תצוגה ועומק: `View`, `Text`, `Ionicons`, `Section`, `Row`, `Card`, `Pressable`, `Pill`, `Chip`, `DetailView`, `Screen`, `RefreshControl`, `ActivityIndicator`, `Empty`, `StatTile`, `GameCard`.

מצבים מקומיים: `[open, setOpen]`; `[report, setReport]`; `[loading, setLoading]`; `[refreshing, setRefreshing]`; `[filter, setFilter]`.

תוכן ופעולות מזוהים: ללא תאריך · ציבורי · מועדון · פרטי · נחש (תור-תור) · ידני לפי קפטנים · אקראי · לפי דירוג פנימי · אוטומטי · ידני · כבוי · ללא · תיקו · פנדלים · גול זהב · המנצח נשאר · אדומים · כחולים · ירוקים · צהובים · כתומים · סגולים · שחורים · לבנים · חי עכשיו · שוחק · כוחות חולקו · לא התחיל · הכל · נעולים / מועדון · כן · לא · נוצר אוטומטית (מתוזמן) · נוצר ע״י אדמין (איזון) · חלוקה ידנית · כוחות · שיטת חלוקה · לא חולקו · כיצד נוצרו · מספר קבוצות · נערך ידנית אחרי · הגדרות משחק · פורמט · משך משחק · זמן נוסף · מחצית · שופט · מצב מילוי (מתקדם) · הכרעת תיקו · הרשמה וגישה · מקס׳ שחקנים · מינ׳ שחקנים · דורש אישור מנהל · סף אמון מינ׳ לזרים · פתיחת הרשמה · פתיחה לציבור · פתיחה לאורחים · חלוקת כוחות אוטומטית ב- · דדליין ביטול · מגרש · שם מגרש · כתובת · עיר · סוג משטח · לוגיסטיקה · להביא כדור · להביא חולצות · חוקי מגרש · הערות · כללי · הגיעו בפועל (סומנו) · ביטולים · נוצר בתאריך · נרשמו · מתקדם · טיימר בלבד · טיימר הופעל · משחקונים · פתוח לזרים · נעול · משחקים · קרובים ופעילים — נרשמים, סטטוס ניהולי ופירוט מלא בלחיצה · לא הצלחנו לטעון משחקים · משחקים קרובים · סה״כ נרשמו · אין משחקים קרובים בקטגוריה הזו.

ניווט מפורש: אין מעבר למסך אחר בקוד המקומי; בדקו חלוניות וקריאות חזרה במלאי הראיות.

אירועי ממשק מחוברים: 3. מסלולי תפיסת כשל מפורשים בקובץ: 1. פירוט מלא ומיקומים במלאי הראיות.

### IdeasScreen.tsx

[קוד](../../pulse/src/screens/IdeasScreen.tsx)

מקורות: `../services/ideasService`.

רכיבי תצוגה ועומק: `Screen`, `RefreshControl`, `Card`, `TextInput`, `ScrollView`, `View`, `Image`, `Pressable`, `Ionicons`, `Text`, `ActivityIndicator`, `Empty`.

מצבים מקומיים: `[items, setItems]`; `[loading, setLoading]`; `[refreshing, setRefreshing]`; `[expanded, setExpanded]`; `[text, setText]`; `[imgs, setImgs]`; `[saving, setSaving]`.

תוכן ופעולות מזוהים: רעיון · לאיפיון · לביצוע · בוצע · דרושה הרשאה · אשר גישה לגלריה כדי לצרף תמונות. · חסר תוכן · כתוב רעיון או צרף תמונה. · שמירה נכשלה · נסה שוב. · למחוק? · הרעיון יימחק לצמיתות. · ביטול · מחק · מאגר רעיונות לפיתוח עתידי · רעיונות · רעיון חדש… (יישמר כ׳רעיון׳; סמן ׳לאיפיון׳ כשתרצה שאאפיין) · מקס׳ תמונות · הוסף תמונה · שמור · אין עדיין רעיונות — הוסף את הראשון 👆 · איפיון.

ניווט מפורש: אין מעבר למסך אחר בקוד המקומי; בדקו חלוניות וקריאות חזרה במלאי הראיות.

אירועי ממשק מחוברים: 8. מסלולי תפיסת כשל מפורשים בקובץ: 1. פירוט מלא ומיקומים במלאי הראיות.

### MapScreen.tsx

[קוד](../../pulse/src/screens/MapScreen.tsx)

מקורות: `../services/firebase`.

רכיבי תצוגה ועומק: `Screen`, `Empty`, `Card`, `Svg`, `Path`, `Circle`, `View`, `Text`, `SectionHeader`.

מצבים מקומיים: `[comms, setComms]`; `[games, setGames]`.

תוכן ופעולות מזוהים: מפה · אין נתוני מיקום להצגה · מועדונים · משחקים · לפי עיר · עיר · אין מיקומים להצגה.

ניווט מפורש: אין מעבר למסך אחר בקוד המקומי; בדקו חלוניות וקריאות חזרה במלאי הראיות.

אירועי ממשק מחוברים: 0. מסלולי תפיסת כשל מפורשים בקובץ: 2. פירוט מלא ומיקומים במלאי הראיות.

### MessagesScreen.tsx

[קוד](../../pulse/src/screens/MessagesScreen.tsx)

מקורות: `../services/teamderChatService`; `../services/supportInbox`.

רכיבי תצוגה ועומק: `Screen`, `RefreshControl`, `View`, `Card`, `Text`, `Pressable`, `Ionicons`, `SupportOutreachPanel`, `TextInput`, `ActivityIndicator`, `Empty`, `TeamderChatSheet`, `NewSupportChatPicker`.

מצבים מקומיים: `[threads, setThreads]`; `[loading, setLoading]`; `[refreshing, setRefreshing]`; `[failed, setFailed]`; `[updatedAt, setUpdatedAt]`; `[search, setSearch]`; `[filter, setFilter]`; `[open, setOpen]`; `[pickingUser, setPickingUser]`.

תוכן ופעולות מזוהים: ממתינים לנו · ממתינים למשתמש · פתורות · הכול · שיחות עם משתמשים · שולחים בשם טימדר ומלווים את השחקנים · ממתינים למענה שלנו · שיחות במעקב · שיחה חדשה עם משתמש · חיפוש לפי שם או הודעה אחרונה · אפשר להשיב או לסמן שיחה כפתורה בלי לשלוח הודעה. הודעה חדשה מהמשתמש תחזיר אותה לטיפול. · לא הצלחנו לעדכן את השיחות. הנתונים הקודמים נשמרו — לחצו לניסיון חוזר. · עודכן · · מתרענן כל חצי דקה כשהמסך פתוח · אין שיחות שמתאימות לחיפוש ולסינון · עוד לא נפתחה שיחה. אפשר לשלוח הודעה מתוך כרטיס המשתמש. · משתמש · סומנה כפתורה · ממתין למענה שלנו · ההודעה האחרונה נשלחה מאיתנו.

ניווט מפורש: אין מעבר למסך אחר בקוד המקומי; בדקו חלוניות וקריאות חזרה במלאי הראיות.

אירועי ממשק מחוברים: 11. מסלולי תפיסת כשל מפורשים בקובץ: 2. פירוט מלא ומיקומים במלאי הראיות.

### NotificationsLogScreen.tsx

[קוד](../../pulse/src/screens/NotificationsLogScreen.tsx)

מקורות: `../services/notifLog`; `../services/serverNotifs`; `../services/supportInbox`.

רכיבי תצוגה ועומק: `Card`, `View`, `Text`, `Screen`, `Pressable`, `RefreshControl`, `Ionicons`, `TextInput`, `ActivityIndicator`, `Empty`, `ServerRow`.

מצבים מקומיים: `[seg, setSeg]`; `[q, setQ]`; `[server, setServer]`; `[loadingSrv, setLoadingSrv]`; `[items, setItems]`; `[loadedLocal, setLoadedLocal]`.

תוכן ופעולות מזוהים: היום · אתמול · אל: · נמסרו · נכשלו · אין טוקן · ללא נמענים · בתהליך · לנקות את ההיסטוריה המקומית? · הלוג המקומי שבמכשיר יימחק (השרת לא מושפע). · ביטול · נקה · התראות אחרונות · כל הפושים שנשלחו (שרת) · הלוג המקומי של Pulse · שרת · מקומי · חיפוש לפי סוג או נמען… · אין התראות תואמות · טוען… · התראות · אין עדיין התראות מקומיות.

ניווט מפורש: `(navRef as any).navigate('Messages', support)`; `(navRef as any).navigate('OnboardingActivity', { sessionId: n.sessionId })`.

אירועי ממשק מחוברים: 5. מסלולי תפיסת כשל מפורשים בקובץ: 1. פירוט מלא ומיקומים במלאי הראיות.

### OnboardingActivityScreen.tsx

[קוד](../../pulse/src/screens/OnboardingActivityScreen.tsx)

מקורות: `../services/firestoreRest`; `../services/onboardingActivityCatalog`; `../services/onboardingActivityLoader`.

רכיבי תצוגה ועומק: `Screen`, `View`, `Pressable`, `Text`, `ActivityIndicator`, `FlatList`, `RefreshControl`.

מצבים מקומיים: `[session, setSession]`; `[rows, setRows]`; `[loading, setLoading]`; `[error, setError]`; `[counts, setCounts]`.

תוכן ופעולות מזוהים: מסלול ההצטרפות · רצף הפעולות של הביקור הנבחר · פעולות שהתקבלו ב־24 השעות האחרונות · לרצף הפעולות · ספירת פעולות · לכל הביקורים · פעולות · · ביקורים · · מוצגת תקרה של 2,000 פעולות; הספירה חלקית · אין עדיין פעולות בטווח הזה. נדרשת גרסת האפליקציה ששולחת את התיעוד החדש. · · פעולה · אורח · חשבון מחובר · ביקור: · מזהה שחקן: · ממתין לעיבוד · נשמר ברצף בלבד — ללא פוש · בחירה חוזרת — נשמרה ללא פוש נוסף · נשלח לשירות ההתראות · ההתראות כבויות · אין מכשיר רשום להתראות · ממתין לניסיון מסירה נוסף · מצב מסירה לא ידוע.

ניווט מפורש: אין מעבר למסך אחר בקוד המקומי; בדקו חלוניות וקריאות חזרה במלאי הראיות.

אירועי ממשק מחוברים: 6. מסלולי תפיסת כשל מפורשים בקובץ: 0. פירוט מלא ומיקומים במלאי הראיות.

### OverviewScreen.tsx

[קוד](../../pulse/src/screens/OverviewScreen.tsx)

מקורות: `../state/DashboardContext`; `../services/errorsService`; `../services/firebase`; `../services/downloads`; `../services/linkClicks`; `../services/cache`.

רכיבי תצוגה ועומק: `View`, `Ionicons`, `Screen`, `Text`, `RefreshControl`, `Pressable`, `Badge`, `Stat`, `StoreStat`.

מצבים מקומיים: `[errors, setErrors]`; `[lifetime, setLifetime]`; `[userCounts, setUserCounts]`; `[clicks, setClicks]`.

תוכן ופעולות מזוהים: הנה התמונה של היום · היום · באגים פתוחים מהיום · אין באגים חדשים היום 🎉 · צפה בכל הבאגים ← · כניסות לקישור · אתמול · השבוע · כל הזמנים · המקור הכי חזק היום: · מכל המקורות — שיתופים, הזמנות אישיות וקמפיינים · הכנסות ממודעות · עד היום · % מאתמול · משתמשים · התחברו היום · חדשים היום · דירוגים · ביקורות היום · הורדות היום · הורדות (30 ימים).

ניווט מפורש: `nav.navigate('DevInbox')`; `nav.navigate('Sources')`; `nav.navigate('Revenue')`; `nav.navigate('Users')`.

אירועי ממשק מחוברים: 6. מסלולי תפיסת כשל מפורשים בקובץ: 4. פירוט מלא ומיקומים במלאי הראיות.

### PushScreen.tsx

[קוד](../../pulse/src/screens/PushScreen.tsx)

מקורות: `../services/pushStats`.

רכיבי תצוגה ועומק: `View`, `Text`, `Screen`, `RefreshControl`, `ActivityIndicator`, `Empty`, `StatTile`, `Card`, `HealthLine`, `Ionicons`, `TypeRow`.

מצבים מקומיים: `[data, setData]`; `[loading, setLoading]`; `[refreshing, setRefreshing]`.

תוכן ופעולות מזוהים: נמסרו · בעיות טוקן · נפתחו · פושים · נשלח לפי סוג + תקינות שליחה אמיתית · לא הצלחנו לטעון נתוני פוש · נשלחו · תקינות שליחה · נמסרו ל-FCM · נכשלו (טוקן לא תקין) · אין טוקן למשתמש · כיבו את ההתראה (העדפות) · "נמסרו" = ה-FCM קיבל את ההודעה לשליחה. "נפתחו" (תקתוק) עדיין לא מתועד — ייכנס               בגרסת האפליקציה הבאה ואז יופיע שיעור פתיחה אמיתי לכל סוג. · נשלח לפי סוג ( · לא נשלחו פושים.

ניווט מפורש: אין מעבר למסך אחר בקוד המקומי; בדקו חלוניות וקריאות חזרה במלאי הראיות.

אירועי ממשק מחוברים: 1. מסלולי תפיסת כשל מפורשים בקובץ: 1. פירוט מלא ומיקומים במלאי הראיות.

### QaUserDetailScreen.tsx

[קוד](../../pulse/src/screens/QaUserDetailScreen.tsx)

מקורות: `../services/qaService`; `../services/screenNames`; `../services/reportsService`.

רכיבי תצוגה ועומק: `Card`, `View`, `Ionicons`, `Text`, `Pressable`, `Image`, `Screen`, `RefreshControl`, `ActivityIndicator`, `SectionHeader`, `Empty`, `ReportCard`, `ErrorItem`, `Modal`.

מצבים מקומיים: `[data, setData]`; `[loading, setLoading]`; `[refreshing, setRefreshing]`; `[zoom, setZoom]`.

תוכן ופעולות מזוהים: חדש · נבדק · טופל · באג · הצעה · משתמש QA · כל הדיווחים והשגיאות של המשתמש · דיווחים ( · אין דיווחים · שגיאות ( · אין שגיאות.

ניווט מפורש: `nav.navigate('DevInbox')`; `nav.navigate('ErrorDetail', { id: e.id })`.

אירועי ממשק מחוברים: 7. מסלולי תפיסת כשל מפורשים בקובץ: 0. פירוט מלא ומיקומים במלאי הראיות.

### QaUsersScreen.tsx

[קוד](../../pulse/src/screens/QaUsersScreen.tsx)

מקורות: `../services/qaService`.

רכיבי תצוגה ועומק: `ScrollView`, `RefreshControl`, `View`, `ActivityIndicator`, `Empty`, `Pressable`, `Card`, `Ionicons`, `Text`.

מצבים מקומיים: `[users, setUsers]`; `[loading, setLoading]`; `[refreshing, setRefreshing]`.

תוכן ופעולות מזוהים: אין עדיין משתמשי QA (מי ששלח דיווח יופיע כאן) · פעילות אחרונה: · דיווחים · שגיאות.

ניווט מפורש: `nav.navigate('QaUser', { userId: u.userId, userName: u.userName })`.

אירועי ממשק מחוברים: 2. מסלולי תפיסת כשל מפורשים בקובץ: 0. פירוט מלא ומיקומים במלאי הראיות.

### QuotaScreen.tsx

[קוד](../../pulse/src/screens/QuotaScreen.tsx)

מקורות: `../services/quota`.

רכיבי תצוגה ועומק: `View`, `Text`, `Ionicons`, `Screen`, `RefreshControl`, `Card`, `SectionHeader`, `QuotaBar`.

מצבים מקומיים: `[data, setData]`; `[loading, setLoading]`; `[err, setErr]`.

תוכן ופעולות מזוהים: לא מתאפס · מכסה קבועה · מתאפס עכשיו · יום · ימים · שעה · שעות · קבוע · לא זמין כרגע · מכסות וחינמי · כמה רחוק אתה מלשלם — Firebase / Google Cloud · שגיאה בטעינת הנתונים · טוען נתוני שימוש… · יש מכסה שמתקרבת לגבול — שווה לבדוק · הכל בתוך החינמי בנוחות ✓ · עודכן · · נתונים מ-Cloud Monitoring (יכול להתעדכן בעיכוב של כמה דקות).

ניווט מפורש: אין מעבר למסך אחר בקוד המקומי; בדקו חלוניות וקריאות חזרה במלאי הראיות.

אירועי ממשק מחוברים: 2. מסלולי תפיסת כשל מפורשים בקובץ: 1. פירוט מלא ומיקומים במלאי הראיות.

### ReportsScreen.tsx

[קוד](../../pulse/src/screens/ReportsScreen.tsx)

מקורות: `../services/reportsService`; `../services/screenNames`.

רכיבי תצוגה ועומק: `ScrollView`, `RefreshControl`, `View`, `Stat`, `Pressable`, `Ionicons`, `Text`, `ActivityIndicator`, `Empty`, `Card`, `DiagnosticTimeline`, `Image`, `Modal`.

מצבים מקומיים: `[items, setItems]`; `[loading, setLoading]`; `[refreshing, setRefreshing]`; `[zoom, setZoom]`; `[filter, setFilter]`; `[groupMode, setGroupMode]`.

תוכן ופעולות מזוהים: חדש · נבדק · טופל · הכל · מסומן לתיקון · פתוחים · טופלו · למחוק דיווח? · משתמש · ביטול · מחק · סה״כ · לתיקון · לפי מדווח · לפי מסך · אין דיווחים בקטגוריה הזו · תוקנו · באג · הצעה · מסומן · תקן · הגדל.

ניווט מפורש: אין מעבר למסך אחר בקוד המקומי; בדקו חלוניות וקריאות חזרה במלאי הראיות.

אירועי ממשק מחוברים: 10. מסלולי תפיסת כשל מפורשים בקובץ: 4. פירוט מלא ומיקומים במלאי הראיות.

### RevenueScreen.tsx

[קוד](../../pulse/src/screens/RevenueScreen.tsx)

מקורות: `../state/DashboardContext`.

רכיבי תצוגה ועומק: `Screen`, `RefreshControl`, `Empty`, `Card`, `Text`, `View`, `StatTile`, `SectionHeader`, `Bars`, `BarList`.

מצבים מקומיים: ללא מצב מקומי.

תוכן ופעולות מזוהים: הכנסות · אין עדיין נתוני AdMob · 💰 רווח כולל · כל הזמנים · היום · 7 ימים · 28 ימים · 🏆 המודעה הכי רווחית (28 ימים) · חשיפות · הכנסה יומית (28 ימים) · חשיפות (7ימ׳) · קליקים (7ימ׳) · CTR (7ימ׳) · eCPM (7ימ׳) · הכנסה לפי יחידת מודעה · הכנסה לפי מדינה · * ערכים מוערכים מ־AdMob; התשלום הסופי עשוי להשתנות..

ניווט מפורש: `nav.navigate('Overview')`.

אירועי ממשק מחוברים: 2. מסלולי תפיסת כשל מפורשים בקובץ: 0. פירוט מלא ומיקומים במלאי הראיות.

### ReviewsScreen.tsx

[קוד](../../pulse/src/screens/ReviewsScreen.tsx)

מקורות: `../state/DashboardContext`.

רכיבי תצוגה ועומק: `Screen`, `RefreshControl`, `SectionHeader`, `RatingHistogram`, `View`, `Pressable`, `Text`, `ReviewItem`, `Empty`.

מצבים מקומיים: `[filter, setFilter]`.

תוכן ופעולות מזוהים: הכל · ★ נמוכות (≤3) · ביקורות · דירוגים · אין ביקורות בקטגוריה זו.

ניווט מפורש: `nav.navigate('Overview')`.

אירועי ממשק מחוברים: 3. מסלולי תפיסת כשל מפורשים בקובץ: 0. פירוט מלא ומיקומים במלאי הראיות.

### SegmentScreen.tsx

[קוד](../../pulse/src/screens/SegmentScreen.tsx)

מקורות: `../services/firebase`; `../services/segments`; `../services/savedSegments`.

רכיבי תצוגה ועומק: `Screen`, `View`, `Ionicons`, `Pressable`, `Text`, `Card`, `Dropdown`, `TextInput`, `ActivityIndicator`.

מצבים מקומיים: `[name, setName]`; `[combinator, setCombinator]`; `[rules, setRules]`; `[count, setCount]`; `[total, setTotal]`; `[busy, setBusy]`; `[saving, setSaving]`; `[saved, setSaved]`.

תוכן ופעולות מזוהים: כן · לא · חסר · תן שם לסגמנט · הוסף לפחות תנאי אחד · נשמר · שגיאה · שמירת הסגמנט נכשלה · מחיקה · ביטול · מחק · סגמנטים · בנה קהל של משתמשים לפי תנאים · בניית סגמנט · או (OR) · וגם (AND) · ערך · הוסף תנאי · חשב קהל · משתמשים מתאימים · % מכלל המשתמשים · שם הסגמנט · שמור כסגמנט · הסגמנטים השמורים · אין עדיין — בנה ושמור סגמנט.

ניווט מפורש: אין מעבר למסך אחר בקוד המקומי; בדקו חלוניות וקריאות חזרה במלאי הראיות.

אירועי ממשק מחוברים: 13. מסלולי תפיסת כשל מפורשים בקובץ: 1. פירוט מלא ומיקומים במלאי הראיות.

### SettingsScreen.tsx

[קוד](../../pulse/src/screens/SettingsScreen.tsx)

מקורות: `../services/adminSession`; `../state/DashboardContext`; `../services/notify`; `../services/notifPrefs`.

רכיבי תצוגה ועומק: `View`, `Text`, `Pressable`, `Screen`, `SectionHeader`, `Card`, `StatusRow`, `Switch`, `Ionicons`, `Btn`.

מצבים מקומיים: `[msg, setMsg]`; `[prefs, setPrefs]`.

תוכן ופעולות מזוהים: מחובר · דמו · App Store — ביקורות ודירוגים · Google Play — ביקורות ודירוגים · AdMob — הכנסות · Google Analytics — שימוש · Firebase — משתמשים ונתוני אפליקציה · הורדות App Store · הורדות Google Play · הגדרות · יציאה מהחשבון · מקורות נתונים · מקורות הנתונים מנוהלים בשרת וזמינים רק לחשבון מנהל מורשה.         מפתחות ניהול אינם נשמרים באפליקציה. · התראות בזמן אמת · בורר מה יישלח אליך כפוש בזמן אמת. הסינון בצד השרת — כיבוי עובד גם         כשהאפליקציה סגורה, וחל על כל המכשירים הרשומים. · תשתית · מכסות וחינמי · שימוש מול הגבול החינמי — Firestore, Functions, Scheduler · פעולות · רענן עכשיו · מרענן… · עודכן ✓ · שלח התראת בדיקה · אין הרשאת התראות · התראות עובדות ✓ — תקבל פוש על ביקורות חדשות. · נשלחה התראה · איך זה עובד · התראות משתמש/שגיאה/דיווח נשלחות בזמן אמת (~2ש׳) דרך Cloud Function           ברגע שהאירוע קורה. ביקורות נבדקות בשרת כל ~15 דקות (החנויות לא דוחפות           אותן). הכל רץ בשרת — מגיע אליך גם כשהאפליקציה סגורה..

ניווט מפורש: `nav.navigate('Quota')`.

אירועי ממשק מחוברים: 6. מסלולי תפיסת כשל מפורשים בקובץ: 1. פירוט מלא ומיקומים במלאי הראיות.

### SourcesScreen.tsx

[קוד](../../pulse/src/screens/SourcesScreen.tsx)

מקורות: `../services/adLinks`; `../services/firestoreRest`; `../services/adLinkStats`.

רכיבי תצוגה ועומק: `Screen`, `Ionicons`, `RefreshControl`, `Text`, `Card`, `Dropdown`, `TextInput`, `View`, `Pressable`, `ActivityIndicator`, `Modal`, `ScrollView`, `FunnelRow`.

מצבים מקומיים: `[name, setName]`; `[source, setSource]`; `[customSource, setCustomSource]`; `[campaign, setCampaign]`; `[gameId, setGameId]`; `[busy, setBusy]`; `[links, setLinks]`; `[report, setReport]`; `[loadingReport, setLoadingReport]`; `[detailLink, setDetailLink]`; `[stats, setStats]`; `[loadingStats, setLoadingStats]`; `[statsError, setStatsError]`; `[refreshing, setRefreshing]`.

תוכן ופעולות מזוהים: אורגני · מחיקת קישור · ביטול · מחק · שגיאה · המחיקה נכשלה · חסר · בחר מקור · נוצר קישור · סגור · שתף · יצירת הקישור נכשלה · יצירת הקישור נכשלה. בדוק חיבור והרשאות ונסה שוב · קישורים · צור קישורים ובדוק מאיפה הגיעו החשבונות · למדידה נפרדת, צור קישור לפייסבוק וקישור נוסף לאינסטגרם. · יצירת קישור חדש · בחר איפה הקישור יפורסם · בחר מקור שיתוף · וואטסאפ · פייסבוק · אינסטגרם · טלגרם · מסרון · אחר · שם מקור מותאם · שם הקישור (אופציונלי) · קמפיין (אופציונלי) · מזהה משחק יעד (אופציונלי) · כך ייראה הקישור הקצר — ייווצר לאחר שמירה · צור קישור · דוח לפי מקור · אין עדיין נתוני ייחוס · מקור · חשבונות · השלימו הרשמה · הצטרפו · השלמה · מיוחסים מתוך · משתמשים · הקישורים שיצרת · אין עדיין · פתיחות · לא ניתן לטעון את נתוני הקישור. המספרים אינם זמינים כרגע. · נסה שוב · פתיחות של הקישור · חשבונות שיוחסו לקישור · פתיחות עשויות לחזור על עצמן; הן אינן אנשים ייחודיים או הורדות מהחנות. הנתונים הבאים הם מצבם הנוכחי של החשבונות שיוחסו לקישור. · הצטרפו למשחק · יצרו משחק · עדיין אין חשבונות עם שיוך מפורש לקישור הזה. שיוכים היסטוריים למקור בלבד מופיעים בדוח לפי מקור..

ניווט מפורש: אין מעבר למסך אחר בקוד המקומי; בדקו חלוניות וקריאות חזרה במלאי הראיות.

אירועי ממשק מחוברים: 13. מסלולי תפיסת כשל מפורשים בקובץ: 5. פירוט מלא ומיקומים במלאי הראיות.

### StickersScreen.tsx

[קוד](../../pulse/src/screens/StickersScreen.tsx)

מקורות: `../services/stickers`.

רכיבי תצוגה ועומק: `Screen`, `Card`, `TextInput`, `Pressable`, `ActivityIndicator`, `Text`, `View`, `MapWebView`.

מצבים מקומיים: `[stickers, setStickers]`; `[input, setInput]`; `[busy, setBusy]`; `[loading, setLoading]`; `[focus, setFocus]`.

תוכן ופעולות מזוהים: שמירה נכשלה · נסה שוב. · לא זוהה מיקום · הדבק מיקום מווטסאפ, קישור Google Maps, או קואורדינטות (‎lat, lng‎). · מחוץ לישראל? · ביטול · הוסף · מדבקה · סגור · מחק · מדבקות כאן · מדבקות 🗺️ · הדבק כאן מיקום מווטסאפ / קישור Google Maps / קואורדינטות · הוסף מדבקה 📍.

ניווט מפורש: אין מעבר למסך אחר בקוד המקומי; בדקו חלוניות וקריאות חזרה במלאי הראיות.

אירועי ממשק מחוברים: 4. מסלולי תפיסת כשל מפורשים בקובץ: 0. פירוט מלא ומיקומים במלאי הראיות.

### TasksScreen.tsx

[קוד](../../pulse/src/screens/TasksScreen.tsx)

מקורות: `../services/unresolvedWork`; `../services/teamderChatService`; `../services/tasksService`; `../services/ideasService`; `../services/workItems`; `../services/claudeWork`.

רכיבי תצוגה ועומק: `SafeAreaView`, `View`, `Text`, `Pressable`, `Ionicons`, `ScrollView`, `ActivityIndicator`, `RefreshControl`, `Empty`, `WorkRow`, `ImageLightbox`, `TeamderChatSheet`, `TaskComposer`, `DiagnosticTimeline`, `Image`, `Modal`, `TextInput`.

מצבים מקומיים: `[items, setItems]`; `[loading, setLoading]`; `[refreshing, setRefreshing]`; `[tab, setTab]`; `[filter, setFilter]`; `[composing, setComposing]`; `[editing, setEditing]`; `[replyTo, setReplyTo]`; `[openThread, setOpenThread]`; `[expanded, setExpanded]`; `[savingStatus, setSavingStatus]`; `[shots, setShots]`; `[loadingShots, setLoadingShots]`; `[title, setTitle]`; `[notes, setNotes]`; `[kind, setKind]`; `[priority, setPriority]`; `[imgs, setImgs]`; `[busy, setBusy]`.

תוכן ופעולות מזוהים: פתוחות · בוצע ע״י קלוד · סגורות · השינוי לא נשמר · הפריט נשאר במצבו הקודם. נסו שוב. · למחוק את המשימה? · ביטול · מחק · אין שום דבר פתוח 🎉 · קלוד עוד לא סיים כלום שממתין לאישור · עוד לא אושר כלום · משימות · משימה · הכל · באגים שלא נפתרו · פתיחה מחדש · סמן שיחה כפתורה ללא תשובה · סגירת המשימה · לא לקלוד — לאפיון מצידכם · בוצע ע״י קלוד · ממתין לאישורך · מה כבר נבדק: · מה חסר לפתרון: · מה קלוד עשה · אישור וסגירה · לא תוקן — החזר לפתוח · השב למדווח · עריכה · מחיקה · אין הרשאה לגלריה · השמירה נכשלה · נסה שוב · עריכת משימה · רעיון חדש · משימה חדשה · מה צריך לעשות? · פירוט (לא חובה) · סוג · עדיפות · תמונות · שמור · הוסף רעיון · הוסף משימה.

ניווט מפורש: אין מעבר למסך אחר בקוד המקומי; בדקו חלוניות וקריאות חזרה במלאי הראיות.

אירועי ממשק מחוברים: 36. מסלולי תפיסת כשל מפורשים בקובץ: 9. פירוט מלא ומיקומים במלאי הראיות.

### TokenHealthScreen.tsx

[קוד](../../pulse/src/screens/TokenHealthScreen.tsx)

מקורות: `../services/tokenHealth`.

רכיבי תצוגה ועומק: `View`, `Text`, `Screen`, `RefreshControl`, `ActivityIndicator`, `Empty`, `StatTile`, `Card`, `UserRow`.

מצבים מקומיים: `[data, setData]`; `[loading, setLoading]`; `[refreshing, setRefreshing]`.

תוכן ופעולות מזוהים: טוקן נכשל · אין טוקן · נשלחו · · נמסרו · · נכשלו · בריאות טוקנים · מי יכול לקבל פוש — ומי לא · לא הצלחנו לטעון נתונים · נגישים · ללא טוקן · מבוסס על תוצאות מסירה אמיתיות. "נגיש" = לפחות פוש אחד נמסר אליו בהצלחה (גם אם חלק               מהטוקנים הישנים שלו נכשלים — זו התיישנות רגילה). "טוקן נכשל" = נשלחו פושים אבל אף אחד               לא נמסר. "ללא טוקן" = השרת לא מצא לו טוקן. · משתמשים לא נגישים ( · כל המשתמשים נגישים 🎉.

ניווט מפורש: אין מעבר למסך אחר בקוד המקומי; בדקו חלוניות וקריאות חזרה במלאי הראיות.

אירועי ממשק מחוברים: 1. מסלולי תפיסת כשל מפורשים בקובץ: 1. פירוט מלא ומיקומים במלאי הראיות.

### UserDetailScreen.tsx

[קוד](../../pulse/src/screens/UserDetailScreen.tsx)

מקורות: `../state/DashboardContext`; `../services/firebase`; `../services/firestoreRest`.

רכיבי תצוגה ועומק: `View`, `Ionicons`, `Text`, `SafeAreaView`, `Pressable`, `TeamderChatSheet`, `ScrollView`, `Card`, `Stat`, `ActivityIndicator`, `SectionHeader`, `TimelineRow`.

מצבים מקומיים: `[data, setData]`; `[loading, setLoading]`; `[qa, setQa]`; `[qaSaving, setQaSaving]`; `[copied, setCopied]`; `[messaging, setMessaging]`.

תוכן ופעולות מזוהים: פתוח · בבדיקה · תוקן ✓ · משתמש · משחקים · הישגים · חברים · כרטיסים · נרשמו דרכו · קליקים על הקישור · הועתק ✓ · העתק לינק הזמנה אישי · 📩 הוזמן ע״י · 🔗 נרשם דרך קישור: · 🌱 נרשם ישירות (אורגני) · הזמין · בודק (QA) · מקבל פופאפ דיווח בצילום מסך באפליקציה · משתמש רגיל — ללא כלי בדיקה · פעילות · אין פעילות מתועדת · תקלות שהמשתמש חווה · תקלות שקרו אצל המשתמש — לא מוצגות בציר הזמן..

ניווט מפורש: `(nav as any).navigate('UsersList')`; `(nav as any).getParent()?.navigate('DevInbox', {                         screen: 'ErrorDetail',                         params: { id: er.id },                       })`.

אירועי ממשק מחוברים: 6. מסלולי תפיסת כשל מפורשים בקובץ: 1. פירוט מלא ומיקומים במלאי הראיות.

### UsersScreen.tsx

[קוד](../../pulse/src/screens/UsersScreen.tsx)

מקורות: `../services/firebase`.

רכיבי תצוגה ועומק: `Card`, `View`, `Text`, `Ionicons`, `Pressable`, `Screen`, `RefreshControl`, `Kpi`, `Donut`, `Legend`, `TextInput`, `UserRow`.

מצבים מקומיים: `[all, setAll]`; `[loading, setLoading]`; `[refreshing, setRefreshing]`; `[range, setRange]`; `[filter, setFilter]`; `[query, setQuery]`; `[showAllCities, setShowAllCities]`.

תוכן ופעולות מזוהים: היום · 7 ימים · 30 ימים · הכל · מחוברים עכשיו · חדשים · מחקו חשבון · 🧪 בודקים · כל הזמנים · משתמשים · סה״כ משתמשים · פעילים בתקופה · חדשים בתקופה · חזרה לשימוש · לא חזרו 30 יום · לא חזרו 7 ימים · שיטת התחברות · לפי עיר · הצג פחות · הצג עוד · חיפוש משתמש · אין משתמשים בקטגוריה זו.

ניווט מפורש: `nav.navigate('UserDetail', { userId: u.id })`.

אירועי ממשק מחוברים: 9. מסלולי תפיסת כשל מפורשים בקובץ: 0. פירוט מלא ומיקומים במלאי הראיות.

### VersionsScreen.tsx

[קוד](../../pulse/src/screens/VersionsScreen.tsx)

מקורות: `../services/appStoreConnect`; `../services/googlePlay`; `../services/releaseLog`; `../services/wearRelease`.

רכיבי תצוגה ועומק: `Screen`, `View`, `ActivityIndicator`, `RefreshControl`, `Text`, `Card`, `VersionRow`, `StoreBadge`, `Ionicons`, `Pressable`, `AreaGroups`, `ItemRow`, `Image`, `Modal`.

מצבים מקומיים: `[loading, setLoading]`; `[log, setLog]`; `[apple, setApple]`; `[play, setPlay]`; `[wear, setWear]`; `[open, setOpen]`; `[b64, setB64]`; `[zoom, setZoom]`.

תוכן ופעולות מזוהים: ממתין לאישור · באוויר · מה יעלה כשהגרסה תאושר: · מה חדש בשעון: · ממתין לאישור החנויות · מה יעלה בגרסה זו: · גרסאות · מה באוויר, מה בבדיקה, ומה מחכה · מה באוויר, מה בבדיקה, ומה מחכה לגרסה הבאה · באוויר עכשיו · אין מידע על גרסה באוויר כרגע · מה נכנס בגרסה הזו: · עולה עכשיו · הוגש · מחכה לגרסה הבאה · מוכן · נכנס לגרסה הבאה שתיבנה · מה מחכה: · גרסאות קודמות · ללא תאריך · אפל · גוגל · שעון · מה חדש בגרסה זו: · כללי · הגדל.

ניווט מפורש: אין מעבר למסך אחר בקוד המקומי; בדקו חלוניות וקריאות חזרה במלאי הראיות.

אירועי ממשק מחוברים: 5. מסלולי תפיסת כשל מפורשים בקובץ: 5. פירוט מלא ומיקומים במלאי הראיות.

## רכיבים וחלוניות

### AppMenu.tsx

[קוד](../../pulse/src/components/AppMenu.tsx)

מקורות: `../services/teamderChatService`.

רכיבי תצוגה ועומק: `Modal`, `Pressable`, `SafeAreaView`, `View`, `Ionicons`, `Text`, `ScrollView`.

מצבים מקומיים: `[waiting, setWaiting]`.

תוכן ופעולות מזוהים: ראשי · סקירה · משתמשים · משחקים · זמינות · אנליטיקה · מסלול ההצטרפות · מפה · שיווק · קמפיינים · מדבקות · סגמנטים · מקורות · חנות · ביקורות · הכנסות · פיתוח · שיחות עם משתמשים · תיבת פיתוח · רעיונות · צ'אטים · מערכת · גרסאות · פושים · בריאות טוקנים · התראות אחרונות · מודעות · מכסות · הגדרות · תפריט · פעיל.

ניווט מפורש: `go(it.route, it.screen)`.

אירועי ממשק מחוברים: 5. מסלולי תפיסת כשל מפורשים בקובץ: 2. פירוט מלא ומיקומים במלאי הראיות.

### BarList.tsx

[קוד](../../pulse/src/components/BarList.tsx)

מקורות: אין שירות נתונים מיובא ישירות; נתונים מתקבלים בפרמטרים או ברכיבים פנימיים..

רכיבי תצוגה ועומק: `Text`, `View`.

מצבים מקומיים: ללא מצב מקומי.

תוכן ופעולות מזוהים: אין נתונים.

ניווט מפורש: אין מעבר למסך אחר בקוד המקומי; בדקו חלוניות וקריאות חזרה במלאי הראיות.

אירועי ממשק מחוברים: 0. מסלולי תפיסת כשל מפורשים בקובץ: 0. פירוט מלא ומיקומים במלאי הראיות.

### Chart.tsx

[קוד](../../pulse/src/components/Chart.tsx)

מקורות: אין שירות נתונים מיובא ישירות; נתונים מתקבלים בפרמטרים או ברכיבים פנימיים..

רכיבי תצוגה ועומק: `View`, `Svg`, `Rect`, `Polyline`.

מצבים מקומיים: ללא מצב מקומי.

תוכן ופעולות מזוהים: רכיב תצוגה ללא מלל עברי קבוע.

ניווט מפורש: אין מעבר למסך אחר בקוד המקומי; בדקו חלוניות וקריאות חזרה במלאי הראיות.

אירועי ממשק מחוברים: 0. מסלולי תפיסת כשל מפורשים בקובץ: 0. פירוט מלא ומיקומים במלאי הראיות.

### DiagnosticTimeline.tsx

[קוד](../../pulse/src/components/DiagnosticTimeline.tsx)

מקורות: `../services/firestoreRest`; `../services/diagnosticTimeline`; `../services/screenNames`.

רכיבי תצוגה ועומק: `View`, `Pressable`, `Text`, `Ionicons`, `ActivityIndicator`.

מצבים מקומיים: `[open,setOpen]`; `[loading,setLoading]`; `[failed,setFailed]`; `[data,setData]`; `[previous,setPrevious]`; `[filter,setFilter]`; `[limit,setLimit]`; `[copied,setCopied]`; `[retry,setRetry]`.

תוכן ופעולות מזוהים: רצף הפעולות · מה קרה לפני הדיווח או השגיאה · טעינת הרצף נכשלה — נסה שוב · הפעלה קודמת · הפעלה נוכחית · צעדים זמינים מתוך · הרצף חלקי: · צעדים הושמטו בגלל מגבלת גודל. · הכל · מסכים · לחיצות · גלילות · שגיאות · הרצף הועתק · העתק את כל הרצף לשחזור · חסרות · פעולות ברצף · אין פעולות בסינון שנבחר · הצג עוד 30 צעדים ( · נותרו) · תיעוד מהגרסה הקודמת — ללא רצף מובנה · לא צורף רצף פעולות לפריט הזה. דיווחים מגרסאות ישנות עשויים לא לכלול אותו..

ניווט מפורש: אין מעבר למסך אחר בקוד המקומי; בדקו חלוניות וקריאות חזרה במלאי הראיות.

אירועי ממשק מחוברים: 6. מסלולי תפיסת כשל מפורשים בקובץ: 2. פירוט מלא ומיקומים במלאי הראיות.

### Donut.tsx

[קוד](../../pulse/src/components/Donut.tsx)

מקורות: אין שירות נתונים מיובא ישירות; נתונים מתקבלים בפרמטרים או ברכיבים פנימיים..

רכיבי תצוגה ועומק: `Svg`, `Circle`.

מצבים מקומיים: ללא מצב מקומי.

תוכן ופעולות מזוהים: רכיב תצוגה ללא מלל עברי קבוע.

ניווט מפורש: אין מעבר למסך אחר בקוד המקומי; בדקו חלוניות וקריאות חזרה במלאי הראיות.

אירועי ממשק מחוברים: 0. מסלולי תפיסת כשל מפורשים בקובץ: 0. פירוט מלא ומיקומים במלאי הראיות.

### Dropdown.tsx

[קוד](../../pulse/src/components/Dropdown.tsx)

מקורות: אין שירות נתונים מיובא ישירות; נתונים מתקבלים בפרמטרים או ברכיבים פנימיים..

רכיבי תצוגה ועומק: `Pressable`, `Text`, `Modal`, `ScrollView`, `View`.

מצבים מקומיים: `[open, setOpen]`.

תוכן ופעולות מזוהים: בחר.

ניווט מפורש: אין מעבר למסך אחר בקוד המקומי; בדקו חלוניות וקריאות חזרה במלאי הראיות.

אירועי ממשק מחוברים: 5. מסלולי תפיסת כשל מפורשים בקובץ: 0. פירוט מלא ומיקומים במלאי הראיות.

### ImageLightbox.tsx

[קוד](../../pulse/src/components/ImageLightbox.tsx)

מקורות: אין שירות נתונים מיובא ישירות; נתונים מתקבלים בפרמטרים או ברכיבים פנימיים..

רכיבי תצוגה ועומק: `Modal`, `View`, `WebView`, `Pressable`, `Ionicons`, `Text`.

מצבים מקומיים: ללא מצב מקומי.

תוכן ופעולות מזוהים: צביטה להגדלה · הקשה כפולה לזום.

ניווט מפורש: אין מעבר למסך אחר בקוד המקומי; בדקו חלוניות וקריאות חזרה במלאי הראיות.

אירועי ממשק מחוברים: 4. מסלולי תפיסת כשל מפורשים בקובץ: 0. פירוט מלא ומיקומים במלאי הראיות.

### MapWebView.tsx

[קוד](../../pulse/src/components/MapWebView.tsx)

מקורות: אין שירות נתונים מיובא ישירות; נתונים מתקבלים בפרמטרים או ברכיבים פנימיים..

רכיבי תצוגה ועומק: `WebView`.

מצבים מקומיים: ללא מצב מקומי.

תוכן ופעולות מזוהים: רכיב תצוגה ללא מלל עברי קבוע.

ניווט מפורש: אין מעבר למסך אחר בקוד המקומי; בדקו חלוניות וקריאות חזרה במלאי הראיות.

אירועי ממשק מחוברים: 1. מסלולי תפיסת כשל מפורשים בקובץ: 1. פירוט מלא ומיקומים במלאי הראיות.

### NewSupportChatPicker.tsx

[קוד](../../pulse/src/components/NewSupportChatPicker.tsx)

מקורות: `../services/firebase`.

רכיבי תצוגה ועומק: `Modal`, `KeyboardAvoidingView`, `View`, `Text`, `Pressable`, `Ionicons`, `TextInput`, `ActivityIndicator`, `FlatList`.

מצבים מקומיים: `[users, setUsers]`; `[search, setSearch]`; `[loading, setLoading]`; `[failed, setFailed]`; `[retry, setRetry]`.

תוכן ופעולות מזוהים: שיחה חדשה · בחרו למי לכתוב בשם ⁦Teamder⁩ · סגירת בחירת המשתמש · חיפוש לפי שם או עיר · חיפוש משתמש לשיחה חדשה · טעינת המשתמשים נכשלה. לחצו לניסיון נוסף. · מוצגים 50 מתוך · . צמצמו את החיפוש. · לא נמצאו משתמשים · עיר לא צוינה · בחירת משתמש פותחת שיחה קיימת או ריקה. הודעה נשלחת רק בלחיצה על שליחה..

ניווט מפורש: אין מעבר למסך אחר בקוד המקומי; בדקו חלוניות וקריאות חזרה במלאי הראיות.

אירועי ממשק מחוברים: 5. מסלולי תפיסת כשל מפורשים בקובץ: 1. פירוט מלא ומיקומים במלאי הראיות.

### RatingHistogram.tsx

[קוד](../../pulse/src/components/RatingHistogram.tsx)

מקורות: אין שירות נתונים מיובא ישירות; נתונים מתקבלים בפרמטרים או ברכיבים פנימיים..

רכיבי תצוגה ועומק: `Card`, `View`, `Text`, `StarRow`.

מצבים מקומיים: ללא מצב מקומי.

תוכן ופעולות מזוהים: ביקורות · (מדגם אחרון).

ניווט מפורש: אין מעבר למסך אחר בקוד המקומי; בדקו חלוניות וקריאות חזרה במלאי הראיות.

אירועי ממשק מחוברים: 0. מסלולי תפיסת כשל מפורשים בקובץ: 0. פירוט מלא ומיקומים במלאי הראיות.

### ReviewItem.tsx

[קוד](../../pulse/src/components/ReviewItem.tsx)

מקורות: אין שירות נתונים מיובא ישירות; נתונים מתקבלים בפרמטרים או ברכיבים פנימיים..

רכיבי תצוגה ועומק: `Card`, `View`, `StarRow`, `SourceBadge`, `Text`.

מצבים מקומיים: ללא מצב מקומי.

תוכן ופעולות מזוהים: רכיב תצוגה ללא מלל עברי קבוע.

ניווט מפורש: אין מעבר למסך אחר בקוד המקומי; בדקו חלוניות וקריאות חזרה במלאי הראיות.

אירועי ממשק מחוברים: 0. מסלולי תפיסת כשל מפורשים בקובץ: 0. פירוט מלא ומיקומים במלאי הראיות.

### SupportOutreachPanel.tsx

[קוד](../../pulse/src/components/SupportOutreachPanel.tsx)

מקורות: `../services/supportOutreachService`.

רכיבי תצוגה ועומק: `Card`, `Pressable`, `Text`, `View`, `ActivityIndicator`, `TextInput`.

מצבים מקומיים: `[expanded, setExpanded]`; `[settings, setSettings]`; `[jobs, setJobs]`; `[busy, setBusy]`; `[error, setError]`; `[saved, setSaved]`.

תוכן ופעולות מזוהים: ממתינה לשליחה · נשלחה · המשתמש ענה · דולגה · נכשלה — דורשת בדיקה · המועדון נמחק · כבר אינו מנהל · מחוץ לחלון המשתמש החדש · החשבון אינו זמין · כבר קיבל מענה מהצוות · שגיאת שליחה · לא הצלחנו לטעון את הגדרות הליווי. נסו שוב. · השמירה נכשלה · ליווי מנהלים חדשים · הודעה אישית אחרי הקמת המועדון הראשון · הגדרות ומעקב · ● הליווי האוטומטי פעיל · ○ הליווי האוטומטי מושהה · השינוי יופעל רק לאחר שמירה. הפעלה תחדש גם פניות שממתינות בתור. הודעה אחת לכל משתמש; אין שליחה חוזרת למי שכבר קיבל. · כמה שעות אחרי יצירת המועדון? · עד כמה ימים מההרשמה? 0 = כל משתמש · שעת התחלת שליחה · שעת סיום שליחה · אזור זמן כשאזור המשתמש אינו ידוע · נוסח ההודעה · אפשר לשלב שם עם · , מועדון עם · ושאלה מותאמת עם · . ההשהיה ניתנת לשינוי, לכן הנוסח אינו מתחייב שעבר בדיוק יום. · ההגדרות נשמרו ✓ · שמירת הגדרות הליווי · שינוי ההשהיה מעדכן גם הודעות שממתינות בתור. חלון השעות עשוי לדחות לבוקר; השליחה מתבצעת בבדיקות של חמש דקות. · 20 הפניות האחרונות · רענון · אין עדיין פניות מתוזמנות. משתמשים מתווספים עם פתיחת מועדון ראשון שעומד בתנאים. · משתמש · מתוכננת: · דורשת בדיקה.

ניווט מפורש: אין מעבר למסך אחר בקוד המקומי; בדקו חלוניות וקריאות חזרה במלאי הראיות.

אירועי ממשק מחוברים: 9. מסלולי תפיסת כשל מפורשים בקובץ: 2. פירוט מלא ומיקומים במלאי הראיות.

### TeamderChatSheet.tsx

[קוד](../../pulse/src/components/TeamderChatSheet.tsx)

מקורות: `../services/teamderChatService`.

רכיבי תצוגה ועומק: `Modal`, `KeyboardAvoidingView`, `View`, `Text`, `Pressable`, `Ionicons`, `ActivityIndicator`, `ScrollView`, `Image`, `TextInput`.

מצבים מקומיים: `[thread, setThread]`; `[reports, setReports]`; `[text, setText]`; `[loading, setLoading]`; `[sending, setSending]`; `[resolving, setResolving]`; `[pickingQuote, setPickingQuote]`; `[failed, setFailed]`; `[preview, setPreview]`.

תוכן ופעולות מזוהים: תקלה · עיצוב · רעיון · קיבלנו, אנחנו בודקים את זה 🙏 · תוקן! יצא בגרסה הקרובה 💪 · תודה על הדיווח — עוזר לנו מאוד ⚽ · אפשר עוד קצת פרטים? מה בדיוק קרה לפני זה? · השליחה נכשלה · נסה שוב · הסימון לא נשמר · השיחה נשארה במצבה הקודם. נסו שוב. · שיחה · נשלח בשם ⁦Teamder⁩ · תשובות מתעדכנות אוטומטית · סגירת השיחה · פתיחת השיחה מחדש לטיפול · סמן שיחה כפתורה ללא שליחת הודעה · שומרים… · פתורה · פתיחה מחדש · סמן כפתורה ללא תשובה · טעינת השיחה נכשלה — לחצו לניסיון חוזר · מתוך: · הגדלת צילום המסך · עוד לא דיברתם. זו תהיה ההודעה הראשונה. · מוצגות · ההודעות האחרונות · איזה דיווח לצטט? · למשתמש הזה אין דיווחים · (ללא טקסט) · ביטול · צטט דיווח · כתוב הודעה… · כתיבת תשובה למשתמש · שליחת תשובה למשתמש · סגירת צילום.

ניווט מפורש: אין מעבר למסך אחר בקוד המקומי; בדקו חלוניות וקריאות חזרה במלאי הראיות.

אירועי ממשק מחוברים: 15. מסלולי תפיסת כשל מפורשים בקובץ: 4. פירוט מלא ומיקומים במלאי הראיות.

### UserPicker.tsx

[קוד](../../pulse/src/components/UserPicker.tsx)

מקורות: `../services/firebase`.

רכיבי תצוגה ועומק: `Modal`, `View`, `SafeAreaView`, `Pressable`, `Ionicons`, `Text`, `TextInput`, `ActivityIndicator`, `ScrollView`.

מצבים מקומיים: `[users, setUsers]`; `[q, setQ]`; `[loading, setLoading]`.

תוכן ופעולות מזוהים: בחר משתמש לטסט · חיפוש לפי שם או אימייל… · לא נמצאו משתמשים · ללא שם.

ניווט מפורש: אין מעבר למסך אחר בקוד המקומי; בדקו חלוניות וקריאות חזרה במלאי הראיות.

אירועי ממשק מחוברים: 4. מסלולי תפיסת כשל מפורשים בקובץ: 1. פירוט מלא ומיקומים במלאי הראיות.

### ui.tsx

[קוד](../../pulse/src/components/ui.tsx)

מקורות: אין שירות נתונים מיובא ישירות; נתונים מתקבלים בפרמטרים או ברכיבים פנימיים..

רכיבי תצוגה ועומק: `View`, `Pressable`, `Ionicons`, `Text`, `SafeAreaView`, `ScrollView`, `Card`.

מצבים מקומיים: ללא מצב מקומי.

תוכן ופעולות מזוהים: רכיב תצוגה ללא מלל עברי קבוע.

ניווט מפורש: אין מעבר למסך אחר בקוד המקומי; בדקו חלוניות וקריאות חזרה במלאי הראיות.

אירועי ממשק מחוברים: 1. מסלולי תפיסת כשל מפורשים בקובץ: 0. פירוט מלא ומיקומים במלאי הראיות.
