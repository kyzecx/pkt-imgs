const fs = require('fs');
const path = require('path');

const DIST_DIR = path.resolve(__dirname, '../dist');
// Output JSON to dist (for data persistence)
const JSON_OUT_FILE = path.resolve(__dirname, '../dist/kv_bulk.json');
// Output _redirects to ROOT (for Vercel/EdgeOne/Netlify auto-detection)
const REDIRECTS_OUT_FILE = path.resolve(__dirname, '../_redirects');

function generatePayload() {
    console.log('Scanning JSON files in dist/...');
    const files = fs.readdirSync(DIST_DIR).filter(f => f.endsWith('.json'));

    // Check if dist exists
    if (!fs.existsSync(DIST_DIR)) {
        console.error("Dist directory missing!");
        return;
    }

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
                console.warn(`Skipping ${file}: Invalid format`);
                return;
            }

            console.log(`Processing ${file} (Category: ${category})...`);

            for (const [frameName, frameData] of Object.entries(frames)) {
                let atlasName = meta.image;
                const pageIdx = frameData.page || 0;

                if (atlasName.includes('{page}')) {
                    atlasName = atlasName.replace('{page}', pageIdx);
                }

                // Construct Key: "clot/boy/m_clot001.png"
                let keyPath = frameName;
                if (!keyPath.startsWith(`${category}/`)) {
                    keyPath = `${category}/${keyPath}`;
                }

                // Add to list
                kvPairs.push({
                    key: keyPath,
                    value: atlasName
                });
            }

        } catch (err) {
            console.error(`Error processing ${file}:`, err.message);
        }
    });

    console.log(`\nTotal entries found: ${kvPairs.length}`);

    // 1. Save JSON Payload (Backing data)
    fs.writeFileSync(JSON_OUT_FILE, JSON.stringify(kvPairs, null, 2));
    console.log(`Saved kv_bulk.json to ${JSON_OUT_FILE}`);

    // 2. Generate _redirects (The Static Solution)
    console.log(`Generating _redirects to ROOT: ${REDIRECTS_OUT_FILE}...`);

    // Rule Format: /img/<path> /dist/<atlas> 200
    // Example: /img/cset/girl/001.png -> /dist/cset_0.png

    let redirectsContent = kvPairs.map(item => {
        return `/img/${item.key} /dist/${item.value} 200`;
    }).join('\n');

    fs.writeFileSync(REDIRECTS_OUT_FILE, redirectsContent);
    console.log(`Success! Saved _redirects to root.`);
}

generatePayload();
