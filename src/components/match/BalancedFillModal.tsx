import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeModal } from '@/components/SafeModal';
import { UserAvatar } from '@/components/UserAvatar';
import { TeamShirtIllustration } from './TeamShirt';
import { ArrivalMotion } from '@/components/anim/ArrivalMotion';
import { RTL_LABEL_ALIGN } from '@/theme';
import { overlayTheme } from '@/theme/overlays';
import { fillComparisonText, type FillUsage } from '@/utils/balancedFill';
import { chooseFillPlayer, initialFillSelection } from '@/utils/fillSelection';

export interface FillDisplayPlayer {
  id: string; name: string; avatarId?: string; photoUrl?: string; homeLabel?: string;
}
type FillSide = { index: number; label: string; color: string; playerIds: string[]; members: FillDisplayPlayer[] };
export interface BalancedFillRequest {
  sides: [FillSide, FillSide];
  players: (FillDisplayPlayer & { homeLabel: string })[];
  capacity: number;
  ratings: Record<string, number>;
  usage: FillUsage;
  savedResult?: string;
  /** Both rosters are visible; only this side is editable in sequential flow. */
  editableSide?: 0 | 1;
  showComparison?: boolean;
  showUsage?: boolean;
  fillMode?: 'temporary' | 'permanent';
  keepClock?: boolean;
}

function RosterMember({ player, added = false }: { player: FillDisplayPlayer; added?: boolean }) {
  const [arrivalAt] = useState(Date.now);
  return <ArrivalMotion at={added ? arrivalAt : undefined} style={s.member}>
    <UserAvatar user={player} size={25}/>
    <View style={s.memberText}>
      <Text style={[s.memberName, added && s.addedName]} numberOfLines={2}>{player.name}</Text>
      {!!player.homeLabel && <Text style={s.origin} numberOfLines={1}>{`מ${player.homeLabel}`}</Text>}
    </View>
  </ArrivalMotion>;
}

export function BalancedFillModal({ request, onConfirm, onCancel, visible = true }: {
  visible?: boolean; request: BalancedFillRequest | null;
  onConfirm: (picks: [string[], string[]]) => void; onCancel: () => void;
}) {
  const { height, width, fontScale } = useWindowDimensions();
  const [selection, setSelection] = useState(() => initialFillSelection([0, 0], 1));
  const [details, setDetails] = useState(false);
  const [viewportHeight, setViewportHeight] = useState(height);
  const [bodyHeight, setBodyHeight] = useState(0);
  useEffect(() => {
    setSelection(initialFillSelection([request?.sides[0].playerIds.length ?? 0, request?.sides[1].playerIds.length ?? 0], request?.capacity ?? 1, request?.editableSide));
    setDetails(false);
  }, [request]);
  if (!request) return null;

  const { picks, editing } = selection;
  const counts = request.sides.map((side, i) => request.editableSide !== undefined && request.editableSide !== i ? 0 : Math.max(0, request.capacity - side.playerIds.length)) as [number, number];
  const selected = picks.flat();
  const required = Math.min(counts[0] + counts[1], request.players.length);
  const ready = selected.length === required && new Set(selected).size === selected.length && picks.every((ids, i) => ids.length <= counts[i]);
  const missing = counts[0] + counts[1] - selected.length;
  const remaining = required - selected.length;
  const otherSide = editing === 0 ? 1 : 0;
  const homeLabels = [...new Set(request.players.map(player => player.homeLabel))];
  const canShowDetails = request.showUsage !== false || request.showComparison !== false;
  const stacked = width < 350 || fontScale > 1.3;
  const compact = stacked || height < 680;
  // SafeModal owns the native insets. Measure its usable backdrop rather than
  // assuming the window height is all available to this separate native window.
  const sheetHeight = Math.max(1, Math.min(820, height, viewportHeight) - 12);
  const hasPicker = counts[editing] > 0;
  const rosterMinimum = Math.ceil(20 + 24 * fontScale + Math.max(25, 19 * fontScale + 2)
    + (request.savedResult ? 18 * fontScale + 6 : 0));
  const rosterHeight = hasPicker
    ? bodyHeight > 0
      ? Math.min(Math.max(0, bodyHeight - 6), Math.max(rosterMinimum, Math.floor((bodyHeight - 6) * (compact ? 0.32 : 0.45))))
      : rosterMinimum
    : undefined;
  const duration = request.fillMode === 'permanent' ? 'גם למשחקים הבאים' : request.editableSide !== undefined ? 'זמני · חזרה כשהמקור עולה או כשהקבוצה יוצאת' : 'למשחק הזה בלבד';
  const progress = missing === 0 ? (request.editableSide !== undefined ? 'הבחירה מוכנה לאישור' : 'ההרכבים מוכנים') : ready ? `${missing === 1 ? 'חסר שחקן אחד' : `חסרים ${missing} שחקנים`} · אין עוד משלימים פנויים` : remaining === 1 ? 'עוד שחקן אחד' : `עוד ${remaining} שחקנים`;

  return <SafeModal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
    <View style={s.backdrop} onLayout={({ nativeEvent }) => {
      const next = nativeEvent.layout.height;
      if (next > 0) setViewportHeight(previous => Math.abs(previous - next) < 1 ? previous : next);
    }}><View style={[s.sheet, { height: sheetHeight }, compact && s.compactSheet]}>
      <View style={s.heading}>
      <View style={s.handle}/>
      <View style={s.row}><Text style={[s.title, compact && s.compactTitle]}>משלימים הרכבים</Text><Pressable onPress={onCancel} accessibilityLabel="סגירה" accessibilityRole="button" hitSlop={10} style={s.close}><Ionicons name="close" size={24} color="#15274A"/></Pressable></View>
      <Text style={[s.subtitle, compact && s.compactSubtitle]}>{`${request.sides[0].label} מול ${request.sides[1].label}`}</Text>
      </View>
      <View style={s.body} testID="balanced-fill-body" onLayout={({ nativeEvent }) => {
        const next = nativeEvent.layout.height;
        if (next >= 0) setBodyHeight(previous => Math.abs(previous - next) < 1 ? previous : next);
      }}>
      <View testID="balanced-fill-roster-frame" collapsable={false}
        style={[s.rosterFrame, rosterHeight !== undefined && { flexGrow: 0, flexShrink: 0, height: rosterHeight }]}>
      <ScrollView testID="balanced-fill-rosters" nestedScrollEnabled keyboardShouldPersistTaps="handled"
        style={s.rosterScroll}
        contentContainerStyle={s.rosterContent}>
        {!!request.savedResult && <Text style={s.savedResult}>{request.savedResult}</Text>}
        <View style={[s.teams, stacked && s.teamsStacked]}>
          {request.sides.map((side, i) => {
            const canEdit = counts[i] > 0 && (request.editableSide === undefined || request.editableSide === i);
            const active = canEdit && editing === i;
            const size = side.playerIds.length + picks[i].length;
            const deficit = Math.max(0, request.capacity - size);
            return <Pressable key={side.index} disabled={!canEdit} onPress={() => setSelection(prev => ({ ...prev, editing: i as 0 | 1 }))}
              accessibilityRole={canEdit ? 'button' : undefined} accessibilityLabel={`${side.label}, ${size} מתוך ${request.capacity}, ${[...side.members.map(p => p.name), ...picks[i].map(id => request.players.find(p => p.id === id)?.name ?? '')].join(', ')}${canEdit ? ', בחירת משלימים' : ''}`}
              accessibilityState={{ selected: active, disabled: !canEdit }}
              style={[s.card, { backgroundColor: side.color + '09', borderColor: side.color + (active ? 'CC' : '35') }, active && s.activeCard]}>
              <View style={s.teamHeader}><TeamShirtIllustration color={side.color} width={20}/><Text style={s.sideTitle} numberOfLines={1}>{side.label}</Text><Text style={s.capacity}>{`⁦${size}/${request.capacity}⁩`}</Text></View>
              {side.members.map(player => <RosterMember key={player.id} player={player}/>)}
              {picks[i].map(id => { const player = request.players.find(candidate => candidate.id === id); return player ? <RosterMember key={id} player={player} added/> : null; })}
              {deficit > 0 && <Text style={s.deficit}>{deficit === 1 ? 'חסר שחקן אחד' : `חסרים ${deficit} שחקנים`}</Text>}
            </Pressable>;
          })}
        </View>
        {!hasPicker && <Text style={s.footnote}>{`${duration} · ${request.keepClock ? 'מצב השעון נשמר' : 'השעון יופעל בנפרד'}`}</Text>}
      </ScrollView>
      </View>
      {hasPicker && <ScrollView testID="balanced-fill-candidates" nestedScrollEnabled keyboardShouldPersistTaps="handled"
        style={s.candidates} contentContainerStyle={s.candidateContent}>
        <View style={s.pickerHeader}><View style={s.memberText}><Text style={s.pickerTitle}>{`משלימים לקבוצת ${request.sides[editing].label}`}</Text><Text style={s.small}>{homeLabels.length === 1 ? `מ${homeLabels[0]}` : 'מהקבוצות הממתינות'}</Text></View>
          {canShowDetails && <Pressable onPress={() => setDetails(value => !value)} accessibilityRole="button" accessibilityLabel={details ? 'הסתרת פירוט' : 'הצגת פירוט'} accessibilityState={{ expanded: details }} style={s.detailButton}><Text style={s.link}>פירוט</Text><Ionicons name={details ? 'chevron-up' : 'chevron-down'} size={14} color="#2865FF"/></Pressable>}
        </View>
          {request.players.map(player => {
            const on = picks[editing].includes(player.id);
            const other = picks[otherSide].includes(player.id);
            const disabled = other || (!on && counts[editing] > 1 && picks[editing].length >= counts[editing]);
            const usage = request.usage[player.id];
            return <Pressable key={player.id} disabled={disabled} onPress={() => setSelection(prev => chooseFillPlayer(prev, player.id, counts, request.players.map(p => p.id), request.editableSide !== undefined))}
              accessibilityRole="checkbox" accessibilityLabel={`${player.name}, מ${player.homeLabel}${other ? `, נבחר לקבוצת ${request.sides[otherSide].label}` : ''}`} accessibilityState={{ checked: on, disabled }}
              style={[s.player, on && s.playerOn, disabled && s.playerDisabled]}>
              <UserAvatar user={player} size={34}/><View style={s.memberText}><Text style={s.name} numberOfLines={2}>{player.name}</Text>
                {(other || homeLabels.length > 1) && <Text style={s.small}>{other ? `נבחר · ${request.sides[otherSide].label}` : `מ${player.homeLabel}`}</Text>}
                {details && request.showUsage !== false && <Text style={s.small}>{`במחזור: ${usage?.games ?? 0} משחקים שהסתיימו · ${usage?.fills ?? 0} השלמות`}</Text>}
              </View>{on && <Ionicons name="checkmark-circle" size={23} color="#2865FF"/>}
            </Pressable>;
          })}
          {details && request.showComparison !== false && missing === 0 && <Text style={s.small}>{fillComparisonText([[...request.sides[0].playerIds, ...picks[0]], [...request.sides[1].playerIds, ...picks[1]]], request.ratings)}</Text>}
          <Text style={s.footnote}>{`${duration} · ${request.keepClock ? 'מצב השעון נשמר' : 'השעון יופעל בנפרד'}`}</Text>
      </ScrollView>}
      </View>
      <View style={s.footer} testID="balanced-fill-footer">
        <Text style={[s.progress, ready && missing > 0 && s.shortage]} accessibilityLiveRegion="polite">{progress}</Text>
        <Pressable disabled={!ready} onPress={() => onConfirm(picks)} accessibilityRole="button" accessibilityState={{ disabled: !ready }} style={[s.confirm, !ready && s.confirmDisabled]}><Text style={[s.confirmText, !ready && s.confirmTextDisabled]}>{required < counts[0] + counts[1] ? 'אישור הרכבים חסרים' : request.editableSide !== undefined ? 'אישור ההרכב' : 'אישור ההרכבים'}</Text></Pressable>
        <Pressable onPress={onCancel} accessibilityRole="button" style={s.later}><Text style={s.link}>אחר כך</Text></Pressable>
      </View>
    </View></View>
  </SafeModal>;
}

const s = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: overlayTheme.backdrop },
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 16, paddingBottom: 10, flexShrink: 0, gap: 8 },
  compactSheet: { padding: 10, paddingBottom: 8, gap: 6 },
  heading: { flexShrink: 0, gap: 6 },
  body: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 0, gap: 6 },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#CCD3DF', marginBottom: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 }, title: { flex: 1, fontSize: 23, fontWeight: '800', color: '#10234C', textAlign: RTL_LABEL_ALIGN },
  close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }, subtitle: { fontSize: 14, color: '#62718B', textAlign: RTL_LABEL_ALIGN, marginTop: -5 },
  compactTitle: { fontSize: 21 }, compactSubtitle: { fontSize: 12 },
  savedResult: { fontSize: 12, color: '#16734D', textAlign: RTL_LABEL_ALIGN }, rosterFrame: { flexGrow: 1, flexShrink: 1, minHeight: 0 }, rosterScroll: { flex: 1 }, rosterContent: { paddingBottom: 2, gap: 6 },
  teams: { flexDirection: 'row', alignItems: 'stretch', gap: 10 }, teamsStacked: { flexDirection: 'column' },
  card: { flex: 1, minWidth: 0, borderRadius: 14, borderWidth: 1, padding: 10 }, activeCard: { borderWidth: 1.5 },
  teamHeader: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 5 }, sideTitle: { flex: 1, fontSize: 15, fontWeight: '800', color: '#10234C', textAlign: RTL_LABEL_ALIGN },
  capacity: { fontSize: 12, fontWeight: '700', color: '#314369' }, member: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 26, paddingVertical: 1 }, memberText: { flex: 1, minWidth: 0 },
  memberName: { fontSize: 14, lineHeight: 19, color: '#233758', textAlign: RTL_LABEL_ALIGN }, addedName: { fontWeight: '700', color: '#235CD6' }, origin: { fontSize: 10, color: '#356ACB', textAlign: RTL_LABEL_ALIGN },
  deficit: { fontSize: 12, lineHeight: 18, color: '#62718B', textAlign: RTL_LABEL_ALIGN, marginTop: 5 }, pickerHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 2 },
  pickerTitle: { fontSize: 17, fontWeight: '800', color: '#10234C', textAlign: RTL_LABEL_ALIGN }, detailButton: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 10, paddingStart: 12 },
  link: { fontSize: 14, fontWeight: '600', color: '#2865FF', textAlign: RTL_LABEL_ALIGN }, small: { fontSize: 12, lineHeight: 18, color: '#68758E', textAlign: RTL_LABEL_ALIGN },
  candidates: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 0 }, candidateContent: { gap: 4, paddingBottom: 6 },
  player: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: '#E2E9F3' },
  playerOn: { borderColor: '#2865FF', backgroundColor: '#EDF4FF' }, playerDisabled: { opacity: 0.5, backgroundColor: '#F4F6F9' }, name: { fontSize: 16, fontWeight: '600', color: '#10234C', textAlign: RTL_LABEL_ALIGN },
  footer: { flexShrink: 0, gap: 6, paddingTop: 2 }, progress: { fontSize: 14, fontWeight: '600', color: '#294D85', textAlign: RTL_LABEL_ALIGN }, shortage: { color: '#996015' },
  confirm: { minHeight: 50, backgroundColor: '#2865FF', padding: 13, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, confirmDisabled: { backgroundColor: '#E0E8F8' },
  confirmText: { fontSize: 17, fontWeight: '800', color: '#FFFFFF', textAlign: 'center' }, confirmTextDisabled: { color: '#697DAB' }, footnote: { fontSize: 11, lineHeight: 16, color: '#68758E', textAlign: 'center' },
  later: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 20, paddingVertical: 6 },
});
