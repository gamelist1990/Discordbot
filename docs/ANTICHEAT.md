# AntiCheat System

A modular anti-spam and moderation system for Discord servers with trust-based scoring and configurable punishments.

## Overview

The AntiCheat system monitors user messages and assigns trust scores based on detected violations. When a user's trust score reaches configured thresholds, automatic or manual punishments can be applied.

**Key Features:**
- 🔍 **Modular Detector System** - Plug-and-play detectors for different violation types
- 📊 **Trust Score Tracking** - Persistent per-user trust scores with history
- ⚙️ **Configurable Thresholds** - Set custom punishment rules based on trust scores
- 🎯 **Flexible Punishments** - Timeout, kick, or ban with customizable reasons
- 🌐 **Web Management** - Desktop and mobile-optimized admin interface
- 🛡️ **Role/Channel Exclusions** - Exclude staff roles and specific channels

## Architecture

### Core Components

```
src/core/anticheat/
├── AntiCheatManager.ts      # Main manager - coordinates detection & punishment
├── PunishmentExecutor.ts    # Executes Discord punishments (timeout/kick/ban)
├── types.ts                 # Type definitions
└── detectors/
    └── TextSpamDetector.ts  # Detects duplicate & rapid messages
```

### Data Flow

```
Message → Detector → Trust Score Adjustment → Threshold Check → Punishment
```

## Default Configuration

```json
{
  "enabled": false,                    // System disabled by default
  "detectors": {
    "textSpam": { 
      "enabled": true, 
      "config": {} 
    }
  },
  "punishments": [],                   // No auto-punishments by default
  "excludedRoles": [],
  "excludedChannels": [],
  "logChannelId": null,
  "userTrust": {},
  "recentLogs": []
}
```

## Usage

### 1. Enable the System

1. Navigate to `/staff/anticheat/{guildId}` in the web dashboard
2. Toggle the system to **ON**
3. Enable desired detectors (TextSpam is enabled by default)

### 2. Configure Auto-Punishments (Optional)

**Log-Only Mode (Recommended First):**
- Leave punishments empty
- Monitor logs for 1 week to check false positive rate

**Add Punishment Rules:**
1. Click "Add Punishment Rule" in the web UI
2. Set threshold (e.g., 5)
3. Set action (e.g., timeout for 300 seconds)
4. The system will automatically apply punishments when trust scores reach thresholds

**Suggested Thresholds:**
- `5` → Timeout 5 minutes
- `10` → Timeout 60 minutes  
- `20` → Ban

### 3. Exclusions

**Exclude Staff Roles:**
```json
"excludedRoles": ["role_id_1", "role_id_2"]
```

**Exclude Channels:**
```json
"excludedChannels": ["channel_id_1", "channel_id_2"]
```

### 4. Manual Actions

Use the web UI to:
- **Execute manual punishments** on specific users
- **Revoke timeouts** (with optional trust score reset)
- **View detection logs** with search/filter
- **Monitor trust scores** for all users

## Detectors

### TextSpamDetector

Detects message spam patterns:

**Patterns Detected:**
- **Duplicate Messages** - Same message sent 3+ times (score +2 per duplicate)
- **Rapid Sending** - 5+ messages in 5 seconds (score +1 per message)
- **All Caps Spam** - 3+ consecutive all-caps messages (score +1)

**Configuration:**
- Tracks last 10 messages per user
- Message cache TTL: 1 minute
- Stored in memory (CacheManager)

## Web API

All endpoints require staff authentication.

### GET `/api/staff/anticheat/:guildId/settings`
Get guild AntiCheat settings

**Response:**
```json
{
  "settings": { /* GuildAntiCheatSettings */ },
  "userTrustCount": 42
}
```

### POST `/api/staff/anticheat/:guildId/settings`
Update guild settings

**Body:**
```json
{
  "enabled": true,
  "detectors": { /* ... */ },
  "punishments": [ /* ... */ ]
}
```

### GET `/api/staff/anticheat/:guildId/logs?limit=50&before=timestamp`
Get detection logs

### POST `/api/staff/anticheat/:guildId/action`
Execute manual punishment

**Body:**
```json
{
  "userId": "123456789",
  "action": {
    "type": "timeout",
    "durationSeconds": 300,
    "reasonTemplate": "Manual action by staff",
    "notify": true
  }
}
```

### POST `/api/staff/anticheat/:guildId/revoke`
Revoke timeout

**Body:**
```json
{
  "userId": "123456789",
  "resetTrust": true
}
```

### GET `/api/staff/anticheat/:guildId/trust?userId=123456789`
Get user trust data

## Data Storage

Settings and trust scores are stored in:
```
Data/Guild/{guildId}/anticheat.json
```

**Schema:**
```typescript
interface GuildAntiCheatSettings {
  enabled: boolean;
  detectors: Record<string, DetectorConfig>;
  punishments: PunishmentThreshold[];
  excludedRoles: string[];
  excludedChannels: string[];
  logChannelId: string | null;
  userTrust: Record<string, UserTrustData>;
  recentLogs: DetectionLog[];
}

interface UserTrustData {
  score: number;
  lastUpdated: string;
  history: TrustHistoryEntry[];
}
```

## Web UI

### Desktop View (≥768px)
- **Settings Tab**: Detector toggles, punishment rules, exclusions
- **Logs Tab**: Table view with search/filter, bulk operations
- **Trust Tab**: User trust score management

### Mobile View (<768px)
- **Overview**: System status, detector toggles
- **Logs**: Card-based list with prominent revoke buttons
- One-tap enable/disable
- Essential settings only

## Extending the System

### Add a Custom Detector

1. Create detector class implementing `Detector` interface:

```typescript
import { Detector, DetectionContext, DetectionResult } from '../types.js';

export class MyDetector implements Detector {
  name = 'myDetector';
  
  async detect(message: Message, context: DetectionContext): Promise<DetectionResult> {
    // Your detection logic
    return {
      scoreDelta: 0,
      reasons: [],
      metadata: {}
    };
  }
}
```

2. Register in AntiCheatManager:

```typescript
antiCheatManager.registerDetector(new MyDetector());
```

3. Add to default settings:

```typescript
detectors: {
  textSpam: { enabled: true, config: {} },
  myDetector: { enabled: false, config: {} }
}
```

## Security Considerations

- ✅ Staff-only authentication via SessionService
- ✅ Guild access verification on all endpoints
- ✅ No sensitive data in client-side code
- ✅ Rate limiting via Discord's native limits
- ✅ Input validation on all API endpoints
- ⚠️ Path injection alerts in Database.ts are pre-existing and acceptable for internal use

## Best Practices

1. **Start with Log-Only Mode**
   - Monitor for 1 week before enabling auto-punishments
   - Check for false positives

2. **Use Conservative Thresholds**
   - Start with higher thresholds (e.g., 10+)
   - Lower gradually based on observed behavior

3. **Configure Exclusions**
   - Always exclude staff roles
   - Exclude bot-command channels if needed

4. **Review Logs Regularly**
   - Check detection accuracy
   - Adjust detector sensitivity as needed

5. **Set a Log Channel**
   - Configure `logChannelId` for transparency
   - Staff can review all automatic actions

## Troubleshooting

**System not detecting violations:**
- Check if system is enabled (`enabled: true`)
- Check if detector is enabled
- Check if user has excluded role
- Check if channel is excluded

**Trust scores not persisting:**
- Check Data/Guild/{guildId}/anticheat.json exists
- Check database write permissions
- Check logs for database errors

**Web UI not loading:**
- Check staff authentication
- Check guild access in SessionService
- Check browser console for errors

**Punishments not executing:**
- Check bot has timeout/kick/ban permissions
- Check punishment configuration is correct
- Check threshold values are set properly

## License

MIT
