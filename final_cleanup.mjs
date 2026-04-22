import fs from 'fs';

const cleanups = [
  {
    file: 'app/pma/(dashboard)/(dashboard)/plans/[id]/page.tsx',
    fixes: [
      ['// Build evidence status lookup: "planItemId-YYYY-MM" â†' validationStatus', '// Build evidence status lookup: "planItemId-YYYY-MM" -> validationStatus'],
      ['// Build compliance lookup: "planItemId::periodKey" â†' status', '// Build compliance lookup: "planItemId::periodKey" -> status'],
    ]
  },
  {
    file: 'app/rgdp/(dashboard)/plans/[id]/page.tsx',
    fixes: [
      ['// Build evidence status lookup: "planItemId-YYYY-MM" â†' validationStatus', '// Build evidence status lookup: "planItemId-YYYY-MM" -> validationStatus'],
      ['// Build compliance lookup: "planItemId::periodKey" â†' status', '// Build compliance lookup: "planItemId::periodKey" -> status'],
    ]
  }
];

cleanups.forEach(({ file, fixes }) => {
  let content = fs.readFileSync(file, 'utf8');
  fixes.forEach(([from, to]) => {
    content = content.split(from).join(to);
  });
  fs.writeFileSync(file, content, 'utf8');
  console.log(`✓ ${file}`);
});

console.log('Done');
