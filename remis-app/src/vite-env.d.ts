/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_LICENSE_PUBLIC_KEYS?: string;
  readonly VITE_TRIAL_DAYS?: string;
  readonly VITE_PRICE_MES?: string;
  readonly VITE_PRICE_ANUAL?: string;
  readonly VITE_PAY_ALIAS?: string;
  readonly VITE_PAY_CBU?: string;
  readonly VITE_PAY_HOLDER?: string;
  readonly VITE_PAY_BANK?: string;
  readonly VITE_SELLER_WHATSAPP?: string;
}
