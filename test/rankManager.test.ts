/**
 * Basic tests for RankManager
 * 
 * These tests validate core ranking system functionality
 */

import { Database } from '../src/core/Database.js';
import { RankManager } from '../src/core/RankManager.js';

/**
 * Test RankManager XP calculations
 */
async function testRankManager() {
    console.log('🧪 Testing RankManager...\n');

    // Create test database instance
    const testDb = new Database('/tmp/test-rank-data');
    await testDb.initialize();

    const rankManager = new RankManager(testDb);
    const testGuildId = 'test-guild-123';
    const testUserId = 'test-user-456';

    try {
        // Test 1: Initialize ranking data
        console.log('✓ Test 1: Initialize ranking data');
        const data = await rankManager.getRankingData(testGuildId);
        console.log(`  - Found ${data.rankPresets.length} default preset(s)`);
        console.log(`  - Default preset: ${data.rankPresets[0].name}`);
        console.log(`  - Ranks: ${data.rankPresets[0].ranks.map(r => r.name).join(', ')}`);

        // Test 2: Add XP to user
        console.log('\n✓ Test 2: Add XP to user');
        await rankManager.addXp(testGuildId, testUserId, 100, 'test');
        const updatedData = await rankManager.getRankingData(testGuildId);
        const userXp = updatedData.users[testUserId]?.xp || 0;
        console.log(`  - User XP: ${userXp}`);
        if (userXp !== 100) throw new Error('XP not added correctly');

        // Test 3: Get user rank
        console.log('\n✓ Test 3: Get user rank');
        const rank = rankManager.getUserRank(updatedData, userXp);
        console.log(`  - User rank: ${rank?.name || 'none'}`);
        console.log(`  - Rank range: ${rank?.minXp} - ${rank?.maxXp} XP`);
        if (!rank) throw new Error('Rank not found');

        // Test 4: Add more XP to trigger rank up
        console.log('\n✓ Test 4: Add XP to reach next rank');
        await rankManager.addXp(testGuildId, testUserId, 950, 'test');
        const data2 = await rankManager.getRankingData(testGuildId);
        const newXp = data2.users[testUserId]?.xp || 0;
        const newRank = rankManager.getUserRank(data2, newXp);
        console.log(`  - User XP: ${newXp}`);
        console.log(`  - New rank: ${newRank?.name || 'none'}`);
        if (newXp !== 1050) throw new Error('XP calculation incorrect');

        // Test 5: Get next rank
        console.log('\n✓ Test 5: Get next rank');
        const nextRank = rankManager.getNextRank(data2, newXp);
        console.log(`  - Next rank: ${nextRank?.name || 'max rank reached'}`);
        if (nextRank) {
            console.log(`  - Required XP: ${nextRank.minXp}`);
            console.log(`  - XP to go: ${nextRank.minXp - newXp}`);
        }

        // Test 6: Test leaderboard
        console.log('\n✓ Test 6: Get leaderboard');
        // Add another user
        await rankManager.addXp(testGuildId, 'user-2', 500, 'test');
        await rankManager.addXp(testGuildId, 'user-3', 2000, 'test');
        const leaderboard = await rankManager.getLeaderboard(testGuildId, 5);
        console.log(`  - Leaderboard has ${leaderboard.length} entries`);
        leaderboard.forEach((entry, i) => {
            console.log(`    ${i + 1}. User ${entry.userId}: ${entry.xp} XP (${entry.rank})`);
        });

        // Test 7: Test XP rates
        console.log('\n✓ Test 7: Test XP rate settings');
        const settings = data2.settings;
        console.log(`  - Message XP: ${settings.xpRates.messageXp}`);
        console.log(`  - Message cooldown: ${settings.xpRates.messageCooldownSec}s`);
        console.log(`  - VC XP per minute: ${settings.xpRates.vcXpPerMinute}`);
        console.log(`  - Daily XP cap: ${settings.xpRates.dailyXpCap || 'unlimited'}`);

        // Test 8: Test daily XP cap
        console.log('\n✓ Test 8: Test daily XP cap');
        const data3 = await rankManager.getRankingData(testGuildId);
        data3.settings.xpRates.dailyXpCap = 100;
        await rankManager.saveRankingData(testGuildId, data3);
        
        // Try to add more XP than daily cap
        await rankManager.addXp(testGuildId, 'capped-user', 150, 'test');
        const data4 = await rankManager.getRankingData(testGuildId);
        const cappedXp = data4.users['capped-user']?.xp || 0;
        console.log(`  - Attempted to add 150 XP with 100 cap`);
        console.log(`  - Actual XP gained: ${cappedXp}`);
        if (cappedXp > 100) throw new Error('Daily XP cap not working');

        console.log('\n✅ All tests passed!\n');
        return true;
    } catch (error) {
        console.error('\n❌ Test failed:', error);
        return false;
    }
}

/**
 * Run all tests
 */
async function runTests() {
    console.log('='.repeat(50));
    console.log('RankManager Test Suite');
    console.log('='.repeat(50) + '\n');

    const success = await testRankManager();

    console.log('='.repeat(50));
    if (success) {
        console.log('✅ Test suite completed successfully');
    } else {
        console.log('❌ Test suite failed');
        process.exit(1);
    }
    console.log('='.repeat(50));
}

// Run tests
runTests().catch(error => {
    console.error('Fatal test error:', error);
    process.exit(1);
});
