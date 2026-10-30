import importlib.util
import io
import plistlib
import struct
import tempfile
import unittest
import zipfile
from pathlib import Path

spec = importlib.util.spec_from_file_location('recovery', Path(__file__).parents[1]/'verify-ios-recovery-ipa.py')
recovery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recovery)


def binary(major=26, platform=2):
    return struct.pack('<8I', 0xFEEDFACF, 0x0100000C, 0, 2, 1, 24, 0, 0) + struct.pack('<6I', 0x32, 24, platform, 15 << 16, major << 16 | 5 << 8, 0)


class RecoveryIpaTests(unittest.TestCase):
    def test_actual_load_command_accepts_sdk_26(self):
        self.assertEqual(recovery.linked_sdk(binary())['linkedSdk'], '26.5.0')

    def test_sdk_27_and_simulator_rejected(self):
        for b in [binary(27), binary(platform=7), binary()[:-1], b'', bytes(64)]:
            with self.assertRaises(ValueError):
                recovery.linked_sdk(b)

    def test_signed_store_tools_value_cannot_mask_wrong_linked_sdk(self):
        for sdk in [26, 27]:
            info = dict(CFBundleIdentifier='com.studiogameslime.soccerapp', CFBundleShortVersionString='1.1.67', CFBundleVersion='116', CFBundleExecutable='Teamder', DTAppStoreToolsBuild='27B47')
            stream = io.BytesIO()
            with zipfile.ZipFile(stream, 'w') as z:
                z.writestr('Payload/Teamder.app/Info.plist', plistlib.dumps(info))
                z.writestr('Payload/Teamder.app/Teamder', binary(sdk))
            with tempfile.NamedTemporaryFile(suffix='.ipa', delete=False) as f:
                f.write(stream.getvalue())
                name = f.name
            try:
                if sdk == 26:
                    self.assertFalse(recovery.verify_ipa(name, '1.1.67', '116')['deviceLaunchVerified'])
                    with self.assertRaises(ValueError):
                        recovery.verify_ipa(name, '1.1.67', '117')
                else:
                    with self.assertRaises(ValueError):
                        recovery.verify_ipa(name, '1.1.67', '116')
            finally:
                Path(name).unlink()


if __name__ == '__main__':
    unittest.main()
