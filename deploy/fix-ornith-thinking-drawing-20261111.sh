#!/usr/bin/env bash
set -Eeuo pipefail
BASE=/home/pexserver/WorkSpace/DevBox/Discordbot
REMOTE=/home/ubuntu/Discordbot
TARGET=ubuntu@100.112.64.87
KEY=/home/pexserver/.ssh/id_discordbot_migration_20251015
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=8 -i "$KEY")
SCP=(scp -q -o BatchMode=yes -o ConnectTimeout=8 -i "$KEY")
FILES=(
 src/core/ai/ChatGPTClient.ts
 src/core/ai/ThinkingStreamDemux.ts
 src/commands/staff/subcommands/StaffAIStyle.ts
 src/commands/staff/subcommands/StaffAIDrawingIntent.ts
 src/commands/staff/subcommands/ai-tools/drawing.ts
 src/commands/staff/subcommands/ai.ts
)
cd "$BASE"
"${SSH[@]}" "$TARGET" 'bash -s' <<'PREP'
set -Eeuo pipefail
cd /home/ubuntu/Discordbot
stamp=$(date +%Y%m%d-%H%M%S)
for f in src/core/ai/ChatGPTClient.ts src/core/ai/ThinkingStreamDemux.ts src/commands/staff/subcommands/StaffAIStyle.ts src/commands/staff/subcommands/StaffAIDrawingIntent.ts src/commands/staff/subcommands/ai-tools/drawing.ts src/commands/staff/subcommands/ai.ts; do
 if [[ -f "$f" ]]; then cp -p "$f" "$f.before-drawing-thinking-$stamp"; fi
done
echo "SOURCE_BACKUPS=$stamp"
PREP
for f in "${FILES[@]}"; do
 "${SCP[@]}" "$BASE/$f" "$TARGET:$REMOTE/$f.staged-ornith"
done
"${SSH[@]}" "$TARGET" 'bash -s' <<'COMMIT'
set -Eeuo pipefail
cd /home/ubuntu/Discordbot
for f in src/core/ai/ChatGPTClient.ts src/core/ai/ThinkingStreamDemux.ts src/commands/staff/subcommands/StaffAIStyle.ts src/commands/staff/subcommands/StaffAIDrawingIntent.ts src/commands/staff/subcommands/ai-tools/drawing.ts src/commands/staff/subcommands/ai.ts; do
 test -s "$f.staged-ornith"
 mv -f "$f.staged-ornith" "$f"
done
/home/ubuntu/.bun/bin/bun -e 'import {isStaffDrawingRequest} from "./src/commands/staff/subcommands/StaffAIDrawingIntent.ts"; import {ThinkingStreamDemux} from "./src/core/ai/ThinkingStreamDemux.ts"; const d=new ThinkingStreamDemux();const a=[...d.push({type:"text",text:"思考</thi"}),...d.push({type:"text",text:"nk>答え"}),...d.finish()];if(!isStaffDrawingRequest("猫描いて")||a.filter(x=>x.type==="text").map(x=>x.text).join("")!=="答え")throw Error("runtime check failed"); console.log("REMOTE_MODULES_OK");'
sudo -n systemctl restart bot.service
for _ in {1..50}; do
 systemctl is-active --quiet bot.service && break
 sleep .2
done
systemctl is-active bot.service
echo 'BOT_RESTARTED_WITH_THINKING_AND_DRAWING_FIX'
COMMIT
