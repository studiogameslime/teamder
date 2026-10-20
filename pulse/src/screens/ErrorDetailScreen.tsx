import { DiagnosticTimeline } from '../components/DiagnosticTimeline';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RTL_LABEL_ALIGN, RTL_VALUE_ALIGN, colors, font, radius  } from '../theme';
import { SectionTabs, Panel, Card } from '../components/ui';
import { fetchIssue } from '../services/errorsService';
import { describeError } from '../services/errorCatalog';
import { fetchUserById } from '../services/firebase';
import { timeAgo } from '../format';
import type { AppUser, ErrorRecord } from '../types';
import type { ErrorsStackParams } from '../navigation/ErrorsStack';

function Field({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue} selectable>
        {value}
      </Text>
    </View>
  );
}

export function ErrorDetailScreen() {
  const [section, setSection] = useState('summary');
  const [zoom, setZoom] = useState(false);
  const route = useRoute<RouteProp<ErrorsStackParams, 'ErrorDetail'>>();
  const nav = useNavigation();
  const { id, collection = 'errors' } = route.params;
  const [rec, setRec] = useState<ErrorRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [linkedUser, setLinkedUser] = useState<AppUser | null>(null);
  useEffect(() => {
    let alive = true;
    setLoading(true); setFailed(false); setRec(null);
    fetchIssue(id, collection)
      .then(value => { if (alive) setRec(value); })
      .catch(() => { if (alive) setFailed(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [id, collection, retry]);

  // Resolve the linked user's name with a single doc read (no full-collection
  // load) — only when this error is attributed to a user.
  useEffect(() => {
    if (!rec?.userId) {
      setLinkedUser(null);
      return;
    }
    let alive = true;
    fetchUserById(rec.userId).then((u) => alive && setLinkedUser(u));
    return () => {
      alive = false;
    };
  }, [rec?.userId]);

  const ctx = rec ? JSON.stringify(rec.context ?? {}, null, 2) : '';
  const v = rec ? describeError(rec) : null;
  const openUser = () => {
    if (!rec?.userId) return;
    (nav as any).getParent()?.navigate('Users', {
      screen: 'UserDetail',
      params: { userId: rec.userId },
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => nav.goBack()} style={styles.back} hitSlop={10}>
          <Ionicons name="chevron-forward" size={26} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {v?.title ?? 'שגיאה'}
        </Text>
        <View style={{ width: 26 }} />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 30 }} />
      ) : failed ? (
        <Pressable onPress={() => setRetry(v => v + 1)}><Text style={styles.missing}>לא ניתן לטעון את הפריט. לחצו לניסיון חוזר.</Text></Pressable>
      ) : !rec ? (
        <Text style={styles.missing}>השגיאה לא נמצאה</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          <SectionTabs value={section} onChange={setSection} items={[{key:'summary',label:'תקציר'}, {key:'evidence',label:'צילום ורצף'}, {key:'technical',label:'פרטים טכניים'}]} />
          <Panel active={section === 'summary'}>
          {/* What happened — friendly summary */}
          <Card style={{ gap: 8 }}>
            <Text style={[styles.catTag, { color: v?.catColor }]}>
              {v?.catEmoji} {v?.catLabel}
            </Text>
            <Text style={styles.op}>{v?.title}</Text>
            <View style={styles.qaRow}>
              <Text style={styles.qaKey}>איפה</Text>
              <Text style={styles.qaVal} selectable>
                {v?.whereLabel ?? rec.screen ?? '—'}
              </Text>
            </View>
            <View style={styles.qaRow}>
              <Text style={styles.qaKey}>
                {v?.category === 'report' || v?.category === 'suggestion' ? 'תוכן' : 'למה'}
              </Text>
              <Text style={styles.qaVal} selectable>{v?.why}</Text>
            </View>
            <View style={styles.badges}>
              <Text style={styles.badge}>×{rec.count} מקרים</Text>
              {rec.code ? <Text style={styles.badge}>{rec.code}</Text> : null}
              <Text style={styles.badge}>
                {rec.status === 'new' ? 'ממתין' : rec.status === 'reviewed' ? 'בטיפול' : 'תוקן'}
              </Text>
            </View>
          </Card>



          {/* What the user was trying to do — decoded params */}
          {v && v.attempted.length ? (
            <>
              <Text style={styles.section}>מה ניסו לעשות</Text>
              <Card style={{ gap: 2 }}>
                {v.attempted.map((a) => (
                  <Field key={a.label} label={a.label} value={a.value} />
                ))}
              </Card>
            </>
          ) : null}

          <Card style={{ gap: 2 }}>
            <Field label="נראתה לראשונה" value={rec.firstSeen ? timeAgo(rec.firstSeen) : undefined} />
            <Field label="נראתה לאחרונה" value={rec.lastSeen ? timeAgo(rec.lastSeen) : undefined} />
            {rec.userId ? (
              <Pressable onPress={openUser} style={styles.userRow}>
                <Ionicons name="chevron-back" size={16} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.fieldValue, { direction: 'rtl' as const, color: colors.primary, textAlign: RTL_LABEL_ALIGN }]}>
                    {linkedUser?.name ?? 'משתמש'}
                  </Text>
                  <Text style={[styles.fieldLabel, { direction: 'rtl' as const, textAlign: RTL_LABEL_ALIGN }]}>{rec.userId}</Text>
                </View>
                <Text style={styles.fieldLabel}>משתמש</Text>
              </Pressable>
            ) : null}
            <Field label="פלטפורמה" value={[rec.platform, rec.osVersion].filter(Boolean).join(' ')} />
            <Field label="גרסת אפליקציה" value={rec.appVersion} />
          </Card>

          </Panel>
          <Panel active={section === 'evidence'}>
            {rec.image ? <Pressable accessibilityLabel="הגדלת צילום הדיווח" onPress={() => setZoom(true)}><Image source={{uri:`data:image/jpeg;base64,${rec.image}`}} style={{width:'100%',height:340}} resizeMode="contain" /></Pressable> : <Text style={styles.missing}>לא צורף צילום לדיווח</Text>}
            <DiagnosticTimeline docPath={`${rec.coll ?? 'errors'}/${rec.id}`} />
          </Panel>
          <Panel active={section === 'technical'}>
          <Card><Field label="פעולה" value={rec.operation} /><Field label="מזהה מסך" value={rec.screen} /></Card>
          {/* Raw technical message + full context for the developer (me).
              Skipped for feedback — its message is shown above as "תוכן". */}
          {rec.message && v?.category !== 'report' && v?.category !== 'suggestion' ? (
            <>
              <Text style={styles.section}>הודעת שגיאה גולמית</Text>
              <Card>
                <Text style={styles.mono} selectable>{rec.message}</Text>
              </Card>
            </>
          ) : null}
          {ctx && ctx !== '{}' ? (
            <>
              <Text style={styles.section}>הקשר מלא (JSON)</Text>
              <Card>
                <Text style={styles.mono} selectable>{ctx}</Text>
              </Card>
            </>
          ) : null}

          {rec.stack ? (
            <>
              <Text style={styles.section}>Stack</Text>
              <Card>
                <Text style={styles.mono} selectable>{rec.stack}</Text>
              </Card>
            </>
          ) : null}

          <View style={styles.statusNote}>
            <Ionicons name="construct-outline" size={16} color={colors.textMuted} />
            <Text style={styles.statusNoteText}>
              {rec.status === 'resolved'
                ? 'תוקן ✓'
                : rec.status === 'reviewed'
                  ? 'בטיפול 🛠️'
                  : 'ממתין לטיפול'}{' '}
              · סטטוס הדיווח כפי שנשמר במערכת
            </Text>
          </View>
          </Panel>
          <Modal visible={zoom} transparent onRequestClose={() => setZoom(false)}><View style={{flex:1,backgroundColor:colors.bg,padding:24}}><Pressable onPress={() => setZoom(false)} style={{padding:16}}><Text style={{color:colors.primary}}>סגירת צילום</Text></Pressable><Image source={{uri:`data:image/jpeg;base64,${rec.image}`}} style={{flex:1,width:'100%'}} resizeMode="contain" /></View></Modal>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...font.h2, flex: 1, textAlign: 'center' },
  missing: { ...font.body, color: colors.textMuted, textAlign: 'center', marginTop: 30 },
  scroll: { padding: 16, gap: 12, paddingBottom: 40 },
  op: { ...font.h2 },
  catTag: { ...font.small, fontWeight: '800' },
  qaRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  qaKey: { ...font.small, color: colors.textMuted, width: 44 },
  qaVal: {  ...font.body, color: colors.text, flex: 1, lineHeight: 20, textAlign: RTL_LABEL_ALIGN },
  msg: { ...font.body, color: colors.text, lineHeight: 21 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  badge: {
    ...font.small,
    color: colors.textSoft,
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  field: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, gap: 12 },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7 },
  fieldLabel: { ...font.small, color: colors.textMuted },
  fieldValue: {  ...font.body, color: colors.text, flexShrink: 1, textAlign: RTL_VALUE_ALIGN },
  section: { ...font.h2, fontSize: 15, marginTop: 6 },
  mono: {
    color: colors.textSoft,
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 17,
  },
  statusNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statusNoteText: {  ...font.small, color: colors.textMuted, flex: 1, textAlign: RTL_LABEL_ALIGN },
});
