import React, {useEffect, useMemo, useState} from 'react';
import {ActivityIndicator, Pressable, View} from 'react-native';
import type {ManagerData} from '@/services/managerDashboardService';
import {loadManagerHistory, type ManagerHistory} from '@/services/managerHistoryService';
import {managerHistoryView} from '@/utils/managerHistoryView';
import {managerArrivals} from '@/utils/managerWorkspace';
import {clubHistory} from '@/utils/managerClubInsights';
import {managerOverview} from '@/utils/managerDashboard';
import {observeCaughtError} from '@/utils/errorObservation';
import {ManagerBox, ManagerDetail, ManagerLabel, ManagerLink, ManagerMetrics, ManagerPerson, managerColors, u} from './ManagerUi';

export function ManagerHistoryPanels({data, viewerId, now, kind, onPlayer}: {
  data: ManagerData; viewerId: string; now: number; kind: 'demand' | 'attendance'; onPlayer: (id: string) => void;
}) {
  const [history, setHistory] = useState<ManagerHistory | null>(null), [error, setError] = useState(false), [retry, setRetry] = useState(0);
  const [days, setDays] = useState<30 | 90>(90);
  const games = useMemo(() => clubHistory(data.group, data.games, now).filter(g => g.startsAt >= now - days * 86400000), [data, now, days]);
  useEffect(() => {
    let active = true; setHistory(null); setError(false);
    loadManagerHistory(data.group.id, viewerId, games).then(value => {if (active) setHistory(value);}).catch(e => {
      observeCaughtError(e, {source: 'src/components/manager/ManagerHistoryPanels.tsx', handler: 'loadManagerHistory', site: 'manager-history-load'});
      if (active) setError(true);
    });
    return () => {active = false;};
  }, [data.group.id, viewerId, games, retry]);
  const view = managerHistoryView(history?.rows ?? [], kind === 'demand' ? games.slice(0, 10) : games);
  const arrivals = managerArrivals(data.group, data.games, now);
  const legacy = managerOverview(data.group, games, now);
  const user = (id: string) => data.users.find(u => u.id === id) ?? {id, name: 'שחקן ללא פרטים', createdAt: 0};
  return <>
    <View style={u.chips}>{([30, 90] as const).map(n => <Pressable accessibilityRole="button" accessibilityState={{selected: days === n}} key={n} onPress={() => setDays(n)} style={[u.chip, days === n && {backgroundColor: managerColors.blue}]}><ManagerLabel style={days === n ? {color: '#FFF'} : undefined}>{n === 30 ? '30 ימים' : '90 ימים'}</ManagerLabel></Pressable>)}</View>
    <ManagerBox title={kind === 'demand' ? 'ביקוש ומקומות' : 'היסטוריית ביטולים'} icon={kind === 'demand' ? 'people-outline' : 'close-circle-outline'}>
      {!history && !error ? <ActivityIndicator color={managerColors.blue}/> : error ? <><ManagerLabel>לא ניתן לטעון כרגע את היסטוריית ההרשמה.</ManagerLabel><ManagerLink title="נסה שוב" onPress={() => setRetry(n => n + 1)}/></> : history?.status === 'unavailable' ? <ManagerLabel style={u.sub}>היסטוריית הרשמה מלאה עדיין אינה זמינה. מדדי מילוי וביטולים מלאים יוצגו כאשר יהיו נתונים מתועדים.</ManagerLabel> : !view.covered ? <ManagerLabel style={u.sub}>אין עדיין מחזורים עם היסטוריית הרשמה מלאה בתקופה. נתונים חסרים אינם אפס.</ManagerLabel> : <>
        <ManagerLabel style={u.sub}>תיעוד מלא עבור {view.covered} מתוך {view.of} מחזורים{kind === 'demand' ? ' אחרונים בתקופה' : ' בתקופה'}.</ManagerLabel>
        {kind === 'demand' ? <><ManagerMetrics items={[{value: view.filled, label: 'הגיעו לתפוסה מלאה'}, {value: view.medianMs === null ? 'לא ידוע' : `${(view.medianMs / 3600000).toLocaleString('he-IL', {maximumFractionDigits: 1})} שעות`, label: 'זמן חציוני למילוי'}]}/><ManagerLabel style={u.sub}>זמן המילוי מחושב רק מתוך {view.filled} מחזורים שהתמלאו, ממועד פתיחת ההרשמה.</ManagerLabel><ManagerDetail label="קידום מרשימת המתנה" value={`${view.promotions} הרשמות`}/><ManagerDetail label="בהמתנה בתחילת המחזור" value={`${view.waiting} הרשמות`}/><ManagerLabel style={u.sub}>רשימת ההמתנה בתחילת המחזור תועדה ב-{view.waitingCovered} מחזורים. מספר הרשמות, לא שחקנים ייחודיים.</ManagerLabel></> : <><ManagerMetrics items={[{value: view.total - view.late - view.unknownDeadline, label: 'לפני המועד האחרון'}, {value: view.late, label: 'אחרי המועד האחרון'}, {value: view.unknownDeadline, label: 'מועד אחרון לא ידוע'}]}/>{view.counts.slice(0, 10).map(c => <ManagerPerson key={c.userId} user={user(c.userId)} subtitle={`${c.total} ביטולים מתועדים, מהם ${c.late} מאוחרים`} onPress={() => onPlayer(c.userId)}/>)}<ManagerLabel style={u.sub}>כולל פעולות ביטול שנרשמו לפני הרשמה מחדש. הסרה בידי מנהל אינה ביטול שחקן.</ManagerLabel></>}
      </>}
    </ManagerBox>
    {kind === 'attendance' && <>
      {(!history || !view.covered) && <ManagerBox title="ביטולים ברישומים הקיימים" icon="document-text-outline"><ManagerLabel style={u.sub}>{legacy.cancellationCount} ביטולים מתועדים ב-{games.length} מחזורים שהתקיימו בתקופה.</ManagerLabel>{legacy.members.filter(m => m.cancellations).sort((a, b) => b.cancellations - a.cancellations).slice(0, 5).map(m => <ManagerPerson key={m.userId} user={user(m.userId)} subtitle={`${m.cancellations} ביטולים ברישומים שנטענו`} onPress={() => onPlayer(m.userId)}/>)}<ManagerLabel style={u.sub}>זהו תיעוד חלקי: הרשמה מחדש מסירה את הביטול הקודם. אין להסיק ממנו שיעור ביטולים מלא.</ManagerLabel></ManagerBox>}
      <ManagerBox title="הגעה מדווחת במחזור האחרון" icon="location-outline">{!arrivals.game ? <ManagerLabel style={u.sub}>טרם נמצא מחזור שהתקיים.</ManagerLabel> : <><ManagerLabel style={u.sub}>{new Date(arrivals.game.startsAt).toLocaleDateString('he-IL')} | {arrivals.total} רשומים עם חשבון</ManagerLabel><ManagerDetail label="דיווחו שהגיעו" value={String(arrivals.counts.arrived)}/><ManagerDetail label="דיווחו על איחור" value={String(arrivals.counts.late)}/><ManagerDetail label="סומנו כמי שלא הגיעו" value={String(arrivals.counts.no_show)}/><ManagerDetail label="מצב לא ידוע" value={String(arrivals.counts.unknown)} warning/><ManagerLabel style={u.sub}>קיים דיווח ל-{arrivals.covered} מתוך {arrivals.total}. דיווח איחור אינו הוכחת הגעה. אורחים ללא חשבון אינם נכללים במדד.</ManagerLabel></>}</ManagerBox>
    </>}
  </>;
}
