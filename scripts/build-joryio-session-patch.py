"""Compile/test one upstream SDK class and package a traceable local AAR.

No app build, device, network, auth data or deployment. Requires JDK21 and
the pinned compiler jars already present in the host's Gradle cache.
"""
from pathlib import Path
import hashlib
import io
import json
import os
import shutil
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
UPSTREAM_VERSION = '1.3.0-beta.1'
PATCH_VERSION = '1.3.0-beta.1-teamder.1'
UPSTREAM = ROOT / f'vendor/joryio/releases/android-{UPSTREAM_VERSION}/io/joryio/joryio-android/{UPSTREAM_VERSION}'
TARGET = ROOT / f'vendor/joryio/releases/android-{PATCH_VERSION}/io/joryio/joryio-android/{PATCH_VERSION}'
SOURCE = ROOT / 'vendor/joryio/patches/android-session-restore/SessionManager.kt'
WORK = ROOT / 'artifacts/final-deep-audit-2026-10-17/joryio-session'
CLASS = 'io/joryio/sdk/core/SessionManager.class'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def jar(group, artifact, version):
    base = Path.home() / '.gradle/caches/modules-2/files-2.1' / group / artifact / version
    matches = list(base.glob(f'*/{artifact}-{version}.jar'))
    if len(matches) != 1:
        raise RuntimeError(f'Expected one cached {artifact}:{version}, found {len(matches)}')
    return matches[0]


def run(command, log, expected=0):
    result = subprocess.run([str(x) for x in command], cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=120)
    (WORK / log).write_text(result.stdout + result.stderr, encoding='utf-8')
    print(f'{log}: exit={result.returncode}')
    if result.returncode != expected:
        raise RuntimeError(f'Unexpected status; inspect {WORK / log}')
    return result.stdout


def replace_entry(original, name, replacement):
    result = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(original)) as before, zipfile.ZipFile(result, 'w') as after:
        assert name in before.namelist()
        for entry in before.infolist():
            after.writestr(entry, replacement if entry.filename == name else before.read(entry.filename))
    return result.getvalue()


def changes(before, after):
    with zipfile.ZipFile(io.BytesIO(before)) as a, zipfile.ZipFile(io.BytesIO(after)) as b:
        assert a.namelist() == b.namelist(), 'Archive entries changed unexpectedly'
        return [name for name in a.namelist() if a.read(name) != b.read(name)]


def main():
    WORK.mkdir(parents=True, exist_ok=True)
    java, javac = shutil.which('java'), shutil.which('javac')
    if not java or not javac:
        raise RuntimeError('JDK21+ required')
    compiler = [jar('org.jetbrains.kotlin', 'kotlin-compiler-embeddable', '1.9.24'),
                jar('org.jetbrains.kotlin', 'kotlin-stdlib', '1.9.24'),
                jar('org.jetbrains.kotlin', 'kotlin-script-runtime', '1.9.24'),
                jar('org.jetbrains.kotlin', 'kotlin-reflect', '1.6.10'),
                jar('org.jetbrains.intellij.deps', 'trove4j', '1.0.20200330'),
                jar('org.jetbrains', 'annotations', '13.0')]
    stdlib, annotations = compiler[1], compiler[-1]
    gson = jar('com.google.code.gson', 'gson', '2.11.0')
    aar = (UPSTREAM / f'joryio-android-{UPSTREAM_VERSION}.aar').read_bytes()
    with zipfile.ZipFile(io.BytesIO(aar)) as archive:
        upstream_classes = archive.read('classes.jar')
    classes_path = WORK / 'upstream-classes.jar'
    classes_path.write_bytes(upstream_classes)
    fixtures, patched = WORK / 'jvm-fixtures', WORK / 'compiled-patch'
    fixtures.mkdir(exist_ok=True)
    patched.mkdir(exist_ok=True)
    tests = sorted((ROOT / 'scripts/tests/joryio_session').glob('*.java'))
    cp = os.pathsep.join(map(str, [classes_path, stdlib, gson]))
    run([javac, '-encoding', 'UTF-8', '-cp', cp, '-d', fixtures, *tests], 'javac.log')
    runtime = [fixtures, classes_path, stdlib, gson]
    baseline = run([java, '-cp', os.pathsep.join(map(str, runtime)), 'SessionRestoreHarness'], 'before.log', expected=1)
    if 'RESULT passed=3 failed=9' not in baseline or 'NullPointerException' not in baseline:
        raise RuntimeError('Original binary did not reproduce the expected defect')
    run([java, '-Xmx512m', '-cp', os.pathsep.join(map(str, compiler)),
         'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler', '-no-stdlib', '-no-reflect', '-jvm-target', '1.8',
         '-classpath', os.pathsep.join(map(str, [classes_path, stdlib, annotations])),
         f'-Xfriend-paths={classes_path}', '-d', patched, SOURCE], 'kotlin.log')
    compiled = [p.relative_to(patched).as_posix() for p in patched.rglob('*.class')]
    if compiled != [CLASS]:
        raise RuntimeError(f'Patch compiled unexpected classes: {compiled}')
    result = run([java, '-cp', os.pathsep.join(map(str, [fixtures, patched, classes_path, stdlib, gson])),
                  'SessionRestoreHarness'], 'after.log')
    if 'RESULT passed=12 failed=0' not in result:
        raise RuntimeError('Patched session tests incomplete')
    replacement = (patched / CLASS).read_bytes()
    patched_classes = replace_entry(upstream_classes, CLASS, replacement)
    assert changes(upstream_classes, patched_classes) == [CLASS]
    patched_aar = replace_entry(aar, 'classes.jar', patched_classes)
    assert changes(aar, patched_aar) == ['classes.jar']
    TARGET.mkdir(parents=True, exist_ok=True)
    name = f'joryio-android-{PATCH_VERSION}'
    (TARGET / f'{name}.aar').write_bytes(patched_aar)
    pom = (UPSTREAM / f'joryio-android-{UPSTREAM_VERSION}.pom').read_text(encoding='utf-8')
    pom = pom.replace(f'<version>{UPSTREAM_VERSION}</version>', f'<version>{PATCH_VERSION}</version>', 1)
    pom = pom.replace('  <!-- do_not_remove: published-with-gradle-metadata -->\n', '')
    (TARGET / f'{name}.pom').write_text(pom, encoding='utf-8')
    with zipfile.ZipFile(TARGET / f'{name}-sources.jar', 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.write(SOURCE, 'io/joryio/sdk/core/SessionManager.kt')
    for file in TARGET.iterdir():
        if file.suffix in {'.aar', '.pom', '.jar'}:
            file.with_name(file.name + '.sha256').write_text(digest(file.read_bytes()) + '\n', encoding='ascii')
    manifest = {
        'scope': 'Local library compile/JVM only. No app, device, network, production write or delivery proof.',
        'upstreamCoordinate': f'io.joryio:joryio-android:{UPSTREAM_VERSION}',
        'patchedCoordinate': f'io.joryio:joryio-android:{PATCH_VERSION}',
        'upstreamAarSha256': digest(aar), 'patchedAarSha256': digest(patched_aar),
        'patchSource': SOURCE.relative_to(ROOT).as_posix(), 'patchSourceHashMode': 'text-lf',
        'patchSourceSha256': digest(SOURCE.read_bytes().replace(b'\r\n', b'\n')),
        'changedAarEntries': ['classes.jar'], 'changedClassEntries': [CLASS],
        'compilerVersion': '1.9.24', 'target': 'JVM 1.8',
        'compilerJars': [{'name': p.name, 'sha256': digest(p.read_bytes())} for p in compiler],
        'gson': {'version': '2.11.0', 'sha256': digest(gson.read_bytes())},
        'before': {'passed': 3, 'failed': 9}, 'after': {'passed': 12, 'failed': 0},
        'boundary': 'Real upstream SessionManager/SessionInfo/WireJson; synthetic StorageManager/Logger, no Android keystore.',
    }
    (SOURCE.parent / 'PROVENANCE.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    (WORK / 'verification.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print('Verified one-class AAR patch, upstream 3/12 versus patched 12/12')


if __name__ == '__main__':
    main()
