import React, { useCallback, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { GrowthAction, GrowthBadge, GrowthFact, GrowthShell, growthStyles as s } from '../components/GrowthUI';
import { fetchJourneySnapshot, journeyReach, type JourneySnapshot } from '../services/joryioJourneys';
import { observeCaughtError } from '../services/errorObservation';

const statuses: Record<string,string> = {draft:'טיוטה',active:'פעיל',paused:'מושהה',archived:'בארכיון'};
const kinds: Record<string,string> = {trigger:'כניסה',in_app_message:'בתוך האפליקציה',message:'פוש',delay:'המתנה',condition:'בדיקת תנאי'};
const number = (v:number|null) => v === null ? 'לא זמין' : v.toLocaleString('he-IL');
export function JoryioJourneyScreen() {
  const [data,setData] = useState<JourneySnapshot|null>(null);
  const [loading,setLoading] = useState(true);
  const [failed,setFailed] = useState(false);
  const generation = useRef(0);
  const load=useCallback(async(force=false)=>{
    const current=++generation.current;setLoading(true);setFailed(false);
    try { const value=await fetchJourneySnapshot(force);if(current===generation.current)setData(value); }
    catch(error) { observeCaughtError(error,{source:'pulse/src/screens/JoryioJourneyScreen.tsx',handler:'load',site:'journeySnapshot'});if(current===generation.current)setFailed(true); }
    finally { if(current===generation.current)setLoading(false); }
  },[]);
  useFocusEffect(useCallback(()=>{void load();return()=>{++generation.current;};},[load]));
  return <GrowthShell label="מסעות מארגנים" loading={loading} onRefresh={()=>void load(true)}>
    <Text style={s.small}>מהמועדון אל החבורה</Text>
    <Text style={s.title}>מסע הזמנת חברים</Text>
    <Text style={s.body}>כמה כניסות הגיעו לכל שלב, ומה קרה בהודעות.</Text>
    {failed?<View style={s.note}><Text style={s.error}>לא הצלחנו לטעון נתונים מעודכנים. מידע חסר אינו אפס.</Text><GrowthAction label="ניסיון חוזר" onPress={()=>void load(true)}/></View>:null}
    {data?<>
      <View style={s.card}><GrowthBadge warm={data.status!=='active'}>{statuses[data.status]??'מצב לא מוכר'}</GrowthBadge>
        <Text style={s.heading}>{data.name}</Text>
        {data.status==='draft'?<Text style={s.body}>המסע עדיין לא הופעל. אפס כניסות הוא המצב הצפוי.</Text>:null}
        <GrowthFact label="כניסות למסע" value={number(data.entries)}/>
        <GrowthFact label="פעילות עכשיו" value={number(data.active)}/>
        <GrowthFact label="השלימו את הזרימה" value={number(data.completed)}/>
        <GrowthFact label="יצאו מהמסע" value={number(data.exited)}/>
        <GrowthFact label="נכשלו" value={number(data.failed)}/>
      </View>
      <View style={s.note}>
        <Text style={s.body}>עודכן מגוריו: {new Date(data.syncedAt).toLocaleString('he-IL')}</Text>
        <Text style={s.small}>עדכון ידני. רענון המסך קורא את העותק האחרון שנשמר, ואינו מפעיל סנכרון חדש מגוריו.</Text>
        {Date.now()-data.syncedAt>24*60*60*1000?<Text style={s.error}>המידע בן יותר מיום. נדרש סנכרון לפני הסקת מסקנות על המצב הנוכחי.</Text>:null}
        <Text style={s.small}>טווח: כל הזמנים. הספירות הן כניסות למסע ולשלבים, ואינן בהכרח אנשים ייחודיים. השלמת הזרימה אינה הוכחה שהוזמנו חברים.</Text>
      </View>
      {data.steps.map((step,index)=><View key={step.id} style={s.card}>
        <Text style={s.small}>{index+1}. {kinds[step.type]??'שלב במסע'}</Text>
        <Text style={s.heading}>{step.label}</Text>
        <GrowthFact label="נכנסו לשלב" value={number(step.entered)}/>
        <GrowthFact label="התקדמו מהשלב" value={number(step.proceeded)}/>
        <Text style={s.small}>{journeyReach(step.entered,data.entries)}</Text>
        {step.type==='in_app_message'?<><GrowthFact label="הצגות מדווחות" value={number(step.displayed)}/><GrowthFact label="לחיצות מדווחות" value={number(step.clicked)}/><Text style={s.small}>כניסה לשלב יכולה להכניס הודעה לתור. היא אינה הוכחה שההודעה הוצגה.</Text></>:null}
        {step.type==='message'?<><GrowthFact label="שליחות מדווחות" value={number(step.sent)}/><GrowthFact label="לחיצות מדווחות" value={number(step.clicked)}/></>:null}
        {step.type==='condition'?<Text style={s.small}>הספירה היא של בדיקת התנאי. היא אינה מספר העונים עליו בחיוב.</Text>:null}
      </View>)}
    </>:!loading&&!failed?<Text style={s.body}>טרם נשמרו נתוני מסע.</Text>:null}
  </GrowthShell>;
}
