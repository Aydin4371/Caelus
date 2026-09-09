"""Preserve distribution metadata and available license files in the runtime."""
import importlib.metadata
from pathlib import Path
import shutil
import sys

destination = Path(sys.argv[1])
for distribution in importlib.metadata.distributions():
    target = destination / distribution.metadata['Name']
    target.mkdir(parents=True, exist_ok=True)
    (target / 'METADATA.txt').write_text(str(distribution.metadata), encoding='utf-8')
    for entry in distribution.files or []:
        if any(word in str(entry).lower() for word in ('license', 'copying', 'notice')):
            source = Path(distribution.locate_file(entry))
            if source.is_file():
                # Flatten paths without letting distribution paths escape target.
                shutil.copyfile(source, target / str(entry).replace('/', '_').replace('\\', '_'))
