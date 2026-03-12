const API_URL = 'https://gameinfo.albiononline.com/api/gameinfo';

export default class AlbionApi {
    rand(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    /**
     * Request a resource from the Albion Online API.
     * @param baseUrl
     * @param path
     * @param queries
     * @returns {Promise<unknown>}
     */
    async baseRequest(baseUrl, path, queries) {
        const qs = queries
            ? Object.entries(queries).map((query) => query.join('=')).join('&')
            : '';
        const url = `${baseUrl}${path}?${qs}&${this.rand(1, 1000)}`;

        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/84.0.4147.89 Safari/537.36',
                'Cache-Control': 'no-store',
            },
        });

        if (response.status === 404) {
            throw response;
        }

        const text = await response.text();
        const requestBody = text.replace(/\n/g, ' ').replace(/\r/g, '').trim();
        try {
            return JSON.parse(requestBody);
        } catch (error) {
            throw new Error(`JSON parse error - ${path}\n${requestBody}`);
        }
    }

    /**
     * Get an array of Kills.
     */
    getEvents(options = {}) {
        const queries = {
            limit: options.limit || 51,
            offset: options.offset || 0,
            sort: options.sort || 'recent',
        };
        return this.baseRequest(API_URL, `/events`, queries);
    }

    /**
     * Get an array of Battles.
     */
    getBattles(options = {}) {
        const queries = {
            limit: options.limit || 51,
            offset: options.offset || 0,
            sort: options.sort || 'recent',
        };
        return this.baseRequest(API_URL, `/battles`, queries);
    }
}
