import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Button } from '@/components/Button';
import { RTL_LABEL_ALIGN } from '@/theme';
import type { DmStatus } from '@/services/dmRequestService';

export function DmRequestBanner({ status, busy, onAction }: {
  status: DmStatus; busy: boolean; onAction: (kind:'accept'|'decline'|'cancel')=>void;
}) {
  if(status==='open'||status==='unavailable'||status==='cancelled') return null;
  const incoming=status==='incoming'||status==='declined';
  return <View style={s.card}>
    <Text style={s.title}>{incoming?'בקשה לשיחה':status==='waiting'?'ממתינים לאישור':'הודעה ראשונה'}</Text>
    <Text style={s.text}>{incoming?'אפשר לאשר את השיחה או להשיב כדי להמשיך להתכתב. האישור לא מוסיף חברות.':status==='waiting'?'הבקשה נשלחה. אפשר להמשיך להתכתב לאחר אישור':'אפשר לשלוח הודעה אחת, עד אלף תווים. לאחר אישור הבקשה תוכלו להמשיך להתכתב.'}</Text>
    {incoming?<View style={s.row}><Button title="אשר שיחה" size="sm" disabled={busy} onPress={()=>onAction('accept')}/>{status!=='declined'?<Button title="דחה" variant="outline" size="sm" disabled={busy} onPress={()=>onAction('decline')}/>:null}</View>:status==='waiting'?<Button title="בטל בקשה" variant="outline" size="sm" disabled={busy} onPress={()=>onAction('cancel')}/>:null}
    {incoming?<Text style={s.text}>לחסימה או לדיווח, לחצו לחיצה ארוכה על ההודעה. לפרופיל, לחצו על שם השולח.</Text>:null}
  </View>;
}
const s=StyleSheet.create({card:{marginHorizontal:16,marginTop:10,padding:14,borderRadius:14,backgroundColor:'#EAF2FF',gap:10},title:{fontSize:16,fontWeight:'700',color:'#153C72',textAlign:RTL_LABEL_ALIGN},text:{fontSize:13,lineHeight:20,color:'#36557D',textAlign:RTL_LABEL_ALIGN},row:{flexDirection:'row',gap:10}});
