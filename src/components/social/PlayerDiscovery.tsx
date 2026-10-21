import { observeCaughtError } from '../../utils/errorObservation';
import { overlaySurfaces } from '@/theme/overlays';
import { useAuthenticatedAction } from '@/hooks/useAuthenticatedAction';
import { SafeModal as Modal } from '@/components/SafeModal';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { UserAvatar } from '@/components/UserAvatar';
import { FriendActionButton } from '@/components/profile/FriendActionButton';
import { SpringSheet } from '@/components/anim/SpringSheet';
import { socialPlayersService } from '@/services/socialPlayersService';
import {friendsService} from '@/services/friendsService';
import { useUserStore } from '@/store/userStore';
import { SocialAction, socialStyles as s } from './SocialUI';
import { playerAvailabilityLines, playerDiscoveryMatches } from '@/utils/socialPlayers';
import type { PlayerSearch, SocialPlayer } from '@/types/social';
import { RTL_LABEL_ALIGN } from '@/theme';

export function PlayerDiscovery({ preview }: { preview?: SocialPlayer[] }) {
  const authAction=useAuthenticatedAction();
  const nav = useNavigation<any>(), me = useUserStore(x=>x.currentUser);
  const [text,setText]=useState(''),[city,setCity]=useState(''),[friendsOnly,setFriendsOnly]=useState(false);
  const [days,setDays]=useState<number[]>([]),[times,setTimes]=useState<string[]>([]);
  const [filter,setFilter]=useState(false);
  const [draftCity,setDraftCity]=useState(''),[draftDays,setDraftDays]=useState<number[]>([]),[draftTimes,setDraftTimes]=useState<string[]>([]);
  const openFilters=()=>{setDraftCity(city);setDraftDays(days);setDraftTimes(times);setFilter(true);};
  const [players,setPlayers]=useState<SocialPlayer[]>(preview??[]),[cursor,setCursor]=useState<string|null>(null),[busy,setBusy]=useState(!preview),[failed,setFailed]=useState(false);
  const [refresh,setRefresh]=useState(0);
  const epoch = useRef(0), paging = useRef(false);
  const opts: PlayerSearch = {text,city,friendsOnly,days,times};
  const key=JSON.stringify(opts);
  const draftHasFilters=!!draftCity.trim()||draftDays.length>0||draftTimes.length>0;
  useFocusEffect(useCallback(()=>{
    if(preview)return;
    setRefresh(n=>n+1);
  },[me?.id,preview]));
  useEffect(()=>{
    if(preview)return;
    const request=++epoch.current; setPlayers([]);setCursor(null);setFailed(false);setBusy(true);paging.current=false;
    if(!me||me.isGuest){setBusy(false);return;}
    const timer=setTimeout(()=>{
      socialPlayersService.search(JSON.parse(key)).then(result=>{if(epoch.current===request){setPlayers(result.players);setCursor(result.cursor);}}).catch((caughtError978e682a35: unknown) =>{
    observeCaughtError(caughtError978e682a35, {"source":"src/components/social/PlayerDiscovery.tsx","handler":"PlayerDiscovery","site":"PlayerDiscovery:978e682a35"});if(epoch.current===request)setFailed(true);}).finally(()=>{if(epoch.current===request)setBusy(false);});
    },300);
    return()=>{clearTimeout(timer);epoch.current++;};
  },[key,refresh,me?.id,me?.isGuest,preview]);
  const more=async()=>{
    if(!cursor||paging.current||busy)return;
    paging.current=true;const request=epoch.current;setBusy(true);setFailed(false);
    try{const result=await socialPlayersService.search({...opts,cursor});if(epoch.current===request){setPlayers(old=>[...new Map([...old,...result.players].map(p=>[p.id,p])).values()]);setCursor(result.cursor);}}
    catch (caughtError06d890deec){
    observeCaughtError(caughtError06d890deec, {"source":"src/components/social/PlayerDiscovery.tsx","handler":"more","site":"PlayerDiscovery:06d890deec"});if(epoch.current===request)setFailed(true);}
    finally{if(epoch.current===request){paging.current=false;setBusy(false);}}
  };
  const list=(preview??players).filter(player=>playerDiscoveryMatches(player,opts));
  // The server cursor is over examined accounts, not matching accounts. An
  // empty filtered page is not the end of a name search.
  useEffect(()=>{
    if (!preview && cursor && !busy && !failed && list.length === 0) void more();
  },[preview,cursor,busy,failed,list.length]);
  const searching=!!text.trim()||!!city.trim()||friendsOnly||days.length>0||times.length>0;
  // Unique rows; a player belongs to only one discovery section.
  const sections=searching?[{title:'תוצאות החיפוש',items:list}]:[
    {title:'שיחקתם יחד',items:list.filter(p=>p.sharedRounds>0)},
    {title:'מהמועדונים שלך',items:list.filter(p=>!p.sharedRounds&&p.commonClubCount>0)},
    {title:'זמינים לכדורגל',items:list.filter(p=>!p.sharedRounds&&!p.commonClubCount&&playerAvailabilityLines(p.availability).length>0)},
    {title:'עוד שחקנים',items:list.filter(p=>!p.sharedRounds&&!p.commonClubCount&&!playerAvailabilityLines(p.availability).length)},
  ];
  type Row = {key:string;title?:string;player?:SocialPlayer;first?:boolean;last?:boolean};
  const rows:Row[]=sections.flatMap(section=>section.items.length?[{key:section.title,title:section.title},...section.items.map((player,i)=>({key:player.id,player,first:i===0,last:i===section.items.length-1}))]:[]);
  return <View style={{flex:1}}>
    <View style={{paddingHorizontal:16,paddingTop:12,gap:10}}>
      <View style={[s.row,s.chip,{backgroundColor:'white',paddingVertical:4}]}><TextInput value={text} onChangeText={setText} placeholder="חיפוש לפי שם" placeholderTextColor="#687797" accessibilityLabel="חיפוש שחקנים לפי שם" maxLength={60} style={{flex:1,textAlign:'right',writingDirection:'rtl',minHeight:42,fontSize:16,color:'#0C1744'}} autoCorrect={false}/><Ionicons name="search-outline" size={23} color="#7F90AF" /></View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap:8,paddingBottom:2}}>
        {[{label:'הכל',selected:!searching,onPress:()=>{setText('');setCity('');setFriendsOnly(false);setDays([]);setTimes([]);}}, {label:'החברים שלי',selected:friendsOnly,onPress:()=>setFriendsOnly(v=>!v)}, {label:city||days.length||times.length?'סינון פעיל':'סינון',selected:!!city||days.length>0||times.length>0,onPress:openFilters}].map(c=><Pressable key={c.label} accessibilityRole="button" accessibilityState={{selected:c.selected}} onPress={c.onPress} style={[s.chip,c.selected&&{backgroundColor:'#2563EB',borderColor:'#2563EB'}]}><Text style={[s.chipText,c.selected&&{color:'white'}]}>{c.label}</Text></Pressable>)}
      </ScrollView>
    </View>
    <FlatList data={rows} keyExtractor={r=>r.key} onEndReached={()=>{if(rows.length&&!failed)void more();}} onEndReachedThreshold={0.35} keyboardShouldPersistTaps="handled" contentContainerStyle={{paddingHorizontal:16,paddingBottom:24}} renderItem={({item})=>item.title?<Text style={[s.title,{marginTop:20,marginBottom:10}]}>{item.title}</Text>:item.player?<View style={[s.card,s.row,{padding:12,marginBottom:0,borderRadius:0,elevation:0,borderTopWidth:item.first?1:0,borderBottomWidth:item.last?1:0.5,borderTopLeftRadius:item.first?14:0,borderTopRightRadius:item.first?14:0,borderBottomLeftRadius:item.last?14:0,borderBottomRightRadius:item.last?14:0}]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`פתח פרופיל של ${item.player.name}`} onPress={()=>nav.navigate('PlayerCard',{userId:item.player!.id})} style={[s.row,{flex:1}]}><UserAvatar user={item.player} size={48}/><View style={{flex:1}}><Text style={[s.title,{fontSize:16,flex:0}]}>{item.player.name}</Text><Text style={[s.body,{fontSize:12}]}>{item.player.city}</Text><Text style={[s.body,{fontSize:12}]}>{item.player.sharedRounds?`${item.player.sharedRounds} מחזורים משותפים`:item.player.commonClubCount?'מועדון משותף':playerAvailabilityLines(item.player.availability)[0]??''}</Text></View></Pressable>
      <View style={{maxWidth:116}}>{me?<FriendActionButton meId={me.id} otherUserId={item.player.id} compact onChanged={()=>{const owner=me.id,id=item.player!.id,request=epoch.current;void friendsService.getRelationship(owner,id).then(relationship=>{if(epoch.current===request&&useUserStore.getState().currentUser?.id===owner)setPlayers(old=>old.map(p=>p.id===id?{...p,friend:relationship==='friends'}:p));}).catch((caughtError4c12f9fc11: unknown) =>{
    observeCaughtError(caughtError4c12f9fc11, {"source":"src/components/social/PlayerDiscovery.tsx","handler":"PlayerDiscovery","site":"PlayerDiscovery:4c12f9fc11"});});}}/>:null}</View>
    </View>:null}
    ListEmptyComponent={!busy&&!failed?<View style={s.empty}><Ionicons name="people-outline" size={40} color="#2563EB"/><Text style={s.title}>{me?.isGuest?'חברים מחכים על המגרש':cursor?'ממשיך לחפש שחקנים':'לא נמצאו שחקנים'}</Text><Text style={s.body}>{me?.isGuest?'הירשם כדי למצוא שחקנים ולהתחבר לחברים':'נסה שם חלקי או שנה את הסינון'}</Text>{me?.isGuest?<SocialAction title="הירשם והכר שחקנים" icon="people-outline" onPress={()=>authAction.requestAuth()}/>:null}</View>:null}
    ListFooterComponent={<View style={{gap:10,marginTop:12}}>{busy?<ActivityIndicator color="#2563EB"/>:null}{failed?<><Text style={s.body}>לא ניתן לטעון כרגע. התוצאות אינן בהכרח ריקות.</Text><SocialAction title="נסה שוב" icon="refresh-outline" secondary onPress={()=>cursor?void more():setRefresh(n=>n+1)}/></>:cursor?<SocialAction title="הצג שחקנים נוספים" icon="chevron-down" secondary disabled={busy} onPress={()=>void more()}/>:list.length?<Text style={[s.body,{fontSize:11,textAlign:'center'}]}>הפרטים מוצגים בהתאם להגדרות הפרטיות של כל שחקן</Text>:null}</View>}/>
    <Modal visible={filter} transparent animationType="none" onRequestClose={()=>setFilter(false)}><SpringSheet panelStyle={{...overlaySurfaces.sheet,top:'auto',maxHeight:'85%'}} visible={filter} onBackdropPress={()=>setFilter(false)}><ScrollView style={{flexGrow:0}} keyboardShouldPersistTaps="handled" contentContainerStyle={[s.content,{paddingBottom:30}]}>
      <View style={s.row}><Text style={s.title}>סינון שחקנים</Text><Pressable accessibilityRole="button" accessibilityLabel="סגור סינון" onPress={()=>setFilter(false)}><Ionicons name="close" size={22} color="#667796"/></Pressable></View>
      <Text style={[s.body,{fontWeight:'700'}]}>עיר</Text>
      <TextInput value={draftCity} onChangeText={setDraftCity} placeholder="כל הערים" accessibilityLabel="סינון לפי עיר" maxLength={120} style={[s.chip,{textAlign:'right',writingDirection:'rtl',fontSize:15,minHeight:44}]}/>
      <Text style={[s.body,{fontWeight:'700',marginTop:4}]}>ימים שמתאימים לשחק</Text><Text style={[s.body,{fontSize:12}]}>אפשר לבחור כמה ימים ושעות</Text>
      <View style={[s.row,{flexWrap:'wrap',gap:8}]}>{['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'].map((label,i)=><Pressable key={label} accessibilityRole="button" accessibilityState={{selected:draftDays.includes(i)}} onPress={()=>setDraftDays(old=>old.includes(i)?old.filter(d=>d!==i):[...old,i].sort((a,b)=>a-b))} style={[s.chip,draftDays.includes(i)&&{backgroundColor:'#DCEBFF',borderColor:'#A9C6FF'}]}><Text style={s.chipText}>{label}</Text></Pressable>)}</View>
      <Text style={[s.body,{fontWeight:'700',marginTop:4}]}>שעות מועדפות</Text>
      <View style={s.row}>{[['morning','בוקר'],['noon','צהריים'],['evening','ערב']].map(([value,label])=><Pressable key={value} accessibilityRole="button" accessibilityState={{selected:draftTimes.includes(value)}} onPress={()=>setDraftTimes(old=>old.includes(value)?old.filter(t=>t!==value):[...old,value].sort())} style={[s.chip,{flex:1,alignItems:'center'},draftTimes.includes(value)&&{backgroundColor:'#DCEBFF',borderColor:'#A9C6FF'}]}><Text style={s.chipText}>{label}</Text></Pressable>)}</View>
      <View style={[s.row,{marginTop:8}]}><View style={{flex:1}}><SocialAction title="הצג שחקנים" icon="search-outline" onPress={()=>{setCity(draftCity.trim());setDays(draftDays);setTimes(draftTimes);setFilter(false);}}/></View><Pressable accessibilityRole="button" accessibilityState={{disabled:!draftHasFilters}} disabled={!draftHasFilters} onPress={()=>{setDraftCity('');setDraftDays([]);setDraftTimes([]);}} style={{padding:12,minHeight:44,borderRadius:12,backgroundColor:draftHasFilters?'#E8F0FF':'#F1F4F8',borderWidth:1,borderColor:draftHasFilters?'#ABC7FF':'#E8EDF4'}}><Text style={{color:draftHasFilters?'#2563EB':'#97A3B6',fontSize:13,fontWeight:'700'}}>נקה סינון</Text></Pressable></View>
    </ScrollView></SpringSheet></Modal>
  </View>;
}
