const API_URL = 'https://gameinfo.albiononline.com/api/gameinfo';

export default class AlbionApi {
    /**
     * Request a resource from the Albion Online API.
     */
    async baseRequest(baseUrl, path, queries) {
        const params = new URLSearchParams(queries);
        // Cache-bust param to prevent stale responses from CDN/proxies
        params.set('_', Date.now());
        const url = `${baseUrl}${path}?${params}`;

        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/84.0.4147.89 Safari/537.36',
                'Cache-Control': 'no-store',
            },
        });

        if (!response.ok) {
            throw new Error(`API request failed: ${response.status} ${response.statusText} — ${path}`);
        }

        const text = await response.text();
        try {
            return JSON.parse(text.replace(/\n/g, ' ').replace(/\r/g, '').trim());
        } catch {
            throw new Error(`JSON parse error — ${path}`);
        }
    }

    getEvents(options = {}) {
        return this.baseRequest(API_URL, '/events', {
            limit: options.limit || 51,
            offset: options.offset || 0,
            sort: options.sort || 'recent',
        });
    }

    getBattles(options = {}) {
        return this.baseRequest(API_URL, '/battles', {
            limit: options.limit || 51,
            offset: options.offset || 0,
            sort: options.sort || 'recent',
        });
    }
}
