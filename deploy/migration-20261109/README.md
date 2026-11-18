# Discord Bot migration, 2026-11-09

- Bot host: `158.101.95.109`, private address `10.0.0.225`.
- Reverse proxy: `155.248.182.197`, private address `10.0.0.97`.
- Existing public URL: `http://pexbot.mooo.com:3000`.
- Bot directory: `/home/ubuntu/Discordbot`, service: `bot.service`.
- Proxy: nginx, `/etc/nginx/sites-enabled/discordbot`.
- The new host permits port 3000 only from the old host's private address.

Install `bot.service` on the new host and `nginx-discordbot.conf` on the old
host. Disable the old `bot.service` so only one instance connects to Discord.
The proxy preserves the Host header, cookies, WebSocket upgrades, and streaming
responses. OAuth URLs in `config.json` remain unchanged.

Transfer `config.json`, `Database`, legacy `Data`, assets (including any media
cookies), source, and the built frontend. Reinstall dependencies for ARM64;
do not copy the x86-64 `node_modules`. Stop the old bot before the final data
snapshot. Keep migration archives private because they contain credentials
and session data.

The ARM64 host runs Bun 1.4.4. Rebuild canvas using the official Node.js 22
headers: Ubuntu's system Node.js build configuration links the native module
to `libnode.so.109`, which crashes other Node.js versions and Bun on import.
The verified rebuild command is:

```sh
PATH=/home/ubuntu/.local/bin:$PATH npm rebuild canvas --build-from-source \
  --nodedir=/home/ubuntu/.local/share/node-v22.23.4-linux-arm64
```

Canvas and sharp were checked together after rebuilding. The service starts
the deployed source directly; it does not run the old
`start.sh` that fetches and hard-resets Git on restart. Deploy updates explicitly
so a restart cannot discard local fixes.

For rollback, stop the new bot first, copy its latest `Database` and `Data`
back to the old host, stop nginx, and enable/start the old `bot.service`.
Do not start both bots together or overwrite newer data with the pre-migration
snapshot.

## Completed validation

- The final stopped-source snapshot contained 548 files; every extracted file
  was verified against the archive before starting the new bot.
- Private rollback snapshots are kept on both hosts at
  `/home/ubuntu/backups/discordbot-migration-20261109/final-data.tar.gz`.
- ARM64 image generation, sharp conversion, ffmpeg output, and AI API access
  passed. The persona, quote-card, and GIF regression suite passed 28 tests.
- The original public URL reports `ready: true` and 11 guilds. Its frontend
  asset hash matches the deployed build. An existing user session still works,
  and the saved persona remains present.
- WebSocket upgrade succeeds through nginx; unauthenticated connections remain
  rejected by the application. The original Origin is accepted, and protected
  POST endpoints still require authentication.
- The new bot is enabled with no restart failures. The old bot is disabled;
  nginx is enabled. Port 3000 on the new host is allowed only from `10.0.0.97`,
  with the firewall rule persisted through `netfilter-persistent`.
