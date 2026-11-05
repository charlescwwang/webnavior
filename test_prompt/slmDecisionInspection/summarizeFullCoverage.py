"""Summarize frozen full-source runs without publishing private transcripts.

Accept disjoint assessments or NOT_RUN continuations. A declared harness-deadline
interruption without an answer may complete once with the original attempt kept.
Semantic answers cannot be replaced, so reruns cannot silently improve scores.
"""

import argparse
import collections
import hashlib
import json
import os
from pathlib import Path


parser = argparse.ArgumentParser()
parser.add_argument('--manifests', nargs='+', required=True)
parser.add_argument('--logs', nargs='+', required=True)
parser.add_argument('--output', required=True)
parser.add_argument('--model-inspect', help='Optional local Docker Model Runner inspect JSON; export identity fields only.')
args = parser.parse_args()
cases, inventories, manifests, manifest_data = {}, {}, [], {}
for name in args.manifests:
    path = Path(name)
    raw = path.read_bytes()
    manifest = json.loads(raw)
    manifest_hash = hashlib.sha256(raw).hexdigest()
    manifests.append({'file': path.name, 'sha256': manifest_hash})
    manifest_data[manifest_hash] = manifest
    for source in manifest['inventory']:
        inventories[(source['source'], source['sha256'])] = {key: source[key] for key in ['source', 'sha256', 'entries', 'turns', 'sessions', 'latestUtc'] if key in source}
    for case in manifest['cases']:
        if case['id'] in cases and case != cases[case['id']]:
            raise SystemExit('Manifest identity collision; retain evidence and audit before summarizing.')
        cases[case['id']] = case

rows, logs, row_origins, interrupted_attempts = {}, [], {}, []
for name in args.logs:
    path = Path(name)
    summary = None
    with path.open() as capture:
        for line in capture:
            if line.startswith('[full-summary] '):
                if summary is not None:
                    raise SystemExit('Multiple summaries in one log; no best-result selection permitted.')
                summary = json.loads(line.split('[full-summary] ', 1)[1])
    if summary is None:
        raise SystemExit('A run has no complete collection summary; cannot mark it complete.')
    if summary['manifestHash'] not in {manifest['sha256'] for manifest in manifests}:
        raise SystemExit('Unknown manifest identity; input provenance does not match the supplied frozen manifests.')
    logs.append({'file': path.name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'elapsedMs': summary['elapsedMs'], 'calls': summary['calls'], 'manifestHash': summary['manifestHash']})
    for row in summary['rows']:
        case = cases.get(row['id'])
        if case is None or case['accepted'] != row['expected']:
            raise SystemExit('Unknown assessment or changed gold in log.')
        previous = rows.get(row['id'])
        if previous and previous['status'] != 'NOT_RUN':
            # Only a declared harness-deadline interruption with no model answer
            # may be completed. Preserve its original failed attempt explicitly;
            # ordinary provider failures and semantic answers cannot be replaced.
            current_manifest = manifest_data[summary['manifestHash']]
            origin = row_origins[row['id']]
            parent = manifest_data[origin['manifestHash']]
            interrupted = (
                previous['status'] == 'ERROR'
                and 'choice' not in previous
                and previous.get('error') == 'The operation was aborted due to timeout'
                and row['id'] in current_manifest.get('budgetInterruptedIds', [])
                and current_manifest.get('parentManifestHash') == origin['manifestHash']
                and previous['ms'] < parent['limits']['perRequestMs']
                and origin['elapsedMs'] >= parent['limits']['minutes'] * 60_000
            )
            if not interrupted:
                raise SystemExit('An executed assessment was repeated; do not overwrite its first result.')
            interrupted_attempts.append({'id': row['id'], 'reason': 'batch-deadline-interruption-without-answer', 'ms': previous['ms'], 'originalLog': origin['file'], 'continuationLog': path.name})
        rows[row['id']] = row
        row_origins[row['id']] = {'file': path.name, 'manifestHash': summary['manifestHash'], 'elapsedMs': summary['elapsedMs']}

if set(rows) != set(cases):
    raise SystemExit('Missing frozen assessments; no rows may disappear from the denominator.')
groups = []
for group in sorted({row['group'] for row in rows.values()}):
    selected = [row for row in rows.values() if row['group'] == group]
    statuses = dict(collections.Counter(row['status'] for row in selected))
    scored = statuses.get('MATCH', 0) + statuses.get('MISMATCH', 0)
    source_cases = collections.defaultdict(list)
    for row in selected:
        source_cases[row['caseId']].append(row)
    scorable_cases = [values for values in source_cases.values() if all(row['status'] in ['MATCH', 'MISMATCH'] for row in values)]
    groups.append({'group': group, 'sourceCaseRecords': len(source_cases), 'assessments': len(selected), 'statuses': statuses, 'matchedAssessments': statuses.get('MATCH', 0), 'scoredAssessments': scored, 'casesWithEveryFieldMatched': sum(all(row['status'] == 'MATCH' for row in values) for values in scorable_cases), 'scorableCases': len(scorable_cases)})

source_cases = {case['caseId']: case for case in cases.values()}
model_identity = None
if args.model_inspect:
    inspected = json.loads(Path(args.model_inspect).read_text())
    config = inspected.get('config', {})
    model_identity = {'digest': inspected.get('id'), 'tags': inspected.get('tags'), 'config': {key: config[key] for key in ['format', 'parameters', 'architecture', 'size'] if key in config}}
complete = not any(row['status'] in ['NOT_RUN', 'ERROR'] for row in rows.values())
report = {
    'version': 1,
    'provider': 'local DMR qwen3.5-4b; non-thinking single label; no production actions',
    'modelIdentity': model_identity,
    'layout': 'Per-manifest promptLayouts; variants retain distinct assessment IDs and separate scores',
    'promptLayouts': {item['file']: manifest_data[item['sha256']].get('promptLayout', 'question-first') for item in manifests},
    'collectionComplete': complete,
    'allScoredExpectationsMatched': complete and not any(row['status'] == 'MISMATCH' for row in rows.values()),
    'fieldAcceptance': False,
    'assessmentCount': len(cases),
    'sourceCaseRecords': len(source_cases),
    'distinctLiteralUtterances': len({case['text'] for case in source_cases.values()}),
    'modelCalls': sum(log['calls'] for log in logs),
    'interruptedAttempts': interrupted_attempts,
    'elapsedMsAcrossBatches': sum(log['elapsedMs'] for log in logs),
    'countsAreNotIndependentConversations': True,
    'groups': groups,
    'inventory': list(inventories.values()),
    'manifests': manifests,
    'logs': logs,
    'limits': [
        'Task groups keep their original or explicitly projected contracts; no aggregate accuracy.',
        'Train/validation/test corpus labels are historical development data, not an unseen holdout.',
        'Recent form annotations were specified before inference; ambiguous/no-audio inputs remain unscored.',
        'Older exact input captures lack independently verified form gold; no accuracy is assigned.',
        'Generative effects/count are measured; target/quantity/conditions are not.',
        'Semantic setup and chain context are reconstructed; no real Main/ASR/UI full-flow acceptance.',
        'Missing original prompts and unavailable candidates remain visible gaps.',
        'Same literal speech and multiple fields do not create independent examples.',
    ],
    # Choice IDs, predeclared labels and pseudonymous case IDs only. Never emit
    # text/state/request/raw response or customer/session/device identifiers.
    'rows': [{key: row[key] for key in ['id', 'caseId', 'group', 'field', 'expected', 'status', 'choice', 'ms', 'cachedTokens'] if key in row} for row in rows.values()],
}
fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
with os.fdopen(fd, 'w') as output:
    json.dump(report, output, ensure_ascii=False, indent=2)
    output.write('\n')
print(json.dumps({key: report[key] for key in ['collectionComplete', 'allScoredExpectationsMatched', 'assessmentCount', 'sourceCaseRecords', 'distinctLiteralUtterances', 'modelCalls', 'groups']}, ensure_ascii=False))
