#!/usr/bin/env bash
set -Eeuo pipefail
BASE=/home/pexserver/WorkSpace/DevBox/Discordbot
TARGET=ubuntu@100.112.64.87
KEY=/home/pexserver/.ssh/id_discordbot_migration_20251015
REMOTE=/home/ubuntu/Discordbot
cd "$BASE"
echo STAGING
for f in src/core/ai/DotWebResearch.ts src/core/ai/StaffAIDotAmbient.ts src/commands/staff/subcommands/StaffAIStyle.ts src/commands/staff/subcommands/ai.ts src/commands/staff/subcommands/ai-tools/drawing.ts; do
  scp -q -o BatchMode=yes -o ConnectTimeout=8 -i "$KEY" "$BASE/$f" "$TARGET:$REMOTE/$f.staged-dotweb"
done
ssh -o BatchMode=yes -o ConnectTimeout=8 -i "$KEY" "$TARGET" 'bash -s' <<'REMOTE_BASH'
set -Eeuo pipefail
cd /home/ubuntu/Discordbot
STAMP=$(date +%Y%m%d-%H%M%S)
for f in src/core/ai/DotWebResearch.ts src/core/ai/StaffAIDotAmbient.ts src/commands/staff/subcommands/StaffAIStyle.ts src/commands/staff/subcommands/ai.ts src/commands/staff/subcommands/ai-tools/drawing.ts; do
  test -s "$f.staged-dotweb"
  if [[ -f "$f" ]]; then cp -p "$f" "$f.before-dotweb-$STAMP"; fi
done
echo "BACKUP_STAMP=$STAMP"
rollback() {
  set +e
  for f in src/core/ai/DotWebResearch.ts src/core/ai/StaffAIDotAmbient.ts src/commands/staff/subcommands/StaffAIStyle.ts src/commands/staff/subcommands/ai.ts src/commands/staff/subcommands/ai-tools/drawing.ts; do
    if [[ -f "$f.before-dotweb-$STAMP" ]]; then cp -p "$f.before-dotweb-$STAMP" "$f"; else rm -f "$f"; fi
  done
  sudo -n systemctl restart bot.service
  echo "ROLLBACK_DONE service=$(systemctl is-active bot.service)"
}
trap rollback ERR
for f in src/core/ai/DotWebResearch.ts src/core/ai/StaffAIDotAmbient.ts src/commands/staff/subcommands/StaffAIStyle.ts src/commands/staff/subcommands/ai.ts src/commands/staff/subcommands/ai-tools/drawing.ts; do
 mv -f "$f.staged-dotweb" "$f"
done
/home/ubuntu/.bun/bin/bun -e '
import {dotWebResearchQuery,registerDotWebSearchTool} from "./src/core/ai/DotWebResearch.ts";
import {completeStaffDrawingTool} from "./src/commands/staff/subcommands/ai-tools/drawing.ts";
import {AMBIENT_SYSTEM_RULES} from "./src/core/ai/StaffAIDotAmbient.ts";
if(!dotWebResearchQuery("webで最新情報を検索して"))throw Error("missing search routing");
const names=[];registerDotWebSearchTool({registerTool:d=>names.push(d.function.name)});
if(names.length!==1||names[0]!=="web_search")throw Error("missing web search function");
if(!AMBIENT_SYSTEM_RULES.includes("web_search"))throw Error("ambient prompt missing");
const result=completeStaffDrawingTool([{name:"draw_image",output:"IMAGE_POSTED: "+JSON.stringify({filename:"cat.png",url:"https://cdn.discordapp.com/attachments/test/cat.png",render:1})}]);
if(!result?.includes("https://cdn.discordapp.com/attachments/test/cat.png"))throw Error("image link missing");
console.log("REMOTE_DOT_WEB_AND_IMAGE_URL_MODULES_OK");
'
sudo -n systemctl restart bot.service
for i in $(seq 1 60); do
 if systemctl is-active --quiet bot.service; then break; fi
 sleep .3
done
sleep 2
systemctl is-active --quiet bot.service
echo "BOT_SERVICE_RESTARTED $(systemctl is-active bot.service)"
trap - ERR
REMOTE_BASH
