# Ranking System - Developer Quick Start

## Quick Setup (5 minutes)

### 1. Enable Ranking in a Guild

```typescript
import { rankManager } from './core/RankManager.js';

// Initialize ranking data (happens automatically on first use)
const data = await rankManager.getRankingData(guildId);
```

### 2. Create a Leaderboard Panel

Via Discord command:
```
/staff rank action:create-panel preset:default channel:#ranking
```

Via code:
```typescript
// Panel will auto-update every 5 minutes by default
await rankManager.startPanelUpdateTimer(guildId);
```

### 3. Configure XP Rates

Via Discord command:
```
/staff rank action:set-update-interval value:5
```

Via API:
```typescript
const data = await rankManager.getRankingData(guildId);
data.settings.xpRates.messageXp = 10;  // Double the XP per message
data.settings.xpRates.vcXpPerMinute = 15;  // More VC XP
await rankManager.saveRankingData(guildId, data);
```

## Common Operations

### Award XP Manually

```typescript
await rankManager.addXp(guildId, userId, 100, 'bonus-event');
```

### Get User's Current Rank

```typescript
const data = await rankManager.getRankingData(guildId);
const userXp = data.users[userId]?.xp || 0;
const rank = rankManager.getUserRank(data, userXp);
console.log(`User is ${rank?.name}`);
```

### Get Leaderboard

```typescript
const top10 = await rankManager.getLeaderboard(guildId, 10);
top10.forEach((entry, i) => {
    console.log(`${i+1}. User ${entry.userId}: ${entry.xp} XP (${entry.rank})`);
});
```

### Create Custom Preset

```typescript
const data = await rankManager.getRankingData(guildId);
data.rankPresets.push({
    name: 'vip',
    description: 'VIP ranks',
    ranks: [
        { name: 'VIP Bronze', minXp: 0, maxXp: 4999, color: '#CD7F32' },
        { name: 'VIP Silver', minXp: 5000, maxXp: 19999, color: '#C0C0C0' },
        { name: 'VIP Gold', minXp: 20000, maxXp: 999999, color: '#FFD700' }
    ],
    rewards: [
        { 
            rankName: 'VIP Gold', 
            giveRoleId: 'YOUR_ROLE_ID', 
            notify: true,
            customMessage: 'Congrats on VIP Gold! 🎉'
        }
    ]
});
await rankManager.saveRankingData(guildId, data);
```

## Web API Usage

### Get Presets

```javascript
fetch('/api/staff/rankmanager/presets?guildId=123456789')
    .then(r => r.json())
    .then(presets => console.log(presets));
```

### Create Preset

```javascript
fetch('/api/staff/rankmanager/presets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        guildId: '123456789',
        name: 'custom',
        description: 'My custom preset',
        ranks: [
            { name: 'Newbie', minXp: 0, maxXp: 999 },
            { name: 'Regular', minXp: 1000, maxXp: 9999 }
        ],
        rewards: []
    })
})
.then(r => r.json())
.then(result => console.log('Created:', result));
```

### Update Settings

```javascript
fetch('/api/staff/rankmanager/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        guildId: '123456789',
        xpRates: {
            messageXp: 10,
            messageCooldownSec: 30,
            vcXpPerMinute: 15,
            dailyXpCap: 5000,
            globalMultiplier: 2.0
        }
    })
})
.then(r => r.json())
.then(result => console.log('Updated:', result));
```

## Event Hooks

The system automatically tracks XP from:

### Messages
```typescript
// Happens automatically in EventHandler
// Awards XP based on settings.xpRates.messageXp
// Respects cooldown and daily cap
```

### Voice Chat
```typescript
// Tracks join/leave automatically
// Awards XP based on time in VC
// Formula: (minutes in VC) * settings.xpRates.vcXpPerMinute
```

### Custom Events

You can manually trigger XP awards:

```typescript
// In your custom event handler
client.on('someCustomEvent', async (data) => {
    await rankManager.addXp(guildId, userId, 50, 'custom-event');
});
```

## Advanced Configuration

### Exclude Specific Channels

```typescript
const data = await rankManager.getRankingData(guildId);
data.settings.xpRates.excludeChannels.push('CHANNEL_ID');
await rankManager.saveRankingData(guildId, data);
```

### Exclude Roles (e.g., bots, muted users)

```typescript
const data = await rankManager.getRankingData(guildId);
data.settings.xpRates.excludeRoles.push('MUTED_ROLE_ID');
await rankManager.saveRankingData(guildId, data);
```

### Event XP Multiplier

```typescript
// Double XP weekend
const data = await rankManager.getRankingData(guildId);
data.settings.xpRates.globalMultiplier = 2.0;
await rankManager.saveRankingData(guildId, data);

// After event
data.settings.xpRates.globalMultiplier = 1.0;
await rankManager.saveRankingData(guildId, data);
```

### Daily XP Cap

```typescript
const data = await rankManager.getRankingData(guildId);
data.settings.xpRates.dailyXpCap = 1000;  // Max 1000 XP per day
await rankManager.saveRankingData(guildId, data);
```

## Debugging

### Check User XP

```typescript
const data = await rankManager.getRankingData(guildId);
const user = data.users[userId];
console.log('User XP:', user?.xp);
console.log('Daily XP:', user?.dailyXp);
console.log('Last message:', new Date(user?.lastMessageTime || 0));
```

### Check Panel Status

```typescript
const data = await rankManager.getRankingData(guildId);
for (const [panelId, panel] of Object.entries(data.panels)) {
    console.log(`Panel ${panelId}:`);
    console.log('  Channel:', panel.channelId);
    console.log('  Message:', panel.messageId);
    console.log('  Last update:', panel.lastUpdate);
}
```

### Force Panel Update

```typescript
await rankManager.updateAllPanels(guildId);
```

## Common Issues

### XP Not Being Awarded

Check:
1. User in excludedRoles?
2. Channel in excludedChannels?
3. Within cooldown period?
4. Daily cap reached?

### Panel Not Updating

Check:
1. Update timer started? `await rankManager.startPanelUpdateTimer(guildId)`
2. Bot has permissions in channel?
3. Panel message still exists?

### Rank Not Showing

Check:
1. XP ranges don't overlap
2. XP ranges cover all possible values
3. User XP within defined ranges

## Performance Tips

1. **Cache frequently accessed data** - The system already caches, but avoid excessive calls
2. **Batch XP operations** - If awarding to multiple users, batch the operations
3. **Adjust panel update interval** - Don't update more frequently than needed
4. **Limit leaderboard size** - Top 10-20 is usually sufficient

## TypeScript Tips

```typescript
import { RankManager, RankingData, UserXpData } from './core/RankManager.js';

// Full type safety
const data: RankingData = await rankManager.getRankingData(guildId);
const user: UserXpData | undefined = data.users[userId];

// Type-safe updates
if (user) {
    user.xp += 100;
    user.lastUpdated = new Date().toISOString();
    await rankManager.saveRankingData(guildId, data);
}
```

## Next Steps

1. Read the full documentation: `docs/RANKING_SYSTEM.md`
2. Check implementation details: `docs/RANKING_IMPLEMENTATION.md`
3. Run validation: `node test/validate-rank-system.cjs`
4. Explore the code: `src/core/RankManager.ts`

## Support

For issues or questions:
1. Check the troubleshooting section in `docs/RANKING_SYSTEM.md`
2. Review the implementation in `src/core/RankManager.ts`
3. Run the validation script to ensure everything is set up correctly
