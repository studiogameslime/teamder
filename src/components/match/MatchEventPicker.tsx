import React, {useEffect, useRef} from 'react';
import {Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import Svg, {Circle, Path} from 'react-native-svg';
import {SafeModal} from '@/components/SafeModal';
import {RTL_LABEL_ALIGN} from '@/theme';
import {overlaySurfaces} from '@/theme/overlays';
import {TeamShirtIllustration} from './TeamShirt';
import {TEAM_PALETTE} from '@/utils/teamIdentity';
import {lightHaptic} from '@/utils/haptics';

export type MatchEventChoice = 'A' | 'B' | 'penalty';
export interface MatchEventTeam {name: string; color: string}

/** Selects an existing entry flow; opening or dismissing never writes an event. */
export function MatchEventPicker({visible, teams, onClose, onSelect}: {
  visible: boolean;
  teams: [MatchEventTeam, MatchEventTeam];
  onClose: () => void;
  onSelect: (choice: MatchEventChoice) => void;
}) {
  const {height, width, fontScale} = useWindowDimensions();
  const compact = height < 700 || width < 350 || fontScale > 1.2;
  const pending = useRef<MatchEventChoice | null>(null);
  const selecting = useRef(false);
  useEffect(() => {if (visible) selecting.current = false;}, [visible]);
  const finishSelection = () => {
    const choice = pending.current;
    pending.current = null;
    if (choice) onSelect(choice);
  };
  const close = () => {pending.current = null; onClose();};
  const select = (choice: MatchEventChoice) => {
    if (selecting.current) return;
    selecting.current = true;
    lightHaptic();
    pending.current = choice;
    onClose();
    // iOS must finish dismissing this native window before opening the next.
    if (Platform.OS !== 'ios') finishSelection();
  };
  return <SafeModal visible={visible} transparent animationType="slide" onRequestClose={close} onDismiss={finishSelection}>
    <View style={s.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityRole="button" accessibilityLabel="סגירת בחירת אירוע"/>
      <View style={[s.sheet, {maxHeight: height * .9}, compact && s.compactSheet]} accessibilityViewIsModal>
        <View style={s.handle}/>
        <View style={s.header}>
          <Text style={s.title} accessibilityRole="header">הוסף אירוע</Text>
          <Pressable onPress={close} style={s.close} accessibilityRole="button" accessibilityLabel="סגירה"><Ionicons name="close" size={22} color="#0F172A"/></Pressable>
        </View>
        <ScrollView contentContainerStyle={s.content}>
          <View style={s.teams}>
            {teams.map((team, index) => {
              const label = `גול ל${team.name.startsWith('ה') ? team.name.slice(1) : team.name}`;
              const palette = TEAM_PALETTE.find(entry => entry.hex.toUpperCase() === team.color.toUpperCase());
              const accent = palette?.key === 'white' ? '#64748B' : palette?.key === 'yellow' ? '#A16207' : team.color;
              return <Pressable key={index} accessibilityRole="button" accessibilityLabel={label} onPress={() => select(index === 0 ? 'A' : 'B')} style={({pressed}) => [s.tile, compact && s.compactTile, pressed && s.pressed]}>
                <>
                <View style={[s.teamAccent, {backgroundColor: accent}]}/>
                <View style={[s.teamIcon, compact && s.compactIcon]}>
                  <TeamShirtIllustration color={team.color} width={compact ? 42 : 48}/>
                </View>
                <View style={s.goalLabelRow}>
                  <Text style={[s.label, compact && s.compactLabel, {color: '#0F172A'}]}>{label}</Text>
                  <Svg width={24} height={24} viewBox="0 0 24 24" accessible={false}>
                    <Path d="M12 5V19 M5 12H19" stroke={accent} strokeWidth={3.4} strokeLinecap="round"/>
                  </Svg>
                </View>
                </>
              </Pressable>;
            })}
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="פנדל" onPress={() => select('penalty')} style={({pressed}) => [s.penalty, pressed && s.pressed]}>
            <Text style={s.penaltyLabel}>פנדל</Text>
            <PenaltyGoalIcon/>
          </Pressable>
        </ScrollView>
      </View>
    </View>
  </SafeModal>;
}

function PenaltyGoalIcon() {
  return <Svg width={26} height={26} viewBox="0 0 28 28" accessible={false}>
    <Path d="M4 20V5H24V20H21V8H7V20Z" fill="none" stroke="#174C38" strokeWidth={1.5} strokeLinejoin="round"/>
    <Circle cx={14} cy={23} r={1.4} fill="#174C38"/>
  </Svg>;
}

const s = StyleSheet.create({
  backdrop: {flex: 1, justifyContent: 'flex-end', backgroundColor: '#0F172A66'},
  sheet: {...overlaySurfaces.sheet, backgroundColor: '#F9FAFC', padding: 16, paddingBottom: 16},
  compactSheet: {padding: 12, paddingBottom: 14},
  handle: {alignSelf: 'center', width: 36, height: 4, borderRadius: 3, backgroundColor: '#CBD5E1', marginBottom: 6},
  header: {flexDirection: 'row', alignItems: 'center', marginBottom: 8},
  title: {flex: 1, color: '#0F172A', fontSize: 20, fontWeight: '700', textAlign: RTL_LABEL_ALIGN},
  close: {width: 44, height: 44, alignItems: 'center', justifyContent: 'center'},
  content: {gap: 12, padding: 5, paddingBottom: 8},
  teams: {flexDirection: 'row', alignItems: 'stretch', gap: 12},
  tile: {flex: 1, minWidth: 0, minHeight: 152, paddingHorizontal: 12, paddingVertical: 14, gap: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', borderRadius: 18, borderWidth: 1, borderColor: '#E8EDF3', shadowColor: '#64748B', shadowOffset: {width: 0, height: 4}, shadowOpacity: .1, shadowRadius: 10, elevation: 3},
  compactTile: {minHeight: 136, paddingHorizontal: 10, paddingVertical: 12, gap: 10},
  teamAccent: {width: 30, height: 3, borderRadius: 2},
  teamIcon: {width: 48, height: 52, alignItems: 'center', justifyContent: 'center', shadowColor: '#64748B', shadowOffset: {width: 0, height: 3}, shadowOpacity: .12, shadowRadius: 4},
  compactIcon: {width: 42, height: 46},
  goalLabelRow: {alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6},
  label: {flexShrink: 1, minWidth: 0, fontSize: 15, fontWeight: '800', textAlign: 'center'},
  compactLabel: {fontSize: 14},
  penalty: {minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#FBFDFC', borderWidth: 1, borderColor: '#D3E2D6'},
  penaltyLabel: {color: '#174C38', fontSize: 17, fontWeight: '700', textAlign: 'center'},
  pressed: {opacity: .8, backgroundColor: '#F1F5F9', transform: [{scale: .985}]},
});
