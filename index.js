import { DISCORD_TOKEN } from './config.js';
import { Client, GatewayIntentBits } from 'discord.js';
import sqlite3pkg from 'sqlite3';
import KillBotApi from './src/KillbotApi.js';

process.on('unhandledRejection', (err) => {
    console.error('Unhandled rejection:', err);
});

const sqlite3 = sqlite3pkg.verbose();
const bot = new Client({ intents: [GatewayIntentBits.Guilds] });
const KillBot = new KillBotApi(bot, sqlite3);

bot.once('clientReady', async () => {
    console.log('Connected');
    console.log(`Logged in as: ${bot.user.username} - (${bot.user.id})`);

    await KillBot.initDatabase();

    KillBot.checkKills();
    KillBot.checkKillsInterval(30000);

    KillBot.checkBattles();
    KillBot.checkBattlesInterval(30000);
});

bot.login(DISCORD_TOKEN).catch((err) => {
    console.error('Failed to login:', err.message);
    process.exit(1);
});
