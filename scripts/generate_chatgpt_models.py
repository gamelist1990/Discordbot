from __future__ import annotations

import json
import re
import sys
import urllib.request
from pathlib import Path
from typing import Any


URL = 'https://capi.voids.top/v2/models'
ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'src' / 'core' / 'ChatGPTModels.ts'


def normalize_enum_name(model_id: str) -> str:
    name = re.sub(r'[^A-Za-z0-9]+', '_', model_id).strip('_')
    if not name:
        name = 'MODEL'
    if re.match(r'^\d', name):
        name = f'M_{name}'
    return re.sub(r'_+', '_', name).upper()


def fetch_models() -> list[dict[str, Any]]:
    with urllib.request.urlopen(URL, timeout=60) as response:
        payload = json.load(response)

    raw_models = payload.get('data', [])
    grouped: dict[str, dict[str, Any]] = {}

    for item in raw_models:
        model_id = str(item.get('id', '')).strip()
        if not model_id:
            continue

        count = item.get('count', 1)
        try:
            count_value = int(count)
        except (TypeError, ValueError):
            count_value = 1

        created = item.get('created', 0)
        try:
            created_value = int(created)
        except (TypeError, ValueError):
            created_value = 0

        owned_by = str(item.get('owned_by', 'unknown')).strip() or 'unknown'

        current = grouped.get(model_id)
        if current is None:
            grouped[model_id] = {
                'id': model_id,
                'count': count_value,
                'created': created_value,
                'ownedBy': owned_by,
            }
            continue

        current['count'] += count_value
        current['created'] = max(current['created'], created_value)
        if current['ownedBy'] == 'unknown' and owned_by != 'unknown':
            current['ownedBy'] = owned_by

    return sorted(grouped.values(), key=lambda model: (-model['count'], -model['created'], model['id']))


def build_enum_entries(models: list[dict[str, Any]]) -> str:
    used_names: dict[str, int] = {}
    lines: list[str] = []

    lines.append("export enum ChatGPTModel {")
    lines.append("    Auto = '__auto__',")

    for model in models:
        model_id = model['id']
        base_name = normalize_enum_name(model_id)
        index = used_names.get(base_name, 0)
        used_names[base_name] = index + 1

        enum_name = base_name if index == 0 else f'{base_name}_{index + 1}'
        lines.append(f"    {enum_name} = '{model_id}',")

    lines.append('}')
    lines.append('')
    lines.append("export type ChatGPTModelValue = (typeof ChatGPTModel)[keyof typeof ChatGPTModel];")
    return '\n'.join(lines)


def main() -> int:
    try:
        models = fetch_models()
        header = (
            "// src/core/ChatGPTModels.ts\n"
            "// AUTO-GENERATED FILE. DO NOT EDIT MANUALLY.\n"
            f"// Source: {URL}\n\n"
        )
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT.write_text(header + build_enum_entries(models) + '\n', encoding='utf-8')
        print(f'Wrote {OUTPUT} with {len(models)} unique models.')
        return 0
    except Exception as error:
        print(f'Failed to generate ChatGPTModels.ts: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())