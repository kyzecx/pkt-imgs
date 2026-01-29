const fs = require('fs');
const path = require('path');
const { Jimp } = require('jimp');

const IMG_DIR = path.resolve(__dirname, '../img');
const BUNDLE_DIR = path.resolve(__dirname, '../bundle'); // Output directory
const NAME_DIR = path.resolve(__dirname, '../name');     // Name directory

// Grid settings
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
    if (!fs.existsSync(dir)) return [];
    const files = fs.readdirSync(dir);
    files.forEach(file => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
            getFilesRecursively(filePath, fileList, path.join(relativePath, file));
        } else {
            if (file.toLowerCase().endsWith('.png') && !file.toLowerCase().endsWith('_animate.png')) {
                // Note: Explicitly excluding _Animate.png from packing if they are source files? 
                // Actually the packer packs whatever is in the folder. 
                // Assuming source structure is cleaned. 
                // Standard logic: just pack .pngs.
                fileList.push({
                    fullPath: filePath,
                    relativePath: path.join(relativePath, file).replace(/\\/g, '/') // Ensure forward slashes
                });
            }
        }
    });
    return fileList;
}

// Helper to parse bundle filename to index
function getBundleIndex(filename, dirName) {
    if (filename === `${dirName}.png`) return 0;
    const regex = new RegExp(`^${dirName}_(\\d+)\\.png$`);
    const match = filename.match(regex);
    return match ? parseInt(match[1]) : -1;
}

// Scan existing name.json files to find what is already packed
function getExistingState(dirName) {
    const packedFiles = new Set(); // Set<relativePath>
    const itemsByAtlas = new Map(); // Map<atlasName, List<relativePath>>

    const catNameDir = path.join(NAME_DIR, dirName);
    if (fs.existsSync(catNameDir)) {
        const subDirs = fs.readdirSync(catNameDir).filter(d => fs.statSync(path.join(catNameDir, d)).isDirectory());
        for (const sub of subDirs) {
            const jsonPath = path.join(catNameDir, sub, 'name.json');
            if (fs.existsSync(jsonPath)) {
                try {
                    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
                    for (const [filename, val] of Object.entries(data)) {
                        if (val.bundle && val.bundle.atlas) {
                            const relPath = `${sub}/${filename}`;
                            packedFiles.add(relPath);

                            const atlas = val.bundle.atlas;
                            if (!itemsByAtlas.has(atlas)) {
                                itemsByAtlas.set(atlas, []);
                            }
                            itemsByAtlas.get(atlas).push(relPath);
                        }
                    }
                } catch (e) {
                    console.error(`Warning: Failed to parse ${jsonPath}`);
                }
            }
        }
    }
    return { packedFiles, itemsByAtlas };
}

async function processDirectory(dirName) {
    console.log(`Analyzing ${dirName}...`);

    // 1. Get current state
    const { packedFiles, itemsByAtlas } = getExistingState(dirName);

    // 2. Identify new files
    const inputDir = path.join(IMG_DIR, dirName);
    const allFiles = getFilesRecursively(inputDir);
    // Sort for determinism
    allFiles.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

    // Filter existing
    // Note: packedFiles uses relativePath
    const newFiles = allFiles.filter(f => !packedFiles.has(f.relativePath));

    if (newFiles.length === 0) {
        console.log(`  Skipping ${dirName} (Up to date, ${packedFiles.size} keys packed)...`);
        return;
    }

    console.log(`  Processing ${dirName}: ${newFiles.length} new items found.`);

    // 3. Determine Starting Point (Last Page)
    let maxPageIdx = -1;
    let lastBundleName = null;

    // Check physical bundle files to match against our JSON knowledge
    // to ensure we don't accidentally append to a deleted bundle
    const physicalBundles = fs.readdirSync(BUNDLE_DIR).filter(f => f.startsWith(dirName) && f.endsWith('.png'));

    for (const b of physicalBundles) {
        const idx = getBundleIndex(b, dirName);
        if (idx > maxPageIdx) {
            maxPageIdx = idx;
            lastBundleName = b;
        }
    }

    // Default if no bundles exist
    if (maxPageIdx === -1) {
        maxPageIdx = 0;
        lastBundleName = `${dirName}.png`;
    }

    // 4. Prepare Pending Files List
    // We want to repack the LAST page just in case it's not full, 
    // AND to allow the grid size to adjust if new images are larger.

    let pendingFiles = [];
    let startPageIdx = maxPageIdx;

    // If the last bundle exists and has items known in name.json
    if (lastBundleName && itemsByAtlas.has(lastBundleName)) {
        const existingRelPaths = itemsByAtlas.get(lastBundleName);

        // Skip repack if that page is already full? 
        // If existingRelPaths.length >= 16, we simply start at next page.
        // This is an optimization.
        if (existingRelPaths.length >= IMAGES_PER_CHUNK) {
            console.log(`  Last bundle ${lastBundleName} is full (${existingRelPaths.length} items). Starting new page.`);
            startPageIdx = maxPageIdx + 1;
            // No existing items to add to pending, just new files
            pendingFiles = newFiles.map(f => ({ file: f, isNew: true }));
        } else {
            console.log(`  Appending to ${lastBundleName} (${existingRelPaths.length} existing items)...`);
            // We need to re-pack this page. 
            // Find the file objects for these existing paths
            // We can look them up in 'allFiles' (since we scanned the folder)
            const mapRelPathToFile = new Map(allFiles.map(f => [f.relativePath, f]));

            for (const rel of existingRelPaths) {
                const f = mapRelPathToFile.get(rel);
                if (f) {
                    pendingFiles.push({ file: f, isNew: false });
                } else {
                    console.warn(`  Warning: Existing item ${rel} not found on disk! Skipping from repack.`);
                }
            }

            // Add new files
            for (const f of newFiles) {
                pendingFiles.push({ file: f, isNew: true });
            }
        }
    } else {
        // No valid existing bundle (or it was empty/deleted/not in json), treat as fresh start for this page index
        pendingFiles = newFiles.map(f => ({ file: f, isNew: true }));
    }

    // 5. Pack Loop
    // Chunk pendingFiles
    const chunks = [];
    for (let i = 0; i < pendingFiles.length; i += IMAGES_PER_CHUNK) {
        chunks.push(pendingFiles.slice(i, i + IMAGES_PER_CHUNK));
    }

    const updates = {}; // Metadata updates

    for (let c = 0; c < chunks.length; c++) {
        const chunk = chunks[c];
        const pageIdx = startPageIdx + c;

        // 1. Calculate max dimensions
        let maxWidth = 0;
        let maxHeight = 0;
        const loadedImages = [];

        for (const item of chunk) {
            try {
                let buffer = fs.readFileSync(item.file.fullPath);

                // Sanitize IEND (Copy from original script logic)
                const iendHex = '49454E44';
                let bufHex = buffer.toString('hex').toUpperCase();
                const iendIndex = bufHex.lastIndexOf(iendHex);
                if (iendIndex !== -1) {
                    const hexEnd = iendIndex + 16;
                    if (hexEnd < bufHex.length) {
                        const byteEnd = hexEnd / 2;
                        buffer = buffer.subarray(0, byteEnd);
                    }
                }

                const image = await Jimp.read(buffer);
                maxWidth = Math.max(maxWidth, image.bitmap.width);
                maxHeight = Math.max(maxHeight, image.bitmap.height);
                loadedImages.push({ item, image });
            } catch (err) {
                console.error(`Error reading ${item.file.relativePath}: ${err.message}`);
            }
        }

        if (loadedImages.length === 0) continue;

        // 2. Create Canvas
        const canvasWidth = maxWidth * GRID_COLS;
        const canvasHeight = maxHeight * GRID_ROWS;
        const canvas = new Jimp({ width: canvasWidth, height: canvasHeight, color: 0x00000000 });

        // 3. Composite
        loadedImages.forEach((obj, index) => {
            const col = index % GRID_COLS;
            const row = Math.floor(index / GRID_COLS);
            const x = col * maxWidth;
            const y = row * maxHeight;

            canvas.composite(obj.image, x, y);

            // Record metadata
            updates[obj.item.file.relativePath] = {
                frame: { x, y, w: maxWidth, h: maxHeight }, // Sprite size (actually cell size, user logic used maxWidth)
                page: pageIdx
            };
        });

        // 4. Save
        // Naming logic:
        // Page 0: Prefer dirName.png IF dirName_0.png does not exist.
        // But if we are overwriting, we should stick to what it WAS.
        // We know 'lastBundleName' was the target for 'startPageIdx'.
        // Why not reuse lastBundleName if pageIdx == startPageIdx?
        // Ah, lastBundleName might be null if new.

        let atlasName = `${dirName}_${pageIdx}.png`;

        if (pageIdx === 0) {
            const legacyName = `${dirName}.png`;
            const batchName = `${dirName}_0.png`;

            // If we are replacing the bundle we identified as lastBundleName, use that name
            if (pageIdx === startPageIdx && lastBundleName) {
                atlasName = lastBundleName;
            }
            // Else check existence
            else if (fs.existsSync(path.join(BUNDLE_DIR, batchName))) {
                atlasName = batchName;
            } else {
                atlasName = legacyName;
            }
        }

        const atlasPath = path.join(BUNDLE_DIR, atlasName);
        await canvas.write(atlasPath);
        console.log(`  Saved ${atlasName} (Page ${pageIdx}, ${loadedImages.length} items)`);
    }

    // 5. Inject Metadata
    // Note: We need to update existing items too if their position changed (repack)!
    console.log(`  Updating metadata...`);

    // Group by SubDir
    const subDirUpdates = new Map();
    for (const [relPath, data] of Object.entries(updates)) {
        const parts = relPath.split('/');
        if (parts.length < 2) continue;
        const subDir = parts[0];
        const fileName = parts[1];

        if (!subDirUpdates.has(subDir)) subDirUpdates.set(subDir, []);

        // Determine Atlas Name again (must match what we saved)
        let atlasName = `${dirName}_${data.page}.png`;
        if (data.page === 0) {
            if (data.page === startPageIdx && lastBundleName) {
                atlasName = lastBundleName;
            } else if (fs.existsSync(path.join(BUNDLE_DIR, `${dirName}_0.png`))) {
                atlasName = `${dirName}_0.png`;
            } else {
                atlasName = `${dirName}.png`;
            }
        }

        subDirUpdates.get(subDir).push({
            filename: fileName,
            atlas: atlasName,
            position: data.frame
        });
    }

    // Write
    for (const [subDir, items] of subDirUpdates) {
        const nameJsonPath = path.join(NAME_DIR, dirName, subDir, 'name.json');
        if (fs.existsSync(nameJsonPath)) {
            try {
                const nameConfig = JSON.parse(fs.readFileSync(nameJsonPath, 'utf8'));
                let modified = false;

                for (const item of items) {
                    if (nameConfig[item.filename]) {
                        nameConfig[item.filename].bundle = {
                            atlas: item.atlas,
                            position: item.position
                        };
                        modified = true;
                    }
                }

                if (modified) {
                    fs.writeFileSync(nameJsonPath, JSON.stringify(nameConfig, null, 2));
                    // console.log(`    Updated ${subDir}/name.json`);
                }
            } catch (e) { console.error(e); }
        }
    }
}

async function main() {
    // Ensure bundle directory exists
    if (!fs.existsSync(BUNDLE_DIR)) {
        fs.mkdirSync(BUNDLE_DIR, { recursive: true });
    }

    let dirs = getDirectories(IMG_DIR);

    // If args provided, filter dirs
    const args = process.argv.slice(2);
    if (args.length > 0) {
        dirs = dirs.filter(d => args.includes(d));
    }

    for (const dir of dirs) {
        try {
            await processDirectory(dir);
        } catch (e) {
            console.error(`Failed to process ${dir}:`, e);
        }
    }
}

main().catch(console.error);
