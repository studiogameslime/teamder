const path = require('path');
const { relative, discover, root } = require('./control-sites.cjs');

module.exports = ({types:t}) => ({
  name: 'teamder-control-actions',
  visitor: { Program(program, state) {
    const filename = state.file.opts.filename;
    if (!filename) return;
    const sites = discover(program,relative(filename));
    if (!sites.length) return;
    const helper = program.scope.generateUidIdentifier('controlActivity');
    for (const { replace, expr, id, kind, boundary } of sites) {
      const method = t.memberExpression(t.cloneNode(helper), t.identifier(boundary ? 'trackControl' : 'describeControl'));
      replace(t.callExpression(method, [t.stringLiteral(id),t.stringLiteral(kind),expr]));
    }
    let runtime = path.relative(path.dirname(filename), path.join(root,'src/services/controlActivity')).split(path.sep).join('/');
    if (!runtime.startsWith('.')) runtime = './'+runtime;
    // Bind a local variable. Expo's module transform can copy JSX into
    // alternate branches before rewriting new ES import references.
    program.unshiftContainer('body',t.variableDeclaration('const',[
      t.variableDeclarator(helper,t.callExpression(t.identifier('require'),[t.stringLiteral(runtime)])),
    ]));
  }},
});
