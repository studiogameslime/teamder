#!/usr/bin/env bash
# End-to-end health check for the Joryio integration.
# Read-only: probes, counts and compares. Never writes to Joryio or Firestore.
set -uo pipefail
# PRODUCTION. hippomation-backend.fly.dev was the test backend and is retired;
# defaulting to it meant a "verified" run that proved nothing about the host the
# app actually talks to.
B="${JORYIO_BASE_URL:-https://api-eu1.joryio.com/api}"
K="${JORYIO_API_KEY:?set JORYIO_API_KEY}"
R=/Users/matan/Projects/soccer
pass=0; fail=0
ok(){ printf "  ✓ %s\n" "$1"; pass=$((pass+1)); }
no(){ printf "  ✗ %s — %s\n" "$1" "$2"; fail=$((fail+1)); }

echo "═══ 1. קוד ═══"
(cd "$R" && npx tsc --noEmit -p tsconfig.json >/dev/null 2>&1) \
  && ok "tsc נקי" || no "tsc" "שגיאות טיפוסים"
T=$(cd "$R" && npx jest --silent 2>&1 | grep -oE "Tests: +[0-9]+ passed" | grep -oE "[0-9]+")
[ -n "${T:-}" ] && ok "$T בדיקות עוברות" || no "jest" "בדיקות נכשלו"

echo "═══ 2. חיווט האירועים ═══"
DEF=$(grep -cE "^\s+[A-Z][A-Za-z]+:\s*'[a-z_]+'," "$R/src/services/analyticsService.ts")
CALL=$(grep -rhoE "AnalyticsEvent\.[A-Za-z]+" "$R/src" | sort -u | wc -l | tr -d ' ')
echo "     מוגדרים: $DEF · מחוברים: $CALL"
(cd "$R" && npx jest tests/logic/analyticsWiring.test.ts --silent >/dev/null 2>&1) \
  && ok "כל קבוע מחובר לקריאה" || no "חיווט" "יש קבועים ללא קריאה"

echo "═══ 3. ה-SDK הנייטיבי ═══"
APK="$R/android/app/build/outputs/apk/debug/app-debug.apk"
if [ -f "$APK" ]; then
  D=$(mktemp -d); (cd "$D" && unzip -q -o "$APK" 'classes*.dex' 2>/dev/null)
  N=$(cat "$D"/classes*.dex 2>/dev/null | strings | grep -c "io/joryio" || echo 0)
  [ "$N" -gt 0 ] && ok "אנדרואיד: SDK ב-APK ($N אזכורים)" || no "אנדרואיד" "אין מחלקות joryio ב-APK"
  rm -rf "$D"
else no "אנדרואיד" "אין APK — הרץ בנייה"; fi
[ -f "$R/ios/Podfile.lock" ] && grep -q "Joryio/UI" "$R/ios/Podfile.lock" \
  && ok "iOS: Joryio/UI ב-Podfile.lock" || no "iOS" "ה-pod לא מותקן"
[ -f "$R/vendor/joryio/react-native-sdk/react-native.config.js" ] \
  && ok "react-native.config.js קיים (בלעדיו האוטולינק מדלג בשקט)" \
  || no "autolink" "react-native.config.js חסר"

echo "═══ 4. מפתחות ═══"
grep -rq "jry_sdk_" "$R/src" 2>/dev/null \
  && no "מפתחות" "מפתח SDK בקוד המקור" || ok "אין מפתחות בקוד המקור"
grep -q "EXPO_PUBLIC_JORYIO_SDK_KEY_ANDROID" "$R/.env" 2>/dev/null \
  && ok "מפתחות ב-.env" || no "מפתחות" "חסרים ב-.env"

echo "═══ 5. ה-API ═══"
code(){ curl -sS --max-time 30 -o /dev/null -w "%{http_code}" "$@" 2>/dev/null; }
[ "$(code "$B/users?limit=1" -H "Authorization: Bearer $K")" = "200" ] \
  && ok "REST מגיב" || no "REST" "לא מגיב"
[ "$(code "$B/users?limit=1")" = "401" ] \
  && ok "אימות נאכף" || no "אבטחה" "גישה ללא מפתח לא נחסמת"

echo "═══ 6. נתונים ב-Joryio ═══"
curl -sS --max-time 60 "$B/users?limit=1" -H "Authorization: Bearer $K" 2>/dev/null \
 | python3 -c "
import json,sys
t=json.load(sys.stdin)['pagination']['total']
print(f'     משתמשים: {t}')
sys.exit(0 if t>=500 else 1)" && ok "מצבת המשתמשים" || no "משתמשים" "פחות מהצפוי"
curl -sS --max-time 90 "$B/analytics/events" -H "Authorization: Bearer $K" 2>/dev/null \
 | python3 -c "
import json,sys
d=json.load(sys.stdin); ev=d['events']
tot=sum(int(e['totalCount']) for e in ev)
print(f'     אירועים: {tot} ב-{len(ev)} סוגים')
bad=[e['eventName'] for e in ev if e['eventName'] in ('track','\$identify')]
if bad: print('     ⚠ שמות גנריים:',bad)
sys.exit(0 if len(ev)>=20 else 1)" && ok "מגוון האירועים" || no "אירועים" "פחות מ-20 סוגים"

echo "═══ 7. דף הנחיתה ═══"
[ "$(code https://teamderfc.web.app/js/joryio.js)" = "200" ] \
  && ok "הסקריפט חי בייצור" || no "web" "הסקריפט לא נגיש"
curl -sS --max-time 30 https://teamderfc.web.app/ 2>/dev/null | grep -q "js/joryio.js" \
  && ok "מחובר לדף הבית" || no "web" "לא מחובר"

echo
echo "═══ $pass עברו · $fail נכשלו ═══"
exit $((fail > 0))
