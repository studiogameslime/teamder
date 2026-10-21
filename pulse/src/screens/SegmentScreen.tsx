import { observeCaughtError } from '../services/errorObservation';
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { RtlTextInput as TextInput } from '../components/RtlTextInput';
import { Ionicons } from '@expo/vector-icons';
import { SectionTabs, Panel, Screen, Card } from '../components/ui';
import { Dropdown, type Opt } from '../components/Dropdown';
import { RTL_LABEL_ALIGN, colors, radius  } from '../theme';
import { fetchGroupMemberSet, fetchUsers, fetchUsersWithAuth } from '../services/firebase';
import {
  matchUser, segmentNeedsAuth, FIELDS, OPS, OPS_FOR_TYPE, fieldDef,
  type SegmentRule, type SegmentDef, type FieldKey, type Op,
} from '../services/segments';
import { createSegment, listSegments, deleteSegment, type SavedSegment } from '../services/savedSegments';

const FIELD_OPTS: Opt[] = FIELDS.map((f) => ({ value: f.key, label: f.label }));

function defaultValue(key: FieldKey): string {
  const t = fieldDef(key).type;
  if (t === 'bool') return 'true';
  if (t === 'enum') return fieldDef(key).options?.[0].value ?? '';
  return '';
}
function valueOpts(key: FieldKey): Opt[] {
  const fd = fieldDef(key);
  if (fd.type === 'bool') return [{ value: 'true', label: 'כן' }, { value: 'false', label: 'לא' }];
  return fd.options ?? [];
}

export function SegmentScreen() {
  const [section, setSection] = useState('saved');
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [combinator, setCombinator] = useState<'all' | 'any'>('all');
  const [rules, setRules] = useState<SegmentRule[]>([{ field: 'attended', op: 'gt', value: '' }]);
  const [count, setCount] = useState<number | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<SavedSegment[]>([]);

  const def: SegmentDef = { combinator, rules };
  const reloadSaved = async () => setSaved(await listSegments().catch((caughtErrora7c2a11689: unknown) => { observeCaughtError(caughtErrora7c2a11689, {"source":"pulse/src/screens/SegmentScreen.tsx","handler":"reloadSaved","site":"SegmentScreen:a7c2a11689"}); return []; }));
  useEffect(() => { reloadSaved(); }, []);

  const update = (i: number, patch: Partial<SegmentRule>) => {
    setCount(null);
    setRules((cur) => cur.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };
  const changeField = (i: number, key: FieldKey) => {
    const t = fieldDef(key).type;
    update(i, { field: key, op: OPS_FOR_TYPE[t][0], value: defaultValue(key) });
  };
  const addRule = () => { setCount(null); setRules((c) => [...c, { field: 'attended', op: 'gt', value: '' }]); };
  const removeAt = (i: number) => { setCount(null); setRules((c) => c.filter((_, idx) => idx !== i)); };
  const reset = () => { setName(''); setRules([{ field: 'attended', op: 'gt', value: '' }]); setCount(null); };

  const calc = async (): Promise<number | null> => {
    setBusy(true); setError('');
    try {
      const needGroup = rules.some((r) => r.field === 'inGroup');
      const [users, members] = await Promise.all([
        segmentNeedsAuth(def) ? fetchUsersWithAuth() : fetchUsers(),
        needGroup ? fetchGroupMemberSet() : Promise.resolve(new Set<string>()),
      ]);
      const now = Date.now();
      const real = users.filter((u) => !u.isTest && !u.deleted);
      const n = real.filter((u) => matchUser(u, def, members, now)).length;
      setCount(n); setTotal(real.length);
      return n;
    } catch (caughtError8edb7cbb46) {
    observeCaughtError(caughtError8edb7cbb46, {"source":"pulse/src/screens/SegmentScreen.tsx","handler":"calc","site":"SegmentScreen:8edb7cbb46"}); setError('חישוב הקהל נכשל. נסו שוב.'); return null; } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!name.trim()) { Alert.alert('חסר', 'תן שם לסגמנט'); return; }
    const valid = rules.filter((r) => (fieldDef(r.field).type === 'number' ? String(r.value).trim() !== '' : true));
    if (valid.length === 0) { Alert.alert('חסר', 'הוסף לפחות תנאי אחד'); return; }
    setSaving(true);
    try {
      const audience = count ?? (await calc());
      if (audience === null) return;
      const ok = await createSegment(name.trim(), { combinator, rules: valid }, audience);
      if (ok) { Alert.alert('נשמר', `הסגמנט "${name.trim()}" נשמר ✓`); reset(); setSection('saved'); await reloadSaved(); }
      else Alert.alert('שגיאה', 'שמירת הסגמנט נכשלה');
    } finally { setSaving(false); }
  };

  const onDelete = (seg: SavedSegment) => {
    Alert.alert('מחיקה', `למחוק את "${seg.name}"?`, [
      { text: 'ביטול', style: 'cancel' },
      { text: 'מחק', style: 'destructive', onPress: async () => { await deleteSegment(seg.id); await reloadSaved(); } },
    ]);
  };

  const pctOfAll = count !== null && total ? Math.round((count / total) * 100) : null;

  return (
    <Screen
      title="קהלים"
      subtitle="בנה קהל של משתמשים לפי תנאים"
      right={(
        <View style={s.headIcons}>

          <Pressable accessibilityLabel="קהל חדש" onPress={() => { reset(); setSection('build'); }} hitSlop={8}><Ionicons name="add" size={26} color={colors.primary} /></Pressable>
        </View>
      )}
    >
      <SectionTabs value={section} onChange={setSection} items={[{key:'saved',label:'קהלים שמורים'}, {key:'build',label:'בניית קהל'}]} />
      {error ? <Text style={{ direction: 'rtl' as const,color:colors.red,textAlign: RTL_LABEL_ALIGN}}>{error}</Text> : null}
      <Panel active={section === 'build'}>
      {/* builder */}
      <Text style={s.section}>בניית קהל</Text>
      <Card style={{ gap: 10 }}>
        {rules.map((r, i) => {
          const fd = fieldDef(r.field);
          const ops = OPS_FOR_TYPE[fd.type];
          return (
            <View key={i}>
              {i > 0 ? (
                <Pressable style={s.connector} onPress={() => { setCombinator((c) => (c === 'all' ? 'any' : 'all')); setCount(null); }}>
                  <Text style={s.connTxt}>{combinator === 'any' ? 'או (OR)' : 'וגם (AND)'}</Text>
                </Pressable>
              ) : null}
              <View style={s.block}>
                <View style={s.rowA}>
                  <Dropdown flex={1} options={FIELD_OPTS} value={r.field} onSelect={(v) => changeField(i, v as FieldKey)} />
                  <Pressable onPress={() => removeAt(i)} hitSlop={8} style={s.trash}>
                    <Ionicons name="trash-outline" size={18} color={colors.textMuted} />
                  </Pressable>
                </View>
                <View style={s.rowB}>
                  {fd.type === 'number' || fd.type === 'text' ? (
                    <TextInput
                      style={s.valInput}
                      keyboardType={fd.type === 'number' ? 'number-pad' : 'default'}
                      placeholder="ערך" placeholderTextColor={colors.textMuted}
                      value={String(r.value)} onChangeText={(t) => update(i, { value: t })}
                    />
                  ) : (
                    <View style={{ flex: 1 }}>
                      <Dropdown flex={1} options={valueOpts(r.field)} value={String(r.value)} onSelect={(v) => update(i, { value: v })} />
                    </View>
                  )}
                  {fd.type !== 'bool' ? (
                    <View style={{ flex: 1 }}>
                      <Dropdown flex={1} options={ops.map((o) => ({ value: o, label: OPS.find((x) => x.key === o)!.label }))} value={r.op} onSelect={(v) => update(i, { op: v as Op })} />
                    </View>
                  ) : <View style={{ flex: 1 }} />}
                </View>
              </View>
            </View>
          );
        })}

        <Pressable style={s.addRow} onPress={addRule}>
          <Ionicons name="add" size={18} color={colors.primary} />
          <Text style={s.addTxt}>הוסף תנאי</Text>
        </Pressable>

        <Pressable style={[s.calcBtn, busy && { opacity: 0.6 }]} onPress={() => calc()} disabled={busy}>
          {busy ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={s.calcTxt}>חשב קהל</Text>}
        </Pressable>
      </Card>

      {/* audience */}
      <Card style={{ alignItems: 'center', gap: 6, paddingVertical: 18 }}>
        <View style={s.audRow}>
          <Text style={s.bigNum}>{count !== null ? count.toLocaleString() : '—'}</Text>
          <Ionicons name="people" size={24} color={colors.primary} />
        </View>
        <Text style={s.bigLbl}>משתמשים מתאימים</Text>
        {pctOfAll !== null ? <Text style={s.audSub}>{pctOfAll}% מכלל המשתמשים</Text> : null}
        <TextInput style={s.name} placeholder="שם הקהל" placeholderTextColor={colors.textMuted} value={name} onChangeText={setName} />
        <Pressable style={[s.saveBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
          {saving ? <ActivityIndicator color={colors.primary} /> : <Text style={s.saveTxt}>שמור קהל</Text>}
        </Pressable>
      </Card>

      </Panel>
      <Panel active={section === 'saved'}>
      {/* saved */}
      <Text style={s.section}>הקהלים השמורים</Text>
      {saved.length === 0 ? (
        <Card><Text style={s.empty}>אין עדיין — בחרו בבניית קהל כדי להתחיל</Text></Card>
      ) : saved.map((seg) => (
        <Card key={seg.id} style={s.savedRow}>
          <View style={s.savedIcon}><Ionicons name="people" size={18} color={colors.primary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={s.savedName} numberOfLines={1}>{seg.name}</Text>
            <Text style={s.savedSub} numberOfLines={1}>{seg.audience != null ? `${seg.audience.toLocaleString()} משתמשים` : '—'}</Text>
          </View>
          <Pressable onPress={() => onDelete(seg)} hitSlop={6}><Ionicons name="trash-outline" size={18} color={colors.red} /></Pressable>

        </Card>
      ))}
      </Panel>
    </Screen>
  );
}

const s = StyleSheet.create({
  headIcons: { flexDirection: 'row', direction: 'rtl' as const, alignItems: 'center', gap: 14 },
  section: { direction: 'rtl' as const, color: colors.text, fontSize: 16, fontWeight: '800', textAlign: RTL_LABEL_ALIGN, marginTop: 12, marginBottom: 6 },
  connector: { alignSelf: 'center', paddingVertical: 4, paddingHorizontal: 14, marginVertical: 2 },
  connTxt: { color: colors.primary, fontSize: 12, fontWeight: '800' },
  block: { gap: 8 },
  rowA: { flexDirection: 'row', direction: 'rtl' as const, alignItems: 'center', gap: 8 },
  rowB: { flexDirection: 'row', direction: 'rtl' as const, alignItems: 'center', gap: 8 },
  trash: { padding: 4 },
  valInput: { direction: 'rtl' as const, flex: 1, color: colors.text, fontSize: 14, fontWeight: '600', textAlign: RTL_LABEL_ALIGN, backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 11, paddingVertical: 10 },
  addRow: { flexDirection: 'row', direction: 'rtl' as const, alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed' },
  addTxt: { color: colors.primary, fontSize: 14, fontWeight: '800' },
  calcBtn: { backgroundColor: colors.primary, borderRadius: radius.sm, paddingVertical: 12, alignItems: 'center' },
  calcTxt: { color: colors.onPrimary, fontSize: 15, fontWeight: '800' },
  audRow: { flexDirection: 'row', direction: 'rtl' as const, alignItems: 'center', gap: 10 },
  bigNum: { color: colors.text, fontSize: 34, fontWeight: '900' },
  bigLbl: { color: colors.textSoft, fontSize: 14, fontWeight: '600' },
  audSub: { color: colors.textMuted, fontSize: 12 },
  name: { direction: 'rtl' as const, alignSelf: 'stretch', color: colors.text, fontSize: 15, fontWeight: '600', textAlign: RTL_LABEL_ALIGN, backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 10, marginTop: 6 },
  saveBtn: { alignSelf: 'stretch', backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.primary, borderRadius: radius.sm, paddingVertical: 12, alignItems: 'center' },
  saveTxt: { color: colors.primary, fontSize: 15, fontWeight: '800' },
  empty: { color: colors.textMuted, textAlign: 'center', paddingVertical: 14 },
  savedRow: { flexDirection: 'row', direction: 'rtl' as const, alignItems: 'center', gap: 12 },
  savedIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.primarySoft + '44', alignItems: 'center', justifyContent: 'center' },
  savedName: { direction: 'rtl' as const, color: colors.text, fontSize: 15, fontWeight: '700', textAlign: RTL_LABEL_ALIGN },
  savedSub: { direction: 'rtl' as const, color: colors.textMuted, fontSize: 12, textAlign: RTL_LABEL_ALIGN, marginTop: 1 },
});
