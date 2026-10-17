const fs = require('fs');
const ts = require('typescript');

// Native preview adapters receive React's CommonJS exports from Metro.
// Preserve the default import contract before evaluating the generated JSX.
function compileNativePreview(file) {
  return ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.React,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2015,
    },
  }).outputText.replace(/[^\x00-\x7F]/g, character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'));
}

module.exports = { compileNativePreview };
