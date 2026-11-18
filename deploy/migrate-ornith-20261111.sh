#!/usr/bin/env bash
set -Eeuo pipefail
BASE=/home/pexserver/WorkSpace/DevBox/Discordbot
TARGET=ubuntu@100.112.64.87
KEY=/home/pexserver/.ssh/id_discordbot_migration_20251015
REMOTE=/home/ubuntu/Discordbot
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=8 -i "$KEY")
SCP=(scp -q -o BatchMode=yes -o ConnectTimeout=8 -i "$KEY")
"${SSH[@]}" "$TARGET" 'bash -s' <<'REMOTE_PREP'
set -Eeuo pipefail
cd /home/ubuntu/Discordbot
STAMP=$(date +%Y%m%d-%H%M%S)
for f in config.json src/config.ts src/commands/staff/subcommands/StaffAIStreamState.ts; do
 cp -p "$f" "$f.before-ornith-$STAMP"
done
printf '%s\n' "$STAMP" > /home/ubuntu/Discordbot/.last-ornith-backup-stamp
python3 - <<'PY'
from pathlib import Path
import json,os
p=Path('config.json');j=json.loads(p.read_text());x=j['pexAi']
old='qwen3.6-35b-a3b-strata';new='ornith-1.5-35b-a3b-strata'
assert x['model']==old and x['contentSafetyModel']=='lfm3'
for k in ('model','channelModel','visionModel','fallbackModel'):
 if x.get(k)==old:x[k]=new
for z in x.get('steps',[]):
 if z.get('model')==old:z['model']=new
assert x['contentSafetyModel']=='lfm3'
tmp=p.with_name('config.json.ornith-tmp');tmp.write_text(json.dumps(j,ensure_ascii=False,indent=4)+'\n');tmp.chmod(0o600);os.replace(tmp,p)
print('REMOTE_CONFIG_CHANGED',x['model'],'CONTENT_SAFETY',x['contentSafetyModel'],flush=True)
PY
REMOTE_PREP
"${SCP[@]}" "$BASE/src/config.ts" "$TARGET:$REMOTE/src/config.ts"
"${SCP[@]}" "$BASE/src/commands/staff/subcommands/StaffAIStreamState.ts" "$TARGET:$REMOTE/src/commands/staff/subcommands/StaffAIStreamState.ts"
"${SSH[@]}" "$TARGET" 'bash -s' <<'REMOTE_VERIFY'
set -Eeuo pipefail
cd /home/ubuntu/Discordbot
python3 - <<'PY'
import json
x=json.load(open('config.json'))['pexAi']
assert x['model']=='ornith-1.5-35b-a3b-strata'
assert x['visionModel']==x['model'] and x['channelModel']==x['model']
assert x['contentSafetyModel']=='lfm3'
s=open('src/commands/staff/subcommands/StaffAIStreamState.ts').read()
assert 'AIからの初回出力を待機中' in s and 'PREFILL_TOKENS_PER_SECOND' not in s
assert 'ornith-1.5-35b-a3b-strata' in open('src/config.ts').read()
print('SOURCE_CONFIG_OK')
PY
sudo -n systemctl restart bot.service
for i in $(seq 1 40); do
 systemctl is-active --quiet bot.service && break
 sleep .5
done
systemctl is-active bot.service
echo BOT_RESTARTED
REMOTE_VERIFY
