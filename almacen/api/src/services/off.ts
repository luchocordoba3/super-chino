/** Busca nombre y marca de un código de barras en Open Food Facts (base abierta). Si falla, null. */
export async function lookupBarcode(code: string): Promise<{ name: string; brand: string | null } | null> {
  if (!/^\d{8,14}$/.test(code)) return null;
  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,product_name_es,brands,quantity`,
      { headers: { 'User-Agent': 'Almacen/0.1 (gestion de almacenes)' }, signal: AbortSignal.timeout(3500) },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { status?: number; product?: Record<string, string | undefined> };
    const p = data.product;
    const baseName = p?.product_name_es || p?.product_name;
    if (data.status !== 1 || !p || !baseName) return null;
    const name = [baseName, p.quantity].filter(Boolean).join(' ').trim();
    return { name, brand: p.brands?.split(',')[0]?.trim() || null };
  } catch {
    return null;
  }
}
