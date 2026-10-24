import React, { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ConfirmDestructiveModal } from '@/components/ConfirmDestructiveModal';
import { GameFilterSheet, EMPTY_GAME_FILTERS } from '@/components/GameFilterSheet';
import { EveningScoreInfoSheet } from '@/components/summary/EveningScoreInfoSheet';
import { EveningSummaryCard } from '@/components/summary/EveningSummaryCard';
import { DraggableMenuSheet } from '@/components/DraggableMenuSheet';
import { CoverImagePicker } from '@/components/community/CoverImagePicker';
import { InfoTip } from '@/components/InfoTip';
import { RTL_LABEL_ALIGN } from '@/theme/rtl';
import { HomeGuideOverlay } from '@/components/home/HomeGuideOverlay';
import { RoundReviewSheet } from '@/components/games/RoundReviewSheet';
import { SafeModal } from '@/components/SafeModal';
import { SpringSheet } from '@/components/anim/SpringSheet';
import type { GameFormValues } from '@/screens/games/GameWizardForm';
import { AchievementCelebration } from '@/components/AchievementCelebration';
import { ACHIEVEMENTS } from '@/data/achievements';
import { NativeCampaignView } from '@/components/joryio/NativeCampaignView';
import { ChemistryLoadNotice } from '@/components/chemistry/ChemistrySection';
import { ChatTermsModal } from '@/components/chat/ChatTermsModal';
import { NotificationEducationSheet } from '@/components/notifications/NotificationEducationSheet';
import { IssueCardSheet } from '@/components/community/IssueCardSheet';
import { RegistrationConflictModal } from '@/components/games/RegistrationConflictModal';
import { SeasonConfirmSheet } from '@/components/community/SeasonConfirmSheet';
import { appAlert } from '@/components/AppDialog';
import { AvailabilityNudgeModal } from '@/components/AvailabilityNudgeModal';
import { WinnerPickerModal } from '@/components/match/WinnerPickerModal';
import { EquipmentHandoffModal } from '@/components/match/EquipmentHandoffModal';
import { ManageEquipmentSheet } from '@/components/community/ManageEquipmentSheet';
import { FillerPickerModal } from '@/components/match/FillerPickerModal';
import {BalancedFillModal, type BalancedFillRequest} from '@/components/match/BalancedFillModal';
import {DraftTeamCard} from '@/components/draft/DraftTeamCard';
import { MeasurablePressable, PlayerActionMenu, type PlayerMenuTarget } from '@/components/match/PlayerActionMenu';
import { AppTimeField, AppDateTimeField, DatePickerModal } from '@/components/DateTimeFields';
import { CommunityStatsTable } from '@/components/community/CommunityStatsTable';
import { RetroGoalsSheet } from '@/components/match/RetroGoalsSheet';
import { gameService } from '@/services/gameService';
import { DidYouKnowCard } from '@/components/home/DidYouKnowCard';
import { PlayerAvailabilitySummary } from '@/components/social/PlayerAvailabilitySummary';
import { Button } from '@/components/Button';
import { HomePersonalStats } from '@/components/home/HomePersonalStats';
import { useUserStore } from '@/store/userStore';
import { he } from '@/i18n/he';
import type { ChampionshipRow } from '@/utils/championship';
import { NewClubSeasons, NEW_CLUB_SEASONS_DEFAULT } from '@/components/community/NewClubSeasons';
import { MatchStatsTab } from '@/components/match/tabs/MatchStatsTab';
import { mockGamesV2, mockPlayers } from '@/data/mockData';
import { RichRulesText } from '@/components/community/RichRulesText';
import { SubstitutionModal } from '@/components/match/SubstitutionModal';
import { SignInScreen } from '@/screens/auth/SignInScreen';

const auditPlayers = Array.from({ length: 12 }, (_, i) => ({ id: `audit-player-${i}`, name: `שחקן לדוגמה ${i + 1}`, isFiller: false }));

function AuditBalancedFill({ kind, onClose }: { kind: string; onClose: () => void }) {
  const [request] = useState<BalancedFillRequest>(() => {
    const capacity = kind === 'balanced_fill_eleven' ? 11 : kind === 'balanced_fill_four' ? 4 : 5;
    const sizes = kind === 'balanced_fill_multi' ? [2, 3] : [capacity - 1, capacity - (capacity === 4 ? 0 : 1)];
    const pool = mockPlayers.map(player => ({ id: player.id, name: player.displayName, avatarId: player.avatarId, photoUrl: player.photoUrl }));
    const membersA = pool.slice(0, sizes[0]);
    const membersB = pool.slice(sizes[0], sizes[0] + sizes[1]);
    const donors = pool.slice(sizes[0] + sizes[1], sizes[0] + sizes[1] + (kind === 'balanced_fill_short' ? 1 : 5));
    return {
      sides: [
        { index: 0, label: 'האדומים', color: '#FF3B30', playerIds: membersA.map(p => p.id), members: membersA },
        { index: 2, label: 'הירוקים', color: '#20A875', playerIds: membersB.map(p => p.id), members: membersB },
      ],
      players: donors.map(player => ({ ...player, homeLabel: 'הכחולים' })), capacity, ratings: {}, usage: {},
      ...(kind === 'balanced_fill_sequential' ? { editableSide: 1 as const, fillMode: 'temporary' as const, showUsage: false, showComparison: false } : {}),
    };
  });
  return <BalancedFillModal request={request} onConfirm={onClose} onCancel={onClose}/>;
}

/** Fixtures confined to this mock-only route and one synthetic game id. */
function AuditRetroGoals({ onClose }: { onClose: () => void }) {
  const [ready,setReady]=useState(false);
  const gameId='pulse-audit-retro-only';
  const roster=[{id:'guest:demo',name:'אורח לדוגמה'},...auditPlayers];
  useEffect(()=>{
    let rows=Array.from({length:25},(_,i)=>({id:`retro-demo-${i}`,scorerId:roster[i%roster.length].id,assisterId:i%3===0?roster[(i+1)%roster.length].id:null,addedBy:'demo',at:Date.now()-i*1000}));
    const get=gameService.getRetroGoals,add=gameService.addRetroGoal,remove=gameService.removeRetroGoal;
    gameService.getRetroGoals=async id=>id===gameId?rows:get.call(gameService,id);
    gameService.addRetroGoal=async(...args)=>{if(args[0]!==gameId)return add.apply(gameService,args);rows=[{id:args[3],scorerId:args[1],assisterId:args[2],addedBy:'demo',at:Date.now()},...rows];};
    gameService.removeRetroGoal=async(id,marker)=>{if(id!==gameId)return remove.call(gameService,id,marker);rows=rows.filter(r=>r.id!==marker);};
    setReady(true);
    return()=>{gameService.getRetroGoals=get;gameService.addRetroGoal=add;gameService.removeRetroGoal=remove;};
  },[]);
  return ready?<RetroGoalsSheet visible gameId={gameId} roster={roster} onClose={onClose} onChanged={()=>{}}/>:null;
}

function AuditHomeCards({onClose}:{onClose:()=>void}) {
  const user=useUserStore(state=>state.currentUser);
  const stats={attendedGames:49,totalRegistered:50,attendanceRate:98,goals:38,assists:16,goalsPerEvening:0.8,distinctPlayers:20,mostPlayedWith:{uid:'demo-partner',count:12},mostWinsWith:null,biggestVictim:null,nemesis:null,mostAssistedTo:null,mostAssistedBy:null};
  return <SafeModal visible onRequestClose={onClose}><ScrollView contentContainerStyle={{padding:20,paddingTop:50,gap:20,backgroundColor:'#F5F8FF'}}>
    <Text style={{textAlign:RTL_LABEL_ALIGN}}>בדיקת דמו של רכיבי הבית האמיתיים</Text>
    {user?<HomePersonalStats user={user} onOpen={()=>{}} preview={{stats,partner:{id:'demo-partner',name:'שותף לדוגמה'}}}/>:null}
    <DidYouKnowCard tips={[{title:'טיפ ראשון',text:'התוכן נשאר מוצג גם אחרי המעבר האוטומטי',icon:'football-outline'},{title:'טיפ שני',text:'אפשר לעבור בין הטיפים בלי שהטקסט ייעלם',icon:'people-outline'},{title:'טיפ שלישי',text:'כל מעבר מחזיר את שקיפות התוכן למצב גלוי',icon:'bulb-outline'}]}/>
    <Text onPress={onClose} style={{textAlign:'center',padding:16,color:'#2563EB'}}>סגור בדיקה</Text>
  </ScrollView></SafeModal>;
}

function AuditNewSeasons({onClose}:{onClose:()=>void}) {
  const [value,setValue]=useState(NEW_CLUB_SEASONS_DEFAULT);
  return <SafeModal visible onRequestClose={onClose}><ScrollView contentContainerStyle={{padding:20,paddingTop:70,gap:20,backgroundColor:'#F5F8FF'}}>
    <Text style={{textAlign:RTL_LABEL_ALIGN}}>רכיב העונות האמיתי — טיוטה מקומית בלבד</Text>
    <NewClubSeasons value={value} onChange={setValue}/>
    <Text onPress={onClose} style={{textAlign:'center',padding:20}}>סגירה</Text>
  </ScrollView></SafeModal>;
}

const auditTeams = { method: 'snake' as const, numTeams: 2, createdAt: 1, createdBy: 'audit-only', teams: [
  { index: 0, captainId: auditPlayers[0].id, playerIds: auditPlayers.slice(0, 5).map(p => p.id) },
  { index: 1, captainId: auditPlayers[5].id, playerIds: auditPlayers.slice(5, 10).map(p => p.id) },
] };
const auditFillRequest = { teamLabel: 'הכחולים', players: auditPlayers, recommendedIds: [auditPlayers[0].id, auditPlayers[1].id], requiredCount: 2, savedResult: {a:2,b:1,winner:'האדומים'} };
const auditDate = new Date(2026, 9, 15, 20, 0).getTime();
const policyRows: ChampionshipRow[] = [
  {uid:'audit-full',rounds:50,goals:12,assists:8,asRounds:50,csRounds:50,wins:25,losses:15,ties:10,games:8,cleanSheets:10,ownGoals:0,penTaken:0,penScored:0,penFaced:0,penSaved:0},
  {uid:'audit-partial',rounds:50,goals:12,assists:8,asRounds:40,csRounds:40,wins:25,losses:15,ties:10,games:8,cleanSheets:10,ownGoals:0,penTaken:0,penScored:0,penFaced:0,penSaved:0},
];

function AuditDateTimeFields({ kind, onClose }: { kind: string; onClose: () => void }) {
  const [time, setTime] = useState('20:00');
  const [date, setDate] = useState(auditDate);
  return <View style={{position:'absolute',left:16,right:16,top:220,padding:24,gap:20,borderRadius:24,backgroundColor:'#FFFFFF'}}>
    <Text style={{fontSize:20,textAlign:RTL_LABEL_ALIGN}}>בדיקת בורר — טיוטה מקומית בלבד</Text>
    {kind === 'time' ? <AppTimeField label="שעת המחזור בדמו" value={time} onChange={setTime} /> : <AppDateTimeField label="תאריך ושעה בדמו" value={date} onChange={setDate} />}
    <Text onPress={onClose} accessibilityRole="button" style={{fontSize:18,color:'#1D4ED8',textAlign:RTL_LABEL_ALIGN}}>סגור בדיקה</Text>
  </View>;
}

function AuditPlayerMenu({ onClose }: { onClose: () => void }) {
  const [target, setTarget] = useState<PlayerMenuTarget | null>(null);
  return <>
    <View style={{position:'absolute',bottom:110,right:16,padding:16,backgroundColor:'#FFFFFF',borderRadius:18}}>
      <MeasurablePressable accessibilityLabel="פתח תפריט שחקן בדמו" onMeasured={anchor=>setTarget({player:auditPlayers[0],anchor})}>
        <Text style={{fontSize:18,color:'#1D4ED8'}}>שחקן לדוגמה — פתח תפריט</Text>
      </MeasurablePressable>
    </View>
    <PlayerActionMenu target={target} onClose={()=>{setTarget(null);onClose();}} items={[
      {key:'profile',icon:'person-outline',label:'כרטיס שחקן',onPress:onClose},
      {key:'timeline',icon:'time-outline',label:'היסטוריית השחקן',sublabel:'תצוגת בדיקה מקומית בלבד',onPress:onClose},
      {key:'equipment',icon:'shirt-outline',label:'ניהול ציוד',onPress:onClose},
      {key:'disabled',icon:'ban-outline',label:'פעולה אינה זמינה',sublabel:'פריט מושבת לצורך בדיקת התצוגה',disabled:true,onPress:onClose},
      {key:'return',icon:'return-up-back-outline',label:'החזר למשחק',sublabel:'בדמו הפעולה סוגרת בלבד',onPress:onClose},
    ]} />
  </>;
}

const reviewValues: GameFormValues = {
  title: 'מועדון שכונת שושי', startsAt: new Date(2026, 9, 15, 20).getTime(),
  fieldName: 'הצפון החדש', city: 'תל אביב־יפו', cityFromList: true,
  fieldAddress: 'רחוב לדוגמה 15', fieldType: 'synthetic', format: '5v5',
  numberOfTeams: 3, matchDurationMinutes: '8', advancedMode: true,
  advancedFillMode: 'temporary', advancedTieMode: 'bothOut', ruleTags: ['ללא גליצ׳ים'],
  visibility: 'community', requiresApproval: false, waitlistApprovalRequired: false,
  waitlistApprovalTimeout: '20', recurringGameEnabled: false, scheduledRegEnabled: true,
  registrationOpensAt: new Date(2026, 9, 13, 10).getTime(), publicOpenAt: 0,
  guestsOpenAt: 0, autoTeamsAt: 0, autoTeamsMethod: 'rating', cancelDeadlineHours: undefined,
  acceptsFillers: true, fillerMinTrust: 70, notes: 'נתוני בדיקה מקומיים בלבד',
  bringBall: true, bringShirts: true,
};

/** Real overlay components, isolated from business writes. Never mounted
 * outside the launcher's independent development + mock-data gates. */
export function OverlayAuditPreview({ kind, onClose }: { kind: string; onClose: () => void }) {
  const [filters, setFilters] = useState(EMPTY_GAME_FILTERS);
  useEffect(() => {
    if (kind === 'goal_confirm') appAlert('מחיקת גול', 'למחוק את הגול מהיומן?', [
      {text:'ביטול',style:'cancel',onPress:onClose},
      {text:'מחק',style:'destructive',onPress:onClose},
    ], {onDismiss:onClose});
  }, [kind, onClose]);
  if (kind === 'night_signin') return <SafeModal visible onRequestClose={onClose}><SignInScreen/></SafeModal>;
  if (kind === 'night_rules') return <SafeModal visible onRequestClose={onClose}><ScrollView contentContainerStyle={{padding:24,paddingTop:64,gap:20,backgroundColor:'#F4F7FB'}}>
    <Text style={{fontSize:24,fontWeight:'800',textAlign:RTL_LABEL_ALIGN}}>חוקי המועדון — תצוגת בדיקה</Text>
    <View style={{padding:20,borderRadius:24,backgroundColor:'#FFFFFF'}}><RichRulesText text={'- מגיעים בזמן למחזור\n- משחקים בכבוד ושומרים על **החברים במגרש** גם כשהמשחק צמוד והתוצאה חשובה לכולם\n\nכל השחקנים מוזמנים ליהנות מהכדורגל.'}/></View>
    <Button title="סגירת בדיקה" onPress={onClose}/>
  </ScrollView></SafeModal>;
  if (kind === 'night_substitution') return <SubstitutionModal visible running={false} capacity={5} onClose={onClose} onSwap={onClose} onMove={onClose} teams={[
    {index:0,label:'האדומים',color:'#EF4444',playing:true,roster:auditPlayers.slice(0,5)},
    {index:1,label:'הכחולים',color:'#2563EB',playing:true,roster:auditPlayers.slice(5,10)},
    {index:2,label:'הירוקים',color:'#16A34A',playing:false,position:0,roster:auditPlayers.slice(10)},
  ]}/>;
  if (kind === 'pulse_review') return <SafeModal visible onRequestClose={onClose} animationType="none"><ScrollView contentContainerStyle={{padding:20,paddingTop:52,gap:20,backgroundColor:'#F4F7FB'}}>
    <PlayerAvailabilitySummary player={{id:'pulse-demo',name:'שחקן לדוגמה',city:'קריית עקרון',friend:false,commonClubCount:0,sharedRounds:0,availability:{preferredDays:[0,1,2,3,4,5,6],preferredTimes:[],isAvailableForInvites:true}}}/>
    <DidYouKnowCard tips={[{title:'החבר׳ה במקום אחד',text:'אפשר להזמין חברים למועדון באמצעות קישור.',icon:'person-add-outline'},{title:'הכדורגל שלכם',text:'כל המחזורים, החברים והמועדונים נמצאים כאן. אפשר להכיר את השחקנים ולתאם יחד מתי נפגשים שוב על המגרש.',icon:'football-outline'}]}/>
    <Button title="חלונית הגדרות עונה" onPress={()=>appAlert('השינויים בעונה עדיין לא נשמרו','שינית את הגדרות העונה. כדי לשמור אותן, לחץ קודם על ״שמור הגדרות עונה״. אחר כך תוכל לשמור את פרטי המועדון.',undefined,{football:true,tone:'warning'})}/>
    <Button title="סגור תצוגת בדיקה" onPress={onClose}/>
  </ScrollView></SafeModal>;
  if (kind === 'retro_list') return <AuditRetroGoals onClose={onClose}/>;
  if (kind === 'home_cards') return <AuditHomeCards onClose={onClose}/>;
  if (kind === 'new_seasons') return <AuditNewSeasons onClose={onClose}/>;
  if (kind === 'stats_empty') return <SafeModal visible onRequestClose={onClose}><View style={{flex:1,paddingTop:50}}><MatchStatsTab game={mockGamesV2.find(g=>g.id==='gv2-live')!} summary={null} nameOf={()=>''} userOf={id=>({id,name:''})} hasPlayed={false} onOpenPersonalSummary={()=>{}} showPersonalSummary={false}/><Text onPress={onClose} style={{padding:20,textAlign:'center'}}>סגירה</Text></View></SafeModal>;
  if (kind === 'goal_confirm') return null;
  if (kind === 'balanced_teams') return <SafeModal visible onRequestClose={onClose}><ScrollView contentContainerStyle={{padding:20,paddingTop:50,gap:16,backgroundColor:'#F5F8FF'}}>
    <Text style={{fontSize:26,fontWeight:'800',textAlign:RTL_LABEL_ALIGN}}>הכוחות</Text><Text style={{textAlign:RTL_LABEL_ALIGN}}>13 שחקנים · 3 קבוצות · 5 על 5</Text><Text style={{textAlign:RTL_LABEL_ALIGN,color:'#2865FF'}}>קבוצות עם השלמות · לפני כל משחק משלימים מהקבוצה שממתינה</Text>
    {[[0,5],[5,9],[9,13]].map(([from,to],index)=>{const users=Array.from({length:13},(_,i)=>({id:`audit-${i}`,name:['מתן','אלירן','אורי','דניאל','איתי','אופק','רועי','יובל','נועם','עידן','עומר','ליאור','שי'][i],avatarId:'a01'})).slice(from,to);return <DraftTeamCard key={index} index={index} captain={users[0]} members={users.slice(1)} completionCapacity={5}/>;})}
    <Text onPress={onClose} style={{textAlign:'center',color:'#2865FF',padding:16}}>סגירה</Text>
  </ScrollView></SafeModal>;
  if (kind.startsWith('balanced_fill')) return <AuditBalancedFill key={kind} kind={kind} onClose={onClose}/>;
  if (kind === 'summary_policy') return <DraggableMenuSheet visible onClose={onClose}><ScrollView contentContainerStyle={{padding:16}}><EveningSummaryCard model={{gameId:'audit-only',uid:'audit-only',playerName:'שחקן לדוגמה',dateLabel:'15.10.2026',communityName:'מועדון לדוגמה',rounds:4,totalRounds:4,totalKnown:true,wins:2,losses:1,winRate:50,goals:2,assists:1,score:8,title:'',titleEmoji:'',insights:[],scoreDelta:null,rank:null,rankTotal:null,rankDelta:null,scoreRank:null,scoreTotal:null,metrics:[],heldPitch:0,teamGoalsFor:0,teamGoalsAgainst:0}} /></ScrollView></DraggableMenuSheet>;
  if (kind === 'season_restart') return <SeasonConfirmSheet visible reactivation plan={{ok:true,playedHistory:0,sealsSeason1:false,activeSeasonNo:1,startsAtRounds:0,targetRounds:12,roundsRemaining:12}} cadence="rounds" months={3} rounds={12} seasonNo={1} busy={false} onCancel={onClose} onConfirm={onClose} />;
  if (kind === 'retro_policy') return <RetroGoalsSheet visible gameId="audit-policy-only" roster={[]} onChanged={()=>{}} onClose={onClose} />;
  if (kind === 'coaching_policy') return <AchievementCelebration items={[{def:ACHIEVEMENTS.find(d=>d.id==='coaching')!,tier:'bronze',value:10}]} onDone={onClose} />;
  if (kind === 'efficiency_policy') return <DraggableMenuSheet visible onClose={onClose}><ScrollView contentContainerStyle={{padding:16,gap:16}}>
    <Text style={{fontSize:20,fontWeight:'700',textAlign:RTL_LABEL_ALIGN}}>כיסוי נתונים בטבלת היעילות</Text>
    <CommunityStatsTable players={policyRows} mode="efficiency" clubRounds={50} guestNames={{'audit-full':'כיסוי מלא','audit-partial':'כיסוי חלקי'}} />
    <Text style={{fontSize:15,textAlign:RTL_LABEL_ALIGN}}>{he.effPartialNote}</Text>
    <Text style={{fontSize:18,fontWeight:'700',textAlign:RTL_LABEL_ALIGN}}>{he.communityStatsPenaltyKing}</Text>
    <Text style={{fontSize:15,textAlign:RTL_LABEL_ALIGN}}>{he.communityPenaltyRankingNote}</Text>
    <Text style={{fontSize:16,textAlign:RTL_LABEL_ALIGN}}>תארי עונה: {he.seasonTitleNames.penaltyKing} · {he.seasonTitleNames.penaltyKeeper}</Text>
  </ScrollView></DraggableMenuSheet>;
  if (kind === 'date') return <DatePickerModal visible initial={auditDate} onConfirm={onClose} onClose={onClose} />;
  if (kind === 'time' || kind === 'datetime') return <AuditDateTimeFields kind={kind} onClose={onClose} />;
  if (kind === 'filler' || kind === 'filler_empty') return <FillerPickerModal request={kind === 'filler_empty' ? {...auditFillRequest,players:[],recommendedIds:[]} : auditFillRequest} onConfirm={onClose} onCancel={onClose} />;
  if (kind === 'manage_equipment') return <ManageEquipmentSheet visible playerName="שחקן לדוגמה" initial={{ball:true,jerseys:false}} saving={false} onSave={onClose} onClose={onClose} />;
  if (kind === 'player_menu') return <AuditPlayerMenu onClose={onClose} />;
  if (kind === 'availability_nudge') return <AvailabilityNudgeModal visible onClose={onClose} onConfirm={onClose} />;
  if (kind === 'winner') return <WinnerPickerModal visible draftTeams={auditTeams} rotation={{playing:[0,1],waiting:[],loans:[],wins:{'0':2,'1':1}}} playersMap={Object.fromEntries(auditPlayers.map(p=>[p.id,{displayName:p.name}]))} onPick={onClose} onClose={onClose} />;
  if (kind === 'equipment') return <EquipmentHandoffModal visible players={auditPlayers} initial={{ballHolderIds:[auditPlayers[0].id],jerseysHolderIds:[auditPlayers[1].id]}} onSave={onClose} onSkip={onClose} />;
  if (kind === 'chat_terms') return <ChatTermsModal visible onAccept={onClose} onClose={onClose} />;
  if (kind === 'notification' || kind === 'notification_blocked') return <NotificationEducationSheet visible context="join_game" blocked={kind === 'notification_blocked'} onAction={onClose} />;
  if (kind === 'issue_card') return <IssueCardSheet visible playerName="שחקן לדוגמה" cardType="yellow" saving={false} onSave={onClose} onClose={onClose} />;
  if (kind === 'conflict') return <RegistrationConflictModal conflict={{gameId:'audit-only',title:'מחזור לדוגמה',groupId:'audit',startsAt:reviewValues.startsAt}} communities={[{id:'audit',name:'מועדון לדוגמה'}]} targetGroupId="other" targetStartsAt={reviewValues.startsAt + 30 * 60 * 1000} onCancelOther={onClose} onViewOther={onClose} onClose={onClose} />;
  if (kind === 'season_confirm') return <SeasonConfirmSheet visible plan={{ok:true,playedHistory:8,sealsSeason1:false,activeSeasonNo:1,startsAtRounds:8,targetRounds:12,roundsRemaining:4}} cadence="rounds" months={3} rounds={12} seasonNo={2} busy={false} onCancel={onClose} onConfirm={onClose} />;
  if (kind === 'chemistry_error') return <DraggableMenuSheet visible onClose={onClose}><View style={{ padding: 24, gap: 18 }}><Text style={{ fontSize: 22, fontWeight: '800', textAlign: RTL_LABEL_ALIGN }}>כימיה במועדון</Text><ChemistryLoadNotice failed onRetry={onClose} /></View></DraggableMenuSheet>;
  if (kind === 'campaign' || kind === 'campaign_custom' || kind === 'campaign_banner' || kind === 'campaign_long') return <NativeCampaignView msg={{
    id: 'local-audit-only', name: 'בדיקה מנותקת', kind: 'native', priority: 0,
    type: kind === 'campaign_banner' ? 'banner' : 'modal', closeButton: true, backdropDismissible: true,
    title: 'הכדורגל שלך, במקום אחד', body: kind === 'campaign_long' ? Array.from({ length: 24 }, (_, i) => `פרט ${i + 1}: מוצאים מחזור, מכירים שחקנים ועוקבים אחרי ההתקדמות. זו בדיקת תוכן ארוך בלבד.`).join('\n\n') : 'מוצאים את המחזור הבא, מכירים שחקנים ועוקבים אחרי המספרים שלך. זו תצוגת בדיקה מקומית בלבד.',
    buttons: [{ id: 'close', text: 'הבנתי', action: 'dismiss' }, { id: 'later', text: 'אחר כך', action: 'dismiss' }],
    ...(kind === 'campaign_custom' ? { style: { backgroundColor: '#EAF7EF', textColor: '#133F2B', primaryButtonColor: '#15803D', primaryButtonTextColor: '#FFFFFF', cornerRadius: 12, textAlign: 'center' as const } } : {}),
  }} onClose={onClose} onButton={onClose} />;
  if (kind === 'celebration') return <AchievementCelebration items={[{ def: ACHIEVEMENTS[0], tier: 'silver', value: 20 }]} onDone={onClose} />;
  if (kind === 'guide') return <HomeGuideOverlay visible onClose={onClose} />;
  if (kind === 'review' || kind === 'review_busy') return <SafeModal visible transparent animationType="none" onRequestClose={kind === 'review_busy' ? () => {} : onClose}>
    <SpringSheet visible onBackdropPress={kind === 'review_busy' ? undefined : onClose}>
      <RoundReviewSheet values={reviewValues} maxPlayers={15} quick={false} isEdit={false} busy={kind === 'review_busy'} onConfirm={onClose} onClose={onClose} />
    </SpringSheet>
  </SafeModal>;
  if (kind === 'confirm') return <ConfirmDialog visible title="ההרשמה עדיין לא נפתחה" body="אפשר לבדוק את פרטי המחזור ולחזור כשההרשמה תיפתח. זוהי תצוגת בדיקה בלבד." tone="warning" confirmLabel="הבנתי" cancelLabel="חזרה" onConfirm={onClose} onClose={onClose} />;
  if (kind === 'destructive') return <ConfirmDestructiveModal visible title="לבטל את ההרשמה?" body="המקום שלך יתפנה לשחקן הבא בתור. זוהי תצוגת בדיקה בלבד והכפתור סוגר את החלונית בלבד." confirmLabel="אישור ביטול" onConfirm={onClose} onClose={onClose} />;
  if (kind === 'filter') return <GameFilterSheet visible filters={filters} onChange={setFilters} onClose={onClose} matchCount={12} />;
  if (kind === 'score') return <EveningScoreInfoSheet visible onClose={onClose} />;
  if (kind === 'cover') return <CoverImagePicker visible selectedId="c1" onSelectBuiltin={onClose} onUploadFromDevice={onClose} onClose={onClose} />;
  return <DraggableMenuSheet visible onClose={onClose}>
    <ScrollView contentContainerStyle={{ padding: 24, gap: 18 }}>
      <Text style={{ fontSize: 22, fontWeight: '800', textAlign: RTL_LABEL_ALIGN, color: '#0C1744' }}>בדיקת חלונית מידע</Text>
      <View style={{ alignItems: 'flex-start' }}><InfoTip title="איך נמדדים הנתונים?" text="הנתונים מתייחסים למחזור שנבחר. משחק שלא תועד אינו מוצג כאילו הסתיים בלי שערים. זהו תוכן בדיקה מקומי בלבד." size={28} /></View>
      {Array.from({ length: 12 }, (_, i) => <Text key={i} style={{ fontSize: 16, lineHeight: 26, textAlign: RTL_LABEL_ALIGN, color: '#475569' }}>פרט {i + 1} — בדיקת גלילה, יישור עברית ושמירת כפתור הסגירה. הנתונים כאן להמחשה בלבד.</Text>)}
    </ScrollView>
  </DraggableMenuSheet>;
}
