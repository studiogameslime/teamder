import importlib.util
import json
import pathlib
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
