import fs from 'fs';
import path from 'path';

// Define all replacements
const replacements = [
  // Spanish characters
  { from: /Ã³/g, to: 'ó' },
  { from: /Ã©/g, to: 'é' },
  { from: /Ã­/g, to: 'í' },
  { from: /Ã¡/g, to: 'á' },
  { from: /Ãº/g, to: 'ú' },
  { from: /Ãš/g, to: 'Ú' },
  { from: /Ã/g, to: 'Í' },
  { from: /Â¿/g, to: '¿' },
  
  // Special characters
  { from: /â€"/g, to: '—' },
  { from: /â€™/g, to: "'" },
  { from: /â€œ/g, to: '"' },
  { from: /â€/g, to: '"' },
  { from: /â€¦/g, to: '…' },
  { from: /â†'/g, to: '→' },
  
  // Unicode symbols (these are the hardest)
  { from: /â³/g, to: '⏳' },
  { from: /âœ•/g, to: '✕' },
  { from: /âœ"/g, to: '✓' },
  { from: /âœ/g, to: '✓' },
  { from: /â"€/g, to: '─' },
];

const files = [
  'app/pma/(dashboard)/(dashboard)/plans/[id]/page.tsx',
  'app/rgdp/(dashboard)/plans/[id]/page.tsx',
  'app/rgdp/api/download/item-period/route.ts',
  'app/rgdp/api/formats/route.ts',
  'app/rgdp/api/formats/[id]/route.ts',
  'app/rgdp/api/upload/route.ts'
];

let fixed = 0;
files.forEach(filepath => {
  try {
    let content = fs.readFileSync(filepath, 'utf8');
    const original = content;
    
    replacements.forEach(({ from, to }) => {
      content = content.replace(from, to);
    });
    
    if (content !== original) {
      fs.writeFileSync(filepath, content, 'utf8');
      fixed++;
      console.log(`✓ Fixed: ${filepath}`);
    }
  } catch (e) {
    console.log(`✗ Error: ${filepath}`);
  }
});

console.log(`\nTotal files fixed: ${fixed}`);
