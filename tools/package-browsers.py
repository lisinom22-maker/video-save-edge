"""Build distinct Chromium and Firefox artifacts from the shared source."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json, shutil, hashlib
root = Path(__file__).resolve().parent.parent
source = root / 'extension'
manifest = json.loads((source / 'manifest.json').read_text('utf-8'))
version = manifest['version']
for browser in ['Chromium', 'Firefox']:
    folder = root / 'dist' / browser.lower() / 'extension'
    shutil.copytree(source, folder, dirs_exist_ok=True)
    config = dict(manifest)
    if browser == 'Firefox':
        config.pop('minimum_chrome_version', None)
        config['background'] = {'page': 'firefox-background.html'}
        config['browser_specific_settings'] = {'gecko': {
            'id': 'video-save@lisinom22-maker.github.io',
            'strict_min_version': '140.0',
            'data_collection_permissions': {'required': ['none']}
        }}
    (folder / 'manifest.json').write_text(json.dumps(config, ensure_ascii=False, indent=2) + '\n', 'utf-8')
    target = root / 'dist' / f'Video-Save-{browser}-{version}.zip'
    with ZipFile(target, 'w', ZIP_DEFLATED, compresslevel=9) as archive:
        for file in sorted(folder.rglob('*')):
            if file.is_file(): archive.write(file, 'extension/' + file.relative_to(folder).as_posix())
        archive.write(root / 'docs/multi-browser.md', 'INSTALL.md')
        archive.write(root / 'LICENSE', 'LICENSE')
    with ZipFile(target) as archive:
        assert archive.testzip() is None
        assert json.loads(archive.read('extension/manifest.json')) == config
    target.with_suffix('.zip.sha256').write_text(hashlib.sha256(target.read_bytes()).hexdigest() + '  ' + target.name + '\n')
    print('Verified:', target.name)
