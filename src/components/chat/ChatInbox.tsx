import { overlaySurfaces } from '@/theme/overlays';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, BackHandler, FlatList, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type ImageSourcePropType } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { SafeModal as Modal } from '@/components/SafeModal';
import { SpringSheet } from '@/components/anim/SpringSheet';
import { UserAvatar } from '@/components/UserAvatar';
import { OfficialBadge } from '@/components/OfficialBadge';
import { SocialAction } from '@/components/social/SocialUI';
import { toast } from '@/components/Toast';
import { chatService, chatKeyFor, dmConvId } from '@/services/chatService';
import { friendsService } from '@/services/friendsService';
import { userService } from '@/services/userService';
import { groupService } from '@/services/groupService';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { logError } from '@/services/errorLog';
import { useChatStore } from '@/store/chatStore';
import { useGroupStore } from '@/store/groupStore';
import { useUserStore } from '@/store/userStore';
import { resolveRoundCover } from '@/data/roundCover';
import { getCoverSource } from '@/data/coverImages';
import { RTL_LABEL_ALIGN } from '@/theme';
import { isOfficialSender } from '@/utils/officialAccount';
import { chatIsArchived, chatMessagePreview, chatSenderNeedsIdentity, roundChatState, type ChatPreferences } from '@/utils/chatInbox';
import type { ChatScope, Game, User } from '@/types';
import type { ChatStackParamList } from '@/navigation/ChatStack';

export interface InboxRow { scope: ChatScope; id: string; title: string; preview: string; unread: number; at: number; messageId?: string; image?: ImageSourcePropType; user?: Pick<User,'id'|'name'|'avatarId'|'photoUrl'>; closed?: boolean; subtitle: string }
export interface InboxPreview { rows: InboxRow[]; preferences: Record<string, ChatPreferences>; friends: User[] }
const FILTERS = [['all','הכל'],['unread','לא נקראו'],['dm','אישי'],['community','מועדונים'],['game','מחזורים']] as const;
type Filter = typeof FILTERS[number][0];
const blue = '#2563EB', navy = '#0C1744';
function rowTime(at: number) {
  if (!at) return '';
  const d = new Date(at), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('he-IL', {hour:'2-digit',minute:'2-digit'});
  now.setDate(now.getDate()-1);
  return d.toDateString() === now.toDateString() ? 'אתמול' : `${d.getDate()}.${d.getMonth()+1}`;
}

export function ChatInbox({ preview }: { preview?: InboxPreview }) {
  const nav = useNavigation<NativeStackNavigationProp<ChatStackParamList>>();
  const me = useUserStore(s=>s.currentUser), groups = useGroupStore(s=>s.groups), entries = useChatStore(s=>s.entries);
  const [mode,setMode] = useState<'inbox'|'archive'|'new'>('inbox');
  const [filter,setFilter] = useState<Filter>('all'), [search,setSearch] = useState('');
  const [games,setGames] = useState<Game[]>([]), [profiles,setProfiles] = useState<Record<string,User>>({});
  const [preferences,setPreferences] = useState<Record<string,ChatPreferences>>(preview?.preferences ?? {});
  const [friends,setFriends] = useState<User[]>(preview?.friends ?? []);
  const [loading,setLoading] = useState(!preview), [friendsLoading,setFriendsLoading] = useState(false);
  const [failed,setFailed] = useState(false), [friendsFailed,setFriendsFailed] = useState(false), [retry,setRetry] = useState(0);
  const [selected,setSelected] = useState<InboxRow|null>(null), [busy,setBusy] = useState(false);
  const [now,setNow] = useState(Date.now());
  const [senderNames,setSenderNames] = useState<{owner?:string; names:Record<string,string>}>({names:{}});
  const senderIds = useMemo(()=>JSON.stringify([...new Set(Object.values(entries).filter(chatSenderNeedsIdentity).map(e=>e.lastSenderId).filter(id=>id!==me?.id))].sort()),[entries,me?.id]);
  useEffect(()=>{
    let live=true;
    const owner=me?.id;
    setSenderNames({owner,names:{}});
    const ids=JSON.parse(senderIds) as string[];
    if(preview || !owner || !ids.length) return;
    groupService.hydratePublicUsers(ids).then(users=>{
      if(live && useUserStore.getState().currentUser?.id===owner) setSenderNames({owner,names:Object.fromEntries(users.map(u=>[u.id,u.name]))});
    }).catch(err=>{if(live)logError('ChatInbox.senderNames',err);});
    return()=>{live=false;};
  },[senderIds,me?.id,preview,retry]);
  useEffect(()=>{if(preview){setPreferences(preview.preferences);setFriends(preview.friends);setLoading(false);}},[preview]);
  const adminIds = groups.filter(g=>me && g.adminIds.includes(me.id)).map(g=>g.id).sort().join('|');
  useEffect(()=>{ const timer=setInterval(()=>setNow(Date.now()),60000); return ()=>clearInterval(timer); },[]);
  useEffect(()=>{
    if (preview || !me) return;
    setGames([]); setProfiles({}); setPreferences({}); setLoading(true); setFailed(false);
    const fail=(err:unknown)=>{setFailed(true);setLoading(false);logError('ChatInbox',err);};
    const a=chatService.subscribeInboxGames(me.id,adminIds ? adminIds.split('|'):[], rows=>{setGames(rows);setLoading(false);},fail);
    const b=chatService.subscribePreferences(me.id,setPreferences,fail);
    return ()=>{a();b();};
  },[me?.id,adminIds,preview,retry]);
  const otherIds = useMemo(()=>Object.values(entries).filter(e=>e.scope==='dm').map(e=>e.parentId.split('__').find(id=>id!==me?.id)).filter((id):id is string=>!!id),[entries,me?.id]);
  useEffect(()=>{
    let live=true;
    if (preview) return;
    Promise.all(otherIds.map(async id=>[id,await userService.getUserById(id).catch(()=>null)] as const)).then(pairs=>{
      if(live) setProfiles(Object.fromEntries(pairs.filter((p):p is readonly [string,User]=>!!p[1])));
    });
    return ()=>{live=false;};
  },[otherIds,preview]);
  useEffect(()=>{
    if(mode!=='new'||preview||!me) return;
    let live=true;setFriendsLoading(true);setFriendsFailed(false);setFriends([]);
    friendsService.listFriends(me.id).then(rows=>{if(live)setFriends(rows);}).catch(()=>{if(live)setFriendsFailed(true);}).finally(()=>{if(live)setFriendsLoading(false);});
    return ()=>{live=false;};
  },[mode,me?.id,preview,retry]);
  useFocusEffect(useCallback(()=>{
    const sub=BackHandler.addEventListener('hardwareBackPress',()=>{if(mode==='inbox')return false;setMode('inbox');setSearch('');return true;});
    return ()=>sub.remove();
  },[mode]));
  const rows: InboxRow[] = useMemo(()=>{
    if(preview) return preview.rows;
    const base=(scope:ChatScope,id:string,title:string,subtitle:string):InboxRow=>{
      const e=entries[chatKeyFor(scope,id)];
      return {scope,id,title,subtitle,preview:chatMessagePreview(e,me?.id,senderNames.owner===me?.id?senderNames.names[e?.lastSenderId??'']:undefined),unread:e?.count??0,at:e?.lastMessageAt??0,messageId:e?.lastMessageId};
    };
    const clubs=groups.filter(g=>!g.isPersonal&&!g.hidden).map(g=>({...base('community',g.id,g.name,'שיחת המועדון'),image:g.coverPhotoUrl?{uri:g.coverPhotoUrl}:getCoverSource(g.coverImageId)??undefined}));
    const rounds=games.map(g=>{
      const club=groups.find(c=>c.id===g.groupId);
      return {...base('game',g.id,g.title,'שיחת המחזור'),closed:roundChatState(g,now).closed,
        image:resolveRoundCover(g,club)};
    });
    const dms=Object.values(entries).filter(e=>e.scope==='dm'&&e.parentId&&me&&e.parentId.split('__').includes(me.id)).map(e=>{
      const id=e.parentId.split('__').find(id=>id!==me?.id)??'',p=profiles[id];
      const title=isOfficialSender(id)?'Teamder':p?.name||e.title||'שחקן';
      return {...base('dm',e.parentId,title,'שיחה אישית'),user:{id,name:title,avatarId:p?.avatarId??e.avatarId,photoUrl:p?.photoUrl??e.photoUrl}};
    });
    return [...clubs,...rounds,...dms];
  },[groups,games,entries,profiles,senderNames,me?.id,now,preview]);
  const key=(row:InboxRow)=>chatKeyFor(row.scope,row.id);
  const archived=(row:InboxRow)=>chatIsArchived(row.at,preferences[key(row)],row.closed,row.messageId);
  const sorted=[...rows].sort((a,b)=>Number(!!preferences[key(b)]?.pinned)-Number(!!preferences[key(a)]?.pinned)||b.at-a.at||a.title.localeCompare(b.title,'he'));
  const matches=(r:InboxRow)=>`${r.title} ${r.preview}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())&&(filter==='all'||filter==='unread'&&r.unread>0||r.scope===filter);
  const visible=sorted.filter(r=>archived(r)===(mode==='archive')&&matches(r));
  const active=visible.filter(r=>mode==='archive'||r.at>0||preferences[key(r)]?.pinned);
  const starters=visible.filter(r=>mode==='inbox'&&!r.at&&!preferences[key(r)]?.pinned);
  const archiveCount=rows.filter(archived).length;
  const open=(r:InboxRow)=>{
    if(preview){toast.info('תצוגת המחשה בלבד');return;}
    logEvent(AnalyticsEvent.ChatEntryPointTapped,{source:'chats_list',scope:r.scope,unread:r.unread});
    if(r.scope==='community')nav.navigate('CommunityChat',{groupId:r.id});
    else if(r.scope==='game')nav.navigate('GameChat',{gameId:r.id});
    else nav.navigate('DirectChat',{convId:r.id});
  };
  const update=async(patch:Partial<ChatPreferences>)=>{
    if(!selected||!me||busy)return;
    setBusy(true);
    try {
      if(!preview)await chatService.setPreferences(me.id,selected.scope,selected.id,patch);
      setPreferences(p=>({...p,[key(selected)]:{...(p[key(selected)] ?? {muted:false,pinned:false,archivedAt:0}),...patch}}));
      setSelected(null);
    }catch{toast.error('לא ניתן לשמור כרגע. נסו שוב.');}finally{setBusy(false);}
  };
  const changeMode=(next:typeof mode)=>{setMode(next);setSearch('');setFilter('all');};
  const renderRow=(item:InboxRow)=><Pressable accessibilityRole="button" accessibilityLabel={`פתיחת ${item.title}`} onPress={()=>open(item)} onLongPress={()=>setSelected(item)} style={({pressed})=>[s.card,pressed&&{opacity:0.7}]}>
    {item.user?<UserAvatar user={item.user} size={50}/>:item.image?<Image source={item.image} style={s.avatar}/>:<View style={[s.avatar,s.fallback]}><Ionicons name={item.scope==='community'?'shield-outline':'football-outline'} size={25} color={blue}/></View>}
    <View style={s.body}><View style={s.line}><Text style={[s.name,item.unread>0&&{fontWeight:'800'}]} numberOfLines={1}>{item.title}</Text>{item.user&&isOfficialSender(item.user.id)?<OfficialBadge size={13}/>:null}</View>
      <Text style={s.preview} numberOfLines={1}>{item.preview||'כאן מתחילה השיחה שלכם'}</Text><Text style={s.kind}>{item.closed?'המחזור הסתיים · לקריאה בלבד':item.subtitle}</Text></View>
    <View style={s.trailing}><Text style={s.time}>{rowTime(item.at)}</Text>{item.unread>0?<View style={s.badge}><Text style={s.badgeText}>{item.unread>99?'⁦99+⁩':item.unread}</Text></View>:null}<View style={s.line}>{preferences[key(item)]?.pinned?<Ionicons name="pin-outline" size={13} color="#8A9AB3"/>:null}{preferences[key(item)]?.muted?<Ionicons name="notifications-off-outline" size={13} color="#8A9AB3"/>:null}</View></View>
    <Pressable accessibilityRole="button" accessibilityLabel={`אפשרויות לשיחה ${item.title}`} hitSlop={8} onPress={()=>setSelected(item)} style={s.more}><Ionicons name="ellipsis-vertical" size={17} color="#8A9AB3"/></Pressable>
  </Pressable>;
  const empty=(title:string,body:string)=><View style={s.empty}><View style={s.emptyIcon}><Ionicons name={mode==='archive'?'archive-outline':'chatbubbles-outline'} size={36} color={blue}/></View><Text style={s.emptyTitle}>{title}</Text><Text style={s.emptyBody}>{body}</Text>{mode==='inbox'?<SocialAction title="התחילו שיחה עם חבר" icon="add-outline" onPress={()=>changeMode('new')}/>:null}</View>;
  return <View style={s.root}>
    {mode!=='inbox'?<View style={s.sectionHeader}><Pressable onPress={()=>changeMode('inbox')} accessibilityLabel="חזרה לשיחות" hitSlop={12}><Ionicons name="chevron-forward" size={25} color={navy}/></Pressable><Text style={s.sectionTitle}>{mode==='archive'?'ארכיון שיחות':'שיחה חדשה'}</Text></View>:null}
    <View style={s.tools}><View style={s.search}><TextInput value={search} onChangeText={setSearch} style={s.searchInput} placeholder={mode==='new'?'חיפוש חבר לפי שם':'חיפוש שיחה או הודעה אחרונה'} placeholderTextColor="#8A9AB3" accessibilityLabel="חיפוש שיחות"/><Ionicons name="search-outline" size={21} color="#8A9AB3"/></View>{mode==='inbox'?<Pressable onPress={()=>changeMode('new')} style={s.newButton} accessibilityLabel="שיחה חדשה"><Text style={s.newText}>שיחה חדשה</Text><Ionicons name="create-outline" size={18} color="white"/></Pressable>:null}</View>
    {mode!=='new'?<ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filters} contentContainerStyle={s.filterContent}>{FILTERS.map(([id,title])=><Pressable key={id} onPress={()=>setFilter(id)} accessibilityRole="tab" accessibilityState={{selected:filter===id}} style={[s.chip,filter===id&&s.chipSelected]}><Text style={[s.chipText,filter===id&&{color:'white'}]}>{title}</Text></Pressable>)}</ScrollView>:<Text style={s.hint}>אפשר להתחיל שיחה עם החברים שלכם בלבד</Text>}
    {mode==='new'?friendsLoading?<ActivityIndicator style={s.empty} color={blue}/>:friendsFailed?<View style={s.empty}><Text style={s.emptyBody}>לא הצלחנו לטעון את החברים</Text><SocialAction title="נסו שוב" icon="refresh-outline" onPress={()=>setRetry(n=>n+1)}/></View>:<FlatList data={friends.filter(u=>u.name.includes(search.trim())).sort((a,b)=>a.name.localeCompare(b.name,'he'))} keyExtractor={u=>u.id} contentContainerStyle={s.list} keyboardShouldPersistTaps="handled" renderItem={({item:u})=><Pressable style={s.card} onPress={()=>open({scope:'dm',id:dmConvId(me!.id,u.id),title:u.name,subtitle:'שיחה אישית',preview:'',at:0,unread:0,user:u})}><UserAvatar user={u} size={50}/><View style={s.body}><Text style={s.name}>{u.name}</Text><Text style={s.preview}>{'חבר ב־Teamder'}</Text></View><Ionicons name="chatbubble-ellipses-outline" size={23} color={blue}/></Pressable>} ListEmptyComponent={empty(search?'לא נמצאו חברים':'עדיין אין כאן חברים',search?'נסו לחפש שם אחר':'מצאו שחקנים והוסיפו אותם לחברים כדי להתחיל לדבר')}/>
    :<FlatList data={active} keyExtractor={key} contentContainerStyle={s.list} keyboardShouldPersistTaps="handled" renderItem={({item,index})=><>{index===0&&preferences[key(item)]?.pinned?<Text style={s.label}>שיחות נעוצות</Text>:index>0&&preferences[key(active[index-1])]?.pinned&&!preferences[key(item)]?.pinned?<Text style={s.label}>כל השיחות</Text>:null}{renderRow(item)}</>}
      ListHeaderComponent={failed?<Pressable style={s.notice} onPress={()=>setRetry(n=>n+1)}><Text style={s.emptyBody}>חלק מהשיחות לא נטענו. לחצו לניסיון נוסף.</Text></Pressable>:mode==='archive'?<Text style={s.hint}>שיחות שהועברו לארכיון ומחזורים שנסגרו. ההודעות נשמרות.</Text>:null}
      ListEmptyComponent={loading?<ActivityIndicator style={s.empty} color={blue}/>:starters.length?null:empty(mode==='archive'?'הארכיון שלכם ריק':search||filter!=='all'?'לא נמצאו שיחות':'הכדור אצלכם',mode==='archive'?'שיחות מחזורים שנסגרו יישמרו כאן':search||filter!=='all'?'נסו לשנות את החיפוש או את המסנן':'דברו עם החברים ועם השחקנים במועדון')}
      ListFooterComponent={mode==='inbox'?<><Pressable style={s.archiveLink} onPress={()=>changeMode('archive')}><Text style={s.archiveTitle}>ארכיון שיחות{archiveCount?` · ${archiveCount}`:''}</Text><Ionicons name="archive-outline" size={21} color="#667796"/></Pressable>{starters.length?<><Text style={s.label}>מתחילים שיחה</Text><Text style={s.hint}>המועדונים והמחזורים שלכם, גם לפני ההודעה הראשונה</Text>{starters.map(row=><View key={key(row)}>{renderRow(row)}</View>)}</>:null}</>:null}/>}

    <Modal visible={!!selected} transparent animationType="none" onRequestClose={()=>{if(!busy)setSelected(null);}}><SpringSheet visible={!!selected} onBackdropPress={()=>{if(!busy)setSelected(null);}} panelStyle={{...overlaySurfaces.sheet,top:'auto'}}><View style={s.sheet}><View style={s.handle}/><Text style={s.sheetTitle}>{selected?.title}</Text>{selected?([
      {title:preferences[key(selected)]?.pinned?'ביטול נעיצה':'נעיצת שיחה',icon:'pin-outline',patch:{pinned:!preferences[key(selected)]?.pinned}},
      {title:preferences[key(selected)]?.muted?'הפעלת התראות':'השתקת שיחה',icon:'notifications-off-outline',patch:{muted:!preferences[key(selected)]?.muted}},
      ...(!selected.closed?[{title:archived(selected)?'החזרה לשיחות':'העברה לארכיון',icon:'archive-outline',patch:{archivedAt:archived(selected)?0:Math.max(Date.now(),selected.at),archivedMessageId:selected.messageId??'__empty__'}}]:[]),
    ] as {title:string;icon:keyof typeof Ionicons.glyphMap;patch:Partial<ChatPreferences>}[]).map(a=><Pressable key={a.title} disabled={busy} onPress={()=>update(a.patch)} style={s.option}><Text style={s.optionText}>{a.title}</Text><Ionicons name={a.icon} size={23} color={blue}/></Pressable>):null}{selected?.scope==='dm'&&selected.user&&!isOfficialSender(selected.user.id)?<Pressable accessibilityRole="button" disabled={busy} onPress={()=>{const userId=selected.user!.id;setSelected(null);if(!preview)nav.navigate('PlayerCard',{userId});}} style={s.option}><Text style={s.optionText}>כרטיס השחקן</Text><Ionicons name="person-outline" size={23} color={blue}/></Pressable>:null}{busy?<ActivityIndicator color={blue}/>:null}</View></SpringSheet></Modal>
  </View>;
}

const s=StyleSheet.create({
  root:{flex:1,backgroundColor:'#F4F7FB'},tools:{flexDirection:'row',gap:8,paddingHorizontal:16,paddingTop:16,paddingBottom:12},search:{flex:1,flexDirection:'row',alignItems:'center',gap:7,backgroundColor:'white',borderRadius:13,borderWidth:1,borderColor:'#E5EDF7',paddingHorizontal:12,minHeight:44},searchInput:{flex:1,color:navy,textAlign:'right',fontSize:13,paddingVertical:10},newButton:{backgroundColor:blue,borderRadius:12,paddingHorizontal:11,flexDirection:'row',alignItems:'center',gap:6},newText:{fontSize:12,fontWeight:'700',color:'white'},filters:{flexGrow:0,flexShrink:0,maxHeight:44,marginBottom:4},filterContent:{paddingHorizontal:16,gap:7,paddingBottom:8},chip:{paddingHorizontal:13,paddingVertical:8,borderRadius:10,backgroundColor:'#EAF0FA'},chipSelected:{backgroundColor:blue},chipText:{fontSize:12,fontWeight:'600',color:'#627393'},list:{paddingHorizontal:16,paddingTop:8,paddingBottom:24,gap:9},card:{flexDirection:'row',alignItems:'center',gap:10,paddingHorizontal:12,paddingVertical:15,backgroundColor:'white',borderRadius:16,borderWidth:1,borderColor:'#E8EEF7'},avatar:{width:50,height:50,borderRadius:15},fallback:{backgroundColor:'#EAF2FF',alignItems:'center',justifyContent:'center'},body:{flex:1,gap:4},line:{flexDirection:'row',alignItems:'center',gap:4},name:{fontSize:15,fontWeight:'700',color:navy,textAlign:RTL_LABEL_ALIGN,flexShrink:1},preview:{fontSize:12,color:'#677797',textAlign:RTL_LABEL_ALIGN},kind:{fontSize:10,color:'#8A9AB3',textAlign:RTL_LABEL_ALIGN},trailing:{alignItems:'center',gap:7},time:{fontSize:10,color:'#8A9AB3'},badge:{backgroundColor:blue,borderRadius:10,minWidth:20,height:20,paddingHorizontal:5,alignItems:'center',justifyContent:'center'},badgeText:{fontSize:11,color:'white',fontWeight:'700'},more:{alignSelf:'center',paddingVertical:7},label:{fontSize:13,fontWeight:'700',color:'#667796',textAlign:RTL_LABEL_ALIGN,paddingTop:12,paddingBottom:4},hint:{fontSize:12,color:'#8A9AB3',lineHeight:19,textAlign:RTL_LABEL_ALIGN,marginHorizontal:16,marginBottom:8},archiveLink:{flexDirection:'row',justifyContent:'center',alignItems:'center',gap:8,paddingVertical:18},archiveTitle:{fontSize:13,color:'#667796',fontWeight:'600'},sectionHeader:{flexDirection:'row',alignItems:'center',gap:12,paddingHorizontal:18,paddingTop:18},sectionTitle:{fontSize:22,fontWeight:'800',color:navy},empty:{paddingHorizontal:20,paddingVertical:38,alignItems:'center',gap:14},emptyIcon:{width:76,height:76,borderRadius:26,backgroundColor:'#E7F0FF',alignItems:'center',justifyContent:'center'},emptyTitle:{fontSize:20,fontWeight:'800',color:navy,textAlign:'center'},emptyBody:{fontSize:13,color:'#667796',lineHeight:21,textAlign:'center'},notice:{padding:12,borderRadius:12,backgroundColor:'#FFF6DF'},sheet:{padding:22,paddingBottom:34,gap:6},handle:{width:40,height:4,borderRadius:2,backgroundColor:'#D5DEEB',alignSelf:'center',marginBottom:18},sheetTitle:{fontSize:18,fontWeight:'800',color:navy,textAlign:RTL_LABEL_ALIGN,paddingBottom:14},option:{flexDirection:'row',gap:12,alignItems:'center',paddingVertical:16,borderTopWidth:1,borderColor:'#EDF2F8'},optionText:{fontSize:15,fontWeight:'600',color:navy,flex:1,textAlign:RTL_LABEL_ALIGN},
});
