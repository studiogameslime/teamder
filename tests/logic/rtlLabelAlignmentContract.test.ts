import fs from 'fs';
import path from 'path';
import * as ts from 'typescript';

// The four audited surfaces use RTL_LABEL_ALIGN for labels. An explicit RTL
// paragraph direction must not make that logical alignment physical again.
// This guard checks the code contract; device screenshots verify rendering.
const auditedSources = [
  'src/screens/games/GamesListScreen.tsx',
  'src/screens/profile/AvailabilityEditScreen.tsx',
  'src/components/games/AreaDemandCard.tsx',
  'src/components/games/NearbyClubsSection.tsx',
];

function conflictingLabelLines(source: string): number[] {
  const file = ts.createSourceFile('labels.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const conflicts: number[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isObjectLiteralExpression(node)) {
      const properties = node.properties.filter(ts.isPropertyAssignment);
      const alignment = properties.find((property) => property.name.getText(file) === 'textAlign')?.initializer;
      const direction = properties.find((property) => property.name.getText(file) === 'writingDirection')?.initializer;
      if (
        alignment && ts.isIdentifier(alignment) && alignment.text === 'RTL_LABEL_ALIGN' &&
        direction && ts.isStringLiteral(direction) && direction.text === 'rtl'
      ) {
        conflicts.push(file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return conflicts;
}

describe('audited label alignment contract', () => {
  it.each(auditedSources)('%s keeps logical label alignment free of an explicit RTL override', (relativePath) => {
    const source = fs.readFileSync(path.resolve(__dirname, '../..', relativePath), 'utf8');
    expect(conflictingLabelLines(source)).toEqual([]);
  });

  it('detects the conflicting style even with double quotes or additional properties', () => {
    expect(conflictingLabelLines(`const s = { title: {
      textAlign: RTL_LABEL_ALIGN, color: 'navy', writingDirection: "rtl",
    } };`)).toEqual([1]);
  });

  it('allows explicit physical alignment for input fields and centered text', () => {
    expect(conflictingLabelLines(`const s = {
      input: { textAlign: 'right', writingDirection: 'rtl' },
      centered: { textAlign: 'center', writingDirection: 'rtl' },
      label: { textAlign: RTL_LABEL_ALIGN },
    };`)).toEqual([]);
  });

  it('ignores comments and properties from separate style objects', () => {
    expect(conflictingLabelLines(`
      // textAlign: RTL_LABEL_ALIGN, writingDirection: 'rtl'
      const s = { first: { textAlign: RTL_LABEL_ALIGN }, second: { writingDirection: 'rtl' } };
    `)).toEqual([]);
  });
});
