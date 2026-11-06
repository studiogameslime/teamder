// Used by Metro and by the coverage inventory. No event arguments or rendered
// strings are read at runtime. A source position is evidence, never an event ID.
const path = require('path');
const crypto = require('crypto');
const t = require('@babel/types');
const generate = require('@babel/generator').default;
const root = path.resolve(__dirname, '../..');
const kinds = {
  onPress: 'press', onLongPress: 'long_press', onValueChange: 'change',
  onSlidingComplete: 'change', onSubmitEditing: 'submit', onRefresh: 'refresh',
  onAccessibilityAction: 'accessibility',
};
const verbs = {press:'לחיצה',long_press:'לחיצה ממושכת',change:'שינוי ערך',submit:'אישור מהמקלדת',refresh:'רענון',accessibility:'פעולת נגישות'};
const areas = {players:'שחקנים',chat:'שיחות',auth:'התחברות',onboarding:'הצטרפות',communities:'מועדונים',games:'מחזורים',match:'מחזור חי',invite:'הזמנות',profile:'פרופיל',tabs:'מסך ראשי',stats:'סטטיסטיקה',entry:'כניסה',draft:'חלוקת קבוצות',social:'חברים',settings:'הגדרות',timer:'שעון',summary:'סיכום',history:'היסטוריה',compare:'השוואה',community:'מועדון',home:'בית',navigation:'ניווט',screens:'מסכים',components:'ממשק'};
const supported = filename => /^(?:App\.tsx|src\/(?!dev\/|mock\/).+\.(?:ts|tsx))$/.test(filename);
const relative = filename => path.relative(root, filename).split(path.sep).join('/');
function staticText(value, translations) {
  if (!value) return '';
  if (t.isStringLiteral(value) || t.isJSXText(value)) return value.value.trim();
  if (t.isJSXExpressionContainer(value)) return staticText(value.expression, translations);
  if (t.isMemberExpression(value) && t.isIdentifier(value.object,{name:'he'}) && t.isIdentifier(value.property)) return translations[value.property.name] || '';
  if (t.isJSXElement(value) && !value.openingElement.attributes.some(a => t.isJSXAttribute(a) && a.name.name === 'onPress')) {
    return value.children.map(v => staticText(v,translations)).filter(Boolean).join(' ').trim();
  }
  return '';
}
function isNativeBoundary(attr, opening) {
  const rootName = generate(opening.name).code.split('.')[0];
  const binding = attr.scope.getBinding(rootName);
  if (!binding) return false;
  const declaration = binding.path.findParent(p => p.isImportDeclaration());
  const source = declaration?.node.source.value || '';
  return /^(?:react-native(?:$|-)|@react-native(?:\/|-)|@react-native-community\/|@react-navigation\/|expo-|@expo\/)/.test(source);
}
function discover(program, filename, translations = {}) {
  if (!supported(filename)) return [];
  const matches = [];
  program.traverse({ JSXAttribute(attr) {
    const name = attr.node.name.name;
    if (!Object.hasOwn(kinds,name) || !t.isJSXExpressionContainer(attr.node.value)) return;
    const expr = attr.node.value.expression;
    if (t.isJSXEmptyExpression(expr) || t.isNullLiteral(expr) || t.isIdentifier(expr,{name:'undefined'})) return;
    const opening = attr.parentPath.node;
    const owner = attr.findParent(p => p.isFunctionDeclaration() && p.node.id || p.isVariableDeclarator() && t.isIdentifier(p.node.id));
    const scope = owner?.node.id?.name || 'root';
    const element = generate(opening.name).code;
    const attributes = opening.attributes.filter(t.isJSXAttribute);
    const hints = ['diagnosticName','testID','accessibilityLabel','title','label','icon','iconLeft','name']
      .map(key => attributes.find(a => a.name.name === key)?.value).filter(Boolean);
    const children = attr.parentPath.parentPath.node.children ?? [];
    const visible = [...hints,...children].map(v => staticText(v,translations)).find(s => /[א-ת]/.test(s) && s.length <= 75);
    const anchor = hints.length ? generate(hints[0], {compact:true,comments:false}).code : '';
    const calls = [];
    t.traverseFast(expr, n => { if (t.isCallExpression(n)) {
      const callee = n.callee;
      if (t.isIdentifier(callee) && callee.name !== 'logEvent') calls.push(callee.name);
      else if (t.isMemberExpression(callee) && t.isIdentifier(callee.property)) calls.push(callee.property.name);
    } });
    const handler = t.isIdentifier(expr) ? expr.name : (calls[0] || name);
    // Two siblings can both call navigate() while opening different screens.
    // Literal arguments distinguish them without using a mutable row number.
    const literalArgs = [];
    t.traverseFast(expr, node => {
      if (t.isCallExpression(node)) for (const arg of node.arguments) {
        if (t.isStringLiteral(arg) || t.isNumericLiteral(arg) || t.isBooleanLiteral(arg)) literalArgs.push(String(arg.value));
      }
    });
    const keyAttribute = attributes.find(a => a.name.name === 'key')?.value;
    const signature = [filename,scope,element,name,anchor,handler,JSON.stringify(literalArgs),
      keyAttribute ? generate(keyAttribute,{compact:true,comments:false}).code : ''].join('|');
    const area = filename.split('/').reverse().map(s => areas[s]).find(Boolean) || 'יישום';
    matches.push({ replace:value => { attr.node.value.expression = value; }, expr, boundary:isNativeBoundary(attr,opening), kind:kinds[name], signature, label:visible || (verbs[kinds[name]]+' במסך '+area),
      filename, line:attr.node.loc.start.line, scope, handler });
  }, ObjectExpression(option) {
    const field = key => option.node.properties.find(p => t.isObjectProperty(p) && t.isIdentifier(p.key,{name:key}));
    const parent = option.parentPath, call = parent.isArrayExpression() ? parent.parentPath : null;
    const callee = call?.isCallExpression() && generate(call.node.callee).code;
    const dialog = !!callee && /^(appAlert|Alert\.alert|showAlert)$/.test(callee) && !!field('text');
    const identifier = field('id') || field('key') || field('label');
    const menu = !!field('label') && (t.isStringLiteral(identifier?.value) || t.isMemberExpression(identifier?.value));
    if (!dialog && !menu) return;
    const toggle = field('toggle')?.value;
    const toggleHandler = t.isObjectExpression(toggle) && toggle.properties.find(p => t.isObjectProperty(p) && t.isIdentifier(p.key,{name:'onChange'}));
    const callbacks = [field('onPress'),field('run'),toggleHandler].filter(Boolean);
    if (!callbacks.length && !dialog) return;
    const owner = option.findParent(p => p.isFunctionDeclaration() && p.node.id || p.isVariableDeclarator() && t.isIdentifier(p.node.id));
    const scope = owner?.node.id?.name || 'root';
    const tag = dialog ? 'dialog' : 'menu';
    const anchor = generate((dialog ? field('text') : identifier).value,{compact:true}).code;
    for (const cb of callbacks.length ? callbacks : [null]) {
      if (cb && !t.isExpression(cb.value)) continue;
      const kind = cb?.key.name === 'onChange' ? 'change' : 'press';
      matches.push({ replace:value => {
        if (cb) { cb.value=value; cb.shorthand=false; }
        else option.node.properties.push(t.objectProperty(t.identifier('onPress'),value));
      }, expr:cb?.value ?? t.arrowFunctionExpression([],t.blockStatement([])), boundary:callee === 'Alert.alert', kind,
      signature:[filename,scope,tag,anchor,kind].join('|'), label:staticText((field('text')||field('label'))?.value,translations)||'בחירה בחלונית',
      filename,line:option.node.loc.start.line,scope,handler:tag });
    }
  }});
  // Truly indistinguishable controls represent the same action. Inserting
  // another copy cannot silently reassign an existing action's history.
  for (const m of matches) {
    m.id = 'ui_' + crypto.createHash('sha256').update(m.signature).digest('hex').slice(0,18);
  }
  return matches;
}
module.exports = {root, relative, supported, discover};
