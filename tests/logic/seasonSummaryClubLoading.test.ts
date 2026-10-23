import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import * as personal from '../../src/utils/seasonPersonal';
import * as awards from '../../src/utils/seasonAwards';
import * as club from '../../src/utils/seasonClubSummary';
import * as coverage from '../../src/utils/seasonCoverage';

function service(archive?: Record<string, unknown>, mockMode = false, access: { denyMissingArchive?: boolean; formerMember?: boolean } = {}) {
  const requests: any[] = [];
  const rawPlayers = [
    { userId: 'a', displayName: 'אחד', goals: 6, assists: 2, games: 5, rounds: 100, wins: 4 },
    { userId: 'b', displayName: 'שניים', goals: 2, assists: 3, games: 4, rounds: 80, wins: 3 },
    { userId: 'c', displayName: 'שלוש', goals: 1, games: 3, rounds: 60 },
  ];
  const pair = { a: 'b', b: 'c', sameTeam: 12, winsTogether: 9, winsA: 4, winsB: 1 };
  const getDocs = jest.fn(async (q: any) => {
    requests.push(q);
    const values = q.collection === 'communityPlayerStats' ? rawPlayers : q.collection === 'communityPairStats' ? [pair] : [{ rounds: 20, goals: 10, assists: 5 }];
    const docs = values.map(x => ({ data: () => x }));
    return { docs, forEach: (fn: any) => docs.forEach(fn) };
  });
  const getUserById = jest.fn(async (): Promise<any[]> => []);
  const deps: Record<string, unknown> = {
    './seasonArchiveData': { readSeasonArchiveData: async (_db: unknown, data: unknown) => data },
    '@/firebase/config': { USE_MOCK_DATA: mockMode, getFirebase: () => ({ db: {} }) },
    '@/utils/seasonChoices': { seasonChoices: () => [] },
    '@/services/errorLog': { logError: jest.fn() },
    '@/services/groupService': { groupService: { hydrateUsers: getUserById.mockResolvedValue([]) } },
    '@/utils/seasonPersonal': personal, '@/utils/seasonAwards': awards,
    '@/utils/seasonClubSummary': club, '@/utils/seasonCoverage': coverage,
    'firebase/firestore': {
      doc: (_db: unknown, collection: string) => collection,
      getDoc: async (collection: string) => {
        if ((collection === 'groups' && access.formerMember) || (collection === 'seasonSummary' && !archive && access.denyMissingArchive)) throw Object.assign(new Error('permission denied'), { code: 'permission-denied' });
        return { exists: () => collection === 'groups' || !!archive,
          data: () => collection === 'groups' ? { name: 'מועדון', seasons: { enabled: true, currentId: 's2', currentNo: 2, playedRounds: 5, startedAt: 500 } } : archive };
      },
      collection: (_db: unknown, collection: string) => collection,
      where: (...args: unknown[]) => args,
      query: (collection: string, ...filters: unknown[]) => ({ collection, filters }), getDocs,
    },
  };
  const module = { exports: {} as any };
  const js = ts.transpileModule(fs.readFileSync('src/services/seasonSummaryService.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(js, { module, exports: module.exports, require: (name: string) => deps[name] ?? {}, console });
  return { service: module.exports.seasonSummaryService, getDocs, getUserById, requests };
}

test('an explicit active season does not read its missing and permission-denied archive', async () => {
  const { service: api } = service(undefined, false, { denyMissingArchive: true });
  expect(await api.load({ groupId: 'g', userId: 'a', seasonId: 's2' })).toMatchObject({ closed: false, seasonId: 's2', completedRounds: 5 });
});

test('a former member still reads a frozen archive when club access is denied', async () => {
  const { service: api } = service({ seasonId: 's1', no: 1, completedRounds: 5,
    players: { a: { displayName: 'אחד', games: 5 } }, totals: {}, pairs: {}, awards: {} }, false, { formerMember: true });
  expect(await api.load({ groupId: 'g', userId: 'a', seasonId: 's1' })).toMatchObject({ closed: true, seasonId: 's1' });
});

test('closed club totals, frozen names, ties and non-reader pairs come entirely from the archive', async () => {
  const { service: api, getDocs, getUserById } = service({ groupId: 'g', seasonId: 's1', no: 1, startsAt: 100, endsAt: 200,
    completedRounds: 5, totals: { rounds: 20, goals: 10 },
    players: { a: { displayName: 'שם זהה', games: 5, rounds: 100 }, b: { displayName: 'שם זהה', games: 4, rounds: 80 }, c: { displayName: 'שלוש', games: 3 } },
    pairs: { bc: { a: 'b', b: 'c', sameTeam: 12, winsTogether: 9, winsA: 4 } },
    awards: { deadlyDuo: { winners: ['a__b', 'b__c'], value: 5 } },
  });
  const model = await api.load({ groupId: 'g', userId: 'a', seasonId: 's1' });
  expect(model).toMatchObject({ seasonId: 's1', closed: true, club: { numbers: { games: 20, goals: 10, players: 3 } } });
  expect(model.club.pairs.b__c.winsTogether).toBe(9);
  expect(model.seasonTitles[0].winners.map((p: any) => p.id)).toEqual(['a','b','c']);
  expect(model.names.b).toBe('שם זהה'); expect(model.names.c).toBe('שלוש');
  expect(getDocs).not.toHaveBeenCalled(); expect(getUserById).not.toHaveBeenCalled();
});

test('current club reads every pair, keeps leaders provisional and does not sum player rounds', async () => {
  const { service: api, requests } = service();
  const model = await api.load({ groupId: 'g', userId: 'a', seasonId: 's2' });
  expect(model).toMatchObject({ seasonId: 's2', closed: false, myTitles: [], seasonTitles: [], club: { numbers: { games: 20, goals: 10 } } });
  expect(model.club.leaders.find((a: any) => a.key === 'topScorer')).toMatchObject({ value: 6, names: ['אחד'] });
  expect(model.club.pairs.b__c.winsTogether).toBe(9);
  expect(requests.find(q => q.collection === 'communityPairStats').filters).toEqual([['groupId','==','g']]);
});

test('archived winning duos retain each exact partnership, including a repeated player and duplicate names', async () => {
  const {service:api}=service({seasonId:'s1',no:1,completedRounds:8,players:{a:{displayName:'שם זהה'},b:{displayName:'שם זהה'},c:{displayName:'שלוש'}},pairs:{},totals:{},awards:{deadlyDuo:{winners:['a__b','a__c'],value:2}}});
  const model=await api.load({groupId:'g',userId:'a',seasonId:'s1'});
  const award=model.seasonTitles.find((a:any)=>a.key==='deadlyDuo');
  expect(award.pairs.map((p:any[])=>p.map(w=>w.id))).toEqual([['a','b'],['a','c']]);
  expect(award.pairs[0].map((w:any)=>w.name)).toEqual(['שם זהה','שם זהה']);
});


test.each([undefined, 'percent'])('closed award unit %s survives personal and club readers without recomputing old winners', async valueUnit => {
  const {service:api} = service({seasonId:'s1',no:1,completedRounds:13,players:{a:{displayName:'אחד',games:1,rounds:10,wins:1}},pairs:{},totals:{},awards:{topWinner:{winners:['a'],value:1,...(valueUnit?{valueUnit}:{})}}});
  const model=await api.load({groupId:'g',userId:'a',seasonId:'s1'});
  for(const row of [model.myTitles.find((x:any)=>x.key==='topWinner'),model.seasonTitles.find((x:any)=>x.key==='topWinner')]) {
    expect(row.value).toBe(1);expect(row.valueUnit).toBe(valueUnit);
  }
});

test.each([undefined,'s1'])('all mock award rows carry real fixture identities for avatars: %s', async seasonId => {
  const {service:api}=service(undefined,true);
  const model=await api.load({groupId:'g',userId:'viewer',seasonId});
  const rows=model.closed?model.seasonTitles:model.club.leaders;
  expect(rows.length).toBeGreaterThan(0);
  for(const award of rows) {
    expect(award.winners?.length).toBeGreaterThan(0);
    for(const winner of award.winners) expect(model.names[winner.id]).toBe(winner.name);
  }
});
