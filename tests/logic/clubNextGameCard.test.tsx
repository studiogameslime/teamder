import React from 'react';
jest.mock('@/assets/images/match-football.png',()=>1);
jest.mock('react-native',()=>({View:'View',Text:'Text',Pressable:'Pressable',Image:'Image',StyleSheet:{create:(s:any)=>s}}));
jest.mock('@expo/vector-icons',()=>({Ionicons:'Icon'}));
jest.mock('expo-linear-gradient',()=>({LinearGradient:'Gradient'}));
jest.mock('@/theme',()=>({spacing:{lg:16},RTL_LABEL_ALIGN:'left'}));
import {NextGameCard} from '@/components/community/NextGameCard';
import {he} from '@/i18n/he';
const all=(n:any):any[]=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(all):[n,...all(React.Children.toArray(n.props?.children))];
const text=(n:any):string=>typeof n==='string'||typeof n==='number'?String(n):Array.isArray(n)?n.map(text).join(' '):n&&typeof n==='object'?text(React.Children.toArray(n.props?.children)):'';
const props={startsAt:Date.now()+3600000,fieldName:'מגרש לדוגמה',playersCount:0,maxPlayers:14,format:'7v7' as const,fieldType:'asphalt' as const,coverSource:7};
test('member opens the selected round once and uses the supplied cover and real zero registration',()=>{
 const onPress=jest.fn(),onCoverError=jest.fn();const tree=NextGameCard({...props,onPress,onCoverError});
 expect(tree.props.accessibilityRole).toBe('button');tree.props.onPress();expect(onPress).toHaveBeenCalledTimes(1);
 expect(text(tree)).toContain('0/14');expect(text(tree)).toContain(he.communityNextGameFullCta);
 const photo=all(tree).find(n=>n.type==='Image');expect(photo.props.source).toBe(7);photo.props.onError();expect(onCoverError).toHaveBeenCalledTimes(1);
});
test('public preview remains read-only even if accidentally passed a member action',()=>{
 const onPress=jest.fn();const tree=NextGameCard({...props,onPress,publicPreview:true});
 expect(all(tree).filter(n=>n.type==='Pressable')).toHaveLength(0);expect(text(tree)).not.toContain(he.communityNextGameFullCta);expect(onPress).not.toHaveBeenCalled();
});
test('deferred registration keeps its explanation and delegates member/admin decision to the caller',()=>{
 const onPress=jest.fn();const tree=NextGameCard({...props,registrationOpensAt:Date.now()+7200000,onPress});
 expect(tree.props.accessibilityLabel).toBe(he.communityNextGameLocked);expect(text(tree)).not.toContain(he.communityNextGameFullCta);tree.props.onPress();expect(onPress).toHaveBeenCalledTimes(1);
});
test('no upcoming round retains the optional create action without inventing statistics',()=>{
 const create=jest.fn();const tree=NextGameCard({onCreateRecurring:create});expect(text(tree)).toContain(he.communityNextGameNone);
 all(tree).find(n=>n.type==='Pressable').props.onPress();expect(create).toHaveBeenCalledTimes(1);expect(all(tree).filter(n=>n.type==='Image')).toHaveLength(1);
 expect(text(tree)).not.toContain(he.communityNextGameStatPlayers);expect(text(tree)).not.toContain('0/');
});
