"""Read-only verification of the SDK actually linked into the recovery IPA.

AppStoreTools identifies store processing tools, not the linked SDK. Inspect
LC_BUILD_VERSION in the executable instead. A passing result is not a launch test.
"""
import argparse
import hashlib
import json
import plistlib
import struct
import zipfile
from pathlib import Path


def linked_sdk(binary):
    if len(binary) < 32 or binary[:4] != b'\xcf\xfa\xed\xfe':
        raise ValueError('Expected a thin little-endian 64-bit Mach-O executable')
    _, cpu, _, _, commands, size, _, _ = struct.unpack_from('<8I', binary)
    if cpu != 0x0100000C or size > len(binary) - 32:
        raise ValueError('Expected a bounded ARM64 executable')
    offset, versions = 32, []
    for _ in range(commands):
        if offset + 8 > 32 + size:
            raise ValueError('Truncated load command')
        command, length = struct.unpack_from('<2I', binary, offset)
        if length < 8 or offset + length > 32 + size:
            raise ValueError('Invalid load command size')
        if command == 0x32:  # LC_BUILD_VERSION, including the linked SDK.
            if length < 24:
                raise ValueError('Truncated build version')
            platform, minimum, sdk, _ = struct.unpack_from('<4I', binary, offset + 8)
            if platform != 2:
                raise ValueError('Expected iOS device platform, not a simulator')
            versions.append((minimum, sdk))
        offset += length
    if len(versions) != 1:
        raise ValueError('Expected exactly one LC_BUILD_VERSION')
    minimum, sdk = versions[0]
    if sdk >> 16 != 26:
        raise ValueError(f'Recovery requires a linked iOS 26 SDK, got {sdk >> 16}')
    version = lambda n: f'{n >> 16}.{(n >> 8) & 255}.{n & 255}'
    return {'linkedSdk': version(sdk), 'minimumOS': version(minimum), 'platform': 'ios-device'}


def verify_ipa(path, version, build):
    with zipfile.ZipFile(path) as z:
        names = [n for n in z.namelist() if n.startswith('Payload/') and n.count('/') == 2 and n.endswith('.app/Info.plist')]
        if len(names) != 1:
            raise ValueError('Expected one main application Info.plist')
        name = names[0]
        info = plistlib.loads(z.read(name))
        if (info.get('CFBundleIdentifier'), info.get('CFBundleShortVersionString'), info.get('CFBundleVersion')) != ('com.studiogameslime.soccerapp', version, build):
            raise ValueError('Bundle, version or build does not match the requested recovery')
        executable = info['CFBundleExecutable']
        if '/' in executable or executable in ('', '.', '..'):
            raise ValueError('Invalid executable name')
        result = linked_sdk(z.read(name.removesuffix('Info.plist') + executable))
        return {**result, 'version': version, 'build': build, 'ipaSha256': hashlib.sha256(Path(path).read_bytes()).hexdigest(), 'deviceLaunchVerified': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('ipa')
    parser.add_argument('--version', required=True)
    parser.add_argument('--build', required=True)
    args = parser.parse_args()
    print(json.dumps(verify_ipa(args.ipa, args.version, args.build), indent=2))
