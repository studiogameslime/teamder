import React, {useEffect, useMemo, useState} from 'react';
import {BackHandler, Pressable, TextInput, View} from 'react-native';
import type {ManagerData} from '@/services/managerDashboardService';
import type {User} from '@/types';
import {managerActiveCards, managerNewcomers, managerPlayerHistory, managerRetention, managerRoster, uniqueManagerAttention, managerPlayerRating} from '@/utils/managerWorkspace';
import {managerClubInsights} from '@/utils/managerClubInsights';
import {ratingSeries, registrationState, type ScorePoint} from '@/utils/managerDashboard';
import {effectiveExpiry} from '@/utils/cardState';
import {seasonClosureMessages} from '@/utils/seasonClosureStatus';
import {ManagerAttention} from './ManagerClubExtras';
import {ManagerClubInsights} from './ManagerClubInsights';
import {ManagerEquipmentHolders} from './ManagerEquipmentHolders';
import {ManagerHistoryPanels} from './ManagerHistoryPanels';
import {ManagerBox as Box, ManagerDetail as Detail, ManagerLabel as Label, ManagerLink as Link, ManagerMetrics as Metrics, ManagerPerson as Person, ManagerProgress as Progress, managerColors as c, u} from './ManagerUi';
import {UserAvatar} from '@/components/UserAvatar';

type Panel = 'overview' | 'readiness' | 'roster' | 'player' | 'newcomers' | 'activity' | 'season' | 'demand' | 'attendance' | 'retention';
const titles: Record<Panel, string> = {overview: 'סקירה', readiness: 'מוכנות למחזור', roster: 'תמונת הסגל', player: 'מידע ניהולי על שחקן', newcomers: 'השתלבות חדשים', activity: 'פעילות המועדון', season: 'מצב העונה', demand: 'ביקוש ומקומות', attendance: 'ביטולים והגעה', retention: 'המשכיות של חדשים'};
const states = {registered: 'רשום', waitlist: 'ברשימת המתנה', pending: 'ממתין לאישור', cancelled: 'ביטל הרשמה', rejected: 'בקשתו נדחתה', none: 'לא נרשם'};
const date = (at: number) => new Date(at).toLocaleDateString('he-IL', {day: 'numeric', month: 'numeric'});
interface Props {
  data: ManagerData; viewerId: string; now: number; initialPlayer?: string | null;
  onRound: (id: string, approvals?: boolean) => void; onApprovals: () => void; onRate: (user: User) => void; onResolved: () => void;
  onRatings: () => void; onEquipment: () => void; onTimeline: (id: string) => void; onStats: () => void;
  onSeason: () => void; onHistory: () => void; onEdit: () => void; onPageChange: () => void;
  onBackChange: (back: (() => void) | null) => void;
  renderTrend: (points: ScorePoint[], direction: 'up' | 'down' | 'neutral') => React.ReactNode;
}
export function ManagerWorkspace(props: Props) {
  const {data, now, viewerId} = props;
  const [trail, setTrail] = useState<{panel: Panel; userId?: string}[]>([{panel: props.initialPlayer ? 'player' : 'overview', userId: props.initialPlayer ?? undefined}]);
  const [filter, setFilter] = useState<'attention' | 'cards' | 'all'>('attention'), [search, setSearch] = useState(''), [expanded, setExpanded] = useState(false);
  const page = trail[trail.length - 1];
  useEffect(() => {if (props.initialPlayer) setTrail([{panel: 'overview'}, {panel: 'player', userId: props.initialPlayer}]);}, [props.initialPlayer]);
  const open = (panel: Panel, userId?: string) => {setTrail(v => [...v, {panel, userId}]); setExpanded(false); props.onPageChange();};
  const back = () => {setTrail(v => v.length > 1 ? v.slice(0, -1) : [{panel: 'overview'}]); props.onPageChange();};
  useEffect(() => {
    props.onBackChange(trail.length > 1 || page.panel !== 'overview' ? back : null);
    return () => props.onBackChange(null);
  }, [trail.length, page.panel]);
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (trail.length <= 1 && page.panel === 'overview') return false;
      back(); return true;
    });
    return () => subscription.remove();
  }, [trail.length, page.panel]);
  const roster = useMemo(() => managerRoster(data.group, data.games, now), [data, now]);
  const newcomers = useMemo(() => managerNewcomers(data.group, data.games, now), [data, now]);
  const insights = useMemo(() => managerClubInsights(data.group, data.games, now), [data, now]);
  const attentionAbsent = uniqueManagerAttention(roster.overview.absent, insights.returned);
  const cards = useMemo(() => managerActiveCards(data.group, data.events, now), [data, now]);
  const user = (id: string): User => data.users.find(u => u.id === id) ?? {id, name: 'שחקן ללא פרטים', createdAt: 0};
  const person = (id: string, subtitle: string, badge?: string, warning = false) => <Person key={id} user={user(id)} subtitle={subtitle} badge={badge} warning={warning} onPress={() => open('player', id)}/>;
  const next = roster.upcoming;
  const readyCard = <Box title="המחזור הקרוב" icon="calendar-outline">{!next ? <><Label style={u.sub}>אין מחזור עתידי במועדון ברישומים שנטענו.</Label><Link title="להיסטוריית המחזורים" onPress={props.onHistory}/></> : <>
    <Label style={u.sub}>{date(next.startsAt)} | {new Date(next.startsAt).toLocaleTimeString('he-IL', {hour: '2-digit', minute: '2-digit'})}</Label>
    <Metrics items={[{value: roster.total, label: `רשומים מתוך ${next.maxPlayers}`}, {value: roster.vacancies ?? 'לא ידוע', label: 'מקומות פנויים'}, {value: new Set(next.waitlist).size, label: 'ברשימת המתנה'}]}/>
    {next.maxPlayers > 0 && <Progress value={roster.total / next.maxPlayers * 100}/>}
    <Label style={u.sub}>{roster.nextMembers} חברי מועדון, {roster.external} חיצוניים עם חשבון, {roster.guests} אורחים</Label>
    {next.status === 'locked' && <Label style={u.sub}>ההרשמה סגורה כרגע</Label>}
    {(next.registrationOpensAt ?? 0) > now && <Label style={u.sub}>ההרשמה תיפתח ב-{date(next.registrationOpensAt!)}</Label>}
    <Link title={page.panel === 'readiness' ? 'לפרטי המחזור' : 'לתמונת המוכנות המלאה'} onPress={() => page.panel === 'readiness' ? props.onRound(next.id) : open('readiness')}/>
  </>}</Box>;
  const rosterCard = <Box title="תמונת הסגל" icon="people-outline"><Label style={u.sub}>{roster.recent.length} המחזורים האחרונים שהתקיימו, מתוך הסגל הנוכחי</Label><Metrics items={[{value: roster.ids.length, label: 'חברי מועדון'}, {value: roster.active.length, label: 'נרשמו בתקופה'}, {value: roster.inactive.length, label: 'לא נרשמו בתקופה'}]}/><Label style={u.sub}>הרשמה אינה אישור נוכחות. אין להסיק מהיעדר הרשמה שהשחקן עזב.</Label>{page.panel !== 'roster' && <Link title="לסגל ולהרגלי ההרשמה" onPress={() => open('roster')}/>}</Box>;
  const extraTopics = [
    {n: new Set((next?.pending ?? []).filter(id=>!next?.players.includes(id))).size, title: 'בקשות למחזור הקרוב', description: 'ממתינים לאישור שלך', icon: 'calendar-outline' as const, color: c.blue, onPress: () => next && props.onRound(next.id,true)},
    {n: roster.missingGear.length, title: 'מחזיקי ציוד שאינם רשומים', description: 'בדיקת הכדור והגופיות לקראת המחזור', icon: 'cube-outline' as const, color: c.amber, onPress: props.onEquipment},
  ];
  const currentPlayer = page.userId ? user(page.userId) : null;
  const currentRating = page.userId ? managerPlayerRating(data.group, page.userId) : null;
  const member = roster.overview.members.find(m => m.userId === page.userId);
  const series = page.userId ? ratingSeries(data.group, data.games.filter(g => g.startsAt >= now - 90 * 86400000), data.scores).find(s => s.userId === page.userId) : undefined;
  const playerCards = cards.filter(e => e.userId === page.userId);
  const retention = page.panel === 'retention' ? managerRetention(data.group, data.games, now, data.truncated) : null;
  const pending = new Set((next?.pending ?? []).filter(id => !next?.players.includes(id)));
  return <>
    {page.panel !== 'overview' && <><Link title="חזרה למסך הקודם" onPress={back}/><Label style={{fontSize: 20, fontWeight: '800'}}>{titles[page.panel]}</Label></>}
    {page.panel === 'overview' && <>
      <ManagerAttention data={data} now={now} onApprovals={props.onApprovals} onRate={props.onRate} onResolved={props.onResolved} leadingTopics={extraTopics}/>
      {readyCard}{rosterCard}
      <Box title="שחקנים לתשומת לב" icon="pulse-outline">{!attentionAbsent.length && !insights.returned.length ? <Label style={u.sub}>לא נמצא שינוי בהרשמה לפי הספים שנקבעו.</Label> : <>{attentionAbsent.slice(0, 3).map(m => person(m.userId, `לא נרשם ל-${m.missed} מחזורים ברצף`, 'הפסקה בהרשמה', true))}{insights.returned.slice(0, 2).map(m => person(m.userId, m.upcoming?`נרשם למחזור הקרוב אחרי ${m.gap} מחזורים ללא הרשמה`:`חזר במחזור ${date(m.at)} אחרי ${m.gap} מחזורים ללא הרשמה`, 'חזר להירשם'))}</>}<Link title="לכל השחקנים ולכרטיסים הפעילים" onPress={() => open('roster')}/></Box>
      <Box title="פעילות המועדון" icon="stats-chart-outline"><Metrics items={[{value: insights.average === null ? 'אין נתון' : insights.average.toLocaleString('he-IL', {maximumFractionDigits: 1}), label: 'רשומים בממוצע'}, {value: roster.occupancyPercent === null ? 'אין נתון' : `${roster.occupancyPercent}%`, label: 'תפוסה מצטברת'}]}/><Label style={u.sub}>לפי {roster.recent.length} המחזורים האחרונים שהתקיימו</Label><Link title="לסיכום הפעילות והמשחקים" onPress={() => open('activity')}/><Link title="לביקוש ולמקומות בהרשמה" onPress={() => open('demand')}/><Link title="לביטולים ולהגעה מדווחת" onPress={() => open('attendance')}/></Box>
      <Box title="חברים חדשים ועונה" icon="person-add-outline"><Label style={u.sub}>{newcomers.rows.length} הצטרפו ב-30 הימים האחרונים עם תאריך מתועד.</Label><Link title="להשתלבות חברים חדשים" onPress={() => open('newcomers')}/><Link title="למצב העונה" onPress={() => open('season')}/></Box>
    </>}
    {page.panel === 'readiness' && <>{readyCard}{next && <>
      <Box title="אישורים והמתנה" icon="list-outline"><Detail label="ממתינים לאישור" value={String(pending.size)}/><Detail label="ברשימת המתנה" value={String(new Set(next.waitlist).size)}/>{pending.size > 0 && <Link title="לאישור בקשות במחזור" onPress={() => props.onRound(next.id)}/>}</Box>
      <Box title="קבועים שעדיין אינם רשומים" icon="people-outline">{!roster.missing.length ? <Label style={u.sub}>כל הקבועים שזוהו רשומים למחזור.</Label> : (['pending', 'waitlist', 'cancelled', 'none', 'rejected'] as const).map(state => {const rows = roster.missing.filter(m => registrationState(next, m.userId) === state); return rows.length ? <View key={state}><Label style={u.name}>{states[state]}</Label>{rows.map(m => person(m.userId, `${m.count} הרשמות מתוך ${m.sample} מחזורים אחרונים`))}</View> : null;})}<Label style={u.sub}>קבוע: לפחות 7 הרשמות מתוך 10 מחזורים זכאים. פחות מעשרה מחזורים אינם מספיקים לסיווג.</Label></Box>
      <ManagerEquipmentHolders data={data} now={now} onPlayer={id => open('player', id)} onRound={props.onRound}/>
    </>}</>}
    {page.panel === 'roster' && <>{rosterCard}<View style={u.chips}>{([{key: 'attention', label: 'לתשומת לב'}, ...(data.group.cardsEnabled ? [{key: 'cards', label: 'כרטיסים פעילים'}] : []), {key: 'all', label: 'כל הסגל'}] as const).map(t => <Pressable key={t.key} accessibilityRole="button" accessibilityState={{selected: filter === t.key}} onPress={() => {setFilter(t.key as typeof filter); setExpanded(false);}} style={[u.chip, filter === t.key && {backgroundColor: c.blue}]}><Label style={filter === t.key ? {color: '#FFF'} : undefined}>{t.label}</Label></Pressable>)}</View>
      {filter === 'all' && <TextInput value={search} onChangeText={setSearch} placeholder="חיפוש שחקן לפי שם" accessibilityLabel="חיפוש בסגל" style={{borderWidth: 1, borderColor: '#DCE5F2', borderRadius: 12, padding: 12, backgroundColor: '#FFF', textAlign: 'right', fontSize: 14}}/>}
      <Box title={filter === 'cards' ? 'כרטיסים פעילים' : filter === 'all' ? 'כל חברי המועדון' : 'שינוי בהרגלי ההרשמה'} icon="people-outline">
        {filter === 'cards' ? data.equipmentUnavailable ? <Label style={u.sub}>רישומי הכרטיסים לא נטענו. יש לרענן את הלוח.</Label> : !cards.length ? <Label style={u.sub}>אין כרטיסים פעילים ברישומים שנטענו.</Label> : cards.slice(0, expanded ? undefined : 10).map(e => {const exp = effectiveExpiry(e, e.type === 'red' ? data.group.redCardValidityDays : data.group.yellowCardValidityDays); return <Person key={e.id} user={user(e.userId)} subtitle={`${e.type === 'red' ? 'כרטיס אדום' : 'כרטיס צהוב'}, ${exp === null ? 'ללא מועד פקיעה' : `בתוקף עד ${date(exp)}`}`} badge={e.type === 'red' ? 'חסום להרשמה' : 'ללא חסימה'} warning={e.type === 'red'} onPress={() => open('player', e.userId)}/>;}) : filter === 'all' ? roster.ids.filter(id => user(id).name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).slice(0, expanded ? undefined : 10).map(id => {const m = roster.overview.members.find(m => m.userId === id)!;return person(id, `${m.count} הרשמות מתוך ${m.sample} מחזורים זכאים`, m.regular ? 'קבוע' : m.sample < 10 ? 'היסטוריה קצרה' : undefined);}) : <>{attentionAbsent.slice(0, expanded ? undefined : 5).map(m => person(m.userId, `לא נרשם ל-${m.missed} מחזורים ברצף${m.wasRegular ? ', היה קבוע לפני ההפסקה' : ''}`, 'הפסקה בהרשמה', true))}{insights.returned.slice(0, expanded ? undefined : 5).map(m => person(m.userId, m.upcoming?`נרשם למחזור הקרוב אחרי ${m.gap} מחזורים ללא הרשמה`:`חזר במחזור ${date(m.at)} אחרי ${m.gap} מחזורים ללא הרשמה`, 'חזר להירשם'))}{!attentionAbsent.length && !insights.returned.length && <Label style={u.sub}>אין שינוי בהרשמה לפי הספים שנקבעו.</Label>}</>}
        <Link title={expanded ? 'הצג פחות' : 'הצג את כל הרשימה'} onPress={() => setExpanded(v => !v)}/><Label style={u.sub}>הפסקה בהרשמה אינה הוכחה לעזיבה או לחוסר מחויבות.</Label>
      </Box><Link title="להשתלבות חברים חדשים" onPress={() => open('newcomers')}/><Link title="למצב העונה" onPress={() => open('season')}/></>}
    {page.panel === 'player' && currentPlayer && <>
      <Box><View style={u.row}><UserAvatar user={currentPlayer} size={54}/><View style={{flex: 1, gap: 5}}><Label style={{fontSize: 20, fontWeight: '800'}}>{currentPlayer.name}</Label>{typeof data.group.joinedAt?.[currentPlayer.id] === 'number' && <Label style={u.sub}>חבר מועדון מ-{date(data.group.joinedAt[currentPlayer.id])}</Label>}<Label style={u.sub}>{next ? `למחזור הקרוב: ${states[registrationState(next, currentPlayer.id)]}` : 'אין מחזור עתידי ברישומים שנטענו'}</Label></View></View><Metrics items={[{value: member ? `${member.count}/${member.sample}` : 'אין נתון', label: 'הרשמות במחזורים זכאים'}, {value: data.group.internalRating ? (currentRating === null ? 'טרם נקבע' : currentRating.toFixed(1)) : 'לא פעיל', label: 'דירוג מנהל מתוך 5'}, {value: series?.points.at(-1)?.score.toFixed(1) ?? 'אין ציון', label: 'ציון אחרון מתוך 10'}]}/></Box>
      <Box title="הרשמות אחרונות" icon="calendar-outline">{managerPlayerHistory(data.group, data.games, currentPlayer.id, now).map(r => <Detail key={r.game.id} label={`מחזור ${date(r.game.startsAt)}`} value={states[r.state]} warning={r.state !== 'registered'}/>)}<Label style={u.sub}>עד חמשת המחזורים האחרונים הזכאים, מהישן לחדש. הרשמה אינה אישור הגעה.</Label></Box>
      <Box title="ציוד וכרטיסים" icon="shield-checkmark-outline"><Detail label="ציוד נוכחי" value={roster.gear.filter(g => g.userId === currentPlayer.id).map(g => g.kind === 'ball' ? 'כדור' : 'גופיות').join(', ') || 'ללא ציוד רשום'}/>{data.group.cardsEnabled && (data.equipmentUnavailable ? <Label style={u.sub}>רישומי הכרטיסים לא נטענו.</Label> : playerCards.length ? playerCards.map(e => {const exp = effectiveExpiry(e, e.type === 'red' ? data.group.redCardValidityDays : data.group.yellowCardValidityDays);return <Detail key={e.id} label={e.type === 'red' ? 'כרטיס אדום, חוסם הרשמה' : 'כרטיס צהוב, ללא חסימה'} value={exp === null ? 'ללא מועד פקיעה' : `עד ${date(exp)}`} warning={e.type === 'red'}/>;}) : <Label style={u.sub}>אין כרטיס פעיל ברישומים שנטענו.</Label>)}<Link title="לציר האירועים המלא" onPress={() => props.onTimeline(currentPlayer.id)}/></Box>
      <Box title="מגמת ציונים" icon="trending-up-outline">{series ? <><Label style={u.sub}>{series.points.length} ציונים זמינים ב-90 ימים, לא בהכרח רצופים</Label>{props.renderTrend(series.points, 'neutral')}</> : <Label style={u.sub}>אין ציונים זמינים בתקופה. ציון חסר אינו אפס.</Label>}{data.group.internalRating && <Link title="ערוך דירוג מנהל" onPress={() => props.onRate(currentPlayer)}/>}<Link title="לציונים ולמגמות של כל הסגל" onPress={props.onRatings}/></Box>
    </>}
    {page.panel === 'newcomers' && <><Box title="השתלבות חברים חדשים" icon="person-add-outline"><Label style={u.sub}>הצטרפו ב-30 הימים האחרונים עם תאריך מתועד</Label><Metrics items={[{value: newcomers.rows.length, label: 'הצטרפו'}, {value: newcomers.first, label: 'הרשמה ראשונה'}, {value: newcomers.repeat, label: 'הרשמה חוזרת'}]}/><Label style={u.sub}>הרשמה למחזור שהתקיים. השלבים מצטברים.</Label></Box><Box title="חברים חדשים והזדמנויות להירשם" icon="people-outline">{!newcomers.rows.length ? <Label style={u.sub}>אין מצטרפים חדשים עם מועד הצטרפות מתועד בתקופה.</Label> : newcomers.rows.map(n => person(n.userId, `הצטרף ב-${date(n.joinedAt)}, התקיימו מאז ${n.opportunities} מחזורים`, n.completed >= 2 ? 'נרשם שוב' : n.completed ? 'הרשמה ראשונה' : n.next ? 'רשום למחזור הבא' : 'טרם נרשם', !n.completed && !n.next && n.opportunities > 0))}<Label style={u.sub}>אין השלמת מועד הצטרפות חסר מתאריך יצירת החשבון. הרשמה אינה אישור נוכחות.</Label></Box><Link title="להמשכיות לאורך זמן" onPress={() => open('retention')}/></>}
    {page.panel === 'activity' && <ManagerClubInsights data={data} viewerId={viewerId} now={now} onRound={props.onRound} onApprovals={props.onApprovals} onRate={props.onRate} onResolved={props.onResolved} showAttention={false}/>}
    {page.panel === 'season' && <><Box title="מצב העונה" icon="trophy-outline">{!data.group.seasons?.enabled ? <><Label style={u.sub}>לא מופעלת עונה במועדון.</Label><Link title="להגדרות המועדון" onPress={props.onEdit}/></> : <>
      <Label style={u.name}>עונה {data.group.seasons.currentNo}</Label>{data.group.seasons.cadence.type === 'rounds' ? <><Label style={{fontSize: 22, fontWeight: '800'}}>{typeof data.group.seasons.playedRounds === 'number' ? data.group.seasons.playedRounds : 'לא ידוע'} מתוך {data.group.seasons.cadence.targetRounds ?? 'לא ידוע'} מחזורים ליעד</Label>{typeof data.group.seasons.playedRounds === 'number' && (data.group.seasons.cadence.targetRounds ?? 0) > 0 && <Progress value={data.group.seasons.playedRounds / data.group.seasons.cadence.targetRounds! * 100}/>}</> : <Label>מועד סיום: {data.group.seasons.cadence.endsOn ?? (data.group.seasons.cadence.endsAt ? date(data.group.seasons.cadence.endsAt) : 'לא ידוע')}</Label>}
      {seasonClosureMessages(data.group.seasons.closureStatus).map(line => <Label key={line} style={u.sub}>{line}</Label>)}{data.group.seasons.pendingClose && <Label style={u.sub}>העונה בחלון תיקונים לפני סגירה. המצב הסופי נקבע לפי נתוני העונה.</Label>}
      <Link title="לסיכום העונה" onPress={props.onSeason}/><Link title="לטבלת העונה ולמובילים" onPress={props.onStats}/></>}</Box><Link title="להיסטוריית המועדון" onPress={props.onHistory}/></>}
    {(page.panel === 'demand' || page.panel === 'attendance') && <ManagerHistoryPanels data={data} viewerId={viewerId} now={now} kind={page.panel} onPlayer={id => open('player', id)}/>}
    {page.panel === 'retention' && retention && <><Label style={u.sub}>לפי חודש ההצטרפות של חברי הסגל הנוכחי. השוואה לאחר שמונה מחזורים זכאים לכל שחקן.</Label>{!retention.rows.length ? <Box><Label style={u.sub}>אין מועדי הצטרפות מתועדים שמאפשרים השוואה.</Label></Box> : retention.rows.map(row => <Box key={row.month} title={`מצטרפי ${row.month}`} icon="repeat-outline"><Label style={u.sub}>{row.members} חברים עם תאריך הצטרפות ידוע</Label>{row.mature === 0 ? <Label style={u.sub}>טרם הושלמו שמונה מחזורי מעקב, או שההיסטוריה הנדרשת אינה מלאה.</Label> : <><Label style={u.sub}>הושלם מעקב ל-{row.mature} מתוך {row.members} חברים בקבוצה.</Label><Detail label="נרשמו במחזורים 1 עד 4 לאחר ההצטרפות" value={`${row.first} מתוך ${row.mature}`}/><Detail label="נרשמו גם במחזורים 5 עד 8" value={`${row.continued} מתוך ${row.mature}`}/><Progress value={row.continued / row.mature * 100}/></>}</Box>)}<Label style={u.sub}>{retention.unknown} חברים ללא מועד הצטרפות תקף אינם נכללים. אי הרשמה אינה עזיבה, ואין כאן אחוז נטישה של המועדון.</Label></>}
  </>;
}
