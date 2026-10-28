// Lo que se configura al publicar (variables VITE_* de Render). Ver docs/vender.md.
const env = import.meta.env;
const num = (v: string | undefined, def: number) => (v && Number.isFinite(Number(v)) ? Number(v) : def);

export const CONFIG = {
  /** Claves públicas del vendedor (separadas por coma). Sin ninguna, la app queda libre: sin prueba ni códigos. */
  licenseKeys: (env.VITE_LICENSE_PUBLIC_KEYS ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean),
  trialDays: num(env.VITE_TRIAL_DAYS, 14),
  prices: { mes: num(env.VITE_PRICE_MES, 3500), anual: num(env.VITE_PRICE_ANUAL, 20000) },
  pay: {
    alias: env.VITE_PAY_ALIAS ?? '',
    cbu: env.VITE_PAY_CBU ?? '',
    holder: env.VITE_PAY_HOLDER ?? '',
    bank: env.VITE_PAY_BANK ?? '',
  },
  /** WhatsApp del vendedor, con código de país y sin espacios: 5491122334455. */
  sellerWhatsapp: (env.VITE_SELLER_WHATSAPP ?? '').replace(/\D/g, ''),
};

export const licensing = () => CONFIG.licenseKeys.length > 0;
