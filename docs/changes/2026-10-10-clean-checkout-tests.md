# הכנת תבניות בבדיקה ממחשב חדש

במחשב שני נכשל inviteLandingRecovery מול functions/templates/community.html שנותר ישן. התיקייה אינה נשמרת בגיט: היא תוצר של functions/scripts/copy-template.js, המעתיק את קובצי המקור public/c/index.html ו־public/invite.html בזמן בניית השרת. במחשב הפיתוח הבדיקות עברו מול תוצר מעודכן, ולכן לא חשפו את חוסר שלב ההכנה במחשב השני.

jest.config.js מפעיל כעת tests/setup-generated-templates.cjs לפני הבדיקות. ההכנה משתמשת באותו מעתיק של בניית השרת, גם בהפעלה ישירה דרך npx jest. אין פריסה או שינוי באתר; קובצי המקור והבדיקות לא הוחלשו. תבנית חסרה או מיושנת נוצרת מחדש לפני הבדיקה.
