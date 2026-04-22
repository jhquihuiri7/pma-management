#!/bin/bash

files=(
  "app/pma/(dashboard)/(dashboard)/plans/[id]/page.tsx"
  "app/rgdp/(dashboard)/plans/[id]/page.tsx"
  "app/rgdp/api/download/item-period/route.ts"
  "app/rgdp/api/formats/route.ts"
  "app/rgdp/api/formats/[id]/route.ts"
  "app/rgdp/api/upload/route.ts"
)

echo "Fixing encoding issues..."

for file in "${files[@]}"; do
  [ ! -f "$file" ] && continue
  
  # Use sed with -E for extended regex and escape special characters
  sed -i -E 's/Ã³/ó/g' "$file"
  sed -i -E 's/Ã©/é/g' "$file"
  sed -i -E 's/Ã­/í/g' "$file"
  sed -i -E 's/Ã¡/á/g' "$file"
  sed -i -E 's/Ãº/ú/g' "$file"
  sed -i -E 's/Ãš/Ú/g' "$file"
  sed -i -E 's/Ã/Í/g' "$file"
  sed -i -E 's/Â¿/¿/g' "$file"
  sed -i 's/â€"/—/g' "$file"
  sed -i 's/â€™/'\''/g' "$file"
  sed -i 's/â€œ/"/g' "$file"
  sed -i 's/â€/"/g' "$file"
  sed -i 's/â€¦/…/g' "$file"
  sed -i 's/â³/⏳/g' "$file"
  sed -i 's/âœ•/✕/g' "$file"
  sed -i 's/âœ"/✓/g' "$file"
  sed -i "s/â†'/→/g" "$file"
  
  echo "✓ Fixed: $file"
done

echo "Done!"
