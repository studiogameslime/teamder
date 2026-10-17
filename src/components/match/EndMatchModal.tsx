import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeModal } from '@/components/SafeModal';
import { TeamShirtIllustration } from './TeamShirt';
import { teamColor, teamName } from './rotationView';
import { MatchResultPanel } from './MatchResultPanel';
import type { DraftTeamsResult, LiveMatchState, MatchRotation } from '@/types';
import { colors, RTL_LABEL_ALIGN } from '@/theme';
import { overlaySurfaces, overlayTheme } from '@/theme/overlays';
import { he } from '@/i18n/he';
import { winnerRotationPreview } from '@/utils/winnerRotationPreview';

interface Props {
  visible: boolean;
  draftTeams: DraftTeamsResult;
  rotation: MatchRotation;
  live: LiveMatchState;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

/** Confirmation only: opening/dismissing this view never writes a result. */
export function EndMatchModal({ visible, draftTeams, rotation, live, busy, onClose, onConfirm }: Props) {
  const { height, width, fontScale } = useWindowDimensions();
  const compact = width < 360 || fontScale > 1.2;
  const surfaceHeight = Math.max(240, Math.min(700, Math.floor(height - 80)));
  const [a, b] = rotation.playing;
  const winner = live.scoreA > live.scoreB ? a : live.scoreB > live.scoreA ? b : null;
  const preview = winner == null ? null : winnerRotationPreview(rotation, winner);
  const loser = preview?.outgoing ?? (winner === a ? b : a);
  const incoming = preview?.incoming;
  // Winner-stays rotation; with no waiting team both current teams stay on.
  const nextPlaying = preview?.playing ?? rotation.playing;
  const name = (index: number) => teamName(index, draftTeams.teams);
  const close = () => { if (!busy) onClose(); };

  return (
    <SafeModal visible={visible && winner != null} transparent animationType="fade" onRequestClose={close}>
      <View style={s.backdrop}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={close} accessible={false}/>
        <View style={[s.sheet, { maxHeight: surfaceHeight, height: surfaceHeight }]} testID="end-match-surface">
          <ScrollView bounces={false} style={[s.scroll, s.boundScroll]} contentContainerStyle={s.content}>
            <View style={s.heading}>
              <Text style={[s.title, compact && s.compactTitle]} maxFontSizeMultiplier={compact ? 1.2 : undefined} accessibilityRole="header">{he.liveEndMatchTitle}</Text>
              <Pressable style={s.close} onPress={close} disabled={busy} accessibilityRole="button" accessibilityLabel={he.liveEndMatchReturn} accessibilityState={{disabled:busy}}>
                <Ionicons name="close" size={25} color={colors.text}/>
              </Pressable>
            </View>
            <Text style={s.round} maxFontSizeMultiplier={1.15}>{he.matchNumber(rotation.round ?? 1)}</Text>

            <MatchResultPanel draftTeams={draftTeams} rotation={rotation} live={live} caption={winner == null ? '' : he.liveEndMatchWinner(name(winner))} trophy compact={compact}/>

            <Text style={s.nextTitle}>{he.liveEndMatchNext}</Text>
            <View style={s.nextMatch}>
              {nextPlaying.map((index, side) => <React.Fragment key={index}>
                {side === 1 && <Text style={s.versus}>{he.liveEndMatchVersus}</Text>}
                <View style={[s.nextTeam, compact && s.compactNextTeam]}>
                  <TeamShirtIllustration color={teamColor(index, draftTeams.teams)} width={32}/>
                  <View style={s.nextIdentity}>
                    <Text style={s.nextName} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} maxFontSizeMultiplier={compact ? 1.15 : undefined}>{name(index)}</Text>
                    <View style={[s.badge,index === incoming && s.incomingBadge]}>
                      <Text style={[s.badgeText,index === incoming && s.incomingBadgeText]} numberOfLines={1} maxFontSizeMultiplier={compact ? 1.15 : undefined}>{index === incoming ? he.liveEndMatchIncoming : he.liveEndMatchStaying}</Text>
                    </View>
                  </View>
                </View>
              </React.Fragment>)}
            </View>
            {incoming != null ? <View style={s.waitingRow}>
              <TeamShirtIllustration color={teamColor(loser,draftTeams.teams)} width={22}/>
              <Text style={s.waitingText}>{he.liveEndMatchWaiting(name(loser))}</Text>
            </View> : <Text style={s.noWaiting}>{he.liveEndMatchNoWaiting}</Text>}
          </ScrollView>
          <View style={s.actions} testID="end-match-actions">
            <Pressable style={[s.confirm,busy && s.disabled]} onPress={onConfirm} disabled={busy} accessibilityRole="button" accessibilityState={{disabled:busy}}>
              <Text style={s.confirmText}>{he.liveEndMatchConfirm}</Text>
            </Pressable>
            <Pressable style={s.return} onPress={close} disabled={busy} accessibilityRole="button" accessibilityState={{disabled:busy}}>
              <Text style={s.returnText}>{he.liveEndMatchReturn}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </SafeModal>
  );
}

const s = StyleSheet.create({
  backdrop:{flex:1,backgroundColor:overlayTheme.backdrop,alignItems:'center',justifyContent:'center',padding:16},
  sheet:{...overlaySurfaces.dialog,width:'100%',maxWidth:420,maxHeight:'100%',flexShrink:1,overflow:'hidden'},
  scroll:{flexGrow:0,flexShrink:1,minHeight:0},content:{padding:20,paddingBottom:14,gap:14},
  boundScroll:{flexGrow:1,flexShrink:1,flexBasis:0},
  actions:{flexShrink:0,paddingHorizontal:20,paddingTop:10,paddingBottom:12,gap:8,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:colors.border},
  heading:{flexDirection:'row',alignItems:'center',gap:10},
  title:{flex:1,fontSize:23,fontWeight:'800',color:colors.text,textAlign:RTL_LABEL_ALIGN},
  compactTitle:{fontSize:20},
  close:{width:40,height:40,borderRadius:20,backgroundColor:colors.surfaceMuted,alignItems:'center',justifyContent:'center'},
  round:{fontSize:14,color:colors.textMuted,textAlign:'center'},
  nextTitle:{fontSize:18,fontWeight:'800',color:colors.text,textAlign:RTL_LABEL_ALIGN,marginTop:2},
  nextMatch:{flexDirection:'row',alignItems:'center',gap:7,padding:12,borderRadius:16,backgroundColor:colors.surfaceMuted},
  nextTeam:{flex:1,minWidth:0,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:7},
  compactNextTeam:{flexDirection:'column',gap:4},
  nextIdentity:{flexShrink:1,minWidth:0,alignItems:'center',gap:5},
  nextName:{fontSize:14,fontWeight:'800',color:colors.text},
  versus:{fontSize:14,color:colors.textMuted},
  badge:{borderRadius:16,paddingHorizontal:8,paddingVertical:3,backgroundColor:'#DBEAFE'},
  badgeText:{fontSize:12,fontWeight:'700',color:'#1D4ED8'},
  incomingBadge:{backgroundColor:'#D1FAE5'},incomingBadgeText:{color:'#065F46'},
  waitingRow:{flexDirection:'row',alignItems:'center',gap:7},
  waitingText:{flex:1,fontSize:13,color:colors.textMuted,textAlign:RTL_LABEL_ALIGN},
  noWaiting:{fontSize:13,color:colors.textMuted,textAlign:'center'},
  confirm:{minHeight:52,borderRadius:16,backgroundColor:colors.primary,alignItems:'center',justifyContent:'center',padding:12,marginTop:3},
  confirmText:{fontSize:17,fontWeight:'800',color:'#FFFFFF',textAlign:'center'},
  return:{minHeight:44,alignItems:'center',justifyContent:'center'},returnText:{fontSize:16,fontWeight:'700',color:colors.primary},
  disabled:{opacity:0.5},
});
