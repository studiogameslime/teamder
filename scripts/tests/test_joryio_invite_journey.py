import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('invite_journey', Path(__file__).parents[1] / 'joryio_invite_journey.py')
journey = importlib.util.module_from_spec(spec)
spec.loader.exec_module(journey)


class JourneyTests(unittest.TestCase):
    def test_every_event_condition_is_scoped_to_entry_club(self):
        body = journey.definition()
        for node in body['nodes']:
            for group in node['config'].get('filterGroups', []):
                for item in group['filters']:
                    if item['type'] == 'event':
                        self.assertEqual(item['propertyConditions'], [{'property': 'groupId', 'operator': 'equals', 'value': '{{ trigger.properties.groupId }}'}])

    def test_two_inapps_one_push_no_broadcast_entry(self):
        body = journey.definition()
        self.assertEqual(body['sendType'], 'trigger')
        self.assertEqual(body['entryTrigger']['config']['eventName'], 'Community Created')
        self.assertEqual(sum(n['type'] == 'in_app_message' for n in body['nodes']), 2)
        self.assertEqual(sum(n['type'] == 'message' for n in body['nodes']), 1)
        push_edge = next(e for e in body['edges'] if e['target'] == 'invite_push')
        self.assertEqual((push_edge['source'], push_edge['sourceHandle']), ('push_allowed', 'yes'))
        self.assertFalse(any(e['source'] == 'shared' and e.get('sourceHandle') == 'yes' and e['target'] == 'push_allowed' for e in body['edges']))

    def test_missing_metrics_are_not_zero_or_inferred_from_queue(self):
        report = journey.snapshot({'id': 'j', 'name': 'n', 'status': 'draft', 'nodes': [{'id': 'n', 'type': 'in_app_message', 'config': {}}]}, {'totalEntries': 0}, {'n': {'entered': 3, 'proceededToNext': 3}})
        self.assertEqual(report['entries'], 0)
        self.assertEqual(report['steps'][0]['entered'], 3)
        self.assertIsNone(report['steps'][0]['displayed'])
        self.assertIsNone(report['steps'][0]['clicked'])


if __name__ == '__main__': unittest.main()
