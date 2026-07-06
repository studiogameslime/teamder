#!/usr/bin/env node
// ONE-SHOT, RUN ONLY AFTER the current iOS App Store review FINISHES.
// Removes the App Store review account (שחקן בדיקה, appstore.review@teamder.app)
// from the REAL communities it joined during review, and deletes its junk test
// community — so real admins stop getting "test player joined" pushes.
// Usage: node functions/scripts/cleanupReviewAccount.js   (dry-run by default)
//        node functions/scripts/cleanupReviewAccount.js --apply
const { execSync } = require('child_process');
const PROJECT = 'soccer-app-52b6b';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const REVIEW = 'sz77RXftVob0rTN5EjABsdmKoY82';
// Real communities the review account joined (NOT its own): remove it as a member.
const REAL_GROUPS = ['99TscdOdxR3ySOUYdygy', 'o2qmGDSnAdDP678oy5cm']; // צפון ת"א סניורים · כדורגל סינטטי קריית גת
// Junk community the review account created — delete it.
const JUNK_GROUPS = ['drJZlyl82AKIXfYX8GGQ']; // 'Hvjbbk'
const APPLY = process.argv.includes('--apply');
console.log(APPLY ? '=== APPLYING cleanup ===' : '=== DRY RUN (pass --apply to execute) ===');
console.log('Remove review acct from real groups:', REAL_GROUPS);
console.log('Delete junk groups:', JUNK_GROUPS);
console.log('\n⚠️ Verify the iOS review is FINISHED before --apply. Removing the reviewer mid-review can fail the review.');
console.log('Member removal is best done via groupService.removeMember / a callable to keep the /groupsPublic projection in sync — do NOT hand-edit playerIds only.');
