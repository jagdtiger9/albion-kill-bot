import { Jimp, loadFont, rgbaToInt, JimpMime } from 'jimp';
import { SANS_16_WHITE, SANS_8_WHITE } from '@jimp/plugin-print/fonts';
import { KILL_MIN_FAME } from '../config.js';

const DIV_SIZE = 2;
const FONT_SIZE = 32;
const ITEM_SIZE = 60;

const fontPromise = loadFont(SANS_16_WHITE);
const iconsPromise = Jimp.read('https://assets.albiononline.com/assets/images/killboard/fame-list__icons.png').then(image => {
    const skull = image.clone();
    skull.crop({ x: 990, y: 0, w: 100, h: 100 });
    image.crop({ x: 110, y: 0, w: 100, h: 100 });
    return { swords: image, skull };
});

function getItemUrl(item) {
    return item && [
        'https://render.albiononline.com/v1/item/',
        `${item.Type}.png`,
        `?count=${item.Count}`,
        `&quality=${item.Quality}`,
    ].join('');
}

function getItemImage(item, size) {
    return Jimp.read(getItemUrl(item)).then(image => {
        image.resize({ w: size, h: size });
        return [image, item.Count];
    });
}

function fillRectangle(image, hex, x1, y1, x2, y2) {
    for (let x = x1; x < x2; x++) {
        for (let y = y1; y < y2; y++) {
            image.setPixelColor(hex, x, y);
        }
    }
}

function createImage(target, event) {
    const NUM = 9;
    const inventory = event['Victim'].Inventory.filter(item => item !== null && item.Type.indexOf('TRASH') === -1);
    const equipment = [
        event['Killer'].Equipment.MainHand,
        event['Killer'].Equipment.OffHand,
        event['Killer'].Equipment.Armor,
        event['Killer'].Equipment.Shoes,
        event['Killer'].Equipment.Head,
        event['Killer'].Equipment.Cape,
        event['Killer'].Equipment.Mount,
        event['Killer'].Equipment.Potion,
        event['Killer'].Equipment.Food,
        event[target].Equipment.MainHand,
        event[target].Equipment.OffHand,
        event[target].Equipment.Armor,
        event[target].Equipment.Shoes,
        event[target].Equipment.Head,
        event[target].Equipment.Cape,
        event[target].Equipment.Mount,
        event[target].Equipment.Potion,
        event[target].Equipment.Food,
    ].concat(inventory);

    return Promise.all(equipment.map(item => item
        ? getItemImage(item, ITEM_SIZE)
        : Promise.resolve([new Jimp({ width: ITEM_SIZE, height: ITEM_SIZE }), 0])
    )).then(async images => {
        const inv = images.slice(NUM * 2);
        const height = inv.length ? Math.ceil(inv.length / NUM) : 0;

        const output = new Jimp({
            width: ITEM_SIZE * NUM,
            height: (ITEM_SIZE + FONT_SIZE) * 2 + (height ? ITEM_SIZE * height + DIV_SIZE : 0),
        });

        const font8 = await loadFont(SANS_8_WHITE);

        for (let i = 0; i < NUM; i++) {
            output.composite(images[i][0], ITEM_SIZE * i, FONT_SIZE);
            if (images[i][1]) {
                output.print({ font: font8, x: (i + 1) * ITEM_SIZE - 18, y: FONT_SIZE + ITEM_SIZE - 20, text: String(images[i][1]) });
            }
        }
        for (let i = NUM; i < 2 * NUM; i++) {
            output.composite(images[i][0], ITEM_SIZE * (i - NUM), FONT_SIZE * 2 + ITEM_SIZE);
            if (images[i][1]) {
                output.print({ font: font8, x: (i - NUM + 1) * ITEM_SIZE - 18, y: FONT_SIZE * 2 + ITEM_SIZE * 2 - 20, text: String(images[i][1]) });
            }
        }

        fillRectangle(output, rgbaToInt(0, 0, 0, 255), 0, 4, ITEM_SIZE * NUM, FONT_SIZE - 4);
        fillRectangle(output, rgbaToInt(0, 0, 0, 255), 0, 4 + FONT_SIZE + ITEM_SIZE, ITEM_SIZE * NUM, ITEM_SIZE + 2 * FONT_SIZE - 4);

        if (inv.length) {
            fillRectangle(output, rgbaToInt(0, 0, 0, 255), 0, 2 * FONT_SIZE + 2 * ITEM_SIZE, ITEM_SIZE * NUM, 2 * ITEM_SIZE + 2 * FONT_SIZE + DIV_SIZE);
            const Y_START = DIV_SIZE + FONT_SIZE * 2 + ITEM_SIZE * 2;
            for (let i = 0; i < inv.length; i++) {
                output.composite(images[NUM * 2 + i][0], ITEM_SIZE * (i % NUM), Y_START + Math.floor(i / NUM) * ITEM_SIZE);
                if (images[NUM * 2 + i][1]) {
                    output.print({ font: font8, x: (i % NUM + 1) * ITEM_SIZE - 18, y: Y_START + (Math.floor(i / NUM) + 1) * ITEM_SIZE - 20, text: String(images[NUM * 2 + i][1]) });
                }
            }
        }

        const font16 = await fontPromise;

        const itemPowerKiller = event.Killer.AverageItemPower;
        const gearScoreKiller = Math.round(itemPowerKiller).toLocaleString();
        const scoreDistanceKiller = itemPowerKiller > 999 ? 52 : itemPowerKiller > 99 ? 35 : itemPowerKiller > 9 ? 27 : 19;

        const itemPowerVictim = event.Victim.AverageItemPower;
        const gearScoreVictim = Math.round(itemPowerVictim).toLocaleString();
        const scoreDistanceVictim = itemPowerVictim > 999 ? 52 : itemPowerVictim > 99 ? 35 : itemPowerVictim > 9 ? 27 : 19;

        output.print({ font: font16, x: ITEM_SIZE * NUM - scoreDistanceKiller - FONT_SIZE, y: (FONT_SIZE - 18) / 2, text: gearScoreKiller });
        output.print({ font: font16, x: ITEM_SIZE * NUM - scoreDistanceVictim - FONT_SIZE, y: FONT_SIZE + ITEM_SIZE + (FONT_SIZE - 18) / 2, text: gearScoreVictim });

        let guildName = (event.Killer.AllianceName ? `[${event.Killer.AllianceName}]` : '') + event.Killer.GuildName;
        output.print({ font: font16, x: 4, y: (FONT_SIZE - 18) / 2, text: guildName || 'N/A' });
        guildName = (event.Victim.AllianceName ? `[${event.Victim.AllianceName}]` : '') + event.Victim.GuildName;
        output.print({ font: font16, x: 4, y: FONT_SIZE + ITEM_SIZE + (FONT_SIZE - 18) / 2, text: guildName || 'N/A' });

        if (event.TotalVictimKillFame < KILL_MIN_FAME) {
            output.crop({ x: 0, y: 0, w: ITEM_SIZE * NUM, h: FONT_SIZE });
        }

        const icons = await iconsPromise;
        const swords = icons.swords.clone();
        swords.resize({ w: 32, h: 32 });
        output.composite(swords, ITEM_SIZE * NUM - FONT_SIZE - 5, 0);
        const skull = icons.skull.clone();
        skull.resize({ w: 32, h: 32 });
        output.composite(skull, ITEM_SIZE * NUM - FONT_SIZE - 5, ITEM_SIZE + FONT_SIZE);

        return output.getBuffer(JimpMime.png);
    });
}

export { createImage, getItemImage, getItemUrl };
