import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors, font, isolateText, radius } from '../theme';
import { homeFollowUps, type HomeActions } from '../services/homeActions';
import type { HomeClub } from '../services/homeDashboard';

type ActionKey = 'solo' | 'first' | 'shortages' | 'followups' | 'requests' | 'support';
const date = (at: number) => new Date(at).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });

export function HomeActionPanel({ actions, clubs, names, onPeopleChange, onFollowUp, saving, blocked }: {
  actions: HomeActions | null; clubs: HomeClub[] | null; names: Record<string, string>;
  onPeopleChange: (ids: string[]) => void; onFollowUp: (club: HomeClub) => void; saving: string | null; blocked: boolean;
}) {
  const nav = useNavigation<any>();
  const [expanded, setExpanded] = useState<ActionKey | null>(null);
  const [limit, setLimit] = useState(10);
  const followUps = clubs ? homeFollowUps(clubs, Date.now()) : null;
  const rows = expanded === 'solo' ? actions?.solo : expanded === 'first' ? actions?.noFirstRound : expanded === 'shortages' ? actions?.shortages : expanded === 'followups' ? followUps : expanded === 'requests' ? actions?.requests : expanded === 'support' ? actions?.support : null;
  const people = expanded === 'requests' ? actions?.requests?.slice(0, limit).map(r => r.userId) : expanded === 'support' ? actions?.support?.slice(0, limit).map(r => r.userId) : expanded === 'followups' ? followUps?.slice(0, limit).flatMap(r => r.organizerId ? [r.organizerId] : []) : [];
  const peopleKey = (people ?? []).join('|');
  useEffect(() => { onPeopleChange((people ?? []).slice(0, 40)); return () => onPeopleChange([]); }, [peopleKey, onPeopleChange]);
  const club = (id: string) => nav.navigate('Clubs', { screen: 'ClubDetail', params: { groupId: id } });
  const person = (id: string) => nav.navigate('Users', { screen: 'UserDetail', params: { userId: id } });
  const name = (id: string) => isolateText(names[id] ?? 'שם לא נטען');
  const sections: { key: ActionKey; title: string; icon: keyof typeof Ionicons.glyphMap; count: number | null; unknown?: number; help: string }[] = [
    { key: 'solo', title: 'חדשים עם מארגן בלבד', icon: 'person-outline', count: actions?.solo?.length ?? null, unknown: actions?.soloUnknown, help: 'מועדונים שנוצרו מ־1.11.2026 ורק המארגן תועד בהם כחבר או כמנהל.' },
    { key: 'first', title: 'חדשים ללא מחזור ראשון', icon: 'flag-outline', count: actions?.noFirstRound?.length ?? null, unknown: actions?.firstRoundUnknown, help: 'מועדונים שנוצרו מ־1.11.2026 ועדיין לא נמצא בהם מחזור שנפתח, גם אם הוא עתידי או בוטל. אין כאן בדיקה אם כבר שיחקו.' },
    { key: 'shortages', title: 'מחזורים שחסרים בהם שחקנים', icon: 'football-outline', count: actions?.shortages?.length ?? null, unknown: actions?.shortageUnknown, help: 'בשלושת הימים הקרובים. מקומות פנויים בסגל לאחר חישוב רשומים, אורחים פעילים ומקום שמור להצעת קידום. נראות ואישור מנהל עדיין חלים.' },
    { key: 'followups', title: 'הגיע הזמן לבדוק שוב', icon: 'time-outline', count: followUps?.length ?? null, help: 'עברו לפחות שלושה ימים מאז שסימנת פנייה או בדיקה חוזרת. הסימון ידני ואינו שולח הודעה או בודק אם המארגן ענה.' },
    { key: 'requests', title: 'בקשות הצטרפות שממתינות', icon: 'person-add-outline', count: actions?.requests?.length ?? null, help: 'בקשות לאישור במועדונים שאינם אישיים, מכל תאריכי היצירה. בקשה נספרת בנפרד בכל מועדון; מי שכבר חבר או מנהל אינו נספר.' },
    { key: 'support', title: 'שיחות שממתינות לתשובה שלך', icon: 'chatbubble-ellipses-outline', count: actions?.support?.length ?? null, help: 'ההודעה האחרונה נשלחה בידי המשתמש ולא סומנה כפתורה. השיחות שממתינות זמן רב יותר מוצגות ראשונות.' },
  ];
  return <View style={{ gap: 10 }}><Text style={font.h2}>לטיפול ולמעקב</Text>{sections.map(section => <View key={section.key} style={s.section}>
    <Pressable accessibilityRole="button" accessibilityLabel={section.title} accessibilityState={{ expanded: expanded === section.key }} onPress={() => { setExpanded(expanded === section.key ? null : section.key); setLimit(10); }} style={s.header}>
      <Ionicons name={section.icon} size={19} color={colors.textSoft}/><Text style={[s.title, { flex: 1 }]}>{section.title}</Text><Text style={s.count}>{section.count === null ? 'לא זמין' : section.unknown ? `לפחות ${section.count}` : section.count}</Text><Ionicons name={expanded === section.key ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted}/>
    </Pressable>
    {expanded === section.key ? <View style={s.details}><Text style={s.small}>{section.help}</Text>
      {section.unknown ? <Text style={s.warning}>{section.unknown} פריטים נוספים לא נבדקו במלואם. אין להסיק שהספירה מלאה.</Text> : null}
      {section.count === null ? <Text style={s.warning}>המידע לא נטען. אפשר לנסות שוב ברענון המסך.</Text> : section.count === 0 ? <Text style={s.small}>לא נמצאו פריטים כאלה במידע שנבדק.</Text> : null}
      {(section.key === 'solo' || section.key === 'first') ? (section.key === 'solo' ? actions?.solo : actions?.noFirstRound)?.slice(0, limit).map(c => <Pressable key={c.id} accessibilityRole="button" accessibilityLabel={`פתיחת מועדון ${c.name}`} onPress={() => club(c.id)} style={s.item}><Text style={s.title}>{isolateText(c.name)}</Text><Text style={s.small}>{c.members} חברים ומנהלים · פרטי המועדון ←</Text></Pressable>) : null}
      {section.key === 'shortages' ? actions?.shortages?.slice(0, limit).map(g => <Pressable key={g.id} accessibilityRole="button" accessibilityLabel={`פרטי המחזור ${g.title}`} onPress={() => nav.navigate('Games', { screen: 'GameDetail', params: { gameId: g.id } })} style={s.item}><Text style={s.title}>{isolateText(g.title)}</Text><Text style={s.small}>{date(g.startsAt)} · {g.registered} רשומים, {g.guests} אורחים{g.reserved ? ', מקום אחד שמור' : ''}</Text><Text style={s.link}>{g.remaining} מקומות בסגל מתוך {g.capacity} ←</Text></Pressable>) : null}
      {section.key === 'followups' ? followUps?.slice(0, limit).map(c => <View key={c.id} style={s.item}><Pressable accessibilityRole="button" onPress={() => club(c.id)}><Text style={s.title}>{isolateText(c.name)}</Text></Pressable><Text style={s.small}>פניתי: {date(c.contactedAt!)}{c.lastFollowUpAt ? ` · בדקתי שוב: ${date(c.lastFollowUpAt)}` : ''}</Text><View style={s.row}><Pressable accessibilityRole="button" onPress={() => c.organizerId && person(c.organizerId)} style={s.linkButton}><Text style={s.link}>למארגן: {c.organizerId ? name(c.organizerId) : 'לא תועד'} ←</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`בדקתי שוב היום: ${c.name}`} disabled={blocked || !!saving} onPress={() => onFollowUp(c)} style={[s.button, (blocked || !!saving) && { opacity: .5 }]}><Text style={s.link}>{saving === c.id ? 'שומר ומאמת' : 'בדקתי שוב היום'}</Text></Pressable></View></View>) : null}
      {section.key === 'requests' ? actions?.requests?.slice(0, limit).map(r => <View key={`${r.groupId}:${r.userId}`} style={s.item}><Text style={s.title}>{name(r.userId)}</Text><Text style={s.small}>ממתין להצטרף: {isolateText(r.groupName)}</Text><View style={s.row}><Pressable accessibilityRole="button" accessibilityLabel={`המועדון של הבקשה ${r.groupId} ${r.userId}`} onPress={() => club(r.groupId)} style={s.linkButton}><Text style={s.link}>למועדון ולמנהל ←</Text></Pressable><Pressable accessibilityRole="button" onPress={() => person(r.userId)} style={s.linkButton}><Text style={s.link}>פרטי המשתמש ←</Text></Pressable></View></View>) : null}
      {section.key === 'support' ? actions?.support?.slice(0, limit).map(t => <Pressable key={t.userId} accessibilityRole="button" accessibilityLabel={`פתיחת שיחת התמיכה ${t.userId}`} onPress={() => nav.navigate('Messages', { userId: t.userId, messageId: t.messageId })} style={s.item}><Text style={s.title}>{name(t.userId)}</Text><Text style={s.small}>ממתין מאז {date(t.lastMessageAt)}</Text>{t.preview ? <Text numberOfLines={2} style={s.small}>{isolateText(t.preview)}</Text> : null}<Text style={s.link}>לשיחה ←</Text></Pressable>) : null}
      {rows && rows.length > limit ? <Pressable accessibilityRole="button" onPress={() => setLimit(v => v + 10)} style={s.linkButton}><Text style={s.link}>הצגת פריטים נוספים</Text></Pressable> : null}
    </View> : null}
  </View>)}</View>;
}

const s = StyleSheet.create({
  section: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden' },
  header: { flexDirection: 'row', direction: 'rtl', alignItems: 'center', padding: 14, gap: 9, minHeight: 58 },
  row: { flexDirection: 'row', direction: 'rtl', alignItems: 'center', flexWrap: 'wrap', gap: 12 },
  details: { padding: 14, paddingTop: 0, gap: 10 },
  title: { ...font.title, fontSize: 13 },
  small: { ...font.small, fontSize: 12 },
  count: { ...font.title, color: colors.amber, fontSize: 13 },
  item: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12, gap: 6, minHeight: 44 },
  link: { ...font.small, fontSize: 12, color: colors.primary },
  warning: { ...font.small, fontSize: 12, color: colors.amber },
  linkButton: { minHeight: 44, justifyContent: 'center' },
  button: { minHeight: 44, justifyContent: 'center', borderRadius: 9, backgroundColor: colors.primarySoft, paddingHorizontal: 12, paddingVertical: 8 },
});
