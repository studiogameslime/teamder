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
import { MeasurablePressable, PlayerActionMenu, type PlayerMenuTarget } from '@/components/match/PlayerActionMenu';
import { AppTimeField, AppDateTimeField, DatePickerModal } from '@/components/DateTimeFields';
import { CommunityStatsTable } from '@/components/community/CommunityStatsTable';
import { RetroGoalsSheet } from '@/components/match/RetroGoalsSheet';
import { he } from '@/i18n/he';
import type { ChampionshipRow } from '@/utils/championship';

const auditPlayers = Array.from({ length: 12 }, (_, i) => ({ id: `audit-player-${i}`, name: `שחקן לדוגמה ${i + 1}` }));
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
  if (kind === 'goal_confirm') return null;
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
