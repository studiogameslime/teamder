import React, { useEffect, useRef, useState } from 'react';
import { I18nManager, PanResponder, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { UserAvatar } from '@/components/UserAvatar';
import { Button } from '@/components/Button';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SafeModal } from '@/components/SafeModal';
import { appAlert } from '@/components/AppDialog';
import { toast } from '@/components/Toast';
import { RTL_LABEL_ALIGN } from '@/theme';
import { gameService } from '@/services';
import { logError } from '@/services/errorLog';
import { toGuestRosterId, type Game } from '@/types';
import { playersPerTeam, teamName } from '@/utils/draft';
import { teamColor } from '@/components/match/rotationView';
import { createManualDraft, moveManualPlayer, restoreManualTeams, hasManualDraft, manualDraftRevision, manualDragPosition } from '@/utils/manualAllocation';

type Player = {id:string; name:string; avatarId?:string; photoUrl?:string};
type Props = {game:Game; userId:string; players:Player[]; count:number; onBack:()=>void; onSaved:()=>void; preview?:boolean; preferSaved?:boolean};
/** Incomplete working copies stay local: downstream rotation needs non-empty teams. */
export function ManualAllocation({game,userId,players,count,onBack,onSaved,preview=false,preferSaved=false}:Props) {
  const nav = useNavigation();
  const capacity = Math.max(playersPerTeam(game.format), Math.ceil(players.length / count));
  const key = `manual-allocation:${preview?'preview:':''}${userId}:${game.id}`;
  const root=useRef<View>(null);
  const {width:windowWidth}=useWindowDimensions();
  const [origin,setOrigin]=useState({x:0,y:0,width:windowWidth});
  const [teams,setTeams] = useState<string[][]>(()=>Array.from({length:count},(_,i)=>preview&&count===3?players.slice(i*6,i*6+6).map(p=>p.id):[]));
  const [history,setHistory] = useState<string[][][]>([]);
  const [ready,setReady] = useState(false), [saving,setSaving] = useState(false);
  const [dirty,setDirty] = useState(false), [expanded,setExpanded] = useState(false);
  const [search,setSearch] = useState('');
  const [picked,setPicked] = useState<string|null>(null);
  const [batchTarget,setBatchTarget] = useState<number|null>(null);
  const [batch,setBatch] = useState<string[]>([]);

  const [replaceTarget,setReplaceTarget] = useState<number|null>(null);
  const [drag,setDrag] = useState<{id:string;x:number;y:number}|null>(null);
  const lock=useRef(false), allowLeave=useRef(false), scroll=useRef<ScrollView>(null);
  const offset=useRef(0), viewport=useRef<View>(null);
  const targets=useRef<Record<number,View|null>>({});
  const point=useRef<{id:string;x:number;y:number}|null>(null);
  const current=useRef(teams); current.current=teams;
  const dirtyRef=useRef(dirty); dirtyRef.current=dirty;
  const rosterKey=players.map(p=>p.id).sort().join('|');
  useEffect(()=>{ let alive=true;
    AsyncStorage.getItem(key).then(raw=>{
      if(!alive)return;
      if(!preferSaved && hasManualDraft(raw,manualDraftRevision(game.draftTeams))) {const data=JSON.parse(raw!); setTeams(restoreManualTeams(data.teams,players.map(p=>p.id),count,capacity));}
      else if(!preview && game.draftTeams) setTeams(restoreManualTeams(Array.from({length:count},(_,index)=>game.draftTeams?.teams.find(team=>team.index===index)?.playerIds??[]),players.map(p=>p.id),count,capacity));
    }).catch(()=>toast.info('לא הצלחנו לטעון את הטיוטה המקומית')).finally(()=>{if(alive)setReady(true);});
    return()=>{alive=false;};
  },[key]);
  useEffect(()=>{if(ready){setTeams(prev=>restoreManualTeams(prev,players.map(p=>p.id),count,capacity));setHistory([]);}},[rosterKey,count,capacity,ready]);
  useEffect(()=>nav.addListener('beforeRemove',e=>{
    if(allowLeave.current || (!dirtyRef.current && !lock.current))return;
    e.preventDefault();
    if(lock.current)return;
    appAlert('לצאת בלי לשמור?','השינויים האחרונים בחלוקה לא יישמרו.',[
      {text:'המשך עריכה',style:'cancel'},
      {text:'יציאה',onPress:()=>{allowLeave.current=true;nav.dispatch(e.data.action);}},
    ],{tone:'warning'});
  }),[nav]);
  const apply=(next:string[][])=>{
    if(lock.current||!ready||next===current.current)return;
    setHistory(h=>[...h.slice(-29),current.current]);setTeams(next);setDirty(true);
  };
  const move=(id:string,target:number)=>{
    if(target>=0&&current.current[target].includes(id))return;
    if(target>=0&&current.current[target].length>=capacity){setPicked(id);setReplaceTarget(target);return;}
    apply(moveManualPlayer(current.current,id,target,capacity));setPicked(null);
  };
  const drop=(id:string,x:number,y:number)=>{
    // pageX/pageY and measure's page coordinates share the React root basis.
    // Window coordinates can differ when the app is inset inside native UI.
    Object.entries(targets.current).forEach(([index,node])=>node?.measure((_x,_y,w,h,tx,ty)=>{
      if(x>=tx&&x<=tx+w&&y>=ty&&y<=ty+h)move(id,Number(index));
    }));
  };
  const dropRef=useRef(drop);dropRef.current=drop;
  useEffect(()=>{
    if(!drag)return;
    const timer=setInterval(()=>{
      const p=point.current;if(!p)return;
      viewport.current?.measure((_x,_y,_w,h,_pageX,y)=>{
        const delta=p.y<y+65?-22:p.y>y+h-65?22:0;
        if(delta){offset.current=Math.max(0,offset.current+delta);scroll.current?.scrollTo({y:offset.current,animated:false});}
      });
    },70);
    return()=>clearInterval(timer);
  },[!!drag]);
  const assigned=new Set(teams.flat());
  const pool=players.filter(p=>!assigned.has(p.id));
  const filtered=pool.filter(p=>p.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const shown=expanded||search?filtered:filtered.slice(0,6);
  const identity=(id:string)=>players.find(p=>p.id===id)??{id,name:'…'};
  const close=()=>{setPicked(null);setBatchTarget(null);setReplaceTarget(null);setBatch([]);};
  const batchLimitReached = batchTarget !== null && batch.length >= capacity - teams[batchTarget].length;
  const toggleBatchPlayer=(id:string)=>{
    if(batchTarget===null)return;
    const available=capacity-teams[batchTarget].length;
    setBatch(prev=>prev.includes(id) ? prev.filter(selected=>selected!==id) : prev.length>=available ? prev : [...prev,id]);
  };
  const back=()=>{
    if(lock.current)return;
    if(!dirty)return onBack();
    appAlert('לחזור לבחירת שיטה?','השינויים האחרונים לא יישמרו.',[{text:'המשך עריכה',style:'cancel'},{text:'חזרה',onPress:onBack}],{tone:'warning'});
  };
  const save=async()=>{
    if(lock.current||!ready)return;lock.current=true;setSaving(true);
    try{
      await AsyncStorage.setItem(key,JSON.stringify({teams,baseDraftRevision:manualDraftRevision(game.draftTeams)}));
      if(preview || pool.length || teams.some(t=>!t.length)){
        setDirty(false);toast.success('הטיוטה נשמרה במכשיר להמשך השיבוץ');return;
      }
      const fresh=await gameService.getGameById(game.id);
      if(!fresh)throw Error('GAME_NOT_FOUND');
      const freshIds=[...(fresh.players??[]),...(fresh.guests??[]).filter(g=>!g.waitlisted).map(g=>toGuestRosterId(g.id))].sort();
      if(freshIds.join('|')!==rosterKey || fresh.numberOfTeams!==game.numberOfTeams || fresh.format!==game.format)throw Error('DRAFT_ROSTER_CHANGED');
      if(fresh.status==='finished'||fresh.status==='cancelled')throw Error('ROUND_CLOSED');
      await gameService.saveDraftTeams(game.id,{...createManualDraft(teams,userId,Date.now(),fresh.draftTeams?.teams),...(fresh.draftTeams?.completionMode==='balanced'?{completionMode:'balanced' as const,fillMode:'temporary' as const}:{})},undefined,true,game);
      // A cleanup failure must not turn a successful server save into an error.
      await AsyncStorage.removeItem(key).catch(()=>undefined);
      setDirty(false);allowLeave.current=true;toast.success('הכוחות נשמרו כטיוטה');onSaved();
    }catch(error){logError('manualAllocationSave',error,{gameId:game.id});toast.error(error instanceof Error&&error.message==='DRAFT_ROSTER_CHANGED'?'הרכב המחזור השתנה. חזרו למסך החלוקה כדי לטעון את ההרכב המעודכן':error instanceof Error&&error.message==='ROUND_CLOSED'?'לא ניתן לשמור כוחות במחזור שהסתיים או בוטל':'לא הצלחנו לשמור. הטיוטה נשארה במכשיר, נסו שוב');}
    finally{lock.current=false;setSaving(false);}
  };
  const chip=(p:Player, layout: 'pool'|'wide'|'column' = 'pool')=><PlayerChip layout={layout} key={p.id} player={p} disabled={saving||!ready} onPress={()=>setPicked(p.id)}
    onDrag={(x,y)=>{
      const first=!point.current;
      point.current={id:p.id,x,y};
      if(first){
        // Native navigation may finish moving the screen after onLayout.
        // Refresh its settled origin before showing the dragged card.
        root.current?.measure((_x,_y,width,_height,px,py)=>{
          if(point.current?.id!==p.id)return;
          setOrigin({x:px,y:py,width});setDrag(point.current);
        });
      } else setDrag({id:p.id,x,y});
    }}
    onDrop={(x,y)=>{point.current=null;setDrag(null);dropRef.current(p.id,x,y);}} onCancel={()=>{point.current=null;setDrag(null);}}/>;
  return <View ref={root} collapsable={false} onLayout={()=>root.current?.measure((_x,_y,width,_height,x,y)=>setOrigin({x,y,width}))} style={s.root}>
    <ScreenHeader title={preview ? "חלוקה ידנית · תצוגת דמו" : "חלוקה ידנית"} onBack={back}/>
    <View ref={viewport} style={s.flex} collapsable={false}>
      <ScrollView ref={scroll} scrollEnabled={!drag} onScroll={e=>{offset.current=e.nativeEvent.contentOffset.y;}} scrollEventThrottle={16} contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        <Text style={s.hint}>לחצו לבחירת קבוצה, או לחצו ממושכות וגררו</Text>
        <View ref={r=>{targets.current[-1]=r;}} collapsable={false} style={s.card}>
          <Text style={s.title}>טרם שובצו · {pool.length}</Text>
          {!!pool.length&&<TextInput value={search} onChangeText={setSearch} placeholder="חיפוש שחקן" placeholderTextColor="#7284A5" accessibilityLabel="חיפוש שחקן שטרם שובץ" style={s.input}/>}
          <View style={s.chips}>{shown.map(p=>chip(p))}</View>
          {!pool.length&&<Text style={s.hint}>כל השחקנים שובצו. אפשר להעביר ולהחליף בין הקבוצות</Text>}
          {!!pool.length&&!shown.length&&<Text style={s.hint}>לא נמצאו שחקנים בחיפוש</Text>}
          {filtered.length>6&&!search&&<Pressable onPress={()=>setExpanded(!expanded)} style={s.expand}><Text style={s.link}>{expanded?'הצג פחות':`הצג את כל ${pool.length} השחקנים`}</Text><Ionicons name={expanded?'chevron-up':'chevron-down'} size={18} color="#2D68FF"/></Pressable>}
        </View>
        <Text style={s.title}>הקבוצות שלך</Text>
        <View style={s.teamGrid}>{teams.map((ids,index)=>{const color=teamColor(index,game.draftTeams?.teams);return <View key={index} ref={r=>{targets.current[index]=r;}} collapsable={false} style={[s.team,count===2&&s.halfTeam,{backgroundColor:color+'10',borderColor:color+'40'}]}>
          <View style={s.row}><Ionicons name="shirt" size={count===2?22:29} color={color}/><Text numberOfLines={1} style={[s.title,s.flex,count===2&&{fontSize:16}]}>{teamName(index,game.draftTeams?.teams)}</Text>{count!==2&&<Text style={s.count}>{ids.length} מתוך {capacity}</Text>}</View>{count===2&&<Text style={s.count}>{ids.length} מתוך {capacity}</Text>}
          <View style={s.chips}>{ids.map(id=>chip(identity(id),count===2?'column':'wide'))}
            {ids.length<capacity&&<Pressable disabled={saving||!ready||!pool.length} onPress={()=>{setBatchTarget(index);setBatch([]);setSearch('');}} style={[s.add,(ids.length===0||count===2)&&s.wide]} accessibilityLabel={`הוסף שחקנים אל ${teamName(index,game.draftTeams?.teams)}`}><Ionicons name="add-circle-outline" size={24} color="#2D68FF"/><Text style={s.link}>{ids.length?'הוסף':'הוסף שחקנים'}</Text>{!ids.length&&<Text style={s.hint}>בחרו כמה שחקנים יחד</Text>}</Pressable>}
          </View>
        </View>;})}</View>
        <View style={[s.row,s.actions]}><Pressable disabled={!history.length||saving} onPress={()=>{setTeams(history[history.length-1]);setHistory(h=>h.slice(0,-1));setDirty(true);}}><Text style={[s.link,!history.length&&s.muted]}>בטל שינוי אחרון</Text></Pressable>
          <Pressable disabled={saving||!assigned.size} accessibilityRole="button" accessibilityState={{disabled:saving||!assigned.size}} onPress={()=>appAlert('לאפס את החלוקה?','כל השחקנים יחזרו לאזור ״טרם שובצו״, ותוכלו לחלק אותם מחדש. אפשר לבטל את האיפוס באמצעות ״בטל שינוי אחרון״.',[{text:'להמשיך בעריכה',style:'cancel'},{text:'איפוס החלוקה',onPress:()=>apply(Array.from({length:count},()=>[]))}],{tone:'warning',football:true})}><Text style={[s.link,(saving||!assigned.size)&&s.muted]}>איפוס החלוקה</Text></Pressable></View>
      </ScrollView>
    </View>
    {!!drag&&<View pointerEvents="none" style={[s.ghost,manualDragPosition(drag,origin,I18nManager.isRTL)]}><UserAvatar user={identity(drag.id)} size={28}/><Text numberOfLines={1} style={s.name}>{identity(drag.id).name}</Text></View>}
    {!!drag&&<View pointerEvents="none" style={s.dragBanner}><Text style={s.link}>מעבירים את {identity(drag.id).name} — שחררו מעל קבוצה</Text></View>}
    <View style={s.footer}><Text style={s.status}>{pool.length?`נותרו ${pool.length} שחקנים לשיבוץ`:'כל השחקנים שובצו'}</Text>
      <Button title="שמירת טיוטה" style={{borderRadius:18,backgroundColor:'#2D68FF',borderColor:'#2D68FF'}} fullWidth loading={saving} disabled={!ready||!players.length} onPress={save}/>
      <Text style={s.small}>{pool.length||teams.some(t=>!t.length)?'טיוטה חלקית נשמרת אך לא נחשבת כחלוקת כוחות':'אפשר להמשיך לערוך לפני הפרסום'}</Text></View>
    <SafeModal visible={picked!==null||batchTarget!==null} transparent animationType="slide" onRequestClose={close}>
      <View style={s.backdrop}><Pressable style={s.dismiss} onPress={close} accessibilityLabel="סגור"/><View style={s.sheet}>
        <View style={s.row}><Text style={[s.title,s.flex]}>{batchTarget!==null?`שיבוץ אל ${teamName(batchTarget,game.draftTeams?.teams)}`:replaceTarget!==null?'בחרו שחקן להחלפה':`לאן להעביר את ${picked?identity(picked).name:''}?`}</Text><Pressable onPress={close} accessibilityLabel="סגור" hitSlop={12}><Ionicons name="close" size={24}/></Pressable></View>
        <ScrollView keyboardShouldPersistTaps="handled">
          {batchTarget!==null?<><Text style={s.hint}>אפשר לבחור עוד {capacity-teams[batchTarget].length-batch.length} שחקנים</Text><TextInput value={search} onChangeText={setSearch} placeholder="חיפוש שחקן" placeholderTextColor="#7284A5" accessibilityLabel="חיפוש שחקנים לשיבוץ" style={s.input}/>{batchLimitReached&&<Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={{color:'#92400E',backgroundColor:'#FFF3D6',borderRadius:12,padding:12,textAlign:RTL_LABEL_ALIGN,lineHeight:21}}>כל המקומות הפנויים נבחרו. כדי לבחור שחקן אחר, בטלו אחת מהבחירות.</Text>}{filtered.map(p=><Pressable key={p.id} style={s.option} disabled={batchLimitReached&&!batch.includes(p.id)} accessibilityRole="checkbox" accessibilityState={{checked:batch.includes(p.id),disabled:batchLimitReached&&!batch.includes(p.id)}} onPress={()=>toggleBatchPlayer(p.id)}><UserAvatar user={p} size={32}/><Text style={[s.name,s.flex]}>{p.name}</Text><Ionicons name={batch.includes(p.id)?'checkbox':'square-outline'} color={batchLimitReached&&!batch.includes(p.id)?'#CBD2DF':'#2D68FF'} size={24}/></Pressable>)}</>
          :replaceTarget!==null?teams[replaceTarget].map(id=><Pressable key={id} style={s.option} onPress={()=>{if(picked)apply(moveManualPlayer(current.current,picked,replaceTarget,capacity,id));close();}}><UserAvatar user={identity(id)} size={34}/><Text style={s.name}>{identity(id).name}</Text></Pressable>)
          :<>{teams.map((ids,index)=><Pressable key={index} disabled={!!picked&&ids.includes(picked)} style={s.option} onPress={()=>{if(picked)move(picked,index);}}><Ionicons name="shirt" size={25} color={teamColor(index,game.draftTeams?.teams)}/><Text style={[s.name,s.flex]}>{teamName(index,game.draftTeams?.teams)}</Text><Text style={s.hint}>{ids.length>=capacity?'מלאה · החלפת שחקן':`${ids.length} מתוך ${capacity}`}</Text></Pressable>)}{picked&&assigned.has(picked)&&<Button title="החזרה לשחקנים שטרם שובצו" onPress={()=>{move(picked,-1);close();}}/>}</>}
        </ScrollView>
        {batchTarget!==null&&<Button fullWidth title={`שיבוץ ${batch.length} שחקנים`} disabled={!batch.length} onPress={()=>{let next=current.current;for(const id of batch)next=moveManualPlayer(next,id,batchTarget,capacity);apply(next);close();}}/>}
      </View></View>
    </SafeModal>
  </View>;
}
function PlayerChip({layout,player,disabled,onPress,onDrag,onDrop,onCancel}:{layout:'pool'|'wide'|'column';player:Player;disabled:boolean;onPress:()=>void;onDrag:(x:number,y:number)=>void;onDrop:(x:number,y:number)=>void;onCancel:()=>void}) {
  const {fontScale}=useWindowDimensions();
  const callbacks=useRef({disabled,onDrag,onDrop,onCancel});callbacks.current={disabled,onDrag,onDrop,onCancel};
  const armed=useRef(false), captured=useRef(false);
  const pan=useRef(PanResponder.create({
    onMoveShouldSetPanResponderCapture:()=>armed.current&&!callbacks.current.disabled,
    onPanResponderGrant:()=>{captured.current=true;},
    onPanResponderMove:(_,g)=>callbacks.current.onDrag(g.moveX,g.moveY),
    onPanResponderRelease:(_,g)=>{armed.current=false;captured.current=false;callbacks.current.onDrop(g.moveX,g.moveY);},
    onPanResponderTerminate:()=>{armed.current=false;captured.current=false;callbacks.current.onCancel();},
    onPanResponderTerminationRequest:()=>false,
  })).current;
  return <View {...pan.panHandlers} style={[s.chip,layout==='pool'?s.poolChip:layout==='wide'?s.wideChip:s.columnChip]}>
    <Pressable disabled={disabled} onPress={onPress} delayLongPress={350}
      onLongPress={e=>{armed.current=true;callbacks.current.onDrag(e.nativeEvent.pageX,e.nativeEvent.pageY);}}
      onPressOut={()=>{if(armed.current&&!captured.current){armed.current=false;callbacks.current.onCancel();}}}
      style={s.identity}
      accessibilityLabel={`שיבוץ ${player.name}`} accessibilityHint="לחיצה לבחירת קבוצה, לחיצה ממושכת לגרירה">
      <UserAvatar user={player} size={28}/><Text numberOfLines={2} ellipsizeMode="tail" style={[s.name,{lineHeight:18,height:36*fontScale,textAlignVertical:'center'}]}>{player.name}</Text>
    </Pressable>
  </View>;
}
const s=StyleSheet.create({
 teamGrid:{flexDirection:'row',flexWrap:'wrap',gap:10},halfTeam:{width:'48%'},poolChip:{width:'31%'},wideChip:{width:'31%'},columnChip:{width:'100%'},ghost:{position:'absolute',zIndex:50,width:130,padding:8,borderRadius:16,backgroundColor:'#DBEAFF',borderWidth:2,borderColor:'#2D68FF',flexDirection:'row',alignItems:'center',gap:5,elevation:10},
 root:{flex:1,backgroundColor:'#F3F8FF'},flex:{flex:1},body:{padding:14,gap:12,paddingBottom:20},back:{flexDirection:'row',alignItems:'center',paddingHorizontal:16,paddingVertical:9,minHeight:44,gap:3},backLabel:{fontSize:15},card:{backgroundColor:'#FFF',borderWidth:1,borderColor:'#E2ECFB',borderRadius:22,padding:14,gap:10},title:{fontSize:18,fontWeight:'800',color:'#0C1942',textAlign:RTL_LABEL_ALIGN},row:{flexDirection:'row',alignItems:'center',gap:8},stat:{backgroundColor:'#EAF3FF',padding:9,borderRadius:14,color:'#183A77',fontSize:13},hint:{fontSize:12,color:'#7183A3',textAlign:RTL_LABEL_ALIGN,lineHeight:19},input:{borderWidth:1,borderColor:'#D6E3F7',borderRadius:13,padding:10,textAlign:'right',color:'#12234D'},chips:{flexDirection:'row',flexWrap:'wrap',gap:8},chip:{width:'48%',flexDirection:'row',alignItems:'center',borderRadius:15,backgroundColor:'#FFF',borderWidth:1,borderColor:'#DFE8F5',minHeight:51},identity:{flex:1,flexDirection:'row',gap:6,alignItems:'center',padding:7},name:{fontSize:13,color:'#12234D',flexShrink:1,textAlign:RTL_LABEL_ALIGN},link:{color:'#2D68FF',fontSize:14,fontWeight:'600'},expand:{flexDirection:'row',alignItems:'center',justifyContent:'center',paddingTop:8,gap:8},team:{width:'100%',padding:10,borderRadius:22,borderWidth:1,gap:12},count:{fontSize:13,color:'#425B86'},add:{width:'31%',minHeight:55,borderWidth:1,borderStyle:'dashed',borderColor:'#AFC9F4',borderRadius:15,alignItems:'center',justifyContent:'center',padding:9,gap:3},wide:{width:'100%'},actions:{justifyContent:'space-between',paddingVertical:10},muted:{color:'#9AA7BD'},footer:{paddingHorizontal:14,paddingTop:8,paddingBottom:5,backgroundColor:'#FFF',gap:7,borderTopWidth:1,borderColor:'#E3EBF8'},status:{textAlign:'center',fontSize:14,fontWeight:'700',color:'#244A99'},small:{textAlign:'center',fontSize:11,color:'#7B8BA6'},dragBanner:{padding:10,backgroundColor:'#DCEAFF'},backdrop:{flex:1,justifyContent:'flex-end',backgroundColor:'#0006'},dismiss:{...StyleSheet.absoluteFillObject},sheet:{backgroundColor:'#FFF',borderTopLeftRadius:25,borderTopRightRadius:25,padding:18,gap:15,maxHeight:'80%'},option:{flexDirection:'row',alignItems:'center',gap:10,paddingVertical:13,borderBottomWidth:1,borderColor:'#ECF1F8'},
});


