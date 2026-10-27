import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';

test('guest invitations never query an absent user profile and old-account results cannot populate the picker',async()=>{
 const effects:any[]=[],states:any[]=[],list=jest.fn();let user:any={id:'guest',isGuest:true};
 const react={createElement:()=>null,useState:(initial:any)=>[initial,(v:any)=>states.push(v)],useEffect:(fn:any)=>effects.push(fn),useMemo:(fn:any)=>fn()};
 const imports:any={react,'react-native':{StyleSheet:{create:(x:any)=>x}},'@/store/userStore':{useUserStore:(fn:any)=>fn({currentUser:user})},
  '@/services/friendsService':{friendsService:{listFriends:list}},'@/services/analyticsService':{AnalyticsEvent:{},logEvent:()=>{}},
  '@/services/errorLog':{logError:jest.fn()},'@/services/staleSession':{isStaleSession:()=>false},
  '@/theme':{colors:{},spacing:{},typography:{}},'@/i18n/he':{he:{}}};
 const module={exports:{} as any};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/components/games/FriendsInvitePicker.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText,
  {module,exports:module.exports,require:(name:string)=>imports[name]??{}});
 const draw=()=>module.exports.FriendsInvitePicker({selected:[],onChange:()=>{}});
 draw();effects.pop()();await Promise.resolve();expect(list).not.toHaveBeenCalled();expect(states).toContain(false);
 let resolve!:(value:any)=>void;list.mockReturnValueOnce(new Promise(yes=>resolve=yes));user={id:'old'};draw();const cleanup=effects.pop()();
 cleanup();states.length=0;resolve([{id:'private-old-friend'}]);await Promise.resolve();await Promise.resolve();
 expect(states).toHaveLength(0);
});
