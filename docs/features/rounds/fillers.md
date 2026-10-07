# ממלאים, השאלה ורוטציה

עודכן: 7.10.2026. מקור הקוד: `8e8fde5`, גרסה `1.1.35`. מסמך זה מתאר את הקוד; מצב חנות ופריסת שרת דורשים ראיה נפרדת.

## כניסה ותפקידים

לייב מתקדם → בקשת מילוי; ניהול מחזור → זמינים/פעימת השלמה

מנהל מאשר ממלא; פנייה לשחקן חיצוני ורישום חבר מועדון הם מסלולים שונים.

## רכיבים ומצבים

| רכיב / מצב | התנהגות וחוזה |
|---|---|
| בחירת ממלא | שחקן וקבוצת יעד; request/confirm/cancel אינם אותה פעולה |
| זמני / קבוע | השאלה זמנית מחזירה לפי כללי הרוטציה; מילוי קבוע משנה סגל |
| ביטול | מתאים את התור ואת מילוי הקבוצה; לא למחוק קבוצה בטעות |
| קבוצה ריקה | retireEmptyTeam ו־prepareRefillPlaying; צורך בהרכב לעומת סגל רשום |
| פניות חיצוניות | FillerInterestsSection מופיע למנהל במחזור acceptsFillers; אמינות, אישור ודחייה |
| פעימת הזמנה | AvailablePlayers startFillerPulse וסיבות חסימה; הזמנה אינה כבר השתתפות |

## מסלול נתונים ומקומות שינוי

[`src/components/match/FillerPickerModal.tsx`](../../../src/components/match/FillerPickerModal.tsx); [`src/services/rotationEngine.ts`](../../../src/services/rotationEngine.ts); [`src/screens/AdvancedLiveMatchScreen.tsx`](../../../src/screens/AdvancedLiveMatchScreen.tsx)

gameService ו־rotationEngine: snapshots, ספירות וצדי משחק; pending פניות טעון מאגר משתמש/אמינות. ממיר המשחק חייב לקרוא תוספות למודל; ממלא אורח נושא מזהה אורח ולא uid מומצא.

ממיר המחזור: [`src/firebase/firestore.ts`](../../../src/firebase/firestore.ts), `fromFirestoreGameDoc`; סוגים: [`src/types`](../../../src/types). שינוי שדה דורש מעקב כתיבה → ממיר → שירות/חנות → רכיב. ניווט: [`GameStack.tsx`](../../../src/navigation/GameStack.tsx), ובמסכים משותפים גם המחסניות שמארחות אותם.

## בדיקות וראיות

rotationFill/rotationDeep/rotationCounts, fillerGuest, rotationQueueReorder; בדיקת תור לאחר ביטול והחזרת מושאל.

צילומי המיפוי מהאמולטור נעשו במצב נתוני דמו, המסומן בפס כתום. הם מוכיחים את הרכיב והמצב המוצגים בלבד, ולא ממירי Firebase, נתוני ייצור או כתיבה. צילומי תיקונים קודמים מסומנים בנפרד. שגיאת מזהה, מצב טעינה או שער הגנה אינם הוכחת הפעולה המלאה.

![ממלאים, השאלה ורוטציה — LiveMatch-advanced](../screenshots/LiveMatch-advanced.jpg)

## גבולות והערות תחזוקה

ממצא קוד לסקירה: FillerInterestsSection נטען גם באפקט וגם במיקוד, ובכשל מסוים מחזיר רשימה ריקה. לא שוחזר; אין לומר שאין פניות כאשר הקריאה נכשלה.

לפני שינוי פתח את הקוד המקושר ואת [כללי הפרויקט](../../../AGENTS.md). לאחר שינוי עדכן במסמך זה את התאריך, נקודת הקוד, המצבים שהתעדכנו, הבדיקות והצילום. אין לטעון שכל מצב/תפקיד נבדק רק משום שקיים צילום אחד.
