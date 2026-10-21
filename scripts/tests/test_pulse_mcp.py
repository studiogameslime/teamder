import importlib.util
import json
import pathlib
import os
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('pulse_mcp', pathlib.Path(__file__).parents[1] / 'pulse_mcp.py')
pulse = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pulse)


class Response:
    def __init__(self, rows):
        self.rows = rows
    def __enter__(self):
        import io
        return io.BytesIO(json.dumps(self.rows).encode())
    def __exit__(self, *args):
        pass


class PulseTests(unittest.TestCase):
    def test_inline_credentials_take_precedence_without_file_access(self):
        key = {'client_email': 'test@example.invalid', 'private_key': 'test-only-key'}
        with patch.dict(pulse.os.environ, {'PULSE_CREDENTIALS_JSON': json.dumps(key)}, clear=True), \
                patch.object(pathlib.Path, 'read_text') as read:
            self.assertEqual(pulse.load_credentials(), key)
            read.assert_not_called()

    def test_invalid_inline_credentials_do_not_fallback_or_leak(self):
        for value in ('', 'secret-invalid-json', '[]', '{}'):
            with self.subTest(value=value), patch.dict(pulse.os.environ, {'PULSE_CREDENTIALS_JSON': value}, clear=True), \
                    patch.object(pathlib.Path, 'read_text') as read:
                with self.assertRaisesRegex(ValueError, 'Invalid Pulse credential JSON|Missing Pulse credential fields'):
                    pulse.load_credentials()
                read.assert_not_called()

    def test_file_credentials_remain_supported(self):
        with patch.dict(pulse.os.environ, {'PULSE_CREDENTIALS': '/test/key.json'}, clear=True), \
                patch.object(pathlib.Path, 'read_text', return_value='{"client_email":"test","private_key":"fake"}') as read:
            self.assertEqual(pulse.load_credentials(), {'client_email': 'test', 'private_key': 'fake'})
            read.assert_called_once_with(encoding='utf-8')
    def test_personal_json_wins_without_reading_or_writing_a_file(self):
        key = {'client_email': 'reader@example.invalid', 'private_key': 'fake-private-key'}
        with patch.dict(os.environ, {'PULSE_CREDENTIALS_JSON': json.dumps(key), 'PULSE_CREDENTIALS': '/not-used'}, clear=True), \
                patch.object(pathlib.Path, 'read_text') as read, patch.object(pathlib.Path, 'write_text') as write:
            self.assertEqual(pulse.load_credentials(), key)
            read.assert_not_called()
            write.assert_not_called()

    def test_existing_local_key_path_still_works(self):
        key = {'client_email': 'reader@example.invalid', 'private_key': 'fake-private-key'}
        with patch.dict(os.environ, {'PULSE_CREDENTIALS': '/local/fake-key.json'}, clear=True), \
                patch.object(pathlib.Path, 'read_text', return_value=json.dumps(key)) as read:
            self.assertEqual(pulse.load_credentials(), key)
            self.assertEqual(read.call_args.kwargs, {'encoding': 'utf-8'})

    def test_absent_configuration_keeps_default_local_path(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(pathlib.Path, 'read_text', autospec=True, return_value='{}') as read:
            with self.assertRaises(ValueError):
                pulse.load_credentials()
            self.assertEqual(read.call_args.args[0], pulse.ROOT / 'credentials/gplay-service-account.json')

    def test_invalid_personal_value_fails_without_falling_back_or_leaking(self):
        for raw in ('', '{fake-private-key', 'null', '[]', '{}', '{"client_email": 3, "private_key": "fake-private-key"}'):
            with self.subTest(raw=raw), patch.dict(os.environ, {'PULSE_CREDENTIALS_JSON': raw}, clear=True), \
                    patch.object(pathlib.Path, 'read_text') as read:
                with self.assertRaises(ValueError) as raised:
                    pulse.load_credentials()
                self.assertNotIn('fake-private-key', str(raised.exception))
                read.assert_not_called()

    def test_inline_authentication_uses_memory_only_and_caches_token(self):
        import jwt
        key = {'client_email': 'reader@example.invalid', 'private_key': 'fake-private-key'}
        with patch.dict(os.environ, {'PULSE_CREDENTIALS_JSON': json.dumps(key)}, clear=True), \
                patch.object(pulse, '_token', None), patch.object(pulse, '_expires', 0), \
                patch.object(jwt, 'encode', return_value='fake-assertion') as sign, \
                patch.object(pathlib.Path, 'read_text') as read, \
                patch.object(pulse.urllib.request, 'urlopen', return_value=Response({'access_token': 'fake-access-token', 'expires_in': 3600})) as network:
            self.assertEqual(pulse.headers()['Authorization'], 'Bearer fake-access-token')
            self.assertEqual(pulse.headers()['Authorization'], 'Bearer fake-access-token')
            self.assertEqual(sign.call_args.args[0]['iss'], key['client_email'])
            self.assertEqual(sign.call_args.args[1], key['private_key'])
            self.assertEqual(sign.call_args.kwargs['algorithm'], 'RS256')
            self.assertEqual(network.call_count, 1)
            self.assertEqual(network.call_args.args[0].full_url, 'https://oauth2.googleapis.com/token')
            self.assertNotIn(b'fake-private-key', network.call_args.args[0].data)
            read.assert_not_called()

    def test_invalid_personal_json_returns_safe_protocol_error_without_network(self):
        with patch.dict(os.environ, {'PULSE_CREDENTIALS_JSON': 'fake-private-key'}, clear=True), \
                patch.object(pulse, '_expires', 0), patch.object(pulse.urllib.request, 'urlopen') as network:
            response = pulse.handle({'id': 1, 'method': 'tools/call', 'params': {'name': 'pulse_summary'}})
            self.assertTrue(response['result']['isError'])
            self.assertNotIn('fake-private-key', json.dumps(response))
            network.assert_not_called()

    def test_cursor_includes_old_documents_and_missing_dates(self):
        first = [{'document': {'name': pulse.BASE + '/feedback/' + str(i), 'fields': {}}} for i in range(200)]
        last = [{'document': {'name': pulse.BASE + '/feedback/last', 'fields': {}}}]
        with patch.object(pulse, 'headers', return_value={}), patch.object(pulse.urllib.request, 'urlopen',
                side_effect=[Response(first), Response(last)]) as network:
            self.assertEqual(len(pulse.query_all('feedback')), 201)
            second_query = json.loads(network.call_args_list[1].args[0].data)['structuredQuery']
            self.assertEqual(second_query['startAt']['values'][0]['referenceValue'], first[-1]['document']['name'])
            self.assertFalse(second_query['startAt']['before'])

    def test_no_write_tools_and_no_credential_leak(self):
        self.assertTrue(all(t['annotations']['readOnlyHint'] for t in pulse.TOOLS))
        with patch.object(pulse, 'call_tool', side_effect=RuntimeError('secret-private-key')):
            response = pulse.handle({'id': 1, 'method': 'tools/call', 'params': {'name': 'pulse_summary'}})
        self.assertTrue(response['result']['isError'])
        self.assertNotIn('secret-private-key', json.dumps(response))

    def test_stream_statuses_and_image_separation(self):
        doc = {'name': pulse.BASE + '/feedback/id', 'fields': {
            'status': {'stringValue': 'done'}, 'image': {'stringValue': 'not-for-text'}}}
        self.assertFalse(pulse.is_open(doc, 'feedback'))
        self.assertTrue(pulse.is_open(doc, 'errors'))
        self.assertNotIn('not-for-text', json.dumps(pulse.item(doc, 'feedback')))
        self.assertFalse(pulse.is_open(doc, 'pulseIdeas'))

    def test_invalid_path_rejected_before_network(self):
        with patch.object(pulse.urllib.request, 'urlopen') as network:
            with self.assertRaises(ValueError):
                pulse.call_tool('pulse_get', {'stream': 'feedback', 'id': '../errors/x'})
            network.assert_not_called()

    def test_tasks_are_included_without_inline_base64(self):
        doc = {'name': pulse.BASE + '/tasks/id', 'fields': {
            'status': {'stringValue': 'done'},
            'images': {'arrayValue': {'values': [{'stringValue': 'not-for-text'}]}}}}
        self.assertIn('tasks', pulse.STREAMS)
        self.assertFalse(pulse.is_open(doc, 'tasks'))
        self.assertTrue(pulse.item(doc, 'tasks')['hasScreenshot'])
        self.assertNotIn('not-for-text', json.dumps(pulse.item(doc, 'tasks')))

    def test_task_screenshots_are_returned_as_images(self):
        doc = {'name': pulse.BASE + '/tasks/id', 'fields': {
            'images': {'arrayValue': {'values': [{'stringValue': '/9j/'}]}}}}
        with patch.object(pulse, 'headers', return_value={}), patch.object(pulse.urllib.request, 'urlopen', return_value=Response(doc)):
            result = pulse.call_tool('pulse_get', {'stream': 'tasks', 'id': 'id'})
        self.assertEqual(result['content'][1]['type'], 'image')
        self.assertEqual(result['content'][1]['data'], '/9j/')


if __name__ == '__main__':
    unittest.main()
