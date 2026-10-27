import React from 'react';
import {Text,View,StyleSheet} from 'react-native';
import {colors,RTL_LABEL_ALIGN} from '../theme';
import {Journal} from '../services/diagnosticTimeline';

const labels:Record<string,string>={bucket:'מסלול הרשמה',success:'שדה הצלחה בתשובה',accepted:'נקלטה בקשה',status:'מצב בתשובה',authPhase:'מצב התחברות',profilePresent:'פרופיל בזיכרון',profileDocumentPresent:'מסמך פרופיל נקרא',profileComplete:'פרופיל מלא',onboardingComplete:'היכרות הושלמה',profileRestoreFailed:'כשל שחזור פרופיל',profileSource:'מקור פרופיל',profileHasPendingWrites:'כתיבת פרופיל ממתינה',role:'תפקיד',groupId:'מועדון',gameId:'מחזור',seasonId:'עונה',gameStatus:'מצב מחזור',playerCount:'רשומים',waitlistCount:'ממתינים',maxPlayers:'מכסת משתתפים',dataSource:'מקור נתוני המחזור',hasPendingWrites:'כתיבה מקומית ממתינה',pendingRequests:'פעולות ממתינות בתיעוד',networkConnected:'חיבור רשת',internetReachable:'נגישות לאינטרנט',networkType:'סוג רשת',networkObserver:'איסוף מצב רשת',appState:'מצב אפליקציה',nativeBuild:'מספר בנייה',codeRevision:'זהות קוד',buildId:'מזהה בנייה',runtimeVersion:'גרסת סביבת הרצה',sportsActivityEnabled:'פעילות ספורט מופעלת',networkObservedAt:'מועד בדיקת רשת',stateCapturedAt:'מועד קריאת מצב',lastResumeAt:'חזרה אחרונה לחזית',appVersion:'גרסת אפליקציה'};
const values:Record<string,string>={players:'רשומים',waitlist:'רשימת המתנה',pending:'ממתין לאישור',unknown:'לא ידוע',signed_out:'ללא התחברות',anonymous:'אורח',authenticated:'מחובר',store:'זיכרון האפליקציה',cache:'מטמון מקומי',server:'שרת',active:'בחזית',background:'ברקע',inactive:'לא פעילה',admin:'מנהל',member:'חבר',none:'ללא חיבור',wifi:'רשת אלחוטית',cellular:'רשת סלולרית',ethernet:'חיבור קווי',other:'אחר',available:'זמין',unavailable:'אינו זמין בבנייה הזו',open:'פתוח',locked:'נעול',finished:'הסתיים',cancelled:'בוטל'};
export const operationLabel=(name:string)=>({join_round:'בקשת הצטרפות למחזור',cancel_round:'ביטול הרשמה למחזור',save_profile:'שמירת פרופיל',sign_in_google:'התחברות באמצעות גוגל',sign_in_apple:'התחברות באמצעות אפל',sign_in_email:'התחברות בדואר אלקטרוני'}[name]??(name.startsWith('call:')?'בקשת שרת':'פעולה'));
function valueText(key:string,value:string|number|boolean){
 if(typeof value==='boolean')return value?'כן':'לא';
 if(typeof value==='number'&&key.endsWith('At'))return new Date(value).toLocaleString('he-IL');
 return values[String(value)]??String(value);
}
function State({data}:{data?:Record<string,string|number|boolean>}){
 return <View style={s.state}>{Object.entries(data??{}).filter(([k])=>labels[k]).map(([key,value])=><Text key={key} selectable style={s.detail}>{labels[key]}: {valueText(key,value)}</Text>)}</View>;
}
export function DiagnosticIncident({journal}:{journal:Journal}){
 const ops=journal.operations??[];
 return <View style={s.card}>
  <Text style={s.title}>מצב בזמן הדיווח</Text>
  <Text style={s.detail}>המצב מתועד בנקודת האיסוף. תזמון סמוך לבדו אינו מוכיח מה גרם לשגיאה.</Text>
  {journal.context?<State data={journal.context}/>:<Text style={s.detail}>לגרסה הזו לא צורפה תמונת מצב מפורטת.</Text>}
  {(journal.operationsOmitted??0)>0?<Text style={s.detail}>{journal.operationsOmitted} שלבי פעולה ישנים הושמטו ממעטפת המצב. ייתכן שחלקם עדיין מופיעים ברצף הפעולות.</Text>:null}
  {ops.length?<Text style={s.title}>מה ניסו לבצע ומה התקבל</Text>:<Text style={s.detail}>לא צורפו שלבי פעולה מפורטים.</Text>}
  {ops.map(op=><View key={op.id} style={s.operation}>
   <Text style={s.title}>{operationLabel(op.name)}: {op.result==='failure'?'נכשלה':op.result==='success'?(op.name.startsWith('call:')?'התקבלה תשובה':'הסתיימה ללא שגיאה'):'טרם הסתיימה בזמן הדיווח'}</Text>
   <Text style={s.detail}>תוצאה צפויה: {op.name==='join_round'?'בקשת הרשמה נקלטה':op.name==='save_profile'?'הפרופיל נשמר':op.name==='cancel_round'?'הביטול הסתיים':op.name.startsWith('call:')?'התקבלה תשובת שרת':'הפעולה הסתיימה ללא שגיאה'}</Text>
   <Text selectable style={s.code}>{op.name} · {op.id}</Text>
   <Text style={s.detail}>התחלה: {new Date(op.startedAt).toLocaleString('he-IL')}{op.durationMs!==undefined?` · משך: ${op.durationMs} מילישניות`:''}</Text>
   {op.code?<Text selectable style={s.code}>{op.code}</Text>:null}
   <Text style={s.title}>לפני הפעולה</Text><State data={op.before}/>
   {op.outcome&&Object.keys(op.outcome).length?<><Text style={s.title}>ערכים בתשובה</Text><State data={op.outcome}/></>:null}
   {op.after?<><Text style={s.title}>אחרי הפעולה</Text><State data={op.after}/></>:null}
  </View>)}
 </View>;
}
export function DiagnosticMetadata({report}:{report?:Record<string,unknown>}){
 if(!report)return null;
 const context=report.lastContext&&typeof report.lastContext==='object'?report.lastContext as Record<string,unknown>:{};
 return <View style={s.card}>
  <Text style={s.title}>פרטי המופע</Text>
  {report.lastMessage?<Text selectable style={s.detail}>{String(report.lastMessage).slice(0,2000)}</Text>:null}
  {['operation','lastCode','appVersion'].map(key=>report[key]?<Text key={key} selectable style={s.code}>{key}: {String(report[key]).slice(0,200)}</Text>:null)}
  {['requestId','failedStage','durationMs','serverRevision'].map(key=>context[key]!==undefined?<Text key={key} selectable style={s.code}>{key}: {String(context[key]).slice(0,160)}</Text>:null)}
  {context.diagnosticEvidenceOmitted===true?<Text style={s.detail}>היומן הושמט מהתיבה המקומית בגלל מגבלת אחסון.</Text>:null}
 </View>;
}
const s=StyleSheet.create({card:{gap:10,padding:12,borderWidth:1,borderColor:colors.border,borderRadius:12},state:{gap:4},operation:{gap:7,padding:10,borderRightWidth:3,borderRightColor:colors.primary,backgroundColor:colors.surface},title:{direction:'rtl' as const,textAlign:RTL_LABEL_ALIGN,color:colors.text,fontSize:13,fontWeight:'700'},detail:{direction:'rtl' as const,textAlign:RTL_LABEL_ALIGN,color:colors.textSoft,fontSize:12},code:{direction:'ltr' as const,writingDirection:'ltr',textAlign:'left',fontSize:11,color:colors.textSoft}});
