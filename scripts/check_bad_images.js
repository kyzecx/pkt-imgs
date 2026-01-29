const fs = require('fs');
const path = require('path');
const { Jimp } = require('jimp');

const BAD_FILES = [
    'img/glas/all/u_glas248.png',
    'img/glas/boy/m_glas102.png'
];

async function check() {
    for (const relPath of BAD_FILES) {
        const fullPath = path.resolve(__dirname, '../', relPath);
        console.log(`\nChecking ${relPath}...`);

        if (!fs.existsSync(fullPath)) {
            console.log('  File not found!');
            continue;
        }

        // 1. Check Magic Bytes
        const buffer = fs.readFileSync(fullPath);
        const header = buffer.subarray(0, 8).toString('hex').toUpperCase();
        console.log(`  Header: ${header}`);

        const isPNG = header === '89504E470D0A1A0A';
        console.log(`  Is Valid PNG Signature? ${isPNG}`);

        // 2. Try Jimp.read with Buffer (Sanitized)
        try {
            console.log('  Attempting Jimp.read(buffer) with sanitization...');

            // Find IEND chunk (49 45 4E 44)
            // It's followed by 4 bytes of CRC.
            const iendHex = '49454E44';
            let bufHex = buffer.toString('hex').toUpperCase();
            const iendIndex = bufHex.lastIndexOf(iendHex);

            let cleanBuffer = buffer;

            if (iendIndex !== -1) {
                // iendIndex is hex string index. 
                // Hex is 2 chars per byte.
                // End of IEND type is iendIndex + 8 chars.
                // + 4 bytes CRC = + 8 chars.
                // Total end point in hex string = iendIndex + 8 + 8 = iendIndex + 16.

                const hexEnd = iendIndex + 16;
                if (hexEnd < bufHex.length) {
                    console.log(`  Found garbage data! trimming from hex pos ${hexEnd} to ${bufHex.length}`);
                    const byteEnd = hexEnd / 2;
                    cleanBuffer = buffer.subarray(0, byteEnd);
                }
            }

            const img = await Jimp.read(cleanBuffer);
            console.log(`  Success! Size: ${img.width}x${img.height}`);
        } catch (e) {
            console.log(`  Jimp Read Error: ${e.message}`);
        }
    }
}

check();
