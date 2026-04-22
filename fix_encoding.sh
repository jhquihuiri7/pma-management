#!/bin/bash

# Array de archivos con problemas
files=(
  "app/pma/(dashboard)/(dashboard)/plans/[id]/page.tsx"
  "app/rgdp/(dashboard)/plans/[id]/page.tsx"
  "app/rgdp/api/download/item-period/route.ts"
  "app/rgdp/api/formats/route.ts"
  "app/rgdp/api/formats/[id]/route.ts"
  "app/rgdp/api/upload/route.ts"
)

# Función para hacer reemplazos
fix_file() {
  local file="$1"
  if [ ! -f "$file" ]; then
    echo "Archivo no encontrado: $file"
    return
  fi
  
  echo "Arreglando: $file"
  
  # Reemplazos de caracteres rotos
  sed -i 's/Ã³/ó/g' "$file"
  sed -i 's/Ã©/é/g' "$file"
  sed -i 's/Ã­/í/g' "$file"
  sed -i 's/Ã¡/á/g' "$file"
  sed -i 's/Ãº/ú/g' "$file"
  sed -i 's/Ãš/Ú/g' "$file"
  sed -i 's/Â¿/?/g' "$file"
  sed -i 's/â€"/—/g' "$file"
  sed -i 's/â€™/'\''/g' "$file"
  sed -i 's/â€œ/"/g' "$file"
  sed -i 's/â€/"/g' "$file"
  sed -i 's/â€¦/…/g' "$file"
  sed -i 's/â³/⏳/g' "$file"
  sed -i 's/âœ•/✕/g' "$file"
  sed -i 's/âœ"/✓/g' "$file"
}

# Ejecutar reemplazos
for file in "${files[@]}"; do
  fix_file "$file"
done

echo "Encoding fixed!"
