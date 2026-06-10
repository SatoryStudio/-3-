import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = path.resolve("public/templates");
await fs.mkdir(outputDir, { recursive: true });

const palette = {
  ink: "#171514",
  accent: "#C9272D",
  accentSoft: "#F6D6D9",
  paper: "#FFFDF8",
  line: "#DED8CF",
  muted: "#706B64",
};

async function buildTemplate(config) {
  const workbook = Workbook.create();
  const sheet = workbook.worksheets.add("Импорт");
  sheet.showGridlines = false;
  sheet.getRange(`A1:${config.lastColumn}1`).merge();
  sheet.getRange("A1").values = [[config.title]];
  sheet.getRange("A1").format = {
    fill: palette.ink,
    font: { bold: true, color: "#FFFFFF", size: 18 },
    horizontalAlignment: "left",
    verticalAlignment: "center",
  };
  sheet.getRange(`A2:${config.lastColumn}2`).merge();
  sheet.getRange("A2").values = [[config.subtitle]];
  sheet.getRange("A2").format = {
    fill: palette.accentSoft,
    font: { color: palette.ink, size: 10 },
    wrapText: true,
    verticalAlignment: "center",
  };
  sheet.getRange(`A4:${config.lastColumn}${4 + config.examples.length}`).values = [config.headers, ...config.examples];
  const table = sheet.tables.add(`A4:${config.lastColumn}${4 + config.examples.length}`, true, config.tableName);
  table.style = "TableStyleMedium2";
  table.showFilterButton = true;
  table.showBandedRows = true;
  sheet.freezePanes.freezeRows(4);
  sheet.getRange(`A4:${config.lastColumn}4`).format = {
    fill: palette.accent,
    font: { bold: true, color: "#FFFFFF", size: 10 },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    wrapText: true,
  };
  sheet.getRange(`A5:${config.lastColumn}104`).format = {
    fill: palette.paper,
    font: { color: palette.ink, size: 10 },
    borders: { color: palette.line, style: "continuous", weight: 1 },
    verticalAlignment: "center",
  };
  config.widths.forEach((width, index) => {
    sheet.getRange(`${String.fromCharCode(65 + index)}:${String.fromCharCode(65 + index)}`).format.columnWidth = width;
  });
  config.validations.forEach(({ range, rule }) => {
    sheet.dataValidations.add({ range, rule });
  });
  config.formats.forEach(({ range, code }) => {
    sheet.getRange(range).format.numberFormat = code;
  });
  sheet.getRange("A1").format.rowHeight = 30;
  sheet.getRange("A2").format.rowHeight = 36;
  sheet.getRange("A4").format.rowHeight = 32;

  workbook.comments.setSelf({ displayName: "Filament ERP" });
  for (const [index, note] of config.notes.entries()) {
    workbook.comments.addThread({ cell: sheet.getRange(`${String.fromCharCode(65 + index)}4`) }, note);
  }

  const inspect = await workbook.inspect({
    kind: "table",
    range: `Импорт!A1:${config.lastColumn}8`,
    include: "values,formulas",
    tableMaxRows: 8,
    tableMaxCols: config.headers.length,
  });
  console.log(inspect.ndjson);
  const render = await workbook.render({ sheetName: "Импорт", range: `A1:${config.lastColumn}10`, scale: 1.5 });
  await fs.writeFile(
    path.join(outputDir, `${config.fileName}.png`),
    new Uint8Array(await render.arrayBuffer()),
  );
  const exported = await SpreadsheetFile.exportXlsx(workbook);
  await exported.save(path.join(outputDir, `${config.fileName}.xlsx`));
}

await buildTemplate({
  fileName: "products-template",
  tableName: "ProductsImport",
  title: "Filament ERP · Импорт товаров",
  subtitle: "Оставьте названия колонок без изменений. Стоимости указываются в рублях, вес — в граммах, время печати — в минутах.",
  headers: ["marketplace", "marketplace_sku", "name", "filament_material", "filament_color", "weight_grams", "print_time_minutes", "packaging_cost", "extra_cost"],
  examples: [
    ["manual", "SKU-001", "Перчатница", "PLA", "black", 140, 180, 25, 0],
    ["yandex", "YM-002", "Органайзер", "PETG", "white", 220, 310, 35, 15],
  ],
  lastColumn: "I",
  widths: [14, 18, 30, 19, 17, 15, 20, 17, 14],
  validations: [
    { range: "A5:A104", rule: { type: "list", values: ["manual", "yandex", "ozon"] } },
    { range: "F5:G104", rule: { type: "whole", operator: "between", formula1: 0, formula2: 100000 } },
    { range: "H5:I104", rule: { type: "decimal", operator: "between", formula1: 0, formula2: 1000000 } },
  ],
  formats: [{ range: "F5:G104", code: "0" }, { range: "H5:I104", code: '#,##0.00 "₽"' }],
  notes: [
    "Допустимые значения: manual, yandex или ozon.",
    "Уникальный SKU товара внутри выбранного маркетплейса.",
    "Название, которое будет видно в заказах и очереди печати.",
    "Например PLA, PETG или ABS.",
    "Цвет должен совпадать с цветом импортированной катушки.",
    "Вес одной единицы изделия в граммах.",
    "Время печати одной единицы в минутах.",
    "Если оставить 0, система использует стоимость упаковки из настроек.",
    "Другие производственные расходы на одну позицию.",
  ],
});

await buildTemplate({
  fileName: "filament-template",
  tableName: "FilamentImport",
  title: "Filament ERP · Импорт филамента",
  subtitle: "Каждая строка создаёт отдельную физическую катушку. Если цена за кг пустая, приложение рассчитает её автоматически.",
  headers: ["material", "color", "brand", "spool_weight_grams", "remaining_weight_grams", "price_per_spool", "price_per_kg", "purchase_date"],
  examples: [
    ["PLA", "black", "Bambu Lab", 1000, 1000, 1200, 1200, "01.06.2026"],
    ["PETG", "white", "eSUN", 1000, 640, 1450, 1450, "15.05.2026"],
  ],
  lastColumn: "H",
  widths: [15, 16, 20, 22, 24, 18, 16, 17],
  validations: [
    { range: "D5:E104", rule: { type: "whole", operator: "between", formula1: 0, formula2: 100000 } },
    { range: "F5:G104", rule: { type: "decimal", operator: "between", formula1: 0, formula2: 1000000 } },
    { range: "H5:H104", rule: { type: "date", operator: "between", formula1: "DATE(2020,1,1)", formula2: "DATE(2100,12,31)" } },
  ],
  formats: [
    { range: "D5:E104", code: "0" },
    { range: "F5:G104", code: '#,##0.00 "₽"' },
    { range: "H5:H104", code: "dd.mm.yyyy" },
  ],
  notes: [
    "Материал катушки, например PLA или PETG.",
    "Цвет должен совпадать с цветом товара.",
    "Производитель филамента.",
    "Начальный вес пластика на катушке без учёта веса пустой шпули.",
    "Текущий остаток пластика. Не может превышать начальный вес.",
    "Цена покупки катушки в рублях.",
    "Необязательно: будет вычислена как цена катушки / вес × 1000.",
    "Дата покупки используется для FIFO.",
  ],
});
