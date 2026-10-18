import { roundJoinAccess, validManagerInvitation, roundAcceptsInvitations } from '../../functions/src/invitationPolicy';

const now = 10000;
const club = { playerIds: ['member'], adminIds: ['manager'] };
const game = { visibility: 'community', createdBy: 'manager' };
const grant = { inviterId: 'manager', expiresAt: now + 1000 };
describe('authoritative invitation access', () => {
  it('rejects a direct request from an uninvited outsider', () => {
    expect(roundJoinAccess(game, 'outsider', club, now)).toBe('denied');
  });
  it('admits members, managers, creators and public applicants', () => {
    for (const uid of ['member', 'manager']) expect(roundJoinAccess(game, uid, club, now)).toBe('member');
    expect(roundJoinAccess({...game, visibility:'public'}, 'outsider', club, now)).toBe('member');
  });
  it('separates filler read access from manager approval', () => {
    expect(roundJoinAccess({...game, invitedUserIds:['outsider']}, 'outsider', club, now)).toBe('candidate');
    expect(validManagerInvitation({...game, invitedUserIds:['outsider']}, 'outsider', club, now)).toBe(false);
    expect(roundJoinAccess({...game, acceptsFillers:true}, 'outsider', club, now)).toBe('candidate');
    expect(roundJoinAccess({...game, visibility:'private', acceptsFillers:true}, 'outsider', club, now)).toBe('denied');
  });
  it('requires a live grant from a current manager', () => {
    const invited = {...game, approvedInvites:{outsider:grant}};
    expect(roundJoinAccess(invited, 'outsider', club, now)).toBe('invited');
    expect(validManagerInvitation(invited, 'outsider', club, grant.expiresAt)).toBe(false);
    expect(roundJoinAccess({...invited,invitedUserIds:['outsider']},'outsider',club,grant.expiresAt)).toBe('denied');
    expect(validManagerInvitation({...invited,createdBy:'other'}, 'outsider', {...club,adminIds:[]}, now)).toBe(false);
    expect(validManagerInvitation({...game,approvedInvites:{outsider:{...grant,inviterId:'member'}}}, 'outsider', club, now)).toBe(false);
  });
  it('does not expose membership from a deleted club', () => {
    expect(roundJoinAccess(game, 'member', {...club,deletedAt:1}, now)).toBe('denied');
  });
  it.each(['finished','cancelled','locked','active'])('does not invite to %s rounds', status => {
    expect(roundAcceptsInvitations({status},now)).toBe(false);
  });
  it('allows scheduled invites but blocks live and past rounds', () => {
    expect(roundAcceptsInvitations({status:'scheduled',startsAt:now+1000},now)).toBe(true);
    expect(roundAcceptsInvitations({status:'open',liveMatch:{phase:'live'}},now)).toBe(false);
    expect(roundAcceptsInvitations({status:'open',startsAt:now-3600001},now)).toBe(false);
  });
});
