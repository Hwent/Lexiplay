import { createContext, useContext, useMemo } from 'react';
import type { InterfaceLanguage } from './interface-preferences';
import { zhCN } from './locales/zh-CN';

export const LanguageContext = createContext<InterfaceLanguage>('en');

// API messages may already contain values; match the same catalog templates.
const messagePatterns = Object.entries(zhCN).filter(([key]) => /\{\d+\}/.test(key) && /[a-zA-Z]/.test(key)).map(([key, value]) => {
  const positions: number[] = [];
  const pattern = key.split(/(\{\d+\})/).map(part => {
    const match = /^\{(\d+)\}$/.exec(part);
    if (match) { positions.push(Number(match[1])); return '(.*?)'; }
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('');
  return { pattern: new RegExp(`^${pattern}$`), positions, value };
});

export function createTranslator(language: InterfaceLanguage) {
  return (text: string, ...values: (string | number | null | undefined)[]) => {
    let translated = text;
    if (language === 'zh-CN') {
      translated = zhCN[text] ?? zhCN[text.trim()] ?? text;
      if (translated === text && !values.length) {
        for (const { pattern, positions, value } of messagePatterns) {
          const match = pattern.exec(text);
          if (!match) continue;
          values = [];
          positions.forEach((position, index) => { values[position] = match[index + 1]!; });
          translated = value;
          break;
        }
      }
    }
    return translated.replace(/\{(\d+)\}/g, (placeholder, index: string) => String(values[Number(index)] ?? placeholder));
  };
}

export function useTranslation() {
  const language = useContext(LanguageContext);
  return useMemo(() => createTranslator(language), [language]);
}
