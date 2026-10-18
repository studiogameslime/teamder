# התמונה המקורית בבועת התמיכה — 17.10.2026

לבקשת הבעלים הוחלף הציור הווקטורי, שהיה שונה מהסקיצה, בתמונה המקורית שנוצרה בשיחה. `src/assets/images/support-football-headphones-original.png` זהה ברמת הבתים למקור. `SupportFootballIcon` מציג אותה באמצעות `Image` בחלון עגול של 50 בתוך הכפתור הקיים בגודל 54; הכיתוב והדוגמה הנוספת שבמקור מוסתרים בחיתוך התצוגה בלבד. לא נוצר סמל חדש. פירוט החיתוך והחותמת ב־[מסמך התמיכה](../features/shared/support-chat.md).

[צילום עדכני באנדרואיד בדמו](../features/screenshots/support-original-image-2026-10-17.png). נבדקו המסך וחיתוך הבועה: צורת הכדור והאוזניות המקורית מופיעה בשלמותה. אין שינוי בפעולת הכפתור, תנאי ההצגה, הטיוטות או השליחה. כרזות פיתוח הוסתרו לצילום בלבד. אייפון ומכשיר פיזי לא נבדקו; לא נשלחה הודעה. השינוי טרם הופץ.

בדיקת `npx tsc --noEmit` עברה. כל חבילת `npx jest --runInBand` עברה: 365 חבילות ו־4,427 בדיקות. בדיקת `python scripts/check-feature-docs.py` הסתיימה ללא כשלים.

נוסף ואומת רישום ב־`appConfig/releaseLog` לגרסה `next`, עם צילום ב־`releaseShots/support-original-image-20261017-7958a2`. קבלת אימות: `tmp/support-original-image/journal-receipt.json`.
