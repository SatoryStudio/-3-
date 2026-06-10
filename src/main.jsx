import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { strFromU8, unzipSync } from 'fflate';
import {
  Boxes,
  ChevronRight,
  Download,
  ExternalLink,
  Factory,
  PackagePlus,
  PlugZap,
  Printer,
  RefreshCcw,
  Search,
  ShoppingBag,
  Upload,
} from 'lucide-react';
import './styles.css';

const DEFAULT_PRODUCTS_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/16NxpZDFepUmBw5F5x5in0svb-FplX-r5ZLoBTfc67FU/edit?gid=0#gid=0';
const PRODUCT_SHEET_STORAGE_KEY = 'satori.productsSheetUrl';
const USAGE_SHEET_STORAGE_KEY = 'satori.usageSheetUrl';
const FILAMENT_SHEET_STORAGE_KEY = 'satori.filamentSheetUrl';
const FILAMENT_LOCATIONS_STORAGE_KEY = 'satori.filamentLocations';
const MARKETPLACE_INTEGRATIONS_STORAGE_KEY = 'satori.marketplaceIntegrations';
const MARKETPLACE_REQUIRED_FIELDS = {
  ozon: ['Client ID', 'API key'],
  wildberries: ['Token статистики'],
  yandex: ['OAuth token', 'Campaign ID'],
  manual: ['Название канала'],
};

const PRINT_HOUR_COST = 55;
const PACKING_COST = 35;
const MARKETPLACE_FEES = [
  { id: 'ozon', label: 'Ozon', percent: 15 },
  { id: 'yandex', label: 'Яндекс', percent: 13 },
  { id: 'wb', label: 'WB', percent: 18 },
];
const COMPLETED_ORDERS_TOTAL = 128;
const ORDER_STATUSES = ['Новый', 'Отправлена на печать', 'В печати', 'Упакован'];
const MARKETPLACE_ORDER_STATUSES = ['Отгружен', 'Доставляется', 'Доставлен в ПВЗ', 'Доставлен'];
const PRINT_QUEUE_STATUSES = ['Новый', 'Отправлена на печать', 'В печати'];
const MARKETPLACE_SHIPPING_STATUSES = ['Отгружен', 'Доставляется', 'Доставлен в ПВЗ'];
const PRINTER_STORAGE_KEY = 'satori.printerIntegration';

function getMissingMarketplaceFields(id, settings = {}) {
  return (MARKETPLACE_REQUIRED_FIELDS[id] || []).filter((field) => !String(settings[field] || '').trim());
}

function isMarketplaceReady(id, settings = {}) {
  return Boolean(settings.connected) && getMissingMarketplaceFields(id, settings).length === 0;
}

const navigation = [
  { id: 'dashboard', label: 'Дашборд', icon: Factory },
  { id: 'orders', label: 'Заказы', icon: ShoppingBag },
  { id: 'filament', label: 'Филамент', icon: Boxes },
  { id: 'usage', label: 'Расход', icon: RefreshCcw },
  { id: 'replenish', label: 'Пополнение', icon: PackagePlus },
  { id: 'products', label: 'Изделия', icon: Printer },
  { id: 'integrations', label: 'Интеграции', icon: PlugZap },
];

const initialPrinterIntegration = {
  type: 'Bambu Lab',
  host: '',
  serial: '',
  accessCode: '',
};

const printerStatus = {
  name: 'Bambu Lab P1S',
  state: 'Печатает',
  job: 'Органайзер настольный Гео',
  progress: 64,
  material: 'PLA',
  color: 'Черный',
  usedGrams: 198,
  estimatedGrams: 312,
  timeLeft: '2 ч 38 мин',
};

const marketplaceTokenHelp = {
  ozon: {
    title: 'Где взять ключи Ozon',
    steps: [
      'Откройте Ozon Seller и перейдите в Настройки → API keys.',
      'Создайте ключ для Seller API.',
      'Скопируйте Client ID в поле Client ID, API key в поле API key. Seller ID можно оставить пустым, если кабинет отвечает без него.',
    ],
    links: [
      { label: 'Открыть API keys в Ozon Seller', href: 'https://seller.ozon.ru/app/settings/api-keys' },
      { label: 'Документация Ozon Seller API', href: 'https://docs.ozon.ru/api/seller/' },
    ],
  },
  wildberries: {
    title: 'Где взять токен Wildberries',
    steps: [
      'Откройте личный кабинет продавца WB и перейдите в Настройки → Доступ к API.',
      'Создайте токен с доступами к заказам, статистике, ценам и контенту.',
      'Если WB выдал один общий токен, вставьте его в первое поле. Остальные поля можно заполнить тем же токеном позже, если понадобится разделить права.',
    ],
    links: [
      { label: 'Открыть доступ к API WB', href: 'https://seller.wildberries.ru/supplier-settings/access-to-api' },
      { label: 'Документация Wildberries API', href: 'https://dev.wildberries.ru/openapi/api-information' },
    ],
  },
  yandex: {
    title: 'Где взять данные Яндекс Маркета',
    steps: [
      'Создайте OAuth-приложение Яндекса и получите OAuth token для Partner API.',
      'Campaign ID берется из URL кампании или настроек магазина в кабинете Яндекс Маркета.',
      'Business ID берется из настроек бизнеса. Если не знаете, можно сначала сохранить Campaign ID и токен.',
    ],
    links: [
      { label: 'Создать OAuth-приложение', href: 'https://oauth.yandex.ru/client/new' },
      { label: 'Кабинет Яндекс Маркета', href: 'https://partner.market.yandex.ru/' },
      { label: 'Документация Partner API', href: 'https://yandex.ru/dev/market/partner-api/doc/ru/' },
    ],
  },
};

const materialUsage = [
  {
    id: 'print-001',
    date: '27 мая',
    source: 'Заказ Ozon',
    sku: '000-001',
    name: 'Органайзер настольный Гео',
    material: 'PLA',
    color: 'Черный',
    grams: 198,
    status: 'Печатается',
  },
  {
    id: 'print-002',
    date: '27 мая',
    source: 'Личная печать',
    sku: '—',
    name: 'Тест крепления',
    material: 'PETG',
    color: 'Белый',
    grams: 42,
    status: 'Готово',
  },
  {
    id: 'print-003',
    date: '26 мая',
    source: 'Заказ Яндекс',
    sku: '000-028',
    name: 'Держатель для спрея',
    material: 'PETG',
    color: 'Черный',
    grams: 30,
    status: 'Готово',
  },
  {
    id: 'print-004',
    date: '26 мая',
    source: 'Брак',
    sku: '000-007',
    name: 'Зажим кухонный',
    material: 'PLA',
    color: 'Белый',
    grams: 9,
    status: 'Списано',
  },
];

const filaments = [
  {
    material: 'PETG',
    colors: [
      { color: 'Белый', hex: '#f4f2ed', group: 'Сухой бокс', current: 410, reserve: 270, priceKg: 1450 },
    ],
  },
  {
    material: 'PLA',
    colors: [
      { color: 'Красный', hex: '#c9272d', group: 'Стеллаж B1', current: 620, reserve: 260, priceKg: 1280 },
      { color: 'Черный', hex: '#171717', group: 'Стеллаж B1', current: 290, reserve: 122, priceKg: 1200 },
    ],
  },
];

const fallbackFilamentPurchases = [
  { id: 'PLA-Черный-1', date: '27 мая', material: 'PLA', color: 'Черный', grams: 1000, price: 1200, supplier: 'ручной ввод', location: 'Склад' },
  { id: 'PETG-Белый-1', date: '27 мая', material: 'PETG', color: 'Белый', grams: 1000, price: 1450, supplier: 'ручной ввод', location: 'AMS' },
];

const fallbackProducts = [
  { sku: '000-001', name: 'Органайзер настольный Гео', grams: 312, material: 'PLA', materialRaw: 'PLA Base', color: 'Черный', printHours: 7.4, price: 2190 },
  { sku: '000-007', name: 'Зажим кухонный (набор 6 шт)', grams: 6, material: 'PLA', materialRaw: 'PLA Base', color: 'Белый', printHours: 60, price: 250 },
  { sku: '000-025', name: 'Клипса для пакетов', grams: 32, material: 'PETG', materialRaw: 'PETG Base', color: 'Белый', printHours: 0, price: 0 },
  { sku: '000-028', name: 'Держатель для спрея', grams: 15, material: 'PETG', materialRaw: 'PETG Base', color: 'Черный', printHours: 0, price: 560 },
  { sku: '000-030', name: 'Держатель для спрея', grams: 65, material: 'PETG', materialRaw: 'PETG Base', color: 'Бардо', printHours: 0, price: 560 },
];

const initialOrders = [
  {
    id: '728941-001',
    channel: 'Ozon',
    source: 'Основной кабинет',
    sku: '000-007',
    quantity: 6,
    price: 1740,
    commission: 261,
    due: '26 мая',
    status: 'В печати',
    dates: {
      received: '25 мая, 11:20',
      shipped: '',
      pvzDelivered: '',
      pickedUp: '',
    },
    adjustments: [
      { id: 'ozon-sale-fee', label: 'Комиссия за продажу', amount: 261, status: 'confirmed', source: 'Ozon Seller' },
      { id: 'ozon-logistics', label: 'Логистика до покупателя', amount: 184, status: 'pending', source: 'Ozon начислит после отгрузки' },
      { id: 'ozon-acquiring', label: 'Эквайринг / платежи', amount: 24, status: 'pending', source: 'Ozon фин. отчет' },
      { id: 'ozon-promo', label: 'Акции, баллы, скидки продавца', amount: 0, status: 'pending', source: 'Пока нет начисления' },
      { id: 'ozon-ads', label: 'Реклама на заказ', amount: 0, status: 'pending', source: 'Ждем детализацию рекламы' },
      { id: 'ozon-fines', label: 'Штрафы и удержания', amount: 0, status: 'pending', source: 'Ждем отчет' },
    ],
  },
  {
    id: 'YM-59012',
    channel: 'Яндекс',
    source: 'Маркет FBS',
    sku: '000-028',
    quantity: 2,
    price: 890,
    commission: 118,
    due: '27 мая',
    status: 'Новый',
    dates: {
      received: '27 мая, 09:14',
      shipped: '',
      pvzDelivered: '',
      pickedUp: '',
    },
    adjustments: [
      { id: 'ym-fee', label: 'Комиссия маркетплейса', amount: 118, status: 'confirmed', source: 'Яндекс Маркет' },
      { id: 'ym-logistics', label: 'Логистика / сортировка', amount: 96, status: 'pending', source: 'Яндекс начислит позже' },
      { id: 'ym-acquiring', label: 'Эквайринг', amount: 14, status: 'pending', source: 'Фин. отчет' },
      { id: 'ym-promo', label: 'Скидки, промокоды, баллы', amount: 0, status: 'pending', source: 'Ждем отчет' },
      { id: 'ym-fines', label: 'Штрафы и удержания', amount: 0, status: 'pending', source: 'Ждем отчет' },
    ],
  },
  {
    id: 'WB-80451',
    channel: 'Wildberries',
    source: 'Поставка со склада',
    sku: '000-001',
    quantity: 1,
    price: 2150,
    commission: 344,
    due: '28 мая',
    status: 'Упакован',
    dates: {
      received: '26 мая, 18:40',
      shipped: '',
      pvzDelivered: '',
      pickedUp: '',
    },
    adjustments: [
      { id: 'wb-fee', label: 'Комиссия площадки', amount: 344, status: 'confirmed', source: 'Wildberries' },
      { id: 'wb-logistics', label: 'Логистика', amount: 160, status: 'pending', source: 'Фин. отчет WB' },
      { id: 'wb-storage', label: 'Хранение / приемка', amount: 0, status: 'pending', source: 'Ждем отчет' },
      { id: 'wb-penalties', label: 'Штрафы и удержания', amount: 0, status: 'pending', source: 'Ждем отчет' },
    ],
  },
];

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(value);
      value = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(value);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      value = '';
    } else {
      value += char;
    }
  }

  row.push(value);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

function parseNumber(value) {
  const normalized = String(value || '')
    .replace(/[₽рР]/g, '')
    .replace(/\s/g, '')
    .replace(/^\./, '')
    .replace(',', '.')
    .replace(/[^\d.-]/g, '');
  const number = Number.parseFloat(normalized);
  return Number.isFinite(number) ? number : 0;
}

function parsePrintHours(value) {
  const number = parseNumber(value);
  if (number > 24) return Math.round((number / 60) * 100) / 100;
  return number;
}

function normalizeMaterial(value) {
  const material = String(value || '').toUpperCase();
  if (material.includes('PETG')) return 'PETG';
  if (material.includes('PLA')) return 'PLA';
  return value || 'Материал не указан';
}

function cleanText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeColor(value) {
  const color = cleanText(value);
  const lower = color.toLowerCase();
  if (lower.includes('виш') || lower.includes('cherry')) return 'Вишневый';
  if (lower.includes('черн') || lower.includes('black')) return 'Черный';
  if (lower.includes('бел') || lower.includes('white')) return 'Белый';
  if (lower.includes('прозрач') || lower.includes('transparent')) return 'Прозрачный';
  return color || 'цвет не указан';
}

function formatSheetDate(value) {
  const text = cleanText(value);
  const serial = Number.parseFloat(text);
  if (/^\d+(\.\d+)?$/.test(text) && serial > 30000 && serial < 70000) {
    const date = new Date(Date.UTC(1899, 11, 30 + Math.floor(serial)));
    return date.toLocaleDateString('ru-RU', { timeZone: 'UTC' });
  }
  return text;
}

function splitFilamentMaterialAndColor(materialValue, colorValue) {
  let material = cleanText(materialValue) || 'Материал не указан';
  let color = cleanText(colorValue);
  const colorPatterns = [
    [/transparent|прозрачн/i, 'Прозрачный'],
    [/black|черн/i, 'Черный'],
    [/white|бел/i, 'Белый'],
    [/red|красн/i, 'Красный'],
    [/green|зелен/i, 'Зеленый'],
    [/yellow|желт/i, 'Желтый'],
    [/pink|розов/i, 'Розовый'],
    [/violet|фиолет|сирен/i, 'Фиолетовый'],
  ];

  if (!color) {
    const match = colorPatterns.find(([pattern]) => pattern.test(material));
    if (match) {
      color = match[1];
      material = cleanText(material.replace(match[0], ''));
    }
  }

  return {
    material: normalizeMaterial(material || cleanText(materialValue) || 'Материал не указан'),
    color: normalizeColor(color),
  };
}

function getXmlAttr(xmlTag, attr) {
  return xmlTag.match(new RegExp(`${attr}="([^"]*)"`))?.[1] || '';
}

function decodeXml(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function getStoredProductsSheetUrl() {
  try {
    return localStorage.getItem(PRODUCT_SHEET_STORAGE_KEY) || DEFAULT_PRODUCTS_SHEET_URL;
  } catch {
    return DEFAULT_PRODUCTS_SHEET_URL;
  }
}

function getStoredFilamentSheetUrl() {
  try {
    return localStorage.getItem(FILAMENT_SHEET_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function getStoredFilamentLocations() {
  try {
    return JSON.parse(localStorage.getItem(FILAMENT_LOCATIONS_STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function getStoredPrinterIntegration() {
  try {
    return JSON.parse(localStorage.getItem(PRINTER_STORAGE_KEY)) || initialPrinterIntegration;
  } catch {
    return initialPrinterIntegration;
  }
}

function getStoredMarketplaceIntegrations() {
  try {
    return JSON.parse(localStorage.getItem(MARKETPLACE_INTEGRATIONS_STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function getSpreadsheetId(url) {
  return String(url).match(/\/spreadsheets\/d\/([^/]+)/)?.[1] || String(url).trim();
}

function getSheetGid(url) {
  return String(url).match(/[?#&]gid=(\d+)/)?.[1] || '0';
}

function getGoogleSheetExportUrls(url) {
  const rawUrl = String(url).trim();
  if (rawUrl.includes('output=csv') || rawUrl.includes('format=csv')) {
    return { csvUrl: rawUrl, xlsxUrl: '' };
  }

  const spreadsheetId = getSpreadsheetId(url);
  const gid = getSheetGid(url);

  return {
    csvUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`,
    xlsxUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=xlsx`,
  };
}

function explainSheetLoadError(response, body = '') {
  if (response.status === 400 || response.status === 404) {
    return 'Google не открыл файл. Проверьте, что ссылка именно на Google Sheets и доступ стоит "Все, у кого есть ссылка - читатель".';
  }
  if (response.status === 401 || response.status === 403) {
    return 'Нет доступа к таблице. Откройте доступ "Все, у кого есть ссылка - читатель" или вставьте опубликованную CSV-ссылку.';
  }
  if (body.includes('<!DOCTYPE html') || body.includes('<html')) {
    return 'Google вернул страницу вместо CSV. Обычно это значит, что таблица закрыта или ссылка ведет не на файл таблицы.';
  }
  return `Google Sheets ответил ${response.status}`;
}

async function fetchCsvFromSheet(csvUrl) {
  const response = await fetch(csvUrl);
  const text = await response.text();
  if (!response.ok) throw new Error(explainSheetLoadError(response, text));
  if (text.includes('<!DOCTYPE html') || text.includes('<html')) {
    throw new Error(explainSheetLoadError(response, text));
  }
  return text;
}

function getPrintLinksFromXlsx(buffer) {
  const files = unzipSync(new Uint8Array(buffer));
  const workbook = strFromU8(files['xl/workbook.xml'] || new Uint8Array());
  const workbookRels = strFromU8(files['xl/_rels/workbook.xml.rels'] || new Uint8Array());
  const productsSheetTag = (workbook.match(/<sheet\b[^>]+>/g) || []).find((tag) => getXmlAttr(tag, 'name') === 'Товары');
  const productsSheetRelId = productsSheetTag ? getXmlAttr(productsSheetTag, 'r:id') : '';
  const productsSheetRel = (workbookRels.match(/<Relationship\b[^>]+>/g) || []).find(
    (tag) => getXmlAttr(tag, 'Id') === productsSheetRelId,
  );
  const sheetPath = productsSheetRel ? `xl/${getXmlAttr(productsSheetRel, 'Target')}` : 'xl/worksheets/sheet3.xml';
  const relsPath = sheetPath.replace('xl/worksheets/', 'xl/worksheets/_rels/') + '.rels';
  const sheet = strFromU8(files[sheetPath] || new Uint8Array());
  const rels = strFromU8(files[relsPath] || new Uint8Array());
  const targetsById = {};
  const linksByRow = {};

  for (const tag of rels.match(/<Relationship\b[^>]+>/g) || []) {
    const id = getXmlAttr(tag, 'Id');
    const target = decodeXml(getXmlAttr(tag, 'Target'));
    if (id && target) targetsById[id] = target;
  }

  for (const tag of sheet.match(/<hyperlink\b[^>]+>/g) || []) {
    const ref = getXmlAttr(tag, 'ref');
    const id = getXmlAttr(tag, 'r:id');
    const row = Number.parseInt(ref.replace(/[A-Z]/gi, ''), 10);
    if (ref.startsWith('B') && row && targetsById[id]) linksByRow[row] = targetsById[id];
  }

  return linksByRow;
}

function columnNameToIndex(name) {
  return String(name || '')
    .replace(/\d/g, '')
    .split('')
    .reduce((sum, letter) => sum * 26 + letter.toUpperCase().charCodeAt(0) - 64, 0) - 1;
}

function getSharedStrings(files) {
  const xml = strFromU8(files['xl/sharedStrings.xml'] || new Uint8Array());
  return (xml.match(/<si\b[\s\S]*?<\/si>/g) || []).map((item) =>
    (item.match(/<t[^>]*>[\s\S]*?<\/t>/g) || [])
      .map((tag) => decodeXml(tag.replace(/<[^>]+>/g, '')))
      .join(''),
  );
}

function getSheetPathByName(files, sheetNames) {
  const workbook = strFromU8(files['xl/workbook.xml'] || new Uint8Array());
  const workbookRels = strFromU8(files['xl/_rels/workbook.xml.rels'] || new Uint8Array());
  const normalizedNames = sheetNames.map((name) => name.toLowerCase());
  const sheetTags = workbook.match(/<sheet\b[^>]+>/g) || [];
  const sheetTag = normalizedNames
    .map((candidate) =>
      sheetTags.find((tag) => decodeXml(getXmlAttr(tag, 'name')).trim().toLowerCase() === candidate),
    )
    .find(Boolean)
    || normalizedNames
      .map((candidate) =>
        sheetTags.find((tag) => decodeXml(getXmlAttr(tag, 'name')).trim().toLowerCase().includes(candidate)),
      )
      .find(Boolean);
  const relId = sheetTag ? getXmlAttr(sheetTag, 'r:id') : '';
  const relTag = (workbookRels.match(/<Relationship\b[^>]+>/g) || []).find((tag) => getXmlAttr(tag, 'Id') === relId);
  const target = relTag ? decodeXml(getXmlAttr(relTag, 'Target')).replace(/^\//, '') : '';
  if (!target) return '';
  return target.startsWith('xl/') ? target : `xl/${target}`;
}

function getRowsFromSheetXml(sheetXml, sharedStrings) {
  return (sheetXml.match(/<row\b[\s\S]*?<\/row>/g) || [])
    .map((rowTag) => {
      const row = [];
      for (const cellTag of rowTag.match(/<c\b[\s\S]*?<\/c>/g) || []) {
        const ref = getXmlAttr(cellTag, 'r');
        const index = columnNameToIndex(ref);
        const type = getXmlAttr(cellTag, 't');
        const inlineValue = cellTag.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/)?.[1];
        const rawValue = cellTag.match(/<v>([\s\S]*?)<\/v>/)?.[1] || inlineValue || '';
        const value = type === 's' ? sharedStrings[Number(rawValue)] || '' : decodeXml(rawValue);
        if (index >= 0) row[index] = value;
      }
      return row.map((cell) => cell || '');
    })
    .filter((row) => row.some((cell) => String(cell).trim()));
}

function mapProductsFromCsv(csvText) {
  const [headers, ...rows] = parseCsv(csvText);
  const cleanHeaders = headers.map((header) => header.trim());

  return rows
    .map((row, index) => ({
      rowNumber: index + 2,
      data: Object.fromEntries(cleanHeaders.map((header, cellIndex) => [header, row[cellIndex]?.trim() || ''])),
    }))
    .map(({ rowNumber, data: row }) => {
      const sku = row['ID / артикул'] || row['Артикл'];
      return {
        rowNumber,
        sku,
        name: row['Название'],
        grams: parseNumber(row['Вес (грам)']),
        material: normalizeMaterial(row['Тип пластика']),
        materialRaw: row['Тип пластика'],
        color: row['Цвет'],
        printHours: parsePrintHours(row['Время печати']),
        price: parseNumber(row['Стоимость']),
        printLink: row['Ссылка на печать'] || row['Ссылка'] || row['Файл печати'] || '',
      };
    })
    .filter((product) => product.sku && product.name && product.grams > 0);
}

function getFirstValue(row, keys) {
  return keys.map((key) => row[key]).find((value) => String(value || '').trim()) || '';
}

function parseTableText(text) {
  const cleanText = String(text || '').trim();
  if (!cleanText) return [];
  if (cleanText.includes('\t')) {
    return cleanText
      .split(/\r?\n/)
      .map((line) => line.split('\t').map((cell) => cell.trim()))
      .filter((row) => row.some(Boolean));
  }
  const spacedRows = cleanText
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s{2,}/).map((cell) => cell.trim()))
    .filter((row) => row.some(Boolean));
  const csvRows = cleanText.split(/\r?\n/)[0]?.includes(',') ? parseCsv(cleanText) : [];
  return csvRows[0]?.length > spacedRows[0]?.length ? csvRows : spacedRows;
}

function mapFilamentPurchasesFromRows(tableRows) {
  const [headers = [], ...rows] = tableRows;
  const cleanHeaders = headers.map((header) => header.trim());

  return rows
    .map((row, index) => {
      const data = Object.fromEntries(cleanHeaders.map((header, cellIndex) => [header, row[cellIndex]?.trim() || '']));
      const materialRaw = getFirstValue(data, ['Материал', 'Тип пластика', 'Пластик', 'Филамент', 'Filament']);
      let colorRaw = getFirstValue(data, ['Цвет', 'Color', 'Колір']);
      let gramsRaw = getFirstValue(data, ['Вес', 'Вес (г)', 'Вес, г', 'Вес (грам)', 'Граммы', 'Остаток', 'Количество', 'Грамм']);
      if (parseNumber(colorRaw) > 0 && !parseNumber(gramsRaw)) {
        gramsRaw = colorRaw;
        colorRaw = '';
      }
      const { material, color } = splitFilamentMaterialAndColor(materialRaw, colorRaw);
      const grams = parseNumber(gramsRaw);
      const price = parseNumber(getFirstValue(data, ['Цена', 'Стоимость', 'Цена закупки', 'Сумма', 'Цена, ₽', 'Стоимость, ₽']));
      const date = formatSheetDate(getFirstValue(data, ['Дата', 'Дата закупки', 'Добавлено'])) || 'без даты';
      const supplier = getFirstValue(data, ['Поставщик', 'Магазин', 'Источник', 'Продавец']) || 'не указан';
      const location = getFirstValue(data, ['Место', 'Хранение', 'Локация', 'Склад']) || 'Склад';

      return {
        id: getFirstValue(data, ['ID', 'Артикул', 'Катушка']) || `${material}-${color}-${index}`,
        date,
        material,
        color,
        grams,
        price,
        supplier,
        location: location.toUpperCase().includes('AMS') ? 'AMS' : 'Склад',
      };
    })
    .filter((item) => item.material && item.grams > 0);
}

function mapFilamentPurchasesFromText(text) {
  return mapFilamentPurchasesFromRows(parseTableText(text));
}

function getFilamentPurchasesFromXlsx(buffer) {
  const files = unzipSync(new Uint8Array(buffer));
  const sheetPath = getSheetPathByName(files, ['Склад', 'Остатки', 'Филамент']);
  if (!sheetPath) throw new Error('В таблице не найден лист "Склад"');
  const sheetXml = strFromU8(files[sheetPath] || new Uint8Array());
  const rows = getRowsFromSheetXml(sheetXml, getSharedStrings(files));
  const loaded = mapFilamentPurchasesFromRows(rows);
  if (!loaded.length) throw new Error('В листе "Склад" не найдены катушки филамента');
  return loaded;
}

function getFilamentPurchaseKey(item) {
  return [
    item.date,
    item.material,
    item.color,
    item.grams,
    item.price,
    item.supplier,
  ]
    .join('|')
    .toLowerCase()
    .replace(/\s+/g, '');
}

function mergeUniqueFilamentPurchases(current, incoming) {
  const seen = new Set(current.map(getFilamentPurchaseKey));
  const uniqueIncoming = [];
  let duplicateCount = 0;

  for (const item of incoming) {
    const key = getFilamentPurchaseKey(item);
    if (seen.has(key)) {
      duplicateCount += 1;
    } else {
      seen.add(key);
      uniqueIncoming.push(item);
    }
  }

  return { merged: [...current, ...uniqueIncoming], addedCount: uniqueIncoming.length, duplicateCount };
}

function useFilamentPurchases(sheetUrl, locationsById, productsSheetUrl, refreshKey = 0) {
  const [purchases, setPurchases] = useState(fallbackFilamentPurchases);
  const [status, setStatus] = useState({ state: 'loading', message: 'Загружаем лист "Склад" из таблицы товаров' });

  useEffect(() => {
    let cancelled = false;
    const sourceUrl = sheetUrl.trim() || productsSheetUrl || DEFAULT_PRODUCTS_SHEET_URL;
    const usingProductsSheet = !sheetUrl.trim();
    const productFallbackUrl = productsSheetUrl || DEFAULT_PRODUCTS_SHEET_URL;

    setStatus({
      state: 'loading',
      message: usingProductsSheet ? 'Загружаем лист "Склад" из таблицы товаров' : 'Загружаем таблицу филамента',
    });

    async function loadFromSheet(url) {
      const { csvUrl, xlsxUrl } = getGoogleSheetExportUrls(url);
      const xlsxLoad = xlsxUrl
        ? fetch(xlsxUrl)
        .then(async (response) => {
          if (!response.ok) throw new Error(explainSheetLoadError(response, await response.text()));
          return response.arrayBuffer();
        })
        .then(getFilamentPurchasesFromXlsx)
        : Promise.reject(new Error('XLSX недоступен'));

      return xlsxLoad.catch(() => fetchCsvFromSheet(csvUrl).then(mapFilamentPurchasesFromText));
    }

    loadFromSheet(sourceUrl)
      .catch((error) => {
        if (!usingProductsSheet && productFallbackUrl !== sourceUrl) {
          setStatus({ state: 'loading', message: 'Отдельная таблица не открылась, пробуем лист "Склад" из таблицы товаров' });
          return loadFromSheet(productFallbackUrl);
        }
        throw error;
      })
      .then((loaded) => {
        if (!loaded.length) throw new Error('В таблице не найдены катушки филамента');
        if (!cancelled) {
          setPurchases(loaded.map((item) => ({ ...item, location: locationsById[item.id] || item.location })));
          setStatus({
            state: 'ready',
            message: `${loaded.length} катушек из ${usingProductsSheet ? 'листа "Склад"' : 'таблицы филамента или листа "Склад"'}`,
          });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setPurchases(fallbackFilamentPurchases);
          setStatus({ state: 'error', message: `Не удалось загрузить таблицу: ${error.message}` });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [sheetUrl, locationsById, productsSheetUrl, refreshKey]);

  return { purchases, status };
}

function useProductCatalog(productsSheetUrl) {
  const [products, setProducts] = useState(fallbackProducts);
  const [catalogStatus, setCatalogStatus] = useState({ state: 'loading', message: 'Загружаем Google Sheets' });

  useEffect(() => {
    let cancelled = false;
    const { csvUrl, xlsxUrl } = getGoogleSheetExportUrls(productsSheetUrl);

    setCatalogStatus({ state: 'loading', message: 'Загружаем Google Sheets' });

    fetchCsvFromSheet(csvUrl)
      .then(async (text) => {
        const loadedProducts = mapProductsFromCsv(text);
        const linksByRow = xlsxUrl
          ? await fetch(xlsxUrl)
          .then((response) => {
            if (!response.ok) throw new Error(`XLSX ответил ${response.status}`);
            return response.arrayBuffer();
          })
          .then(getPrintLinksFromXlsx)
            .catch(() => ({}))
          : {};
        const productsWithLinks = loadedProducts.map((product) => ({
          ...product,
          printLink: product.printLink || linksByRow[product.rowNumber] || '',
        }));
        if (!loadedProducts.length) throw new Error('В таблице не найдены строки с артикулами');
        if (!cancelled) {
          setProducts(productsWithLinks);
          setCatalogStatus({ state: 'ready', message: `${productsWithLinks.length} изделий из Google Sheets` });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setCatalogStatus({ state: 'error', message: `Работаем на резервных данных: ${error.message}` });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [productsSheetUrl]);

  return { products, catalogStatus };
}

function getMaterialKgPrice(material) {
  const group = filaments.find((item) => item.material === material);
  const prices = group?.colors.map((item) => item.priceKg).filter(Boolean) || [];
  if (!prices.length) return 1300;
  return Math.round(prices.reduce((sum, price) => sum + price, 0) / prices.length);
}

function buildCatalogMap(products) {
  return new Map(products.map((product) => [product.sku, product]));
}

function getOrderDeductions(order) {
  if (order.adjustments?.length) return order.adjustments;
  return [
    {
      id: 'marketplace-commission',
      label: 'Комиссия площадки',
      amount: order.commission || 0,
      status: 'confirmed',
      source: order.channel,
    },
  ];
}

function buildOrderFinance(order, manufacturing) {
  const deductions = getOrderDeductions(order);
  const rows = [
    { id: 'sale', group: 'Продажа', label: 'Цена продажи покупателю', amount: order.price, direction: 'income', status: 'confirmed', source: order.channel },
    { id: 'plastic', group: 'Себестоимость', label: 'Пластик по модели', amount: manufacturing.plastic, direction: 'expense', status: 'confirmed', source: 'Справочник изделий' },
    { id: 'packing', group: 'Себестоимость', label: 'Упаковка', amount: manufacturing.packingCost, direction: 'expense', status: 'confirmed', source: 'Норматив' },
    ...deductions.map((item) => ({
      ...item,
      group: item.direction === 'income' ? 'Начисления площадки' : 'Списания площадки',
      direction: item.direction || 'expense',
      status: item.status || 'pending',
    })),
  ];
  const confirmedIncome = rows
    .filter((row) => row.direction === 'income' && row.status === 'confirmed')
    .reduce((sum, row) => sum + row.amount, 0);
  const expectedIncome = rows
    .filter((row) => row.direction === 'income')
    .reduce((sum, row) => sum + row.amount, 0);
  const marketplaceExpenses = rows
    .filter((row) => row.group === 'Списания площадки')
    .reduce((sum, row) => sum + row.amount, 0);
  const marketplaceIncome = rows
    .filter((row) => row.group === 'Начисления площадки')
    .reduce((sum, row) => sum + row.amount, 0);
  const ownExpenses = rows
    .filter((row) => row.group === 'Себестоимость')
    .reduce((sum, row) => sum + row.amount, 0);
  const confirmedExpenses = rows
    .filter((row) => row.direction === 'expense' && row.status === 'confirmed')
    .reduce((sum, row) => sum + row.amount, 0);
  const expectedExpenses = rows
    .filter((row) => row.direction === 'expense')
    .reduce((sum, row) => sum + row.amount, 0);
  const pendingExpenses = rows
    .filter((row) => row.direction === 'expense' && row.status !== 'confirmed')
    .reduce((sum, row) => sum + row.amount, 0);
  const marketplaceCalculatedNet = order.price + marketplaceIncome - marketplaceExpenses;
  const marketplaceReportDifference = Number.isFinite(order.marketplaceNet)
    ? Math.round((order.marketplaceNet - marketplaceCalculatedNet) * 100) / 100
    : null;
  const confirmedProfit = confirmedIncome - confirmedExpenses;
  const expectedProfit = expectedIncome - expectedExpenses;

  return {
    rows,
    confirmedIncome,
    expectedIncome,
    marketplaceExpenses,
    marketplaceIncome,
    marketplaceCalculatedNet,
    marketplaceReportDifference,
    ownExpenses,
    confirmedExpenses,
    expectedExpenses,
    pendingExpenses,
    confirmedProfit,
    expectedProfit,
    expectedMargin: order.price > 0 ? Math.round((expectedProfit / order.price) * 100) : 0,
    confirmedMargin: order.price > 0 ? Math.round((confirmedProfit / order.price) * 100) : 0,
  };
}

function getOrderView(order, catalogBySku) {
  const product = catalogBySku.get(order.sku);
  const quantity = order.quantity || 1;
  const grams = Math.round((product?.grams || 0) * quantity);
  const printHours = (product?.printHours || 0) * quantity;
  const price = order.price || (product?.price || 0) * quantity;
  const material = product?.material || 'Не найдено';
  const materialLabel = product ? `${product.material} · ${product.color || 'цвет не указан'}` : 'Артикул не найден';
  const productName = order.marketplaceProductName || product?.name || 'Нет в справочнике изделий';
  const plastic = Math.round((grams / 1000) * getMaterialKgPrice(material));
  const printCost = Math.round(printHours * PRINT_HOUR_COST);
  const packingCost = PACKING_COST;
  const finance = buildOrderFinance({ ...order, price }, { plastic, printCost, packingCost });
  const cost = finance.expectedExpenses;
  const profit = finance.expectedProfit;
  const margin = finance.expectedMargin;

  return {
    ...order,
    product: productName,
    productFound: Boolean(product),
    items: `1 поз. · ${quantity} шт.`,
    material,
    materialLabel,
    grams,
    printHours,
    printTime: printHours ? `${String(printHours).replace('.', ',')} ч` : 'не указано',
    price,
    plastic,
    printCost,
    packingCost,
    cost,
    profit,
    margin,
    finance,
    printLink: product?.printLink || '',
    printerTimeLeft: order.sentToPrint ? getRemainingPrintTime(printHours) : '',
  };
}

function getRemainingPrintTime(printHours) {
  if (!printHours) return 'ожидаем данные принтера';
  const remainingHours = Math.max(printHours * 0.64, 0.1);
  const hours = Math.floor(remainingHours);
  const minutes = Math.round((remainingHours - hours) * 60);
  if (hours <= 0) return `${minutes} мин`;
  return `${hours} ч ${minutes.toString().padStart(2, '0')} мин`;
}

function getProductEconomics(product) {
  const plastic = Math.round((product.grams / 1000) * getMaterialKgPrice(product.material));
  const printCost = Math.round(product.printHours * PRINT_HOUR_COST);
  const cost = plastic + printCost + PACKING_COST;
  const profit = product.price - cost;
  const margin = product.price > 0 ? Math.round((profit / product.price) * 100) : 0;

  return { plastic, printCost, cost, profit, margin };
}

function getMarketplaceEconomics(product, baseCost) {
  return MARKETPLACE_FEES.map((marketplace) => {
    const fee = Math.round((product.price * marketplace.percent) / 100);
    const profit = product.price - baseCost - fee;
    const margin = product.price > 0 ? Math.round((profit / product.price) * 100) : 0;

    return { ...marketplace, fee, profit, margin };
  });
}

function getColorHex(color) {
  const value = String(color || '').toLowerCase();
  if (value.includes('черн')) return '#171717';
  if (value.includes('бел')) return '#f4f2ed';
  if (value.includes('крас')) return '#c9272d';
  if (value.includes('беж')) return '#d8c4a8';
  if (value.includes('прозрач') || value.includes('transparent')) return '#dce7ee';
  if (value.includes('виш') || value.includes('малин')) return '#8f2445';
  if (value.includes('роз')) return '#e8a2bb';
  if (value.includes('фиолет') || value.includes('сирен')) return '#8b78d6';
  if (value.includes('желт')) return '#f1c84b';
  if (value.includes('зелен')) return '#4e8a5b';
  if (value.includes('mint') || value.includes('мят')) return '#9dd9b4';
  if (value.includes('ocean') || value.includes('син')) return '#5c8db8';
  if (value.includes('gradient') || value.includes('градиент')) return '#8b78d6';
  return '#b7aea5';
}

function buildFilamentStock(purchases, orders) {
  const reservedByKey = orders
    .filter((order) => order.status !== 'Доставлен')
    .reduce((summary, order) => {
      if (!order.material || !order.productFound) return summary;
      const color = order.materialLabel.split('·')[1]?.trim() || 'цвет не указан';
      const key = `${order.material}|${color}`.toLowerCase();
      summary[key] = (summary[key] || 0) + order.grams;
      return summary;
    }, {});

  const grouped = purchases.reduce((summary, item) => {
    const material = normalizeMaterial(item.material);
    const key = `${material}|${item.color}`.toLowerCase();
      if (!summary[key]) {
        summary[key] = {
          material,
          baseMaterial: material,
          color: item.color,
          hex: getColorHex(item.color),
          current: 0,
          reserve: reservedByKey[`${material}|${item.color}`.toLowerCase()] || 0,
          totalCost: 0,
          locations: new Set(),
          dates: new Set(),
        };
      }
      summary[key].current += item.grams;
      summary[key].totalCost += item.price || 0;
      summary[key].locations.add(item.location || 'Склад');
      summary[key].dates.add(item.date);
      return summary;
    }, {});

  return Object.values(grouped)
    .map((item) => ({
      ...item,
      group: Array.from(item.locations).join(', '),
      dates: Array.from(item.dates).join(', '),
      priceKg: item.current ? Math.round((item.totalCost / item.current) * 1000) : 0,
    }))
    .sort((a, b) => `${a.material}${a.color}`.localeCompare(`${b.material}${b.color}`, 'ru'));
}

function groupFilamentStock(stock) {
  return stock.reduce((groups, item) => {
    const group = groups.find((entry) => entry.material === item.material);
    if (group) {
      group.colors.push(item);
    } else {
      groups.push({ material: item.material, colors: [item] });
    }
    return groups;
  }, []);
}

function getMarketplaceChannel(marketplace) {
  if (marketplace === 'ozon') return 'Ozon';
  if (marketplace === 'wildberries') return 'Wildberries';
  if (marketplace === 'yandex') return 'Яндекс';
  return '';
}

function mergeSyncedOrders(currentOrders, syncResults) {
  const syncedChannels = syncResults
    .filter((result) => result.ok)
    .map((result) => getMarketplaceChannel(result.marketplace))
    .filter(Boolean);
  const incomingOrders = syncResults.flatMap((result) => (result.ok ? result.orders || [] : []));
  const baseOrders = syncedChannels.length
    ? currentOrders.filter((order) => !syncedChannels.includes(order.channel))
    : currentOrders;
  const byId = new Map(baseOrders.map((order) => [order.id, order]));

  incomingOrders.forEach((order) => {
    const existing = byId.get(order.id) || {};
    byId.set(order.id, {
      ...existing,
      ...order,
      dates: {
        ...(existing.dates || {}),
        ...(order.dates || {}),
      },
      adjustments: order.adjustments || existing.adjustments || [],
    });
  });

  return Array.from(byId.values());
}

function App() {
  const [page, setPage] = useState('dashboard');
  const [orders, setOrders] = useState([]);
  const [query, setQuery] = useState('');
  const [productFilter, setProductFilter] = useState('Все товары');
  const [dateMode, setDateMode] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [statusFilter, setStatusFilter] = useState('Все статусы');
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [expandedFinance, setExpandedFinance] = useState(false);
  const [filamentRefreshKey, setFilamentRefreshKey] = useState(0);
  const [productsSheetUrl, setProductsSheetUrl] = useState(getStoredProductsSheetUrl);
  const [printerIntegration, setPrinterIntegration] = useState(getStoredPrinterIntegration);
  const [filamentLocations, setFilamentLocations] = useState(getStoredFilamentLocations);
  const [cabinetSyncStatus, setCabinetSyncStatus] = useState({ state: 'idle', message: '' });
  const [syncingCabinets, setSyncingCabinets] = useState(false);
  const { products, catalogStatus } = useProductCatalog(productsSheetUrl);
  const catalogBySku = useMemo(() => buildCatalogMap(products), [products]);
  const orderViews = useMemo(() => orders.map((order) => getOrderView(order, catalogBySku)), [orders, catalogBySku]);
  const { purchases: filamentPurchases, status: filamentStatus } = useFilamentPurchases('', filamentLocations, productsSheetUrl, filamentRefreshKey);
  const filamentStock = useMemo(() => buildFilamentStock(filamentPurchases, orderViews), [filamentPurchases, orderViews]);

  const selectedOrder = selectedOrderId ? orderViews.find((order) => order.id === selectedOrderId) : null;
  const productOptions = useMemo(() => getUniqueOptions(orderViews.map((order) => order.product)), [orderViews]);
  const filteredOrders = orderViews.filter((order) => {
    const text = `${order.id} ${order.sku} ${order.product} ${order.channel}`.toLowerCase();
    const productMatch = productFilter === 'Все товары' || order.product === productFilter;
    const dateMatch = matchesOrderDate(order, dateMode, dateFrom, dateTo);
    const statusMatch = statusFilter === 'Все статусы' || order.status === statusFilter;
    return text.includes(query.toLowerCase()) && productMatch && dateMatch && statusMatch;
  });

  const stats = useMemo(() => {
    const totalFilament = filamentStock.reduce((sum, item) => sum + item.current, 0);
    const revenue = orderViews.reduce((sum, order) => sum + order.price, 0);
    const profit = orderViews.reduce((sum, order) => sum + order.profit, 0);
    const activeOrders = orderViews.filter((order) => order.status !== 'Доставлен').length;
    return { totalFilament, revenue, profit, activeOrders, completedOrders: COMPLETED_ORDERS_TOTAL };
  }, [orderViews, filamentStock]);

  function resetOrderFilters() {
    setQuery('');
    setProductFilter('Все товары');
    setDateMode('all');
    setDateFrom('');
    setDateTo('');
    setStatusFilter('Все статусы');
  }

  async function syncConnectedCabinets() {
    const integrations = getStoredMarketplaceIntegrations();
    const connected = Object.entries(integrations).filter(([marketplace, settings]) => isMarketplaceReady(marketplace, settings));
    const connectedButIncomplete = Object.entries(integrations)
      .filter(([, settings]) => settings?.connected)
      .filter(([marketplace, settings]) => !isMarketplaceReady(marketplace, settings));

    if (!connected.length) {
      const missingMessage = connectedButIncomplete
        .map(([marketplace, settings]) => `${getMarketplaceChannel(marketplace) || marketplace}: не заполнено ${getMissingMarketplaceFields(marketplace, settings).join(', ')}`)
        .join(' · ');
      setCabinetSyncStatus({
        state: 'error',
        message: missingMessage || 'Сначала подключите хотя бы один кабинет в интеграциях.',
      });
      return;
    }

    setSyncingCabinets(true);
    setCabinetSyncStatus({ state: 'loading', message: 'Проверяю подключенные кабинеты...' });

    const results = await Promise.all(
      connected.map(async ([marketplace, settings]) => {
        try {
          const response = await fetch('/api/marketplace-sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ marketplace, settings }),
          });
          const result = await response.json().catch(() => ({}));
          return { marketplace, ok: response.ok && result.ok !== false, message: result.message || 'нет ответа', orders: result.orders || [] };
        } catch (error) {
          return { marketplace, ok: false, message: error?.message || 'локальный тоннель не отвечает', orders: [] };
        }
      }),
    );

    const importedOrders = results.flatMap((result) => (result.ok ? result.orders || [] : []));
    const syncedChannels = results
      .filter((result) => result.ok)
      .map((result) => getMarketplaceChannel(result.marketplace))
      .filter(Boolean);
    if (syncedChannels.length) {
      setOrders((currentOrders) => mergeSyncedOrders(currentOrders, results));
      setSelectedOrderId((currentSelectedId) => {
        if (!currentSelectedId) return currentSelectedId;
        const willStillExist = results
          .flatMap((result) => (result.ok ? result.orders || [] : []))
          .some((order) => order.id === currentSelectedId);
        const selectedOrder = orders.find((order) => order.id === currentSelectedId);
        return selectedOrder && syncedChannels.includes(selectedOrder.channel) && !willStillExist ? null : currentSelectedId;
      });
    }

    const nextIntegrations = results.reduce((next, result) => {
      const current = integrations[result.marketplace] || {};
      return {
        ...next,
        [result.marketplace]: {
          ...current,
          lastSync: result.ok ? new Date().toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : current.lastSync || '',
          lastResult: result.message,
          syncError: !result.ok,
        },
      };
    }, integrations);
    localStorage.setItem(MARKETPLACE_INTEGRATIONS_STORAGE_KEY, JSON.stringify(nextIntegrations));

    const failed = results.filter((result) => !result.ok);
    setCabinetSyncStatus({
      state: failed.length ? 'error' : 'ready',
      message: `${results.map((result) => result.message).join(' · ')} · Обновлены площадки: ${syncedChannels.join(', ') || 'нет'}${importedOrders.length ? ` · Из кабинетов загружено: ${importedOrders.length}` : ' · Кабинеты не вернули заказов'}`,
    });
    setSyncingCabinets(false);
  }

  return (
    <main className="app-shell">
      <Sidebar page={page} setPage={setPage} />
      <section className="workspace">
        <Header page={page} />
        {page === 'dashboard' && (
          <Dashboard
            stats={stats}
            orders={orderViews}
            catalogStatus={catalogStatus}
            filamentStock={filamentStock}
            filamentStatus={filamentStatus}
            setPage={setPage}
            setSelectedOrderId={setSelectedOrderId}
            setExpandedFinance={setExpandedFinance}
            resetOrderFilters={resetOrderFilters}
          />
        )}
        {page === 'filament' && (
          <Filament
            filamentStock={filamentStock}
            filamentStatus={filamentStatus}
            onRefresh={() => setFilamentRefreshKey((key) => key + 1)}
          />
        )}
        {page === 'usage' && <MaterialUsage />}
        {page === 'orders' && (
          <Orders
            orders={orders}
            setOrders={setOrders}
            filteredOrders={filteredOrders}
            query={query}
            setQuery={setQuery}
            productFilter={productFilter}
            setProductFilter={setProductFilter}
            productOptions={productOptions}
            dateMode={dateMode}
            setDateMode={setDateMode}
            dateFrom={dateFrom}
            setDateFrom={setDateFrom}
            dateTo={dateTo}
            setDateTo={setDateTo}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            selectedOrder={selectedOrder}
            setSelectedOrderId={setSelectedOrderId}
            expandedFinance={expandedFinance}
            setExpandedFinance={setExpandedFinance}
            onSyncCabinets={syncConnectedCabinets}
            syncingCabinets={syncingCabinets}
            cabinetSyncStatus={cabinetSyncStatus}
          />
        )}
        {page === 'replenish' && (
          <Replenish
            purchases={filamentPurchases}
            status={filamentStatus}
            locationsById={filamentLocations}
            setLocationsById={setFilamentLocations}
          />
        )}
        {page === 'products' && <Products products={products} catalogStatus={catalogStatus} />}
        {page === 'integrations' && (
          <Integrations
            productsSheetUrl={productsSheetUrl}
            setProductsSheetUrl={setProductsSheetUrl}
            catalogStatus={catalogStatus}
            printerIntegration={printerIntegration}
            setPrinterIntegration={setPrinterIntegration}
            setOrders={setOrders}
          />
        )}
      </section>
    </main>
  );
}

function Sidebar({ page, setPage }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">F</div>
        <div>
          <strong>САТОРИ</strong>
          <span>креативная студия 3D-печати</span>
        </div>
      </div>
      <nav>
        {navigation.map(({ id, label, icon: Icon }) => (
          <button className={page === id ? 'nav-item active' : 'nav-item'} key={id} onClick={() => setPage(id)}>
            <Icon size={18} />
            {label}
          </button>
        ))}
      </nav>
    </aside>
  );
}

function Header({ page }) {
  const title = navigation.find((item) => item.id === page)?.label || 'Дашборд';
  const eyebrow = page === 'orders' ? 'Ozon и Яндекс' : page === 'dashboard' ? 'Сегодня' : 'Учет печати';
  const showActions = page !== 'filament';
  return (
    <header className="page-header">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
      </div>
      {showActions && (
        <div className="header-actions">
          <button className="button ghost">Пример</button>
          <button className="button primary">
            <Download size={17} />
            Экспорт
          </button>
          <button className="button primary">
            <Upload size={17} />
            Импорт
          </button>
        </div>
      )}
    </header>
  );
}

function Dashboard({ stats, orders, catalogStatus, filamentStock, filamentStatus, setPage, setSelectedOrderId, setExpandedFinance, resetOrderFilters }) {
  const activeOrders = orders
    .filter((order) => order.status !== 'Доставлен')
    .sort((first, second) => getStatusRank(first.status) - getStatusRank(second.status));
  const writeOffs = getTodayWriteOffs(orders);

  function openOrderFinance(orderId) {
    resetOrderFilters();
    setSelectedOrderId(orderId);
    setExpandedFinance(true);
    setPage('orders');
  }

  function openActiveOrder(orderId) {
    resetOrderFilters();
    setSelectedOrderId(orderId);
    setExpandedFinance(false);
    setPage('orders');
  }

  return (
    <div className="grid dashboard-grid">
      <section className="panel wide dashboard-priority">
        <div className="panel-title">
          <div>
            <h2>Активные заказы</h2>
            <p>Статус, сумма и крайняя дата отгрузки.</p>
          </div>
          <button className="button ghost" onClick={() => setPage('orders')}>Открыть</button>
        </div>
        <div className="dashboard-orders">
          {activeOrders.map((order) => (
            <DashboardOrderRow order={order} key={order.id} onOpen={openActiveOrder} />
          ))}
          {!activeOrders.length && <div className="empty-history">Активных заказов сейчас нет.</div>}
        </div>
      </section>
      <Metric className="dark" label="Активные заказы" value={stats.activeOrders} />
      <Metric label="Выполнено за все время" value={stats.completedOrders.toLocaleString('ru-RU')} />
      <Metric label="Филамент на складе" value={`${(stats.totalFilament / 1000).toFixed(2).replace('.', ',')} кг`} />
      <Metric label="Начислено сегодня" value={`${stats.revenue.toLocaleString('ru-RU')} ₽`} />
      <Metric label="Ожидаемая прибыль" value={`${stats.profit.toLocaleString('ru-RU')} ₽`} accent />
      <section className="panel wide dashboard-writeoffs">
        <div className="panel-title">
          <div>
            <h2>Списания сегодня</h2>
            <p>Подтвержденные списания площадок с привязкой к заказу.</p>
          </div>
        </div>
        <div className="writeoff-list">
          {writeOffs.map((item) => (
            <article className="writeoff-row" key={`${item.orderId}-${item.id}`}>
              <div>
                <strong>{item.label}</strong>
                <span>{item.channel} · заказ {item.orderId} · {item.product}</span>
              </div>
              <Field label="Сумма" value={`-${item.amount.toLocaleString('ru-RU')} ₽`} />
              <Field label="Источник" value={item.source} />
              <button className="button ghost" type="button" onClick={() => openOrderFinance(item.orderId)}>
                Перейти в заказ
              </button>
            </article>
          ))}
          {!writeOffs.length && <div className="empty-history">Подтвержденных списаний за сегодня пока нет.</div>}
        </div>
      </section>
      <section className="panel wide">
        <div className="panel-title">
          <div>
            <h2>Остатки филамента</h2>
            <p>Берется из листа «Склад» в таблице товаров. После подключения принтера остатки будут уменьшаться по истории печати.</p>
          </div>
          <button className="button ghost" onClick={() => setPage('filament')}>Открыть склад</button>
        </div>
        <div className={`catalog-status ${filamentStatus.state}`}>
          {filamentStatus.message}
        </div>
        <div className="dashboard-filament-list">
          {filamentStock.map((item) => {
            const free = Math.max(item.current - item.reserve, 0);
            const percent = Math.min(Math.round((item.current / 1000) * 100), 100);
            return (
              <article className="dashboard-filament-row" key={`${item.material}-${item.color}`}>
                <div className="filament-label">
                  <i style={{ background: item.hex }} />
                  <div>
                    <strong>{item.material} · {item.color}</strong>
                    <span>{item.group} · {item.priceKg || '—'} ₽ за кг</span>
                  </div>
                </div>
                <div className="filament-bar">
                  <b style={{ width: `${percent}%` }} />
                </div>
                <Field label="Сейчас" value={`${item.current} г`} />
                <Field label="Резерв" value={`${item.reserve} г`} />
                <Field label="Свободно" value={`${free} г`} />
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function getStatusProgress(status) {
  const steps = ['Новый', 'Отправлена на печать', 'В печати', 'Упакован', 'Отгружен', 'Доставляется', 'Доставлен в ПВЗ', 'Доставлен'];
  const index = Math.max(steps.indexOf(status), 0);
  return Math.round((index / (steps.length - 1)) * 100);
}

function getStatusRank(status) {
  const steps = ['Новый', 'Отправлена на печать', 'В печати', 'Упакован', 'Отгружен', 'Доставляется', 'Доставлен в ПВЗ', 'Доставлен'];
  const index = steps.indexOf(status);
  return index === -1 ? steps.length : index;
}

function getUniqueOptions(values) {
  return [...new Set(values.filter(Boolean))];
}

function getOrderDateLabels(order) {
  const dates = order.dates || {};
  return [order.due, dates.received, dates.shipped, dates.pvzDelivered, dates.pickedUp]
    .filter(Boolean)
    .map((date) => String(date).split(',')[0].trim());
}

function parseRuDate(value) {
  const text = String(value || '').split(',')[0].trim().toLowerCase();
  const match = text.match(/(\d{1,2})\s+([а-яё]+)/);
  if (!match) return '';
  const months = {
    янв: 0,
    фев: 1,
    мар: 2,
    апр: 3,
    мая: 4,
    май: 4,
    июн: 5,
    июл: 6,
    авг: 7,
    сен: 8,
    окт: 9,
    ноя: 10,
    дек: 11,
  };
  const monthKey = Object.keys(months).find((key) => match[2].startsWith(key));
  if (!monthKey) return '';
  const year = new Date().getFullYear();
  const month = String(months[monthKey] + 1).padStart(2, '0');
  const day = String(Number(match[1])).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getOrderIsoDates(order) {
  return getOrderDateLabels(order).map(parseRuDate).filter(Boolean);
}

function matchesOrderDate(order, mode, from, to) {
  if (mode === 'all') return true;
  const dates = getOrderIsoDates(order);
  if (mode === 'day') return !from || dates.includes(from);
  if (mode === 'period') {
    return dates.some((date) => (!from || date >= from) && (!to || date <= to));
  }
  return true;
}

function getTodayWriteOffs(orders) {
  return orders.flatMap((order) =>
    order.finance.rows
      .filter((row) => row.group === 'Списания площадки' && row.status === 'confirmed' && row.amount > 0)
      .map((row) => ({
        ...row,
        orderId: order.id,
        channel: order.channel,
        product: order.product,
      })),
  );
}

function DashboardOrderRow({ order, onOpen }) {
  const progress = getStatusProgress(order.status);
  const isNew = order.status === 'Новый';

  return (
    <article className="dashboard-order-row" onClick={() => onOpen(order.id)}>
      <div className="dashboard-order-main">
        <strong>{order.id}</strong>
        <span>{order.channel} · {order.product}</span>
      </div>
      <Field label="Продажа" value={`${order.price.toLocaleString('ru-RU')} ₽`} />
      <Field label="Отгрузить" value={order.due} />
      <div className={isNew ? 'status-scale status-scale-new' : 'status-scale'}>
        <div>
          <span>{order.status}</span>
          <b>{progress}%</b>
        </div>
        <i><em style={{ width: `${progress}%` }} /></i>
      </div>
    </article>
  );
}

function Metric({ label, value, className = '', accent = false }) {
  return (
    <article className={`metric ${className}`}>
      <span>{label}</span>
      <strong className={accent ? 'accent' : ''}>{value}</strong>
    </article>
  );
}

function Filament({ filamentStock, filamentStatus, onRefresh }) {
  const filamentGroups = groupFilamentStock(filamentStock);
  const isLoading = filamentStatus.state === 'loading';

  return (
    <div className="stack">
      <div className="toolbar">
        <div className={`catalog-status ${filamentStatus.state}`}>
          {filamentStatus.message}
        </div>
        <button className="button ghost compact-button" type="button" onClick={onRefresh} disabled={isLoading}>
          Обновить склад
        </button>
      </div>
      {filamentGroups.map((group) => {
        const total = group.colors.reduce((sum, item) => sum + item.current, 0);
        const reserve = group.colors.reduce((sum, item) => sum + item.reserve, 0);
        const lowCount = group.colors.filter((item) => Math.max(item.current - item.reserve, 0) <= 200).length;
        return (
          <section className="filament-group" key={group.material}>
            <div className="group-head">
              <h2>{group.material}</h2>
              <p>{group.colors.length} цветов · всего {total} г · резерв {reserve} г</p>
              <span>{Math.max(total - reserve, 0)} г после заказов</span>
              {lowCount > 0 && <span className="stock-alert">{lowCount} цвет заканчивается</span>}
            </div>
            <div className="filament-list">
              {group.colors.map((item) => {
                const free = Math.max(item.current - item.reserve, 0);
                const isLow = free <= 200;
                return (
                  <article className={isLow ? 'filament-card low-stock' : 'filament-card'} key={item.color}>
                    <div className="filament-card-title">
                      <i style={{ background: item.hex }} />
                      <div>
                        <h3>{item.color}</h3>
                        <p>{item.material}</p>
                        {isLow && <span>заканчивается</span>}
                      </div>
                    </div>
                    <div className="filament-compact-bar">
                      <b style={{ width: `${Math.min(Math.round((item.current / 1000) * 100), 100)}%` }} />
                    </div>
                    <div className="filament-compact-numbers">
                      <Field label="Свободно" value={`${free} г`} />
                      <Field label="Сейчас" value={`${item.current} г`} />
                      <Field label="Резерв" value={`${item.reserve} г`} />
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function MaterialUsage() {
  const totals = materialUsage.reduce((summary, item) => {
    const key = `${item.material} · ${item.color}`;
    summary[key] = (summary[key] || 0) + item.grams;
    return summary;
  }, {});

  return (
    <div className="stack">
      <section className="panel printer-status">
        <div>
          <span className="eyebrow">Принтер</span>
          <h2>{printerStatus.name}</h2>
          <p>{printerStatus.job}</p>
        </div>
        <div className="printer-progress">
          <strong>{printerStatus.progress}%</strong>
          <span>{printerStatus.state} · осталось {printerStatus.timeLeft}</span>
          <div className="progress-bar">
            <i style={{ width: `${printerStatus.progress}%` }} />
          </div>
        </div>
        <div className="printer-material">
          <Field label="Пластик" value={`${printerStatus.material} · ${printerStatus.color}`} />
          <Field label="Уже израсходовано" value={`${printerStatus.usedGrams} г`} />
          <Field label="План по модели" value={`${printerStatus.estimatedGrams} г`} />
        </div>
      </section>

      <section className="panel">
        <h2>Расход по материалам</h2>
        <p>Фактические списания из истории печати: заказы, личные печати, тесты и брак.</p>
        <div className="usage-summary">
          {Object.entries(totals).map(([label, grams]) => (
            <Metric label={label} value={`${grams} г`} key={label} />
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>История печати</h2>
        <p>Эта лента должна стать источником расчета остатков пластика вместо ручного списания.</p>
        <div className="usage-list">
          {materialUsage.map((item) => (
            <article className="usage-row" key={item.id}>
              <div>
                <strong>{item.name}</strong>
                <span>{item.date} · {item.source} · {item.sku}</span>
              </div>
              <Field label="Пластик" value={`${item.material} · ${item.color}`} />
              <Field label="Расход" value={`${item.grams} г`} />
              <b>{item.status}</b>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function Orders(props) {
  const {
    orders,
    setOrders,
    filteredOrders,
    query,
    setQuery,
    productFilter,
    setProductFilter,
    productOptions,
    dateMode,
    setDateMode,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    statusFilter,
    setStatusFilter,
    selectedOrder,
    setSelectedOrderId,
    expandedFinance,
    setExpandedFinance,
    onSyncCabinets,
    syncingCabinets,
    cabinetSyncStatus,
  } = props;
  const activeOrders = filteredOrders.filter((order) => PRINT_QUEUE_STATUSES.includes(order.status));
  const packedOrders = filteredOrders.filter((order) => order.status === 'Упакован');
  const marketplaceShippingOrders = filteredOrders.filter((order) => MARKETPLACE_SHIPPING_STATUSES.includes(order.status));
  const deliveredOrders = filteredOrders.filter((order) => order.status === 'Доставлен');

  function updateStatus(id, status) {
    setOrders(orders.map((order) => (order.id === id ? { ...order, status, dates: getUpdatedOrderDates(order, status) } : order)));
  }

  function sendToPrint(order) {
    setOrders(
      orders.map((item) =>
        item.id === order.id ? { ...item, status: 'Отправлена на печать', sentToPrint: true } : item,
      ),
    );

    if (order.printLink) {
      window.open(order.printLink, '_blank', 'noopener,noreferrer');
    }
  }

  function selectOrder(orderId, finance = false) {
    if (selectedOrder?.id === orderId && expandedFinance === finance) {
      setSelectedOrderId(null);
      setExpandedFinance(false);
      return;
    }
    setSelectedOrderId(orderId);
    setExpandedFinance(finance);
  }

  function renderSelectedOrderDetail(order) {
    if (selectedOrder?.id !== order.id) return null;
    return (
      <OrderDetail
        order={selectedOrder}
        updateStatus={updateStatus}
        sendToPrint={sendToPrint}
        expandedFinance={expandedFinance}
        setExpandedFinance={setExpandedFinance}
      />
    );
  }

  return (
    <div className="orders-page">
      <section className="filters">
        <label className="search-field">
          <Search size={18} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по заказу или SKU" />
        </label>
        <select value={productFilter} onChange={(event) => setProductFilter(event.target.value)}>
          <option>Все товары</option>
          {productOptions.map((product) => (
            <option key={product}>{product}</option>
          ))}
        </select>
        <div className="date-filter">
          <select value={dateMode} onChange={(event) => setDateMode(event.target.value)}>
            <option value="all">Все даты</option>
            <option value="day">Один день</option>
            <option value="period">Период</option>
          </select>
          {dateMode === 'day' && (
            <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} aria-label="Дата заказа" />
          )}
          {dateMode === 'period' && (
            <>
              <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} aria-label="Дата от" />
              <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} aria-label="Дата до" />
            </>
          )}
        </div>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option>Все статусы</option>
          {[...ORDER_STATUSES, ...MARKETPLACE_ORDER_STATUSES].map((status) => (
            <option key={status}>{status}</option>
          ))}
        </select>
        <button className="button ghost" type="button" onClick={onSyncCabinets} disabled={syncingCabinets}>
          <RefreshCcw size={17} />
          {syncingCabinets ? 'Обновляю...' : 'Обновить из кабинетов'}
        </button>
      </section>
      {cabinetSyncStatus.message && (
        <div className={`catalog-status ${cabinetSyncStatus.state}`}>
          {cabinetSyncStatus.message}
        </div>
      )}
      <section className="panel">
        <h2>Очередь заказов</h2>
        <p>Рабочий список: что заказали, где продано, сколько стоит и когда нужно отгрузить.</p>
        <div className="orders-table">
          <div className="orders-table-head">
            <span>Товар</span>
            <span>Площадка</span>
            <span>Продажа</span>
            <span>Отгрузка</span>
          </div>
          {activeOrders.map((order) => (
            <React.Fragment key={order.id}>
              <OrderQueueRow
                order={order}
                updateStatus={updateStatus}
                sendToPrint={sendToPrint}
                selectOrder={selectOrder}
                isSelected={selectedOrder?.id === order.id}
              />
              {renderSelectedOrderDetail(order)}
            </React.Fragment>
          ))}
        </div>
      </section>
      <section className="panel">
        <h2>Упаковано</h2>
        <p>Ручной статус: заказ напечатан, собран и ждет отгрузки в кабинет площадки.</p>
        <div className="orders-table shipping-table">
          <div className="orders-table-head shipping-head">
            <span>Товар</span>
            <span>Площадка</span>
            <span>Статус</span>
            <span>Отгрузить до</span>
          </div>
          {packedOrders.length ? (
            packedOrders.map((order) => (
              <React.Fragment key={order.id}>
                <ShippingRow
                  order={order}
                  updateStatus={updateStatus}
                  selectOrder={selectOrder}
                  mode="manual"
                />
                {renderSelectedOrderDetail(order)}
              </React.Fragment>
            ))
          ) : (
            <div className="empty-history">Упакованных заказов пока нет.</div>
          )}
        </div>
      </section>
      <section className="panel">
        <h2>Отгружено и доставка</h2>
        <p>Текущий статус из кабинетов Ozon, Яндекс и WB. Когда заказ получен, он уходит в историю.</p>
        <div className="orders-table shipping-table">
          <div className="orders-table-head shipping-head">
            <span>Товар</span>
            <span>Площадка</span>
            <span>Статус площадки</span>
            <span>Продажа</span>
          </div>
          {marketplaceShippingOrders.length ? (
            marketplaceShippingOrders.map((order) => (
              <React.Fragment key={order.id}>
                <ShippingRow
                  order={order}
                  updateStatus={updateStatus}
                  selectOrder={selectOrder}
                  mode="marketplace"
                />
                {renderSelectedOrderDetail(order)}
              </React.Fragment>
            ))
          ) : (
            <div className="empty-history">Отгруженных заказов из кабинетов пока нет.</div>
          )}
        </div>
      </section>
      <section className="panel">
        <h2>История заказов</h2>
        <p>Полученные клиентом заказы с полной цепочкой дат из кабинетов площадок.</p>
        <div className="orders-table history-table">
          {deliveredOrders.length ? (
            deliveredOrders.map((order) => (
              <React.Fragment key={order.id}>
                <HistoryRow
                  order={order}
                  selectOrder={selectOrder}
                />
                {renderSelectedOrderDetail(order)}
              </React.Fragment>
            ))
          ) : (
            <div className="empty-history">Полученных заказов пока нет. После синхронизации кабинетов они будут появляться здесь.</div>
          )}
        </div>
      </section>
    </div>
  );
}

function getUpdatedOrderDates(order, status) {
  const dates = order.dates || {};
  const now = new Date().toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).replace('.', '');
  return {
    ...dates,
    shipped: ['Отгружен', 'Доставляется', 'Доставлен в ПВЗ', 'Доставлен'].includes(status) && !dates.shipped ? now : dates.shipped,
    pvzDelivered: ['Доставлен в ПВЗ', 'Доставлен'].includes(status) && !dates.pvzDelivered ? now : dates.pvzDelivered,
    pickedUp: status === 'Доставлен' && !dates.pickedUp ? now : dates.pickedUp,
  };
}

function OrderQueueRow({ order, updateStatus, sendToPrint, selectOrder, isSelected = false, isHistory = false }) {
  return (
    <article className={`${isHistory ? 'order-row history' : 'order-row'}${isSelected ? ' selected' : ''}`} onClick={() => selectOrder(order.id)}>
      <div>
        <strong>{order.product}</strong>
        <span>{order.sku} · {order.items} · {order.materialLabel}</span>
      </div>
      <div>
        <b>{order.channel}</b>
        <span>{order.source}</span>
      </div>
      <strong>{order.price.toLocaleString('ru-RU')} ₽</strong>
      <strong>{order.due}</strong>
      <div>
        <select
          value={order.status}
          onChange={(event) => updateStatus(order.id, event.target.value)}
          onClick={(event) => event.stopPropagation()}
        >
          {ORDER_STATUSES.map((status) => (
            <option key={status}>{status}</option>
          ))}
          <optgroup label="Из кабинета площадки">
            {MARKETPLACE_ORDER_STATUSES.map((status) => (
              <option key={status}>{status}</option>
            ))}
          </optgroup>
        </select>
        {MARKETPLACE_ORDER_STATUSES.includes(order.status) && <span>обновлено из кабинета</span>}
        {order.sentToPrint && <span>осталось {order.printerTimeLeft}</span>}
      </div>
      <button
        className="button primary print-order-button"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          sendToPrint(order);
        }}
        disabled={!order.printLink || isHistory}
      >
        Печать
      </button>
    </article>
  );
}

function ShippingRow({ order, updateStatus, selectOrder, mode = 'manual' }) {
  const options = mode === 'manual' ? ['Упакован', ...MARKETPLACE_SHIPPING_STATUSES] : [...MARKETPLACE_SHIPPING_STATUSES, 'Доставлен'];

  return (
    <article className="shipping-row" onClick={() => selectOrder(order.id)}>
      <div>
        <strong>{order.product}</strong>
        <span>{order.channel} · {order.id} · {order.sku}</span>
      </div>
      <Field label="Площадка" value={order.channel} sub={order.source} />
      <select
        value={order.status}
        onChange={(event) => updateStatus(order.id, event.target.value)}
        onClick={(event) => event.stopPropagation()}
      >
        {options.map((status) => (
          <option key={status}>{status}</option>
        ))}
      </select>
      <Field label={mode === 'manual' ? 'Отгрузить до' : 'Продажа'} value={mode === 'manual' ? order.due : `${order.price.toLocaleString('ru-RU')} ₽`} />
    </article>
  );
}

function HistoryRow({ order, selectOrder }) {
  const dates = order.dates || {};

  return (
    <article className="history-row" onClick={() => selectOrder(order.id, true)}>
      <div>
        <strong>{order.product}</strong>
        <span>{order.channel} · {order.id} · {order.sku}</span>
      </div>
      <Field label="Получен" value={dates.received || '—'} />
      <Field label="Отгружен" value={dates.shipped || '—'} />
      <Field label="Доставлен в ПВЗ" value={dates.pvzDelivered || '—'} />
      <Field label="Клиент забрал" value={dates.pickedUp || '—'} />
    </article>
  );
}

function Field({ label, value, sub }) {
  return (
    <div className="field">
      <span>{label}</span>
      <strong>{value}</strong>
      {sub && <small>{sub}</small>}
    </div>
  );
}

function formatCurrency(amount) {
  return Number(amount || 0).toLocaleString('ru-RU', {
    minimumFractionDigits: Number(amount) % 1 ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

function Money({ amount, direction = 'expense' }) {
  const sign = direction === 'income' ? '+' : amount > 0 ? '-' : '';
  return <strong className={direction === 'income' ? 'money-income' : 'money-expense'}>{sign}{formatCurrency(amount)} ₽</strong>;
}

function OrderDetail({ order, updateStatus, sendToPrint, expandedFinance, setExpandedFinance }) {
  const finance = order.finance;
  const canPrint = order.printLink && order.status === 'Новый';
  const showPrintAction = order.status === 'Новый';

  return (
    <aside className="detail-panel">
      <div className="detail-head">
        <div>
          <span className="eyebrow">{order.channel}</span>
          <h2>{order.id}</h2>
          <p>{order.source}{order.marketplaceStatus ? ` · статус кабинета: ${order.marketplaceStatus}` : ' · ручной ввод'}</p>
        </div>
        <span className="status-pill">{order.status}</span>
      </div>
      <div className="order-summary-card">
        <Field label="Площадка" value={order.channel} sub={order.source} />
        <Field label="Продажа" value={`${order.price.toLocaleString('ru-RU')} ₽`} />
        <Field label="Отгрузить до" value={order.due} />
        <label className="status-control">
          <span>Статус</span>
          <select value={order.status} onChange={(event) => updateStatus(order.id, event.target.value)}>
            {ORDER_STATUSES.map((status) => (
              <option key={status}>{status}</option>
            ))}
            <optgroup label="Из кабинета площадки">
              {MARKETPLACE_ORDER_STATUSES.map((status) => (
                <option key={status}>{status}</option>
              ))}
            </optgroup>
          </select>
        </label>
        <div className="detail-actions">
          <button className="button ghost" type="button" onClick={() => setExpandedFinance(!expandedFinance)}>
            {expandedFinance ? 'Скрыть фин. аналитику' : 'Раскрыть фин. аналитику'}
          </button>
        </div>
        <div className="order-inline-composition">
          <span>Состав</span>
          <strong>{order.product}</strong>
          <small>{order.items} · SKU {order.sku} · {order.grams} г · {order.printTime} · {order.materialLabel}</small>
          {showPrintAction && (
            <button
              className="button primary inline-print-button"
              type="button"
              onClick={() => sendToPrint(order)}
              disabled={!canPrint}
            >
              {canPrint ? 'Печать' : 'Нет ссылки'}
            </button>
          )}
        </div>
      </div>

      <div className="order-timeline">
        <Field label="Получен" value={order.dates?.received || '—'} />
        <Field label="Отгружен" value={order.dates?.shipped || '—'} />
        <Field label="Доставлен в ПВЗ" value={order.dates?.pvzDelivered || '—'} />
        <Field label="Клиент забрал" value={order.dates?.pickedUp || '—'} />
      </div>

      {expandedFinance && (
        <section className="finance-analytics">
          <div className="cost-grid">
            <Metric label="Продажа покупателю" value={`${formatCurrency(order.price)} ₽`} />
            {Number.isFinite(order.marketplaceNet) && (
              <Metric label={`К перечислению ${order.channel}`} value={`${formatCurrency(order.marketplaceNet)} ₽`} />
            )}
            <Metric label={`Списания ${order.channel}`} value={`${formatCurrency(finance.marketplaceExpenses)} ₽`} />
            {finance.marketplaceIncome > 0 && (
              <Metric label={`Компенсации ${order.channel}`} value={`${formatCurrency(finance.marketplaceIncome)} ₽`} />
            )}
            <Metric label="Наша себестоимость" value={`${formatCurrency(finance.ownExpenses)} ₽`} />
            <Metric label="Чистая прибыль" value={`${formatCurrency(finance.confirmedProfit)} ₽`} accent />
          </div>
          <div className="detail-card finance-card">
            <div>
              <h3>Финансовая разбивка</h3>
              <p>Факт считается по подтвержденным строкам. Прогноз включает списания, которые Ozon/Яндекс/WB обычно начисляют позже.</p>
            </div>
            <div className="finance-table">
              {finance.rows.map((row) => (
                <div className="finance-row" key={row.id}>
                  <div>
                    <b>{row.label}</b>
                    <span>{row.group} · {row.source}</span>
                  </div>
                  <span className={row.status === 'confirmed' ? 'finance-status confirmed' : 'finance-status pending'}>
                    {row.status === 'confirmed' ? 'подтверждено' : 'ожидаем'}
                  </span>
                  <Money amount={row.amount} direction={row.direction} />
                </div>
              ))}
            </div>
            <div className="finance-total">
              <Field label="Маржа факт" value={`${finance.confirmedMargin}%`} />
              <Field label="Маржа прогноз" value={`${finance.expectedMargin}%`} />
              <Field label="Что еще ждем" value={`${formatCurrency(finance.pendingExpenses)} ₽`} />
              {finance.marketplaceReportDifference !== null && (
                <Field
                  label={`Расхождение с отчетом ${order.channel}`}
                  value={`${formatCurrency(finance.marketplaceReportDifference)} ₽`}
                />
              )}
            </div>
          </div>
        </section>
      )}

      {!order.productFound && <p className="warning">Артикул не найден в Google-таблице. Проверьте SKU в заказе.</p>}
    </aside>
  );
}

function Replenish({ purchases, status, locationsById, setLocationsById }) {
  function updateLocation(id, location) {
    const nextLocations = { ...locationsById, [id]: location };
    setLocationsById(nextLocations);
    localStorage.setItem(FILAMENT_LOCATIONS_STORAGE_KEY, JSON.stringify(nextLocations));
  }

  return (
    <div className="stack">
      <section className="panel form-panel">
        <h2>Пополнение остатков</h2>
        <p>Пополнения автоматически берутся из листа «Склад» в текущей таблице товаров. Здесь оставили только контроль загрузки и место хранения катушек.</p>
        <div className={`catalog-status ${status.state}`}>{status.message}</div>
        <div className="format-hint">
          <strong>Формат листа «Склад»</strong>
          <span>Одна строка = одна катушка. Эти же данные теперь используются на дашборде и странице филамента.</span>
          <code>Дата | Материал | Цвет | Вес, г | Цена, ₽ | Поставщик | Место</code>
        </div>
      </section>

      <section className="panel">
        <h2>Катушки в системе</h2>
        <p>Место хранения можно менять здесь: склад или AMS. Это не требует правки таблицы.</p>
        <div className="spool-list">
          {purchases.map((item) => (
            <article className="spool-row" key={item.id}>
              <div>
                <strong>{item.material} · {item.color}</strong>
                <span>{item.date} · {item.supplier}</span>
              </div>
              <Field label="Вес" value={`${item.grams} г`} />
              <Field label="Цена" value={item.price ? `${item.price} ₽` : '—'} />
              <label className="storage-select">
                <span>Где лежит</span>
                <select value={item.location} onChange={(event) => updateLocation(item.id, event.target.value)}>
                  <option>Склад</option>
                  <option>AMS</option>
                </select>
              </label>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function Products({ products, catalogStatus }) {
  return (
    <section className="panel">
      <h2>Изделия</h2>
      <p>Справочник загружается из Google Sheets. Артикул является главным ключом для заказов маркетплейсов.</p>
      <div className={`catalog-status ${catalogStatus.state}`}>
        {catalogStatus.message}
      </div>
      <div className="product-grid">
        {products.map((product) => (
          <ProductCard product={product} key={product.sku} />
        ))}
      </div>
    </section>
  );
}

function ProductCard({ product }) {
  const economics = getProductEconomics(product);
  const marketplaces = getMarketplaceEconomics(product, economics.cost);
  const printTime = product.printHours ? `${String(product.printHours).replace('.', ',')} ч` : 'не указано';

  return (
    <article className="product-card">
      <div className="product-content">
        <div className="product-top">
          <div className="product-main">
            <div className="product-head">
              <span>{product.sku}</span>
              <b>{product.materialRaw || product.material} · {product.color || 'цвет не указан'}</b>
            </div>
            <h3>{product.name}</h3>
          </div>
          {product.printLink ? (
            <a className="button primary product-link" href={product.printLink} target="_blank" rel="noreferrer">
              Открыть печать
            </a>
          ) : (
            <button className="button ghost product-link" disabled>
              Ссылка не добавлена
            </button>
          )}
        </div>
        <div className="product-facts">
          <Field label="Продажа" value={product.price ? `${product.price} ₽` : 'не указана'} />
          <Field label="Себестоимость" value={`${economics.cost} ₽`} />
          <Field label="Маржа" value={product.price ? `${economics.margin}%` : '—'} />
          <Field label="Печать" value={printTime} />
          <Field label="Вес" value={`${product.grams} г`} />
          <Field label="Пластик" value={`${economics.plastic} ₽`} />
        </div>
        <div className="marketplace-margins" aria-label="Маржинальность по площадкам">
          {marketplaces.map((marketplace) => (
            <div className="marketplace-margin" key={marketplace.id}>
              <span>{marketplace.label}</span>
              <strong>{product.price ? `${marketplace.margin}%` : '—'}</strong>
              <small>комиссия {marketplace.percent}% · {marketplace.fee} ₽</small>
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}

function TokenHelp({ item }) {
  const help = marketplaceTokenHelp[item.id];
  if (!help) {
    return (
      <div className="token-help">
        <strong>Ручные продажи</strong>
        <p>Здесь токены не нужны: укажите название канала, например Instagram, Авито, сайт или личные заказы.</p>
      </div>
    );
  }

  return (
    <div className="token-help">
      <div>
        <strong>{help.title}</strong>
        <p>Мини-инструкция, чтобы не искать по всему кабинету.</p>
      </div>
      <ol>
        {help.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <div className="token-links">
        {help.links.map((link) => (
          <a href={link.href} key={link.href} target="_blank" rel="noreferrer">
            {link.label}
            <ExternalLink size={14} />
          </a>
        ))}
      </div>
    </div>
  );
}

function Integrations({ productsSheetUrl, setProductsSheetUrl, catalogStatus, printerIntegration, setPrinterIntegration, setOrders }) {
  const [draftUrl, setDraftUrl] = useState(productsSheetUrl);
  const [draftUsageUrl, setDraftUsageUrl] = useState(() => localStorage.getItem(USAGE_SHEET_STORAGE_KEY) || productsSheetUrl);
  const [draftPrinter, setDraftPrinter] = useState(printerIntegration);
  const [sheetMessage, setSheetMessage] = useState('');
  const [usageMessage, setUsageMessage] = useState('');
  const [printerMessage, setPrinterMessage] = useState('');
  const [marketplaces, setMarketplaces] = useState(getStoredMarketplaceIntegrations);
  const [activeIntegration, setActiveIntegration] = useState('');
  const [marketplaceMessage, setMarketplaceMessage] = useState('');
  const [syncingMarketplace, setSyncingMarketplace] = useState('');
  const items = [
    { id: 'ozon', title: 'Ozon Seller API', hint: 'Заказы, статусы, фин. отчеты, логистика, акции и реклама Ozon', fields: ['Client ID', 'API key', 'Seller ID'] },
    { id: 'wildberries', title: 'Wildberries API', hint: 'Заказы, статусы, комиссии, логистика и удержания WB', fields: ['Token статистики', 'Token контента', 'Token цен'] },
    { id: 'yandex', title: 'Яндекс Маркет Partner API', hint: 'Заказы, статусы, платежи, логистика и удержания Яндекса', fields: ['OAuth token', 'Campaign ID', 'Business ID'] },
    { id: 'manual', title: 'Ручные продажи', hint: 'Заказы без маркетплейса', fields: ['Название канала', 'Комментарий'] },
  ];

  function saveProductsSheet(event) {
    event.preventDefault();
    const nextUrl = draftUrl.trim() || DEFAULT_PRODUCTS_SHEET_URL;
    localStorage.setItem(PRODUCT_SHEET_STORAGE_KEY, nextUrl);
    setProductsSheetUrl(nextUrl);
    setSheetMessage('Таблица сохранена. Изделия и лист «Склад» будут обновлены из этой ссылки.');
  }

  function resetProductsSheet() {
    localStorage.removeItem(PRODUCT_SHEET_STORAGE_KEY);
    setDraftUrl(DEFAULT_PRODUCTS_SHEET_URL);
    setProductsSheetUrl(DEFAULT_PRODUCTS_SHEET_URL);
    setSheetMessage('Вернули таблицу по умолчанию.');
  }

  function saveUsagePath(event) {
    event.preventDefault();
    const nextUrl = draftUsageUrl.trim() || productsSheetUrl || DEFAULT_PRODUCTS_SHEET_URL;
    localStorage.setItem(USAGE_SHEET_STORAGE_KEY, nextUrl);
    setDraftUsageUrl(nextUrl);
    setUsageMessage('Путь выгрузки сохранен. Принтер сможет писать сюда историю печати и фактические списания пластика.');
  }

  function savePrinter(event) {
    event.preventDefault();
    localStorage.setItem(PRINTER_STORAGE_KEY, JSON.stringify(draftPrinter));
    setPrinterIntegration(draftPrinter);
    setPrinterMessage('Настройки принтера сохранены локально.');
  }

  function updateMarketplaceDraft(id, field, value) {
    const next = {
      ...marketplaces,
      [id]: {
        ...marketplaces[id],
        [field]: value,
      },
    };
    setMarketplaces(next);
    localStorage.setItem(MARKETPLACE_INTEGRATIONS_STORAGE_KEY, JSON.stringify(next));
  }

  function saveMarketplace(event, item) {
    event.preventDefault();
    const now = new Date().toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const currentSettings = marketplaces[item.id] || {};
    const missingFields = getMissingMarketplaceFields(item.id, currentSettings);
    const connected = missingFields.length === 0;
    const next = {
      ...marketplaces,
      [item.id]: {
        ...currentSettings,
        connected,
        updatedAt: now,
        lastSync: currentSettings.lastSync || '',
        lastResult: connected ? currentSettings.lastResult || '' : `Не заполнено: ${missingFields.join(', ')}`,
        syncError: !connected,
      },
    };
    setMarketplaces(next);
    localStorage.setItem(MARKETPLACE_INTEGRATIONS_STORAGE_KEY, JSON.stringify(next));
    setMarketplaceMessage(
      connected
        ? `${item.title}: настройки сохранены. Теперь можно запускать синхронизацию заказов и фин. строк.`
        : `${item.title}: заполните ${missingFields.join(', ')}, тогда синхронизация станет доступна.`,
    );
  }

  function disconnectMarketplace(id) {
    const next = {
      ...marketplaces,
      [id]: {
        ...marketplaces[id],
        connected: false,
      },
    };
    setMarketplaces(next);
    localStorage.setItem(MARKETPLACE_INTEGRATIONS_STORAGE_KEY, JSON.stringify(next));
  }

  async function syncMarketplace(item) {
    setSyncingMarketplace(item.id);
    setMarketplaceMessage(`${item.title}: проверяю тоннель и запрашиваю кабинет...`);
    const now = new Date().toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const currentSettings = marketplaces[item.id] || {};
    const missingFields = getMissingMarketplaceFields(item.id, currentSettings);
    if (missingFields.length) {
      const next = {
        ...marketplaces,
        [item.id]: {
          ...currentSettings,
          connected: false,
          lastResult: `Не заполнено: ${missingFields.join(', ')}`,
          syncError: true,
        },
      };
      setMarketplaces(next);
      localStorage.setItem(MARKETPLACE_INTEGRATIONS_STORAGE_KEY, JSON.stringify(next));
      setMarketplaceMessage(`${item.title}: заполните ${missingFields.join(', ')}, потом можно синхронизировать.`);
      setSyncingMarketplace('');
      return;
    }

    try {
      const response = await fetch('/api/marketplace-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marketplace: item.id, settings: currentSettings }),
      });
      const result = await response.json().catch(() => ({}));
      const ok = response.ok && result.ok !== false;
      if (ok && getMarketplaceChannel(item.id)) {
        setOrders((currentOrders) => mergeSyncedOrders(currentOrders, [{ marketplace: item.id, ok: true, orders: result.orders || [] }]));
      }
      const next = {
        ...marketplaces,
        [item.id]: {
          ...currentSettings,
          lastSync: ok ? now : currentSettings.lastSync || '',
          lastResult: result.message || (ok ? 'Кабинет ответил успешно.' : 'Кабинет вернул ошибку.'),
          syncError: !ok,
        },
      };
      setMarketplaces(next);
      localStorage.setItem(MARKETPLACE_INTEGRATIONS_STORAGE_KEY, JSON.stringify(next));
      setMarketplaceMessage(
        ok
          ? `${item.title}: ${result.message || 'кабинет ответил успешно.'}${getMarketplaceChannel(item.id) ? ` Заказы площадки в списке заменены данными кабинета.` : ''}`
          : `${item.title}: ${result.message || 'не удалось получить данные.'}`,
      );
    } catch (error) {
      const next = {
        ...marketplaces,
        [item.id]: {
          ...currentSettings,
          lastResult: 'Локальный тоннель не отвечает. Перезапустите dev-сервер, чтобы Vite подхватил /api/marketplace-sync.',
          syncError: true,
        },
      };
      setMarketplaces(next);
      localStorage.setItem(MARKETPLACE_INTEGRATIONS_STORAGE_KEY, JSON.stringify(next));
      setMarketplaceMessage(`${item.title}: ${error?.message || 'локальный тоннель не отвечает.'}`);
    } finally {
      setSyncingMarketplace('');
    }
  }

  return (
    <section className="panel">
      <h2>Интеграции</h2>
      <p>Здесь будут ключи кабинетов, расписание синхронизации и журнал ошибок.</p>
      <div className="integration-list">
        <article className="integration-card connected">
          <PlugZap size={22} />
          <div>
            <strong>Товары из Google Sheets</strong>
            <span>Изделия, цены, граммы, время печати, ссылки на печать и лист «Склад».</span>
          </div>
          <button className="button ghost" type="button" onClick={() => setActiveIntegration(activeIntegration === 'products' ? '' : 'products')}>
            {activeIntegration === 'products' ? 'Свернуть' : 'Настроить'}
          </button>
          {activeIntegration === 'products' && (
            <form className="marketplace-settings" onSubmit={saveProductsSheet}>
              <label>
                <span>Текущая таблица товаров</span>
                <input value={draftUrl} onChange={(event) => setDraftUrl(event.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." />
              </label>
              <div className={`catalog-status ${catalogStatus.state}`}>{catalogStatus.message}</div>
              {sheetMessage && <div className="catalog-status ready">{sheetMessage}</div>}
              <div className="integration-actions">
                <button className="button primary" type="submit">Сохранить таблицу</button>
                <button className="button ghost" type="button" onClick={resetProductsSheet}>Вернуть по умолчанию</button>
              </div>
            </form>
          )}
        </article>
        <article className="integration-card">
          <PlugZap size={22} />
          <div>
            <strong>Путь выгрузки расхода</strong>
            <span>Куда принтер будет отправлять историю печати, личные работы, тесты, брак и списания пластика.</span>
          </div>
          <button className="button ghost" type="button" onClick={() => setActiveIntegration(activeIntegration === 'usage' ? '' : 'usage')}>
            {activeIntegration === 'usage' ? 'Свернуть' : 'Настроить'}
          </button>
          {activeIntegration === 'usage' && (
            <form className="marketplace-settings" onSubmit={saveUsagePath}>
              <label>
                <span>Путь выгрузки</span>
                <input value={draftUsageUrl} onChange={(event) => setDraftUsageUrl(event.target.value)} placeholder="Google Sheet, API endpoint или локальный путь" />
              </label>
              <div className="format-hint">
                <strong>Что будет уходить в расход</strong>
                <span>Дата, источник, SKU/заказ, тип пластика, цвет, граммы, статус печати и признак личной/коммерческой работы.</span>
              </div>
              {usageMessage && <div className="catalog-status ready">{usageMessage}</div>}
              <div className="integration-actions">
                <button className="button primary" type="submit">Сохранить путь</button>
              </div>
            </form>
          )}
        </article>
        <article className="integration-card">
          <PlugZap size={22} />
          <div>
            <strong>Принтер и история печати</strong>
            <span>Статус печати и фактический расход пластика по заказам и личным работам.</span>
          </div>
          <button className="button ghost" type="button" onClick={() => setActiveIntegration(activeIntegration === 'printer' ? '' : 'printer')}>
            {activeIntegration === 'printer' ? 'Свернуть' : 'Настроить'}
          </button>
          {activeIntegration === 'printer' && (
            <form className="marketplace-settings" onSubmit={savePrinter}>
              <div className="printer-form-grid">
                <label>
                  <span>Тип подключения</span>
                  <select value={draftPrinter.type} onChange={(event) => setDraftPrinter({ ...draftPrinter, type: event.target.value })}>
                    <option>Bambu Lab</option>
                    <option>OctoPrint</option>
                    <option>Klipper / Moonraker</option>
                    <option>Ручной импорт CSV</option>
                  </select>
                </label>
                <label>
                  <span>Адрес / IP</span>
                  <input value={draftPrinter.host} onChange={(event) => setDraftPrinter({ ...draftPrinter, host: event.target.value })} placeholder="192.168.1.50 или URL API" />
                </label>
                <label>
                  <span>Серийный номер</span>
                  <input value={draftPrinter.serial} onChange={(event) => setDraftPrinter({ ...draftPrinter, serial: event.target.value })} placeholder="для Bambu Lab, если нужен" />
                </label>
                <label>
                  <span>Код доступа / API key</span>
                  <input value={draftPrinter.accessCode} onChange={(event) => setDraftPrinter({ ...draftPrinter, accessCode: event.target.value })} placeholder="хранится локально в браузере" />
                </label>
              </div>
              <div className="catalog-status loading">Подключение сохранится как настройка. Следующий шаг — читать из API историю печати и писать ее в «Расход».</div>
              {printerMessage && <div className="catalog-status ready">{printerMessage}</div>}
              <div className="integration-actions">
                <button className="button primary" type="submit">Сохранить принтер</button>
              </div>
            </form>
          )}
        </article>
        {items.map((item) => {
          const settings = marketplaces[item.id] || {};
          const missingFields = getMissingMarketplaceFields(item.id, settings);
          const ready = isMarketplaceReady(item.id, settings);
          return (
            <article className={ready ? 'integration-card connected' : 'integration-card'} key={item.id}>
              <PlugZap size={22} />
              <div>
                <strong>{item.title}</strong>
                <span>
                  {ready
                    ? `Подключено локально · ${settings.updatedAt || 'без даты'}`
                    : missingFields.length
                      ? `Нужно заполнить: ${missingFields.join(', ')}`
                      : item.hint}
                </span>
              </div>
              <button className="button ghost" type="button" onClick={() => setActiveIntegration(activeIntegration === `marketplace-${item.id}` ? '' : `marketplace-${item.id}`)}>
                {activeIntegration === `marketplace-${item.id}` ? 'Свернуть' : 'Настроить'}
              </button>
              {activeIntegration === `marketplace-${item.id}` && (
                <form className="marketplace-settings" onSubmit={(event) => saveMarketplace(event, item)}>
                  <TokenHelp item={item} />
                  <div className="format-hint">
                    <strong>Что будет выгружаться</strong>
                    <span>Заказы, даты отгрузки, статусы, цены продажи и финансовые строки: комиссии, логистика, эквайринг, акции, реклама, штрафы и удержания.</span>
                  </div>
                  <div className="printer-form-grid">
                    {item.fields.map((field) => (
                      <label key={field}>
                        <span>{field}</span>
                        <input
                          value={settings[field] || ''}
                          onChange={(event) => updateMarketplaceDraft(item.id, field, event.target.value)}
                          placeholder={field}
                        />
                      </label>
                    ))}
                  </div>
                  {settings.lastSync && (
                    <div className="catalog-status ready">Последняя синхронизация: {settings.lastSync}</div>
                  )}
                  {settings.lastResult && (
                    <div className={settings.syncError ? 'catalog-status error' : 'catalog-status ready'}>
                      {settings.lastResult}
                    </div>
                  )}
                  <div className="integration-actions">
                    <button className="button primary" type="submit">Сохранить настройки</button>
                    <button className="button ghost" type="button" onClick={() => syncMarketplace(item)} disabled={!ready || syncingMarketplace === item.id}>
                      {syncingMarketplace === item.id ? 'Синхронизация...' : 'Синхронизировать'}
                    </button>
                    {settings.connected && (
                      <button className="button ghost" type="button" onClick={() => disconnectMarketplace(item.id)}>
                        Отключить
                      </button>
                    )}
                  </div>
                </form>
              )}
            </article>
          );
        })}
      </div>
      {marketplaceMessage && <div className="catalog-status ready">{marketplaceMessage}</div>}
    </section>
  );
}

createRoot(document.getElementById('root')).render(<App />);
