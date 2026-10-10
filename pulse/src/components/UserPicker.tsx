import React, { useEffect, useState } from 'react';
import {
  Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius } from '../theme';
import { fetchUsers } from '../services/firebase';
import type { AppUser } from '../types';

export function UserPicker({
  visible, onClose, onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (u: AppUser) => void;
}) {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible || users.length) return;
    setLoading(true);
    fetchUsers()
      .then((u) => setUsers(u.filter((x) => !x.deleted)))
      .catch(() => setUsers([]))
      .finally(() => setLoading(false));
  }, [visible]);

  const term = q.trim().toLowerCase();
  const list = users
    .filter((u) => !term || u.name.toLowerCase().includes(term) || (u.email ?? '').toLowerCase().includes(term))
    .slice(0, 60);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.sheet}>
          <SafeAreaView edges={['bottom']}>
            <View style={s.head}>
              <Pressable onPress={onClose} hitSlop={10}><Ionicons name="close" size={24} color={colors.textSoft} /></Pressable>
              <Text style={s.title}>בחר משתמש לטסט</Text>
            </View>
            <TextInput
              style={s.search}
              placeholder="חיפוש לפי שם או אימייל…"
              placeholderTextColor={colors.textMuted}
              value={q}
              onChangeText={setQ}
              autoFocus
            />
            {loading ? (
              <ActivityIndicator color={colors.primary} style={{ paddingVertical: 30 }} />
            ) : (
              <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
                {list.length === 0 ? (
                  <Text style={s.empty}>לא נמצאו משתמשים</Text>
                ) : list.map((u) => (
                  <Pressable key={u.id} style={s.row} onPress={() => { onPick(u); onClose(); }}>
                    <View style={s.av}><Text style={s.avTxt}>{(u.name || '?').slice(0, 1)}</Text></View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.name} numberOfLines={1}>{u.name || 'ללא שם'}</Text>
                      {u.email ? <Text style={s.email} numberOfLines={1}>{u.email}</Text> : null}
                    </View>
                    {u.hasPush ? <Ionicons name="notifications" size={16} color={colors.green} /> : <Ionicons name="notifications-off" size={16} color={colors.textMuted} />}
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </SafeAreaView>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 16, paddingTop: 10 },
  head: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 },
  title: { color: colors.text, fontSize: 18, fontWeight: '800' },
  search: { color: colors.text, fontSize: 15, textAlign: 'right', backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 11, marginBottom: 8 },
  empty: { color: colors.textMuted, textAlign: 'center', paddingVertical: 24 },
  row: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  av: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  avTxt: { color: '#fff', fontSize: 16, fontWeight: '800' },
  name: { color: colors.text, fontSize: 15, fontWeight: '600', textAlign: 'right' },
  email: { color: colors.textMuted, fontSize: 12, textAlign: 'right', marginTop: 1 },
});
