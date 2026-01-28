const fs = require('fs');
const path = require('path');
const { Jimp } = require('jimp');

// Configuration
const IMG_DIR = path.resolve(__dirname, '../img');
const DIST_DIR = path.resolve(__dirname, '../dist');
const ITEMS_PER_PAGE = 16;
const COLS = 4;
const ROWS = 4;

if (!fs.existsSync(DIST_DIR)) {
    fs.mkdirSync(DIST_DIR);
}

function getDirectories(srcPath) {
    return fs.readdirSync(srcPath).filter(file => {
        return fs.statSync(path.join(srcPath, file)).isDirectory();
    });
}

function getPngsRecursively(dir, rootDir, fileList = []) {
    const files = fs.readdirSync(dir);
    files.sort();
    files.forEach(file => {
        const filePath = path.join(dir, file);
        if (fs.statSync(filePath).isDirectory()) {
            getPngsRecursively(filePath, rootDir, fileList);
        } else if (file.endsWith('.png')) {
            fileList.push({
                fullPath: filePath,
                relativePath: path.relative(rootDir, filePath).replace(/\\/g, '/')
            });
        }
    });
    return fileList;
}

async function processDirectory(dirName) {
    console.log(`Processing ${dirName} (Grid Mode)...`);
    const dirPath = path.join(IMG_DIR, dirName);
    const files = getPngsRecursively(dirPath, dirPath);

    if (files.length === 0) {
        console.log('Skipped empty directory.');
        return;
    }

    const chunks = [];
    for (let i = 0; i < files.length; i += ITEMS_PER_PAGE) {
        chunks.push(files.slice(i, i + ITEMS_PER_PAGE));
    }

    const allFrameData = {};

    for (let pageIdx = 0; pageIdx < chunks.length; pageIdx++) {
        const chunk = chunks[pageIdx];
        console.log(`  > Chunk ${pageIdx}: ${chunk.length} images`);

        const loadedImages = [];
        let maxWidth = 0;
        let maxHeight = 0;

        for (const fileObj of chunk) {
            try {
                const img = await Jimp.read(fileObj.fullPath);
                maxWidth = Math.max(maxWidth, img.bitmap.width);
                maxHeight = Math.max(maxHeight, img.bitmap.height);
                loadedImages.push({ meta: fileObj, img: img });
            } catch (err) {
                console.error(`Error loading ${fileObj.relativePath}:`, err);
            }
        }

        if (loadedImages.length === 0) continue;

        // Force minimum size to avoid 0x0 issues
        maxWidth = Math.max(maxWidth, 1);
        maxHeight = Math.max(maxHeight, 1);

        const sheetWidth = maxWidth * COLS;
        const sheetHeight = maxHeight * ROWS;
        const canvas = new Jimp({ width: sheetWidth, height: sheetHeight, color: 0x00000000 });

        console.log(`    Canvas: ${sheetWidth}x${sheetHeight} (Cell: ${maxWidth}x${maxHeight})`);

        for (let i = 0; i < loadedImages.length; i++) {
            const item = loadedImages[i];
            const col = i % COLS;
            const row = Math.floor(i / COLS);

            const cellX = col * maxWidth;
            const cellY = row * maxHeight;

            console.log(`      Drawing [${i}] ${item.meta.relativePath} at ${cellX},${cellY}`);

            // Use composite for potentially better handling
            canvas.composite(item.img, cellX, cellY);

            allFrameData[item.meta.relativePath] = {
                frame: { x: cellX, y: cellY, w: item.img.bitmap.width, h: item.img.bitmap.height },
                rotated: false,
                trimmed: false,
                spriteSourceSize: { x: 0, y: 0, w: item.img.bitmap.width, h: item.img.bitmap.height },
                sourceSize: { w: item.img.bitmap.width, h: item.img.bitmap.height },
                page: pageIdx
            };
        }

        const pageFilename = (chunks.length > 1) ? `${dirName}_${pageIdx}.png` : `${dirName}.png`;
        const outPath = path.join(DIST_DIR, pageFilename);
        await canvas.write(outPath);
        console.log(`    Saved ${outPath}`);
    }

    const jsonPath = path.join(DIST_DIR, `${dirName}.json`);
    const meta = {
        app: "pkt-imgs-grid-packer",
        version: "1.0",
        image: (chunks.length > 1) ? `${dirName}_{page}.png` : `${dirName}.png`,
        format: "RGBA8888",
        size: { w: 0, h: 0 },
        scale: 1
    };
    fs.writeFileSync(jsonPath, JSON.stringify({ frames: allFrameData, meta }, null, 2));
}

async function main() {
    const dirs = getDirectories(IMG_DIR);
    for (const dir of dirs) {
        await processDirectory(dir);
    }
}

main().catch(console.error);
