const fs = require('fs');
const path = require('path');

const DIST_DIR = path.resolve(__dirname, '../dist');
const OUT_FILE = path.resolve(__dirname, '../dist/kv_bulk.json');

function generatePayload() {
    console.log('Scanning JSON files in dist/...');
    const files = fs.readdirSync(DIST_DIR).filter(f => f.endsWith('.json'));

    const kvPairs = [];

    files.forEach(file => {
        // Skip previously generated bulk file if it ends in json
        if (file === 'kv_bulk.json') return;

        const filePath = path.join(DIST_DIR, file);
        try {
            const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            const meta = content.meta;
            const frames = content.frames;

            if (!meta || !frames) {
                console.warn(`Skipping ${file}: Invalid format (missing meta or frames)`);
                return;
            }

            console.log(`Processing ${file} (${Object.keys(frames).length} frames)...`);

            for (const [frameName, frameData] of Object.entries(frames)) {
                // Determine atlas filename
                let atlasName = meta.image;
                const pageIdx = frameData.page || 0;

                if (atlasName.includes('{page}')) {
                    atlasName = atlasName.replace('{page}', pageIdx);
                } else {
                    // Start of fallback logic if meta.image doesn't use {page} specific syntax 
                    // but we know we have pages.
                    // pack_grid.js logic:
                    // if (chunks.length > 1) meta.image = `${dirName}_{page}.png`
                    // else meta.image = `${dirName}.png`
                    // So relying on meta.image replacement is correct.
                }

                // Construct Key-Value pair
                // Key: Original Path (e.g. "cset/boy/m_cset001.png")
                // Value: Atlas Filename (e.g. "cset_0.png")

                kvPairs.push({
                    key: frameName,
                    value: atlasName
                });
            }

        } catch (err) {
            console.error(`Error processing ${file}:`, err.message);
        }
    });

    console.log(`Total KV pairs generated: ${kvPairs.length}`);

    fs.writeFileSync(OUT_FILE, JSON.stringify(kvPairs, null, 2));
    console.log(`Saved payload to ${OUT_FILE}`);

    // --- Generate _redirects for EdgeOne/Netlify ---
    const REDIRECTS_FILE = path.join(DIST_DIR, '_redirects');
    console.log(`Generating ${REDIRECTS_FILE}...`);

    // Format: /source /destination 200
    // 200 means "Rewrite" (URL bar doesn't change, but serves content from dist)
    // If you want 302 Redirect, change 200 to 302

    let redirectsContent = kvPairs.map(item => {
        // Source: /cset/boy/m_cset001.png
        // Dest:   /dist/cset_0.png
        return `/${item.key} /dist/${item.value} 200`;
    }).join('\n');

    fs.writeFileSync(REDIRECTS_FILE, redirectsContent);
    console.log(`Saved _redirects (${kvPairs.length} rules)`);
}

generatePayload();
