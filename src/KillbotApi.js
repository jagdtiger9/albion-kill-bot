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
        writeFileSync(DB_JSON_PATH, JSON.stringify(defaults));
        return defaults;
    }
    return JSON.parse(readFileSync(DB_JSON_PATH, 'utf8'));
}

function saveJsonDb(data) {
    writeFileSync(DB_JSON_PATH, JSON.stringify(data));
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
    checkKills(startPos = 0, minRangeId = this.lastEventId, maxRangeId = 0) {
        this.albionApi.getEvents({ limit: 51, offset: startPos * 51 }).then(
            events => {
                if (!events) {
                    return;
                }

                events.sort((a, b) => a.EventId - b.EventId);
                let minEventId = events[0].EventId;
                let maxEventId = events[events.length - 1].EventId;
                let range = this.getInRange(minEventId, maxEventId);
                this.log(startPos, '; last: ', minRangeId, 'min: ', minEventId, 'max: ', maxEventId, 'range: ', range);

                // ID первого события в полученном списке больше последнего обработанного ИЛИ макс. кол-во подзапросов
                if (minEventId > minRangeId && (startPos || 0) < 5) {
                    this.checkKills(startPos + 1, minRangeId, minEventId);
                }

                events = events.filter(
                    event => event.EventId > minRangeId
                        && (!maxRangeId || event.EventId < maxRangeId)
                        && !range.includes(event.EventId)
                ).filter(event => {
                    const isFriendlyKill = TRACK_GUILDS.indexOf(event.Killer.GuildName) !== -1;
                    const isFriendlyDeath = TRACK_GUILDS.indexOf(event.Victim.GuildName) !== -1;

                    return (isFriendlyKill || isFriendlyDeath) && event.TotalVictimKillFame > 1000;
                });
                events.forEach(event => {
                    this.sendKillReport(event);
                });

                this.saveRange(startPos, events.map(event => event.EventId), maxEventId);
            },
            error => {
                this.log(error);
            }
        ).catch(error => {
            this.log(error);
        });
    }

    sendKillReport(event, channelId) {
        const isFriendlyKill = TRACK_GUILDS.indexOf(event.Killer.GuildName) !== -1;

        createImage('Victim', event)
            .then(imgBufferVictim => {
                const participants = parseInt(event.numberOfParticipants || event.GroupMembers.length, 10);
                const assists = participants - 1;

                const embed = {
                    url: `https://albiononline.com/en/killboard/kill/${event.EventId}`,
                    title: '',
                    description: '',
                    color: isFriendlyKill ? 65280 : 16711680,
                    image: { url: 'attachment://kill.png' },
                };

                if (event.TotalVictimKillFame > KILL_MIN_FAME) {
                    Object.assign(embed, {
                        title: `${event.Killer.Name} just killed ${event.Victim.Name}!`,
                        description: `Fame: **${event.TotalVictimKillFame.toLocaleString()}** ${assists ? '' : ' Solo kill'}`,
                        fields: [],
                        timestamp: event.TimeStamp,
                    });

                    let assistant = event.Participants.reduce(
                        function (accumulator, item) {
                            let record = item.DamageDone ? item.DamageDone : item.SupportHealingDone;
                            record = Math.round(record).toLocaleString() + ` - [${item.Name}](${INFO_URL}/players/${item.Id})`;

                            if (item.DamageDone) {
                                accumulator.dd.push(record);
                            }
                            if (item.SupportHealingDone) {
                                accumulator.heal.push(record);
                            }

                            return accumulator;
                        },
                        { 'dd': [], 'heal': [] }
                    );

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

                const attachment = new AttachmentBuilder(imgBufferVictim, { name: 'kill.png' });

                return this.bot.channels.cache.get(channelId || DISCORD_CHANNEL_ID)
                    .send({ embeds: [embed], files: [attachment] });
            })
            .then(() => {
                this.log(`Successfully posted log of ${this.createDisplayName(event.Killer)} killing ${this.createDisplayName(event.Victim)}.`);
            })
            .catch(statusError => {
                this.log(statusError);
            });
    }

    createDisplayName(player) {
        const allianceTag = player.AllianceName ? `[${player.AllianceName}]` : '';
        return `**<${allianceTag}${player.GuildName || 'Unguilded'}>** ${player.Name}`;
    }

    checkBattles() {
        this.log('Checking battles...');
        this.albionApi.getBattles({ limit: 20, offset: 0 }).then(battles => {
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
                }).forEach(battle => this.sendBattleReport(battle));
        }).catch(error => {
            this.log(error);
        });
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

        const thumbnailUrl = battle.players.length >= 100 ? 'https://storage.googleapis.com/albion-images/static/PvP-100.png'
            : battle.players.length >= 40 ? 'https://storage.googleapis.com/albion-images/static/PvP-40.png'
                : battle.is5v5 ? 'https://storage.googleapis.com/albion-images/static/5v5-3.png'
                    : 'https://storage.googleapis.com/albion-images/static/PvP-10.png';

        let fields = battle.rankedFactions.map(({ name, kills, deaths, killFame, factionType }, i) => {
            return {
                name: `${i + 1}. ${name} - ${killFame.toLocaleString()} Fame`,
                inline: true,
                value: [
                    `Kills: ${kills}`,
                    `Deaths: ${deaths}`,
                    factionType === 'alliance' ? '\n__**Guilds**__' : '',
                    Array.from(battle.guilds.values())
                        .filter(({ alliance }) => alliance === name)
                        .sort((a, b) => battle.guilds.get(b.name).players.length > battle.guilds.get(a.name).players.length)
                        .map(({ name }) => `${name} (${battle.guilds.get(name).players.length})`)
                        .join('\n'),
                ].join('\n'),
            };
        });

        if (battle.is5v5) {
            fields = battle.rankedFactions.map(({ name, kills, players }) => {
                return {
                    name: `${name} [Kills: ${kills}]`,
                    inline: true,
                    value: players
                        .sort((a, b) => a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1)
                        .sort((a, b) => b.kills > a.kills)
                        .map(({ name, kills, deaths }) => `${deaths ? '~~' : ''}${name}${deaths ? '~~' : ''}: ${kills} Kills`)
                        .join('\n'),
                };
            });
        }

        const didWin = battle.rankedFactions[0].name === 'OLD';

        const embed = {
            url: `https://albiononline.com/en/killboard/battles/${battle.id}`,
            description: battle.is5v5
                ? `Winner's Fame: ${battle.rankedFactions[0].killFame.toLocaleString()}`
                : `Players: ${battle.players.length}, Kills: ${battle.totalKills}, Fame: ${battle.totalFame.toLocaleString()}`,
            title: battle.is5v5
                ? (didWin ? `We wrecked ${battle.rankedFactions[1].name} in a 5v5!` : `We lost to ${battle.rankedFactions[0].name} in a 5v5!`)
                : title,
            color: didWin ? 65280 : 16711680,
            timestamp: battle.endTime,
            thumbnail: { url: thumbnailUrl },
            image: { url: 'https://storage.googleapis.com/albion-images/static/spacer.png' },
            fields,
        };

        this.bot.channels.cache.get(channelId || DISCORD_CHANNEL_ID)
            .send({ embeds: [embed] })
            .then(() => {
                this.log(`Successfully posted log of battle between ${title}.`);
            }).catch(err => {
                this.log(err);
            });
    }

    initDatabase() {
        let sqlTables = [
            'CREATE TABLE IF NOT EXISTS batleIds (\n' +
            '   battleId INTEGER\n' +
            ');',
            'CREATE TABLE IF NOT EXISTS eventIds (\n' +
            '   eventId INTEGER UNIQUE \n' +
            ');',
        ];

        let db = this.connect();
        sqlTables.map(sql => db.run(sql));
        this.disconnect(db);
    }

    getInRange(minId, maxId) {
        let db = this.connect();
        let range = [];
        let sql = '';
        let params = [];
        if (maxId) {
            sql = ' SELECT * FROM eventIds WHERE eventId>=? AND eventId <=? ';
            params = [minId, maxId];
        } else {
            sql = ' SELECT * FROM eventIds WHERE eventId>=? ';
            params = [minId];
        }
        db.all(sql, params, function (err, rows) {
            if (err) {
                console.error(err.message);
                throw new Error(err.message);
            }
            range = rows;
        });
        this.disconnect(db);

        return range;
    }

    saveRange(startPos, saveEventList, saveMaxId) {
        this.log(startPos, '; saveRange: ', saveEventList, saveMaxId);
        if (saveEventList.length) {
            let db = this.connect();
            let sql = ' REPLACE INTO eventIds (eventId) VALUES ';
            saveEventList.map(eventId => sql += `(${eventId}),`);
            sql = sql.substring(0, sql.length - 1);
            db.run(sql);
            this.disconnect(db);
        }
        // Последнее обработанное событие
        if (saveMaxId > this.lastEventId) {
            this.lastEventId = saveMaxId;
            this.jsonDb.recents.eventId = saveMaxId;
            saveJsonDb(this.jsonDb);
        }
    }

    connect() {
        return new this.sqlite3.Database('./database/killbot.db', (err) => {
            if (err) {
                console.error(err.message);
                throw new Error(err.message);
            }
        });
    }

    disconnect(db) {
        db.close((err) => {
            if (err) {
                return console.error(err.message);
            }
        });
    }

    log() {
        console.log(new Date().toLocaleTimeString(), ...Array.from(arguments));
    }
}
