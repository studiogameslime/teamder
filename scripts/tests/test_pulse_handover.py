import importlib.util
import io
import json
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).parents[1]))
spec = importlib.util.spec_from_file_location('pulse_handover', pathlib.Path(__file__).parents[1] / 'pulse_handover.py')
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)


class HandoverTests(unittest.TestCase):
    def test_only_review_fields_are_written_with_existing_document_precondition(self):
        original = {'updateTime': '2026-10-21T10:00:00Z', 'fields': {
            'status': {'stringValue': 'new'}, 'image': {'stringValue': 'original'},
            'claudeNote': {'stringValue': 'previous'}}}
        captured = []
        def send(req, **kwargs):
            captured.append(req)
            return io.BytesIO(b'{}')
        def read(url):
            if not captured:
                return original
            return {'fields': {**original['fields'], **json.loads(captured[0].data)['fields']}}
        with patch.object(h, 'read', side_effect=read), patch.object(h.pulse, 'headers', return_value={}), patch.object(h.urllib.request, 'urlopen', side_effect=send):
            receipt = h.apply(('feedback', 'exact-id', 'new note', ['jpeg']))
        self.assertTrue(receipt['readBackVerified'])
        fields = json.loads(captured[0].data)['fields']
        self.assertEqual(set(fields), set(h.FIELDS))
        self.assertEqual(fields['claudeNote']['stringValue'], 'previous\n\nnew note')
        self.assertIn('currentDocument.updateTime=', captured[0].full_url)
        self.assertNotIn('status', fields)

    def test_parked_ideas_never_write(self):
        with patch.object(h, 'read', return_value={'fields': {'status': {'stringValue': 'idea'}}}), patch.object(h.urllib.request, 'urlopen') as network:
            with self.assertRaises(ValueError):
                h.apply(('pulseIdeas', 'id', 'note', ['jpeg']))
            network.assert_not_called()

    def test_readback_failure_is_not_success(self):
        original = {'fields': {}, 'updateTime': 'time'}
        with patch.object(h, 'read', side_effect=[original, {'fields': {}}]), patch.object(h.pulse, 'headers', return_value={}), patch.object(h.urllib.request, 'urlopen', return_value=io.BytesIO(b'{}')):
            with self.assertRaises(RuntimeError):
                h.apply(('errors', 'id', 'note', ['jpeg']))

    def test_already_verified_handover_does_not_append_or_write_again(self):
        original = {'fields': {'claudeStatus': {'stringValue': 'done'}, 'claudeNote': {'stringValue': 'old\n\nnew'}, 'claudeImages': {'arrayValue': {'values': [{'stringValue': 'jpeg'}]}}}}
        with patch.object(h, 'read', return_value=original), patch.object(h.urllib.request, 'urlopen') as network:
            self.assertTrue(h.apply(('tasks', 'id', 'new', ['jpeg']))['alreadyVerified'])
            network.assert_not_called()

    def test_target_and_proof_are_bounded_before_any_network(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            (root / 'proof.jpg').write_bytes(b'\xff\xd8\xfffake')
            valid = {'collection': 'feedback', 'id': 'id', 'claudeStatus': 'done', 'claudeNote': 'note', 'claudeImages': ['proof.jpg']}
            self.assertEqual(h.prepare(valid, root)[:3], ('feedback', 'id', 'note'))
            for bad in ({'id': '../id'}, {'collection': 'users'}, {'claudeImages': ['../outside.jpg']}, {'claudeImages': []}, {'claudeStatus': 'closed'}):
                with self.subTest(bad=bad), self.assertRaises(ValueError):
                    h.prepare({**valid, **bad}, root)
