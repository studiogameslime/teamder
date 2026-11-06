import { observeCaughtError } from '../../utils/errorObservation';
import { PairStory } from './PairStory';
import {PlayerAvailabilitySummary} from './PlayerAvailabilitySummary';
import { DraggableMenuSheet } from '@/components/DraggableMenuSheet';
import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, ImageBackground, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { PlayerCardSkeleton } from '@/components/loading/CentralSkeletons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { UserAvatar } from '@/components/UserAvatar';
import { FriendActionButton } from '@/components/profile/FriendActionButton';
import { appAlert } from '@/components/AppDialog';
import { toast } from '@/components/Toast';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';
import { socialPlayersService } from '@/services/socialPlayersService';
import { friendsService } from '@/services/friendsService';
import { notificationsService } from '@/services/notificationsService';
import { gameService } from '@/services/gameService';
import { chatService, dmConvId } from '@/services/chatService';
import { goToDirectChat } from '@/navigation/navigationRef';
import { getCoverSource } from '@/data/coverImages';
import { clubRouteFor } from '@/utils/clubRoute';
import { SocialAction, SocialTitle, socialStyles as s } from './SocialUI';
import type { SocialProfile } from '@/types/social';
import type { Game } from '@/types';
import { RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

/** Presentation for the existing PlayerCard route, not a parallel profile route. */
export function SocialPlayerProfile({ userId, groupId, preview }: { userId: string; groupId?: string; preview?: SocialProfile }) {
  const { width, fontScale } = useWindowDimensions();
  const scale = Math.max(1, fontScale);
  // Two readable card columns need the page padding, gutter and room for each label.
  const singleClubColumn = width - 32 < 2 * 145 * scale + 10;
  const nav=useNavigation<any>(),me=useUserStore(x=>x.currentUser),groups=useGroupStore(x=>x.groups);
  const [result,setResult]=useState<{owner:string;target:string;profile:SocialProfile}|null>(null);
  const [busy,setBusy]=useState(!preview),[failed,setFailed]=useState(false),[tick,setTick]=useState(0);
  const [invites,setInvites]=useState(false),[inviteLoading,setInviteLoading]=useState(false),[games,setGames]=useState<Game[]>([]),[inviteError,setInviteError]=useState(false),[sending,setSending]=useState<string|null>(null),[sent,setSent]=useState<string[]>([]);
  const [blocked,setBlocked]=useState(false),[playerOptions,setPlayerOptions]=useState(false);
  const sendingRef=useRef(false);
  const inviteGamesLoadedAt=useRef(0);
  const visit=useRef(0);
  const [detailError,setDetailError]=useState(false);
  const currentTarget=useRef(userId);currentTarget.current=userId;
  useFocusEffect(useCallback(()=>{
    if(preview || !me)return;
    const request=++visit.current, owner=me.id;
    const active=()=>visit.current===request && useUserStore.getState().currentUser?.id===owner;
    setBusy(true);setFailed(false);setDetailError(false);setBlocked(false);setSent([]);
    setInvites(false);setGames([]);setInviteLoading(false);setInviteError(false);inviteGamesLoadedAt.current=0;
    void (async()=>{
      let opened=false;
      try {
        const first=await socialPlayersService.profile(userId,'card');
        if(!active())return;
        setResult({owner,target:userId,profile:first});setBusy(false);opened=true;
        if(first.detailsPending){
          const details=await socialPlayersService.profile(userId,'summary');
          if(active())setResult({owner,target:userId,profile:{...details,messaging:first.messaging}});
        } else if(first.canInviteCreated===undefined) {
          // Older servers return the full profile and do not report creator eligibility.
          const mine=await gameService.getMyGames(owner);
          if(active())setResult({owner,target:userId,profile:{...first,canInviteCreated:mine.some(g=>g.createdBy===owner && g.status==='open' && g.startsAt>Date.now())}});
        }
      } catch(error) {
        observeCaughtError(error,{source:'src/components/social/SocialPlayerProfile.tsx',handler:'profile',site:'socialProfile:progressive'});
        if(!active())return;
        const code=String((error as {code?:string})?.code??'');
        if(opened && !/not-found|permission-denied|unauthenticated/.test(code))setDetailError(true);
        else {setResult(null);setFailed(true);}
      } finally {if(active())setBusy(false);}
    })();
    return ()=>{++visit.current;};
  },[me?.id,userId,tick,preview]));
  const profile=preview??(result && result.owner===me?.id&&result.target===userId?result.profile:null);
  const managers=groups.filter(g=>!!me&&g.adminIds.includes(me.id)&&!g.isPersonal);
  const openInvites=async()=>{
    if(preview)return;
    setInvites(true);
    // Reuse this screen's ongoing preload or a recent successful answer.
    // Empty success is cacheable too; a failure always remains retryable.
    if(inviteLoading||(!inviteError&&inviteGamesLoadedAt.current>0&&Date.now()-inviteGamesLoadedAt.current<30000))return;
    setInviteLoading(true);setInviteError(false);setGames([]);
    const owner=me!.id, request=visit.current;
    const active=()=>visit.current===request && useUserStore.getState().currentUser?.id===owner;
    try {
      const [mine,...managed]=await Promise.all([gameService.getMyGames(owner),
        ...managers.map(g=>gameService.getUpcomingGamesForGroup(g.id,true))]);
      if(!active())return;
      const eligible=[...mine,...managed.flat()].filter(g=>g.status==='open' && g.startsAt>Date.now() &&
        (g.createdBy===owner || managers.some(c=>c.id===g.groupId)));
      setGames([...new Map(eligible.map(g=>[g.id,g])).values()].sort((a,b)=>a.startsAt-b.startsAt));
      inviteGamesLoadedAt.current=Date.now();
    } catch(error) {
      observeCaughtError(error,{source:'src/components/social/SocialPlayerProfile.tsx',handler:'openInvites',site:'socialProfile:inviteOptions'});
      if(active())setInviteError(true);
    } finally {if(active())setInviteLoading(false);}
  };
  const send=async(kind:'club'|'game',id:string)=>{
    if(preview||sendingRef.current||sent.includes(`${kind}:${id}`))return;
    const owner=me?.id,target=userId;
    if(!owner)return;
    sendingRef.current=true;setSending(`${kind}:${id}`);
    const active=()=>useUserStore.getState().currentUser?.id===owner&&currentTarget.current===target;
    try{
      if(kind==='club'){const r=await socialPlayersService.inviteToClub(id,userId);if(!active())return;if(r.invited)toast.success('ההזמנה למועדון נשלחה');else{toast.info(r.reason==='already_invited'?'כבר נשלחה לשחקן הזמנה למועדון':r.reason==='rejected'?'קיימת דחייה קודמת. יש לטפל בה לפני שליחת הזמנה':r.reason==='pending'?'השחקן כבר ממתין לאישור הצטרפות':'השחקן כבר חבר במועדון');if(r.reason==='rejected')return;}}
      else{const r=await notificationsService.inviteToGame({recipientId:userId,gameId:id});if(!active())return;if(r.invited)toast.success('ההזמנה למחזור נשלחה');else toast.info(r.reason==='already_registered'?'השחקן כבר רשום למחזור או ממתין לאישור':'כבר נשלחה לשחקן הזמנה למחזור');}
      setSent(old=>[...old,`${kind}:${id}`]);
    }catch (caughtError31b7a947c1){
    observeCaughtError(caughtError31b7a947c1, {"source":"src/components/social/SocialPlayerProfile.tsx","handler":"send","site":"SocialPlayerProfile:31b7a947c1"});if(active())toast.error('לא ניתן לשלוח. ייתכן שההרשמה נסגרה, שהמחזור מלא או שכבר קיימת הזמנה.');}
    finally{sendingRef.current=false;setSending(null);}
  };
  const options=()=>setPlayerOptions(true);
  const removeFriend=()=>{setPlayerOptions(false);if(!me||preview)return;appAlert('הסרת חברות','להסיר את השחקן מרשימת החברים?',[{text:'ביטול',style:'cancel'},{text:'הסר',style:'destructive',onPress:()=>void friendsService.removeFriend(me.id,userId).then(()=>setTick(n=>n+1)).catch((caughtError77f5a3eeee: unknown) =>{ observeCaughtError(caughtError77f5a3eeee, {"source":"src/components/social/SocialPlayerProfile.tsx","handler":"onPress","site":"SocialPlayerProfile:77f5a3eeee"}); return toast.error('לא ניתן להסיר כרגע'); })}]);};
  const blockPlayer=()=>{setPlayerOptions(false);if(!me||preview)return;appAlert('חסימת שחקן','לא תוכל ליצור איתו קשר דרך החיפוש והפרופיל.',[{text:'ביטול',style:'cancel'},{text:'חסום',style:'destructive',onPress:()=>void chatService.blockUser(me.id,userId).then(()=>{setBlocked(true);setResult(null);toast.success('השחקן נחסם');}).catch((caughtError2c1793099d: unknown) =>{ observeCaughtError(caughtError2c1793099d, {"source":"src/components/social/SocialPlayerProfile.tsx","handler":"onPress","site":"SocialPlayerProfile:2c1793099d"}); return toast.error('לא ניתן לחסום כרגע'); })}]);};
  if(busy&&!preview)return <SafeAreaView style={s.root} edges={['top']}><ScreenHeader title="כרטיס שחקן"/><ScrollView contentContainerStyle={[s.content,{paddingTop:4}]}><PlayerCardSkeleton /></ScrollView></SafeAreaView>;
  if(!profile||failed||blocked)return <SafeAreaView style={s.root} edges={['top']}><ScreenHeader title="כרטיס שחקן"/><View style={s.empty}><Text style={s.body}>{blocked?'השחקן נחסם':'לא ניתן להציג את השחקן כרגע.'}</Text>{!blocked?<SocialAction title="נסה שוב" icon="refresh-outline" secondary onPress={()=>setTick(n=>n+1)}/>:null}</View></SafeAreaView>;
  const p=profile.player,stats=profile.canSeeStatistics?profile.cardStats??profile.statistics?.stats:null;
  return <SafeAreaView style={s.root} edges={['top']}>
    <ScreenHeader title="כרטיס שחקן" actions={[{icon:'ellipsis-horizontal',label:'אפשרויות שחקן',onPress:options}]}/>
    <ScrollView contentContainerStyle={[s.content,{paddingTop:4}]}>
      <ImageBackground source={require('@/assets/images/synthetic-pitch.png')} style={local.hero} imageStyle={{borderRadius:14}}>
        <LinearGradient colors={['rgba(235,246,255,0.84)','#F4F7FB']} style={[StyleSheet.absoluteFill,{borderRadius:14}]}/>
        <UserAvatar user={p} size={64} ring/><Text style={local.name}>{p.name}</Text>
        {p.city ? <Text accessibilityLabel={p.city} style={[s.body, local.city]}>{p.city}{' '}<Ionicons name="location-outline" size={15} color="#667796"/></Text> : null}
        {p.friend?<View style={[s.row,local.friend]}><Text style={{fontSize:12,fontWeight:'700',color:'#15803D'}}>חברים</Text><Ionicons name="people" size={15} color="#15803D"/></View>:null}
      </ImageBackground>
      <View style={local.actionRow}>{me||preview?<View style={[local.actionSlot,{flexBasis:138*scale}]}><SocialAction title={profile.messaging==='request'?'בקש שיחה':profile.messaging==='unavailable'?'שיחה אינה זמינה':profile.messaging==='conversation'?'פתח שיחה':'שלח הודעה'} disabled={profile.messaging==='unavailable'} icon="chatbubble-outline" onPress={()=>{if(preview){toast.info('תצוגת המחשה בלבד');return;}if(me)goToDirectChat(dmConvId(me.id,userId));}}/></View>:null}
        {(managers.length>0||profile.canInviteCreated||preview)?<View style={[local.actionSlot,{flexBasis:138*scale}]}><SocialAction title="שלח הזמנה" icon="paper-plane-outline" secondary onPress={()=>void openInvites()}/></View>:null}
      </View>
      {!p.friend && !preview && me ? <FriendActionButton meId={me.id} otherUserId={userId} onChanged={()=>setTick(n=>n+1)}/> : null}
      {detailError?<SocialAction title="טעינת פרטי הכרטיס נכשלה. נסה שוב" icon="refresh-outline" secondary onPress={()=>setTick(n=>n+1)}/>:profile.detailsPending?<ActivityIndicator accessibilityLabel="טוען את פרטי הכרטיס" color="#2563EB"/>:null}
      {!profile.detailsPending && p.friend ? <PairStory name={p.name} summary={profile.pairSummary ?? {sharedRounds:p.sharedRounds,sameTeam:profile.together,against:null,assists:null,lastSharedRoundAt:null}}/> : p.sharedRounds>0||p.commonClubCount>0 ? <View style={s.card}><SocialTitle title="נפגשתם על המגרש" icon="people-outline"/><Text style={s.body}>{p.sharedRounds} מחזורים משותפים · {he.pairStatsSharedCommunitiesPlural(p.commonClubCount)}</Text></View> : null}
      {groupId && profile.canSeeStatistics && profile.clubs.some(c=>c.id===groupId) && groups.some(c=>c.id===groupId&&!!me&&(c.playerIds.includes(me.id)||c.adminIds.includes(me.id))) ? <SocialAction title="להשוואה במועדון" icon="analytics-outline" secondary onPress={()=>nav.navigate('PlayerCompare',{groupId,otherUid:userId,otherName:p.name})}/> : null}
      <PlayerAvailabilitySummary player={p}/>
      {stats?<View style={s.card}><SocialTitle title={`המספרים של ${p.name.split(' ')[0]}`} icon="stats-chart-outline"/>
        <View style={local.statsRow}>{[
          {value:stats.attendedGames,label:'מחזורים',icon:'calendar-outline' as const,color:'#2563EB',background:'#EFF6FF'},
          {value:stats.goals,label:'שערים',icon:'football-outline' as const,color:'#B7790A',background:'#FFFAEB'},
          {value:stats.assists,label:'בישולים',icon:'git-branch-outline' as const,color:'#7C3AED',background:'#F5F0FF'},
        ].map(item=><View key={item.label} style={[local.stat,{flexBasis:75*scale,backgroundColor:item.background}]}><Ionicons name={item.icon} size={22} color={item.color}/><Text style={[local.statValue,{color:item.color}]}>{item.value}</Text><Text style={[s.body,local.statLabel]}>{item.label}</Text></View>)}</View>
        <Pressable accessibilityRole="button" onPress={()=>{if(!preview)nav.navigate('Statistics',{userId});}} style={[s.row,{justifyContent:'space-between',marginTop:6}]}><Text style={{flexShrink:1,color:'#2563EB',fontWeight:'700'}}>לסטטיסטיקה המלאה</Text><Ionicons name="chevron-back" size={19} color="#2563EB"/></Pressable>
      </View>:!profile.canSeeStatistics?<View style={[s.card,{backgroundColor:'#F0F7FF',borderColor:'#D9E9FF'}]}><SocialTitle title={profile.statisticsVisibility==='onlyMe'?'הסטטיסטיקה פרטית':'הסטטיסטיקה זמינה לחברים'} icon="shield-checkmark-outline"/><Text style={s.body}>{profile.statisticsVisibility==='onlyMe'?'השחקן בחר לשמור את הנתונים לעצמו.':'התחברו כדי להכיר את הכדורגל שלו.'}</Text></View>:null}
      {(['common','other'] as const).map(kind=>{const clubs=profile.clubs.filter(c=>{const common=c.isCommon ?? groups.some(g=>g.id===c.id&&!!me&&(g.playerIds.includes(me.id)||g.adminIds.includes(me.id)));return kind==='common'?common:!common;});return clubs.length?<View key={kind} style={{gap:10}}><Text style={[s.title,{flex:0,marginTop:2}]}>{kind==='common'?'המועדונים המשותפים שלכם':'המועדונים הנוספים של השחקן'}</Text><View style={[s.row,{alignItems:'stretch',flexWrap:'wrap'}]}>{clubs.map(c=><Pressable key={c.id} accessibilityRole="button" accessibilityLabel={`צפה במועדון ${c.name}, ${c.isOpen?'פתוח':'סגור'}`} onPress={()=>{if(!preview)nav.navigate(clubRouteFor(c.id),{groupId:c.id});}} style={[local.club,singleClubColumn?local.singleClub:local.clubColumn]}>
        <ImageBackground source={c.coverPhotoUrl?{uri:c.coverPhotoUrl}:getCoverSource(c.coverImageId)??require('@/assets/images/synthetic-pitch.png')} style={local.clubCover}>
          <View style={[local.clubBadge,{width:16+32*scale,backgroundColor:c.isOpen?'#DCFCE7':'#EEF2F7'}]}>
            <Text style={[local.badgeLabel,{color:c.isOpen?'#15803D':'#475569'}]}>{c.isOpen?'פתוח':'סגור'}</Text>
          </View>
        </ImageBackground><Text style={[s.title,local.clubName]}>{c.name}</Text>
      </Pressable>)}</View></View>:null;})}
    </ScrollView>
    <DraggableMenuSheet visible={playerOptions} onClose={()=>setPlayerOptions(false)}><ScrollView style={{flexGrow:0}} contentContainerStyle={[s.content,{paddingBottom:24}]}><SocialTitle title="אפשרויות שחקן" icon="person-outline"/><Text style={s.body}>{p.name}</Text>
      {p.friend?<Pressable accessibilityRole="button" onPress={removeFriend} style={local.option}><Ionicons name="person-remove-outline" size={22} color="#475569"/><Text style={local.optionText}>הסר מחברים</Text></Pressable>:null}
      <Pressable accessibilityRole="button" onPress={()=>{setPlayerOptions(false);if(!preview)nav.navigate('Feedback',{type:'bug',playerId:userId,playerName:p.name});}} style={local.option}><Ionicons name="flag-outline" size={22} color="#475569"/><Text style={local.optionText}>דווח על השחקן</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={blockPlayer} style={local.option}><Ionicons name="ban-outline" size={22} color="#DC2626"/><Text style={[local.optionText,{color:'#DC2626'}]}>חסום שחקן</Text></Pressable>
    </ScrollView></DraggableMenuSheet>
    <DraggableMenuSheet visible={invites} onClose={()=>setInvites(false)}><ScrollView style={{flexGrow:0}} contentContainerStyle={[s.content,{paddingBottom:16}]}><SocialTitle title="שלח הזמנה" icon="paper-plane-outline"/>
      {managers.length?<><Text style={s.title}>למועדון</Text>{managers.map(g=>{const exists=profile.clubs.some(c=>c.id===g.id)||g.pendingPlayerIds?.includes(userId)||sent.includes(`club:${g.id}`);return <SocialAction key={g.id} title={exists?`${g.name} · כבר חבר או הוזמן`:g.name} icon="people-outline" secondary loading={sending===`club:${g.id}`} disabled={!!sending||exists} onPress={()=>void send('club',g.id)}/>;})}</>:null}
      <Text style={s.title}>למחזור</Text>{inviteLoading?<ActivityIndicator color="#2563EB"/>:inviteError?<SocialAction title="לא ניתן לטעון מחזורים — נסה שוב" icon="refresh-outline" secondary onPress={()=>void openInvites()}/>:games.length?games.map(g=>{const exists=[...g.players,...g.waitlist,...(g.pending??[]),...(g.invitedUserIds??[])].includes(userId)||sent.includes(`game:${g.id}`);return <SocialAction key={g.id} title={`${g.title} · ${new Date(g.startsAt).toLocaleDateString('he-IL')}${exists?' · רשום או הוזמן':''}`} icon="calendar-outline" secondary loading={sending===`game:${g.id}`} disabled={!!sending||exists} onPress={()=>void send('game',g.id)}/>;}):<Text style={s.body}>אין כרגע מחזורים פתוחים בניהולך שאפשר להזמין אליהם.</Text>}
    </ScrollView></DraggableMenuSheet>
  </SafeAreaView>;
}
const local=StyleSheet.create({
  option:{flexDirection:'row',alignItems:'center',gap:12,paddingVertical:16,borderTopWidth:1,borderColor:'#E5EDF7'},
  optionText:{flexShrink:1,fontSize:15,fontWeight:'600',color:'#0C1744',textAlign:RTL_LABEL_ALIGN},
  hero:{minHeight:142,alignItems:'center',justifyContent:'center',padding:8,gap:2,overflow:'hidden',borderRadius:14},
  name:{alignSelf:'stretch',fontSize:23,fontWeight:'800',color:'#0C1744',textAlign:'center'},
  city:{alignSelf:'stretch',textAlign:'center'},
  friend:{paddingHorizontal:10,paddingVertical:3,borderRadius:12,backgroundColor:'#DCFCE7'},
  actionRow:{flexDirection:'row',flexWrap:'wrap',gap:10},
  actionSlot:{flexGrow:1,flexShrink:1,minWidth:0},
  statsRow:{flexDirection:'row',flexWrap:'wrap',gap:8,marginTop:4,marginBottom:12},
  stat:{flexGrow:1,flexShrink:1,alignItems:'center',gap:5,paddingVertical:12,borderRadius:12},
  statValue:{alignSelf:'stretch',textAlign:'center',fontSize:24,fontWeight:'800'},
  statLabel:{alignSelf:'stretch',fontSize:12,textAlign:'center',color:'#334155'},
  club:{backgroundColor:'white',borderRadius:12,overflow:'hidden',borderWidth:1,borderColor:'#E5EDF6'},
  clubColumn:{width:'48%',flexGrow:1,maxWidth:'49%'},
  singleClub:{width:'100%'},
  clubCover:{minHeight:88,justifyContent:'flex-end',alignItems:'flex-start',padding:6},
  clubBadge:{maxWidth:'100%',borderRadius:8,paddingHorizontal:6,paddingVertical:3},
  badgeLabel:{fontSize:11,textAlign:'center'},
  clubName:{fontSize:13,flex:0,padding:8},
});
