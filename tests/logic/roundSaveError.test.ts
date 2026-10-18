import {roundSaveError} from '@/utils/roundSaveError';
test.each(['closedSeasonGame: legacy season', 'functions/failed-precondition: closedSeasonGame'])('season failures use Hebrew without losing goals: %s', message=>{
 expect(roundSaveError(new Error(message),'תקלה')).toContain('הגולים והבעיטות נשמרו');
 expect(roundSaveError(new Error(message),'תקלה')).not.toContain('closedSeasonGame');
});
test('busy season and unknown SDK failures stay understandable',()=>{
 expect(roundSaveError(new Error('season-operation:busy'),'תקלה')).toContain('עדכון עונה');
 expect(roundSaveError(new Error('INTERNAL'),'נסו שוב')).toBe('נסו שוב');
 expect(roundSaveError(new Error('המשחק השתנה'),'נסו שוב')).toBe('המשחק השתנה');
});
