"""Copy Node and its non-system dylibs into a relocatable, ad-hoc signed runtime."""
from pathlib import Path
import re
import shutil
import subprocess
import sys

source = Path(sys.argv[1]).resolve()
destination = Path(sys.argv[2])
destination.mkdir(parents=True, exist_ok=True)
copied = {}
names = {}


def output(*args):
    return subprocess.check_output(args, text=True)


def copy_binary(path, name=None, inherited=()):
    path = path.resolve()
    if path in copied:
        return copied[path]
    name = name or path.name
    if name in names and names[name] != path:
        raise RuntimeError(f"Runtime library name collision: {name}")
    names[name] = path
    target = destination / name
    shutil.copy2(path, target)
    target.chmod(0o755)
    copied[path] = target
    rpaths = re.findall(r"cmd LC_RPATH\s+cmdsize \d+\s+path (.*?) \(offset", output('otool', '-l', str(path)))
    search = [Path(p.replace('@loader_path', str(path.parent)).replace('@executable_path', str(source.parent))) for p in rpaths] + list(inherited)
    deps = [line.strip().split(' (compatibility')[0] for line in output('otool', '-L', str(path)).splitlines()[1:]]
    for dep in deps:
        if dep.startswith(('/usr/lib/', '/System/Library/')):
            continue
        if dep.startswith('@rpath/'):
            candidates = [p / dep[len('@rpath/'):] for p in search]
            resolved = next((p for p in candidates if p.exists()), None)
            if resolved is None:
                raise RuntimeError(f"Cannot resolve {dep} from {path}")
        elif dep.startswith('@loader_path/'):
            resolved = path.parent / dep[len('@loader_path/'):]
        elif dep.startswith('@executable_path/'):
            resolved = source.parent / dep[len('@executable_path/'):]
        else:
            resolved = Path(dep)
        if resolved.resolve() == path:
            continue
        library = copy_binary(resolved, inherited=search)
        subprocess.run(['install_name_tool', '-change', dep, '@loader_path/' + library.name, str(target)], check=True, capture_output=True)
    if target.suffix == '.dylib':
        subprocess.run(['install_name_tool', '-id', '@loader_path/' + name, str(target)], check=True, capture_output=True)
    subprocess.run(['codesign', '--force', '--sign', '-', str(target)], check=True, capture_output=True)
    return target


copy_binary(source, 'node')
print(f"Bundled Node with {len(copied) - 1} libraries")
