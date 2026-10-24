import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RtlTextInput } from './RtlTextInput';
import { growthColors as c, growthStyles as s } from './GrowthUI';
import { RTL_INPUT_ALIGN } from '../theme';
import { observeCaughtError } from '../services/errorObservation';

/** Personal working notes live on this Pulse device; they never message a user. */
export function GrowthNotes({subject}:{subject:string}){
 const [value,setValue]=useState('');const [saved,setSaved]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState(false);const [ready,setReady]=useState(false);const [attempt,setAttempt]=useState(0);const generation=useRef(0);
 useEffect(()=>{const request=++generation.current;setReady(false);setBusy(false);setValue('');setSaved(false);setError(false);
  void AsyncStorage.getItem(`pulse.growth.note:${subject}`).then(note=>{if(request===generation.current){setValue(note??'');setReady(true)}}).catch(e=>{observeCaughtError(e,{source:'pulse/src/components/GrowthNotes.tsx',handler:'load',site:'GrowthNotes:load'});if(request===generation.current){setError(true);setReady(false)}});
  return()=>{generation.current++};
 },[subject,attempt]);
 const save=async()=>{if(!ready||busy)return;const request=generation.current;setBusy(true);setError(false);try{await AsyncStorage.setItem(`pulse.growth.note:${subject}`,value);if(request===generation.current)setSaved(true)}catch(e){observeCaughtError(e,{source:'pulse/src/components/GrowthNotes.tsx',handler:'save',site:'GrowthNotes:save'});if(request===generation.current)setError(true)}finally{if(request===generation.current)setBusy(false)}};
 return <View style={s.card}><Text style={s.heading}>מחברת היכרות</Text><Text style={s.small}>הערות אישיות במכשיר הזה בלבד. אינן נשלחות למשתמש ואינן מסתנכרנות למכשירים אחרים.</Text><RtlTextInput accessibilityLabel="הערות היכרות אישיות" multiline editable={ready&&!busy} value={value} onChangeText={v=>{setValue(v);setSaved(false)}} placeholder="מה הוא מחפש? מה סיכמנו לבדוק בהמשך?" placeholderTextColor={c.muted} style={{color:c.ink,backgroundColor:c.bg,padding:13,borderRadius:12,minHeight:100,textAlign:RTL_INPUT_ALIGN,textAlignVertical:'top'}}/><Pressable accessibilityRole="button" disabled={!ready||busy} onPress={()=>void save()} style={[s.button,{opacity:ready&&!busy?1:.5}]}><Text style={s.buttonText}>{busy?'שומר…':saved?'נשמר במכשיר':'שמירת הערה'}</Text></Pressable>{error?<><Text style={s.error}>לא ניתן לקרוא או לשמור את ההערה כרגע. הטקסט הנוכחי לא נמחק.</Text>{!ready?<Pressable accessibilityRole="button" onPress={()=>setAttempt(v=>v+1)}><Text style={s.link}>ניסיון קריאה נוסף</Text></Pressable>:null}</>:null}</View>;
}
