import { FactionType } from './Faction.js';

export default class Alliance {
    constructor(allianceData, battleData) {
        this.factionType = FactionType.Alliance;
        this.deaths = allianceData.deaths;
        this.killFame = allianceData.killFame;
        this.kills = allianceData.kills;
        this.name = allianceData.name;
        this.players = Object.values(battleData.players)
            .filter(player => player.allianceName === allianceData.name);
    }
}
