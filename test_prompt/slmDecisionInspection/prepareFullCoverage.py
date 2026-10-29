"""Freeze all discovered compatible sources, retaining gaps and private recent turns.

Run from the repository root. This prepares assessment data only; it never calls
a model, changes a source label or modifies a field order/cart/configuration.
"""

import argparse
import collections
import hashlib
import json
import os
import runpy
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--older-only', action='store_true', help='Append-only older capture run; never rerun the already frozen base cases.')
parser.add_argument('--output', default='/tmp/webnavior-full-coverage-manifest.json')
args = parser.parse_args()
POC = ROOT / 'test_prompt/turnClassifierPoc'
benchmark = runpy.run_path(str(POC / 'benchmark.py'))
export = subprocess.check_output([
    'node', '--import', 'tsx', '--input-type=module', '-e',
    'import {conversationCases} from "./apps/server/tests/experiments/kioskConversationCases.ts";'
    'import {semanticReplayCases} from "./apps/order-menu/src/experiments/semanticReplayCases.ts";'
    'import {concise,compactInstruction} from "./apps/server/tests/experiments/slmRoutingQuestions.ts";'
    'process.stdout.write(JSON.stringify({conversationCases,semanticReplayCases,concise,compactInstruction}));',
], cwd=ROOT, text=True)
fixtures = json.loads(export)
questions, cases, inventory = {}, [], []


def load(relative):
    path = ROOT / relative
    data = path.read_bytes()
    inventory.append({'source': relative, 'sha256': hashlib.sha256(data).hexdigest()})
    return json.loads(data)


def add(group, case_id, text, state, question, accepted, source, field='choice', note=None):
    encoded = json.dumps(question, ensure_ascii=False, separators=(',', ':'))
    key = hashlib.sha256(encoded.encode()).hexdigest()
    questions[key] = question
    ids = question['criteria']
    cases.append({'id': f'{group}:{case_id}:{field}', 'caseId': f'{group}:{case_id}',
                  'group': group, 'field': field, 'text': text, 'state': state,
                  'question': key, 'accepted': accepted, 'source': source,
                  'gap': bool(accepted) and not any(x in ids for x in accepted),
                  **({'note': note} if note else {})})


form = {'type': 'choice', 'instructions': benchmark['INSTRUCTIONS'], 'criteria': benchmark['CRITERIA']}
corpus_path = 'test_prompt/turnClassifierPoc/corpus.json'
corpus = load(corpus_path)
assert set(corpus['classes']) == set(benchmark['CLASSES']), 'Corpus taxonomy changed; do not silently omit new classes.'
for row in benchmark['corpus']():
    add('forms', row['id'], row['utterance'], row['utterance'], form, [row['class']], corpus_path)

# Preserve the entire frozen baseline, including missing expected candidates.
# No archived model answer is used as gold. Compact wording is shared with the
# earlier control; previously unmapped criteria keep their original definition.
partition_path = 'test_prompt/turnClassifierPoc/results/partition-frozen44.jsonl'
path = ROOT / partition_path
inventory.append({'source': partition_path, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
partition = [json.loads(x) for x in path.read_text().splitlines()]
for row in partition:
    if row.get('mode') != 'baseline':
        continue
    root = next(x for x in row['decision']['trace']['exchanges'] if 'route' in x['questions'])
    question = dict(root['questions']['route'], instructions=fixtures['compactInstruction'])
    question['criteria'] = {k: fixtures['concise'].get(k, v) for k, v in question['criteria'].items()}
    accepted = ['MULTI_ACTION', 'NEEDS_ASSISTANT'] if row['family'] == 'compound' else [row['expected']]
    add('partition', row['id'], row['text'], root['state'], question, accepted, partition_path)

resolver_source = 'test_prompt/turnClassifierPoc/resolverScenarios.json'
resolver = load(resolver_source)['scenarios']
observed = load('test_prompt/turnClassifierPoc/results/resolverReplay.json')['observations']
for row in resolver:
    trace = next(x for x in observed if x.get('stage') == 'jev' and x['id'] == row['id'])['decision']['trace']
    root = next(x for x in trace['exchanges'] if 'route' in x['questions'])
    question = dict(root['questions']['route'], instructions=fixtures['compactInstruction'])
    question['criteria'] = {k: fixtures['concise'].get(k, v) for k, v in question['criteria'].items()}
    add('resolver', row['id'], row['transcript'], root['state'], question, [row['expected']], resolver_source)

coverage_source = 'test_prompt/turnClassifierPoc/effectCoverageScenarios.json'
coverage = load(coverage_source)['scenarios']
observed = load('test_prompt/turnClassifierPoc/results/effectCoverageReplay.json')['observations']
for row in coverage:
    evidence = next(x for x in observed if x['id'] == row['id'])['result']
    if 'state' in evidence:
        add('coverage', row['id'], row['transcript'], evidence['state'], evidence['question'], [row['expected']], coverage_source)
    else:
        # A domain rejection happened before model inference. Preserve it as an
        # evidence gap; inventing its prompt would make an invalid exact replay.
        template = next(x['result']['question'] for x in observed if 'question' in x['result'])
        add('coverage', row['id'], row['transcript'], '', template, [row['expected']], coverage_source, note='No archived model input: domain rejected before inference.')
        cases[-1]['evidenceMissing'] = True

requirement_source = 'test_prompt/turnClassifierPoc/requirementScenarios.json'
requirements = load(requirement_source)['turns']
observed = load('test_prompt/turnClassifierPoc/results/requirementReplay.json')['observations']
for row in requirements:
    finding = next(x for x in observed if x['id'] == row['id'])['finding']
    for field, expected in row['expected'].items():
        add('requirements', row['id'], row['transcript'], finding['state'], finding['questions'][field], [expected], requirement_source, field)

# Generative extraction's targets/quantities are not a finite-choice task.
# Retain every turn, evaluate all ordered effect fields plus request count, and
# explicitly leave targets/slots outside this diagnostic rather than claim they
# were validated. The vocabulary is fixed across the full group, never per gold.
generative_source = 'test_prompt/turnClassifierPoc/generativeRequirementsScenarios.json'
generative = load(generative_source)['turns']
assert max(len(row['expected']) for row in generative) <= 3, 'New source has more ordered effects; extend the frozen contract instead of truncating.'
effect_question = dict(observed[0]['finding']['questions']['first'])
effect_question['criteria'] = dict(effect_question['criteria'], REPLACE='以另一餐點替換既有餐點，不是單純新增。', RECOMMEND_NEXT='在已有推薦後，要求其他推薦。')
count_question = dict(observed[0]['finding']['questions']['count'])
for row in generative:
    state = json.dumps({'utterance': row['utterance'], 'recentDialogue': row.get('dialogue', []), 'currentQuestionText': row.get('currentQuestion')}, ensure_ascii=False)
    # Four fields cover the source's actual maximum of three ordered effects;
    # the absence of a second/third must also be selected, not assumed from gold.
    for index in range(3):
        question = dict(effect_question, instructions=f'依顧客語句的最終有效要求順序，選第{index + 1}個獨立需求效果；沒有這一項選NONE。改口撤回的要求不算；取代是REPLACE。只選效果，不填商品、數量或操作。')
        accepted = [row['expected'][index]['effect']] if index < len(row['expected']) else ['NONE']
        add('generative-effects', row['id'], row['utterance'], state, question, accepted, generative_source, f'effect{index + 1}', 'Effect/count projection only; target/quantity/conditions not scored.')
    effects = [x['effect'] for x in row['expected']]
    count = 'NONE' if effects == ['CHAT'] else 'UNFINISHED' if effects == ['UNFINISHED'] else 'UNCERTAIN' if effects == ['UNCERTAIN'] else 'ONE' if len(effects) == 1 else 'TWO' if len(effects) == 2 else 'MORE_THAN_TWO'
    add('generative-effects', row['id'], row['utterance'], state, count_question, [count], generative_source, 'count', 'Count derived from frozen ordered effects; original slot gold preserved.')

# Contextual diagnostic for all semantic cases: use their recorded setup, not a
# model-produced previous answer. This does not replace their execution test.
route_criteria = dict(fixtures['concise'])
route_criteria['WAIT'] = '顧客明確要求先等待或表示先自行瀏覽。'
route_criteria['INFO'] = '詢問付款、收音或其他本機服務資訊，不新增訂購。'
route_criteria['CLARIFY'] = '明確求助但需求不明，應釐清；不猜操作。'
route_question = {'type': 'choice', 'instructions': fixtures['compactInstruction'], 'criteria': route_criteria}
semantic_context = {
    'empty': '購物車空白，沒有待答問題。',
    'fulfillment': '購物車有便當與水餃各一份，正在詢問內用或自取。',
    'checkout': '購物車有便當與水餃各一份，已選自取，正在詢問是否進入結帳。',
    'party': '購物車有便當與水餃各一份，已選內用，正在詢問用餐人數；中途查詢菜單不撤銷此問題。',
    'invitation': '沒有訂購操作待答，角色剛問需要幫忙推薦餐點嗎？',
}
for row in fixtures['semanticReplayCases']:
    add('semantic', row['id'], row['transcript'], json.dumps({'context': semantic_context[row['setup']], 'utterance': row['transcript']}, ensure_ascii=False), route_question, [row['expected']], 'apps/order-menu/src/experiments/semanticReplayCases.ts', note='State reconstructed from frozen setup; no execution or slot validation.')

for chain in fixtures['conversationCases']:
    previous = []
    had_cart = False
    for index, step in enumerate(chain['steps']):
        outcome = step['outcome']
        if outcome == 'cart':
            accepted = ['intent:set-quantity'] if had_cart else ['intent:add-item']
            had_cart = True
        else:
            accepted = {'idle': ['IGNORE'], 'catalog': ['intent:search-menu'], 'empty-query': ['intent:search-menu'], 'payment': ['INFO'], 'hearing': ['INFO'], 'acknowledge': ['INFO', 'IGNORE'], 'clarify': ['CLARIFY', 'INCOMPLETE']}[outcome]
        add('chains', f"{chain['id']}.{index + 1}", step['text'], json.dumps({'initial': '已略過手機，正在點餐；初始購物車空白。', 'previousUserTurns': previous, 'utterance': step['text']}, ensure_ascii=False), route_question, accepted, 'apps/server/tests/experiments/kioskConversationCases.ts', note='All chain steps; raw need selection only, no Main/queue/UI execution or transport fault injection.')
        previous.append(step['text'])

# Private exact ASR turns never leave local DMR. Ambiguous/no-audio cases remain
# measured but unscored; do not manufacture customer intent to inflate accuracy.
recent_path = Path('/tmp/webnavior-full-evaluation-recent-private.json')
if hashlib.sha256(recent_path.read_bytes()).hexdigest() != '70732ee5e3782a498e4319c7ed8a5d9894863225940586f34656a56787bd53ba':
    raise SystemExit('Recent snapshot differs from the frozen label review; review all new/changed rows before inference. Do not reuse positional labels or truncate the capture.')
recent = json.loads(recent_path.read_text())
turns = [x for x in recent if x['kind'] == 'asr_transcript' or x['kind'] == 'user_text' and not any(y['kind'] == 'asr_transcript' and y['session'] == x['session'] and y['content'] == x['content'] for y in recent)]
labels = {
    'UNCERTAIN': [0, 5, 8, 17, 27, 59, 68, 73, 78, 90, 93, 94, 98, 107, 125],
    'CANCEL_OR_REVERT': [1, 2, 4, 18, 33, 43, 69, 79, 97, 100, 119, 124],
    'QUERY': [9, 11, 23, 24, 28, 29, 30, 31, 42, 46, 55, 62, 64, 65, 66, 67, 120],
    'DIRECT_ACTION': [16, 32, 70, 110, 112, 121],
    'REFERENCE': [39, 41, 51, 57, 60, 63, 123],
    'MODIFICATION': [38, 77, 118, 122],
    'CHAT': [7, 26, 44, 47, 50, 52, 53, 58, 61, 72, 74, 75, 76, 80, 81, 82, 85, 86, 87, 88, 89, 91, 92, 96, 101, 105, 106, 108, 109, 111, 113, 114, 115, 116, 117],
    'NOISE': [3, 14, 35, 36, 48, 102, 103, 104],
}
annotations = {index: label for label, indices in labels.items() for index in indices}
assert len(annotations) == sum(map(len, labels.values()))
assert len(turns) == 126, 'Recent snapshot changed; review pre-inference annotations, never reuse positional labels silently.'
for index, row in enumerate(turns):
    case_id = f"{hashlib.sha256(row['session'].encode()).hexdigest()[:12]}:{row['sequence']}"
    add('recent-private', case_id, row['content'], row['content'], form, [annotations[index]] if index in annotations else [], recent_path.name, note='Single-transcript form only; ASR/audio/recipient intent unresolved. Local DMR only.')
inventory.append({'source': recent_path.name, 'sha256': hashlib.sha256(recent_path.read_bytes()).hexdigest(), 'entries': len(recent), 'turns': len(turns), 'sessions': len({x['session'] for x in recent}), 'latestUtc': max(x['createdAt'] for x in recent)})
for source in ['apps/server/tests/experiments/kioskConversationCases.ts', 'apps/order-menu/src/experiments/semanticReplayCases.ts', 'apps/server/tests/experiments/slmRoutingQuestions.ts', 'test_prompt/slmDecisionInspection/prepareFullCoverage.py']:
    inventory.append({'source': source, 'sha256': hashlib.sha256((ROOT / source).read_bytes()).hexdigest()})

if args.older_only:
    # The first run is already frozen/running. This addendum contains only
    # older sources found during the inventory, never the same base requests.
    cases.clear()
    known = {(row['session'], row['sequence']) for row in recent}
    older = []
    for name in ['webnavior-20261022-entries.json', 'webnavior-20261026-entries.json', 'webnavior-quantity-session-audit.json', 'webnavior-130-session-audit.json']:
        capture = Path('/tmp') / name
        captured = json.loads(capture.read_text())
        inventory.append({'source': name, 'sha256': hashlib.sha256(capture.read_bytes()).hexdigest(), 'entries': len(captured)})
        for row in captured:
            # A capture without a session cannot be deduplicated with certainty;
            # retain its source identity, rather than invent a correlation key.
            session = row.get('session', 'missing-session:' + name)
            key = (session, row['sequence'])
            if key in known:
                continue
            known.add(key)
            older.append(dict(row, session=session, capture=name))
    older_turns = [row for row in older if row['kind'] == 'asr_transcript' or row['kind'] == 'user_text' and not any(other['kind'] == 'asr_transcript' and other['session'] == row['session'] and other['content'] == row['content'] for other in older)]
    for row in older_turns:
        case_id = f"{hashlib.sha256(row['session'].encode()).hexdigest()[:12]}:{row['sequence']}"
        add('older-private', case_id, row['content'], row['content'], form, [], row['capture'], note='Retained local capture; no verified independent form gold. Local DMR only; not an accuracy sample.')

manifest = {'version': 1, 'provider': 'local SLM only; no Jev/Main/order calls', 'layout': 'question-first, cache_prompt=true; changed from earlier controls, not pooled', 'inventory': inventory, 'questions': questions, 'cases': cases,
            'limits': {'maxCalls': len(cases), 'minutes': 35, 'perRequestMs': 35000, 'consecutiveErrors': 3},
            'scope': 'All rows retained; independent task groups, no aggregate accuracy. Fields/duplicate source turns are not independent cases. Missing candidates count as application gaps; ambiguous private labels stay unscored.',
            'knownEvidenceGaps': ['R01–R06 source remains partial/missing original decision states; not fabricated into exact replay.', 'Generative slots/targets/quantities not evaluated by effect/count projection.', 'Semantic setup and chain previous turns reconstructed, not live Main execution.']}
encoded = json.dumps(manifest, ensure_ascii=False, indent=2)
output = Path(args.output)
fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as f:
    f.write(encoded + '\n')
print(json.dumps({'manifest': str(output), 'sha256': hashlib.sha256((encoded + '\n').encode()).hexdigest(), 'calls': len(cases), 'sourceCases': len({x['caseId'] for x in cases}), 'groups': dict(collections.Counter(x['group'] for x in cases)), 'gaps': [x['id'] for x in cases if x['gap']], 'unscored': sum(not x['accepted'] for x in cases)}, ensure_ascii=False))
