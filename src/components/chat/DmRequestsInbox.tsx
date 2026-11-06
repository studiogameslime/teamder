import React from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View, StyleSheet } from 'react-native';
import { UserAvatar } from '@/components/UserAvatar';
import { Button } from '@/components/Button';
import { RTL_LABEL_ALIGN } from '@/theme';
import type { DmRequestEntry } from '@/services/dmRequestService';

export function DmRequestsInbox({ rows, failed, loading, declined, onToggle, onOpen, onRetry }: {
  rows: DmRequestEntry[]; failed: boolean; loading: boolean; declined: boolean;
  onToggle: ()=>void; onOpen: (entry:DmRequestEntry)=>void; onRetry: ()=>void;
}) {
  const visible=rows.filter(r=>r.status===(declined?'declined':'incoming'));
  return <View style={{flex:1}}>
    <View style={s.header}><Text style={s.heading} accessibilityRole="header">{declined?'בקשות שנדחו':'בקשות שהתקבלו'}</Text><Button title={declined?'לבקשות הפעילות':'בקשות שנדחו'} variant="outline" size="sm" fullWidth onPress={onToggle}/></View>
    {failed?<View style={s.header}><Text style={s.text}>לא הצלחנו לטעון את הבקשות</Text><Button title="נסו שוב" onPress={onRetry}/></View>:null}
    <FlatList data={visible} keyExtractor={r=>r.convId} contentContainerStyle={{padding:16,gap:10}} renderItem={({item})=><Pressable style={s.card} onPress={()=>onOpen(item)} accessibilityRole="button" accessibilityLabel={`בקשה מאת ${item.user.name}`}>
      <UserAvatar user={item.user} size={48}/><View style={{flex:1,gap:6}}><Text style={s.name}>{item.user.name}{!item.seenAt?' · חדשה':''}</Text><Text style={s.text} numberOfLines={3}>{item.text}</Text><Text style={s.date}>{new Date(item.createdAt).toLocaleDateString('he-IL')}</Text></View>
    </Pressable>} ListEmptyComponent={loading?<ActivityIndicator/>:failed?null:<Text style={s.empty}>{declined?'אין בקשות שנדחו':'אין בקשות לשיחה כרגע'}</Text>}/>
  </View>;
}
const s=StyleSheet.create({header:{padding:16,gap:12,alignSelf:'stretch'},heading:{width:'100%',padding:14,borderRadius:14,backgroundColor:'#EAF1FF',fontSize:22,fontWeight:'700',color:'#0C1744',textAlign:'center'},card:{flexDirection:'row',alignItems:'center',gap:12,padding:16,borderRadius:16,backgroundColor:'white',borderWidth:1,borderColor:'#E0E8F4'},name:{fontSize:16,fontWeight:'700',color:'#153C72',textAlign:RTL_LABEL_ALIGN},text:{fontSize:14,lineHeight:22,color:'#506480',textAlign:RTL_LABEL_ALIGN},date:{fontSize:12,color:'#667796',textAlign:RTL_LABEL_ALIGN},empty:{padding:30,textAlign:'center',fontSize:15,color:'#667796'}});
