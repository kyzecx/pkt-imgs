const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
app.use(cors());
const PORT = 3000;

// Configuration
const DIST_DIR = path.join(__dirname, 'dist');
const MAP_FILE = path.join(DIST_DIR, 'kv_bulk.json');

// Memory Cache for Mapping
let spriteMap = {};

// 1. Load Mapping Data
function loadMapping() {
    if (!fs.existsSync(MAP_FILE)) {
        console.error(`Error: Mapping file not found at ${MAP_FILE}`);
        console.error('Please run "node scripts/generate_kv_payload.js" first.');
        process.exit(1);
    }

    try {
        console.log('Loading mapping data...');
        const raw = fs.readFileSync(MAP_FILE, 'utf8');
        const list = JSON.parse(raw);

        // Convert [{key, value}] -> {key: value}
        list.forEach(item => {
            spriteMap[item.key] = item.value;
        });

        console.log(`Mapping loaded: ${list.length} entries.`);
    } catch (e) {
        console.error("Failed to parse kv_bulk.json", e);
    }
}

loadMapping();

// 2. Serve Static Files (Optional, for direct access)
app.use('/dist', express.static(DIST_DIR));

// 3. Mapping Route
// Catch all GET requests
app.get('*', (req, res) => {
    // Remove leading slash and decode URI components
    const reqPath = decodeURIComponent(req.path.substring(1)); // e.g. "cset/boy/m_cset001.png"

    // Check specific mapping
    if (spriteMap[reqPath]) {
        const atlasFilename = spriteMap[reqPath];
        const atlasPath = path.join(DIST_DIR, atlasFilename);

        console.log(`[HIT] ${reqPath} => ${atlasFilename}`);

        // Check if atlas exists
        if (fs.existsSync(atlasPath)) {
            res.sendFile(atlasPath);
        } else {
            console.error(`[ERR] Atlas file missing: ${atlasPath}`);
            res.status(500).send('Internal Error: Atlas file missing');
        }
    } else {
        // Fallback: If it's not in the map, maybe it's a direct file request?
        // But for safety, we default to 404 here unless explicitly allowed.
        console.log(`[MISS] ${reqPath}`);
        res.status(404).send('File not found in sprite map');
    }
});

app.listen(PORT, () => {
    console.log(`\n--- Image Server Running ---`);
    console.log(`Listening at http://localhost:${PORT}`);
    console.log(`Try accessing: http://localhost:${PORT}/cset/boy/m_cset001.png`);
});
