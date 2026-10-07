# צ׳אט — מפת עבודה

עודכן: 07.10.2026; מקור: `8e8fde5`. קוד נקרא; אין צילומי שיחות חיות ואין שליחת הודעות במסגרת המיפוי.

| תחום | הסבר פשוט | פירוט מעמיק | מסכים |
|---|---|---|---|
| רשימת שיחות ומונים | [קצר ופשוט](chats-list.simple.md) | [רשימה](chats-list.md) | `ChatsList` |
| שיחות מועדון, מחזור ופרטית | [קצר ופשוט](conversation-scopes.simple.md) | [גישה והקשרים](conversation-scopes.md) | `CommunityChat`, `GameChat`, `DirectChat` |
| כתיבה, הקלדה וקריאה | [קצר ופשוט](message-interface.simple.md) | [ממשק](message-interface.md) | `ChatView` |
| מחיקה, חסימה ודיווח | [קצר ופשוט](message-actions.simple.md) | [פעולות](message-actions.md) | חלונות בשיחה |
| התראות והרשאה | [קצר ופשוט](notification-delivery.simple.md) | [מסירה](notification-delivery.md) | שירותי התראות והגדרות |

אין לשלוח הודעת בדיקה בחשבון הייצור. בדיקת כתיבה, קריאה הדדית, חסימה ומדיניות פרטית דורשת חשבונות בדיקה מאושרים. מצב דמה אינו מכסה צ׳אט במלואו: חלק ממנויי ההודעות עדיין פונים לשירות. `firestore.rules` נקרא ללא שינוי ואינו הוכחת הפריסה בשרת.
