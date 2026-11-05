"""Read all recent kiosk entries into a private snapshot, without sampling.

Uses the existing local PostgreSQL container and Server environment. Credentials
are inherited through environment variables, never command arguments or output.
"""

import argparse
import collections
import datetime
import json
import os
import shlex
import subprocess
from pathlib import Path
from urllib.parse import unquote, urlsplit


parser = argparse.ArgumentParser()
parser.add_argument('--since', default='2026-10-25 16:00:00', help='Inclusive UTC timestamp; no LIMIT is applied.')
parser.add_argument('--output', default='/tmp/webnavior-full-evaluation-recent-private.json')
args = parser.parse_args()
datetime.datetime.fromisoformat(args.since)
value = next(shlex.split(line.split('=', 1)[1])[0] for line in Path('/etc/webnavior/server.env').read_text().splitlines() if line.startswith('DATABASE_URL='))
url = urlsplit(value)
env = dict(os.environ, PGHOST='127.0.0.1', PGPORT='5432', PGUSER=unquote(url.username or ''), PGPASSWORD=unquote(url.password or ''), PGDATABASE=unquote(url.path.lstrip('/')))
command = ['docker', 'exec', '-i']
for key in ['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE']:
    command.extend(['-e', key])
command.extend(['webnavior-postgres-1', 'psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-v', 'since=' + args.since])
query = """BEGIN READ ONLY;
SELECT json_build_object('session', e.visitor_session_id, 'device', s.device_id,
 'profileRelease', s.profile_release_id, 'sequence', e.sequence, 'kind', e.kind,
 'content', e.content, 'metadata', e.metadata, 'createdAt', e.created_at)
FROM kiosk_interaction_entries e JOIN kiosk_visitor_sessions s ON e.visitor_session_id = s.id
WHERE e.created_at >= :'since'::timestamp ORDER BY e.created_at ASC;
ROLLBACK;
"""
result = subprocess.run(command, input=query, text=True, env=env, capture_output=True)
if result.returncode:
    raise SystemExit('Read-only history capture failed; private database output withheld.')
entries = [json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')]
fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as output:
    json.dump(entries, output, ensure_ascii=False)
print(json.dumps({'entries': len(entries), 'sessions': len({row['session'] for row in entries}), 'devices': len({row['device'] for row in entries}), 'kinds': dict(collections.Counter(row['kind'] for row in entries)), 'firstUtc': min((row['createdAt'] for row in entries), default=None), 'latestUtc': max((row['createdAt'] for row in entries), default=None)}, ensure_ascii=False))
