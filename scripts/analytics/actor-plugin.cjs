const path = require('path');
const { root, relative, supported } = require('./control-sites.cjs');

// Async completions may arrive after sign-out. Capture the owner at operation
// start rather than crediting the account which happens to be active at the end.
module.exports = ({types:t}) => ({
  name:'teamder-product-actor',
  visitor:{Program(program,state) {
    const filename = state.file.opts.filename;
    if (!filename || !supported(relative(filename))) return;
    const helper = program.scope.generateUidIdentifier('productActor');
    const scopes = new Map();
    program.traverse({CallExpression(call) {
      const callee = call.node.callee;
      if (!t.isIdentifier(callee) || call.node.arguments.length === 0 || call.node.arguments.length >= 3) return;
      const binding = call.scope.getBinding(callee.name);
      if (!binding?.path.isImportSpecifier() || binding.path.node.imported.name !== 'logEvent' ||
          !/\/analyticsService$/.test(binding.path.parentPath.node.source.value)) return;
      // A .then() or timer callback can live under an ordinary function.
      // Its owner is captured where the deferred work is scheduled.
      const deferred = call.findParent(p => p.isCallExpression() &&
        ((t.isMemberExpression(p.node.callee) && t.isIdentifier(p.node.callee.property) &&
          ['then','catch','finally'].includes(p.node.callee.property.name)) ||
         (t.isIdentifier(p.node.callee) && ['setTimeout','queueMicrotask'].includes(p.node.callee.name))));
      const fn = deferred?.getFunctionParent() ??
        call.findParent(p => p.isFunction() && p.node.async && t.isBlockStatement(p.node.body));
      if (!fn || fn.node.body.directives?.some(d => d.value.value==='worklet')) return;
      if (!t.isBlockStatement(fn.node.body)) return;
      let id = scopes.get(fn.node);
      if (!id) {
        id=fn.scope.generateUidIdentifier('actionOwner');
        scopes.set(fn.node,id);
        fn.get('body').unshiftContainer('body',t.variableDeclaration('const',[t.variableDeclarator(t.cloneNode(id),
          t.callExpression(t.memberExpression(t.cloneNode(helper),t.identifier('captureProductActor')),[]))]));
      }
      if (call.node.arguments.length===1) call.node.arguments.push(t.unaryExpression('void',t.numericLiteral(0)));
      call.node.arguments.push(t.cloneNode(id));
    }});
    if (!scopes.size) return;
    let runtime=path.relative(path.dirname(filename),path.join(root,'src/services/productActor')).split(path.sep).join('/');
    if (!runtime.startsWith('.')) runtime='./'+runtime;
    program.unshiftContainer('body',t.variableDeclaration('const',[t.variableDeclarator(helper,
      t.callExpression(t.identifier('require'),[t.stringLiteral(runtime)]))]));
  }},
});
