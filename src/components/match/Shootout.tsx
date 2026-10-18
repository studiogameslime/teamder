import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { SafeModal } from '@/components/SafeModal';
import { colors, RTL_LABEL_ALIGN } from '@/theme';
import { overlaySurfaces, overlayTheme } from '@/theme/overlays';
import { he } from '@/i18n/he';
import { MatchResultPanel } from './MatchResultPanel';
import { TeamShirtIllustration } from './TeamShirt';
import { teamColor, teamName } from './rotationView';
import type { DraftTeamsResult, LiveMatchState, MatchRotation } from '@/types';
export { Shootout } from './ShootoutWizard';

export function TieDecisionModal({ visible, draftTeams, rotation, live, busy = false, onManual, onPenalties, onBothOut, onClose, discardedPenaltyCount = 0, embedded = false }: {
  visible: boolean;
  draftTeams?: DraftTeamsResult;
  rotation?: MatchRotation;
  live?: LiveMatchState;
  busy?: boolean;
  onManual: () => void;
  onPenalties: () => void;
  /** Requires more than three drafted teams AND two teams actually waiting. */
  onBothOut?: () => void;
  onClose: () => void;
  discardedPenaltyCount?: number;
  embedded?: boolean;
}) {
  const { height, width, fontScale } = useWindowDimensions();
  const compact = width < 360 || fontScale > 1.2;
  const surfaceHeight = embedded ? Math.min(680, Math.floor(height * 0.92)) : Math.max(240, Math.min(700, Math.floor(height - 80)));
  const [choice,setChoice]=useState<'penalties'|'manual'|'bothOut'|null>(null);
  const confirming=useRef(false);
  const selectionKey=rotation ? `${rotation.roundInstanceId ?? rotation.round}:${rotation.playing.join(':')}:${rotation.waiting.slice(0,2).join(':')}` : '';
  useEffect(()=>{setChoice(null);confirming.current=false;},[visible,selectionKey,draftTeams?.teams.length,!!onBothOut]);
  if (!draftTeams || !rotation || !live) return null;
  const incoming = rotation.waiting.slice(0,2);
  const showBothOut = !!onBothOut && draftTeams.teams.length > 3 && incoming.length === 2;
  const selected=choice==='bothOut' && !showBothOut ? null : choice;
  const close = () => { if (!busy) onClose(); };
  const choose = (next: NonNullable<typeof choice>) => { if (!busy && !confirming.current) setChoice(next); };
  const confirm = () => {
    if (busy || confirming.current) return;
    const action=selected==='penalties' ? onPenalties : selected==='manual' ? onManual : selected==='bothOut' && showBothOut ? onBothOut : undefined;
    if (!action) return;
    confirming.current=true;
    action();
  };
  const confirmLabel=selected==='bothOut' ? he.liveEndMatchConfirm : he.shDecideConfirm;
  const confirmDisabled=busy || !selected;

  const content = (
      <Pressable style={[s.backdrop,embedded && {padding:14,backgroundColor:'#0B122080'}]} onPress={close} accessible={false}>
        <Pressable testID="tie-decision-dialog" style={[s.card, embedded && {maxWidth:undefined,borderRadius:24}, { maxHeight: surfaceHeight, height: surfaceHeight }]} onPress={event => event.stopPropagation()} accessible={false}>
          <ScrollView bounces={false} style={[s.scroll, s.boundScroll]} contentContainerStyle={s.content}>
            <View style={s.heading}>
              <Text style={[s.title, compact && s.compactTitle]} maxFontSizeMultiplier={compact ? 1.2 : undefined} accessibilityRole="header">{he.shDecideTitle}</Text>
              <Pressable style={s.close} onPress={close} disabled={busy} accessibilityRole="button" accessibilityLabel={he.liveEndMatchReturn} accessibilityState={{disabled:busy}}>
                <Ionicons name="close" size={25} color={colors.text}/>
              </Pressable>
            </View>
            <Text style={s.round} maxFontSizeMultiplier={1.15}>{he.matchNumber(rotation.round ?? 1)}</Text>
            <MatchResultPanel draftTeams={draftTeams} rotation={rotation} live={live} compact={compact}/>
            <Text style={s.question} maxFontSizeMultiplier={compact ? 1.15 : undefined}>{he.shDecideQuestion}</Text>
            {discardedPenaltyCount > 0 && <Text style={s.hint}>{discardedPenaltyCount === 1 ? 'אישור הכרעה אחרת ימחק את הבעיטה שנרשמה. חזרה לפנדלים תשמור אותה.' : `אישור הכרעה אחרת ימחק את ${discardedPenaltyCount} הבעיטות שנרשמו. חזרה לפנדלים תשמור אותן.`}</Text>}

            <Pressable style={[s.option,selected==='penalties' && s.selectedOption,busy && s.disabled]} onPress={()=>choose('penalties')} disabled={busy} accessibilityRole="button" accessibilityLabel={he.shDecidePenalties} accessibilityState={{disabled:busy,selected:selected==='penalties'}}>
              <View style={s.textBlock}>
                <Text style={s.label}>{he.shDecidePenalties}</Text>
                <Text style={s.hint}>{he.shDecidePenaltiesHint}</Text>
              </View>
              <PenaltyGoalIcon/>
            </Pressable>
            <Pressable style={[s.option,selected==='manual' && s.selectedOption,busy && s.disabled]} onPress={()=>choose('manual')} disabled={busy} accessibilityRole="button" accessibilityLabel={he.shDecideManual} accessibilityState={{disabled:busy,selected:selected==='manual'}}>
              <View style={s.textBlock}>
                <Text style={s.label}>{he.shDecideManual}</Text>
                <Text style={s.hint}>{he.shDecideManualHint}</Text>
              </View>
              <Ionicons name="hand-left-outline" size={34} color={colors.textMuted}/>
            </Pressable>
            {showBothOut && <Pressable style={[s.option,selected==='bothOut' && s.selectedOption,busy && s.disabled]} onPress={()=>choose('bothOut')} disabled={busy} accessibilityRole="button" accessibilityLabel={he.shDecideBothOut} accessibilityState={{disabled:busy,selected:selected==='bothOut'}}>
              <View style={s.textBlock}>
                <Text style={s.label}>{he.shDecideBothOut}</Text>
                <Text style={s.hint}>{he.shDecideIncoming(teamName(incoming[0],draftTeams.teams),teamName(incoming[1],draftTeams.teams))}</Text>
              </View>
              <View style={s.shirts}>
                {incoming.map(index=><TeamShirtIllustration key={index} color={teamColor(index,draftTeams.teams)} width={27}/>)}
              </View>
            </Pressable>}
            {showBothOut && <Text style={[s.confirmHint,selected!=='bothOut' && s.hiddenHint]} accessibilityElementsHidden={selected!=='bothOut'} importantForAccessibility={selected==='bothOut' ? 'auto' : 'no-hide-descendants'}>{he.shDecideBothOutInlineHint}</Text>}
          </ScrollView>
          <View style={s.actions} testID="tie-decision-actions">
            <Pressable style={[s.confirm,confirmDisabled && s.disabled]} onPress={confirm} disabled={confirmDisabled} accessibilityRole="button" accessibilityLabel={confirmLabel} accessibilityState={{disabled:confirmDisabled}}>
              <Text style={s.confirmText}>{confirmLabel}</Text>
            </Pressable>
            <Pressable style={s.return} onPress={close} disabled={busy} accessibilityRole="button" accessibilityState={{disabled:busy}}>
              <Text style={s.returnText}>{he.liveEndMatchReturn}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
  );
  return embedded ? (visible ? content : null) : <SafeModal visible={visible} transparent animationType="fade" onRequestClose={close}>{content}</SafeModal>;
}

/** A restrained line icon; no raster asset or emoji platform variation. */
function PenaltyGoalIcon() {
  return <Svg width={40} height={40} viewBox="0 0 40 40" accessible={false}>
    <Rect x={3} y={5} width={34} height={24} rx={1} stroke="#2563EB" strokeWidth={1.8} fill="none"/>
    <Path d="M8 29V10h24v19M8 16h24M8 22h24M14 10v19M20 10v19M26 10v19" stroke="#2563EB" strokeWidth={0.8} fill="none"/>
    <Circle cx={20} cy={29} r={8} fill="#EFF6FF" stroke="#2563EB" strokeWidth={1.5}/>
    <Path d="m20 25 4 3-2 5h-4l-2-5Z" fill="#2563EB"/>
  </Svg>;
}

const s=StyleSheet.create({
  backdrop:{flex:1,backgroundColor:overlayTheme.backdrop,alignItems:'center',justifyContent:'center',padding:16},
  card:{...overlaySurfaces.dialog,width:'100%',maxWidth:420,maxHeight:'100%',flexShrink:1,overflow:'hidden'},
  scroll:{flexGrow:0,flexShrink:1,minHeight:0},content:{padding:20,paddingBottom:14,gap:12},
  boundScroll:{flexGrow:1,flexShrink:1,flexBasis:0},
  actions:{flexShrink:0,paddingHorizontal:20,paddingTop:10,paddingBottom:12,gap:8,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:colors.border},
  heading:{flexDirection:'row',alignItems:'center',gap:10},
  title:{flex:1,fontSize:23,fontWeight:'800',color:colors.text,textAlign:RTL_LABEL_ALIGN},
  compactTitle:{fontSize:20},
  close:{width:40,height:40,borderRadius:20,backgroundColor:colors.surfaceMuted,alignItems:'center',justifyContent:'center'},
  round:{fontSize:14,color:colors.textMuted,textAlign:'center',marginBottom:2},
  question:{fontSize:18,fontWeight:'800',color:colors.text,textAlign:RTL_LABEL_ALIGN,marginTop:3},
  option:{flexDirection:'row',alignItems:'center',gap:12,minHeight:74,padding:14,borderWidth:1.5,borderColor:colors.border,borderRadius:16},
  selectedOption:{backgroundColor:'#EFF6FF',borderColor:'#2563EB'},
  textBlock:{flex:1,minWidth:0,gap:3},label:{fontSize:17,fontWeight:'800',color:colors.text,textAlign:RTL_LABEL_ALIGN},
  hint:{fontSize:12,lineHeight:19,color:colors.textMuted,textAlign:RTL_LABEL_ALIGN},
  shirts:{flexDirection:'row',gap:1},
  return:{minHeight:44,alignItems:'center',justifyContent:'center',marginTop:3},
  returnText:{color:colors.primary,fontSize:16,fontWeight:'700'},disabled:{opacity:0.5},
  confirmHint:{fontSize:12,color:colors.textMuted,textAlign:RTL_LABEL_ALIGN},
  hiddenHint:{opacity:0},
  confirm:{minHeight:52,borderRadius:16,backgroundColor:colors.primary,alignItems:'center',justifyContent:'center',padding:12},
  confirmText:{fontSize:17,fontWeight:'800',color:'#FFFFFF',textAlign:'center'},
});
