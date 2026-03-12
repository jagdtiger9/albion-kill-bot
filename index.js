import { DISCORD_TOKEN } from './config.js';
import { Client, GatewayIntentBits } from 'discord.js';
import sqlite3pkg from 'sqlite3';
import KillBotApi from './src/KillbotApi.js';

const sqlite3 = sqlite3pkg.verbose();
const bot = new Client({ intents: [GatewayIntentBits.Guilds] });
const KillBot = new KillBotApi(bot, sqlite3);

bot.once('clientReady', () => {
    console.log('Connected');
    console.log(`Logged in as: ${bot.user.username} - (${bot.user.id})`);

    KillBot.initDatabase();

    KillBot.checkKills();
    KillBot.checkKillsInterval(30000);

    KillBot.checkBattles();
    KillBot.checkBattlesInterval(30000);
});

bot.login(DISCORD_TOKEN);
