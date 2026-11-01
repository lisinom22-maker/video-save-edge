"""Package the complete offline extension with UTF-8 filenames and verify every entry."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import hashlib
import json

root = Path(__file__).resolve().parent.parent
version = json.loads((root / 'extension' / 'manifest.json').read_text(encoding='utf-8'))['version']
target = root / 'dist' / f'Bili-Save-Edge-{version}.zip'
files = sorted(p for p in (root / 'extension').rglob('*') if p.is_file())
files.extend((root / 'README.md', root / 'LICENSE'))
with ZipFile(target, 'w', compression=ZIP_DEFLATED, compresslevel=9) as archive:
    for file in files:
        archive.write(file, file.relative_to(root).as_posix())
with ZipFile(target) as archive:
    assert archive.testzip() is None, 'ZIP CRC check failed'
    manifest = json.loads(archive.read('extension/manifest.json'))
    assert manifest['manifest_version'] == 3
    for file in files:
        name = file.relative_to(root).as_posix()
        assert hashlib.sha256(archive.read(name)).digest() == hashlib.sha256(file.read_bytes()).digest(), name
print(f'ZIP verified: {len(files)} entries, all bytes match the tested extension.')
