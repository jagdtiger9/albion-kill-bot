import { FactionType } from './Faction.js';

export default class Guild {
    constructor(guildData, battleData) {
        this.factionType = FactionType.Guild;
        this.alliance = guildData.alliance;
        this.deaths = guildData.deaths;
        this.killFame = guildData.killFame;
        this.kills = guildData.kills;
        this.name = guildData.name;
        this.players = Object.values(battleData.players)
            .filter(player => player.guildName === guildData.name);
    }
}
