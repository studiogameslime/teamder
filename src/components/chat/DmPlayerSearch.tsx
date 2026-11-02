import { observeCaughtError } from '../../utils/errorObservation';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { useUserStore } from '@/store/userStore';
import { socialPlayersService } from '@/services/socialPlayersService';
import { UserAvatar } from '@/components/UserAvatar';
import { Button } from '@/components/Button';
import { RTL_LABEL_ALIGN } from '@/theme';
import type { SocialPlayer } from '@/types/social';

export function DmPlayerSearch({ search, onOpen }: { search: string; onOpen: (id:string)=>void }) {
  const owner=useUserStore(s=>s.currentUser?.id);
  const [rows,setRows]=useState<SocialPlayer[]>([]),[cursor,setCursor]=useState<string|null>(null);
  const [busy,setBusy]=useState(false),[failed,setFailed]=useState(false),[retry,setRetry]=useState(0);
  const generation=useRef(0),lock=useRef(false);
  const load=async(append:boolean,epoch:number)=>{
    if(lock.current)return;
    lock.current=true;setBusy(true);setFailed(false);
    try {
      const page=await socialPlayersService.search({text:search.trim(),...(append&&cursor?{cursor}:{})});
      if(epoch!==generation.current||useUserStore.getState().currentUser?.id!==owner)return;
      setRows(old=>[...new Map([...(append?old:[]),...page.players].map(p=>[p.id,p])).values()]);setCursor(page.cursor);
    } catch (caughtError62d8b3bce0) {
    observeCaughtError(caughtError62d8b3bce0, {"source":"src/components/chat/DmPlayerSearch.tsx","handler":"load","site":"DmPlayerSearch:62d8b3bce0"}); if(epoch===generation.current)setFailed(true); }
    finally { if(epoch===generation.current){lock.current=false;setBusy(false);} }
  };
  useEffect(()=>{
    const epoch=++generation.current;lock.current=false;setRows([]);setCursor(null);setFailed(false);
    const timer=setTimeout(()=>void load(false,epoch),350);
    return()=>{++generation.current;clearTimeout(timer);};
  },[search,owner,retry]);
  return <FlatList data={rows} keyExtractor={r=>r.id} contentContainerStyle={{padding:16,gap:10}}
    renderItem={({item})=><Pressable accessibilityRole="button" accessibilityLabel={`שלח הודעה אל ${item.name}`} onPress={()=>onOpen(item.id)} style={{flexDirection:'row',gap:12,padding:15,borderRadius:16,backgroundColor:'white',alignItems:'center'}}><UserAvatar user={item} size={48}/><View style={{flex:1,gap:5}}><Text style={{fontSize:16,fontWeight:'700',color:'#0C1744',textAlign:RTL_LABEL_ALIGN}}>{item.name}</Text><Text style={{fontSize:13,color:'#667796',textAlign:RTL_LABEL_ALIGN}}>{item.friend?'חבר':'שליחת בקשה לשיחה'}</Text></View></Pressable>}
    ListEmptyComponent={!busy&&!failed?<Text style={{textAlign:'center',padding:24}}>לא נמצאו שחקנים בעמוד הזה</Text>:null}
    ListFooterComponent={<View style={{padding:14,gap:10}}>{busy?<ActivityIndicator/>:null}{failed?<><Text style={{textAlign:'center'}}>לא הצלחנו לחפש שחקנים</Text><Button title="נסו שוב" onPress={()=>cursor?void load(true,generation.current):setRetry(n=>n+1)}/></>:cursor&&!busy?<Button title="המשך חיפוש" variant="outline" onPress={()=>void load(true,generation.current)}/>:null}</View>}/>;
}
