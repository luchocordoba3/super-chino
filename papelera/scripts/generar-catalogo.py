#!/usr/bin/env python3
"""Genera web/productos.js a partir de la lista de precios en PDF.

Uso:  python3 papelera/scripts/generar-catalogo.py [ruta/al.pdf]
Necesita `pdftotext` (paquete poppler-utils).

Solo publica precios de venta (mayorista y minorista). El costo de fábrica
nunca entra al catálogo.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
PDF = Path(sys.argv[1]) if len(sys.argv) > 1 else BASE / "datos" / "lista-de-precios.pdf"
SALIDA = BASE / "web" / "productos.js"

RUBROS = [
    "QUÍMICOS Y LIMPIEZA",
    "ARTÍCULOS DE LIMPIEZA",
    "BOLSAS",
    "PAPEL HIGIÉNICO, TOALLAS Y SERVILLETAS",
    "DESCARTABLES GASTRONÓMICOS",
    "EMBALAJE, PAPELES Y LIBRERÍA",
]
FILA = re.compile(r"^\s*([A-Z]{2}\d{4})\s+(.+?)\s+\$\s*([\d.]+)\s+\$\s*([\d.]+)\s*$")
CODIGO = re.compile(r"^\s*[A-Z]{2}\d{4}\s")


def pesos(texto):
    return int(texto.replace(".", ""))


def limpiar(nombre, codigo):
    nombre = re.sub(r"\s+", " ", nombre).strip()
    return nombre.removeprefix(codigo + "-")


def main():
    texto = subprocess.run(
        ["pdftotext", "-layout", str(PDF), "-"], capture_output=True, text=True, check=True
    ).stdout
    rubro, productos, vistos, raros = None, [], set(), []
    for linea in texto.splitlines():
        if linea.strip() in RUBROS:
            rubro = linea.strip()
            continue
        m = FILA.match(linea)
        if m and rubro:
            codigo, nombre, may, mino = m.groups()
            if codigo in vistos:
                continue
            vistos.add(codigo)
            productos.append({
                "codigo": codigo,
                "nombre": limpiar(nombre, codigo),
                "rubro": rubro,
                "mayorista": pesos(may),
                "minorista": pesos(mino),
            })
        elif CODIGO.match(linea):
            raros.append(linea.strip())

    datos = json.dumps(productos, ensure_ascii=False, indent=1)
    SALIDA.write_text(f"// Generado por scripts/generar-catalogo.py. No editar a mano.\nwindow.PRODUCTOS = {datos};\n", encoding="utf-8")
    print(f"{len(productos)} productos en {len({p['rubro'] for p in productos})} rubros -> {SALIDA}")
    for linea in raros:
        print("  sin leer:", linea)
    return 1 if raros else 0


if __name__ == "__main__":
    sys.exit(main())
