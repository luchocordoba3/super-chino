import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { es } from './es';
import { zh } from './zh';

export type AppLang = 'es' | 'zh';

function initialLang(): AppLang {
  try {
    const saved = localStorage.getItem('lang');
    if (saved === 'es' || saved === 'zh') return saved;
  } catch {
    // sin localStorage
  }
  return typeof navigator !== 'undefined' && navigator.language?.startsWith('zh') ? 'zh' : 'es';
}

void i18n.use(initReactI18next).init({
  resources: { es: { translation: es }, zh: { translation: zh } },
  lng: initialLang(),
  fallbackLng: 'es',
  interpolation: { escapeValue: false },
});

export function setLang(lang: AppLang) {
  if (i18n.language !== lang) void i18n.changeLanguage(lang);
  try {
    localStorage.setItem('lang', lang);
  } catch {
    // sin localStorage
  }
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'es';
}

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof es };
  }
}

export default i18n;
