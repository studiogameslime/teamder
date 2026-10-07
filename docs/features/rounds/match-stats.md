# סטטיסטיקה וסיכום אישי של מחזור

עודכן: 7.10.2026. מקור הקוד: `8e8fde5`, גרסה `1.1.35`. מסמך זה מתאר את הקוד; מצב חנות ופריסת שרת דורשים ראיה נפרדת.

## כניסה ותפקידים

MatchDetails → סטטיסטיקה; סיכום אישי → EveningSummary {gameId}

משתתף רואה את סיכומו; הרשאת צפייה בנתוני מועדון נשמרת; השלמת שער למנהל במחזור שהסתיים.

## רכיבים ומצבים

| רכיב / מצב | התנהגות וחוזה |
|---|---|
| סיכום כללי | משחקים, שערים, בישולים והכרעות פנדלים לפי יחידותיהם; נתון חסר שונה מאפס |
| כוכבים ואירועים | כוכבי המחזור, מה קרה הערב והישגים; אינם נתונים של כל החיים |
| טבלה | עמודת זהות ודירוג נעוצים, מדדים גוללים ומיון; אורח ושחקן עם אפס נשארים |
| סיכום אישי | getEveningSummary: השתתפות, תוצאות ומדדים; eveningPlayed גובר על ניחוש מטיימר |
| שיתוף | captureRef לקובץ PNG ושיתוף; צילום שיתוף נוצר מהמודל ולא מחדש את החישובים |
| תיקון שער | RetroGoalsSheet: add/removeRetroGoal; clientid לאידמפוטנטיות; אין להוסיף לנתון אמיתי בשביל צילום |
| מצבים | טרם התקיים, היסטורי ללא נתונים, משתתף ללא שערים, רגיל ומתקדם |

## מסלול נתונים ומקומות שינוי

[`src/components/match/tabs/MatchStatsTab.tsx`](../../../src/components/match/tabs/MatchStatsTab.tsx); [`src/screens/games/EveningSummaryScreen.tsx`](../../../src/screens/games/EveningSummaryScreen.tsx); [`src/components/match/RetroGoalsSheet.tsx`](../../../src/components/match/RetroGoalsSheet.tsx)

eveningSummaryService, src/services/gameService.ts, src/utils/eveningPlayed.ts; add/removeRetroGoal בשרת. functions/statBatch ו־eveningRecords; ממיר משחק ורשומות. זמן ונתוני שחקן לא משוחזרים מהקבוצות האחרונות בלבד.

ממיר המחזור: [`src/firebase/firestore.ts`](../../../src/firebase/firestore.ts), `fromFirestoreGameDoc`; סוגים: [`src/types`](../../../src/types). שינוי שדה דורש מעקב כתיבה → ממיר → שירות/חנות → רכיב. ניווט: [`GameStack.tsx`](../../../src/navigation/GameStack.tsx), ובמסכים משותפים גם המחסניות שמארחות אותם.

## בדיקות וראיות

eveningSummary/eveningStats/eveningAttendance/eveningMovement/eveningScoreParity/eveningPlayedMirror; שיתוף וכיווניות עם שם ארוך/לטיני ואורח.

צילומי המיפוי מהאמולטור נעשו במצב נתוני דמו, המסומן בפס כתום. הם מוכיחים את הרכיב והמצב המוצגים בלבד, ולא ממירי Firebase, נתוני ייצור או כתיבה. צילומי תיקונים קודמים מסומנים בנפרד. שגיאת מזהה, מצב טעינה או שער הגנה אינם הוכחת הפעולה המלאה.

![סטטיסטיקה וסיכום אישי של מחזור — MatchDetails-stats](../screenshots/MatchDetails-stats.jpg)

לא נאסף צילום עדכני תקף למסלול העצמאי הזה; התיאור נשען על הקוד.

## גבולות והערות תחזוקה

הכלל ההיסטורי ״משחק רגיל מאפשר רק פרס אחד״ הוחלף: השלמת שערים יכולה להשפיע על פרסים נוספים. אין להחיל ממצא ארכיון בלי בדיקת הקוד.

לפני שינוי פתח את הקוד המקושר ואת [כללי הפרויקט](../../../AGENTS.md). לאחר שינוי עדכן במסמך זה את התאריך, נקודת הקוד, המצבים שהתעדכנו, הבדיקות והצילום. אין לטעון שכל מצב/תפקיד נבדק רק משום שקיים צילום אחד.
