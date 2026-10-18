"""Local-only production-source audit, extended only for observed scenarios."""
from pathlib import Path
from collections import Counter
import hashlib
import json

HERE = Path(__file__).resolve().parent
WORKSPACE = next(parent for parent in HERE.parents if (parent / 'AGENTS.md').is_file())
receipt_path = HERE.parent / 'identities.json'
if not receipt_path.exists(): receipt_path = HERE / 'identities.json'
receipt = json.loads(receipt_path.read_text(encoding='utf-8'))
baseline = json.loads((HERE / 'baseline-eleven.json').read_text(encoding='utf-8'))
gid = receipt['roundIds'][2]; uid = receipt['accountId']; club = receipt['clubId']
checks = []; timeline = {}; sources = []


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def check(name, condition, actual=None):
    checks.append({'name': name, 'passed': bool(condition), **({'actual': actual} if actual is not None else {})})


for label in ['full-roster', 'captains-saved', 'player-left', 'permanent-move', 'permanent-restored', 'auto-refill-saved', 'auto-refill-restored']:
    path = HERE / f'data-eleven-{label}.json'
    if not path.exists(): continue
    snapshot = json.loads(path.read_text(encoding='utf-8'))
    row = next(item for item in snapshot['games'] if item['game']['id'] == gid)
    game = row['game']['fields']; draft = game.get('draftTeams') or {}; rotation = game.get('rotation') or {}; live = game.get('liveMatch') or {}
    teams = draft.get('teams') or []; guests = game.get('guests') or []
    eligible = {uid, *('guest:' + guest['id'] for guest in guests if not guest.get('waitlisted'))}
    sources.append({'file': path.name, 'sha256': digest(path), 'readCompletedAt': snapshot['readCompletedAt']})
    timeline[label] = {'snapshot': snapshot, 'row': row, 'game': game, 'draft': draft, 'rotation': rotation, 'live': live, 'teams': {team['index']: team for team in teams}}
    check(f'{label}: היקף הקבלה והבעלות נכונים', game['createdBy'] == uid and game['groupId'] == club and snapshot['readScope']['accountId'] == uid and snapshot['readScope']['clubId'] == club and gid in snapshot['readScope']['newRoundIds'])
    check(f'{label}: שלוש קבוצות אחד־עשר בהשלמות קבועות וללא גיוס חיצוני', game['format'] == '11v11' and game['numberOfTeams'] == 3 and game['maxPlayers'] == 33 and game['advancedFillMode'] == 'permanent' and game['advancedMode'] is True and game['visibility'] == 'community' and game['acceptsFillers'] is False)
    check(f'{label}: הסגל שומר 33 זהויות זכאיות ו־32 אורחים ללא ממתינים', game['players'] == [uid] and len(guests) == 32 and len(eligible) == 33 and len({guest['id'] for guest in guests}) == 32 and not any(guest.get('waitlisted') for guest in guests))
    check(f'{label}: אין עדיין אירועים או זקיפות משחק או נוכחות', not row['history'] and not row['commits'] and not row['playerStats'] and row['roundSummary'] is None and row['finishProof']['attendanceCredit'] is None and not row['finishProof']['stages'])
    check(f'{label}: השעון אינו תנאי לפעולות שבוצעו ולא התחיל', live.get('timerRunning', False) is False and live.get('timerAccumulatedMs', 0) == 0 and not live.get('timerEvents') and not live.get('activeIntervals') and live.get('scoreA', 0) == live.get('scoreB', 0) == 0 and not live.get('goals') and not live.get('shootout'))
    flat = [actor for team in teams for actor in team['playerIds']]
    check(f'{label}: אין כפילות או שחקן לא זכאי בכוחות שנשמרו', len(flat) == len(set(flat)) and set(flat) <= eligible and not set(flat).intersection(item['playerId'] for item in draft.get('leftHome') or []))
    check(f'{label}: כל הקפטנים הנוכחיים משובצים בקבוצתם', all(team['captainId'] in team['playerIds'] for team in teams))
    check(f'{label}: שלושת הישנים ושני החדשים הקודמים ללא שינוי', snapshot['oldRoundComparison']['allUnchanged'] and all(old['digest'] == hashlib.sha256(json.dumps(next(item for item in snapshot['games'] if item['game']['id'] == old['id']), sort_keys=True, ensure_ascii=False).encode('utf-8')).hexdigest() for old in baseline['priorNewRounds']))
    for source_name in ['account', 'qaClubStats', 'clubTotals', 'clubShowcase', 'clubRecords']:
        before = {key: value for key, value in baseline['globalCounters'][source_name]['numbers'].items() if key != 'updatedAt'}
        after = {key: value for key, value in snapshot['globalCounters'][source_name]['numbers'].items() if key != 'updatedAt'}
        check(f'{label}: אין זקיפה או איפוס במקור {source_name}', before == after)

full = timeline['full-roster']; guests = full['game']['guests']
by_name = {guest['name']: 'guest:' + guest['id'] for guest in guests}
actor = lambda number: by_name[f'אחדעשר־{number:02}']
long_actor = by_name['שחקן בדיקה שם ארוך']
captains = timeline['captains-saved']
check('קפטנים: הקפטנים שנבחרו הם החשבון, אורח01 ואורח02', [captains['teams'][index]['captainId'] for index in range(3)] == [uid, actor(1), actor(2)])
check('קפטנים: שלושה הרכבים מלאים המכסים את כל 33 הזכאים', all(len(team['playerIds']) == 11 for team in captains['teams'].values()) and {member for team in captains['teams'].values() for member in team['playerIds']} == eligible)
check('קפטנים: טיוטת נחש נשמרה עם צילום הרכבים זהה לפני פרסום', captains['draft']['method'] == 'snake' and captains['draft']['published'] is False and captains['draft']['originalTeams'] == captains['draft']['teams'] and captains['game'].get('rotation') is None and captains['game'].get('liveMatch') is None)
expected_picks = {0: [uid], 1: [actor(1)], 2: [actor(2)]}
for index, member in enumerate([*(actor(number) for number in range(3, 32)), long_actor]):
    turn = index % 3 if (index // 3) % 2 == 0 else 2 - index % 3
    expected_picks[turn].append(member)
check('קפטנים: כל 30 הבחירות תואמות לסדר הנחש ולשמות שנבחרו', all(captains['teams'][index]['playerIds'] == expected for index, expected in expected_picks.items()))
left = timeline['player-left']; moved = timeline['permanent-move']; restored = timeline['permanent-restored']
color_indexes = {team['colorKey']: team['index'] for team in restored['teams'].values()}
red, blue, green = (color_indexes[color] for color in ['red', 'blue', 'green'])
check('יציאה: אורח03 יצא מהאדומים ומסומן בחוץ עם בית אדום', [len(left['teams'][index]['playerIds']) for index in range(3)] == [10, 11, 11] and actor(3) not in left['teams'][red]['playerIds'] and len(left['draft']['leftHome']) == 1 and left['draft']['leftHome'][0]['playerId'] == actor(3) and left['draft']['leftHome'][0]['homeTeam'] == red)
check('יציאה: סגלי הבסיס הם צילום החלוקה המקורית לפני יציאה', left['rotation']['baseTeams'] == [{'index': team['index'], 'playerIds': team['playerIds']} for team in captains['draft']['teams']])
check('מעבר קבוע: אורח02 עבר מהירוקים לחור באדומים ללא השאלה', moved['teams'][red]['playerIds'] == left['teams'][red]['playerIds'] + [actor(2)] and moved['teams'][green]['playerIds'] == [member for member in left['teams'][green]['playerIds'] if member != actor(2)] and moved['teams'][blue] == left['teams'][blue] and not moved['rotation']['loans'])
check('מעבר קבוע: האדומים מלאים והירוקים חסרים, והשחקן שיצא עדיין בחוץ', [len(moved['teams'][index]['playerIds']) for index in range(3)] == [11, 11, 10] and moved['draft']['leftHome'] == left['draft']['leftHome'])
check('מעבר קבוע: שינוי קפטן הירוקים משאיר קפטן זכאי בהרכב', moved['teams'][green]['captainId'] == actor(5) and actor(5) in moved['teams'][green]['playerIds'])
check('מעבר קבוע: סגלי הבסיס והצילום המקורי נשמרו לצורך החזרה', moved['rotation']['baseTeams'] == left['rotation']['baseTeams'] and moved['draft']['originalTeams'] == captains['draft']['originalTeams'])
check('החזרה: אורח03 חזר לאדומים ואורח02 לירוקים ללא כפילות', restored['teams'][red]['playerIds'] == left['teams'][red]['playerIds'] + [actor(3)] and restored['teams'][green]['playerIds'] == moved['teams'][green]['playerIds'] + [actor(2)] and restored['teams'][blue] == left['teams'][blue])
check('החזרה: שלוש קבוצות מלאות, אין יוצאים ואין השאלות', all(len(team['playerIds']) == 11 for team in restored['teams'].values()) and not restored['draft']['leftHome'] and not restored['rotation']['loans'])
check('החזרה: חלוקת הזהויות בכל קבוצה תואמת למקור ללא תלות במיקום ברשימה', all(set(restored['teams'][index]['playerIds']) == set(captains['teams'][index]['playerIds']) for index in range(3)))
check('החזרה: צילום הבסיס לא הוחלף בעקבות ההשלמה וההחזרה', restored['rotation']['baseTeams'] == left['rotation']['baseTeams'])
for label in ['permanent-move', 'permanent-restored']:
    item = timeline[label]
    check(f'{label}: זהות המשחק הראשון והצדדים נשארו ללא שינוי', all(item['rotation'][key] == left['rotation'][key] for key in ['round', 'roundInstanceId', 'roundInstanceRound', 'playing', 'waiting', 'wins']))
    check(f'{label}: כל הלוח והשעון נותרו בדיוק כמו לאחר היציאה', item['live'] == left['live'])

if 'auto-refill-saved' in timeline:
    automatic = timeline['auto-refill-saved']; reference = timeline['permanent-restored']
    check('הצעה אוטומטית שנשמרה: הפעם05 באדומים ולא02', actor(5) in automatic['teams'][red]['playerIds'] and actor(5) not in automatic['teams'][green]['playerIds'] and actor(2) in automatic['teams'][green]['playerIds'])
    check('הצעה אוטומטית שנשמרה: שינוי יחיד מול ההרכב שהוחזר קודם', automatic['teams'][red]['playerIds'] == [member for member in reference['teams'][red]['playerIds'] if member != actor(3)] + [actor(5)] and automatic['teams'][green]['playerIds'] == [member for member in reference['teams'][green]['playerIds'] if member != actor(5)] and automatic['teams'][blue] == reference['teams'][blue])
    check('הצעה אוטומטית שנשמרה: השלמה קבועה ללא השאלות ו03 בחוץ', not automatic['rotation']['loans'] and len(automatic['draft']['leftHome']) == 1 and automatic['draft']['leftHome'][0]['playerId'] == actor(3) and [len(automatic['teams'][index]['playerIds']) for index in range(3)] == [11, 11, 10])
    check('הצעה אוטומטית שנשמרה: זהות המשחק והשעון נשמרו', all(automatic['rotation'][key] == reference['rotation'][key] for key in ['round', 'roundInstanceId', 'roundInstanceRound', 'playing', 'waiting', 'wins']) and automatic['live'] == reference['live'])
if 'auto-refill-restored' in timeline:
    latest = timeline['auto-refill-restored']
    check('החזרה אחרי הצעה אוטומטית:03 באדומים ו05 חזר לירוקים', latest['teams'][red]['playerIds'] == [member for member in automatic['teams'][red]['playerIds'] if member != actor(5)] + [actor(3)] and latest['teams'][green]['playerIds'] == automatic['teams'][green]['playerIds'] + [actor(5)] and latest['teams'][blue] == automatic['teams'][blue])
    check('החזרה אחרי הצעה אוטומטית: שלוש קבוצות מלאות וללא יוצאים או השאלות', all(len(team['playerIds']) == 11 for team in latest['teams'].values()) and len({member for team in latest['teams'].values() for member in team['playerIds']}) == 33 and not latest['rotation']['loans'] and not latest['draft']['leftHome'])
    check('החזרה אחרי הצעה אוטומטית: החברות בקבוצות תואמת לחלוקת הקפטנים', all(set(latest['teams'][index]['playerIds']) == set(captains['teams'][index]['playerIds']) for index in range(3)))
    check('החזרה אחרי הצעה אוטומטית: כל הלוח, השעון והמשחק המקורי נשמרו', latest['live'] == reference['live'] and all(latest['rotation'][key] == reference['rotation'][key] for key in ['round', 'roundInstanceId', 'roundInstanceRound', 'playing', 'waiting', 'wins']))
    check('החזרה אחרי הצעה אוטומטית: בסיס ההחזרה עדיין תואם לצילום המקורי', latest['rotation']['baseTeams'] == left['rotation']['baseTeams'])
else:
    latest = restored

post = {}
for label in ['penalty-miss', 'alternative-before-confirm', 'round-one-committed', 'clock-paused', 'captain-fixed-saved', 'captain-fixed-restored', 'round-two-committed', 'repair-01-green', 'repair-original-rosters', 'network-offline', 'network-reconnected', 'goals-two', 'legacy-before-restore', 'legacy-denied-confirmed', 'legacy-space-freed', 'legacy-restored-after-space']:
    path = HERE / f'data-eleven-{label}.json'
    if not path.exists(): continue
    snapshot = json.loads(path.read_text(encoding='utf-8'))
    row = next(item for item in snapshot['games'] if item['game']['id'] == gid)
    game = row['game']['fields']; live = game.get('liveMatch') or {}; rotation = game.get('rotation') or {}
    post[label] = {'snapshot': snapshot, 'row': row, 'game': game, 'live': live, 'rotation': rotation}
    sources.append({'file': path.name, 'sha256': digest(path), 'readCompletedAt': snapshot['readCompletedAt']})
    check(f'{label}: היקף זהות המחזור והבעלות תקין', game['createdBy'] == uid and game['groupId'] == club and snapshot['readScope']['accountId'] == uid and snapshot['readScope']['clubId'] == club)
    check(f'{label}: המחזורים הישנים ושני החדשים הקודמים ללא שינוי', snapshot['oldRoundComparison']['allUnchanged'] and all(old['digest'] == hashlib.sha256(json.dumps(next(item for item in snapshot['games'] if item['game']['id'] == old['id']), sort_keys=True, ensure_ascii=False).encode('utf-8')).hexdigest() for old in baseline['priorNewRounds']))
    check(f'{label}: אין סיכום או זקיפת נוכחות לפני סיום המחזור', row['roundSummary'] is None and row['finishProof']['attendanceCredit'] is None and not row['finishProof']['stages'])
    committed = len(row['history'])
    check(f'{label}: אין כפילות בין היסטוריה לסמני החתימה', len(row['commits']) == committed == game.get('committedRoundCount', 0))
    for source_name in ['account', 'qaClubStats', 'clubTotals', 'clubShowcase', 'clubRecords']:
        expected = {key: value for key, value in baseline['globalCounters'][source_name]['numbers'].items() if key != 'updatedAt'}
        increments = {}
        if committed:
            if source_name == 'account': expected['stats'] = {**expected['stats'], 'wins': expected['stats']['wins'] + committed, 'cleanSheets': expected['stats']['cleanSheets'] + committed}
            if source_name == 'qaClubStats': increments = {'rounds': committed, 'asRounds': committed, 'csRounds': committed, 'wins': committed, 'cleanSheets': committed}
            if source_name == 'clubTotals': increments = {'rounds': committed, 'countedRounds': committed, 'scorelessRounds': committed}
        for field, delta in increments.items(): expected[field] = expected.get(field, 0) + delta
        actual = {key: value for key, value in snapshot['globalCounters'][source_name]['numbers'].items() if key != 'updatedAt'}
        check(f'{label}: דלתאות המונים מדויקות במקור {source_name}', actual == expected)
if 'penalty-miss' in post:
    item = post['penalty-miss']; shootout = item['live']['shootout']; kick = shootout['kicks'][0]
    check('החמצת פנדל: בעיטה יחידה בעלת זהות של השם הארוך מול קפטן01 הכחול', len(shootout['kicks']) == 1 and bool(kick['id']) and kick['kickerId'] == long_actor and kick['keeperId'] == actor(1) and kick['team'] == 'A' and kick['scored'] is False and kick['outcome'] == 'miss')
    check('החמצת פנדל: הבועט והשוער שייכים לצדדים היריבים הנכונים', long_actor in latest['teams'][red]['playerIds'] and actor(1) in latest['teams'][blue]['playerIds'] and item['rotation']['playing'] == [red, blue])
    check('החמצת פנדל: הלוח אפסי והשעון טרם הופעל', item['live']['scoreA'] == item['live']['scoreB'] == item['live']['timerAccumulatedMs'] == 0 and item['live']['timerRunning'] is False and not item['live'].get('timerEvents') and not item['live'].get('activeIntervals'))
    check('החמצת פנדל: אין זקיפות פנדל או משחק לפני החלטה סופית', not item['row']['history'] and not item['row']['playerStats'] and not item['row']['commits'])
if 'alternative-before-confirm' in post:
    item = post['alternative-before-confirm']
    check('לפני אישור חלופה: אותה בעיטה נשמרת בשלמותה, אין מחיקה מוקדמת', item['live']['shootout'] == post['penalty-miss']['live']['shootout'] and item['rotation']['roundInstanceId'] == post['penalty-miss']['rotation']['roundInstanceId'] and not item['row']['history'])
if 'round-one-committed' in post:
    item = post['round-one-committed']; history = item['row']['history'][0]['fields']; stats = [record['fields'] for record in item['row']['playerStats']]
    check('חתימה ראשונה: זהות המשחק המקורית נשמרה בניצחון אדום ידני אפס־אפס', len(item['row']['history']) == len(item['row']['commits']) == 1 and history['roundId'] == latest['rotation']['roundInstanceId'] and history['teamAIndex'] == red and history['teamBIndex'] == blue and history['winnerSide'] == 'A' and history['scoreA'] == history['scoreB'] == 0)
    check('חתימה ראשונה: אין אירועי שדה או בעיטות הכרעה אחרי הנטישה', not history['goals'] and not history['penalties'] and not item['live'].get('shootout'))
    check('חתימה ראשונה: בדיוק22 שחקנים מההרכבים ששיחקו ללא ממתיני הירוקים', len(stats) == 22 and {stat['userId'] for stat in stats} == set(history['teamA'] + history['teamB']) and set(history['teamA']) == set(latest['teams'][red]['playerIds']) and set(history['teamB']) == set(latest['teams'][blue]['playerIds']))
    for side in ['A', 'B']:
        members = set(history['teamA' if side == 'A' else 'teamB'])
        check(f'חתימה ראשונה: תוצאות והופעה לכל11 בצד {side}', all(stat.get('rounds') == stat.get('teamScoreRounds') == stat.get('cleanSheets') == 1 and stat.get('wins', 0) == int(side == 'A') and stat.get('losses', 0) == int(side == 'B') and not stat.get('ties') and stat.get('actualTeamGoalsFor') == stat.get('actualTeamGoalsAgainst') == 0 for stat in stats if stat['userId'] in members))
    check('חתימה ראשונה: אף שחקן לא קיבל מונה פנדל מהסדרה שננטשה', all(not stat.get(field) for stat in stats for field in ['penTaken', 'penScored', 'penMissed', 'penFaced', 'penSaved', 'penConceded']))
    check('חתימה ראשונה:11 ניצחונות11 הפסדים22 שערים נקיים וללא תרומות', all(sum(stat.get(field, 0) for stat in stats) == expected for field, expected in {'rounds': 22, 'wins': 11, 'losses': 11, 'cleanSheets': 22, 'goals': 0, 'assists': 0}.items()))
    check('חתימה ראשונה: משחק שני חדש באדומים וירוקים ולוח נקי', item['rotation']['round'] == 2 and item['rotation']['roundInstanceId'] != history['roundId'] and item['rotation']['playing'] == [red, green] and item['live']['scoreA'] == item['live']['scoreB'] == item['live']['timerAccumulatedMs'] == 0 and not item['live'].get('goals'))
if 'clock-paused' in post:
    item = post['clock-paused']; intervals = item['live']['activeIntervals']; events = item['live']['timerEvents']
    check('שעון משחק שני: התחלה, השהיה, המשך והשהיה מתועדים בסדר', [event['type'] for event in events] == ['start', 'pause', 'resume', 'pause'])
    check('שעון משחק שני: שני מקטעים חיוביים לא חופפים ותואמים לאירועים', len(intervals) == 2 and intervals == [{'s': events[0]['at'], 'e': events[1]['at']}, {'s': events[2]['at'], 'e': events[3]['at']}] and all(interval['e'] > interval['s'] for interval in intervals) and intervals[0]['e'] <= intervals[1]['s'])
    check('שעון משחק שני:44743 מילישניות תואמות לסכום ושעון מושהה', sum(interval['e'] - interval['s'] for interval in intervals) == item['live']['timerAccumulatedMs'] == 44743 and item['live']['timerRunning'] is False and item['live']['timerLastStartedAt'] is None)
    check('שעון משחק שני: הזהות והתוצאות לא השתנו בזמן פעולות השעון', item['rotation']['roundInstanceId'] == post['round-one-committed']['rotation']['roundInstanceId'] and item['live']['scoreA'] == item['live']['scoreB'] == 0 and not item['live'].get('goals') and all(item['row'][field] == post['round-one-committed']['row'][field] for field in ['history', 'commits', 'playerStats']))

alternative_path = WORKSPACE / 'artifacts/final-deep-audit-2026-10-17/eleven-alternative-fixed-trace.json'
if not alternative_path.exists(): alternative_path = HERE / 'eleven-alternative-fixed-trace.json'
alternative_trace_proof = None
if alternative_path.exists() and 'round-one-committed' in post:
    entries = json.loads(alternative_path.read_text(encoding='utf-8')); attempt = next(entry for entry in entries if entry.get('winner') == 'A'); reads = attempt['reads']
    check('עקבת חלופה: הקריאה הראשונה עדיין מציגה את סדרת ההכרעה הקודמת', reads[0]['shootoutPresent'] is True and reads[0]['kickCount'] == 1 and reads[0]['actual'] != attempt['expected'])
    check('עקבת חלופה: הקריאות המאוחרות תואמות למצב ללא סדרה ועם חתימת המשחק', not reads[-1]['shootoutPresent'] and reads[-1]['actual'] == attempt['expected'] and reads[-1]['lastCommittedRoundId'] == attempt['expected']['roundId'] and not attempt.get('error'))
    alternative_trace_proof = {'file': str(alternative_path), 'sha256': digest(alternative_path), 'directListenerEventCaptured': False}

historical_resolved = []
if 'captain-fixed-saved' in post:
    item = post['captain-fixed-saved']; prior = post['clock-paused']; draft = item['game']['draftTeams']; fixed_teams = {team['index']: team for team in draft['teams']}
    check('תיקון קפטן:01 עבר מהכחולים לאדומים במקום03 שיצא', actor(1) in fixed_teams[red]['playerIds'] and actor(1) not in fixed_teams[blue]['playerIds'] and actor(3) not in fixed_teams[red]['playerIds'] and len(draft['leftHome']) == 1 and draft['leftHome'][0]['playerId'] == actor(3) and draft['leftHome'][0]['homeTeam'] == red)
    check('תיקון קפטן: הכחולים בחרו04 כקפטן שנמצא בהרכב', fixed_teams[blue]['captainId'] == actor(4) and fixed_teams[blue]['captainId'] in fixed_teams[blue]['playerIds'])
    check('תיקון קפטן: קפטן האדומים נשאר החשבון וקפטן כל קבוצה משובץ בה', fixed_teams[red]['captainId'] == uid and all(team['captainId'] in team['playerIds'] for team in fixed_teams.values()))
    flat = [member for team in fixed_teams.values() for member in team['playerIds']]
    check('תיקון קפטן:32 משובצים ייחודיים ואורח03 בחוץ בלבד', len(flat) == len(set(flat)) == 32 and set(flat) == eligible - {actor(3)} and [len(fixed_teams[index]['playerIds']) for index in range(3)] == [11, 10, 11] and not item['rotation']['loans'])
    check('תיקון קפטן: זהות המשחק השני והצדדים ותור ההמתנה לא השתנו', all(item['rotation'][key] == prior['rotation'][key] for key in ['round', 'roundInstanceId', 'roundInstanceRound', 'playing', 'waiting', 'wins']))
    check('תיקון קפטן: כל אירועי השעון והמקטעים והלוח נשמרו', item['live'] == prior['live'] and item['live']['timerAccumulatedMs'] == 44743 and item['live']['timerRunning'] is False)
    check('תיקון קפטן: ההיסטוריה וכל הסטטיסטיקה נשמרו בדיוק', all(item['row'][key] == prior['row'][key] for key in ['history', 'commits', 'playerStats', 'roundSummary', 'finishProof']))
    for old_check in checks:
        if old_check['name'] == 'auto-refill-saved: כל הקפטנים הנוכחיים משובצים בקבוצתם' and not old_check['passed']:
            old_check['resolvedBy'] = 'data-eleven-captain-fixed-saved.json'
            old_check['resolution'] = 'הכשל נשמר כראיית לפני תיקון; העברת קפטן חוזרת בייצור מעדכנת את קפטן קבוצת המקור לשחקן שנשאר בה.'
            historical_resolved.append(old_check)

final_commit = None
finished = None
third_path = HERE / 'data-eleven-round-three-committed.json'
if third_path.exists():
    final_commit = json.loads(third_path.read_text(encoding='utf-8'))
    third_row = next(item for item in final_commit['games'] if item['game']['id'] == gid); third_game = third_row['game']['fields']
    sources.append({'file': third_path.name, 'sha256': digest(third_path), 'readCompletedAt': final_commit['readCompletedAt']})
    histories = sorted(third_row['history'], key=lambda item: item['fields']['at']); third_history = histories[2]['fields']
    check('חתימה שלישית: בדיוק שלוש היסטוריות וחתימות ייחודיות', len(histories) == len(third_row['commits']) == third_game['committedRoundCount'] == 3 and len({entry['id'] for entry in third_row['commits']}) == 3)
    check('חתימה שלישית: שתי ההיסטוריות הקודמות נשמרו כולל כשל12 מול11', histories[:2] == sorted(post['round-two-committed']['row']['history'], key=lambda entry: entry['fields']['at']) and len(histories[1]['fields']['teamA']) == 12 and len(histories[1]['fields']['teamB']) == 11)
    check('חתימה שלישית: המשחק המתוקן11 מול11 נשמר בניצחון אדום2:1', third_history['roundId'] == post['goals-two']['rotation']['roundInstanceId'] and third_history['teamAIndex'] == red and third_history['teamBIndex'] == blue and len(third_history['teamA']) == len(third_history['teamB']) == 11 and third_history['scoreA'] == 2 and third_history['scoreB'] == 1 and third_history['winnerSide'] == 'A')
    goals = third_history['goals']
    check('חתימה שלישית: הכובשים והמבשל וסדר שלושת השערים נכונים', [(goal['team'], goal.get('scorerId'), goal.get('assisterId'), goal.get('assistStatus')) for goal in goals] == [('B', actor(4), None, 'none'), ('A', long_actor, uid, 'player'), ('A', actor(8), None, 'none')] and all(not goal.get('ownGoal') for goal in goals))
    check('חתימה שלישית: אירועי הפנדלים שננטשו אינם בהיסטוריה', all(not entry['fields'].get('penalties') for entry in histories))
    expected_stats = {}
    fields = ['rounds', 'wins', 'losses', 'ties', 'goals', 'assists', 'cleanSheets', 'actualTeamGoalsFor', 'actualTeamGoalsAgainst', 'teamScoreRounds']
    for entry in histories:
        value = entry['fields']
        for side in ['A', 'B']:
            own = value['scoreA' if side == 'A' else 'scoreB']; other = value['scoreB' if side == 'A' else 'scoreA']
            for participant in value['teamA' if side == 'A' else 'teamB']:
                subtotal = expected_stats.setdefault(participant, Counter())
                subtotal.update(rounds=1, wins=int(side == value['winnerSide']), losses=int(value['winnerSide'] not in [side, 'tie']), ties=int(value['winnerSide'] == 'tie'), cleanSheets=int(other == 0), actualTeamGoalsFor=own, actualTeamGoalsAgainst=other, teamScoreRounds=1)
        for goal in value.get('goals') or []:
            if goal.get('scorerId') and not goal.get('ownGoal'):
                expected_stats[goal['scorerId']]['goals'] += 1
                if goal.get('assisterId') and goal['assisterId'] != goal['scorerId']: expected_stats[goal['assisterId']]['assists'] += 1
    final_stats = {entry['fields']['userId']: entry['fields'] for entry in third_row['playerStats']}
    check('חתימה שלישית:33 שורות זכאיות ללא חשבון נוסף או זהות כפולה', set(final_stats) == set(expected_stats) == eligible and len(third_row['playerStats']) == len(final_stats) == 33 and sum(not stat.get('isGuest') for stat in final_stats.values()) == 1 and not final_stats[uid].get('isGuest'))
    for participant, expected in expected_stats.items():
        check(f'חתימה שלישית: כל מוני השחקן {participant} שווים לחישוב משלוש ההיסטוריות', all(final_stats[participant].get(field, 0) == expected[field] for field in fields))
    check('חתימה שלישית: הסכומים הם67 הופעות34 ניצחונות33 הפסדים ושערי זכות וחובה33', all(sum(stat.get(field, 0) for stat in final_stats.values()) == expected for field, expected in {'rounds': 67, 'wins': 34, 'losses': 33, 'ties': 0, 'goals': 3, 'assists': 1, 'cleanSheets': 45, 'actualTeamGoalsFor': 33, 'actualTeamGoalsAgainst': 33, 'teamScoreRounds': 67}.items()))
    check('חתימה שלישית: כל ששת מוני הפנדלים אפס לכל33 השחקנים', all(not stat.get(field) for stat in final_stats.values() for field in ['penTaken', 'penScored', 'penMissed', 'penFaced', 'penSaved', 'penConceded']))
    check('חתימה שלישית: לחשבון שלוש הופעות וניצחונות, בישול יחיד ושני שערים נקיים', all(final_stats[uid].get(field, 0) == expected for field, expected in {'rounds': 3, 'wins': 3, 'assists': 1, 'goals': 0, 'cleanSheets': 2, 'actualTeamGoalsFor': 2, 'actualTeamGoalsAgainst': 1}.items()))
    check('חתימה שלישית: משחק רביעי הוכן ריק ואינו חתימה נוספת', third_game['rotation']['round'] == 4 and third_game['rotation']['roundInstanceId'] not in {entry['id'] for entry in third_row['commits']} and third_game['liveMatch']['scoreA'] == third_game['liveMatch']['scoreB'] == 0 and not third_game['liveMatch']['goals'])

finished_path = HERE / 'data-eleven-finished.json'
if finished_path.exists():
    finished = json.loads(finished_path.read_text(encoding='utf-8'))
    final_row = next(item for item in finished['games'] if item['game']['id'] == gid); final_game = final_row['game']['fields']
    sources.append({'file': finished_path.name, 'sha256': digest(finished_path), 'readCompletedAt': finished['readCompletedAt']})
    summary = final_row['roundSummary']['fields']; proof = final_row['finishProof']; standing = proof['qaEveningStanding']['fields']; stages = {entry['id']: entry['fields'] for entry in proof['stages']}
    check('סיום: המחזור הנכון הסתיים והלוח והשעון סופיים', final_game['createdBy'] == uid and final_game['groupId'] == club and final_game['status'] == 'finished' and final_game['endedBy'] == 'admin' and final_game['liveMatch']['phase'] == 'finished' and final_game['liveMatch']['timerRunning'] is False)
    check('סיום: אין שינוי בהיסטוריה או בזקיפות ואין משחק רביעי ריק', all(final_row[field] == third_row[field] for field in ['history', 'commits', 'playerStats']) and final_game['committedRoundCount'] == 3)
    check('סיום: שלושת ההרכבים מלאים ללא שחקן חסר או כפול', [len(team['playerIds']) for team in final_game['draftTeams']['teams']] == [11, 11, 11] and {player for team in final_game['draftTeams']['teams'] for player in team['playerIds']} == eligible and not final_game['draftTeams'].get('leftHome') and not final_game['rotation']['loans'])
    check('סיום: נוכחות אחת ושלבי דירוג והשלמה קיימים', proof['attendanceCredit']['id'] == 'once' and set(stages) == {'standings', 'complete'} and stages['standings']['hadPointsTable'] is True)
    check('סיום: סדר תאריכי סיום, נוכחות, דירוג, סיכום והשלמה תקין', final_game['endedAt'] <= proof['attendanceCredit']['fields']['at'] <= stages['standings']['at'] <= summary['generatedAt'] <= stages['complete']['at'])
    check('סיום: הסיכום נקשר למחזור ולמועדון ובעל כיסוי מלא', summary['gameId'] == gid and summary['groupId'] == club and summary['at'] == final_game['startsAt'] and summary['version'] == 1 and summary['coverage'] == {'hasAssists': True, 'hasRoundHistory': True})
    check('סיום: שלושה משחקים שלושה שערים בישול אחד ואפס הכרעות ותיקו', summary['stats'] == {'rounds': 3, 'goals': 3, 'assists': 1, 'shootouts': 0, 'ties': 0})
    check('סיום: בסיס התיקון שומר33 זהויות ושלושת המשחקים', len(summary['correctionBasis']['players']) == 33 and {player['userId'] for player in summary['correctionBasis']['players']} == eligible and len(summary['correctionBasis']['rounds']) == 3 and all(not entry['shootout'] for entry in summary['correctionBasis']['rounds']))
    check('סיום: אדומים מובילים בשלושה ניצחונות וכחולים בשני הפסדים', summary['teamHighlights'] == {'best': [{'colourIndex': red, 'wins': 3, 'losses': 0, 'played': 3}], 'worst': [{'colourIndex': blue, 'wins': 0, 'losses': 2, 'played': 2}]})
    check('סיום: שיאי המועדון הם שלושה ניצחונות ושני שערים נקיים', {(entry['type'], entry['metric'], entry['value'], entry['previousValue']) for entry in summary['events']} == {('club_record', 'wins', 3, 2), ('club_record', 'cleanSheets', 2, 1)} and all(entry['userIds'] == [uid] for entry in summary['events']))
    check('סיום: דירוג אישי8.4 ושינוי1.7 ביחס למחזור שבע', standing['userId'] == uid and standing['gameId'] == gid and standing['groupId'] == club and standing['score'] == 8.4 and standing['scoreDelta'] == 1.7 and standing['scoreBasis']['previousScore'] == baseline['globalCounters']['qaClubStats']['numbers']['lastEveningScore'] == 6.7 and standing['scoreBasis']['previousAt'] == baseline['globalCounters']['qaClubStats']['numbers']['lastEveningAt'])
    check('סיום: דירוג יחיד עם יעדי השוואה שער ובישול אחד', standing['rank'] == standing['rankTotal'] == standing['scoreRank'] == standing['scoreTotal'] == 1 and standing['rankDelta'] == 0 and stages['standings']['scoreCalibration'] == {'goalsFor10': 1, 'assistsFor10': 1})
    for source_name in ['account', 'qaClubStats', 'clubTotals', 'clubShowcase', 'clubRecords']:
        expected = {key: value for key, value in baseline['globalCounters'][source_name]['numbers'].items() if key != 'updatedAt'}
        increments = {}
        if source_name == 'account': expected['stats'] = {**expected['stats'], 'wins': expected['stats']['wins'] + 3, 'cleanSheets': expected['stats']['cleanSheets'] + 2, 'assists': expected['stats']['assists'] + 1}
        if source_name == 'qaClubStats':
            increments = {'rounds': 3, 'asRounds': 3, 'csRounds': 3, 'wins': 3, 'cleanSheets': 2, 'assists': 1, 'games': 1, 'eveningScoreCount': 1, 'eveningScoreSum': 8.4}
            expected.update(lastEveningScore=8.4, lastEveningAt=final_game['startsAt'], bestEvening={**expected['bestEvening'], 'wins': 3, 'cleanSheets': 2})
        if source_name == 'clubTotals': increments = {'rounds': 3, 'countedRounds': 3, 'scorelessRounds': 2, 'guestGoals': 3, 'kingAssistsCount': 1, 'kingAssistsSum': 1}
        if source_name == 'clubShowcase': increments = {'totalGamesFinished': 1, 'thisMonthGames': 1}
        if source_name == 'clubRecords':
            increments = {'eveningsSealed': 1}; expected.update(lastEveningAt=final_game['startsAt'], wins={'value': 3}, cleanSheets={'value': 2})
        for field, delta in increments.items(): expected[field] = expected.get(field, 0) + delta
        actual = {key: value for key, value in finished['globalCounters'][source_name]['numbers'].items() if key != 'updatedAt'}
        check(f'סיום: הדלתא העצמאית המלאה של מחזור אחד־עשר נכונה במקור {source_name}', actual == expected)
    check('סיום: מוני הפנדלים האישיים לא השתנו במחזור האחד־עשר', all(finished['globalCounters']['account']['numbers']['stats'].get(field, 0) == baseline['globalCounters']['account']['numbers']['stats'].get(field, 0) for field in ['penTaken', 'penScored', 'penMissed', 'penFaced', 'penSaved', 'penConceded']))
    check('סיום: שלושת הישנים ושני החדשים הקודמים נשארו ללא שינוי', finished['oldRoundComparison']['allUnchanged'] and all(old['digest'] == hashlib.sha256(json.dumps(next(entry for entry in finished['games'] if entry['game']['id'] == old['id']), sort_keys=True, ensure_ascii=False).encode('utf-8')).hexdigest() for old in baseline['priorNewRounds']))
    final_derived = json.loads((HERE / 'eleven-finished-derived.json').read_text(encoding='utf-8'))
    check('סיום: חישובי הקוד נחתמו מול מקור הסיום הנכון', final_derived['sourceSha256'] == digest(finished_path))
    check('סיום: מסמך הסיכום כולו תואם לחישוב הלקוח והשרת', final_derived['fullSealedClientSummaryMatches'] is True and final_derived['fullSealedServerSummaryMatches'] is True)
    check('סיום: שני מחשבוני הציון זהים לציון8.4 השמור', final_derived['clientScore'] == final_derived['serverScore'] == final_derived['storedScore'] == 8.4)
if 'captain-fixed-restored' in post:
    item = post['captain-fixed-restored']; return_teams = {team['index']: team for team in item['game']['draftTeams']['teams']}
    check('החזרה במשחק שני:03 חזר לאדומים ו01 חזר לכחולים', actor(3) in return_teams[red]['playerIds'] and actor(1) not in return_teams[red]['playerIds'] and actor(1) in return_teams[blue]['playerIds'])
    check('החזרה במשחק שני: שלושת הסגלים מלאים באחד־עשר לכל צד', [len(return_teams[index]['playerIds']) for index in range(3)] == [11, 11, 11])
    check('החזרה במשחק שני: אין כפילות או שחקן שנעלם למרות חלוקה בלתי מאוזנת', len({member for team in return_teams.values() for member in team['playerIds']}) == 33 and {member for team in return_teams.values() for member in team['playerIds']} == eligible)
    check('החזרה במשחק שני: הלוח, השעון וההיסטוריה נשמרו', item['live'] == post['captain-fixed-saved']['live'] and all(item['row'][key] == post['captain-fixed-saved']['row'][key] for key in ['history', 'commits', 'playerStats', 'roundSummary', 'finishProof']))
    check('מקור כשל ההחזרה: baseTeams חסר כבר לאחר החתימה הראשונה', not post['round-one-committed']['rotation'].get('baseTeams') and not post['captain-fixed-saved']['rotation'].get('baseTeams') and not item['rotation'].get('baseTeams'))
if 'round-two-committed' in post:
    item = post['round-two-committed']; histories = sorted(item['row']['history'], key=lambda entry: entry['fields']['at']); history = histories[1]['fields']
    stats = {entry['fields']['userId']: entry['fields'] for entry in item['row']['playerStats']}
    check('חתימה שנייה: שתי היסטוריות וחתימות ואין שינוי בהיסטוריה הראשונה', len(histories) == len(item['row']['commits']) == 2 and histories[0] == post['round-one-committed']['row']['history'][0])
    check('חתימה שנייה: הכשל של12 אדומים מול11 ירוקים נרשם כפי שהיה', len(history['teamA']) == 12 and len(history['teamB']) == 11 and history['teamAIndex'] == red and history['teamBIndex'] == green and {actor(1), actor(3)} <= set(history['teamA']) and history['roundId'] == post['captain-fixed-restored']['rotation']['roundInstanceId'])
    check('חתימה שנייה: ניצחון אדום ידני באפס־אפס ללא פנדלים או גולים', history['scoreA'] == history['scoreB'] == 0 and history['winnerSide'] == 'A' and not history['goals'] and not history['penalties'])
    expected = {}
    for entry in histories:
        value = entry['fields']
        for side in ['A', 'B']:
            for participant in value['teamA' if side == 'A' else 'teamB']:
                subtotal = expected.setdefault(participant, Counter())
                subtotal.update(rounds=1, wins=int(side == value['winnerSide']), losses=int(side != value['winnerSide']), cleanSheets=1, teamScoreRounds=1)
    check('חתימה שנייה:33 משתתפים ייחודיים ללא השמטת שחקן מהכשל', set(stats) == set(expected) == eligible and len(stats) == 33)
    for participant, subtotal in expected.items():
        check(f'חתימה שנייה: כל זקיפות השחקן {participant} תואמות להרכב שנשמר', all(stats[participant].get(field, 0) == subtotal[field] for field in ['rounds', 'wins', 'losses', 'cleanSheets', 'teamScoreRounds']) and all(not stats[participant].get(field) for field in ['goals', 'assists', 'ties', 'actualTeamGoalsFor', 'actualTeamGoalsAgainst', 'penTaken', 'penScored', 'penMissed', 'penFaced', 'penSaved', 'penConceded']))
    check('חתימה שנייה:45 הופעות כוללות23 מהמשחק השני הפגום', sum(stat.get('rounds', 0) for stat in stats.values()) == 45 and len(history['teamA'] + history['teamB']) == 23 and sum(stat.get('wins', 0) for stat in stats.values()) == 23 and sum(stat.get('losses', 0) for stat in stats.values()) == 22)
    check('חתימה שנייה: ממתין משחק שלישי חדש באדומים וכחולים בהרכבים12/11/10', item['rotation']['round'] == 3 and item['rotation']['playing'] == [red, blue] and item['rotation']['roundInstanceId'] != history['roundId'] and [len(team['playerIds']) for team in item['game']['draftTeams']['teams']] == [12, 11, 10])
    check('חתימה שנייה:06 הועבר בקביעות מהירוקים לכחולים ללא השאלה', actor(6) in item['game']['draftTeams']['teams'][blue]['playerIds'] and actor(6) not in item['game']['draftTeams']['teams'][green]['playerIds'] and not item['rotation']['loans'])
    check('חתימה שנייה: לוח חדש אפסי ומקטעי השעון הקודמים נשמרו פעם אחת', item['live']['scoreA'] == item['live']['scoreB'] == item['live']['timerAccumulatedMs'] == 0 and not item['live'].get('goals') and not item['live'].get('shootout') and item['live'].get('activeIntervals') == post['clock-paused']['live']['activeIntervals'])
for label in ['repair-01-green', 'repair-original-rosters', 'network-offline', 'network-reconnected', 'goals-two']:
    if label not in post: continue
    item = post[label]; current = {team['index']: team for team in item['game']['draftTeams']['teams']}
    flat = [member for team in current.values() for member in team['playerIds']]
    check(f'{label}: שלוש קבוצות מלאות וכל33 הזהויות קיימות פעם אחת', all(len(team['playerIds']) == 11 for team in current.values()) and len(flat) == len(set(flat)) == 33 and set(flat) == eligible)
    check(f'{label}: אין יוצאים או השאלות וקפטן כל קבוצה משובץ בה', not item['game']['draftTeams'].get('leftHome') and not item['rotation']['loans'] and all(team['captainId'] in team['playerIds'] for team in current.values()))
    check(f'{label}: התיקון והאירועים לא שכתבו את שתי ההיסטוריות ו45 ההופעות', all(item['row'][key] == post['round-two-committed']['row'][key] for key in ['history', 'commits', 'playerStats', 'roundSummary', 'finishProof']))
    check(f'{label}: אותו משחק שלישי ושעון אפסי ללא איבוד מקטעי העבר', all(item['rotation'][key] == post['round-two-committed']['rotation'][key] for key in ['round', 'roundInstanceId', 'roundInstanceRound', 'playing', 'waiting', 'wins']) and item['live']['timerAccumulatedMs'] == 0 and item['live']['timerRunning'] is False and not item['live']['timerEvents'] and item['live']['activeIntervals'] == post['clock-paused']['live']['activeIntervals'])
if 'repair-01-green' in post:
    item = post['repair-01-green']; repaired = {team['index']: team for team in item['game']['draftTeams']['teams']}
    check('תיקון שיוך ראשון:01 הועבר מאדומים לירוקים,06 עדיין בכחולים', actor(1) not in repaired[red]['playerIds'] and actor(1) in repaired[green]['playerIds'] and actor(6) in repaired[blue]['playerIds'] and actor(6) not in repaired[green]['playerIds'])
if 'repair-original-rosters' in post:
    item = post['repair-original-rosters']; repaired = {team['index']: team for team in item['game']['draftTeams']['teams']}
    check('תיקון שיוך שני:01 ו06 הוחלפו וכל חברות הקבוצות תואמת לחלוקה המקורית', actor(1) in repaired[blue]['playerIds'] and actor(6) in repaired[green]['playerIds'] and all(set(repaired[index]['playerIds']) == set(captains['teams'][index]['playerIds']) for index in range(3)))
    check('תיקון שיוך שני: לא נטען שהבסיס ההיסטורי החסר שוחזר', not item['rotation'].get('baseTeams'))
    for old_check in checks:
        if old_check['name'] in ['החזרה במשחק שני:03 חזר לאדומים ו01 חזר לכחולים', 'החזרה במשחק שני: שלושת הסגלים מלאים באחד־עשר לכל צד'] and not old_check['passed']:
            old_check['dataRepairedBy'] = 'data-eleven-repair-original-rosters.json'
            old_check['repairLimit'] = 'The roster was repaired through supported UI moves. This is not a successful repeat of the fixed restore behaviour; code/native validation remains separate.'
if 'network-offline' in post:
    item = post['network-offline']
    check('ניתוק: המסד לא קיבל גול או שינוי תוצאה', not item['live']['goals'] and item['live']['scoreA'] == item['live']['scoreB'] == 0 and item['live'] == post['repair-original-rosters']['live'])
if 'network-reconnected' in post:
    item = post['network-reconnected']; goals = item['live']['goals']
    check('חיבור מחדש: בדיוק אירוע כחול04 אחד עם מזהה יציב וללא בישול', len(goals) == 1 and bool(goals[0]['id']) and goals[0]['scorerId'] == actor(4) and goals[0]['team'] == 'B' and goals[0].get('assistStatus') == 'none' and not goals[0].get('assisterId') and not goals[0].get('ownGoal') and item['live']['scoreA'] == 0 and item['live']['scoreB'] == 1)
    check('חיבור מחדש: תג הכובש תואם לאירוע היחיד', item['live'].get('goalTally') == {actor(4): 1})
if 'goals-two' in post:
    item = post['goals-two']; goals = item['live']['goals']
    check('שני שערים: האירוע הכחול נשמר בשלמותו ולא הוכפל', len(goals) == 2 and len({goal['id'] for goal in goals}) == 2 and goals[0] == post['network-reconnected']['live']['goals'][0])
    check('שני שערים: השם הארוך כבש לאדומים מבישול החשבון', goals[1]['scorerId'] == long_actor and goals[1].get('assisterId') == uid and goals[1].get('assistStatus') == 'player' and goals[1]['team'] == 'A' and not goals[1].get('ownGoal'))
    check('שני שערים: לוח1:1 ותגים לשני כובשים בלבד', item['live']['scoreA'] == item['live']['scoreB'] == 1 and item['live'].get('goalTally') == {actor(4): 1, long_actor: 1})
if 'legacy-restored-after-space' in post:
    before_guard = post['legacy-before-restore']; denied = post['legacy-denied-confirmed']; freed = post['legacy-space-freed']; safe_restore = post['legacy-restored-after-space']
    guard_teams = lambda item: {team['index']: team for team in item['game']['draftTeams']['teams']}
    check('חסימת נתון ישן:11 משלים באדומים,03 בחוץ ואין תמונת בסיס', actor(11) in guard_teams(before_guard)[red]['playerIds'] and actor(11) not in guard_teams(before_guard)[green]['playerIds'] and before_guard['game']['draftTeams']['leftHome'][0]['playerId'] == actor(3) and not before_guard['rotation'].get('baseTeams'))
    check('חסימת נתון ישן: כל שדות המחזור וההיסטוריה והזקיפות שהוחזרו נשארו זהים אחרי דחייה', before_guard['row'] == denied['row'])
    check('חסימת נתון ישן: גם כל מוני המשתמש והמועדון נשארו זהים', before_guard['snapshot']['globalCounters'] == denied['snapshot']['globalCounters'])
    check('חסימת נתון ישן: חותמת updatedAt לא השתנתה', before_guard['game']['updatedAt'] == denied['game']['updatedAt'])
    check('פינוי מקום:11 הוחזר מהאדומים לירוקים ו03 עדיין בחוץ', actor(11) not in guard_teams(freed)[red]['playerIds'] and actor(11) in guard_teams(freed)[green]['playerIds'] and [len(guard_teams(freed)[index]['playerIds']) for index in range(3)] == [10, 11, 11] and freed['game']['draftTeams']['leftHome'] == before_guard['game']['draftTeams']['leftHome'])
    check('החזרה בטוחה:03 חזר לאדומים לאחר פינוי מקום', actor(3) in guard_teams(safe_restore)[red]['playerIds'] and guard_teams(safe_restore)[red]['playerIds'] == guard_teams(freed)[red]['playerIds'] + [actor(3)])
    flat = [member for team in guard_teams(safe_restore).values() for member in team['playerIds']]
    check('החזרה בטוחה: שלושה הרכבים מלאים33 ייחודיים וללא יוצאים או השאלות', [len(guard_teams(safe_restore)[index]['playerIds']) for index in range(3)] == [11, 11, 11] and len(flat) == len(set(flat)) == 33 and set(flat) == eligible and not safe_restore['game']['draftTeams'].get('leftHome') and not safe_restore['rotation']['loans'])
    check('החזרה בטוחה: כל חברות הקבוצות שוב תואמת לחלוקת הקפטנים', all(set(guard_teams(safe_restore)[index]['playerIds']) == set(captains['teams'][index]['playerIds']) for index in range(3)))
    for label in ['legacy-before-restore', 'legacy-denied-confirmed', 'legacy-space-freed', 'legacy-restored-after-space']:
        item = post[label]
        check(f'{label}: אותו משחק שלישי וכל אירועי הגול והשעון נשמרו בדיוק', item['rotation']['roundInstanceId'] == post['goals-two']['rotation']['roundInstanceId'] and item['rotation']['playing'] == post['goals-two']['rotation']['playing'] and item['live'] == post['goals-two']['live'])
        check(f'{label}: שתי ההיסטוריות45ההופעות וכל הסטטיסטיקה לא שוכתבו', all(item['row'][key] == post['goals-two']['row'][key] for key in ['history', 'commits', 'playerStats', 'roundSummary', 'finishProof']))
    check('החזרה בטוחה: לא יוחס לשרת שחזור בסיס חסר שלא התרחש', all(not post[label]['rotation'].get('baseTeams') for label in ['legacy-before-restore', 'legacy-denied-confirmed', 'legacy-space-freed', 'legacy-restored-after-space']))
    for old_check in checks:
        if old_check['name'] in ['החזרה במשחק שני:03 חזר לאדומים ו01 חזר לכחולים', 'החזרה במשחק שני: שלושת הסגלים מלאים באחד־עשר לכל צד'] and not old_check['passed']:
            old_check['resolvedBy'] = 'data-eleven-legacy-denied-confirmed.json + data-eleven-legacy-restored-after-space.json'
            old_check['resolution'] = 'הכשל ההיסטורי נשמר. התנהגות הנתון הישן תוקנה לדחייה ללא שינוי כשהקבוצה מלאה ואין בסיס, ולהחזרה בטוחה לאחר פינוי מקום בממשק. לא נטען שהמשלים הוחזר אוטומטית בלי בסיס.'
            historical_resolved.append(old_check)

result = {'phase': 'חלוקת קפטנים, השלמה קבועה והחזרה לפני חתימת משחק ראשון', 'gameId': gid,
          'sources': sources, 'passed': sum(item['passed'] for item in checks), 'failed': sum(not item['passed'] and not item.get('resolvedBy') for item in checks), 'historicalResolvedFailures': len(historical_resolved), 'checks': checks,
          'actors': {'departedAndRestored': actor(3), 'permanentFillerAndReturned': actor(2), 'longName': long_actor},
          'latestRoster': {str(index): team['playerIds'] for index, team in latest['teams'].items()},
          'roundId': latest['rotation']['roundInstanceId'],
          'limits': ['מקורות השרת מוכיחים את התוצאה הסופית של 30 בחירות הנחש; ביטול ובחירה מחדש של הבחירה האחרונה דורשים את תצפית הממשק של המוביל ואינם נשמרים כאירועים נפרדים.',
                     'הצעת ההשלמה האוטומטית הראשונה לא אומתה במקורות אלה. ההשלמה הנצפית נבחרה דרך מסך החילוף, והנתונים מוכיחים מעבר קבוע שהושלם.',
                     'baseTeams ו־originalTeams הם תמונות בסיס להחזרה; במהלך המעבר הקבוע אין דרישה שיהיו זהים לסגלים הנוכחיים. אחרי ההחזרה אותן זהויות חזרו לאותן קבוצות, עם סדר רשימה וקפטן ירוק שיכולים להשתנות.',
                     'טרם נשמר משחק, שער או הכרעה בהיקף מקורות זה. אין כאן מסקנת סיום מחזור או סטטיסטיקה.']}
if 'auto-refill-restored' in timeline:
    result['phase'] = 'השלמה קבועה דרך הצעה אוטומטית נשמרה והוחזרה; פער קפטן נצפה בשלב הביניים'
    result['observedFindings'] = [{'source': 'data-eleven-auto-refill-saved.json', 'field': 'draftTeams.teams[index=2].captainId',
                                   'actor': actor(5), 'finding': 'הקפטן הירוק עדיין05 בזמן שהוא עבר לאדומים. אחרי החזרתו לירוקים שוב יש קפטן משובץ. לא בוצע תיקון מוצר במסגרת האודיט.'}]
    result['limits'][1] = 'ההצעה האוטומטית הראשונה לא אומתה; לאחר תיקון ההמתנה נצפתה הצעה אוטומטית בממשק המוביל, נשמר המשלים05, והמקורות המאוחרים מוכיחים את ההשלמה וההחזרה. אירוע המאזין עצמו לא נלכד בעקבה.'
if post:
    result['phase'] = 'משחק ראשון נחתם אחרי נטישת פנדלים; משחק שני מושהה לאחר שני מקטעי שעון'
    last_post = list(post.values())[-1]
    result['latestRoster'] = {str(team['index']): team['playerIds'] for team in last_post['game']['draftTeams']['teams']}
    result['roundId'] = last_post['rotation']['roundInstanceId']
    result['alternativeTrace'] = alternative_trace_proof
    result['latestGamePhase'] = {'round': last_post['rotation']['round'], 'roundId': last_post['rotation']['roundInstanceId'], 'historyCount': len(last_post['row']['history']), 'statCount': len(last_post['row']['playerStats']), 'elapsedMs': last_post['live'].get('timerAccumulatedMs', 0)}
    result['observedFindings'][0]['status'] = 'המוביל מסר שתוקן בקוד; אימות חוזר בייצור במשחק השני ממתין. המקור הישן ממשיך לתעד את הפגם לפני התיקון.'
    result['limits'][-1] = 'נחתם משחק אחד. טרם נמסרו שערי המשחק השני או סיום מחזור. אין לטעון סיכום מחזור או נוכחות סופיים.'
if 'captain-fixed-saved' in post:
    result['observedFindings'][0]['status'] = 'תוקן בקוד ואומת בהעברת קפטן נוספת בייצור במשחק השני:01 עבר לאדומים,04 נבחר בכחולים ונשאר בהם.'
if 'captain-fixed-restored' in post:
    result['phase'] = 'החזרת03 במשחק השני השאירה01 באדומים:12/10/11; זקיפות המשחק הראשון נשמרו'
    result['observedFindings'].append({'source': 'data-eleven-captain-fixed-restored.json', 'status': 'פתוח; המוביל עודכן',
                                       'finding': 'הנתונים מראים03 וגם01 באדומים12, כחולים10 וירוקים11. רשימת היוצאים התרוקנה אבל01 לא חזר לכחולים. אין אובדן זהות; יש שיוך לא מאוזן.',
                                       'codePath': 'restorePlayer checks rotation.baseTeams before reversing a permanent fill. This field is absent from round2 after prepareRoundResult normal winner skeleton replaced the rotation.'})
    result['limits'].append('אין לתאר את ההחזרה במשחק השני כשלושה הרכבים מלאים: מקור השרת עצמו מציג12/10/11. זהו ממצא נתונים, לא חשד לתצוגה ישנה.')
if 'round-two-committed' in post:
    result['phase'] = 'שני משחקים נחתמו, השני שימר את כשל12 מול11; המשחק השלישי ממתין לתיקון השיוך'
    result['limits'] = [item for item in result['limits'] if not item.startswith('נחתם משחק אחד')]
    result['limits'].append('המשחק השני כולל23 הופעות בגלל ההרכב הפגום. היסטוריה זו לא נמחקת ולא מתוארת כמשחק11 מול11 תקין. תוכנן משחק שלישי; טרם נמסרו שעריו או סיום המחזור.')
if 'goals-two' in post:
    result['phase'] = 'סגלי המשחק השלישי תוקנו בממשק ונשמרו שני גולים אחרי ניסיון חוזר ברשת; המחזור טרם הסתיים'
    result['observedFindings'][1]['status'] = 'נתוני הסגל תוקנו דרך מהלכי מוצר; כשל ההחזרה המקורי נשאר מתועד. תיקון התנהגות השמירה דורש אימות נפרד.'
    result['networkGoalIds'] = [goal['id'] for goal in post['goals-two']['live']['goals']]
    result['limits'] = [item for item in result['limits'] if not item.startswith('המשחק השני כולל23')]
    result['limits'] += ['המשחק השני כולל23 הופעות בגלל הכשל; ההיסטוריה נשמרה. סגלי המשחק השלישי תוקנו לשלושה הרכבים מלאים דרך הממשק, ולא באמצעות שינוי ישיר במסמכים.',
                         'מצב טיסה, הודעת הכשל, שמירת בחירות המשתמש והלחיצה הנוספת נצפו בידי המוביל. המקורות מוכיחים אפס אירועים בניתוק ואירוע יחיד אחר כך, ואינם מוכיחים לבדם את מצב הרשת או את מסך הכשל.',
                         'שני השערים עדיין בלוח חי לפני חתימה; אין לייחס להם זקיפה בסטטיסטיקה או סיכום מחזור שטרם נוצרו.']
if 'legacy-restored-after-space' in post:
    result['phase'] = 'החסימה על נתון ישן והחזרה לאחר פינוי מקום אומתו; משחק שלישי1:1 לפני חתימה'
    result['observedFindings'][1]['status'] = 'הכשל המקורי תועד; בדיקה חוזרת של הלקוח המתוקן דחתה ללא שינוי החזרה לקבוצה מלאה בלי בסיס, והחזרה לאחר פינוי מקום הצליחה בייצור.'
    result['legacyGuard'] = {'beforeAfterReturnedDocumentsEqual': True, 'businessUpdatedAtEqual': True, 'firestoreUpdateTimeCaptured': False,
                             'baseTeamsAutomaticallyRecovered': False, 'restoreAfterManualSpaceSucceeded': True}
    result['limits'] += ['reader שומר את שדות המסמך הנבחרים כולל updatedAt, אך אינו שומר את Firestore updateTime. לכן זהות מלאה של הפלט וחוסר שינוי updatedAt הוכחו; זהות של updateTime אינה מוכחת.',
                         'RESTORE_REQUIRES_SPACE והודעת הממשק נצפו בידי המוביל. המקורות מוכיחים דחייה ללא שינוי ואת ההחזרה המאוחרת; הם אינם תיעוד עצמאי של טקסט השגיאה.',
                         'שמירת baseTeams במעברי משחקים עתידיים תוקנה ונבדקה בקוד לפי המוביל. המחזור הישן כבר איבד את השדה, ולכן אין כאן הוכחת ייצור לשימור בסיס קיים במעבר חדש או לשחזור אוטומטי שלו.']
if finished:
    result['phase'] = 'מחזור אחד־עשר הסתיים ונחתם בשלושה משחקים; כשל ההרכב ההיסטורי נשמר עם ראיות תיקון'
    result['finishedDerived'] = final_derived
    result['latestRoster'] = {str(team['index']): team['playerIds'] for team in final_game['draftTeams']['teams']}
    result['roundId'] = final_game['rotation']['roundInstanceId']
    result['latestGamePhase'] = {'round': 4, 'roundId': final_game['rotation']['roundInstanceId'], 'historyCount': 3, 'statCount': 33, 'elapsedMs': 0, 'status': 'finished'}
    result['finalTotals'] = {'history': 3, 'playerStats': 33, 'appearances': 67, 'wins': 34, 'losses': 33, 'cleanSheets': 45, 'goals': 3, 'assists': 1, 'teamGoalsFor': 33, 'teamGoalsAgainst': 33}
    result['limits'] = [item for item in result['limits'] if not item.startswith('המשחק השני כולל23') and not item.startswith('שני השערים עדיין') and not item.startswith('נחתם משחק אחד')]
    result['limits'] += ['המשחק השני נשמר עם12 מול11 ו23 הופעות. זקיפותיו תואמות לנתונים שנשמרו, אך אין לתארו כהרצה תקינה של11 מול11. תיקון ההרכבים נעשה לקראת המשחק השלישי וההיסטוריה לא שוכתבה.',
                         'היסטוריית המשחקים אינה שומרת מזהי אירועי הגול. מזהי שני הגולים בזמן חידוש החיבור הושוו במקורות הלייב; ההיסטוריה מאמתת את זהויות המשתתפים וסוגי שלושת הגולים, ללא הוכחת מזהי הגולים עצמם.',
                         'הסיכום החתום והציון חושבו מחדש בקוד הלקוח והשרת מול מקור הייצור, לרבות נתוני המשחק הפגום. התאמה חשבונית זו אינה מוחקת את הכשל ההיסטורי או מוכיחה את כל מסכי הממשק.']
(HERE / 'audit-eleven-data.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
lines = ['# אימות מחזור אחד־עשר מול אחד־עשר', '', result['phase'], '', f"עברו {result['passed']} אימותים; כשלים פתוחים: {result['failed']}; כשלים היסטוריים שתוקנו ונבדקו שוב: {result['historicalResolvedFailures']}.", '',
         'נשמרו שלושה קפטנים ושלושים בחירות נחש, עם 33 זהויות ייחודיות ושלושה הרכבים מלאים. החשבון ואורחים 01 ו־02 הם הקפטנים המקוריים; השם הארוך נשמר באדומים.', '',
         'אורח03 יצא מהאדומים לפני תחילת השעון. אורח02 מהירוקים השלים את מקומו במעבר קבוע ללא השאלה. לאחר אישור החזרה אורח03 חזר לאדומים ואורח02 חזר לירוקים; שוב שלושה הרכבים מלאים, רשימות היוצאים וההשאלות ריקות. אותו משחק ראשון, אותם צדדים, ולוח אפסי שלא השתנה. אין חתימות או זקיפות, ושני המחזורים החדשים הקודמים ושלושת הישנים נשארו ללא שינוי.', '', '## מקורות', '']
lines += [f"- `{item['file']}` · `{item['sha256']}` · `{item['readCompletedAt']}`" for item in sources]
if 'auto-refill-restored' in timeline:
    lines += ['', '## ההצעה האוטומטית שנשמרה', '',
              'אחרי חזרה על יציאת03 נבחר05 בהצעה האוטומטית.05 עבר בקביעות לאדומים ללא השאלה; אחרי אישור החזרת03, הוא חזר לירוקים ו03 לאדומים. שוב שלושה הרכבים של אחד־עשר, 33 זהויות ייחודיות, ללא יוצאים או השאלות, ואותו משחק ושעון אפסי. המונים והמקורות של המחזורים הקודמים לא השתנו.', '',
              'ממצא ביניים: בזמן ש05 עבר לאדומים, captainId של הירוקים נשאר05 למרות שלא היה ברשימת שחקניהם. אחרי חזרתו הסתירה נעלמה. הבדיקה מסמנת את הכשל הזה במפורש; אין לטעון שהמטא־נתונים היו עקביים בכל שלב. המוביל עודכן, ולא נערך כאן קוד מוצר.']
if post:
    lines += ['', '## חתימה ראשונה והשעון במשחק השני', '',
              'נשמרה החמצה יחידה של השחקן בעל השם הארוך מול שוער01 הכחול, כשהשעון אפס. במקור שלפני אישור החלופה הבעיטה עדיין קיימת במלואה. לאחר אישור ניצחון אדום ידני נשמר משחק אפס־אפס עם מנצחים אדומים, ללא בעיטות בהיסטוריה וללא מוני פנדלים לאף שחקן.', '',
              '22 משתתפים בלבד קיבלו הופעה:11 ניצחונות,11 הפסדים ו22 שערים נקיים, ללא שערים ובישולים. המשחק השני הוכן באדומים וירוקים. פעולות התחלה, השהיה, המשך והשהיה יצרו שני מקטעים לא חופפים, שסכומם המדויק44,743 מילישניות. ההיסטוריה והזקיפות לא השתנו עקב השעון.', '',
              'נוכחות וסיכום מחזור טרם נוצרו. בנקודת הביניים של מקור השעון פער הקפטן כבר דווח כתיקון קוד, והאימות החוזר במכשיר עדיין המתין; המקור המאוחר, אם התקבל, מתואר בנפרד בהמשך. העקבה מציגה קריאה ישנה עם הבעיטה ואחריה קריאות עדכניות ללא סדרה עם מזהה חתימת המשחק, אך אינה לוכדת ישירות את אירועי המאזינים.']
if 'captain-fixed-saved' in post:
    lines += ['', '## אימות חוזר לאחר תיקון הקפטן', '',
              'במשחק השני יצא03 שוב, והפעם קפטן הכחולים01 עבר לאדומים דרך ההשלמה הקבועה. הכחולים עדכנו את הקפטן ל04 שנשאר אצלם. קפטן האדומים נשאר החשבון; כל קפטן רשום בהרכב קבוצתו. יש32 משובצים ייחודיים ו03 בחוץ, ללא השאלות. אותו משחק שני ושעון מושהה44,743 מילישניות, ללא שינוי בהיסטוריה, זקיפות או מונים.', '',
              'כשל05 בשלב שלפני התיקון נשמר ברשימת האימותים עם הפניה למקור התיקון; הוא אינו נמחק ואינו נספר ככשל פתוח. ההחזרה שאחרי ההעברה החדשה עדיין מחכה למקור נפרד.']
if 'captain-fixed-restored' in post:
    lines += ['', '## כשל החזרה שנמצא במשחק השני', '',
              'המקור המאוחר מוכיח כשל בשמירה:03 חזר לאדומים אך01 נשאר איתו, ולכן ההרכבים12/10/11. כל33 הזהויות עדיין קיימות, ורשימות היוצאים וההשאלות ריקות. זהות המשחק, הלוח, השעון44,743 מילישניות, ההיסטוריה והמונים נשמרו. אין לייחס את החוסר בכחולים רק לתצוגה ישנה.', '',
              'rotation.baseTeams חסר כבר במקור שאחרי החתימה הראשונה. restorePlayer מבטל השלמה קבועה רק כשיש סגל בסיס, ולכן במקרה זה הוסיף את03 בלי להחזיר את01. המסלול הרגיל של prepareRoundResult מחזיר skeleton חדש ללא העתקת baseTeams, בעוד מסלול balanced והמסלולים הישנים שומרים אותו. המוביל עודכן; לא בוצעה כאן עריכת מוצר או תיקון נתוני ייצור.']
if 'round-two-committed' in post:
    lines += ['', '## ההיסטוריה הפגומה נשמרה ותועדה', '',
              'המשחק השני הסתיים בניצחון אדום ידני באפס־אפס. ההיסטוריה מתעדת12 אדומים ו11 ירוקים:23 הופעות, ולא22. שתי ההיסטוריות וחתימותיהן נשמרו;33 שורות שחקנים מחזיקות45 הופעות בסך הכול,23 ניצחונות ו22 הפסדים. כל מוני השחקנים חושבו מחדש מול שתי ההיסטוריות ונמצאו תואמים לתוצאה שנשמרה, לרבות משתתפי ההרכב הפגום. אין בכך אישור לתקינות ההרכב.', '',
              'אחרי המשחק השני הוכן משחק שלישי באדומים וכחולים.06 עבר בקביעות מהירוקים לכחולים כדי למלא את החוסר, ולכן בשלב זה ההרכבים12/11/10. המנהל מתקן את השיוך דרך המוצר; אין עדיין מקור המוכיח תיקון. השעון החדש אפסי ושני המקטעים הקודמים נשמרו פעם אחת. אין עדיין סיכום מחזור או נוכחות.']
if 'goals-two' in post:
    lines += ['', '## תיקון סגלים דרך הממשק וניסיון חוזר ברשת', '',
              '01 הועבר מאדומים למקום הפנוי בירוקים, ולאחר מכן הוחלף עם06 שבכחולים. כעת שלושה הרכבים מלאים של אחד־עשר וכל33 הזהויות ייחודיות; חברות כל קבוצה תואמת לחלוקת הקפטנים המקורית, בסדר רשימות שונה. שתי ההיסטוריות וכל45 ההופעות נשמרו כפי שהיו, לרבות המשחק השני הפגום. זהות המשחק השלישי, הלוח והשעון לא אופסו עקב תיקון השיוך.', '',
              'במקור הניתוק אין גול והתוצאה אפס־אפס. אחרי חיבור מחדש וניסיון חוזר יש בדיוק אירוע אחד:04 הכחול כבש ללא בישול. האירוע נשאר עם אותו מזהה כשהתווסף שער השחקן בעל השם הארוך באדומים מבישול החשבון, והתוצאה1:1. לא נוצר כפל אירוע ולא הוקדמו זקיפות לסטטיסטיקה. פעולת מצב טיסה והבחירות שנשמרו בהודעת השגיאה הן ראיות הממשק של המוביל, ולא מסקנה מצילום מסד יחיד.', '',
              'חסרוןbaseTeams ההיסטורי עדיין קיים. תיקון השיוך דרך המוצר אינו הוכחה לכך שקוד ההחזרה תוקן; בדיקת החסימה החדשה והתנהגות השמירה יתווספו רק לאחר מקור מתאים.']
if 'legacy-restored-after-space' in post:
    lines += ['', '## דחייה בטוחה והחזרה מוצלחת אחרי תיקון', '',
              'לאחר יציאת03 עבר11 מהירוקים לאדומים בהשלמה קבועה. בקשת החזרה לקבוצה מלאה בלי סגל בסיס נדחתה. כל נתוני המחזור שנקראו, ההיסטוריות, שורות השחקנים, מוני המשתמש והמועדון וחותמת updatedAt נותרו זהים לחלוטין בין המקורות לפני ואחרי הדחייה. Firestore updateTime אינו כלול בפלט הקריאה ולכן לא אומת ישירות.', '',
              '11 הוחזר לירוקים דרך הממשק, ורק אז החזרת03 הצליחה. שלושת ההרכבים שוב מלאים וכל33 הזהויות ייחודיות; חברות הקבוצות תואמת לחלוקת הקפטנים המקורית, ללא יוצאים או השאלות. שתי רשומות הגול עם אותם מזהים, התוצאה1:1, השעון האפסי, מקטעי הזמן הקודמים וכל45 ההופעות נשמרו.', '',
              'שני כשלי ההחזרה הישנים נשארו ברשימת האימותים ככשל לפני תיקון עם הוכחת הדחייה וההחזרה הבטוחה אחריו. אין טענה שהמשלים הוחזר אוטומטית בלי בסיס או שהבסיס האבוד הושלם. תיקון שמירת הבסיס לעתיד אומת בקוד לפי המוביל, והוא נפרד מהבדיקה המקורית הזאת.']
if finished:
    lines += ['', '## סיום המחזור והסיכום החתום', '',
              'שלוש היסטוריות וחתימות נשמרו. השלישי נערך בהרכבים מתוקנים11 מול11 והסתיים2:1 לאדומים:04 כבש לכחולים ללא בישול, השחקן בעל השם הארוך כבש לאדומים מבישול החשבון, ו08 כבש לאדומים ללא בישול. המשחק הרביעי הריק שהוכן לא נזקף בסיום.', '',
              'כל מוני33 השחקנים חושבו מחדש משלוש ההיסטוריות:67 הופעות,34 ניצחונות,33 הפסדים,45 שערים נקיים,3 שערים אישיים ובישול אחד, ו33 שערי זכות וחובה מצטברים כל אחד. כל מוני הפנדלים אפס במחזור. המשחק השני הפגום עדיין כולל23 הופעות; הוא לא נמחק ולא הוצג כ11 מול11 תקין.', '',
              'הסיכום החתום כולו תואם למימושי הלקוח והשרת:3 משחקים,3 שערים,בישול אחד,אפס הכרעות ואפס תיקו. נוכחות אחת ושלבי דירוג והשלמה נכתבו. ההיסטוריות, החתימות וכל שורות השחקנים זהות למקור שלפני סיום המחזור.', '',
              'החשבון שיחק3 משחקים וניצח בכולם, בישל פעם אחת ולא כבש, ושמר על שער נקי פעמיים. ציון8.4 ושינוי1.7 מול מחזור שבע חושבו בשני המימושים ונמצאו תואמים לדירוג שנשמר. ביחס לבסיס העצמאי של11: games5→6, rounds9→12, wins6→9, cleanSheets4→6, assists1→2, וסכום ציונים41.4→49.8. מוני פנדלים וגולים אישיים נשארו ללא שינוי. מונה משחקי המועדון11→14, כיבושי אורחים7→10, משחקים ללא שערים4→6, ומספר המחזורים שהסתיימו5→6.', '',
              'מחזורי ארבע ושבע החדשים ושלושת מחזורי הבדיקה הישנים נשארו ללא שינוי. אין כאן קריאה או כתיבה לחשבונות או מחזורים אחרים.']
lines += ['', '## גבולות', ''] + ['- ' + item for item in result['limits']]
lines += ['', '## אימותים', ''] + [f"- {'עבר' if item['passed'] else 'נכשל לפני תיקון; תוקן ונבדק שוב' if item.get('resolvedBy') else 'נכשל'}: {item['name']}" for item in checks]
(HERE / 'audit-eleven-data.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
print(json.dumps({'passed': result['passed'], 'failed': result['failed'], 'phase': result['phase']}, ensure_ascii=False))
if result['failed']: raise SystemExit(1)
