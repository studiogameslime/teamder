const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function assertStableScene(source, filename = 'NativeStackView.native.tsx') {
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const scenes = [];
  function visit(node) {
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(ast) === 'View') {
      const attributes = new Map(node.attributes.properties
        .filter(ts.isJsxAttribute).map(attribute => [attribute.name.getText(ast), attribute.initializer]));
      const important = attributes.get('importantForAccessibility');
      const style = attributes.get('style');
      if (important && important.getText(ast).includes('no-hide-descendants') &&
          style && style.getText(ast) === '{styles.scene}') scenes.push(attributes);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(scenes.length, 1, 'Expected exactly one native-stack accessibility scene; revalidate the pinned patch');
  const collapsable = scenes[0].get('collapsable');
  assert.ok(collapsable && ts.isJsxExpression(collapsable) &&
    collapsable.expression?.kind === ts.SyntaxKind.FalseKeyword,
  'Native-stack scene must have collapsable={false}: focus changes must not reparent its content');
  return true;
}

function verifyInstalled(root) {
  const packageRoot = path.join(root, 'node_modules/@react-navigation/native-stack');
  const metadata = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  assert.equal(metadata.version, '6.11.0', 'Native-stack version changed; revalidate the 6.11.0 patch before building');
  assert.equal(metadata['react-native'], 'src/index.tsx', 'Native entry changed; revalidate which source Metro consumes');
  const filename = path.join(packageRoot, 'src/views/NativeStackView.native.tsx');
  assertStableScene(fs.readFileSync(filename, 'utf8'), filename);
  console.log(`Verified native-stack ${metadata.version}: stable scene in ${filename}`);
}

module.exports = { assertStableScene, verifyInstalled };
if (require.main === module) verifyInstalled(path.resolve(process.argv[2] || path.join(__dirname, '..')));
