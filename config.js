export const DISCORD_TOKEN = process.env.KILLBOT_TOKEN || ''
export const DISCORD_CHANNEL_ID = process.env.KILLBOT_CHANNEL_ID || ''
export const TRACK_GUILDS = process.env.TRACK_GUILDS ? process.env.TRACK_GUILDS.split(',') : []
export const BATTLE_MIN_PLAYER = 10
export const BATTLE_MIN_RELEVANT_PLAYER = 3
export const KILL_MIN_FAME = 0
