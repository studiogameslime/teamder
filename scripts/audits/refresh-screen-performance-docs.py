"""Refresh only feature cards affected by the reviewed performance changes."""
from pathlib import Path
import contextlib
import hashlib
import io
import json
import os
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
import feature_status as status

OUT = ROOT / 'artifacts/performance-2026-11-04'
BASE = ROOT / 'docs/features'
sources = {p.relative_to(OUT / 'before-src').as_posix() for p in (OUT / 'before-src').rglob('*') if p.is_file()}
sources.update(['src/services/publicPlayerService.ts', 'src/services/clubAdminRatings.ts', 'src/services/playerStatsService.ts',
                'src/services/groupService.ts', 'src/services/userService.ts', 'src/components/loading/DraftSetupSkeleton.tsx',
                'tests/entryOnboarding.test.ts', 'tests/logic/myActivityNavigation.test.tsx', 'tests/logic/ownPlayerCardLifecycle.test.ts',
                'tests/logic/ownPlayerCardLifecycle.test.tsx', 'tests/logic/clientAuditRecovery.test.ts', 'tests/logic/comparisonActivityVisit.test.ts',
                'tests/logic/draftSetupLoading.test.ts', 'tests/logic/profileIdentityLoading.test.ts', 'tests/logic/draftBoardRefresh.test.ts',
                'tests/logic/communityRosterLoading.test.ts', 'tests/logic/availablePlayersPulseCapacity.test.tsx'])
sources.update(['tests/logic/pulse23ExpectedConditions.test.ts', 'tests/logic/statisticsTransitionLoading.test.ts', 'tests/logic/pulseCurrentStatistics.test.ts'])
registry = status.load()
affected = []
notes = []
for item in registry['features']:
    changed = [file for file, old in item['sources'].items() if (ROOT / file).is_file() and status.digest(ROOT / file) != old]
    task_changed = sorted(set(changed) & sources)
    documents_changed = any(status.digest(BASE / file) != old for file, old in item['documents'].items())
    task_documented = '2026-11-04-screen-performance.md' in (BASE / item['technical']).read_text(encoding='utf-8-sig')
    if not task_changed and not task_documented:
        continue
    if task_changed and not documents_changed:
        first, _, rest = (BASE / item['technical']).read_text(encoding='utf-8-sig').partition('\n')
        descriptions = []
        if any(file.startswith('src/navigation/') for file in task_changed):
            descriptions.append('מסכי המחסניות נרשמים באמצעות טעינת מודול לפי צורך, וכל שמות המסלולים נשמרו. הבית מורכב מתחת לספלאש. אין מסלול חדש או שינוי בתנאי ניווט של הפיצר הזה.')
        if any(file in task_changed for file in ['src/services/publicPlayerService.ts', 'src/services/groupService.ts', 'src/services/userService.ts', 'src/services/clubAdminRatings.ts']):
            descriptions.append('קריאות חופפות לזהויות שחקנים או לדירוגי מועדון חולקות עבודה פעילה באותה התחברות. שמירת פרופיל או דירוג מבטלת שיתוף קודם, ולא נשמרת תשובה שהושלמה לשימוש חוזר. אין שינוי במקור הרשאות או בחוזה הנתונים העצמאי של הפיצר.')
        if 'src/services/playerStatsService.ts' in task_changed or 'src/components/home/HomePersonalStats.tsx' in task_changed:
            descriptions.append('שירות הסטטיסטיקה תומך בסכומים טריים שמתקבלים במקביל לשאילתות הבסיס. הסיכום ממתין לסכומים לפני פרסום, והעשרת ההיסטוריה נפרדת. אין שינוי במוני שערים ובישולים, בטווח או במכני נוכחות.')
        if any(file in task_changed for file in ['src/screens/LiveMatchScreen.tsx', 'src/screens/AdvancedLiveMatchScreen.tsx', 'src/services/useSyncedTimer.ts']):
            descriptions.append('עדכוני תצוגת השעון והעצירות וסנכרון הזמן המחזורי מוגבלים למיקוד המסך. בחזרה הזמן מחושב מהעוגן המשותף, ללא שינוי בתוצאת המשחק או בכתיבות.')
        if not descriptions:
            descriptions.append('עודכנה תלות משותפת במסלול טעינה או במתאם הבדיקה, בהיקף השינוי המתועד בלבד. אין שינוי מכוון בחישובים או בפעולות העצמאיות של הפיצר הזה.')
        body = '\n\n'.join(descriptions) + '\n\nמקורות משויכים שנבדקו בהיקף השינוי: ' + ', '.join('`' + file + '`' for file in task_changed) + '.\n\n'
        body += 'מימוש מקומי וטרם הופץ. אין בכך אימות מכשיר חדש של הפיצר הזה או מדידת מהירות של כל מסלוליו. [המדידות התחומות, הבדיקות והמגבלות](../../changes/2026-11-04-screen-performance.md).'
        (BASE / item['technical']).write_text(first + '\n\n## השפעת שיפורי הטעינה המשותפים, 4.11.2026\n\n' + body + '\n\n' + rest.lstrip(), encoding='utf-8')
        first, _, rest = (BASE / item['simple']).read_text(encoding='utf-8-sig').partition('\n')
        simple = 'עודכנו מנגנוני הטעינה המשותפים כדי לצמצם עבודה וקריאות חוזרות. דרך השימוש בפיצר נשמרת. השינוי מקומי וטרם הופץ, ואין אימות מכשיר חדש של המסך הזה. [היקף, מדידות ומגבלות](../../changes/2026-11-04-screen-performance.md).'
        (BASE / item['simple']).write_text(first + '\n\n## שיפורי טעינה משותפים, 4.11.2026\n\n' + simple + '\n\n' + rest.lstrip(), encoding='utf-8')
    notes.append({'feature': item['id'], 'reviewedTaskSources': task_changed, 'otherExistingDriftAtRefresh': sorted(set(changed) - sources)})
    affected.append(item['id'])

# Use the canonical capture/render functions once per batch. Repeated full
# registry writes triggered transient Windows file-open errors in this task.
ps = status.pairs()
owners = status.screen_owners(ps)
pair_by_id = {pair['technical'][:-3]: pair for pair in ps}
results = []
for index, old in enumerate(registry['features']):
    if old['id'] not in affected:
        continue
    new = status.capture(pair_by_id[old['id']], owners)
    if old['sources'] != new['sources'] and old['documents'] == new['documents']:
        raise RuntimeError('Source changed without updated documentation: ' + old['id'])
    registry['features'][index] = new
    results.append({'feature': old['id'], 'exit': 0})
registry['screens'] = owners
temporary = OUT / 'state-refreshed.json'
temporary.write_text(json.dumps(registry, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
json.loads(temporary.read_text(encoding='utf-8'))
os.replace(temporary, status.REGISTRY)
status.render(registry)
(OUT / 'docs-refresh-receipt.json').write_text(json.dumps({'affected': affected, 'notes': notes, 'results': results}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'refreshedFeatures': len(affected), 'otherExistingSourceDifferencesRecorded': sum(bool(n['otherExistingDriftAtRefresh']) for n in notes)}, ensure_ascii=False))
