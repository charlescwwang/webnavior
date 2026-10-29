"""Regression tests for evidence continuity and public-summary privacy."""

import hashlib
import json
import subprocess
import tempfile
import unittest
from pathlib import Path


SUMMARY = Path(__file__).with_name('summarizeFullCoverage.py')


class FullCoverageSummaryTests(unittest.TestCase):
    def run_summary(self, first_status, second_status=None, wrong_manifest=False):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        private = 'private-phone-0912345678'
        case = {'id': 'private:1:choice', 'caseId': 'private:1', 'group': 'private', 'accepted': ['QUERY'], 'text': private, 'state': private}
        manifest = {'cases': [case], 'inventory': [{'source': 'capture.json', 'sha256': 'source-hash', 'content': private}]}
        path = root / 'manifest.json'
        path.write_text(json.dumps(manifest))
        logs = []
        for index, status in enumerate([first_status] + ([second_status] if second_status else [])):
            row = {'id': case['id'], 'caseId': case['caseId'], 'group': case['group'], 'field': 'choice', 'expected': ['QUERY'], 'status': status, 'choice': 'QUERY', 'raw': private, 'error': private}
            summary = {'manifestHash': 'different-inputs' if wrong_manifest else hashlib.sha256(path.read_bytes()).hexdigest(), 'rows': [row], 'calls': int(status != 'NOT_RUN'), 'elapsedMs': 10}
            log = root / f'{index}.log'
            log.write_text('[full-summary] ' + json.dumps(summary) + '\n')
            logs.append(str(log))
        output = root / 'summary.json'
        result = subprocess.run(['python3', str(SUMMARY), '--manifests', str(path), '--logs', *logs, '--output', str(output)], text=True, capture_output=True)
        return result, output, private

    def test_public_summary_excludes_private_fields_and_does_not_call_a_match_field_acceptance(self):
        result, output, private = self.run_summary('MATCH')
        self.assertEqual(result.returncode, 0)
        text = output.read_text()
        self.assertNotIn(private, text)
        report = json.loads(text)
        self.assertTrue(report['collectionComplete'])
        self.assertFalse(report['fieldAcceptance'])
        self.assertEqual(report['groups'][0]['matchedAssessments'], 1)

    def test_a_later_answer_cannot_overwrite_an_executed_semantic_failure(self):
        result, output, _ = self.run_summary('MISMATCH', 'MATCH')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('executed assessment was repeated', result.stderr)
        self.assertFalse(output.exists())

    def test_only_an_unexecuted_assessment_can_be_filled_by_a_continuation(self):
        result, output, _ = self.run_summary('NOT_RUN', 'MISMATCH')
        self.assertEqual(result.returncode, 0)
        report = json.loads(output.read_text())
        self.assertTrue(report['collectionComplete'])
        self.assertFalse(report['allScoredExpectationsMatched'])
        self.assertEqual(report['groups'][0]['statuses'], {'MISMATCH': 1})

    def test_unexecuted_inputs_remain_visible_and_collection_is_incomplete(self):
        result, output, _ = self.run_summary('NOT_RUN')
        self.assertEqual(result.returncode, 0)
        report = json.loads(output.read_text())
        self.assertFalse(report['collectionComplete'])
        self.assertEqual(report['assessmentCount'], 1)
        self.assertEqual(report['groups'][0]['statuses'], {'NOT_RUN': 1})

    def test_a_log_from_different_inputs_cannot_be_scored_against_the_manifest(self):
        result, output, _ = self.run_summary('MATCH', wrong_manifest=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Unknown manifest identity', result.stderr)
        self.assertFalse(output.exists())

    def test_an_ordinary_provider_error_is_not_replaced_by_a_later_answer(self):
        result, output, _ = self.run_summary('ERROR', 'MATCH')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('executed assessment was repeated', result.stderr)
        self.assertFalse(output.exists())

    def test_a_declared_deadline_continuation_preserves_the_interrupted_attempt(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            case = {'id': 'case:1', 'caseId': 'case', 'group': 'test', 'accepted': ['QUERY'], 'text': 'synthetic speech', 'state': 'unchanged context'}
            parent = {'cases': [case], 'inventory': [], 'limits': {'perRequestMs': 35000, 'minutes': 35}}
            parent_path = root / 'parent.json'
            parent_path.write_text(json.dumps(parent))
            parent_hash = hashlib.sha256(parent_path.read_bytes()).hexdigest()
            child = dict(parent, parentManifestHash=parent_hash, budgetInterruptedIds=['case:1'])
            child_path = root / 'child.json'
            child_path.write_text(json.dumps(child))
            child_hash = hashlib.sha256(child_path.read_bytes()).hexdigest()
            common = {'id': 'case:1', 'caseId': 'case', 'group': 'test', 'field': 'choice', 'expected': ['QUERY']}
            first = {'manifestHash': parent_hash, 'elapsedMs': 2100004, 'calls': 1, 'rows': [dict(common, status='ERROR', error='The operation was aborted due to timeout', ms=3224)]}
            second = {'manifestHash': child_hash, 'elapsedMs': 100, 'calls': 1, 'rows': [dict(common, status='MATCH', choice='QUERY', ms=100)]}
            logs = []
            for name, summary in [('first', first), ('second', second)]:
                log = root / f'{name}.log'
                log.write_text('[full-summary] ' + json.dumps(summary) + '\n')
                logs.append(str(log))
            output = root / 'summary.json'
            result = subprocess.run(['python3', str(SUMMARY), '--manifests', str(parent_path), str(child_path), '--logs', *logs, '--output', str(output)], text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads(output.read_text())
            self.assertTrue(report['collectionComplete'])
            self.assertEqual(report['assessmentCount'], 1)
            self.assertEqual(report['modelCalls'], 2)
            self.assertEqual(len(report['interruptedAttempts']), 1)
            self.assertEqual(report['interruptedAttempts'][0]['originalLog'], 'first.log')


if __name__ == '__main__':
    unittest.main()
