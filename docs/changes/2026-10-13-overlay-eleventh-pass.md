# המשך בדיקת חלוניות — סבב אחד־עשר

13.10.2026. מקור b8a8ccf4 עם שינויים מקומיים. נוסף כיסוי חזותי לשלושה רכיבים אמיתיים בדמו המוגן, כעת 24 רכיבים שונים. אין מסך מוצר חדש או שינוי אפיון.

תוקנה ManageEquipmentSheet: הפאנל מיושר לתחתית במקום להתחיל בראש התחום שגובהו 90%; סמלי הכותרת ושורות הציוד מימין. פעולות ביטול/שמירה שומרות על מיקומן החזותי, עם סדר מקור תקין ללא היפוך שורה. לא שונו dirty, דגלי ציוד, saving או callbacks. צילום לפני התיקון נשמר ב־artifacts/home-carousel-height/night-eleventh-manage-before.png.

הוכחות:

- [ללא שינוי טיוטה](../features/screenshots/overlays-eleventh-manage-fixed-2026-10-13.png) ו־[אחרי שינוי גופיות](../features/screenshots/overlays-eleventh-manage-changed-2026-10-13.png): שמירה מושבתת/פעילה לפי שינוי, אין שמירה.
- [בורר 2/2](../features/screenshots/overlays-eleventh-filler-2026-10-13.png), [1/2](../features/screenshots/overlays-eleventh-filler-incomplete-2026-10-13.png), [סוף 12 מועמדים](../features/screenshots/overlays-eleventh-filler-scroll-2026-10-13.png) ו־[מאגר ריק](../features/screenshots/overlays-eleventh-filler-empty-2026-10-13.png): אישור לפי המספר הנדרש, גלילה וסגירה נגישות, ללא החלפה אמיתית.
- [תפריט שחקן](../features/screenshots/overlays-eleventh-player-menu-2026-10-13.png): עוגן נמדד דרך הרכיב האמיתי בתחתית, התפריט מעליו, כל חמש הפעולות נראות והפריט המושבת לא הפעיל פעולה. חזרת מכשיר סגרה; צילום night-eleventh-closed.png נצפה.

שבע תמונות נוספו למניפסט, כעת 515. אין הוכחת שמירת שרת, מנוע רוטציה, אייפון, מצב כהה, כל גדלי הגופן או כל קצות המסך. חלוניות הבדיקה מוגנות בשערי פיתוח ודמו; פעולות מדומות סוגרות בלבד.

טיפוסים נקיים, 286 חבילות ו־3,619 בדיקות עברו ב־94.616 שניות: artifacts/night-eleventh-types.log ו־night-eleventh-jest.log. תיקון ותמונת JPEG נרשמו ביומן הגרסה בלבד; קבלה artifacts/night-eleventh-release-receipt.json. אין פריסה, שינוי הרשאות, בניית חנות, קומיט או דחיפה.
