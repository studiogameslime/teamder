import React from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import {usePlayerSearch} from '@/hooks/usePlayerSearch';
import { UserAvatar } from '@/components/UserAvatar';
import { Button } from '@/components/Button';
import { RTL_LABEL_ALIGN } from '@/theme';

export function DmPlayerSearch({ search, onOpen }: { search: string; onOpen: (id:string)=>void }) {
  const {players:rows,cursor,busy,failed,confirmed,more,retry}=usePlayerSearch({text:search.trim()},true);
  return <FlatList data={rows} keyExtractor={r=>r.id} contentContainerStyle={{padding:16,gap:10}}
    renderItem={({item})=><Pressable accessibilityRole="button" accessibilityLabel={`שלח הודעה אל ${item.name}`} onPress={()=>onOpen(item.id)} style={{flexDirection:'row',gap:12,padding:15,borderRadius:16,backgroundColor:'white',alignItems:'center'}}><UserAvatar user={item} size={48}/><View style={{flex:1,gap:5}}><Text style={{fontSize:16,fontWeight:'700',color:'#0C1744',textAlign:RTL_LABEL_ALIGN}}>{item.name}</Text><Text style={{fontSize:13,color:'#667796',textAlign:RTL_LABEL_ALIGN}}>{item.friend?'חבר':'שליחת בקשה לשיחה'}</Text></View></Pressable>}
    ListEmptyComponent={confirmed&&!cursor&&!busy&&!failed?<Text style={{textAlign:'center',padding:24}}>לא נמצאו שחקנים בחיפוש הזה</Text>:null}
    ListFooterComponent={<View style={{padding:14,gap:10}}>{busy?<ActivityIndicator/>:null}{failed?<><Text style={{textAlign:'center'}}>לא הצלחנו לחפש שחקנים</Text><Button title="נסו שוב" onPress={retry}/></>:cursor&&!busy?<Button title="המשך חיפוש" variant="outline" onPress={more}/>:null}</View>}/>;
}
