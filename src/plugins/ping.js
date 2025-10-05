
const PingCommand = {
    name: 'ping',
    description: 'Botの応答速度を確認します。',
    aliases: ['p'],
    usage: 'ping',

    async execute(client, message, _args) {
        const msg = await message.channel.send('🏓 計測中...');
        const latency = msg.createdTimestamp - message.createdTimestamp;
        const apiLatency = Math.round(client.ws.ping);
        await msg.edit(`🏓 Pong! (応答時間: ${latency}ms, APIレイテンシ: ${apiLatency}ms)`);
    }
};

module.exports = PingCommand;