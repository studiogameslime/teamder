import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';

/** Run production functions without rendering the unrelated native screens. */
function load(file: string, names: string[], context: Record<string, unknown>) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true,
    file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const definitions: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) {
      definitions.push(node.getText(source).replace(/^export /, ''));
    } else if (ts.isMethodDeclaration(node) && names.includes(node.name.getText(source))) {
      definitions.push('const ' + node.name.getText(source) + ' = ({' + node.getText(source) + '}).' + node.name.getText(source) + ';');
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  const sandbox: any = { ...context, exports: {} };
  vm.runInNewContext(ts.transpileModule(definitions.join('\n') + '\nexports.api = {' + names.join(',') + '};', {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, sandbox);
  return sandbox.exports.api;
}

test.each([40, 500, 1001])('manager approval can grow a club with %i members despite its old cap', async count => {
  const club = {id:'club', name:'מועדון', maxMembers:40,
    playerIds:Array.from({length:count}, (_, i)=>`member${i}`), pendingPlayerIds:['new']};
  const updates: any[] = [];
  const dispatch = jest.fn();
  const api = load('src/services/groupService.ts', ['approveMember'], {
    USE_MOCK_DATA:false, getFirebase:()=>({db:{},auth:{currentUser:{uid:'owner'}}}),
    docs:{group:()=> 'club',groupPublic:()=> 'public'},
    runTransaction: async (_: unknown, fn: any)=>fn({
      get:async()=>({exists:()=>true,data:()=>club}),
      update:(_: unknown, patch: any)=>{
        if (!club.playerIds.includes(patch.playerIds)) club.playerIds.push(patch.playerIds);
        club.pendingPlayerIds = club.pendingPlayerIds.filter(id=>id!==patch.pendingPlayerIds);
      },
    }),
    arrayUnion:(id:string)=>id, arrayRemove:(id:string)=>id,
    col:{joinRequests:()=>({})}, query:()=>({}), where:()=>({}), getDocs:async()=>({docs:[]}),
    writeBatch:()=>({update:(_:unknown,patch:unknown)=>updates.push(patch),commit:async()=>{}}),
    notificationsService:{dispatch}, Date,
  });
  const service = {get:async()=>club, ...api};
  await service.approveMember('club','new');
  await service.approveMember('club','new');
  expect(club.playerIds).toHaveLength(count+1);
  expect(club.pendingPlayerIds).toEqual([]);
  expect(updates).toContainEqual(expect.objectContaining({memberCount:count+1}));
  expect(dispatch).toHaveBeenCalledTimes(1);
});

test('old hasRoom filters do not hide large clubs or count as active filters',()=>{
  const api = load('src/components/CommunityFilterSheet.tsx',
    ['hasRegularGames','applyGroupFilters','isGroupFiltersEmpty','activeGroupFiltersCount'], {});
  const club = {id:'large',memberCount:1001,maxMembers:40,isOpen:false};
  const filter = {hasRoom:true,autoJoinOnly:false,freeOnly:false,regularGamesOnly:false,preferredDays:[],nearby:false};
  expect(api.applyGroupFilters([club], filter, {})).toEqual([club]);
  expect(api.isGroupFiltersEmpty(filter)).toBe(true);
  expect(api.activeGroupFiltersCount(filter)).toBe(0);
  expect(api.applyGroupFilters([club], {...filter,autoJoinOnly:true}, {})).toEqual([]);
});

test('large clubs remain in nearby suggestions and membership exclusions still apply',async()=>{
  const directory = [{id:'large',memberCount:1001,maxMembers:40},{id:'mine',memberCount:30}, {id:'small',memberCount:1}];
  const api = load('src/services/nearbyClubsService.ts', ['getNearbyClubs'], {
    loadDirectory:async()=>directory, withAuthRaceRetry:(fn:any)=>fn(), viewerHome:()=>({latLng:null,city:null}),
  });
  const result = await api.getNearbyClubs({id:'me'}, {excludeGroupIds:new Set(['mine']),minMembers:2,limit:10,radiusKm:25});
  expect(result.clubs).toEqual([directory[0]]);
});
