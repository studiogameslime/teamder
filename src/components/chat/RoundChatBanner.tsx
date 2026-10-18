import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Game } from '@/types';
import { chatCountdown, roundChatState } from '@/utils/chatInbox';
import { RTL_LABEL_ALIGN } from '@/theme';

/** The second-by-second clock is isolated from the message list. */
export function RoundChatBanner({game}:{game:Pick<Game,'status'|'endedAt'>}) {
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{if(game.status!=='finished')return;const t=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(t);},[game.status,game.endedAt]);
  const state=roundChatState(game,now);
  if(!state.closed && state.remainingMs===null)return null;
  const text=state.closed?(state.reason==='cancelled'?'המחזור בוטל · השיחה לקריאה בלבד':'השיחה נסגרה ונשמרה בארכיון'):`השיחה תיסגר בעוד ⁦${chatCountdown(state.remainingMs!)}⁩`;
  return <View style={{marginHorizontal:16,marginTop:10,padding:12,borderRadius:12,backgroundColor:'#EAF2FF',flexDirection:'row',alignItems:'center',gap:8}}><Text style={{flex:1,fontSize:13,fontWeight:'600',color:'#2457A6',textAlign:RTL_LABEL_ALIGN}}>{text}</Text><Ionicons name={state.closed?'lock-closed-outline':'time-outline'} size={20} color="#2563EB"/></View>;
}
