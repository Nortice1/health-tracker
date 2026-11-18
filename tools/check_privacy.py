"""Conservative public-release scan. Reports locations, never matched secret values."""
from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
rules = {
    'Google deployment ID': r'AKfycb[A-Za-z0-9_-]{20,}',
    'Google document/script URL': r'https://(?:docs\.google\.com/(?:spreadsheets|document)/d/|script\.google\.com/d/)[A-Za-z0-9_-]{20,}',
    'personal spreadsheet ID': r"const SHEET_ID\s*=\s*'(?!YOUR_SPREADSHEET_ID)[^']+'",
    'API key': r'AIza[A-Za-z0-9_-]{30,}',
    'GitHub token': r'(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})',
    'private key': r'-----BEGIN (?:RSA |EC )?PRIVATE KEY-----',
    'email address': r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}',
    'local user path': r'[A-Za-z]:[\\/]Users[\\/][^\s]+',
    'personal identity': r'\b(?:North|chanp|KOSEN|KMITL)\b',
}
bad = []
for file in root.rglob('*'):
    rel = file.relative_to(root)
    if '.git' in rel.parts or 'node_modules' in rel.parts or '__pycache__' in rel.parts:
        continue
    if not file.is_file():
        continue
    name = file.name.lower()
    if (name in {'.clasp.json', '.clasprc.json', '.env'} or '.bak' in name
            or name.startswith('preview') or file.suffix.lower() in {'.csv', '.tcx', '.fit', '.xlsx', '.pem', '.key'}):
        bad.append(f'{rel}: private/generated file')
    if file == Path(__file__).resolve():
        continue  # The scanner contains identity patterns, not user data.
    try:
        text = file.read_text(encoding='utf-8')
    except (UnicodeError, OSError):
        bad.append(f'{rel}: binary/unreadable file requires manual review')
        continue
    for label, pattern in rules.items():
        for match in re.finditer(pattern, text, re.IGNORECASE):
            line = text.count('\n', 0, match.start()) + 1
            bad.append(f'{rel}:{line}: {label}')
if bad:
    print('\n'.join(bad))
    raise SystemExit(1)
print('Privacy scan passed. Manual review is still required before publication.')
