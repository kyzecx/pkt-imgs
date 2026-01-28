const fs = require('fs');
const path = require('path');
const { Jimp } = require('jimp');

const TARGET_IMG = path.resolve(__dirname, '../dist/clot_0.png');
const ROWS = 4;
const COLS = 4;

async function checkGrid() {
    console.log(`Checking ${TARGET_IMG}...`);
    if (!fs.existsSync(TARGET_IMG)) {
        console.error('File not found!');
        return;
    }

    const img = await Jimp.read(TARGET_IMG);
    const w = img.bitmap.width;
    const h = img.bitmap.height;
    console.log(`Dimensions: ${w}x${h}`);

    const cellW = w / COLS;
    const cellH = h / ROWS;
    console.log(`Inferred Cell Size: ${cellW}x${cellH}`);

    // Check each cell for content
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const x = c * cellW;
            const y = r * cellH;

            // Scan center of cell (or just search for any pixel)
            let hasContent = false;
            // Scan a sampling of pixels in this cell
            img.scan(x, y, cellW, cellH, (sx, sy, idx) => {
                if (img.bitmap.data[idx + 3] > 0) {
                    hasContent = true;
                    // No way to break scan in Jimp easily without throwing
                }
            });

            console.log(`Cell [${r},${c}] at ${x},${y}: ${hasContent ? 'HAS CONTENT' : 'EMPTY'}`);
        }
    }
}

checkGrid().catch(console.error);
