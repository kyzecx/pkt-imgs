const fs = require('fs');
const path = require('path');
const https = require('https');
const jpexs = require('jpexs-flash-decompiler');

// Ignore SSL certificate errors (common for old asset servers)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// --- Configuration ---
const HELPER_DIR = path.resolve(__dirname, '../pkt-helper');
const PROP_CONFIG_PATH = path.join(HELPER_DIR, 'pkt-config-updater/as/propConfig.as');
const COSTUME_CONFIG_PATH = path.join(HELPER_DIR, 'pkt-config-updater/as/costumeConfig.as');
const NEED_JSON_PATH = path.join(__dirname, 'need.json');
const IMGS_DIR = path.join(__dirname, 'img');
const NAMES_DIR = path.join(__dirname, 'name');
const TEMP_DIR = path.join(__dirname, 'temp');

const BASE_URL = 'https://cct.picatown.com/fpktgame20120715/res/actorCostume/';

// --- Helpers ---
function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function padSerial(n) {
    return String(n).padStart(3, '0');
}

function sexToPrefix(sex) {
    if (sex === 1) return 'm';
    if (sex === 2) return 'f';
    return 'u';
}

function sexToDir(sex) {
    if (sex === 1) return 'boy';
    if (sex === 2) return 'girl';
    return 'all';
}

// Extract a single array slice using depth counting
function extractArraySlice(text, startPos) {
    const start = text.indexOf('[', startPos);
    if (start < 0) return null;
    let depth = 0, end = -1;
    let inStr = false, esc = false;
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inStr) {
            if (esc) { esc = false; }
            else if (ch === '\\') { esc = true; }
            else if (ch === '"') { inStr = false; }
        } else {
            if (ch === '"') { inStr = true; }
            else if (ch === '[') { depth++; }
            else if (ch === ']') {
                depth--;
                if (depth === 0) { end = i + 1; break; }
            }
        }
    }
    if (end < 0) return null;
    return text.slice(start, end);
}

// Find all arrays in the file (propConfig often has multiple)
function extractAllArrays(text) {
    const slices = [];
    const re = /public\s+const\s+ary\d*\s*:\s*Array/g;
    let match;
    while ((match = re.exec(text)) !== null) {
        const slice = extractArraySlice(text, match.index);
        if (slice) slices.push(slice);
    }
    return slices;
}

function parseASArray(asPath) {
    const text = fs.readFileSync(asPath, 'utf8');
    const slices = extractAllArrays(text);
    if (slices.length === 0) throw new Error(`Could not find any arrays in ${asPath}`);

    // Combine arrays if multiple found
    let combined = [];
    for (const slice of slices) {
        try {
            const arr = JSON.parse(slice);
            combined = combined.concat(arr);
        } catch (e) {
            console.error(`Error parsing slice starting at ${text.indexOf(slice)}: ${e.message}`);
        }
    }
    return combined;
}

function parsePropConfig(asPath) {
    const text = fs.readFileSync(asPath, 'utf8');
    const slices = extractAllArrays(text);
    const map = {};
    const objRegex = /\{[\s\S]*?\}/g;
    const kvRegex = /"(type|name)"\s*:\s*("[^"]*"|[-]?\d+)/g;

    for (const slice of slices) {
        let m;
        while ((m = objRegex.exec(slice))) {
            const objStr = m[0];
            let type = null, name = null;
            let kv;
            while ((kv = kvRegex.exec(objStr))) {
                const key = kv[1];
                const raw = kv[2];
                const val = /^"/.test(raw) ? raw.slice(1, -1) : Number(raw);
                if (key === 'type') type = Number(val);
                else if (key === 'name') name = String(val);
            }
            if (type != null && name) {
                map[name] = type;
            }
        }
    }
    return map;
}

async function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download ${url}: ${response.statusCode}`));
                return;
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve();
            });
        }).on('error', (err) => {
            fs.unlink(dest, () => { });
            reject(err);
        });
    });
}

function exportImages(swfPath, outDir) {
    return new Promise((resolve, reject) => {
        jpexs.export({
            file: swfPath,
            output: outDir,
            items: [jpexs.ITEM.IMAGE],
            formats: [jpexs.FORMAT.IMAGE.PNG],
            silence: true
        }, function (err) {
            if (err) reject(err);
            else resolve();
        });
    });
}

// --- Main Execution ---
async function main() {
    console.log('--- Start Fetching Assets (Lib Mode) ---');

    console.log('Loading configs...');
    const nameToType = parsePropConfig(PROP_CONFIG_PATH);
    const costumeAry = parseASArray(COSTUME_CONFIG_PATH);

    const typeToCostume = {};
    for (const item of costumeAry) {
        if (item.type) typeToCostume[item.type] = item;
    }
    console.log(`Loaded ${Object.keys(nameToType).length} names and ${costumeAry.length} costumes.`);

    if (!fs.existsSync(NEED_JSON_PATH)) {
        console.error('need.json not found!');
        return;
    }

    const needs = JSON.parse(fs.readFileSync(NEED_JSON_PATH, 'utf8'));
    console.log(`Need to fetch: ${needs.join(', ')}`);

    ensureDir(TEMP_DIR);

    for (const name of needs) {
        console.log(`\nProcessing: ${name}`);
        const type = nameToType[name];
        if (!type) {
            console.warn(`  [SKIP] Name "${name}" not found in propConfig.as`);
            continue;
        }

        const info = typeToCostume[type];
        if (!info) {
            console.warn(`  [SKIP] Type "${type}" not found in costumeConfig.as`);
            continue;
        }

        const { sex, part, serial } = info;
        const prefix = sexToPrefix(sex);
        const sDir = sexToDir(sex);
        const filename = `${prefix}_${part}${padSerial(serial)}`;
        const swfUrl = `${BASE_URL}${sDir}/${filename}.swf`;
        const localSwf = path.join(TEMP_DIR, `${filename}.swf`);

        console.log(`  Downloading ${swfUrl} ...`);
        try {
            await downloadFile(swfUrl, localSwf);
        } catch (err) {
            console.error(`  [FAIL] Download failed: ${err.message}`);
            continue;
        }

        console.log(`  Converting SWF to PNG via library...`);
        const outDir = path.join(TEMP_DIR, filename);
        ensureDir(outDir);

        try {
            await exportImages(localSwf, outDir);

            const files = fs.readdirSync(outDir).filter(f => f.endsWith('.png'));
            if (files.length === 0) {
                console.error(`  [FAIL] No PNG exported from ${filename}.swf`);
                continue;
            }

            let largestFile = files[0];
            let maxSize = 0;
            for (const f of files) {
                const stats = fs.statSync(path.join(outDir, f));
                if (stats.size > maxSize) {
                    maxSize = stats.size;
                    largestFile = f;
                }
            }

            const targetImgDir = path.join(IMGS_DIR, part, sDir);
            ensureDir(targetImgDir);
            const targetPngPath = path.join(targetImgDir, `${filename}.png`);

            fs.copyFileSync(path.join(outDir, largestFile), targetPngPath);
            console.log(`  [OK] Saved to ${targetPngPath}`);

            const nameJsonDir = path.join(NAMES_DIR, part, sDir);
            ensureDir(nameJsonDir);
            const nameJsonPath = path.join(nameJsonDir, 'name.json');

            let nameData = {};
            if (fs.existsSync(nameJsonPath)) {
                nameData = JSON.parse(fs.readFileSync(nameJsonPath, 'utf8'));
            }

            const key = `${filename}.png`;
            // 获取当前条目（兼容新旧格式）
            const currentEntry = nameData[key];
            const currentHideBaseLayer = typeof currentEntry === 'object' ? (currentEntry.hideBaseLayer ?? false) : false;

            // 使用新格式
            const entry = {
                name: name,
                hideBaseLayer: currentHideBaseLayer
            };
            // glas 和 hats 添加 animate 键
            if (part === 'glas' || part === 'hats') {
                entry.animate = currentEntry?.animate ?? {
                    isAnimated: false,
                    animateFrame: 0
                };
            }
            nameData[key] = entry;

            // Sort keys in descending order (numerical)
            const sortedKeys = Object.keys(nameData).sort((a, b) => {
                const getNum = (str) => {
                    const match = str.match(/(\d+)/);
                    return match ? parseInt(match[0], 10) : 0;
                };
                return getNum(b) - getNum(a);
            });
            const sortedData = {};
            for (const key of sortedKeys) {
                sortedData[key] = nameData[key];
            }

            fs.writeFileSync(nameJsonPath, JSON.stringify(sortedData, null, 2) + '\n', 'utf8');
            console.log(`  [OK] Updated ${nameJsonPath}`);

        } catch (err) {
            console.error(`  [FAIL] Conversion failed: ${err.message}`);
        }
    }

    console.log('\n--- Done ---');
    console.log('Note: Temp files are kept in ./temp/ for inspection.');
}

main().catch(err => {
    console.error('Fatal error:', err);
});
