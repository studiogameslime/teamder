import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, Alert, Share, Modal, RefreshControl, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Card } from '../components/ui';
import { Dropdown } from '../components/Dropdown';
import { colors, radius } from '../theme';
import {
  createAdLink, listAdLinks, fetchAcquisitionReport, buildAdLink, fetchLinkStats,
  deleteAdLink, SOURCE_PRESETS, type AcquisitionReport, type LinkStats,
} from '../services/adLinks';
import type { FsDoc } from '../services/firestoreRest';
import { accountPercentage } from '../services/adLinkStats';

const pct = (n: number, d: number) => accountPercentage(n, d) ?? '—';
const pctColor = (n: number, d: number) => {
  const p = d ? (n / d) * 100 : 0;
  return p >= 50 ? colors.green : p >= 20 ? colors.amber : colors.red;
};

function sourceIcon(src: string): { name: keyof typeof Ionicons.glyphMap; tint: string } {
  const k = src.toLowerCase();
  if (k.includes('whats')) return { name: 'logo-whatsapp', tint: '#25D366' };
  if (k.includes('face')) return { name: 'logo-facebook', tint: '#1877F2' };
  if (k.includes('insta')) return { name: 'logo-instagram', tint: '#E1306C' };
  if (k.includes('tele')) return { name: 'paper-plane', tint: '#229ED9' };
  if (k.includes('sms')) return { name: 'chatbubble-ellipses', tint: '#F59E0B' };
  if (k.includes('אורגני')) return { name: 'leaf', tint: colors.textMuted };
  return { name: 'link', tint: colors.primary };
}

export function SourcesScreen() {
  const [name, setName] = useState('');
  const [source, setSource] = useState('');
  const [customSource, setCustomSource] = useState('');
  const [campaign, setCampaign] = useState('');
  const [gameId, setGameId] = useState('');
  const [busy, setBusy] = useState(false);

  const [links, setLinks] = useState<FsDoc[]>([]);
  const [report, setReport] = useState<AcquisitionReport | null>(null);
  const [loadingReport, setLoadingReport] = useState(true);

  const [detailLink, setDetailLink] = useState<FsDoc | null>(null);
  const [stats, setStats] = useState<LinkStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [statsError, setStatsError] = useState(false);
  const detailRequest = useRef(0);
  const closeDetail = () => { detailRequest.current += 1; setDetailLink(null); };

  const openDetail = async (l: FsDoc) => {
    const request = ++detailRequest.current;
    setDetailLink(l); setStats(null); setStatsError(false); setLoadingStats(true);
    try {
      const result = await fetchLinkStats(l);
      if (request === detailRequest.current) setStats(result);
    } catch {
      if (request === detailRequest.current) setStatsError(true);
    } finally {
      if (request === detailRequest.current) setLoadingStats(false);
    }
  };

  const onDelete = (l: FsDoc) => {
    Alert.alert(
      'מחיקת קישור',
      `למחוק את "${String(l.name ?? l.source ?? '')}"? הקישור יוסר מהתצוגה. משתמשים שכבר יוחסו לא יושפעו.`,
      [
        { text: 'ביטול', style: 'cancel' },
        {
          text: 'מחק', style: 'destructive',
          onPress: async () => {
            const ok = await deleteAdLink(String(l.id));
            if (!ok) { Alert.alert('שגיאה', 'המחיקה נכשלה'); return; }
            if (detailLink?.id === l.id) closeDetail();
            await reload();
          },
        },
      ],
    );
  };

  // `force` bypasses the 5-min cache — used by pull-to-refresh so live click
  // counts (which change server-side as people scan) show immediately.
  const reload = async (force = false) => {
    setLoadingReport(true);
    try {
      const [l, r] = await Promise.all([
        listAdLinks(force).catch(() => []),
        fetchAcquisitionReport().catch(() => null),
      ]);
      setLinks(l); setReport(r);
    } finally { setLoadingReport(false); }
  };
  useEffect(() => { reload(); }, []);

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    try { await reload(true); } finally { setRefreshing(false); }
  };

  const effectiveSource = (source === 'other' ? customSource : source).trim();
  const share = (url: string) => { Share.share({ message: url }).catch(() => {}); };
  const preview = effectiveSource ? 'https://teamderfc.web.app/play/XXXXXXXX' : '';

  const onCreate = async () => {
    if (!effectiveSource) { Alert.alert('חסר', 'בחר מקור'); return; }
    setBusy(true);
    try {
      const res = await createAdLink({ name: name.trim() || effectiveSource, source: effectiveSource, campaign: campaign.trim() || undefined, gameId: gameId.trim() || undefined });
      if (res.ok) {
        setName(''); setCampaign(''); setGameId(''); setCustomSource('');
        await reload();
        Alert.alert('נוצר קישור', res.url, [{ text: 'סגור', style: 'cancel' }, { text: 'שתף', onPress: () => share(res.url) }]);
      } else Alert.alert('שגיאה', 'יצירת הקישור נכשלה');
    } catch { Alert.alert('שגיאה', 'יצירת הקישור נכשלה. בדוק חיבור והרשאות ונסה שוב'); } finally { setBusy(false); }
  };

  return (
    <Screen
      title="קישורים"
      subtitle="צור קישורים ובדוק מאיפה הגיעו החשבונות"
      right={<Ionicons name="add" size={26} color={colors.primary} />}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
      }
    >
      <Text style={s.miniLbl}>למדידה נפרדת, צור קישור לפייסבוק וקישור נוסף לאינסטגרם.</Text>
      {/* create */}
      <Text style={s.section}>יצירת קישור חדש</Text>
      <Card style={{ gap: 10 }}>
        <Dropdown title="בחר איפה הקישור יפורסם" options={[{ value: '', label: 'בחר מקור שיתוף' }, ...SOURCE_PRESETS.map((p) => ({ value: p, label: ({ whatsapp: 'וואטסאפ', facebook: 'פייסבוק', instagram: 'אינסטגרם', telegram: 'טלגרם', sms: 'מסרון', other: 'אחר' } as Record<string, string>)[p] }))]} value={source} onSelect={setSource} />
        {source === 'other' ? (
          <TextInput style={s.input} placeholder="שם מקור מותאם" placeholderTextColor={colors.textMuted} value={customSource} onChangeText={setCustomSource} />
        ) : null}
        <TextInput style={s.input} placeholder="שם הקישור (אופציונלי)" placeholderTextColor={colors.textMuted} value={name} onChangeText={setName} />
        <TextInput style={s.input} placeholder="קמפיין (אופציונלי)" placeholderTextColor={colors.textMuted} value={campaign} onChangeText={setCampaign} />
        <TextInput style={s.input} placeholder="מזהה משחק יעד (אופציונלי)" placeholderTextColor={colors.textMuted} value={gameId} onChangeText={setGameId} />

        {preview ? (
          <>
            <Text style={s.miniLbl}>כך ייראה הקישור הקצר — ייווצר לאחר שמירה</Text>
            <View style={s.urlBox}>
              <Ionicons name="link-outline" size={18} color={colors.primary} />
              <Text style={s.urlTxt} numberOfLines={1}>{preview}</Text>
            </View>
          </>
        ) : null}

        <Pressable style={[s.btn, busy && { opacity: 0.6 }]} onPress={onCreate} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : (<><Ionicons name="share-social" size={18} color="#fff" /><Text style={s.btnTxt}>צור קישור</Text></>)}
        </Pressable>
      </Card>

      {/* report */}
      <Text style={s.section}>דוח לפי מקור</Text>
      <Card>
        {loadingReport ? (
          <ActivityIndicator color={colors.primary} style={{ paddingVertical: 16 }} />
        ) : !report || report.rows.length === 0 ? (
          <Text style={s.empty}>אין עדיין נתוני ייחוס</Text>
        ) : (
          <>
            <View style={[s.trow, s.thead]}>
              <Text style={[s.th, s.cSrc]}>מקור</Text>
              <Text style={s.th}>חשבונות</Text>
              <Text style={s.th}>השלימו הרשמה</Text>
              <Text style={s.th}>הצטרפו</Text>
              <Text style={[s.th, s.cConv]}>השלמה</Text>
            </View>
            {report.rows.map((r) => {
              const ic = sourceIcon(r.source);
              return (
                <View key={r.source} style={s.trow}>
                  <View style={[s.cSrc, s.srcCell]}>
                    <Ionicons name={ic.name} size={16} color={ic.tint} />
                    <Text style={s.srcName} numberOfLines={1}>{r.source}</Text>
                  </View>
                  <Text style={[s.td, s.tdNum]}>{r.accounts.toLocaleString()}</Text>
                  <Text style={s.td}>{r.signups.toLocaleString()}</Text>
                  <Text style={s.td}>{r.joined.toLocaleString()}</Text>
                  <Text style={[s.td, s.cConv, { color: pctColor(r.signups, r.accounts), fontWeight: '800' }]}>{pct(r.signups, r.accounts)}</Text>
                </View>
              );
            })}
            <Text style={s.note}>{report.totalTracked} מיוחסים מתוך {report.totalUsers} משתמשים</Text>
          </>
        )}
      </Card>

      {/* my links */}
      <View style={s.linksHead}>
        <Text style={[s.section, { marginTop: 0, marginBottom: 0 }]}>הקישורים שיצרת</Text>
        {links.length > 0 ? <Text style={s.linksCount}>{links.length}</Text> : null}
      </View>
      {links.length === 0 ? (
        <Card><Text style={s.empty}>אין עדיין</Text></Card>
      ) : links.map((l) => {
        const ic = sourceIcon(String(l.source ?? ''));
        const url = String(l.url ?? buildAdLink(String(l.source), l.campaign as string, l.gameId as string));
        return (
          <Card key={l.id} style={s.linkRow}>
            <View style={[s.linkIcon, { backgroundColor: ic.tint + '22' }]}><Ionicons name={ic.name} size={18} color={ic.tint} /></View>
            {/* tappable body → per-link funnel */}
            <Pressable style={s.linkBody} onPress={() => openDetail(l)} hitSlop={4}>
              <Text style={s.linkName} numberOfLines={1}>{String(l.name ?? l.source ?? '—')}</Text>
              <Text style={s.linkSub} numberOfLines={1}>👆 {Number(l.clicks ?? 0)} פתיחות{l.campaign ? ` · ${l.campaign}` : ''}{l.gameId ? ' · 🎯' : ''}</Text>
            </Pressable>
            {/* actions */}
            <Pressable style={s.linkAct} onPress={() => share(url)} hitSlop={6}><Ionicons name="share-social-outline" size={19} color={colors.primary} /></Pressable>
            <Pressable style={s.linkAct} onPress={() => onDelete(l)} hitSlop={6}><Ionicons name="trash-outline" size={18} color={colors.red} /></Pressable>
          </Card>
        );
      })}

      {/* per-link detail funnel */}
      <Modal visible={!!detailLink} transparent animationType="slide" onRequestClose={closeDetail}>
        <View style={s.dBackdrop}>
          <View style={s.dSheet}>
            <View style={s.dHead}>
              <Pressable onPress={closeDetail} hitSlop={10}><Ionicons name="close" size={24} color={colors.textSoft} /></Pressable>
              <Text style={s.dTitle} numberOfLines={1}>{String(detailLink?.name ?? detailLink?.source ?? '')}</Text>
            </View>
            <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingBottom: 8 }}>
            {statsError ? (
              <View style={{ gap: 12, paddingVertical: 20 }}>
                <Text style={s.empty}>לא ניתן לטעון את נתוני הקישור. המספרים אינם זמינים כרגע.</Text>
                <Pressable style={s.btn} onPress={() => detailLink && openDetail(detailLink)} accessibilityRole="button">
                  <Text style={s.btnTxt}>נסה שוב</Text>
                </Pressable>
              </View>
            ) : loadingStats || !stats ? (
              <ActivityIndicator color={colors.primary} style={{ paddingVertical: 30 }} />
            ) : (
              <>
                <FunnelRow icon="hand-left" tint="#3B82F6" label="פתיחות של הקישור" value={stats.clicks} />
                <FunnelRow icon="people" tint="#22C55E" label="חשבונות שיוחסו לקישור" value={stats.attributedAccounts} />
                <Text style={s.dNote}>פתיחות עשויות לחזור על עצמן; הן אינן אנשים ייחודיים או הורדות מהחנות. הנתונים הבאים הם מצבם הנוכחי של החשבונות שיוחסו לקישור.</Text>
                <FunnelRow icon="person-add" tint="#06B6D4" label="השלימו הרשמה" value={stats.signups} of={stats.attributedAccounts} />
                <View style={s.provRow}>
                  <View style={s.provCell}><Ionicons name="logo-google" size={15} color="#EA4335" /><Text style={s.provTxt}>{stats.google} Google</Text></View>
                  <View style={s.provCell}><Ionicons name="logo-apple" size={15} color={colors.textSoft} /><Text style={s.provTxt}>{stats.apple} Apple</Text></View>
                </View>
                <FunnelRow icon="football" tint="#F59E0B" label="הצטרפו למשחק" value={stats.joined} of={stats.attributedAccounts} />
                <FunnelRow icon="add-circle" tint="#A855F7" label="יצרו משחק" value={stats.created} of={stats.attributedAccounts} />
                {stats.attributedAccounts === 0 && stats.clicks > 0 ? (
                  <Text style={s.dNote}>עדיין אין חשבונות עם שיוך מפורש לקישור הזה. שיוכים היסטוריים למקור בלבד מופיעים בדוח לפי מקור.</Text>
                ) : null}
              </>
            )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

function FunnelRow({ icon, tint, label, value, of }: { icon: keyof typeof Ionicons.glyphMap; tint: string; label: string; value: number; of?: number }) {
  const pctTxt = of === undefined ? null : accountPercentage(value, of);
  return (
    <View style={fr.row}>
      <View style={[fr.icon, { backgroundColor: tint + '22' }]}><Ionicons name={icon} size={18} color={tint} /></View>
      <Text style={fr.label}>{label}</Text>
      {pctTxt ? <Text style={fr.pct}>{pctTxt}</Text> : null}
      <Text style={fr.val}>{value.toLocaleString()}</Text>
    </View>
  );
}
const fr = StyleSheet.create({
  row: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  icon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  label: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '600', textAlign: 'right' },
  pct: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  val: { color: colors.text, fontSize: 20, fontWeight: '900', minWidth: 44, textAlign: 'left' },
});

const s = StyleSheet.create({
  section: { color: colors.text, fontSize: 15, fontWeight: '800', textAlign: 'right', marginTop: 12, marginBottom: 6 },
  input: { color: colors.text, fontSize: 14, textAlign: 'right', backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 10 },
  miniLbl: { color: colors.textMuted, fontSize: 12, fontWeight: '700', textAlign: 'right', marginTop: 2 },
  urlBox: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 11 },
  urlTxt: { flex: 1, color: colors.primary, fontSize: 12, textAlign: 'left', writingDirection: 'ltr' },
  btn: { flexDirection: 'row-reverse', gap: 8, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  btnTxt: { color: '#fff', fontSize: 15, fontWeight: '800' },
  empty: { color: colors.textMuted, textAlign: 'center', paddingVertical: 12 },
  dBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  dSheet: { maxHeight: '85%', backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 30 },
  dHead: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, marginBottom: 4 },
  dTitle: { flex: 1, color: colors.text, fontSize: 18, fontWeight: '800', textAlign: 'right', marginRight: 12 },
  dNote: { color: colors.textMuted, fontSize: 12, textAlign: 'right', marginTop: 12, lineHeight: 18 },
  provRow: { flexDirection: 'row-reverse', gap: 10, paddingVertical: 8, paddingRight: 48 },
  provCell: { flexDirection: 'row-reverse', alignItems: 'center', gap: 5, backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 5 },
  provTxt: { color: colors.textSoft, fontSize: 12, fontWeight: '600' },
  trow: { flexDirection: 'row-reverse', alignItems: 'center', paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  thead: { borderBottomWidth: 1 },
  th: { flex: 1, color: colors.textSoft, fontSize: 11, fontWeight: '700', textAlign: 'center' },
  td: { flex: 1, color: colors.text, fontSize: 13, fontWeight: '600', textAlign: 'center' },
  tdNum: { fontWeight: '800' },
  cSrc: { flex: 1.4, textAlign: 'right' },
  cConv: { flex: 0.9 },
  srcCell: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6 },
  srcName: { color: colors.text, fontSize: 13, fontWeight: '600', textAlign: 'right', flexShrink: 1 },
  note: { color: colors.textMuted, fontSize: 12, textAlign: 'center', marginTop: 10 },
  linksHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginTop: 12, marginBottom: 6 },
  linksCount: { color: colors.textMuted, fontSize: 12, fontWeight: '800', backgroundColor: colors.surfaceAlt, borderRadius: 999, minWidth: 22, textAlign: 'center', paddingHorizontal: 7, paddingVertical: 1, overflow: 'hidden' },
  linkRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  linkBody: { flex: 1 },
  linkAct: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceAlt },
  linkIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  linkName: { color: colors.text, fontSize: 14, fontWeight: '700', textAlign: 'right' },
  linkSub: { color: colors.textMuted, fontSize: 12, textAlign: 'right', marginTop: 1 },
});
