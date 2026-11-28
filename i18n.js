import { CLIO_LANGUAGES } from "./protocol.js";

export const LANGUAGES = CLIO_LANGUAGES;

export const LANGUAGE_LABELS = Object.freeze({
  en: "English",
  fr: "Français",
  es: "Español",
  de: "Deutsch",
  it: "Italiano",
  pt: "Português",
  nl: "Nederlands",
  pl: "Polski",
  tr: "Türkçe",
  el: "Ελληνικά",
  uk: "Українська",
  ru: "Русский",
  ar: "العربية",
  "zh-Hans": "简体中文",
  ja: "日本語",
  ko: "한국어",
  hi: "हिन्दी",
  he: "עברית"
});

export const RTL_LANGUAGES = new Set(["ar", "he"]);

export function isRtlLanguage(code) {
  return RTL_LANGUAGES.has(code);
}

export function indexForLanguage(code) {
  const idx = LANGUAGES.indexOf(code);
  return idx >= 0 ? idx : 0;
}

export function languageForIndex(index) {
  const i = Number(index);
  return (Number.isInteger(i) && i >= 0 && i < LANGUAGES.length) ? LANGUAGES[i] : "en";
}

export function detectOsLanguage(navLanguages = typeof navigator !== "undefined" ? (navigator.languages || [navigator.language]) : ["en"]) {
  for (const raw of navLanguages || []) {
    if (!raw || typeof raw !== "string") continue;
    const tag = raw.trim().toLowerCase();
    if (tag.startsWith("zh")) return "zh-Hans";
    if (tag === "iw" || tag.startsWith("iw-") || tag === "he" || tag.startsWith("he-")) return "he";
    const base = tag.split("-")[0];
    if (LANGUAGES.includes(base)) return base;
  }
  return "en";
}

const cache = new Map();
let currentLang = "en";
let activeDict = {};
let fallbackDict = {};

export function getCurrentLanguage() {
  return currentLang;
}

export function setFallbackDictionary(dict) {
  if (dict && typeof dict === "object") {
    fallbackDict = dict;
    cache.set("en", dict);
  }
}

export async function loadLanguage(code, { fetcher = typeof fetch === "function" ? fetch : null, doc = typeof document !== "undefined" ? document : null } = {}) {
  const lang = LANGUAGES.includes(code) ? code : "en";
  const loadOne = async c => {
    if (cache.has(c)) return cache.get(c);
    if (!fetcher) return {};
    const res = await fetcher(`./locales/${c}.json`);
    if (!res.ok) throw new Error(`Locale ${c} HTTP ${res.status}`);
    const data = await res.json();
    cache.set(c, data);
    return data;
  };

  if (!Object.keys(fallbackDict).length) {
    try { fallbackDict = await loadOne("en"); } catch { }
  }
  try {
    activeDict = lang === "en" ? fallbackDict : await loadOne(lang);
  } catch {
    activeDict = fallbackDict;
  }
  currentLang = lang;

  if (doc?.documentElement) {
    doc.documentElement.lang = lang;
    doc.documentElement.dir = isRtlLanguage(lang) ? "rtl" : "ltr";
  }
  return activeDict;
}

export function t(key, vars = null) {
  let text = activeDict[key] ?? fallbackDict[key] ?? key;
  if (vars && typeof vars === "object") {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }
  return text;
}

export function applyTranslations(root = typeof document !== "undefined" ? document : null) {
  if (!root) return;
  for (const el of root.querySelectorAll("[data-i18n]")) {
    el.textContent = t(el.dataset.i18n);
  }
  for (const el of root.querySelectorAll("[data-i18n-placeholder]")) {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  }
  for (const el of root.querySelectorAll("[data-i18n-aria]")) {
    el.setAttribute("aria-label", t(el.dataset.i18nAria));
  }
  for (const el of root.querySelectorAll("[data-i18n-title]")) {
    el.title = t(el.dataset.i18nTitle);
  }
}
