# Tutorial del módulo de Geoportal

## 1. Ingresar al Geoportal

1. Inicia sesión en la plataforma.
2. Selecciona **Geoportal** en el menú de aplicaciones.
3. En **Explorar mapas**, busca un mapa por nombre, descripción, temática o etiqueta.

## 2. Abrir un mapa

1. En la tarjeta del mapa, pulsa **Abrir GIS**.
2. Espera a que terminen de cargar las capas.
3. Usa el panel izquierdo para mostrar, ocultar, ordenar o seleccionar una capa.
4. Usa las herramientas del mapa para identificar elementos, medir distancias y consultar atributos.

## 3. Descargar el mapa como PDF

1. Pulsa **Exportar mapa** en la barra superior.
2. Selecciona el formato, orientación, título, leyenda y demás elementos cartográficos.
3. Pulsa **Generar PDF**.

## 4. Descargar todas las capas

1. Abre el mapa en el GIS.
2. En la barra superior, junto a **Exportar mapa**, pulsa **Descargar capas**.
3. El navegador descargará un archivo con el nombre `<mapa>-capas.zip`.
4. Descomprime el archivo. Cada capa vectorial tendrá su propia carpeta con:
   - un archivo `.geojson` con sus entidades;
   - un archivo `metadata.json` con geometría, sistema de referencia, cantidad de entidades y revisión.
5. El archivo `mapa.json` contiene el título, la fecha de descarga y el inventario de todas las capas, incluidas las capas ráster.

Las capas ráster se sirven como teselas en el Geoportal; por eso el ZIP incluye su estado, extensión y referencia de teselas, pero no copia las imágenes procesadas.

## 5. Agregar una capa

Si tienes permisos de edición, pulsa **Agregar capa** y carga el archivo geográfico admitido por el formulario. Revisa el nombre, la geometría y la simbología antes de guardar.

## 6. Guardar un Workspace

En el Workspace puedes combinar capas de distintos mapas. Usa **Descargar Workspace** para guardar la configuración JSON y volver a abrirla posteriormente desde **Importar Workspace**.

## 7. Recomendaciones

- Espera a que todas las capas terminen de cargar antes de descargarlas.
- Para compartir datos vectoriales, utiliza el ZIP de capas.
- Para compartir una composición cartográfica lista para imprimir, utiliza la exportación PDF.
- Si una capa no aparece o falla la descarga, recarga el mapa y vuelve a intentarlo; las capas ráster en estado de procesamiento deben esperar a que finalice su preparación.
