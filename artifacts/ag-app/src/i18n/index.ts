import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import deTranslations from './de.json';
import enTranslations from './en.json';

i18n.use(initReactI18next).init({
  resources: {
    de: { translation: deTranslations },
    en: { translation: enTranslations },
  },
  lng: 'de',
  fallbackLng: 'de',
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
