"""Compile roster code against cached Android APIs and run the pure Kotlin model tests.

This is not a Gradle build, device test, or Firebase integration test.
Provider constants/refresh entrypoints are compile-only stand-ins.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--java-home', type=Path, required=True)
parser.add_argument('--compiler-lib', type=Path, required=True)
parser.add_argument('--android-sdk', type=Path, required=True)
parser.add_argument('--gradle-cache', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
out = args.output.resolve()
out.mkdir(parents=True, exist_ok=True)
java = args.java_home / 'bin' / ('java.exe' if os.name == 'nt' else 'java')
stdlib = args.compiler_lib / 'kotlin-stdlib-2.0.21.jar'
model = root/'plugins/wear-src/widget/kotlin/WidgetRosterModel.kt'
common = [model, root/'plugins/wear-src/widget/kotlin/WidgetGameModel.kt', root/'plugins/wear-src/widget/kotlin/WidgetTimerModel.kt']
worker = root/'plugins/wear-src/widget/kotlin/WidgetRosterWorker.kt'
test = root/'tests/native/widget-roster/WidgetRosterModelTest.kt'
providers = out/'ProviderCompileStubs.kt'
providers.write_text('''package com.studiogameslime.soccerapp.widget
import android.content.Context
object TeamderWidgetProvider {
    const val PREFS = "TeamderWidgetState"
    const val KEY_JSON = "state_json"
    val STATE_LOCK = Any()
    fun requestRefresh(context: Context) = Unit
}
object TeamderPlayersWidgetProvider { fun requestRefresh(context: Context) = Unit }
object TeamderMessagingService { fun relayState(context: Context, json: String) = Unit }
object WidgetCommandReply { fun send(context: Context, node: String?, command: String?, ok: Boolean, message: String, await: Boolean = false) = Unit }
object TimerActionReceiver {
    const val ACTION_START = "com.studiogameslime.soccerapp.widget.TIMER_START"
    const val ACTION_PAUSE = "com.studiogameslime.soccerapp.widget.TIMER_PAUSE"
    const val ACTION_RESET = "com.studiogameslime.soccerapp.widget.TIMER_RESET"
}
''', encoding='utf-8')

def compile_sources(sources, classpath, target, name):
    values = ['-no-stdlib', '-no-reflect', '-jvm-target', '17', '-classpath',
              os.pathsep.join(str(p.resolve()) for p in classpath), '-d', str(target)] + [str(p) for p in sources]
    argfile = out/(name+'.args')
    # Kotlin argfiles accept quoted arguments; forward slashes avoid Windows escapes.
    argfile.write_text('\n'.join(json.dumps(value.replace('\\', '/')) for value in values), encoding='utf-8')
    command = [str(java), '-cp', str(args.compiler_lib/'*'), 'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler', '@'+str(argfile)]
    result = subprocess.run(command, cwd=root, capture_output=True, text=True, encoding='utf-8', errors='replace')
    (out/(name+'.log')).write_text(result.stdout+result.stderr, encoding='utf-8')
    if result.returncode:
        print(result.stdout+result.stderr)
        raise SystemExit(result.returncode)

compile_sources(common+[test, root/'tests/native/widget-roster/WidgetCompletionModelTest.kt'], [stdlib], out/'model-tests.jar', 'model-compile')
result = subprocess.run([str(java), '-cp', os.pathsep.join(map(str, [out/'model-tests.jar', stdlib])),
    'com.studiogameslime.soccerapp.widget.WidgetRosterModelTestKt'], capture_output=True,
    text=True, encoding='utf-8', errors='replace')
(out/'model-tests.log').write_text(result.stdout+result.stderr, encoding='utf-8')
print(result.stdout+result.stderr)
if result.returncode:
    raise SystemExit(result.returncode)
result = subprocess.run([str(java), '-cp', os.pathsep.join(map(str, [out/'model-tests.jar', stdlib])),
    'com.studiogameslime.soccerapp.widget.WidgetCompletionModelTestKt'], capture_output=True,
    text=True, encoding='utf-8', errors='replace')
(out/'completion-model-tests.log').write_text(result.stdout+result.stderr, encoding='utf-8')
print(result.stdout+result.stderr)
if result.returncode:
    raise SystemExit(result.returncode)
android = args.android_sdk/'platforms/android-36/android.jar'
prefixes = ('work-runtime-', 'lifecycle-livedata-core-', 'lifecycle-common-',
            'jetified-firebase-auth-', 'jetified-firebase-common-', 'jetified-firebase-firestore-',
            'jetified-firebase-components-', 'jetified-play-services-tasks-', 'jetified-play-services-base-',
            'jetified-play-services-basement-')
api_jars = sorted(p for p in args.gradle_cache.glob('8.13/transforms/*/transformed/*-api.jar')
                  if p.name.removeprefix('jetified-').startswith(tuple(prefix.removeprefix('jetified-') for prefix in prefixes)) and '-unity-' not in p.name)
support_jars = sorted(p for group in ('com.google.guava', 'org.jetbrains/annotations', 'androidx.annotation')
                      for p in (args.gradle_cache/'modules-2/files-2.1'/group).glob('**/*.jar'))
compile_sources(common+[worker, root/'plugins/wear-src/widget/kotlin/WidgetStateStore.kt',
    root/'plugins/wear-src/watch/PhoneServerClock.kt',
    root/'plugins/wear-src/widget/kotlin/WidgetBackend.kt', root/'plugins/wear-src/widget/kotlin/WidgetTimerWorker.kt', providers], [android, stdlib]+api_jars+support_jars,
                out/'worker-compile.jar', 'worker-compile')
print('Worker compiled against cached Android, WorkManager and Firebase API jars; providers stubbed.')
