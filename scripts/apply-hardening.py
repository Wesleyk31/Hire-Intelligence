"""Apply the supplied hardening package transactionally to its exact baseline."""
from pathlib import Path
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile

root = Path(sys.argv[1] if len(sys.argv) > 1 else '.').resolve()
manifest = json.loads((root / 'BASELINE_SOURCE_HASHES.json').read_text(encoding='utf-8'))
for relative, expected in manifest.items():
    actual = hashlib.sha256((root / relative).read_bytes()).hexdigest()
    if actual != expected:
        raise SystemExit(f'Baseline differs: {relative}. Restore the recorded baseline before applying.')

original = root / 'hardening/patches/apply_repairs.py'
patch = original.read_text(encoding='utf-8')
duplicate = '''fa = replace_all(fa, "'Companies & Contacts'", "'Organisations & Delivery Teams'", 'rename organisations view literals')
fa = replace_all(fa, "Companies & Contacts", "Organisations & Delivery Teams", 'rename organisations copy')'''
if patch.count(duplicate) != 1:
    raise SystemExit('Supplied integration script differs from the reviewed version.')
patch = patch.replace(duplicate, '''fa = replace_all(fa, "Companies & Contacts", "Organisations & Delivery Teams", 'rename organisations literals and copy')''')

with tempfile.TemporaryDirectory(prefix='hire-hardening-') as temporary:
    stage = Path(temporary)
    for relative in manifest:
        destination = stage / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(root / relative, destination)
    runner = stage / '_apply.py'
    runner.write_text('__file__ = ' + repr(str(original)) + '\n' + patch, encoding='utf-8')
    subprocess.run([sys.executable, '-X', 'utf8', str(runner), str(stage)], check=True)
    generated = [path for path in stage.rglob('*') if path.is_file() and path != runner]
    for source in generated:
        destination = root / source.relative_to(stage)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)
    print(f'Applied {len(generated)} files after the entire integration completed successfully.')
