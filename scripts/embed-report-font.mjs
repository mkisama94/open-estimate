import fs from 'node:fs/promises';
const bytes=await fs.readFile('profiles/report-font.ttf');
await fs.writeFile('src/document/report-font.ts','// Generated embedded Noto Sans JP subset; license: profiles/report-font-OFL.txt.\nexport const reportFont='+JSON.stringify(bytes.toString('base64'))+';\n');
