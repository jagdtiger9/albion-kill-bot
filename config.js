const required = (name) => {
    const val = process.env[name];
    if (!val) throw new Error(`Missing required environment variable: ${name}`);
    return val;
};

export const DISCORD_TOKEN = required('KILLBOT_TOKEN');
export const DISCORD_CHANNEL_ID = required('KILLBOT_CHANNEL_ID');
export const TRACK_GUILDS = process.env.TRACK_GUILDS ? process.env.TRACK_GUILDS.split(',') : [];
export const BATTLE_MIN_PLAYER = 10;
export const BATTLE_MIN_RELEVANT_PLAYER = 3;
export const KILL_MIN_FAME = parseInt(process.env.KILL_MIN_FAME || '0', 10);
