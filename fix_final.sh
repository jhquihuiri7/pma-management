#!/bin/bash

# Fix all remaining characters
find app -type f \( -name "*.tsx" -o -name "*.ts" \) | while read file; do
  # Replace arrow character
  sed -i 's/â†'"'"'/→/g' "$file"
  # Replace hourglass
  sed -i 's/â³/⏳/g' "$file"
  # Replace checkmark
  sed -i 's/âœ"/✓/g' "$file"
  # Replace line character
  sed -i 's/â"€/─/g' "$file"
done

echo "All fixed!"
