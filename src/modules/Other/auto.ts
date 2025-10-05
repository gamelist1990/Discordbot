
import { Events } from "discord.js";
import { discordEventBroker } from "../..";



discordEventBroker.on(Events.GuildMemberAdd, async (member) => {
    const guildId = member.guild.id;
    const userId = member.user.id;
    // 例: await database.set(guildId, userId, { joinedAt: new Date() });

    console.log(`User ${userId} joined guild ${guildId}`);
});