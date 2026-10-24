import React from 'react';
import {Text,View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import type {SocialPlayer} from '@/types/social';
import {SocialTitle,socialStyles as s} from './SocialUI';
import {playerAvailabilityLines,playerAvailabilitySlots} from '@/utils/socialPlayers';
import {RTL_LABEL_ALIGN} from '@/theme';

const days=['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
const buckets=[['morning','בוקר','sunny-outline'],['noon','צהריים','partly-sunny-outline'],['evening','ערב','moon-outline']] as const;
/** Read-only version of the day/time grid used when marking availability. */
export function PlayerAvailabilitySummary({player}:{player:SocialPlayer}) {
  const a=player.availability;
  const grid=playerAvailabilitySlots(a);
  if(!playerAvailabilityLines(a).length)return null;
  return <View style={s.card}><SocialTitle title="זמין לכדורגל" icon="calendar-outline"/>
    <View style={{borderWidth:1,borderColor:'#DFE9F6',borderRadius:12,overflow:'hidden'}}>
      <View style={[s.row,{gap:4,backgroundColor:'#F5F8FD',padding:8}]}><View style={{width:44}}/>{buckets.map(([key,label,icon])=><View key={key} style={{flex:1,alignItems:'center',gap:3}}><Ionicons name={icon} size={16} color="#667796"/><Text style={{fontSize:11,color:'#667796'}}>{label}</Text></View>)}</View>
      {days.map((day,i)=>{const slots=grid[i]??[];return <View key={day} style={[s.row,{gap:4,paddingHorizontal:8,paddingVertical:5,borderTopWidth:1,borderColor:'#EDF2F8'}]}><Text style={{width:44,fontSize:12,fontWeight:'600',color:'#334155',textAlign:RTL_LABEL_ALIGN}}>{day}</Text>{buckets.map(([key,label])=>{const on=slots.includes(key);return <View key={key} accessible accessibilityLabel={`${day}, ${label}: ${on?'זמין':'לא סומנה זמינות'}`} style={{flex:1,height:30,borderRadius:8,backgroundColor:on?'#E5F2FF':'#F5F7FA',alignItems:'center',justifyContent:'center'}}>{on?<Ionicons name="checkmark" size={18} color="#2563EB"/>:<Text style={{color:'#A9B5C7'}}>—</Text>}</View>;})}</View>;})}
    </View>{player.city?<Text style={[s.body,{marginTop:8}]}>{player.city} והסביבה</Text>:null}
  </View>;
}
