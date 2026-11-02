"""Package the already-installed production dependencies without network access."""
import json
from pathlib import Path
import shutil
import sys

root = Path(sys.argv[1])
target = Path(sys.argv[2])
lock = json.loads((root / 'package-lock.json').read_text())
modules = target / 'node_modules'
if modules.exists():
    shutil.rmtree(modules)
for name, package in lock['packages'].items():
    if not name or package.get('dev'):
        continue
    source = root / name
    if not source.is_dir():
        raise RuntimeError(f'Missing dependency {name}; run npm ci first.')
    shutil.copytree(source, target / name, dirs_exist_ok=True)
for name in ('package.json', 'package-lock.json'):
    shutil.copy2(root / name, target / name)
shutil.copytree(root / 'dist', target / 'dist', dirs_exist_ok=True)
