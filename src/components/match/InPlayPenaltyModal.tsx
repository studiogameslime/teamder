import React, {useRef, useState} from 'react';
import {observeCaughtError} from '@/utils/errorObservation';
import {ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {SafeModal} from '@/components/SafeModal';
import {UserAvatar} from '@/components/UserAvatar';
import {penaltyOutcomeButtons} from './penaltyOutcomeButtons';
import {RTL_LABEL_ALIGN} from '@/theme';
import {overlaySurfaces} from '@/theme/overlays';
import {MatchActionPitch} from './MatchActionPitch';
import {MatchPlayerPicker} from './MatchPlayerPicker';
import type {RosterMember} from './rotationView';
import type {InPlayPenalty, PenaltyOutcome} from '@/types';
import {serverNow} from '@/services/serverClock';
import {formatPenaltyClock} from '@/utils/inPlayPenalty';

export interface PenaltyTeam {name:string;color:string;ink:string;players:RosterMember[];keeperId?:string}
export function InPlayPenaltyModal({teams,clockMs,roundNumber,initial,running,onTimer,onSave,onClose,visible=true}: {
  teams:[PenaltyTeam,PenaltyTeam];clockMs:number;roundNumber:number;initial?:InPlayPenalty;
  running:boolean;onTimer:()=>Promise<void>;onSave:(entry:InPlayPenalty)=>Promise<void>;onClose:(retain?:boolean)=>void;visible?:boolean;
}) {
  const {height,width,fontScale}=useWindowDimensions();
  const compact=width<350||height<650;
  const [side,setSide]=useState<'A'|'B'>(initial?.team ?? 'A');
  const [kicker,setKicker]=useState(initial?.kickerId ?? '');
  const [keeper,setKeeper]=useState<string|null>(initial?.keeperId ?? null);
  const [step,setStep]=useState<'kicker'|'result'|'keeper'>(initial ? 'result' : 'kicker');
  const [outcome,setOutcome]=useState<PenaltyOutcome|undefined>(initial?.outcome);
  const [status,setStatus]=useState<'idle'|'saving'|'saved'|'error'>('idle');
  const [error,setError]=useState('');
  const [timerBusy,setTimerBusy]=useState(false);
  const timerWriting=useRef(false);
  const writing=useRef(false), attempt=useRef<InPlayPenalty|null>(null);
  const team=teams[side === 'A' ? 0 : 1], opponent=teams[side === 'A' ? 1 : 0];
  const selectedKicker=team.players.find(p=>p.id===kicker), selectedKeeper=opponent.players.find(p=>p.id===keeper);
  const blocked=status !== 'idle';
  const shownClockMs=attempt.current ? attempt.current.clockMs : initial ? initial.clockMs : clockMs;
  const valid=!!selectedKicker && (!keeper || !!selectedKeeper) && (!!initial || Number.isFinite(clockMs) && clockMs>=0);
  const close=()=>{if(!writing.current) onClose(status==='error');};
  const save=async(result?:PenaltyOutcome)=>{
    if(writing.current || status==='saved' || timerWriting.current || (!attempt.current && (!valid || !result))) return;
    const entry=attempt.current ?? {id:initial?.id ?? `pen_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      team:side,kickerId:kicker,keeperId:keeper,outcome:result!,minute:initial?.minute ?? Math.floor(clockMs/60000)+1,
      ...(shownClockMs !== undefined ? {clockMs:Math.floor(shownClockMs/1000)*1000} : {}),at:initial?.at ?? serverNow()};
    attempt.current=entry; writing.current=true;setOutcome(entry.outcome);setStatus('saving');setError('');
    try {await onSave(entry);setStatus('saved');}
    catch(e) {
      observeCaughtError(e,{source:'src/components/match/InPlayPenaltyModal.tsx',handler:'save',site:'inPlayPenalty:save'});
      setError(e instanceof Error ? e.message : 'לא התקבל אישור לשמירה. נסו שוב.');
      if((e as {code?:string})?.code==='LIVE_ROSTER_CHANGED') {attempt.current=null;setStatus('idle');setKicker('');setKeeper(null);setOutcome(undefined);setStep('kicker');}
      else setStatus('error');
    } finally {writing.current=false;}
  };
  const chooseTeam=(next:'A'|'B')=>{if(blocked)return;setSide(next);setKicker('');setKeeper(null);setOutcome(undefined);setStep('kicker');};
  const pickKicker=(id:string)=>{if(blocked||!team.players.some(p=>p.id===id))return;setKicker(id);setStep(keeper&&selectedKeeper?'result':'keeper');};
  const pickKeeper=(id:string|null)=>{if(blocked||!selectedKicker||(id!==null&&!opponent.players.some(p=>p.id===id)))return;setKeeper(id);setStep('result');};
  return <SafeModal visible={visible} transparent animationType="slide" onRequestClose={close}>
    <View style={s.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="סגירת חלון הפנדל"/>
      <View testID="in-play-penalty-dialog" style={[s.sheet,{height:Math.min(680,Math.floor(height*.92))},compact&&{padding:8,gap:4}]}>
        <View style={s.row}><View style={{flex:1}}><Text style={[s.title,{color:team.ink}]}>פנדל!</Text><Text style={s.sub}>משחק {roundNumber} · {team.name} מול {opponent.name}</Text></View>
          <Pressable onPress={close} disabled={status==='saving'} style={s.icon} accessibilityLabel="סגירה"><Ionicons name="close" size={24} color="#334155"/></Pressable></View>
        <ScrollView style={{flex:1,minHeight:0}} contentContainerStyle={{gap:9,paddingBottom:5,flexGrow:1}} keyboardShouldPersistTaps="handled">
          <View style={s.row}><Text style={[s.sub,{flex:1}]}>{running?'השעון פועל':'השעון עצור'}</Text>
            <Pressable style={s.chip} accessibilityRole="button" accessibilityLabel={running?'השהיית שעון המשחק':'המשך שעון המשחק'} disabled={timerBusy||blocked} onPress={async()=>{if(timerWriting.current||writing.current||blocked)return;timerWriting.current=true;setTimerBusy(true);setError('');try{await onTimer();}catch(error){observeCaughtError(error,{source:'src/components/match/InPlayPenaltyModal.tsx',handler:'onTimer',site:'inPlayPenalty:timer'});setError('עדכון השעון נכשל. אפשר לנסות שוב.');}finally{timerWriting.current=false;setTimerBusy(false);}}}>
              <Text style={s.blue}>{timerBusy?'מעדכנים...':running?'השהיה':'המשך'}</Text></Pressable>
            <Text accessibilityLabel="זמן הפנדל" style={s.clock}>{shownClockMs === undefined ? 'לא תועד' : `⁦${formatPenaltyClock(shownClockMs)}⁩`}</Text></View>
          <MatchActionPitch mode="penalty" visible={visible} height={compact?140:Math.min(242,height*.3)} primary={{player:selectedKicker,label:'בועט',color:team.color,ink:team.ink,teamLabel:team.name,onEdit:()=>setStep('kicker')}}
            secondary={{player:selectedKeeper,label:'שוער',color:opponent.color,ink:opponent.ink,teamLabel:opponent.name,fallback:step==='result'&&keeper===null?'לא ידוע':undefined,onEdit:()=>setStep('keeper')}}
            activeRole={blocked?null:step==='kicker'?'primary':step==='keeper'?'secondary':null} status={status} outcome={outcome} disabled={blocked}
            animationKey={attempt.current?.id} onAnimationComplete={()=>onClose(false)}/>
          <View style={{flexGrow:step==='result'?0:1,flexShrink:0,justifyContent:'center',gap:9,minHeight:step==='result'?0:64+Math.ceil(92*Math.max(1,fontScale))}}>{step==='kicker'?<>
            <Text style={s.label}>למי הפנדל?</Text><View style={s.row}>{teams.map((t,i)=><Pressable key={i} disabled={blocked} onPress={()=>chooseTeam(i===0?'A':'B')} accessibilityRole="radio" accessibilityState={{selected:side===(i===0?'A':'B')}} style={[s.team,{borderColor:side===(i===0?'A':'B')?'#2563EB':'#E2E8F0',backgroundColor:side===(i===0?'A':'B')?'#EFF6FF':'#FFF'}]}><Text style={s.label}>{t.name}</Text><View style={[s.dot,{backgroundColor:t.color}]}/></Pressable>)}</View>
            <MatchPlayerPicker title="מי בועט?" teamLabel={team.name} players={team.players} selectedId={kicker} onSelect={pickKicker} disabled={blocked} color={team.color} ink={team.ink}/>
          </>:step==='keeper'?<>
            <MatchPlayerPicker title="מי בשער?" teamLabel={opponent.name} players={opponent.players} selectedId={keeper} onSelect={pickKeeper} disabled={blocked} color={opponent.color} ink={opponent.ink}/>
            <Pressable disabled={blocked} style={s.chip} onPress={()=>pickKeeper(null)} accessibilityRole="button" accessibilityLabel="השוער לא ידוע"><Text style={s.blue}>השוער לא ידוע</Text></Pressable>
          </>:<>
            <View style={[s.people,fontScale>1.3&&{flexDirection:'column'}]}>{([[selectedKicker,'הבועט',team,'kicker'],[selectedKeeper,'השוער',opponent,'keeper']] as const).map(([player,role,t,next])=><Pressable key={role} disabled={blocked} accessibilityRole="button" accessibilityLabel={`שינוי ${role}`} style={[s.summary,{flex:1,borderColor:t.ink+'60'}]} onPress={()=>setStep(next)}>{player&&<UserAvatar user={player} size={32}/>}<View style={{flex:1,minWidth:0}}><Text style={[s.sub,{fontSize:12}]}>{role}</Text><Text style={[s.label,{fontSize:14}]} numberOfLines={1}>{player?.name??'לא ידוע'}</Text></View><Text style={[s.blue,{fontSize:12}]}>שינוי</Text></Pressable>)}</View>
          </>}</View>
        </ScrollView>
        {step==='result'&&<View style={{gap:8}}><Text style={s.label}>תוצאת הבעיטה</Text>{penaltyOutcomeButtons({onSelect:save,selected:outcome,disabled:blocked||timerBusy||!valid,horizontal:true,stacked:compact&&fontScale>1.3})}</View>}
        {!!error&&<Text accessibilityRole="alert" style={s.error}>{error}{status==='error'?' הבחירות נשמרו. נסו שוב כדי לוודא שהפנדל נשמר פעם אחת.':''}</Text>}
        {status==='saving'&&<ActivityIndicator color="#2563EB" accessibilityLabel="שמירת הפנדל"/>}
        {status==='saved'&&<Text accessibilityLiveRegion="polite" style={s.blue}>הפנדל נשמר</Text>}
        {status==='error'?<Pressable accessibilityRole="button" accessibilityLabel="ניסיון שמירה חוזר" onPress={()=>save()} style={s.save}><Text style={s.saveText}>ניסיון שמירה חוזר</Text></Pressable>:step!=='kicker'&&<Pressable disabled={blocked} style={s.back} onPress={()=>setStep(step==='keeper'?'kicker':'keeper')} accessibilityRole="button"><Text style={s.blue}>{step==='keeper'?'חזרה לבחירת בועט':'חזרה לבחירת שוער'}</Text></Pressable>}
      </View>
    </View>
  </SafeModal>;
}
const s=StyleSheet.create({
  backdrop:{flex:1,backgroundColor:'#0B122080',justifyContent:'flex-end'},
  sheet:{...overlaySurfaces.sheet,width:'100%',padding:16,gap:9,backgroundColor:'#FFF',borderTopLeftRadius:28,borderTopRightRadius:28},
  people:{flexDirection:'row',gap:7},back:{minHeight:44,alignItems:'center',justifyContent:'center'},
  handle:{width:40,height:4,borderRadius:2,backgroundColor:'#CBD5E1',alignSelf:'center'},
  row:{flexDirection:'row',alignItems:'center',gap:8},title:{fontSize:22,fontWeight:'800',color:'#0F172A',textAlign:RTL_LABEL_ALIGN},
  sub:{fontSize:14,color:'#64748B',textAlign:RTL_LABEL_ALIGN},label:{fontSize:16,fontWeight:'700',color:'#1E293B',textAlign:RTL_LABEL_ALIGN,flexShrink:1},
  icon:{padding:10},chip:{padding:10,borderRadius:12,backgroundColor:'#EFF6FF'},blue:{color:'#2563EB',fontWeight:'700'},
  clock:{minWidth:72,borderWidth:1,borderColor:'#CBD5E1',borderRadius:10,padding:8,textAlign:'center',color:'#0F172A',fontSize:17,fontWeight:'700',fontVariant:['tabular-nums']},
  team:{flex:1,minHeight:48,borderWidth:1.5,borderRadius:14,padding:10,flexDirection:'row',gap:8,alignItems:'center',justifyContent:'center'},
  dot:{width:16,height:16,borderRadius:8},summary:{padding:10,borderWidth:1,borderColor:'#E2E8F0',borderRadius:14,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8},
  outcome:{flex:1,minHeight:82,borderWidth:1,borderColor:'#CBD5E1',borderRadius:14,alignItems:'center',justifyContent:'center',padding:8,gap:6},
  outcomeLabel:{fontWeight:'700',fontSize:14,color:'#334155',textAlign:'center'},notice:{backgroundColor:'#F0FDF4',borderRadius:12,padding:12,color:'#166534',textAlign:RTL_LABEL_ALIGN},
  error:{fontSize:14,color:'#B91C1C',textAlign:RTL_LABEL_ALIGN},save:{minHeight:52,alignItems:'center',justifyContent:'center',backgroundColor:'#2563EB',borderRadius:14},saveText:{fontSize:18,fontWeight:'800',color:'#FFF'},
});
