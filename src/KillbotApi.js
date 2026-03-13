import { readFileSync, writeFileSync, existsSync } from 'fs';
import { AttachmentBuilder } from 'discord.js';
import {
    TRACK_GUILDS,
    KILL_MIN_FAME,
    DISCORD_CHANNEL_ID,
    BATTLE_MIN_PLAYER,
    BATTLE_MIN_RELEVANT_PLAYER,
} from '../config.js';
import { createImage } from './createImage.js';
import Battle from './Battle/Battle.js';
import AlbionApi from './AlbionApi.js';

const INFO_URL = 'https://www.albiononline2d.com/en/scoreboard';
const DB_JSON_PATH = './database/.db.json';

function loadJsonDb() {
    if (!existsSync(DB_JSON_PATH)) {
        const defaults = { recents: { battleId: 0, eventId: 0 } };
        writeFileSync(DB_JSON_PATH, JSON.stringify(defaults, null, 2));
        return defaults;
    }
    try {
        return JSON.parse(readFileSync(DB_JSON_PATH, 'utf8'));
    } catch {
        console.error('Corrupted JSON db, resetting.');
        const defaults = { recents: { battleId: 0, eventId: 0 } };
        writeFileSync(DB_JSON_PATH, JSON.stringify(defaults, null, 2));
        return defaults;
    }
}

function saveJsonDb(data) {
    writeFileSync(DB_JSON_PATH, JSON.stringify(data, null, 2));
}

export default class KillBot {
    constructor(bot, sqlite3) {
        this.jsonDb = loadJsonDb();
        if (!this.jsonDb.recents) {
            this.jsonDb.recents = { battleId: 0, eventId: 0 };
            saveJsonDb(this.jsonDb);
        }

        this.lastEventId = this.jsonDb.recents.eventId || 0;
        this.lastBattleId = this.jsonDb.recents.battleId || 0;

        this.bot = bot;
        this.sqlite3 = sqlite3;

        this.albionApi = new AlbionApi();
    }

    checkKillsInterval(timeout) {
        setInterval(() => this.checkKills(), timeout);
    }

    checkBattlesInterval(timeout) {
        setInterval(() => this.checkBattles(), timeout);
    }

    /**
     * Запрашиваем список событий, пачками по 51
     * Если ID первого события в списке больше последнего запомненного, запрашиваем следующую пачку
     * this.lastEventId - ID последнего обработанного события из последней транзакции
     *
     * @param startPos  смещение пачки, первый запрос - 0
     * @param minRangeId
     * @param maxRangeId    ID первого обработанного события предыдущей пачки
     */
    async checkKills(startPos = 0, minRangeId = this.lastEventId, maxRangeId = 0) {
        try {
            const events = await this.albionApi.getEvents({ limit: 51, offset: startPos * 51 });
            if (!events?.length) return;

            events.sort((a, b) => a.EventId - b.EventId);
            const minEventId = events[0].EventId;
            const maxEventId = events[events.length - 1].EventId;
            const range = await this.getInRange(minEventId, maxEventId);
            this.log(startPos, '; last:', minRangeId, 'min:', minEventId, 'max:', maxEventId, 'range:', range.length);

            if (minEventId > minRangeId && startPos < 5) {
                await this.checkKills(startPos + 1, minRangeId, minEventId);
            }

            const filtered = events.filter(event =>
                event.EventId > minRangeId
                && (!maxRangeId || event.EventId < maxRangeId)
                && !range.includes(event.EventId)
                && (TRACK_GUILDS.includes(event.Killer.GuildName) || TRACK_GUILDS.includes(event.Victim.GuildName))
                && event.TotalVictimKillFame > KILL_MIN_FAME
            );

            filtered.forEach(event => this.sendKillReport(event));
            await this.saveRange(startPos, filtered.map(e => e.EventId), maxEventId);
        } catch (error) {
            this.log('checkKills error:', error);
        }
    }

    sendKillReport(event, channelId) {
        const isFriendlyKill = TRACK_GUILDS.includes(event.Killer.GuildName);

        createImage('Victim', event)
            .then(imgBufferVictim => {
                const participants = event.numberOfParticipants ?? event.GroupMembers?.length ?? 1;
                const assists = participants - 1;

                const embed = {
                    url: `https://albiononline.com/en/killboard/kill/${event.EventId}`,
                    title: '',
                    description: '',
                    color: isFriendlyKill ? 0x00FF00 : 0xFF0000,
                    image: { url: 'attachment://kill.png' },
                };

                if (event.TotalVictimKillFame > KILL_MIN_FAME) {
                    Object.assign(embed, {
                        title: `${event.Killer.Name} just killed ${event.Victim.Name}!`,
                        description: `Fame: **${event.TotalVictimKillFame.toLocaleString()}**${assists ? '' : ' Solo kill'}`,
                        fields: [],
                        timestamp: event.TimeStamp,
                    });

                    const assistant = event.Participants.reduce((acc, item) => {
                        const value = item.DamageDone || item.SupportHealingDone;
                        const record = `${Math.round(value).toLocaleString()} - [${item.Name}](${INFO_URL}/players/${item.Id})`;
                        if (item.DamageDone) acc.dd.push(record);
                        if (item.SupportHealingDone) acc.heal.push(record);
                        return acc;
                    }, { dd: [], heal: [] });

                    if (assistant.dd.length) {
                        embed.fields.push({
                            name: 'Damage' + (assistant.dd.length > 1 ? ` + ${assistant.dd.length - 1}` : ''),
                            value: assistant.dd.join('\n'),
                            inline: true,
                        });
                    }
                    if (assistant.heal.length) {
                        embed.fields.push({
                            name: 'Heal',
                            value: assistant.heal.join('\n'),
                            inline: true,
                        });
                    }
                }

                const channel = this.bot.channels.cache.get(channelId || DISCORD_CHANNEL_ID);
                if (!channel) {
                    this.log(`Channel not found: ${channelId || DISCORD_CHANNEL_ID}`);
                    return;
                }

                const attachment = new AttachmentBuilder(imgBufferVictim, { name: 'kill.png' });
                return channel.send({ embeds: [embed], files: [attachment] });
            })
            .then(() => {
                this.log(`Kill posted: ${this.createDisplayName(event.Killer)} → ${this.createDisplayName(event.Victim)}`);
            })
            .catch(err => this.log('sendKillReport error:', err));
    }

    createDisplayName(player) {
        const allianceTag = player.AllianceName ? `[${player.AllianceName}]` : '';
        return `**<${allianceTag}${player.GuildName || 'Unguilded'}>** ${player.Name}`;
    }

    async checkBattles() {
        this.log('Checking battles...');
        try {
            const battles = await this.albionApi.getBattles({ limit: 20, offset: 0 });
            battles
                .filter(battleData => battleData.id > this.lastBattleId)
                .map(battleData => new Battle(battleData))
                .filter(battle => battle.players.length >= BATTLE_MIN_PLAYER)
                .filter(battle => {
                    const relevantPlayerCount = TRACK_GUILDS.reduce((total, guildName) => {
                        return total + (battle.guilds.has(guildName)
                            ? battle.guilds.get(guildName).players.length
                            : 0);
                    }, 0);
                    return relevantPlayerCount >= BATTLE_MIN_RELEVANT_PLAYER;
                })
                .forEach(battle => this.sendBattleReport(battle));
        } catch (error) {
            this.log('checkBattles error:', error);
        }
    }

    sendBattleReport(battle, channelId) {
        if (battle.id > this.lastBattleId) {
            this.lastBattleId = battle.id;
            this.jsonDb.recents.battleId = this.lastBattleId;
            saveJsonDb(this.jsonDb);
        }

        const title = battle.rankedFactions.slice()
            .sort((a, b) => b.players.length - a.players.length)
            .map(({ name, players }) => `${name}(${players.length})`)
            .join(' vs ');

        const thumbnailUrl = battle.players.length >= 100
            ? 'https://storage.googleapis.com/albion-images/static/PvP-100.png'
            : battle.players.length >= 40
                ? 'https://storage.googleapis.com/albion-images/static/PvP-40.png'
                : battle.is5v5
                    ? 'https://storage.googleapis.com/albion-images/static/5v5-3.png'
                    : 'https://storage.googleapis.com/albion-images/static/PvP-10.png';

        let fields = battle.rankedFactions.map(({ name, kills, deaths, killFame, factionType }, i) => ({
            name: `${i + 1}. ${name} - ${killFame.toLocaleString()} Fame`,
            inline: true,
            value: [
                `Kills: ${kills}`,
                `Deaths: ${deaths}`,
                factionType === 'alliance' ? '\n__**Guilds**__' : '',
                Array.from(battle.guilds.values())
                    .filter(({ alliance }) => alliance === name)
                    .sort((a, b) => battle.guilds.get(b.name).players.length - battle.guilds.get(a.name).players.length)
                    .map(({ name }) => `${name} (${battle.guilds.get(name).players.length})`)
                    .join('\n'),
            ].join('\n'),
        }));

        if (battle.is5v5) {
            fields = battle.rankedFactions.map(({ name, kills, players }) => ({
                name: `${name} [Kills: ${kills}]`,
                inline: true,
                value: players
                    .sort((a, b) => a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1)
                    .sort((a, b) => b.kills - a.kills)
                    .map(({ name, kills, deaths }) => `${deaths ? '~~' : ''}${name}${deaths ? '~~' : ''}: ${kills} Kills`)
                    .join('\n'),
            }));
        }

        const didWin = battle.rankedFactions[0].name === 'OLD';

        const embed = {
            url: `https://albiononline.com/en/killboard/battles/${battle.id}`,
            description: battle.is5v5
                ? `Winner's Fame: ${battle.rankedFactions[0].killFame.toLocaleString()}`
                : `Players: ${battle.players.length}, Kills: ${battle.totalKills}, Fame: ${battle.totalFame.toLocaleString()}`,
            title: battle.is5v5
                ? (didWin
                    ? `We wrecked ${battle.rankedFactions[1].name} in a 5v5!`
                    : `We lost to ${battle.rankedFactions[0].name} in a 5v5!`)
                : title,
            color: didWin ? 0x00FF00 : 0xFF0000,
            timestamp: battle.endTime,
            thumbnail: { url: thumbnailUrl },
            image: { url: 'https://storage.googleapis.com/albion-images/static/spacer.png' },
            fields,
        };

        const channel = this.bot.channels.cache.get(channelId || DISCORD_CHANNEL_ID);
        if (!channel) {
            this.log(`Channel not found: ${channelId || DISCORD_CHANNEL_ID}`);
            return;
        }

        channel.send({ embeds: [embed] })
            .then(() => this.log(`Battle posted: ${title}`))
            .catch(err => this.log('sendBattleReport error:', err));
    }

    async initDatabase() {
        await this.dbRun(
            'CREATE TABLE IF NOT EXISTS batleIds (battleId INTEGER)'
        );
        await this.dbRun(
            'CREATE TABLE IF NOT EXISTS eventIds (eventId INTEGER UNIQUE)'
        );
    }

    /**
     * Returns event IDs already stored in the given range.
     */
    async getInRange(minId, maxId) {
        const [sql, params] = maxId
            ? ['SELECT eventId FROM eventIds WHERE eventId >= ? AND eventId <= ?', [minId, maxId]]
            : ['SELECT eventId FROM eventIds WHERE eventId >= ?', [minId]];
        const rows = await this.dbAll(sql, params);
        return rows.map(r => r.eventId);
    }

    async saveRange(startPos, saveEventList, saveMaxId) {
        this.log(startPos, '; saveRange:', saveEventList.length, 'events, maxId:', saveMaxId);
        if (saveEventList.length) {
            const placeholders = saveEventList.map(() => '(?)').join(', ');
            await this.dbRun(
                `REPLACE INTO eventIds (eventId) VALUES ${placeholders}`,
                saveEventList
            );
        }
        if (saveMaxId > this.lastEventId) {
            this.lastEventId = saveMaxId;
            this.jsonDb.recents.eventId = saveMaxId;
            saveJsonDb(this.jsonDb);
        }
    }

    // --- SQLite helpers ---

    connect() {
        return new this.sqlite3.Database('./database/killbot.db', (err) => {
            if (err) throw new Error(`DB connect error: ${err.message}`);
        });
    }

    dbAll(sql, params = []) {
        return new Promise((resolve, reject) => {
            const db = this.connect();
            db.all(sql, params, (err, rows) => {
                db.close();
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    dbRun(sql, params = []) {
        return new Promise((resolve, reject) => {
            const db = this.connect();
            db.run(sql, params, function (err) {
                db.close();
                if (err) reject(err);
                else resolve(this);
            });
        });
    }

    log(...args) {
        console.log(new Date().toLocaleTimeString(), ...args);
    }
}
