import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TeamShirtIllustration } from './TeamShirt';
import { teamColor, teamName } from './rotationView';
import type { DraftTeamsResult, LiveMatchState, MatchRotation } from '@/types';

/** The same team identity and score layout in both end-of-match dialogs. */
export function MatchResultPanel({ draftTeams, rotation, live, caption, trophy = false, compact = false, heading, teamDetails, compactIdentity = false }: {
  draftTeams: DraftTeamsResult;
  rotation: MatchRotation;
  live: LiveMatchState;
  caption?: string;
  trophy?: boolean;
  compact?: boolean;
  heading?: string;
  teamDetails?: (side: 'A' | 'B') => React.ReactNode;
  compactIdentity?: boolean;
}) {
  return <View style={[s.result, compact && s.compactResult]} pointerEvents="none">
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none" accessible={false}>
      <Image source={require('@/assets/images/live-scoreboard-pitch.png')} style={[StyleSheet.absoluteFillObject,s.pitchImage]} resizeMode="stretch" accessible={false}/>
      <View style={s.pitchShade}/>
    </View>
    {heading ? <Text style={s.heading}>{heading}</Text> : null}
    <View style={[s.row, compact && s.compactRow]}>
      {rotation.playing.map((index, side) => <View key={index} style={s.side}>
          <View style={compactIdentity ? s.identityRow : s.identityStack}>
          <TeamShirtIllustration color={teamColor(index,draftTeams.teams)} width={compactIdentity ? 28 : compact ? 34 : 42}/>
          <Text style={[s.name, compact && s.compactName, compactIdentity && s.identityName]} numberOfLines={compact ? 2 : 1} maxFontSizeMultiplier={compact ? 1.15 : undefined}>{teamName(index,draftTeams.teams)}</Text>
          </View>
          <Text style={[s.score, compact && s.compactScore]} maxFontSizeMultiplier={compact ? 1.2 : undefined}>{side === 0 ? live.scoreA : live.scoreB}</Text>
          {teamDetails?.(side === 0 ? 'A' : 'B')}
        </View>
      )}
    </View>
    {caption ? <View style={s.captionRow}>
      <Text style={[s.caption, compact && s.compactCaption]} maxFontSizeMultiplier={compact ? 1.15 : undefined}>{caption}</Text>
      {trophy && <Ionicons name="trophy-outline" size={24} color="#F8FAFC"/>}
    </View> : null}
  </View>;
}

const s=StyleSheet.create({
  heading:{fontSize:12,fontWeight:'800',color:'#FFFFFF',textAlign:'center'},
  identityRow:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:5,alignSelf:'stretch'},
  identityStack:{alignItems:'center',gap:4},identityName:{flexShrink:1},
  result:{backgroundColor:'#075B2A',borderRadius:20,padding:18,gap:14,overflow:'hidden'},
  compactResult:{padding:12,gap:8},compactRow:{minHeight:104},compactName:{fontSize:16},compactScore:{fontSize:32,lineHeight:36},compactCaption:{fontSize:16},
  pitchImage:{width:'100%',height:'100%'},
  pitchShade:{...StyleSheet.absoluteFillObject,backgroundColor:'rgba(6,61,31,0.12)'},
  row:{flexDirection:'row',alignItems:'center',minHeight:128},side:{flex:1,minWidth:0,alignItems:'center',justifyContent:'center',gap:4},
  name:{fontSize:18,fontWeight:'800',textAlign:'center',color:'#FFFFFF',textShadowColor:'rgba(3,30,15,0.3)',textShadowRadius:2},
  score:{fontSize:40,lineHeight:44,fontWeight:'900',fontVariant:['tabular-nums'],color:'#FFFFFF',textShadowColor:'rgba(3,30,15,0.3)',textShadowRadius:2},
  captionRow:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:9},
  caption:{fontSize:19,fontWeight:'800',color:'#FFFFFF',textAlign:'center',flexShrink:1,textShadowColor:'rgba(3,30,15,0.5)',textShadowRadius:3},
});
