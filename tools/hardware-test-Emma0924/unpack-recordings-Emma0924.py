"""Verify and unpack shared offline records; no serial/network imports or I/O."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / 'docs/hardware-test-Emma0924'


def unpack(output):
    manifest = json.loads((DATA / 'manifest.json').read_text(encoding='utf-8'))
    output = Path(output).resolve()
    prepared = []
    names = set()
    for item in manifest['files']:
        name, archive = item['name'], item['archive']
        if Path(name).name != name or '/' in name or '\\' in name or not name.endswith('.json'):
            raise ValueError('Invalid recording name')
        if archive != name + '.gz' or name in names:
            raise ValueError('Invalid or duplicate archive name')
        names.add(name)
        packed = (DATA / 'recordings' / archive).read_bytes()
        if hashlib.sha256(packed).hexdigest() != item['archiveSha256']:
            raise ValueError(f'Archive checksum mismatch: {name}')
        raw = gzip.decompress(packed)
        if len(raw) != item['bytes'] or hashlib.sha256(raw).hexdigest() != item['sha256']:
            raise ValueError(f'Recording checksum mismatch: {name}')
        record = json.loads(raw)
        if record.get('distribution', {}).get('purpose') != 'offline-replay-only':
            raise ValueError(f'Missing replay-only label: {name}')
        target = output / name
        if target.exists():
            raise FileExistsError(f'Refusing to overwrite {target}; choose a new output directory')
        prepared.append((target, raw))
    output.mkdir(parents=True, exist_ok=True)
    for target, raw in prepared:
        with target.open('xb') as file:
            file.write(raw)
    return len(prepared)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        count = unpack(args.output)
    except (OSError, ValueError, KeyError) as error:
        parser.error(str(error))
    print(f'Verified and unpacked {count} offline records to {args.output.resolve()}')


if __name__ == '__main__':
    main()
