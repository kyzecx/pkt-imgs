const fs = require('fs');
const path = require('path');
const { Jimp } = require('jimp');

const IMG_DIR = path.resolve(__dirname, '../img');
const BUNDLE_DIR = path.resolve(__dirname, '../bundle'); // Output directory
const NAME_DIR = path.resolve(__dirname, '../name');     // Name directory

// Grid settings from previous context
// 4x4 grid = 16 images per chunk
const GRID_COLS = 4;
const GRID_ROWS = 4;
const IMAGES_PER_CHUNK = GRID_COLS * GRID_ROWS;

// Helper to get directories
function getDirectories(srcPath) {
    if (!fs.existsSync(srcPath)) return [];
    return fs.readdirSync(srcPath).filter(file => {
        return fs.statSync(path.join(srcPath, file)).isDirectory();
    });
}

// Helper to get all png files recursively
function getFilesRecursively(dir, fileList = [], relativePath = '') {
    const files = fs.readdirSync(dir);
    files.forEach(file => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
            getFilesRecursively(filePath, fileList, path.join(relativePath, file));
        } else {
            if (file.toLowerCase().endsWith('.png')) {
                fileList.push({
                    fullPath: filePath,
                    relativePath: path.join(relativePath, file).replace(/\\/g, '/') // Ensure forward slashes
                });
            }
        }
    });
    return fileList;
}

async function processDirectory(dirName) {
    // Optimization: Skip if bundle already exists
    // Check for standard single-page name OR page 0 name
    const possibleBundle1 = path.join(BUNDLE_DIR, `${dirName}.png`);
    const possibleBundle2 = path.join(BUNDLE_DIR, `${dirName}_0.png`);

    if (fs.existsSync(possibleBundle1) || fs.existsSync(possibleBundle2)) {
        console.log(`Skipping ${dirName} (Bundle exists)...`);
        return;
    }

    console.log(`Processing ${dirName}...`);
    const inputDir = path.join(IMG_DIR, dirName);
    const allFiles = getFilesRecursively(inputDir);

    if (allFiles.length === 0) return;

    // chunk images
    const chunks = [];
    for (let i = 0; i < allFiles.length; i += IMAGES_PER_CHUNK) {
        chunks.push(allFiles.slice(i, i + IMAGES_PER_CHUNK));
    }

    const allFrameData = {};

    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];

        // 1. Calculate max dimensions for cells in this chunk
        let maxWidth = 0;
        let maxHeight = 0;

        // We need to load images to get dimensions
        const loadedImages = [];
        for (const file of chunk) {
            try {
                // Read file as buffer
                let buffer = fs.readFileSync(file.fullPath);

                // Sanitize: Trim garbage after IEND chunk (Run-length encoded: 49 45 4E 44)
                // This fixes "unrecognised content at end of stream" for renamed/corrupted PNGs
                const iendHex = '49454E44';
                let bufHex = buffer.toString('hex').toUpperCase();
                const iendIndex = bufHex.lastIndexOf(iendHex);

                if (iendIndex !== -1) {
                    // IEND chunk is 4 bytes "IEND" + 4 bytes CRC = 8 bytes total
                    // Hex representation has 2 chars per byte.
                    // So end of valid PNG is iendIndex (start of IEND) + 8 chars (IEND) + 8 chars (CRC) = + 16 chars
                    const hexEnd = iendIndex + 16;
                    if (hexEnd < bufHex.length) {
                        // console.log(`  Sanitizing ${file.relativePath}: trimming trailing bytes...`);
                        const byteEnd = hexEnd / 2;
                        buffer = buffer.subarray(0, byteEnd);
                    }
                }

                const image = await Jimp.read(buffer);
                maxWidth = Math.max(maxWidth, image.bitmap.width);
                maxHeight = Math.max(maxHeight, image.bitmap.height);
                loadedImages.push({
                    file: file,
                    image: image
                });
            } catch (err) {
                console.error(`ERROR reading file: ${file.fullPath}`);
                console.error(`  ${err.message}`);
                // Skip this file
            }
        }

        if (loadedImages.length === 0) continue;

        // 2. Create canvas
        const canvasWidth = maxWidth * GRID_COLS;
        const canvasHeight = maxHeight * GRID_ROWS;

        // Create new Jimp image (transparent background)
        // Jimp v1.x uses object signature for constructor
        const canvas = new Jimp({
            width: canvasWidth,
            height: canvasHeight,
            color: 0x00000000
        });

        // 3. Blit images
        loadedImages.forEach((item, index) => {
            const col = index % GRID_COLS;
            const row = Math.floor(index / GRID_COLS);
            const x = col * maxWidth;
            const y = row * maxHeight;

            // Use composite for safer transparency handling
            canvas.composite(item.image, x, y);

            // Store frame data (relative to category dir)
            // item.file.relativePath is like "boy/m_bear001.png"
            allFrameData[item.file.relativePath] = {
                frame: { x, y, w: maxWidth, h: maxHeight },
                page: i
            };
        });

        // 4. Save Atlas Image
        // If multiple chunks, append _{page}
        const atlasFilename = (chunks.length > 1) ? `${dirName}_${i}.png` : `${dirName}.png`;
        const atlasPath = path.join(BUNDLE_DIR, atlasFilename);

        // Jimp v1.x: .write() returns a promise, .writeAsync() is removed
        await canvas.write(atlasPath);
        console.log(`  Saved ${atlasFilename}`);
    }

    // --- Inject Metadata into name/**/*.json ---
    console.log(`  Injecting metadata into name JSONs...`);

    // Group by SubDir to efficiently load/save name.json
    // Map<SubDir, Array<Item>>
    const subDirItems = new Map();

    for (const [relPath, data] of Object.entries(allFrameData)) {
        // relPath: "boy/m_bear001.png"
        const parts = relPath.split('/');
        if (parts.length < 2) continue; // Skip if root file? (Assuming structure is category/subdir/file)

        const subDir = parts[0]; // "boy"
        const fileName = parts[1]; // "m_bear001.png"

        if (!subDirItems.has(subDir)) {
            subDirItems.set(subDir, []);
        }

        // Determine nice Atlas Name (no path)
        const atlasName = (chunks.length > 1) ? `${dirName}_${data.page}.png` : `${dirName}.png`;

        subDirItems.get(subDir).push({
            filename: fileName,
            atlas: atlasName,
            position: data.frame
        });
    }

    // Process each name.json
    for (const [subDir, items] of subDirItems) {
        // Path: name/CATEGORY/SUBDIR/name.json
        const nameJsonPath = path.join(NAME_DIR, dirName, subDir, 'name.json');

        if (fs.existsSync(nameJsonPath)) {
            try {
                const nameConfig = JSON.parse(fs.readFileSync(nameJsonPath, 'utf8'));
                let modified = false;

                for (const item of items) {
                    if (nameConfig[item.filename]) {
                        // Inject bundle object
                        nameConfig[item.filename].bundle = {
                            atlas: item.atlas,
                            position: item.position
                        };
                        modified = true;
                    }
                }

                if (modified) {
                    fs.writeFileSync(nameJsonPath, JSON.stringify(nameConfig, null, 2));
                    console.log(`    Updated ${dirName}/${subDir}/name.json`);
                }
            } catch (err) {
                console.error(`    Error updating ${nameJsonPath}: ${err.message}`);
            }
        } else {
            // console.warn(`    Warning: name.json not found at ${nameJsonPath}`);
        }
    }
}

async function main() {
    // Ensure bundle directory exists
    if (!fs.existsSync(BUNDLE_DIR)) {
        fs.mkdirSync(BUNDLE_DIR, { recursive: true });
    }

    const dirs = getDirectories(IMG_DIR);
    for (const dir of dirs) {
        await processDirectory(dir);
    }
}

main().catch(console.error);
