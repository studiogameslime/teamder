import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import type {PenaltyOutcome} from '@/types';

export const penaltyOutcomes: {key:PenaltyOutcome;title:string;color:string;icon:React.ComponentProps<typeof Ionicons>['name']}[] = [
  {key:'goal',title:'גול',color:'#15803D',icon:'football-outline'},
  {key:'save',title:'עצירה',color:'#2563EB',icon:'hand-left-outline'},
  {key:'miss',title:'החמצה',color:'#475569',icon:'arrow-undo-outline'},
];

/** Identical result actions for a shootout kick and a single in-play kick. */
export function penaltyOutcomeButtons({onSelect,selected,disabled,horizontal=false,stacked=false}: {
  onSelect:(outcome:PenaltyOutcome)=>void;selected?:PenaltyOutcome;disabled:boolean;horizontal?:boolean;stacked?:boolean;
}) {
  return <View style={[s.outcomes,horizontal&&s.row,stacked&&s.stack]}>{penaltyOutcomes.map(o=><Pressable key={o.key}
    disabled={disabled} onPress={()=>onSelect(o.key)} accessibilityRole="button" accessibilityLabel={o.title}
    accessibilityState={{disabled,selected:selected===o.key}}
    style={[s.outcome,horizontal&&s.compact,{borderColor:o.color,backgroundColor:selected===o.key?o.color+'20':o.color+'0B'},disabled&&s.disabled]}>
    <Text style={[s.text,horizontal&&s.compactText,{color:o.color}]}>{o.title}</Text>
    {!horizontal&&<Ionicons name={o.icon} size={25} color={o.color}/>}
  </Pressable>)}</View>;
}
const s=StyleSheet.create({outcomes:{gap:8},row:{flexDirection:'row'},stack:{flexDirection:'column'},
  outcome:{minHeight:56,borderWidth:1,borderRadius:12,padding:12,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8},
  compact:{flex:1,minHeight:52,paddingHorizontal:5,justifyContent:'center'},text:{fontSize:22,fontWeight:'800',flex:1,textAlign:'center'},
  compactText:{fontSize:18},disabled:{opacity:.5}});
