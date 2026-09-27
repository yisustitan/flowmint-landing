import os
import re
import zipfile

# Obtener directorio del script de forma robusta y portable
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
HTML_PATH = os.path.join(SCRIPT_DIR, "kit-banners.html")
ZIP_PATH = os.path.join(SCRIPT_DIR, "kit-banners-flowmint.zip")

patterns = {
    "post-01-lanzamiento.svg": r'(<svg id="svg-post-01".*?</svg>)',
    "post-02-testimonio.svg": r'(<svg id="svg-post-02".*?</svg>)',
    "post-03-beneficios.svg": r'(<svg id="svg-post-03".*?</svg>)',
    "story-01-oferta.svg": r'(<svg id="svg-story-01".*?</svg>)',
    "story-02-demo.svg": r'(<svg id="svg-story-02".*?</svg>)',
    "mockup-dispositivos.svg": r'(<svg id="svg-mockup-01".*?</svg>)',
    "mockup-mobile.svg": r'(<svg id="svg-mockup-02".*?</svg>)',
}

def create_zip():
    if not os.path.exists(HTML_PATH):
        raise FileNotFoundError(f"No se encontro el archivo HTML en: {HTML_PATH}")

    with open(HTML_PATH, "r", encoding="utf-8") as f:
        html_content = f.read()

    print(f"Leyendo SVGs desde: {HTML_PATH}")
    added_count = 0

    with zipfile.ZipFile(ZIP_PATH, "w", zipfile.ZIP_DEFLATED) as z:
        for filename, pat in patterns.items():
            match = re.search(pat, html_content, re.DOTALL)
            if match:
                svg_text = match.group(1).strip()
                if not svg_text.startswith("<?xml"):
                    svg_text = '<?xml version="1.0" encoding="UTF-8"?>\n' + svg_text
                if 'xmlns="http://www.w3.org/2000/svg"' not in svg_text:
                    svg_text = svg_text.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ', 1)

                z.writestr(filename, svg_text.encode("utf-8"))
                added_count += 1
                print(f" [+] Agregado: {filename} ({len(svg_text)} caracteres)")
            else:
                print(f" [-] ERROR: No se encontro patron para: {filename}")

    if added_count == len(patterns):
        print(f"\nExito! Zip generado en: {ZIP_PATH}")
        print(f"Tamano total: {os.path.getsize(ZIP_PATH)} bytes con {added_count} archivos SVG.")
    else:
        print(f"\nAdvertencia: Solo se agregaron {added_count} de {len(patterns)} archivos.")

if __name__ == "__main__":
    create_zip()
