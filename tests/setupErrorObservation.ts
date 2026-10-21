/**
 * Legacy isolation tests execute extracted function text rather than importing
 * its module. Supply the newly explicit diagnostic dependency to those sandboxes
 * while retaining the real bridge (no network sink is installed here).
 */
import vm from 'node:vm';
import { errorCauseObjects } from '../src/utils/errorIdentity';
import { observeCaughtError, observeSettledErrors, observedRejection, observedListener } from '../src/utils/errorObservation';
const diagnostics = { errorCauseObjects, observeCaughtError, observeSettledErrors, observedRejection, observedListener };
Object.assign(globalThis, diagnostics);
const original = (vm.runInNewContext as typeof vm.runInNewContext & {diagnosticOriginal?: typeof vm.runInNewContext}).diagnosticOriginal ?? vm.runInNewContext;
vm.runInNewContext = ((code: string, context: Record<string, unknown> = {}, options?: any) => {
  for (const [key, value] of Object.entries(diagnostics)) if (!(key in context)) context[key] = value;
  const load = context.require as ((id: string) => unknown) | undefined;
  context.require = (id: string) => {
    if (/(?:^|\/)(errorObservation|serverErrorLog|errorIdentity)$/.test(id)) return diagnostics;
    if (/(?:^|\/)observedFunctions$/.test(id) && load) return Object.assign({},
      load('firebase-functions/v2/https'), load('firebase-functions/v2/firestore'),
      load('firebase-functions/v2/scheduler'), load('firebase-functions/v2/tasks'));
    if (load) return load(id);
    throw new Error(`Isolated fixture has no dependency adapter for ${id}`);
  };
  return original(code, context, options);
}) as typeof vm.runInNewContext;
(vm.runInNewContext as typeof vm.runInNewContext & {diagnosticOriginal?: typeof vm.runInNewContext}).diagnosticOriginal = original;
