# לייב מתקדם ורוטציה

עודכן: 7.10.2026. מקור הקוד: `8e8fde5`, גרסה `1.1.35`. מסמך זה מתאר את הקוד; מצב חנות ופריסת שרת דורשים ראיה נפרדת.

## כניסה ותפקידים

LiveMatch של מחזור advancedMode

מנהל מנהל תוצאה/תור/שחקנים; השינויים נשמרים דרך פרוטוקול השירות והשרת.

## רכיבים ומצבים

| רכיב / מצב | התנהגות וחוזה |
|---|---|
| מצב חי | subscribeLiveGame: liveMatch, rotation, draftTeams; שתי קבוצות על מגרש ותור ממתינים |
| תחילת משחק | prepareStartRotation / markGameStarted וטיימר; מצב לפני התחלה שונה ממשחק פעיל |
| תוצאה | WinnerPickerModal; prepareRoundResult → commitFilledRotation; תוצאות נשמרות פעם אחת |
| תיקו | TieDecisionModal: ידני, פנדלים, או שתיהן יוצאות רק אם waiting[1] קיים |
| תור | reorderWaiting, מילוי חסר, nudgeRotationAfterFillCancel; אינדקסי תור אינם צבעי קבוצות |
| שחקנים | הלך הביתה/חזר, החלפה/העברה, פרישת קבוצה ריקה, מילוי קבוצות פעילות |
| תפריט | משחקים, איפוס, סיום; אישורים ולא מחיקה לצילום |
| סיום מחזור | endEvening, סטטיסטיקה, equipment; אינו סיום המשחק הבודד |

## מסלול נתונים ומקומות שינוי

[`src/screens/AdvancedLiveMatchScreen.tsx`](../../../src/screens/AdvancedLiveMatchScreen.tsx); [`src/components/match/RotationPanel.tsx`](../../../src/components/match/RotationPanel.tsx)

src/services/gameService.ts, rotationEngine.ts, gameLifecycle.ts; functions/src/commitProtocol.ts, roundSummary.ts, statBatch.ts. snapshot של הרכב ותוצאת משחק חייב לשקף מי שיחק ולא רק סגל סופי. פרוטוקול אידמפוטנטי מונע כפילות בחזרה/לחיצה.

ממיר המחזור: [`src/firebase/firestore.ts`](../../../src/firebase/firestore.ts), `fromFirestoreGameDoc`; סוגים: [`src/types`](../../../src/types). שינוי שדה דורש מעקב כתיבה → ממיר → שירות/חנות → רכיב. ניווט: [`GameStack.tsx`](../../../src/navigation/GameStack.tsx), ובמסכים משותפים גם המחסניות שמארחות אותם.

## בדיקות וראיות

rotationEngine/rotationFill/rotationDeep/rotationCounts, rotationQueueReorder, idempotency, advancedMatchStats ו־shootoutPersistence.

צילומי המיפוי מהאמולטור נעשו במצב נתוני דמו, המסומן בפס כתום. הם מוכיחים את הרכיב והמצב המוצגים בלבד, ולא ממירי Firebase, נתוני ייצור או כתיבה. צילומי תיקונים קודמים מסומנים בנפרד. שגיאת מזהה, מצב טעינה או שער הגנה אינם הוכחת הפעולה המלאה.

![לייב מתקדם ורוטציה — LiveMatch-advanced](../screenshots/LiveMatch-advanced.jpg)

## גבולות והערות תחזוקה

הצילום הנוכחי מציג בפועל את שער ״עוד לא חולקו כוחות״; אין לכנותו הוכחה לכל הרוטציה. ארבע קבוצות ומעלה נדרשות ליציאת שתיהן כשיש שתי מחליפות.

לפני שינוי פתח את הקוד המקושר ואת [כללי הפרויקט](../../../AGENTS.md). לאחר שינוי עדכן במסמך זה את התאריך, נקודת הקוד, המצבים שהתעדכנו, הבדיקות והצילום. אין לטעון שכל מצב/תפקיד נבדק רק משום שקיים צילום אחד.
