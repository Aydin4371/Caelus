"""Resolve native job files in WSL and prove read/write access before launch."""
import json
import re
import sys
import tempfile
from pathlib import Path, PureWindowsPath


def resolve_job_paths(request, result, mounts_text=None, exists=None):
    exists = exists or (lambda path: Path(path).is_file())
    request_win, result_win = PureWindowsPath(request), PureWindowsPath(result)
    if not re.fullmatch(r"[A-Za-z]:", request_win.drive) or request_win.drive.lower() != result_win.drive.lower():
        raise ValueError("Run files must be on the same local Windows drive.")
    if ".." in request_win.parts or ".." in result_win.parts:
        raise ValueError("Run file paths must not contain parent traversal.")
    drive = request_win.drive[0].lower()
    roots = []
    if mounts_text is None:
        mounts_text = Path('/proc/mounts').read_text()
    for line in mounts_text.splitlines():
        fields = line.split()
        if len(fields) < 4:
            continue
        source, mount, _, options = fields[:4]
        if source.lower().startswith(drive + ':') or ('path=' + drive + ':') in options.lower():
            roots.append(re.sub(r'\\([0-7]{3})', lambda m: chr(int(m.group(1), 8)), mount))
    roots.append('/mnt/' + drive)
    for root in dict.fromkeys(roots):
        req = str(Path(root).joinpath(*request_win.parts[1:]))
        res = str(Path(root).joinpath(*result_win.parts[1:]))
        if exists(req):
            return req, res
    raise FileNotFoundError("Windows run folder is not readable inside the solver. Check that Windows drive sharing is available in WSL.")


def main():
    req, res = resolve_job_paths(*sys.argv[1:3])
    with open(req, encoding='utf-8') as stream:
        request = json.load(stream)
    if request.get('schema') != 'kythros-local-rde-3d-request':
        raise ValueError('The run file is not a supported Kythros request.')
    with tempfile.TemporaryFile(dir=Path(res).parent) as probe:
        probe.write(b'Kythros file access check')
        probe.flush()
    print(json.dumps([req, res]))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(2)
