import { overlaySurfaces } from '@/theme/overlays';
import { useAuthenticatedAction } from '@/hooks/useAuthenticatedAction';
import { SafeModal as Modal } from '@/components/SafeModal';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { UserAvatar } from '@/components/UserAvatar';
import { FriendActionButton } from '@/components/profile/FriendActionButton';
import { SpringSheet } from '@/components/anim/SpringSheet';
import { usePlayerSearch } from '@/hooks/usePlayerSearch';
import {chatService} from '@/services/chatService';
import { useUserStore } from '@/store/userStore';
import { SocialAction, socialStyles as s } from './SocialUI';
import { playerAvailabilityLines, playerDiscoveryMatches } from '@/utils/socialPlayers';
import type { PlayerSearch, SocialPlayer } from '@/types/social';
import { RTL_LABEL_ALIGN } from '@/theme';
import { EmptyState } from '@/components/EmptyState';
import { ReadStatusNotice } from '@/components/ReadStatusNotice';

export function PlayerDiscovery({ preview, active=true }: { preview?: SocialPlayer[]; active?: boolean }) {
  const { width, height, fontScale } = useWindowDimensions();
  const scale = Math.max(1, fontScale);
  const stackedPlayer = width / scale < 355;
  // The native list remounts a header when its sticky status changes. Keep
  // the current status while typing so a keyboard resize cannot blur search.
  const [focusedSearchSticky, setFocusedSearchSticky] = useState<boolean | null>(null);
  const stickySearch = focusedSearchSticky ?? height / scale >= 440;
  const authAction=useAuthenticatedAction();
  const nav = useNavigation<any>(), me = useUserStore(x=>x.currentUser);
  const [text,setText]=useState(''),[city,setCity]=useState(''),[friendsOnly,setFriendsOnly]=useState(false);
  const [days,setDays]=useState<number[]>([]),[times,setTimes]=useState<string[]>([]);
  const [filter,setFilter]=useState(false);
  const [draftCity,setDraftCity]=useState(''),[draftDays,setDraftDays]=useState<number[]>([]),[draftTimes,setDraftTimes]=useState<string[]>([]);
  const openFilters=()=>{setDraftCity(city);setDraftDays(days);setDraftTimes(times);setFilter(true);};
  const opts: PlayerSearch = {text,city,friendsOnly,days,times};
  const {players,cursor,busy,failed,confirmed:ownsPlayers,scope,more,retry,update} = usePlayerSearch(opts,active,preview);
  const [blocked,setBlocked]=useState<{owner:string;ids:Set<string>}|null>(null);
  useEffect(()=>{
    if(!me || me.isGuest || preview)return;
    const owner=me.id;
    return chatService.subscribeBlocked(owner,ids=>setBlocked({owner,ids}));
  },[me?.id,me?.isGuest,preview]);
  const list=players.filter(player=>(blocked?.owner!==me?.id || !blocked?.ids.has(player.id)) && playerDiscoveryMatches(player,opts));
  const clearSearch=()=>{setText('');setCity('');setFriendsOnly(false);setDays([]);setTimes([]);};
  const draftHasFilters=!!draftCity.trim()||draftDays.length>0||draftTimes.length>0;
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
  const searchTools = <View style={{backgroundColor:'#F4F7FB',paddingTop:12,gap:10}}>
      <View style={[s.row,s.chip,{backgroundColor:'white',paddingVertical:4}]}><TextInput value={text} onChangeText={setText} onFocus={()=>setFocusedSearchSticky(stickySearch)} onBlur={()=>setFocusedSearchSticky(null)} placeholder="חיפוש לפי שם" placeholderTextColor="#687797" accessibilityLabel="חיפוש שחקנים לפי שם" maxLength={60} style={{flex:1,textAlign:'right',writingDirection:'rtl',minHeight:42,fontSize:16,color:'#0C1744'}} autoCorrect={false}/><Ionicons name="search-outline" size={23} color="#7F90AF" /></View>
      <View style={[s.row,{flexWrap:'wrap',alignItems:'stretch',gap:8,paddingBottom:2}]}>
        {[{label:'הכל',selected:!searching,onPress:()=>{setText('');setCity('');setFriendsOnly(false);setDays([]);setTimes([]);}}, {label:'החברים שלי',selected:friendsOnly,onPress:()=>setFriendsOnly(v=>!v)}, {label:city||days.length||times.length?'סינון פעיל':'סינון',selected:!!city||days.length>0||times.length>0,onPress:openFilters}].map(c=><Pressable key={c.label} accessibilityRole="button" accessibilityState={{selected:c.selected}} onPress={c.onPress} style={[s.chip,{maxWidth:'100%'},c.selected&&{backgroundColor:'#2563EB',borderColor:'#2563EB'}]}><Text style={[s.chipText,c.selected&&{color:'white'}]}>{c.label}</Text></Pressable>)}
      </View>
    </View>;
  return <View style={{flex:1}}>
    <FlatList data={rows} keyExtractor={r=>r.key} onEndReached={()=>{if(rows.length&&!failed)void more();}} onEndReachedThreshold={0.35} keyboardShouldPersistTaps="handled" stickyHeaderIndices={stickySearch?[0]:undefined} contentContainerStyle={{paddingHorizontal:16,paddingBottom:24}} renderItem={({item})=>item.title?<Text style={[s.title,{marginTop:20,marginBottom:10}]}>{item.title}</Text>:item.player?<View style={[s.card,s.row,stackedPlayer&&{flexDirection:'column',alignItems:'stretch'},{padding:12,marginBottom:0,borderRadius:0,elevation:0,borderTopWidth:item.first?1:0,borderBottomWidth:item.last?1:0.5,borderTopLeftRadius:item.first?14:0,borderTopRightRadius:item.first?14:0,borderBottomLeftRadius:item.last?14:0,borderBottomRightRadius:item.last?14:0}]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`פתח פרופיל של ${item.player.name}`} onPress={()=>nav.navigate('PlayerCard',{userId:item.player!.id})} style={[s.row,!stackedPlayer&&{flex:1}]}><UserAvatar user={item.player} size={48}/><View style={{flex:1}}><Text style={[s.title,{fontSize:16,flex:0}]}>{item.player.name}</Text><Text style={[s.body,{fontSize:12}]}>{item.player.city}</Text><Text style={[s.body,{fontSize:12}]}>{item.player.sharedRounds?`${item.player.sharedRounds} מחזורים משותפים`:item.player.commonClubCount?'מועדון משותף':playerAvailabilityLines(item.player.availability)[0]??''}</Text></View></Pressable>
      {me?<View style={!stackedPlayer?{maxWidth:116*scale}:undefined}><FriendActionButton meId={me.id} otherUserId={item.player.id} compact relationship={item.player.relationship} onChanged={relationship=>update(item.player!.id,{friend:relationship==='friends',relationship})}/></View>:null}
    </View>:null}
    ListHeaderComponent={<View style={{backgroundColor:'#F4F7FB'}}>{searchTools}<ReadStatusNotice scope={scope} loading={busy} failed={failed} hasData={ownsPlayers} onRetry={retry}/></View>}
    ListEmptyComponent={!busy&&!failed&&!cursor&&(ownsPlayers||me?.isGuest||preview)?<EmptyState fill={false} icon="people-outline" title={me?.isGuest?'חברים מחכים על המגרש':searching?'לא נמצאו שחקנים בחיפוש הזה':'עדיין אין שחקנים להצגה'} hint={me?.isGuest?'הירשם כדי למצוא שחקנים ולהתחבר לחברים':searching?'נסו שם חלקי או הציגו שחקנים מכל הערים והזמינויות.':'מוצגים שחקנים שהגדרות הפרטיות שלהם מאפשרות גילוי. אפשר לנסות שוב בהמשך.'} ctaLabel={me?.isGuest?'הירשם והכר שחקנים':searching?'נקה חיפוש וסינון':undefined} onCtaPress={me?.isGuest?()=>authAction.requestAuth():searching?clearSearch:undefined}/>:null}
    ListFooterComponent={<View style={{gap:10,marginTop:12}}>{busy?<ActivityIndicator color="#2563EB"/>:null}{!failed&&ownsPlayers&&cursor?<SocialAction title="הצג שחקנים נוספים" icon="chevron-down" secondary disabled={busy} onPress={()=>void more()}/>:list.length?<Text style={[s.body,{fontSize:11,textAlign:'center'}]}>הפרטים מוצגים בהתאם להגדרות הפרטיות של כל שחקן</Text>:null}</View>}/>
    <Modal visible={filter} transparent animationType="none" onRequestClose={()=>setFilter(false)}><SpringSheet panelStyle={{...overlaySurfaces.sheet,top:'auto',maxHeight:'85%'}} visible={filter} onBackdropPress={()=>setFilter(false)}><ScrollView style={{flexGrow:0}} keyboardShouldPersistTaps="handled" contentContainerStyle={[s.content,{paddingBottom:30}]}>
      <View style={s.row}><Text style={s.title}>סינון שחקנים</Text><Pressable accessibilityRole="button" accessibilityLabel="סגור סינון" onPress={()=>setFilter(false)}><Ionicons name="close" size={22} color="#667796"/></Pressable></View>
      <Text style={[s.body,{fontWeight:'700'}]}>עיר</Text>
      <TextInput value={draftCity} onChangeText={setDraftCity} placeholder="כל הערים" accessibilityLabel="סינון לפי עיר" maxLength={120} style={[s.chip,{textAlign:'right',writingDirection:'rtl',fontSize:15,minHeight:44}]}/>
      <Text style={[s.body,{fontWeight:'700',marginTop:4}]}>ימים שמתאימים לשחק</Text><Text style={[s.body,{fontSize:12}]}>אפשר לבחור כמה ימים ושעות</Text>
      <View style={[s.row,{flexWrap:'wrap',gap:8}]}>{['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'].map((label,i)=><Pressable key={label} accessibilityRole="button" accessibilityState={{selected:draftDays.includes(i)}} onPress={()=>setDraftDays(old=>old.includes(i)?old.filter(d=>d!==i):[...old,i].sort((a,b)=>a-b))} style={[s.chip,draftDays.includes(i)&&{backgroundColor:'#DCEBFF',borderColor:'#A9C6FF'}]}><Text style={s.chipText}>{label}</Text></Pressable>)}</View>
      <Text style={[s.body,{fontWeight:'700',marginTop:4}]}>שעות מועדפות</Text>
      <View style={[s.row,{flexWrap:'wrap'}]}>{[['morning','בוקר'],['noon','צהריים'],['evening','ערב']].map(([value,label])=><Pressable key={value} accessibilityRole="button" accessibilityState={{selected:draftTimes.includes(value)}} onPress={()=>setDraftTimes(old=>old.includes(value)?old.filter(t=>t!==value):[...old,value].sort())} style={[s.chip,{flexGrow:1,flexShrink:1,flexBasis:70*scale},draftTimes.includes(value)&&{backgroundColor:'#DCEBFF',borderColor:'#A9C6FF'}]}><Text style={[s.chipText,{textAlign:'center'}]}>{label}</Text></Pressable>)}</View>
      <View style={[s.row,{marginTop:8},stackedPlayer&&{flexDirection:'column',alignItems:'stretch'}]}><View style={!stackedPlayer?{flex:1}:undefined}><SocialAction title="הצג שחקנים" icon="search-outline" onPress={()=>{setCity(draftCity.trim());setDays(draftDays);setTimes(draftTimes);setFilter(false);}}/></View><Pressable accessibilityRole="button" accessibilityState={{disabled:!draftHasFilters}} disabled={!draftHasFilters} onPress={()=>{setDraftCity('');setDraftDays([]);setDraftTimes([]);}} style={{padding:12,minHeight:44,borderRadius:12,backgroundColor:draftHasFilters?'#E8F0FF':'#F1F4F8',borderWidth:1,borderColor:draftHasFilters?'#ABC7FF':'#E8EDF4'}}><Text style={{textAlign:'center',color:draftHasFilters?'#2563EB':'#97A3B6',fontSize:13,fontWeight:'700'}}>נקה סינון</Text></Pressable></View>
    </ScrollView></SpringSheet></Modal>
  </View>;
}
