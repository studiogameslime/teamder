import React from 'react';
jest.mock('react-native',()=>({View:'View',Text:'Text',StyleSheet:{create:(v:any)=>v}}));
jest.mock('@expo/vector-icons',()=>({Ionicons:'Icon'}));
jest.mock('@/components/UserAvatar',()=>({UserAvatar:'Avatar'}));
jest.mock('@/components/match/TeamShirt',()=>({TeamShirtIllustration:'Shirt'}));
jest.mock('@/components/match/MatchResultPanel',()=>({MatchResultPanel:'Result'}));
jest.mock('@/components/match/rotationView',()=>({teamColor:(i:number)=>['red','blue','green'][i],teamName:(i:number)=>['האדומים','הכחולים','הירוקים'][i]}));
jest.mock('@/theme',()=>({RTL_LABEL_ALIGN:'left'}));
import {shootoutOutcome,ShootoutLogRow,ShootoutScorePanel,ShootoutNextMatch} from '@/components/match/ShootoutSummaryViews';
const nodes=(n:any):any[]=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(nodes):[n,...nodes(React.Children.toArray(n.props?.children))];
const copy=(n:any):string=>typeof n==='string'||typeof n==='number'?String(n):Array.isArray(n)?n.map(copy).join(' '):n&&typeof n==='object'?copy(React.Children.toArray(n.props?.children)):'';
const draftTeams:any={teams:[0,1,2].map(index=>({index,playerIds:[]}))},rotation:any={playing:[1,0],waiting:[2],loans:[],round:1};
const kick:any={id:'k',team:'B',kickerId:'red',keeperId:'blue',outcome:'save',scored:false,at:1};
test('row keeps actual kicker, opposing keeper, avatar identities and reordered team colours',()=>{
 const resolve=(id:string)=>({displayName:id==='red'?'בועט אדום':'שוער כחול',avatarId:id});
 const tree=ShootoutLogRow({kick,index:0,draftTeams,rotation,resolve,compact:false});
 expect(nodes(tree).filter(n=>n.type==='Avatar').map(n=>n.props.user)).toEqual([expect.objectContaining({id:'red',name:'בועט אדום',avatarId:'red'}),expect.objectContaining({id:'blue',name:'שוער כחול',avatarId:'blue'})]);
 expect(copy(tree)).toContain('מול ⁨שוער כחול⁩ · הכחולים');expect(copy(tree)).toContain('האדומים');expect(copy(tree)).toContain('עצירה');
 expect(nodes(tree).find(n=>n.type==='Shirt').props.color).toBe('red');
});
test('legacy non-goal stays unspecified rather than claiming a goalkeeper save or off-target shot',()=>{
 expect(shootoutOutcome({...kick,outcome:undefined}).label).toBe('לא הובקע');
 expect(shootoutOutcome({...kick,outcome:'miss'}).label).toBe('החטאה');expect(shootoutOutcome(kick).label).toBe('עצירה');
});
test('penalty panel counts attempts separately from successful kicks, leaving regulation score outside its input',()=>{
 const panel=ShootoutScorePanel({draftTeams,rotation,kicks:[{...kick,team:'A',id:'1',scored:true,outcome:'goal'},kick,{...kick,id:'3',outcome:'miss'}],compact:false});
 expect(panel.props.live).toEqual({scoreA:1,scoreB:0});expect(copy(panel.props.teamDetails('A'))).toContain('בעיטה אחת');expect(copy(panel.props.teamDetails('B'))).toContain('2 בעיטות');
});
test('preview shows incoming and outgoing teams; without waiting both current teams stay',()=>{
 const tree=ShootoutNextMatch({draftTeams,rotation,winner:'B'});expect(copy(tree)).toContain('האדומים');expect(copy(tree)).toContain('הירוקים');expect(copy(tree)).toContain('הכחולים עוברים להמתנה');
 const noQueue=ShootoutNextMatch({draftTeams,rotation:{...rotation,waiting:[]},winner:'B'});expect(copy(noQueue)).toContain('שתי הקבוצות נשארות');expect(copy(noQueue)).not.toContain('עולים');
});

test('a Latin keeper name is isolated inside the Hebrew opponent line',()=>{
 const tree=ShootoutLogRow({kick,index:0,draftTeams,rotation,resolve:()=>({displayName:'Linoy Levi'}),compact:true});
 expect(copy(tree)).toContain('מול ⁨Linoy Levi⁩ · הכחולים');
});
