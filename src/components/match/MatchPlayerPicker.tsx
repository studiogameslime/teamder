import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { UserAvatar } from '@/components/UserAvatar';
import { RTL_LABEL_ALIGN } from '@/theme';
import { TeamShirtIllustration } from './TeamShirt';
import type { RosterMember } from './rotationView';

export interface MatchPlayerPickerProps {
  players: RosterMember[];
  onSelect: (id: string) => void;
  selectedId?: string | null;
  disabledIds?: readonly string[];
  disabled?: boolean;
  color: string;
  ink?: string;
  title?: string;
  teamLabel?: string;
}

/** One stable roster: changing role never removes a cell or moves its neighbours. */
export function MatchPlayerPicker({ players, onSelect, selectedId, disabledIds = [], disabled, color, ink = '#12234D', title, teamLabel }: MatchPlayerPickerProps) {
  const { width, fontScale } = useWindowDimensions();
  const [availableWidth, setAvailableWidth] = useState(width - 48);
  const columns = fontScale > 1.3 ? 3 : width < 350 ? 4 : 5;
  const cellWidth = Math.floor(availableWidth / columns);
  return <View style={s.container} onLayout={event => setAvailableWidth(event.nativeEvent.layout.width)}>
    {(title || teamLabel) && <View style={[s.heading, { backgroundColor: color + '13' }]}>
      <View style={s.textBlock}>{title && <Text style={[s.title, { color: ink }]}>{title}</Text>}{teamLabel && <Text style={[s.team, { color: ink }]}>{teamLabel}</Text>}</View>
      <TeamShirtIllustration color={color} width={25}/>
    </View>}
    <ScrollView style={[s.scroll,{minHeight:Math.max(90,82*Math.min(fontScale,1.6))}]} contentContainerStyle={s.grid} nestedScrollEnabled showsVerticalScrollIndicator={players.length > columns}>
      {players.length === 0 && <Text style={s.empty}>אין שחקנים לבחירה בהרכב הזה</Text>}
      {players.map(player => {
        const unavailable = !!disabled || disabledIds.includes(player.id);
        const selected = selectedId === player.id;
        return <Pressable key={player.id} accessibilityRole="button" accessibilityLabel={player.name}
          accessibilityState={{ disabled: unavailable, selected }} disabled={unavailable}
          onPress={() => onSelect(player.id)}
          style={[s.player, { width: cellWidth }, selected && { backgroundColor: color + '16' }, unavailable && s.unavailable]}>
          <View style={[s.avatar, selected && { borderColor: ink }]}><UserAvatar user={player} size={46}/></View>
          <Text style={s.name} numberOfLines={2}>{player.name}</Text>
          {player.isFiller && <Text style={s.filler}>משלים</Text>}
        </Pressable>;
      })}
    </ScrollView>
  </View>;
}
const s = StyleSheet.create({
  container: { flexShrink: 1, minHeight: 98, gap: 5 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 10 },
  textBlock: { flex: 1, minWidth: 0 }, title: { fontSize: 16, fontWeight: '800', textAlign: RTL_LABEL_ALIGN }, team: { fontSize: 12, fontWeight: '600', textAlign: RTL_LABEL_ALIGN },
  scroll: { flexShrink: 1 }, grid: { flexDirection: 'row', flexWrap: 'wrap', paddingVertical: 3, rowGap: 4 },
  player: { alignItems: 'center', paddingHorizontal: 3, paddingVertical: 5, minHeight: 86, gap: 3, borderRadius: 12 },
  avatar: { borderWidth: 1.5, borderColor: 'transparent', borderRadius: 27, padding: 2 },
  name: { color: '#12234D', fontSize: 12, lineHeight: 16, fontWeight: '700', textAlign: 'center', minHeight: 16 },
  filler: { color: '#64748B', fontSize: 10, textAlign: 'center' }, unavailable: { opacity: 0.38 },
  empty: { color: '#64748B', fontSize: 14, textAlign: 'center', paddingVertical: 16, width: '100%' },
});
