"""Read-only pinned-source comparison; no inference or application DB access."""
import argparse
import concurrent.futures

# Excluded history must never be imported merely to satisfy this forensic tool.
# Use an explicit existing ref, optionally in an independent archived repository.
PARSER = argparse.ArgumentParser(description=__doc__)
PARSER.add_argument('--candidate-ref', required=True)
PARSER.add_argument('--candidate-repo', type=str, default=None)
ARGS = None
CANDIDATE_REF = None
import difflib
import hashlib
import json
from pathlib import Path
import subprocess
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
ENTRIES = json.loads((ROOT / 'apps/server/licenses/upstream-sources.json').read_text())

def compare(entry):
    assert ARGS is not None and CANDIDATE_REF is not None
    data = urllib.request.urlopen(entry['url'], timeout=40).read()
    assert len(data) == entry['bytes']
    assert hashlib.sha256(data).hexdigest() == entry['sha256']
    name = entry['file']
    if name.startswith('gcf-') and name.endswith('.ts'):
        local = ROOT / 'apps/server/open-sse/services/compression/engines/headroom/gcf' / name[4:]
        candidate = subprocess.check_output(['git', 'show', CANDIDATE_REF + ':' + str(local.relative_to(ROOT))], cwd=ARGS.candidate_repo or ROOT).decode()
        diff = ''.join(difflib.unified_diff(data.decode().splitlines(True), candidate.splitlines(True), fromfile=entry['url'], tofile='candidate-' + CANDIDATE_REF + '/' + str(local.relative_to(ROOT))))
        return {'source': entry, 'comparison': diff or 'byte-identical'}
    if name == 'free-claude-stream-recovery.py':
        return {'source': entry, 'pinned_source': data.decode()}
    return {'source': entry, 'verified': True}

if __name__ == '__main__':
    ARGS = PARSER.parse_args()
    try:
        CANDIDATE_REF = subprocess.check_output(
            ['git', 'rev-parse', '--verify', '--end-of-options', ARGS.candidate_ref + '^{commit}'],
            cwd=ARGS.candidate_repo or ROOT, stderr=subprocess.PIPE).decode().strip()
        for entry in ENTRIES:
            if entry['file'].startswith('gcf-') and entry['file'].endswith('.ts'):
                path = 'apps/server/open-sse/services/compression/engines/headroom/gcf/' + entry['file'][4:]
                subprocess.check_output(['git', 'cat-file', '-e', CANDIDATE_REF + ':' + path],
                                        cwd=ARGS.candidate_repo or ROOT, stderr=subprocess.PIPE)
    except (subprocess.CalledProcessError, OSError) as error:
        PARSER.error('candidate evidence unavailable; supply an existing historical ref/repository: ' + str(error))
    chosen = [e for e in ENTRIES if e['file'].startswith(('gcf-', 'free-claude-'))]
    results = list(concurrent.futures.ThreadPoolExecutor(max_workers=6).map(compare, chosen))
    print(json.dumps(results, indent=2))
