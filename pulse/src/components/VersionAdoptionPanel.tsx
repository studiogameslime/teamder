import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, font, isolateText, radius, RTL_LABEL_ALIGN } from '../theme';
import { summarizeAdoption, type VersionAdoption, type VersionPlatform } from '../services/versionAdoption';
import { homeDayStart } from '../services/homeDashboard';
import { Disclosure } from './ui';

const number = (n: number) => n.toLocaleString('he-IL');
export function VersionAdoptionPanel({ data, loading, failed, refresh, onUser }: {
  data: VersionAdoption | null; loading: boolean; failed: boolean; refresh: () => void; onUser: (userId: string) => void;
}) {
  const [expanded, setExpanded] = useState<VersionPlatform | null>(null);
  const [limit, setLimit] = useState(20);
  const [filter, setFilter] = useState('all');
  const now = Date.now();
  const measuredToday = !!data && homeDayStart(data.at) === homeDayStart(now);
  const unknownPlatform = data?.users.filter(u => !['android', 'ios'].includes(u.platform ?? '') && !u.devices.some(d => ['android', 'ios'].includes(d.platform))).length ?? 0;
  return <View style={s.panel}>
    <View style={s.row}><View style={{ flex: 1, gap: 4 }}><Text style={font.h2}>מי כבר עדכן?</Text><Text style={s.small}>תמונת הגרסאות של המשתמשים</Text></View>{loading ? <ActivityIndicator color={colors.primary}/> : null}</View>
    {failed ? <Text accessibilityRole="alert" style={s.warning}>רענון הגרסאות נכשל.{data ? ' מוצגת המדידה הקודמת.' : ' הנתונים אינם זמינים.'}</Text> : null}
    {!data ? <Text style={s.small}>{loading ? 'בודק גרסאות ופעילות מהמכשירים.' : 'טרם התקבלה מדידה של הגרסאות.'}</Text> : <>
      {(['android', 'ios'] as const).map(platform => {
        const summary = summarizeAdoption(data, platform, now), target = data.targets[platform];
        const platformName = platform === 'android' ? 'אנדרואיד' : 'אייפון';
        const open = expanded === platform;
        const filtered = summary.entries.filter(e => filter === 'all' || (filter === 'missing' ? !e.device : e.device?.version === filter))
          .sort((a, b) => (b.device?.observedAt ?? 0) - (a.device?.observedAt ?? 0) || a.user.userId.localeCompare(b.user.userId));
        return <View key={platform} style={s.card}>
          <View style={s.row}><Text style={[font.title, { flex: 1 }]}>{platformName}</Text><Text style={s.small}>{target ? `${target.source === 'releaseLog' ? 'גרסה ציבורית מאומתת' : 'גרסת החנות'} ${isolateText(target.version)}` : 'גרסת החנות לא זמינה'}</Text></View>
          {target?.partial ? <Text style={s.warning}>ההפצה בחנות הדרגתית. ייתכן שהעדכון עדיין לא זמין לכולם.</Text> : null}
          <View style={s.row}><Text style={s.percent}>{summary.percent === null ? 'לא ידוע' : `${summary.percent}%`}</Text><View style={{ flex: 1, gap: 3 }}><Text style={font.body}>בגרסה האחרונה</Text><Text style={s.small}>{target ? `${number(summary.current)} מתוך ${number(summary.known)} בעלי גרסה ידועה` : 'לא ניתן להשוות לגרסת החנות'}</Text></View></View>
          {summary.percent !== null ? <View accessible accessibilityLabel={`${summary.percent} אחוז בגרסה האחרונה`} style={s.track}><View style={[s.fill, { width: `${summary.percent}%` }]}/></View> : null}
          <View style={s.counts}>
            {[{ label: 'בגרסה האחרונה', value: target ? summary.current : null, color: colors.primary }, { label: 'בגרסאות ישנות', value: target ? summary.older : null, color: colors.amber }, { label: 'ללא גרסה ידועה', value: summary.missing, color: colors.textMuted }].map(item => <View key={item.label} style={s.count}><Text style={[s.countValue, { color: item.color }]}>{item.value === null ? 'לא ידוע' : number(item.value)}</Text><Text style={s.countLabel}>{item.label}</Text></View>)}
          </View>
          {summary.newer ? <Text style={s.small}>{number(summary.newer)} בגרסה חדשה מגרסת החנות, למשל גרסת בדיקה.</Text> : null}
          {summary.failed ? <Text style={s.warning}>{number(summary.failed)} קריאות מכשירים נכשלו ונשארו מחוץ לאחוז.</Text> : null}
          <View style={s.today}><Text style={font.title}>נצפו היום בגרסה האחרונה: {target && measuredToday ? number(summary.todayCurrent) : 'לא ידוע'}</Text><Text style={s.small}>{measuredToday ? `${number(summary.today)} נצפו היום${target ? ` · ${number(summary.todayOlder)} בישנות` : ''}${summary.todayNewer ? ` · ${number(summary.todayNewer)} בחדשות מהחנות` : ''} · ${number(summary.todayUnknown)} ללא גרסה שנצפתה היום` : 'המדידה קודמת להיום. יש לרענן כדי לבדוק פעילות היום.'}</Text></View>
          <Text style={s.small}>{number(summary.total)} משתמשים זוהו במערכת הזו{summary.stale ? ` · ${number(summary.stale)} דיווחי גרסה בני יותר מ-30 יום` : ''}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`פירוט גרסאות ${platformName}`} accessibilityState={{ expanded: open }} onPress={() => { setExpanded(open ? null : platform); setFilter('all'); setLimit(20); }} style={s.button}><Text style={s.link}>{open ? 'סגירת הפירוט' : 'גרסאות ומשתמשים'}</Text></Pressable>
          {open ? <View style={{ gap: 10 }}>
            <Text style={s.small}>כל משתמש נספר פעם אחת במערכת הזו, לפי דיווח הגרסה האחרון שלו.</Text>
            <View style={s.filters}>{[{ key: 'all', label: `הכל ${summary.total}` }, ...summary.versions.map(([version, count]) => ({ key: version, label: `${isolateText(version)} · ${number(count)}` })), { key: 'missing', label: `ללא מידע ${summary.missing + summary.failed}` }].map(item => <Pressable key={item.key} accessibilityRole="button" accessibilityState={{ selected: filter === item.key }} onPress={() => { setFilter(item.key); setLimit(20); }} style={[s.filter, filter === item.key && { backgroundColor: colors.primarySoft }]}><Text style={s.small}>{item.label}</Text></Pressable>)}</View>
            <Text style={s.small}>{number(filtered.length)} משתמשים בסינון</Text>
            {filtered.slice(0, limit).map(({ user, device }) => <Pressable key={user.userId} accessibilityRole="button" accessibilityLabel={`פרטי משתמש ${user.name}`} onPress={() => onUser(user.userId)} style={s.user}><Text style={font.title}>{isolateText(user.name)} ←</Text><Text style={s.small}>{user.failed ? 'קריאת המכשירים נכשלה' : device ? `גרסה ${isolateText(device.version)} · נצפתה ${new Date(device.observedAt).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', dateStyle: 'short', timeStyle: 'short' })}` : 'לא התקבל דיווח גרסה תקין'}</Text></Pressable>)}
            {filtered.length > limit ? <Pressable accessibilityRole="button" onPress={() => setLimit(n => n + 20)} style={s.button}><Text style={s.link}>הצגת משתמשים נוספים</Text></Pressable> : null}
          </View> : null}
        </View>;
      })}
      <Text style={s.small}>נבדקו {number(data.users.length)} חשבונות · מערכת לא ידועה: {number(unknownPlatform)} · קריאות מכשירים שנכשלו: {number(data.users.filter(u => u.failed).length)}</Text>
      <Text style={s.small}>מדידה: {new Date(data.at).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', dateStyle: 'short', timeStyle: 'short' })}. נבדק שוב אוטומטית אחת ל-10 דקות כשהמסך פתוח.</Text>
      <Text style={s.note}>דיווח חסר או ישן אינו הוכחה שהמשתמש לא עדכן. האחוז מחושב רק מבעלי גרסה ידועה.</Text>
      <Disclosure title="איך נספרים המשתמשים?"><Text style={s.note}>הספירה מבוססת על דיווחי גרסה מהאפליקציה ומרישום להתראות, ללא חשבונות בדיקה ומחוקים. זו הגרסה האחרונה שנצפתה, ולא מספר ההורדות בחנויות. באנדרואיד מוצגת הגרסה הציבורית שאומתה ביומן ההפצה, ובאייפון הגרסה הזמינה לפי החנות. בגרסאות ללא דיווח ישיר המידע תלוי ברישום להתראות. פעילות היום נספרת מאז חצות בישראל; רק דיווח גרסה מהיום מוכיח שימוש בגרסה היום. אותו אדם עשוי להופיע בשתי מערכות ההפעלה.</Text></Disclosure>
    </>}
    <Pressable accessibilityRole="button" accessibilityLabel="רענון מדידת גרסאות" disabled={loading} onPress={refresh} style={[s.button, loading && { opacity: .5 }]}><Text style={s.link}>{loading ? 'המדידה מתעדכנת' : 'רענון מדידת הגרסאות'}</Text></Pressable>
  </View>;
}

const s = StyleSheet.create({
  panel: { gap: 12 }, row: { flexDirection: 'row', direction: 'rtl', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 14, gap: 12 },
  small: { ...font.small, fontSize: 12 }, note: { ...font.small, fontSize: 11 }, warning: { ...font.small, color: colors.amber },
  percent: { ...font.h1, fontSize: 34, color: colors.primary, textAlign: RTL_LABEL_ALIGN },
  track: { height: 7, backgroundColor: colors.border, borderRadius: 4, overflow: 'hidden', direction: 'rtl' }, fill: { height: 7, backgroundColor: colors.primary },
  counts: { flexDirection: 'row', direction: 'rtl', gap: 8 }, count: { flex: 1, minWidth: 0, gap: 5 },
  countValue: { ...font.h2, textAlign: RTL_LABEL_ALIGN }, countLabel: { ...font.small, fontSize: 11 },
  today: { gap: 5, padding: 10, borderRadius: 9, backgroundColor: colors.surfaceAlt },
  button: { minHeight: 44, justifyContent: 'center' }, link: { ...font.small, color: colors.primary },
  filters: { flexDirection: 'row', direction: 'rtl', flexWrap: 'wrap', gap: 6 },
  filter: { minHeight: 44, padding: 10, justifyContent: 'center', borderRadius: 8, backgroundColor: colors.surfaceAlt },
  user: { gap: 4, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
});
