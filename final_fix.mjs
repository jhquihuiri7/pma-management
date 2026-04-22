import fs from 'fs';

const files = [
  'app/pma/(dashboard)/(dashboard)/plans/[id]/page.tsx',
  'app/rgdp/(dashboard)/plans/[id]/page.tsx',
  'app/rgdp/api/download/item-period/route.ts',
  'app/rgdp/api/upload/route.ts'
];

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  const original = content;
  
  // Fix comments with arrows
  content = content.replace(/â†'/g, '→');
  
  // Fix hourglass character (more aggressive pattern)
  content = content.replace(/â³/g, '⏳');
  content = content.replace(/â³/g, '⏳'); // Try again with different encoding
  
  // Fix line drawing characters
  content = content.replace(/â"€â"€/g, '──');
  content = content.replace(/â"€/g, '─');
  
  // Just remove these problematic characters if they persist
  // They're only in comments anyway
  content = content.replace(/^.*â†'.*$/gm, '');
  content = content.replace(/^.*â"€â"€.*$/gm, '  // ');
  content = content.replace(/^.*â³.*$/gm, '');
  
  // Clean up blank lines
  content = content.replace(/\n\n\n+/g, '\n\n');
  
  if (content !== original) {
    fs.writeFileSync(file, content, 'utf8');
    console.log(`✓ ${file}`);
  }
});

console.log('Done');
