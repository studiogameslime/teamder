// DEV + QA_ROUTES + FORCE_MOCK only. Real UI components, local state, no service writes.
import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { ManageEquipmentSheet } from '@/components/community/ManageEquipmentSheet';
import { EquipmentHandoffModal } from '@/components/match/EquipmentHandoffModal';
import { FillerInterestsSection } from '@/components/match/FillerInterestsSection';
import { TeamScore } from '@/components/match/TeamScore';
import { RegistrationSuccessAnimation } from '@/components/anim/game/RegistrationSuccessAnimation';
import { UpcomingRoundCard } from '@/components/home/HomeRoundCards';
import { deriveRoundState } from '@/utils/homeRoundState';
import { useGameStore } from '@/store/gameStore';
import { useUserStore } from '@/store/userStore';
import { mockGame } from '@/data/mockData';
import { colors, spacing } from '@/theme';

export function MotionPreview({ onClose }: { onClose: () => void }) {
  const me = useUserStore(s => s.currentUser);
  const playerMap = useGameStore(s => s.players);
  const [manageEquipment, setManageEquipment] = useState(false);
  const [equipment, setEquipment] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [added, setAdded] = useState(false);
  const players = Object.values(playerMap).slice(0, 4).map(p => ({ id: p.id, name: p.displayName ?? '', avatarId: p.avatarId, photoUrl: p.photoUrl }));
  const base = mockGame;
  const game = base && me ? { ...base, status: 'open' as const, startsAt: Date.now() + 86400000, players: base.players.filter(id => id !== me.id), waitlist: waiting ? [me.id] : [], pending: [] } : null;
  const button = (title: string, action: () => void) => <Pressable onPress={action} style={{ backgroundColor: colors.primary, padding: 14, borderRadius: 14 }}><Text style={{ color: '#FFF', textAlign: 'center', fontWeight: '700' }}>{title}</Text></Pressable>;
  if (!__DEV__ || process.env.EXPO_PUBLIC_QA_ROUTES !== '1' || process.env.EXPO_PUBLIC_FOOTY_FORCE_MOCK !== '1') return null;
  return <Modal visible onRequestClose={onClose}>
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: 38 }}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
        <Text style={{ textAlign: 'center', color: '#B45309' }}>בדיקת הנפשות — נתונים מקומיים בלבד</Text>
        {button('סגור', onClose)}
        {button('בחירת מחזיקי ציוד', () => setEquipment(true))}
        <FillerInterestsSection gameId="gv2-live" isAdmin acceptsFillers />
        {button('הצטרפות לרשימת המתנה', () => setWaiting(v => !v))}
        {game && me ? <UpcomingRoundCard game={game} state={deriveRoundState(game, me.id)} actions={{ onDetails: () => {}, onJoin: () => {}, onSummary: () => {}, onCreate: () => {}, onFind: () => {} }} busy={false} now={Date.now()} /> : null}
        {button('הוסף שחקן להרכב', () => setAdded(v => !v))}
        <TeamScore teamIdx={0} teams={[]} roster={players.slice(0, added ? 3 : 2).map(p => ({ ...p, isFiller: p.id === players[2]?.id }))} wins={0} align="right" variant="list" block />
        {button('הנפשת הרשמה מאושרת', () => setRegistered(true))}
        {button('ניהול ציוד לשחקן', () => setManageEquipment(true))}
      </ScrollView>
      <RegistrationSuccessAnimation visible={registered} variant="registered" onComplete={() => setRegistered(false)} />
      <ManageEquipmentSheet visible={manageEquipment} playerName={me?.name ?? ''} initial={{ ball: false, jerseys: false }} saving={false} onClose={() => setManageEquipment(false)} onSave={() => setManageEquipment(false)} />
      <EquipmentHandoffModal visible={equipment} players={players} initial={{ ballHolderIds: [], jerseysHolderIds: [] }} onSave={() => setEquipment(false)} onSkip={() => setEquipment(false)} />
    </View>
  </Modal>;
}
