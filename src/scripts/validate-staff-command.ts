#!/usr/bin/env node
/**
 * Staff Command Validation Script
 * Validates the structure and exports of the staff command module
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function validateStaffCommand() {
    console.log('🔍 Validating Staff Command Module...\n');

    try {
        // Import the staff command
        const staffCommandModule = await import(join(__dirname, '../commands/staff/index.js'));
        const staffCommand = staffCommandModule.default;

        // Validate command structure
        console.log('✓ Staff command module imported successfully');

        if (!staffCommand) {
            throw new Error('Staff command default export is undefined');
        }
        console.log('✓ Staff command has default export');

        if (!staffCommand.data) {
            throw new Error('Staff command missing "data" property');
        }
        console.log('✓ Staff command has "data" property');

        if (staffCommand.data.name !== 'staff') {
            throw new Error(`Expected command name "staff", got "${staffCommand.data.name}"`);
        }
        console.log('✓ Command name is "staff"');

        if (typeof staffCommand.execute !== 'function') {
            throw new Error('Staff command "execute" is not a function');
        }
        console.log('✓ Staff command has "execute" function');

        // Check subcommands
        const subcommands = staffCommand.data.options || [];
        console.log(`\n📋 Subcommands found: ${subcommands.length}`);

        const expectedSubcommands = ['help', 'privatechat'];
        for (const expectedSub of expectedSubcommands) {
            const found = subcommands.find(
                (opt: any) => opt.type === 1 && opt.name === expectedSub
            );
            if (!found) {
                throw new Error(`Missing expected subcommand: ${expectedSub}`);
            }
            console.log(`  ✓ Subcommand "${expectedSub}" is registered`);
        }

        // Import and validate subcommand handlers
        console.log('\n🔍 Validating subcommand handlers...');

        const helpModule = await import(join(__dirname, '../commands/staff/help.js'));
        if (typeof helpModule.handleHelpSubcommand !== 'function') {
            throw new Error('help.js missing handleHelpSubcommand function');
        }
        console.log('  ✓ help.js exports handleHelpSubcommand');

        const privateChatModule = await import(join(__dirname, '../commands/staff/privatechat.js'));
        if (typeof privateChatModule.handlePrivateChatSubcommand !== 'function') {
            throw new Error('privatechat.js missing handlePrivateChatSubcommand function');
        }
        console.log('  ✓ privatechat.js exports handlePrivateChatSubcommand');

        // Check permissions
        console.log('\n🔒 Validating permissions...');
        if (!staffCommand.data.default_member_permissions) {
            console.warn('  ⚠️  No default member permissions set');
        } else {
            console.log('  ✓ Default permissions configured');
        }

        if (staffCommand.data.dm_permission !== false) {
            console.warn('  ⚠️  DM permission not disabled');
        } else {
            console.log('  ✓ DM permission disabled (guild-only)');
        }

        console.log('\n✅ All validations passed!');
        console.log('\n📊 Command Summary:');
        console.log(`   Name: ${staffCommand.data.name}`);
        console.log(`   Description: ${staffCommand.data.description}`);
        console.log(`   Subcommands: ${subcommands.length}`);
        console.log(`   Guild Only: ${staffCommand.data.dm_permission === false}`);

        return true;
    } catch (error) {
        console.error('\n❌ Validation failed:', error);
        return false;
    }
}

// Run validation
validateStaffCommand().then(success => {
    process.exit(success ? 0 : 1);
});
