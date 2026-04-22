#!/bin/bash

files=(
  "app/pma/(dashboard)/(dashboard)/plans/[id]/page.tsx"
  "app/rgdp/(dashboard)/plans/[id]/page.tsx"
  "app/rgdp/api/download/item-period/route.ts"
  "app/rgdp/api/formats/route.ts"
  "app/rgdp/api/formats/[id]/route.ts"
  "app/rgdp/api/upload/route.ts"
)

for file in "${files[@]}"; do
  if [ ! -f "$file" ]; then continue; fi
  echo "Arreglando: $file"
  
  # Más reemplazos de caracteres rotos
  sed -i 's/Ã[^a-zA-Z0-9]/Í/g' "$file"
  sed -i 's/Ã$/Í/g' "$file"
  sed -i 's/â†'/→/g' "$file"
  sed -i 's/â†/→/g' "$file"
  sed -i 's/â/✓/g' "$file"
done

echo "Done!"
