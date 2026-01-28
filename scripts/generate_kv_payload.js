const fs = require('fs');
const path = require('path');

const DIST_DIR = path.resolve(__dirname, '../dist');
const OUT_FILE = path.resolve(__dirname, '../dist/kv_bulk.json');

function generatePayload() {
    console.log('Scanning JSON files in dist/...');
    const files = fs.readdirSync(DIST_DIR).filter(f => f.endsWith('.json'));

    const kvPairs = [];

    files.forEach(file => {
        if (file === 'kv_bulk.json') return;

        const filePath = path.join(DIST_DIR, file);
        // "clot.json" -> "clot"
        const category = path.basename(file, '.json');

        try {
            const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            const meta = content.meta;
            const frames = content.frames;

            if (!meta || !frames) {
                console.warn(`Skipping ${file}: Invalid format (missing meta or frames)`);
                return;
            }

            console.log(`Processing ${file} (Category: ${category})...`);

            for (const [frameName, frameData] of Object.entries(frames)) {
                // Determine atlas filename
                let atlasName = meta.image;
                const pageIdx = frameData.page || 0;

                if (atlasName.includes('{page}')) {
                    atlasName = atlasName.replace('{page}', pageIdx);
                }

                // Construct Key-Value pair
                // frameName is usually like "boy/m_clot001.png" or "boy.png" relative to category
                // We need the FULL URL path: "clot/boy/m_clot001.png"

                let fullKey = frameName;

                // If the frameName doesn't already start with the category (some might?), prepend it.
                // Safest check: does it start with the category string?
                // Actually, let's just assume we need to prepend unless it's strictly root.
                // But in this project structure, json is per folder.

                // Special case: 'base.json' might correspond to root? 
                // No, user said 'base' folder exists.
                // So everything should be prepended with category.

                if (!fullKey.startsWith(`${category}/`)) {
                    fullKey = `${category}/${fullKey}`;
                }

                kvPairs.push({
                    key: fullKey,
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

    let redirectsContent = kvPairs.map(item => {
        return `/${item.key} /dist/${item.value} 200`;
    }).join('\n');

    fs.writeFileSync(REDIRECTS_FILE, redirectsContent);
    console.log(`Saved _redirects (${kvPairs.length} rules)`);
}

generatePayload();
