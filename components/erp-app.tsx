"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Boxes, Factory, FileSpreadsheet, Gauge, LogOut, PackageOpen, Printer,
  RefreshCcw, Settings, ShoppingBag, WalletCards,
} from "lucide-react";
import {
  normalizeFilamentColor,
  normalizeFilamentMaterial,
} from "@/lib/services/filament-normalization";

type Page = "dashboard" | "orders" | "print" | "filament" | "products" | "finance" | "import" | "settings";
type State = {
  products: any[];
  spools: any[];
  orders: any[];
  printJobs: any[];
  printers: any[];
  financialOperations: any[];
  syncLogs: any[];
  latestSync: any;
  syncIssues: any[];
  financeSummary: any;
  productMatching: any;
  payoutSchedule: any[];
  filamentAudit: any;
  settings: Record<string, number>;
};
type FilamentForecast = {
  key: string;
  material: string;
  color: string;
  remaining: number;
  reserved: number;
  available: number;
  forecast: { id: string; name: string; count: number }[];
};

const NAV: { id: Page; label: string; icon: typeof Factory }[] = [
  { id: "dashboard", label: "Дашборд", icon: Gauge },
  { id: "orders", label: "Заказы", icon: ShoppingBag },
  { id: "print", label: "Печать", icon: Printer },
  { id: "filament", label: "Филамент", icon: Boxes },
  { id: "products", label: "Товары", icon: PackageOpen },
  { id: "finance", label: "Финансы", icon: WalletCards },
  { id: "import", label: "Таблицы", icon: FileSpreadsheet },
  { id: "settings", label: "Настройки", icon: Settings },
];

const EMPTY: State = {
  products: [], spools: [], orders: [], printJobs: [], printers: [], financialOperations: [], syncLogs: [],
  latestSync: null, syncIssues: [], settings: {},
  financeSummary: null, productMatching: null, payoutSchedule: [], filamentAudit: null,
};

function money(kopecks: number) {
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format((kopecks || 0) / 100)} ₽`;
}

function rubles(value: number, maximumFractionDigits = 4) {
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits }).format(value || 0)} ₽`;
}

function grams(value: number) {
  return `${new Intl.NumberFormat("ru-RU").format(value || 0)} г`;
}

async function mutate(url: string, body?: unknown, method = "POST") {
  const response = await fetch(url, {
    method,
    headers: body instanceof FormData ? undefined : { "Content-Type": "application/json" },
    body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Операция не выполнена");
  return payload;
}

export function ErpApp({ email }: { email: string }) {
  const [page, setPage] = useState<Page>("dashboard");
  const [state, setState] = useState<State>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    if (showLoading) setError("");
    try {
      const response = await fetch("/api/state", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Не удалось загрузить данные");
      setState(payload);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Ошибка загрузки");
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(false), 15_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh(false);
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
    };
  }, [refresh]);

  async function logout() {
    await mutate("/api/auth/logout");
    window.location.href = "/login";
  }

  const content = {
    dashboard: <Dashboard state={state} setPage={setPage} refresh={refresh} />,
    orders: <Orders state={state} refresh={refresh} />,
    print: <PrintQueue state={state} refresh={refresh} />,
    filament: <Filament state={state} />,
    products: <Products state={state} refresh={refresh} />,
    finance: <Finance state={state} />,
    import: <ImportPage refresh={refresh} setPage={setPage} />,
    settings: <SettingsPage state={state} refresh={refresh} />,
  }[page];

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">F</div><div><strong>Filament ERP</strong><span>3D-производство</span></div></div>
        <nav>{NAV.map((item) => <button key={item.id} className={`nav-item ${page === item.id ? "active" : ""}`} onClick={() => setPage(item.id)}><item.icon size={19} />{item.label}</button>)}</nav>
        <div className="sidebar-footer"><span>{email}</span><button onClick={logout}><LogOut size={17} /> Выйти</button></div>
      </aside>
      <section className="workspace">
        <header className="page-header">
          <div><span className="eyebrow">Управление производством</span><h1>{NAV.find((item) => item.id === page)?.label}</h1></div>
          <button className="button ghost" onClick={() => void refresh()} disabled={loading}><RefreshCcw size={17} className={loading ? "spin" : ""} /> Обновить</button>
        </header>
        {error && <div className="notice error">{error}</div>}
        {loading && state === EMPTY ? <div className="empty">Загружаю XLSX-хранилище…</div> : content}
      </section>
    </main>
  );
}

function Dashboard({ state, setPage, refresh }: { state: State; setPage: (page: Page) => void; refresh: () => Promise<void> }) {
  const active = state.orders.filter((order) => !["delivered", "cancelled", "returned"].includes(order.internal_status));
  const revenue = state.orders.reduce((sum, order) => sum + order.gross_revenue, 0);
  const profit = state.financeSummary?.result?.earnedNetProfit || 0;
  const reserved = state.spools.reduce((sum, spool) => sum + spool.reserved_weight_grams, 0);
  const remaining = state.spools.reduce((sum, spool) => sum + spool.remaining_weight_grams, 0);
  const low = state.spools.filter((spool) => spool.remaining_weight_grams - spool.reserved_weight_grams <= state.settings.warningFilamentLevel);
  return (
    <div className="stack">
      <div className="metrics">
        <Metric label="Активные заказы" value={String(active.length)} onClick={() => setPage("orders")} />
        <Metric label="В производстве" value={String(state.orders.filter((order) => order.internal_status === "in_production").length)} />
        <Metric label="Остаток" value={grams(remaining)} />
        <Metric label="Резерв" value={grams(reserved)} warning={reserved > 0} />
        <Metric label="Заработано на доставленных" value={money(profit)} danger={profit < 0} accent />
      </div>
      <div className="dashboard-grid">
        <section className="panel span-3">
          <PanelHead title="Заказы сегодня" action="Все заказы" onClick={() => setPage("orders")} />
          <div className="metrics compact">
            {(["new", "in_production", "assembling", "in_transit", "delivered", "problem"] as const).map((status) =>
              <Metric key={status} label={status === "new" ? "Новые / к печати" : orderStatusLabel(status)} value={String(ordersToday(state.orders).filter((order) =>
                status === "new"
                  ? ["new", "waiting_production"].includes(order.internal_status)
                  : order.internal_status === status).length)} danger={status === "problem"} />)}
          </div>
        </section>
        <section className="panel span-3">
          <SyncStatusPanel state={state} refresh={refresh} />
        </section>
        <section className="panel span-2">
          <PanelHead title="Что требует внимания" action="Открыть заказы" onClick={() => setPage("orders")} />
          <div className="list">
            {active.slice(0, 8).map((order) => <div className="list-row" key={order.id}><div><strong>{order.items.map((item: any) => item.name).filter(Boolean).join(", ") || "Товар без названия"}</strong><span>Заказ № {order.marketplace_order_id} · {formatDateOnly(order.order_date)}</span></div><Status value={order.internal_status} /><b className={order.profit_status === "incomplete" ? "" : order.profit < 0 ? "negative" : "positive"}>{order.profit_status === "incomplete" ? "Себестоимость не рассчитана" : money(order.profit)}</b></div>)}
            {!active.length && <Empty text="Активных заказов пока нет" />}
          </div>
        </section>
        <section className="panel">
          <PanelHead title="Финансы" />
          <div className="summary-lines">
            <Summary label="Все заказы на сумму" value={money(revenue)} />
            <Summary label="Выручка доставленных" value={money(state.financeSummary?.cash?.deliveredRevenue || 0)} />
            <Summary label="Прогноз после удержаний" value={money(state.financeSummary?.cash?.erpForecast || 0)} />
            <Summary label="Заработано на доставленных" value={money(profit)} strong />
          </div>
        </section>
        <section className="panel span-3">
          <PanelHead title="Прогноз филамента" action="Все катушки" onClick={() => setPage("filament")} />
          <div className="forecast-grid">
            {aggregateFilament(state).slice(0, 6).map((group) => <div className="forecast-card" key={group.key}><strong>{group.material} · {group.color}</strong><span>Остаток {grams(group.remaining)} · резерв {grams(group.reserved)}</span><b>Свободно {grams(group.available)}</b><div>{group.forecast.slice(0, 3).map((item) => <small key={item.id}>≈ {item.count} × {item.name}</small>)}</div></div>)}
            {!state.spools.length && <Empty text="Импортируйте катушки, чтобы увидеть прогноз" />}
          </div>
          {!!low.length && <div className="notice warning">Заканчиваются катушки: {low.length}</div>}
        </section>
        <section className="panel span-3">
          <PanelHead title="Принтеры" action="Открыть очередь" onClick={() => setPage("print")} />
          <div className="printer-status-grid">
            {state.printers.map((printer) => {
              const current = state.printJobs.find((job) => job.printer_id === printer.id && job.status === "printing");
              return <div className="printer-status-card" key={printer.id}><div><strong>{printer.name}</strong><span>{printer.type === "manual" ? "Ручной" : "Bambu Lab"} · {printer.host || "без host"}</span></div><Status value={current ? "printing" : printer.is_active ? "idle" : "stopped"} />{current && <small>{current.item?.name} · план {grams(current.planned_grams)}</small>}</div>;
            })}
            {!state.printers.length && <Empty text="Добавьте принтер в настройках" />}
          </div>
        </section>
      </div>
    </div>
  );
}

function Orders({ state, refresh }: { state: State; refresh: () => Promise<void> }) {
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [filter, setFilter] = useState("all");
  const filters = [
    ["all", "Все"], ["new", "Новые / к печати"], ["in_production", "В производстве"],
    ["ready_to_ship", "Готово к отправке"], ["assembling", "В сборке"],
    ["in_transit", "В пути"], ["delivered", "Доставлено"],
    ["problem", "Проблемные"], ["cancelled", "Отменённые"],
  ];
  const matchesFilter = (order: any, value: string) => value === "new"
    ? ["new", "waiting_production"].includes(order.internal_status)
    : order.internal_status === value;
  const visibleOrders = (filter === "all"
    ? state.orders
    : state.orders.filter((order) => matchesFilter(order, filter)))
    .toSorted((a, b) => new Date(b.order_date).getTime() - new Date(a.order_date).getTime());
  const yandexStatusCounts = ["NEW", "PROCESSING", "READY_TO_SHIP", "SHIPPED", "DELIVERED", "CANCELLED"]
    .map((status) => ({
      status,
      count: state.orders.filter((order) =>
        order.marketplace === "yandex" && String(order.marketplace_status).toUpperCase() === status).length,
    }));
  return (
    <div className="stack">
      <section className="panel orders-controls">
        <div className="orders-controls-head">
          <div><strong>Фильтр заказов</strong><span>Показано {visibleOrders.length} из {state.orders.length}</span></div>
          <button className="button primary" onClick={() => setShowForm(!showForm)}>+ Ручной заказ</button>
        </div>
        <div className="order-filter-grid">{filters.map(([value, label]) => {
          const count = value === "all"
            ? state.orders.length
            : state.orders.filter((order) => matchesFilter(order, value)).length;
          return <button key={value} className={`order-filter ${filter === value ? "selected" : ""}`} onClick={() => setFilter(value)}><span>{label}</span><b>{count}</b></button>;
        })}</div>
      </section>
      {showForm && <ManualOrderForm products={state.products} onDone={async () => { setShowForm(false); await refresh(); }} />}
      <section className="panel">
        <div className="table orders-table">
          <div className="table-row table-head"><span>Товар и номер</span><span>Дата и сумма</span><span>Статус</span><span>Расчёт</span><span>Прибыль</span></div>
          {visibleOrders.map((order) => <button className="table-row" key={order.id} onClick={() => setSelected(order)}><span><b>{order.items.map((item: any) => item.name).filter(Boolean).join(", ") || "Товар без названия"}</b><small>Заказ № {order.marketplace_order_id}</small>{order.problem_message && <small className="negative">{order.problem_message}</small>}</span><span><b>{formatDateOnly(order.order_date)}</b><small>{order.items.reduce((sum: number, item: any) => sum + Number(item.quantity || 0), 0)} шт. · {money(order.gross_revenue)}</small></span><span><Status value={order.internal_status} /><small>Яндекс: {order.marketplace_status || "—"}</small></span><span className="calculation-state">{order.profit_status === "incomplete" ? "Неполный" : order.calculation_state === "actual" ? "Факт" : "Прогноз"}</span><b className={order.profit_status === "incomplete" ? "" : order.profit < 0 ? "negative" : "positive"}>{order.profit_status === "incomplete" ? "Себестоимость не рассчитана" : money(order.profit)}</b></button>)}
          {!visibleOrders.length && <Empty text="Заказов с таким статусом нет" />}
        </div>
      </section>
      <details className="panel marketplace-status-details">
        <summary>Технические статусы Яндекс Маркета</summary>
        <p>Нужны для диагностики синхронизации. В работе используйте фильтры ERP выше.</p>
        <div className="yandex-status-list">{yandexStatusCounts.map((item) => <div key={item.status}><span>{item.status}</span><b>{item.count}</b></div>)}</div>
      </details>
      {selected && <OrderDetail order={selected} close={() => setSelected(null)} refresh={refresh} />}
    </div>
  );
}

function ManualOrderForm({ products, onDone }: { products: any[]; onDone: () => Promise<void> }) {
  const [items, setItems] = useState([{ marketplace_sku: products[0]?.marketplace_sku || "", quantity: 1, unit_price: 0 }]);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await mutate("/api/orders", {
        marketplace_order_id: form.get("number"),
        order_date: new Date().toISOString(),
        items: items.map((item) => ({ ...item, unit_price: Math.round(Number(item.unit_price) * 100) })),
      });
      await onDone();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Ошибка"); }
  }
  return (
    <form className="panel form-panel" onSubmit={submit}>
      <h2>Новый многопозиционный заказ</h2>
      <label><span>Номер заказа</span><input name="number" required defaultValue={`MANUAL-${Date.now().toString().slice(-6)}`} /></label>
      {items.map((item, index) => <div className="item-editor" key={index}>
        <label><span>Товар</span><select value={item.marketplace_sku} onChange={(event) => setItems(items.map((current, i) => i === index ? { ...current, marketplace_sku: event.target.value } : current))}>{products.filter((product) => product.marketplace === "manual").map((product) => <option value={product.marketplace_sku} key={product.id}>{product.name} · {product.marketplace_sku}</option>)}</select></label>
        <label><span>Количество</span><input type="number" min="1" value={item.quantity} onChange={(event) => setItems(items.map((current, i) => i === index ? { ...current, quantity: Number(event.target.value) } : current))} /></label>
        <label><span>Цена за единицу, ₽</span><input type="number" min="0" step="0.01" value={item.unit_price} onChange={(event) => setItems(items.map((current, i) => i === index ? { ...current, unit_price: Number(event.target.value) } : current))} /></label>
        {items.length > 1 && <button type="button" className="icon-button" onClick={() => setItems(items.filter((_, i) => i !== index))}>×</button>}
      </div>)}
      <div className="toolbar"><button type="button" className="button ghost" onClick={() => setItems([...items, { marketplace_sku: products[0]?.marketplace_sku || "", quantity: 1, unit_price: 0 }])}>Добавить позицию</button><button className="button primary">Создать и зарезервировать</button></div>
      {error && <div className="notice error">{error}</div>}
      {!products.some((product) => product.marketplace === "manual") && <div className="notice warning">Сначала импортируйте товары с marketplace = manual.</div>}
    </form>
  );
}

function OrderDetail({ order, close, refresh }: { order: any; close: () => void; refresh: () => Promise<void> }) {
  const breakdown = order.profitBreakdown || { income: {}, marketplace: {}, production: {}, result: {} };
  async function cancel() {
    await mutate(`/api/orders/${order.id}/cancel`);
    close();
    await refresh();
  }
  return (
    <div className="modal-backdrop" onMouseDown={close}><aside className="detail-panel" onMouseDown={(event) => event.stopPropagation()}>
      <div className="detail-head"><div><span className="eyebrow">{order.marketplace}</span><h2>{order.marketplace_order_id}</h2></div><button className="icon-button" onClick={close}>×</button></div>
      <div className="metrics compact"><Metric label="Выручка" value={money(order.gross_revenue)} /><Metric label="Себестоимость" value={order.profit_status === "incomplete" ? "Не рассчитана" : money(order.production_cost)} /><Metric label="Площадка" value={money(order.marketplace_cost)} /><Metric label="Прибыль" value={order.profit_status === "incomplete" ? "Не рассчитана" : money(order.profit)} danger={order.profit_status !== "incomplete" && order.profit < 0} /></div>
      <div className="summary-lines order-meta">
        <Summary label="Статус ERP" value={orderStatusLabel(order.internal_status)} />
        <Summary label="Статус маркетплейса" value={[order.marketplace_status, order.marketplace_substatus].filter(Boolean).join(" / ") || "не указан"} />
        <Summary label="Дата заказа" value={formatDate(order.order_date)} />
        <Summary label="Дата отгрузки" value={formatDate(order.shipment_date)} />
        <Summary label="Дата доставки" value={formatDate(order.delivery_date)} />
        <Summary label="Дата расчёта Яндекса" value={formatDate(order.payment_date)} />
        <Summary label="Ожидаемая выплата ERP" value={money(order.expected_payout)} />
        <Summary label="Дата выплаты банком" value={formatDate(order.payout_date)} />
        <Summary label="Подтверждено платёжным поручением" value={money(order.actual_payout)} />
      </div>
      {order.problem_message && <div className="notice warning"><strong>{order.problem_code}</strong><br />{order.problem_message}</div>}
      {!!order.problemDetails?.length && <div className="problem-diagnostics"><h3>Диагностика problem-заказа</h3>{order.problemDetails.map((detail: any) => <section className="problem-detail" key={detail.sku}><div className="summary-lines"><Summary label="SKU" value={detail.sku} /><Summary label="Товар найден" value={detail.productFound ? "Да" : "Нет"} /><Summary label="Требуемый материал" value={detail.requiredMaterial || "не определён"} /><Summary label="Нормализованный материал" value={detail.normalizedMaterial || "не определён"} /><Summary label="Требуемый цвет" value={detail.requiredColor || "не определён"} /><Summary label="Нормализованный цвет" value={detail.normalizedColor || "не определён"} /><Summary label="Требуемый вес" value={grams(detail.requiredWeightGrams)} /><Summary label="Совпадений по материалу" value={String(detail.materialMatchCount || 0)} /><Summary label="Совпадений по цвету" value={String(detail.colorMatchCount || 0)} /><Summary label="Катушка найдена" value={detail.spoolFound ? `Да · ${detail.spoolId}` : "Нет"} /><Summary label="Остаток найденной катушки" value={detail.spoolFound ? grams(detail.spoolRemainingGrams) : "—"} /><Summary label="Материалы в наличии" value={detail.foundMaterials.join(", ") || "нет"} /><Summary label="Цвета для материала" value={detail.foundColorsForMaterial.join(", ") || "нет"} /><Summary label="Причина" value={detail.problemMessage || detail.problemCode} /></div>{!!detail.candidateSpools?.length && <div className="candidate-spools"><strong>Проверенные катушки</strong>{detail.candidateSpools.map((spool: any) => <div className="candidate-spool" key={spool.id}><span>{spool.id} · {spool.material} / {spool.color}</span><span>{grams(spool.availableWeightGrams)} свободно · {spool.status}</span><small>{spool.reasons.join(", ") || "подходит"}</small></div>)}</div>}</section>)}</div>}
      <div className="finance-breakdown-grid order-breakdown"><section className="panel"><h3>Доход</h3><div className="summary-lines"><Summary label="Выручка" value={money(breakdown.income.revenue)} /><Summary label="Возвраты" value={`− ${money(breakdown.income.returns)}`} /><Summary label="Компенсации" value={`+ ${money(breakdown.income.compensations)}`} /><Summary label="Скорректированная выручка" value={money(breakdown.income.adjustedRevenue)} strong /></div></section><section className="panel"><h3>Маркетплейс</h3><div className="summary-lines"><Summary label="Комиссия" value={money(breakdown.marketplace.commission)} /><Summary label="Логистика" value={money(breakdown.marketplace.logistics)} /><Summary label="Эквайринг" value={money(breakdown.marketplace.acquiring)} /><Summary label="Буст" value={money(breakdown.marketplace.boost)} /><Summary label="Хранение" value={money(breakdown.marketplace.storage)} /><Summary label="Штрафы" value={money(breakdown.marketplace.penalties)} /><Summary label="Прочие" value={money(breakdown.marketplace.other)} /></div></section><section className="panel"><h3>Производство</h3><div className="summary-lines"><Summary label="Плановый расход" value={grams(breakdown.production.plannedGrams)} /><Summary label="Фактический расход" value={grams(breakdown.production.actualGrams)} /><Summary label="Филамент" value={money(breakdown.production.filamentCost)} /><Summary label="Упаковка" value={money(breakdown.production.packagingCost)} /><Summary label="Электричество" value={money(breakdown.production.electricityCost)} /><Summary label="Брак" value={money(breakdown.production.failedPrintCost)} /><Summary label="Extra cost" value={money(breakdown.production.extraCost)} /></div></section><section className="panel"><h3>Итог</h3><div className="summary-lines"><Summary label="Валовая прибыль" value={order.profit_status === "incomplete" ? "Не рассчитана" : money(breakdown.result.grossProfit)} /><Summary label="Чистая прибыль" value={order.profit_status === "incomplete" ? "Не рассчитана" : money(breakdown.result.netProfit)} strong /><Summary label="Маржа" value={order.profit_status === "incomplete" ? "Не рассчитана" : `${breakdown.result.marginPercent || 0}%`} /><Summary label="Статус расчёта" value={order.profit_status === "incomplete" ? "Себестоимость не рассчитана" : "Полный"} /></div></section></div>
      <h3>Позиции</h3>
      <div className="list">{order.items.map((item: any) => <div className="item-finance" key={item.id}><div><strong>{item.name}</strong><span>SKU {item.marketplace_sku} · {item.quantity} × {money(item.unit_price)} · план {grams(item.planned_filament_grams)}</span><small className={item.product_match === "matched" ? "positive" : "negative"}>{item.product_match === "matched" ? `Сопоставлен с таблицей: ${item.product?.name} (${item.product?.marketplace}/${item.product?.marketplace_sku})` : `Не найдено точное соответствие ${order.marketplace}/${item.marketplace_sku} в таблице товаров`}</small></div><Summary label="Производство" value={order.profit_status === "incomplete" ? "Не рассчитано" : money(item.production_cost)} /><Summary label="Расходы площадки" value={money(item.allocated_marketplace_cost)} /><Summary label="Прибыль позиции" value={order.profit_status === "incomplete" ? "Не рассчитана" : money(item.profit)} strong /></div>)}</div>
      <div className="toolbar"><Status value={order.internal_status} />{!["cancelled", "delivered", "returned"].includes(order.internal_status) && <button className="button danger" onClick={cancel}>Отменить заказ</button>}</div>
    </aside></div>
  );
}

function PrintQueue({ state, refresh }: { state: State; refresh: () => Promise<void> }) {
  const [error, setError] = useState("");
  const [selectedPrinters, setSelectedPrinters] = useState<Record<string, string>>({});
  async function action(job: any, actionName: string) {
    const needsGrams = actionName === "fail" || actionName === "success";
    const entered = needsGrams ? window.prompt(actionName === "fail" ? "Сколько грамм ушло в брак?" : "Фактический расход, г (пусто = план):", actionName === "fail" ? "" : String(job.planned_grams)) : "";
    if (needsGrams && entered === null) return;
    try {
      await mutate(`/api/print-jobs/${job.id}`, {
        action: actionName,
        grams: entered,
        printer_id: selectedPrinters[job.id] || job.printer_id || "",
        usage_source: "manual",
      });
      await refresh();
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Ошибка"); }
  }
  const activeJobs = state.printJobs.filter((job) => job.status !== "success" && job.status !== "cancelled");
  const completed = state.printJobs.filter((job) => job.status === "success").slice(-10).reverse();
  return <div className="stack">{error && <div className="notice error">{error}</div>}<section className="panel"><PanelHead title="Очередь печати" /><div className="list">{activeJobs.map((job) => <div className="print-row" key={job.id}><div><strong>{job.item?.name}</strong><span>Заказ {job.order?.marketplace_order_id} · {job.product?.filament_material} {job.product?.filament_color}</span><small>План: {grams(job.planned_grams)}{job.printer?.name ? ` · ${job.printer.name}` : ""}</small></div><Status value={job.status} /><select aria-label={`Принтер для ${job.item?.name}`} value={selectedPrinters[job.id] ?? job.printer_id ?? ""} disabled={job.status === "printing"} onChange={(event) => setSelectedPrinters({ ...selectedPrinters, [job.id]: event.target.value })}><option value="">Без принтера</option>{state.printers.filter((printer) => printer.is_active).map((printer) => <option value={printer.id} key={printer.id}>{printer.name}</option>)}</select><div className="row-actions">{job.status !== "printing" && <button onClick={() => action(job, "start")}>Начать</button>}<button onClick={() => action(job, "success")}>Успешно</button><button className="danger-text" onClick={() => action(job, "fail")}>Брак</button></div></div>)}{!activeJobs.length && <Empty text="Очередь печати пуста" />}</div></section><section className="panel"><PanelHead title="Последние завершённые" /><div className="list">{completed.map((job) => <div className="list-row" key={job.id}><div><strong>{job.item?.name}</strong><span>{job.printer?.name || "Без принтера"} · источник: {usageSourceLabel(job.usage_source)}</span></div><Status value="success" /><b>{grams(job.actual_grams)}</b></div>)}{!completed.length && <Empty text="Завершённых печатей пока нет" />}</div></section></div>;
}

function Filament({ state }: { state: State }) {
  const groups = aggregateFilament(state);
  const audit = state.filamentAudit || {};
  const working = state.spools.filter((spool) => spool.status !== "archived");
  const initial = working.reduce((sum, item) => sum + item.initial_weight_grams, 0);
  const remaining = working.reduce((sum, item) => sum + item.remaining_weight_grams, 0);
  const reserved = working.reduce((sum, item) => sum + item.reserved_weight_grams, 0);
  return <div className="stack">
    <div className="metrics compact"><Metric label="Исходный вес" value={grams(initial)} /><Metric label="Текущий остаток" value={grams(remaining)} /><Metric label="Резерв" value={grams(reserved)} /><Metric label="Свободно" value={grams(remaining - reserved)} /></div>
    <section className="panel"><PanelHead title="Проверка импорта филамента" /><div className="summary-lines audit-grid"><Summary label="Строк в Google Sheet" value={String(audit.rowsRead || 0)} /><Summary label="Успешно импортировано" value={String(audit.imported || 0)} /><Summary label="Пропущено" value={String(audit.skipped || 0)} /><Summary label="Ошибок" value={String(audit.errors || 0)} /><Summary label="Активных катушек" value={String(audit.activeSpools || 0)} /><Summary label="Архивных катушек" value={String(audit.archivedSpools || 0)} /><Summary label="Вес Google Sheet" value={grams(audit.sourceWeightGrams || 0)} /><Summary label="Исходный вес импортированных в ERP" value={grams(audit.erpInitialWeightGrams || 0)} /><Summary label="Текущий вес импортированных в ERP" value={grams(audit.erpRemainingWeightGrams || 0)} /><Summary label="Расхождение" value={grams(audit.weightDifferenceGrams || 0)} /></div>{audit.warnings?.map((warning: string) => <div className="notice warning" key={warning}>{warning}</div>)}</section>
    <section className="panel table-scroll"><div className="table filament-table"><div className="table-row filament-head table-head"><span>Spool ID</span><span>Материал</span><span>Бренд / поставщик</span><span>Место</span><span>Вес</span><span>Остаток / резерв</span><span>За катушку</span><span>За кг</span><span>За грамм</span></div>{state.spools.map((spool: any) => <div className="table-row filament-head" key={spool.id}><span><b>{spool.id}</b><small>{spool.purchase_date || "дата не указана"}</small></span><span>{spool.material} · {spool.color}</span><span>{spool.brand || "—"}<small>{spool.supplier || "—"}</small></span><span>{spool.location || "—"}</span><span>{grams(spool.initial_weight_grams)}</span><span>{grams(spool.remaining_weight_grams)}<small>резерв {grams(spool.reserved_weight_grams)}</small></span><span>{rubles(spool.price_per_spool_rub)}</span><span>{rubles(spool.price_per_kg_rub)}</span><span>{rubles(spool.price_per_gram_rub)}</span></div>)}{!state.spools.length && <Empty text="Катушки ещё не импортированы" />}</div></section>
    <div className="card-grid">{groups.map((group) => <section className="filament-card" key={group.key}><div><span className="eyebrow">{group.material}</span><h2>{group.color}</h2></div><Summary label="Остаток" value={grams(group.remaining)} /><Summary label="Резерв" value={grams(group.reserved)} /><Summary label="Свободно" value={grams(group.available)} strong /><div className="forecast-list">{group.forecast.map((item) => <span key={item.id}>≈ {item.count} × {item.name}</span>)}</div></section>)}</div>
  </div>;
}

function Products({ state }: { state: State; refresh: () => Promise<void> }) {
  const items = state.orders.flatMap((order) => order.items || []);
  const matching = state.productMatching || { matchedItems: 0, unmatchedItems: 0, unmatched: [] };
  return <div className="stack">
    <div className="metrics compact"><Metric label="Позиций сопоставлено" value={String(matching.matchedItems || 0)} /><Metric label="Не найдено в таблице" value={String(matching.unmatchedItems || 0)} warning={matching.unmatchedItems > 0} /></div>
    {!!matching.unmatched?.length && <section className="panel"><PanelHead title="SKU заказов, которых нет в Google-таблице товаров" /><div className="notice warning">Сопоставление выполняется строго по паре marketplace + SKU. Название товара автоматически не используется.</div><div className="list">{matching.unmatched.map((row: any) => <div className="list-row" key={`${row.marketplace}:${row.sku}`}><div><strong>{row.marketplace} / {row.sku}</strong><span>{row.names.join(", ") || "Название не передано"} · заказы: {row.orderIds.join(", ")}</span></div><Status value="problem" /><b>{money(row.revenue)}</b></div>)}</div></section>}
    <section className="panel table-scroll"><div className="table product-table"><div className="table-row product-head table-head"><span>Артикул</span><span>Товар</span><span>Материал / цвет</span><span>Вес</span><span>Печать</span><span>Выручка</span><span>Себестоимость</span><span>Прибыль</span></div>{state.products.map((product) => {
    const productItems = items.filter((item: any) => item.product_id === product.id);
    const revenue = productItems.reduce((sum: number, item: any) => sum + item.revenue, 0);
    const cost = productItems.reduce((sum: number, item: any) => sum + item.production_cost + item.allocated_marketplace_cost, 0);
    const profit = productItems.reduce((sum: number, item: any) => sum + item.profit, 0);
    return <div className="table-row product-head" key={product.id}><span><b>{product.marketplace_sku}</b><small>{product.marketplace}</small></span><span><b>{product.name}</b></span><span>{product.filament_material} · {product.filament_color}</span><span>{grams(product.weight_grams)}</span><span>{product.print_time_minutes} мин</span><span>{money(revenue)}</span><span>{money(cost)}</span><b className={profit < 0 ? "negative" : "positive"}>{money(profit)}</b></div>;
  })}{!state.products.length && <Empty text="Откройте постоянную таблицу и добавьте товары" />}</div></section></div>;
}

function Finance({ state }: { state: State }) {
  const unmatched = state.financialOperations.filter((item) => item.match_status === "unmatched");
  const summary = state.financeSummary || { income: {}, marketplace: {}, production: {}, result: {} };
  const cash = summary.cash || {};
  return <div className="stack">
    <div className={`notice ${cash.scheduledOrders ? "" : "warning"}`}>{cash.scheduledOrders
      ? `Яндекс назначил ${cash.scheduledOrders} выплат. Ближайшая дата: ${formatDate(cash.nextPayoutDate)}.`
      : "Яндекс пока не передал ни одного платёжного поручения и ни одной даты выплаты. Поэтому точная сумма и дата поступления денег сейчас неизвестны."}</div>
    <div className="finance-cash-grid">
      <Metric label="Назначено к выплате банком" value={money(cash.scheduledPayout)} accent />
      <Metric label="Ближайшая дата выплаты" value={cash.nextPayoutDate ? formatDate(cash.nextPayoutDate) : "Не назначена"} warning={!cash.nextPayoutDate} />
      <Metric label="Уже подтверждено выплатой" value={money(cash.confirmedPayout)} />
      <Metric label="Операции PAYMENT из Яндекса" value={money(cash.yandexReportedPayments)} />
      <Metric label="Чистая прибыль доставленных" value={money(summary.result.earnedNetProfit)} />
      <Metric label="Черновой прогноз ERP" value={money(cash.erpForecast)} warning />
    </div>
    <div className="finance-explanation">
      <div><b>Прогноз ERP</b><span>Выручка минус известные удержания Яндекса. Это оценка, а не обещанная выплата.</span></div>
      <div><b>Операции PAYMENT</b><span>Суммы, попавшие в расчётные записи Яндекса. Они ещё не означают перевод в банк.</span></div>
      <div><b>Назначено банком</b><span>Только записи с номером платёжного поручения и датой выплаты.</span></div>
    </div>
    {!!summary.result.incompleteOrders && <div className="notice warning">В итог прибыли не включены {summary.result.incompleteOrders} заказов без рассчитанной себестоимости.</div>}
    <div className="finance-breakdown-grid"><section className="panel"><PanelHead title="Доход" /><div className="summary-lines"><Summary label="Выручка" value={money(summary.income.revenue)} /><Summary label="Возвраты" value={`− ${money(summary.income.returns)}`} /><Summary label="Компенсации" value={`+ ${money(summary.income.compensations)}`} /><Summary label="Скорректированная выручка" value={money(summary.income.adjustedRevenue)} strong /></div></section><section className="panel"><PanelHead title="Удержания маркетплейса" /><div className="summary-lines"><Summary label="Комиссия" value={money(summary.marketplace.commission)} /><Summary label="Логистика" value={money(summary.marketplace.logistics)} /><Summary label="Эквайринг" value={money(summary.marketplace.acquiring)} /><Summary label="Буст" value={money(summary.marketplace.boost)} /><Summary label="Хранение" value={money(summary.marketplace.storage)} /><Summary label="Штрафы" value={money(summary.marketplace.penalties)} /><Summary label="Прочие удержания" value={money(summary.marketplace.other)} /><Summary label="Всего" value={money(summary.marketplace.total)} strong /></div></section><section className="panel"><PanelHead title="Производство" /><div className="summary-lines"><Summary label="Филамент" value={money(summary.production.filamentCost)} /><Summary label="Упаковка" value={money(summary.production.packagingCost)} /><Summary label="Электричество" value={money(summary.production.electricityCost)} /><Summary label="Брак" value={money(summary.production.failedPrintCost)} /><Summary label="Extra cost" value={money(summary.production.extraCost)} /><Summary label="Общая себестоимость" value={money(summary.production.total)} strong /></div></section><section className="panel"><PanelHead title="Итог по полным заказам" /><div className="summary-lines"><Summary label="Валовая прибыль" value={money(summary.result.grossProfit)} /><Summary label="Чистая прибыль" value={money(summary.result.netProfit)} strong /><Summary label="Заказов с полной себестоимостью" value={String(summary.result.completeOrders || 0)} /></div></section></div>
    <section className="panel"><PanelHead title="По каким заказам рассчитаны деньги" /><div className="payout-list">{state.payoutSchedule.map((row) => <article className="payout-card" key={row.orderId}>
      <div className="payout-card-head"><div><strong>{row.names.join(", ") || "Товар без названия"}</strong><span>Заказ № {row.marketplaceOrderId} · {formatDateOnly(row.orderDate)}</span></div><Status value={row.internalStatus} /></div>
      <div className="payout-values">
        <Summary label="Выручка заказа" value={money(row.revenue)} />
        <Summary label="Удержания Яндекса" value={`− ${money(row.marketplaceDeductions)}`} />
        <Summary label="Прогноз ERP" value={money(row.forecastAmount)} strong />
        <Summary label="PAYMENT в отчёте" value={money(row.reportedPaymentAmount - row.reportedRefundAmount)} />
      </div>
      <div className={`payout-bank ${row.bankScheduled ? "scheduled" : ""}`}>
        <div><b>{row.bankScheduled ? `Выплата ${money(row.confirmedAmount)}` : "Выплата банком не назначена"}</b><span>{row.bankScheduled ? formatDate(row.payoutDate) : row.calculationDate ? `Расчёт Яндекса от ${formatDate(row.calculationDate)}` : "Расчёт Яндекса ещё не передан"}</span></div>
        <Status value={row.bankScheduled ? "paid" : row.status} />
      </div>
      {row.paymentOrderId && <small className="payment-order">Платёжное поручение: {row.paymentOrderId}</small>}
    </article>)}{!state.payoutSchedule.length && <Empty text="Яндекс ещё не передал сведения о расчётах" />}</div></section>
    <section className="panel"><PanelHead title="Непривязанные операции" /><div className="list">{unmatched.map((operation) => <div className="list-row" key={operation.id}><div><strong>{operation.description}</strong><span>{operation.marketplace_order_id || "Номер заказа не указан"}</span></div><Status value="unmatched" /><b>{money(operation.amount)}</b></div>)}{!unmatched.length && <Empty text="Все финансовые операции привязаны" />}</div></section>
  </div>;
}

function ImportPage({ refresh, setPage }: { refresh: () => Promise<void>; setPage: (page: Page) => void }) {
  const [status, setStatus] = useState<any>(null);
  const [message, setMessage] = useState("");
  const [reports, setReports] = useState<any[]>([]);
  const load = useCallback(async () => {
    const response = await fetch("/api/google-sheets/status", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error);
    setStatus(payload);
  }, []);
  useEffect(() => { void load().catch((error) => setMessage(error.message)); }, [load]);
  async function sync(type: "products" | "filament" | "all") {
    setMessage("Обновляю Google Sheets…");
    try {
      const result = await mutate("/api/google-sheets/sync", { type });
      const reports = [result.products, result.filament].filter(Boolean);
      setReports(reports);
      setMessage(reports.map((item) => `${sheetSourceLabel(item.source)} · строк: ${item.rowsRead}, импортировано: ${item.imported}, создано: ${item.created}, обновлено: ${item.updated}, пропущено: ${item.skipped}, ошибок: ${item.errors}`).join(" · "));
      await Promise.all([load(), refresh()]);
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Ошибка Google Sheets"); }
  }
  function settings() { window.location.hash = "google-sheets"; setPage("settings"); }
  const anyConfigured = Boolean(status?.products?.configured || status?.filament?.configured);
  const allConfigured = Boolean(status?.products?.configured && status?.filament?.configured);
  return <div className="stack">
    <section className="panel">
      <div className="settings-heading"><div><span className="eyebrow">Основной источник данных</span><h2>Google Sheets — основные таблицы данных</h2><p>Изменяйте товары и катушки в постоянных таблицах, затем обновляйте ERP без загрузки файлов.</p></div><Status value={allConfigured && status?.oauth?.connected ? "success" : "problem"} /></div>
      {!anyConfigured && <div className="notice warning">URL Google-таблиц не настроены. Добавьте их в разделе Настройки → Google Sheets.<div className="toolbar"><button className="button primary" onClick={settings}>Перейти к настройкам Google Sheets</button></div></div>}
      {anyConfigured && !status?.oauth?.connected && <div className="notice warning">URL таблиц сохранены. Без OAuth ERP попробует публичное чтение; для закрытых таблиц подключите Google или включите доступ «Все, у кого есть ссылка».<div className="toolbar"><button className="button primary" onClick={settings}>Настроить Google OAuth</button></div></div>}
      <div className="sheets-grid">
        <SheetCard title="Каталог товаров Google Sheets" description="Откройте Google-таблицу, добавьте или измените товары, затем нажмите «Обновить товары»." target={status?.products} openLabel="Открыть Google-таблицу товаров" syncLabel="Обновить товары" onSync={() => sync("products")} />
        <SheetCard title="Каталог филамента Google Sheets" description="Откройте Google-таблицу, добавьте катушки или измените остатки, затем нажмите «Обновить филамент»." target={status?.filament} openLabel="Открыть Google-таблицу филамента" syncLabel="Обновить филамент" onSync={() => sync("filament")} />
      </div>
      <div className="toolbar"><button className="button primary" disabled={!anyConfigured} onClick={() => sync("all")}><RefreshCcw size={18} /> Обновить сейчас</button></div>
      {message && <div className="notice">{message}</div>}
      <GoogleRowErrors reports={reports} />
    </section>
    <details className="panel fallback-import"><summary>Дополнительно: разовый импорт XLSX/CSV</summary><div className="import-grid"><ImportCard type="products" title="Разовый импорт товаров" template="/templates/products-template.xlsx" onDone={refresh} columns="marketplace, marketplace_sku, name, filament_material, filament_color, weight_grams, print_time_minutes, packaging_cost, extra_cost" /><ImportCard type="spools" title="Разовый импорт филамента" template="/templates/filament-template.xlsx" onDone={refresh} columns="material, color, brand, spool_weight_grams, remaining_weight_grams, price_per_spool, price_per_kg, purchase_date" /></div></details>
  </div>;
}

function SheetCard({ title, description, target, openLabel, syncLabel, onSync }: any) {
  const access = target?.accessible === true
    ? "Доступ подтверждён"
    : target?.accessible === false
      ? "Ошибка доступа"
      : "Доступ ещё не проверен";
  return <article className="sheet-card"><div><h3>{title}</h3><p>{description}</p></div><div className="summary-lines"><Summary label="Настройка таблицы" value={target?.configured ? "URL сохранён" : "URL не указан"} /><Summary label="Доступ" value={access} /><div className="summary"><span>URL таблицы</span>{target?.url ? <a className="sheet-url" href={target.url} title={target.url} target="_blank" rel="noopener noreferrer">{shortSheetUrl(target.url)}</a> : <b>не указан</b>}</div><Summary label="Источник" value={sheetSourceLabel(target?.source)} /><Summary label="Прочитано строк" value={String(target?.rowsRead || 0)} /><Summary label="Последняя успешная синхронизация" value={target?.lastSuccessfulSyncAt ? new Date(target.lastSuccessfulSyncAt).toLocaleString("ru-RU") : "ещё не выполнялась"} /><Summary label="Импортировано сейчас" value={String(target?.imported || target?.importedCount || 0)} /><Summary label="Последний результат" value={`Создано: ${target?.created || 0} · обновлено: ${target?.updated || 0} · пропущено: ${target?.skipped || 0} · ошибок: ${target?.errors || 0}`} />{target?.sourceWeightGrams > 0 && <><Summary label="Вес Google Sheet" value={grams(target.sourceWeightGrams)} /><Summary label="Вес ERP" value={grams(target.erpInitialWeightGrams)} /><Summary label="Расхождение" value={grams(target.weightDifferenceGrams)} /></>}</div>{target?.warnings?.map((warning: string) => <div className="notice warning" key={warning}>{warning}</div>)}{target?.lastError && <div className="notice error">{target.lastError}</div>}<div className="toolbar">{target?.url ? <a className="button primary" href={target.url} target="_blank" rel="noopener noreferrer">{openLabel}</a> : <span className="notice warning">URL таблицы не указан</span>}<button className="button ghost" disabled={!target?.canSync} onClick={onSync}>{syncLabel}</button></div></article>;
}

function GoogleRowErrors({ reports }: { reports: any[] }) {
  const errors = reports.flatMap((report) => report?.rowErrors || []);
  if (!errors.length) return null;
  return <div className="row-errors"><h3>Ошибки строк</h3><div className="table-scroll"><div className="row-errors-table filament-row-errors"><div className="row-error row-error-head"><span>Строка</span><span>Материал</span><span>Цвет</span><span>Вес</span><span>Цена</span><span>Поле</span><span>Причина</span></div>{errors.map((error: any, index: number) => <div className="row-error" key={`${error.row}-${error.field}-${index}`}><span>{error.row || "—"}</span><span>{error.material || "—"}</span><span>{error.color || "—"}</span><span>{error.weight || "—"}</span><span>{error.price || "—"}</span><span title={error.value}>{error.field || "—"}{error.value ? `: ${error.value}` : ""}</span><span>{error.reason}</span></div>)}</div></div></div>;
}

function sheetSourceLabel(source: string) {
  return source === "google_api" ? "Google API" : source === "public_csv" ? "Публичный CSV" : "Не определён";
}

function shortSheetUrl(url: string) {
  try {
    const parsed = new URL(url);
    const id = parsed.pathname.match(/\/d\/([^/]+)/)?.[1] || "";
    return `${parsed.hostname}/…/${id.slice(0, 10)}${id.length > 10 ? "…" : ""}`;
  } catch {
    return url;
  }
}

function ImportCard({ type, title, template, columns, onDone }: { type: string; title: string; template: string; columns: string; onDone: () => Promise<void> }) {
  const [result, setResult] = useState("");
  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResult("Импортирую…");
    try {
      const form = new FormData(event.currentTarget);
      const payload = await mutate(`/api/import/${type}`, form);
      setResult(`Создано: ${payload.result.created}, обновлено: ${payload.result.updated}`);
      await onDone();
    } catch (reason) { setResult(reason instanceof Error ? reason.message : "Ошибка"); }
  }
  return <form className="panel import-card" onSubmit={upload}><FileSpreadsheet size={32} /><h2>{title}</h2><p>{columns}</p><a className="button ghost" href={template} download>Скачать шаблон</a><label className="file-input"><input name="file" type="file" accept=".xlsx,.csv" required /><span>Выберите XLSX или CSV</span></label><button className="button primary">Импортировать</button>{result && <div className="notice">{result}</div>}</form>;
}

function SettingsPage({ state, refresh }: { state: State; refresh: () => Promise<void> }) {
  const [tab, setTab] = useState<"production" | "google" | "yandex" | "ozon" | "printers" | "tunnel" | "worker" | "storage">(
    typeof window !== "undefined" && window.location.hash === "#google-sheets" ? "google" : "production",
  );
  const tabs = [
    ["production", "Производство"],
    ["google", "Google Sheets"],
    ["yandex", "Яндекс Маркет"],
    ["ozon", "Ozon"],
    ["printers", "Принтеры"],
    ["tunnel", "Туннель"],
    ["worker", "Worker"],
    ["storage", "Хранилище"],
  ] as const;
  return <div className="stack"><div className="settings-tabs">{tabs.map(([id, label]) =>
    <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>)}</div>
    {tab === "production" && <ProductionSettings state={state} refresh={refresh} />}
    {tab === "google" && <GoogleSheetsSettings refresh={refresh} />}
    {tab === "yandex" && <IntegrationSettings provider="yandex" title="Яндекс Маркет" refresh={refresh} />}
    {tab === "ozon" && <IntegrationSettings provider="ozon" title="Ozon" refresh={refresh} />}
    {tab === "printers" && <PrinterSettings refreshState={refresh} />}
    {tab === "tunnel" && <TunnelSettings />}
    {tab === "worker" && <WorkerSettings />}
    {tab === "storage" && <StorageSettings />}
  </div>;
}

function GoogleSheetsSettings({ refresh }: { refresh: () => Promise<void> }) {
  const [info, setInfo] = useState<any>(null);
  const [status, setStatus] = useState<any>(null);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    const [settingsResponse, statusResponse] = await Promise.all([
      fetch("/api/integrations/google", { cache: "no-store" }),
      fetch("/api/google-sheets/status", { cache: "no-store" }),
    ]);
    const settingsPayload = await settingsResponse.json();
    const statusPayload = await statusResponse.json();
    if (!settingsResponse.ok) throw new Error(settingsPayload.error);
    if (!statusResponse.ok) throw new Error(statusPayload.error);
    setInfo(settingsPayload);
    setStatus(statusPayload);
  }, []);
  useEffect(() => { void load().catch((error) => setMessage(error.message)); }, [load]);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const values = Object.fromEntries(new FormData(event.currentTarget).entries());
      await mutate("/api/integrations/google", values, "PUT");
      setMessage("Настройки Google Sheets сохранены");
      event.currentTarget.reset();
      await load();
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Не удалось сохранить настройки"); }
  }
  async function disconnect() {
    await mutate("/api/google/oauth", undefined, "DELETE");
    setMessage("Google-аккаунт отключён");
    await load();
  }
  async function test() {
    try {
      const result = await mutate("/api/google-sheets/sync", { type: "products" });
      setMessage(result.products?.status === "error" ? "Проверка не пройдена" : "Подключение Google Sheets работает");
      await Promise.all([load(), refresh()]);
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Ошибка подключения"); }
  }
  async function copyCallback() {
    if (!status?.callbackUrl) return;
    try {
      await navigator.clipboard.writeText(status.callbackUrl);
      setMessage("Callback URL скопирован");
    } catch {
      setMessage("Не удалось скопировать callback URL");
    }
  }
  return <section className="panel settings-pane">
    <div className="settings-heading"><div><h2>Google Sheets</h2><p>Google-таблицы являются основным интерфейсом товаров и филамента.</p></div><Status value={status?.oauth?.connected ? "success" : "problem"} /></div>
    <div className="summary-lines">
      <Summary label="OAuth credentials" value={status?.oauth?.credentialsConfigured ? "Сохранены" : "Не настроены"} />
      <Summary label="Google OAuth" value={status?.oauth?.connected ? "Подключён" : "Не подключён"} />
      <Summary label="Таблица товаров" value={status?.products?.configured ? "URL сохранён" : "URL не указан"} />
      <Summary label="Таблица филамента" value={status?.filament?.configured ? "URL сохранён" : "URL не указан"} />
    </div>
    <div className={`notice ${status && !status.appUrlConfigured ? "error" : ""}`}>
      Callback URL для Google Cloud Console: <strong>{status?.callbackUrl || status?.appUrlError || "загружаю…"}</strong>
      {status?.callbackUrl && <div className="toolbar"><button type="button" className="button ghost" onClick={copyCallback}>Скопировать callback URL</button></div>}
    </div>
    <div className="form-panel oauth-debug">
      <h3>OAuth Debug</h3>
      <div className="summary-lines">
        <Summary label="APP_URL" value={status?.appUrl || "не задан"} />
        <Summary label="Generated callback URL" value={status?.callbackUrl || status?.appUrlError || "загружаю…"} />
        <Summary label="OAuth Client ID mask" value={status?.clientIdMask || "не настроен"} />
        <Summary label="Scopes" value={status?.scopes?.join("\n") || "загружаю…"} />
        <Summary label="OAuth status" value={status?.oauth?.status || "загружаю…"} />
        <Summary label="Последняя OAuth-ошибка" value={status?.oauth?.lastError || "нет"} />
        <Summary label="Environment" value={status?.environment || "загружаю…"} />
      </div>
    </div>
    <form className="form-panel" onSubmit={save}>
      <div className="settings-fields">
        <label><span>OAuth Client ID</span><input name="client_id" placeholder={info?.fields?.client_id?.configured ? "Сохранён, оставьте пустым без изменений" : "Client ID"} /></label>
        <label><span>OAuth Client Secret</span><input name="client_secret" type="password" placeholder={info?.fields?.client_secret?.configured ? "Сохранён, оставьте пустым без изменений" : "Client Secret"} /></label>
        <label><span>Products Sheet URL</span><input name="products_sheet_url" type="url" defaultValue={info?.fields?.products_sheet_url?.displayValue || ""} placeholder="https://docs.google.com/spreadsheets/d/..." /></label>
        <label><span>Filament Sheet URL</span><input name="filament_sheet_url" type="url" defaultValue={info?.fields?.filament_sheet_url?.displayValue || ""} placeholder="https://docs.google.com/spreadsheets/d/..." /></label>
      </div>
      <div className="toolbar"><button className="button primary">Сохранить</button>{status?.oauth?.credentialsConfigured && status?.appUrlConfigured && !status?.oauth?.connected && <a className="button ghost" href="/api/google/oauth/start">Подключить Google</a>}{status?.oauth?.connected && <><button type="button" className="button ghost" onClick={test}>Проверить подключение</button><button type="button" className="button danger" onClick={disconnect}>Отключить Google</button></>}</div>
    </form>
    <div className="sheets-grid"><SheetCard title="Товары" description="Постоянная таблица каталога." target={status?.products} openLabel="Открыть таблицу товаров" syncLabel="Обновить товары" onSync={() => mutate("/api/google-sheets/sync", { type: "products" }).then(refresh)} /><SheetCard title="Филамент" description="Постоянная таблица физических катушек." target={status?.filament} openLabel="Открыть таблицу филамента" syncLabel="Обновить филамент" onSync={() => mutate("/api/google-sheets/sync", { type: "filament" }).then(refresh)} /></div>
    {message && <div className="notice">{message}</div>}
  </section>;
}

function PrinterSettings({ refreshState }: { refreshState: () => Promise<void> }) {
  const [printers, setPrinters] = useState<any[]>([]);
  const [editing, setEditing] = useState<any>(null);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    const response = await fetch("/api/printers", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error);
    setPrinters(payload.statuses || payload.printers || []);
  }, []);
  useEffect(() => { void load().catch((error) => setMessage(error.message)); }, [load]);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    try {
      await mutate(editing?.id ? `/api/printers/${editing.id}` : "/api/printers", values, editing?.id ? "PUT" : "POST");
      setEditing(null);
      form.reset();
      setMessage("Принтер сохранён");
      await Promise.all([load(), refreshState()]);
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Ошибка"); }
  }
  async function test(id: string) {
    try { const result = await mutate(`/api/printers/${id}/test`); setMessage(result.message); await load(); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : "Ошибка"); }
  }
  async function remove(id: string) {
    if (!window.confirm("Удалить принтер?")) return;
    try { await mutate(`/api/printers/${id}`, undefined, "DELETE"); setMessage("Принтер удалён"); await Promise.all([load(), refreshState()]); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : "Ошибка"); }
  }
  return <div className="printer-settings-layout"><form key={editing?.id || "new"} className="panel form-panel settings-pane" onSubmit={save}><div><h2>{editing ? "Редактировать принтер" : "Новый принтер"}</h2><p>Access Code хранится только в зашифрованном виде.</p></div><div className="settings-fields"><label><span>Название</span><input name="name" required defaultValue={editing?.name || ""} /></label><label><span>Тип принтера</span><select name="type" defaultValue={editing?.type || "manual"}><option value="manual">Ручной</option><option value="bambu_lab">Bambu Lab</option></select></label><label><span>IP / Host</span><input name="host" defaultValue={editing?.host || ""} placeholder="192.168.1.50" /></label><label><span>Access Code {editing?.access_code_configured ? "· настроен" : ""}</span><input name="access_code" type="password" autoComplete="off" placeholder={editing?.access_code_configured ? "Оставьте пустым, чтобы не менять" : ""} /></label><label><span>Serial Number</span><input name="serial_number" defaultValue={editing?.serial_number || ""} /></label><label className="checkbox-label"><input name="is_active" type="checkbox" defaultChecked={editing?.is_active ?? true} /><span>Активен</span></label></div><div className="toolbar">{editing && <button type="button" className="button ghost" onClick={() => setEditing(null)}>Отмена</button>}<button className="button primary">Сохранить принтер</button></div></form><section className="panel settings-pane"><h2>Подключённые принтеры</h2><div className="list">{printers.map((printer) => <div className="printer-row" key={printer.id}><div><strong>{printer.name}</strong><span>{printer.type === "manual" ? "Ручной" : "Bambu Lab"} · {printer.host || "без host"} · {printer.serial_number || "без serial"}</span><small>{printer.status?.message || printer.last_status || "Не проверялся"}</small></div><Status value={printer.status?.state || (printer.is_active ? "idle" : "stopped")} /><div className="row-actions"><button onClick={() => test(printer.id)}>Проверить</button><button onClick={() => setEditing(printer)}>Изменить</button><button className="danger-text" onClick={() => remove(printer.id)}>Удалить</button></div></div>)}{!printers.length && <Empty text="Принтеры ещё не добавлены" />}</div>{message && <div className="notice">{message}</div>}</section></div>;
}

function ProductionSettings({ state, refresh }: { state: State; refresh: () => Promise<void> }) {
  const [message, setMessage] = useState("");
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await mutate("/api/settings", {
        defaultPackagingCost: Math.round(Number(form.get("packaging")) * 100),
        defaultElectricityCost: Math.round(Number(form.get("electricity")) * 100),
        warningFilamentLevel: Number(form.get("warning")),
        criticalFilamentLevel: Number(form.get("critical")),
      }, "PUT");
      setMessage("Настройки сохранены");
      await refresh();
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Ошибка"); }
  }
  return <form className="panel form-panel settings-pane" onSubmit={save}><h2>Производство</h2><p>Базовые расходы и уровни предупреждения для катушек.</p><div className="settings-fields"><label><span>Упаковка по умолчанию, ₽</span><input name="packaging" type="number" step="0.01" defaultValue={(state.settings.defaultPackagingCost || 0) / 100} /></label><label><span>Электричество на позицию, ₽</span><input name="electricity" type="number" step="0.01" defaultValue={(state.settings.defaultElectricityCost || 0) / 100} /></label><label><span>Предупреждение, г</span><input name="warning" type="number" defaultValue={state.settings.warningFilamentLevel || 300} /></label><label><span>Критический уровень, г</span><input name="critical" type="number" defaultValue={state.settings.criticalFilamentLevel || 100} /></label></div><div className="toolbar"><button className="button primary">Сохранить</button></div>{message && <div className="notice">{message}</div>}</form>;
}

function IntegrationSettings({ provider, title, refresh }: { provider: "yandex" | "ozon"; title: string; refresh: () => Promise<void> }) {
  const [info, setInfo] = useState<any>(null);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "error">("success");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState("");
  const fields = provider === "yandex"
    ? [
        { name: "api_key", label: "API Key", required: true, help: "Создайте токен в разделе «API и модули». Дайте доступ к заказам и финансовой отчётности.", href: "https://yandex.ru/dev/market/partner-api/doc/ru/concepts/api-key" },
        { name: "campaign_id", label: "Campaign ID", required: true, help: "Технический ID магазина. Не путайте с номером рекламной кампании.", href: "https://yandex.ru/dev/market/partner-api/doc/ru/reference/campaigns/getCampaign" },
        { name: "business_id", label: "Business ID", required: true, help: "ID кабинета. Его можно получить вместе с Campaign ID через список магазинов.", href: "https://yandex.ru/dev/market/partner-api/doc/ru/overview/" },
        { name: "oauth_token", label: "OAuth Token (необязательно)", required: false, help: "Нужен только для старых подключений. Для нового подключения используйте API Key.", href: "https://yandex.ru/dev/market/partner-api/doc/ru/concepts/authorization" },
      ]
    : [
        { name: "client_id", label: "Client ID", required: true, help: "Показывается в кабинете Ozon Seller на странице API-ключей.", href: "https://seller.ozon.ru/app/settings/api-keys" },
        { name: "api_key", label: "API Key", required: true, help: "Сгенерируйте Seller API-ключ. Для полной синхронизации удобнее ключ с правами администратора.", href: "https://docs.ozon.com/global/api/intro/" },
      ];
  const guide = provider === "yandex"
    ? {
        steps: [
          "Откройте кабинет продавца Яндекс Маркета.",
          "Нажмите на профиль → Настройки → API и модули.",
          "Создайте API-Key-токен с доступом к заказам и финансам.",
          "На этой же странице скопируйте Campaign ID. Business ID указан в данных кабинета.",
        ],
        cabinet: "https://partner.market.yandex.ru/",
        docs: "https://yandex.ru/dev/market/partner-api/doc/ru/concepts/api-key",
      }
    : {
        steps: [
          "Откройте кабинет Ozon Seller.",
          "Перейдите в Настройки → Seller API → API-ключи.",
          "Скопируйте Client ID и создайте новый API Key.",
          "Вставьте оба значения ниже и проверьте подключение.",
        ],
        cabinet: "https://seller.ozon.ru/app/settings/api-keys",
        docs: "https://docs.ozon.com/global/api/intro/",
      };
  const load = useCallback(async () => {
    const response = await fetch(`/api/integrations/${provider}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error);
    setInfo(payload);
    if (!payload.configured) setEditing(true);
  }, [provider]);
  useEffect(() => {
    void load().catch((error) => {
      setMessageType("error");
      setMessage(error.message);
    });
  }, [load]);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    setBusy("save");
    setMessage("");
    try {
      const saved = await mutate(`/api/integrations/${provider}`, values, "PUT");
      setInfo(saved);
      form.reset();
      setEditing(false);
      setMessageType("success");
      setMessage(`Настройки ${title} сохранены`);
      await load();
    } catch (reason) {
      setMessageType("error");
      setMessage(`Не удалось сохранить настройки. ${reason instanceof Error ? reason.message : "Неизвестная ошибка"}`);
    } finally {
      setBusy("");
    }
  }
  async function test() {
    setBusy("test");
    setMessage("");
    try {
      const result = await mutate(`/api/integrations/${provider}/test`);
      setMessageType("success");
      setMessage(result.message);
    } catch (reason) {
      setMessageType("error");
      setMessage(`Не удалось подключиться к ${title}. ${reason instanceof Error ? reason.message : "Неизвестная ошибка"}`);
    } finally {
      setBusy("");
    }
  }
  async function remove() {
    if (!window.confirm(`Удалить настройки ${title}?`)) return;
    try {
      await mutate(`/api/integrations/${provider}`, undefined, "DELETE");
      setMessageType("success");
      setMessage("Настройки удалены");
      setEditing(true);
      await load();
    } catch (reason) {
      setMessageType("error");
      setMessage(reason instanceof Error ? reason.message : "Ошибка");
    }
  }
  const showForm = editing || info?.configured === false;
  return <section className="panel settings-pane">
    <div className="settings-heading">
      <div><h2>{title}</h2><p>Секреты шифруются в XLSX и никогда не возвращаются в полном виде.</p></div>
      <Status value={info?.configured ? "success" : "problem"} />
    </div>
    <div className="integration-guide">
      <div><strong>Как получить ключи</strong><ol>{guide.steps.map((step) => <li key={step}>{step}</li>)}</ol></div>
      <div className="guide-links"><a className="button primary" href={guide.cabinet} target="_blank" rel="noreferrer">Открыть кабинет ↗</a><a className="button ghost" href={guide.docs} target="_blank" rel="noreferrer">Официальная инструкция ↗</a></div>
    </div>
    {info?.configured && <div className="saved-settings">
      <div className="saved-settings-head">
        <div><strong>Настройки сохранены</strong><span>Последнее сохранение: {info.lastSavedAt ? new Date(info.lastSavedAt).toLocaleString("ru-RU") : "неизвестно"}</span></div>
        {!editing && <button className="button ghost" onClick={() => setEditing(true)}>Изменить</button>}
      </div>
      <div className="saved-settings-grid">{fields.map((field) => {
        const status = info.fields?.[field.name];
        return <div className="saved-setting" key={field.name}><span>{field.label}</span><strong className={status?.configured ? "" : "negative"}>{status?.configured ? status.displayValue || status.mask || "сохранён" : "Не заполнено"}</strong></div>;
      })}</div>
    </div>}
    {showForm && <form className="form-panel integration-edit-form" onSubmit={save}>
      <div><h3>{info?.configured ? "Изменить настройки" : "Подключить интеграцию"}</h3><p>{info?.configured ? "Заполняйте только значения, которые нужно заменить." : "Заполните обязательные поля и сохраните настройки."}</p></div>
      <div className="settings-fields">{fields.map((field) => <label key={field.name}>
        <span>{field.label}</span>
        <input name={field.name} type={field.name.includes("key") || field.name.includes("token") ? "password" : "text"} autoComplete="off" required={field.required && !info?.fields?.[field.name]?.configured} placeholder={info?.fields?.[field.name]?.configured ? "Оставьте пустым, чтобы не менять" : "Введите значение"} />
        <small className="field-help">{field.help} <a href={field.href} target="_blank" rel="noreferrer">Где взять ↗</a></small>
      </label>)}</div>
      <div className="toolbar">
        {info?.configured && <button type="button" className="button ghost" onClick={() => setEditing(false)}>Отмена</button>}
        <button className="button primary" disabled={busy === "save"}>{busy === "save" ? "Сохраняю…" : "Сохранить"}</button>
      </div>
    </form>}
    <div className="integration-actions">
      {provider === "yandex" && <FullSyncControls refresh={refresh} />}
      <button className="button ghost" onClick={test} disabled={!info?.configured || Boolean(busy)}>{busy === "test" ? "Проверяю…" : "Проверить подключение"}</button>
      <SyncButton marketplace={provider} action="orders" label="Синхронизировать заказы" />
      <SyncButton marketplace={provider} action="statuses" label="Синхронизировать статусы" />
      <SyncButton marketplace={provider} action="finance" label="Синхронизировать финансы" />
      {info?.configured && <button type="button" className="button ghost danger-outline" onClick={remove}>Удалить настройки</button>}
    </div>
    {message && <div className={`notice ${messageType === "error" ? "error" : ""}`}>{message}</div>}
  </section>;
}

function SyncButton({ marketplace, action, label }: { marketplace: "yandex" | "ozon"; action: string; label: string }) {
  const [status, setStatus] = useState("");
  const [period, setPeriod] = useState("30");
  async function run() {
    setStatus("…");
    try { const result = await mutate(`/api/${marketplace}/sync`, { action, period: Number(period) }); setStatus(result.message || "Готово"); }
    catch (reason) { setStatus(reason instanceof Error ? reason.message : "Ошибка"); }
  }
  const showPeriod = marketplace === "yandex" && action === "orders";
  return <div className="sync-action">{showPeriod && <select aria-label="Период синхронизации заказов" value={period} onChange={(event) => setPeriod(event.target.value)}><option value="7">7 дней</option><option value="30">30 дней</option><option value="90">90 дней</option><option value="1095">Последние 3 года</option></select>}<button className="button ghost" onClick={run}>{label}</button>{status && <small>{status}</small>}</div>;
}

function TunnelSettings() {
  const [settings, setSettings] = useState<any>({ provider: "none", publicUrl: "" });
  const [message, setMessage] = useState("");
  useEffect(() => { fetch("/api/tunnel").then((response) => response.json()).then(setSettings).catch(() => setMessage("Не удалось загрузить настройки")); }, []);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const result = await mutate("/api/tunnel", Object.fromEntries(new FormData(event.currentTarget).entries()), "PUT");
      setSettings(result);
      setMessage("Настройки туннеля сохранены");
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Ошибка"); }
  }
  async function test() {
    try { const result = await mutate("/api/tunnel"); setMessage(result.message); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : "Ошибка"); }
  }
  return <form className="panel form-panel settings-pane" onSubmit={save}><h2>Публичный туннель</h2><p>Поддерживается готовый ручной HTTPS URL. Автозапуск ngrok и Cloudflare появится позже.</p><div className="settings-fields"><label><span>Режим</span><select name="provider" value={settings.provider} onChange={(event) => setSettings({ ...settings, provider: event.target.value })}><option value="none">Не использовать</option><option value="manual">Ручной HTTPS URL</option><option disabled>ngrok — позже</option><option disabled>Cloudflare — позже</option></select></label><label><span>Публичный HTTPS URL</span><input name="publicUrl" type="url" value={settings.publicUrl || ""} disabled={settings.provider !== "manual"} onChange={(event) => setSettings({ ...settings, publicUrl: event.target.value })} placeholder="https://example.ngrok.app" /></label></div><div className="toolbar"><button type="button" className="button ghost" onClick={test}>Проверить</button><button className="button primary">Сохранить</button></div>{message && <div className="notice">{message}</div>}</form>;
}

function WorkerSettings() {
  const [worker, setWorker] = useState<any>(null);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    const response = await fetch("/api/worker", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error);
    setWorker(payload);
  }, []);
  useEffect(() => { void load().catch((error) => setMessage(error.message)); }, [load]);
  async function action(name: string, extra: any = {}) {
    try { const result = await mutate("/api/worker", { action: name, ...extra }); setWorker(result); setMessage("Команда выполнена"); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : "Ошибка"); }
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await action("intervals", { intervals: { orders: Number(form.get("orders")), statuses: Number(form.get("statuses")), finance: Number(form.get("finance")), google_products: Number(form.get("google_products")), google_filament: Number(form.get("google_filament")) } });
  }
  return <section className="panel settings-pane"><div className="settings-heading"><div><h2>Worker</h2><p>Планировщик работает внутри Next.js и восстанавливается после перезапуска.</p></div><Status value={worker?.state || "stopped"} /></div><form className="form-panel" onSubmit={save}><div className="settings-fields"><label><span>Google товары, минут</span><input name="google_products" type="number" min="1" defaultValue={worker?.intervals?.google_products || 15} /></label><label><span>Google филамент, минут</span><input name="google_filament" type="number" min="1" defaultValue={worker?.intervals?.google_filament || 15} /></label><label><span>Заказы, минут</span><input name="orders" type="number" min="1" defaultValue={worker?.intervals?.orders || 5} /></label><label><span>Статусы, минут</span><input name="statuses" type="number" min="1" defaultValue={worker?.intervals?.statuses || 60} /></label><label><span>Финансы, минут</span><input name="finance" type="number" min="1" defaultValue={worker?.intervals?.finance || 1440} /></label></div><div className="toolbar"><button className="button ghost">Сохранить интервалы</button><button type="button" className="button ghost" onClick={() => action("run", { task: "all" })}>Выполнить сейчас</button><button type="button" className="button ghost" onClick={() => action("restart")}>Перезапустить</button>{worker?.enabled ? <button type="button" className="button danger" onClick={() => action("stop")}>Остановить</button> : <button type="button" className="button primary" onClick={() => action("start")}>Запустить</button>}</div></form>{worker?.lastRun && <p>Последний запуск: {new Date(worker.lastRun).toLocaleString("ru-RU")}</p>}{worker?.lastError && <div className="notice error">{worker.lastError}</div>}{message && <div className="notice">{message}</div>}</section>;
}

function StorageSettings() {
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    const response = await fetch("/api/storage/diagnostics", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error);
    setDiagnostics(payload);
  }, []);
  useEffect(() => { void load().catch((error) => setMessage(error.message)); }, [load]);
  async function backup() {
    try { const result = await mutate("/api/storage/backup"); setMessage(`Backup создан: ${result.files} файлов`); await load(); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : "Ошибка"); }
  }
  return <section className="panel settings-pane"><div className="settings-heading"><div><h2>XLSX-хранилище</h2><p className="path-value">{diagnostics?.path || "Проверяю…"}</p></div><Status value={diagnostics?.ok ? "success" : "problem"} /></div><div className="metrics compact"><Metric label="XLSX-файлов" value={String(diagnostics?.xlsxFiles || 0)} /><Metric label="Заказов" value={String(diagnostics?.orders || 0)} /><Metric label="Товаров" value={String(diagnostics?.products || 0)} /><Metric label="Катушек" value={String(diagnostics?.spools || 0)} /><Metric label="Движений" value={String(diagnostics?.movements || 0)} /><Metric label="Принтеров" value={String(diagnostics?.printers || 0)} /></div><div className="summary-lines"><Summary label="Последний backup" value={diagnostics?.latestBackup || "ещё не создавался"} /></div><div className="toolbar"><button className="button ghost" onClick={() => void load()}>Проверить хранилище</button><button className="button primary" onClick={backup}>Создать полный backup</button></div>{diagnostics?.errors?.length > 0 && <div className="notice error">Ошибки: {diagnostics.errors.join(", ")}</div>}{message && <div className="notice">{message}</div>}</section>;
}

function SyncStatusPanel({ state, refresh }: { state: State; refresh: () => Promise<void> }) {
  const report = state.latestSync;
  const latestError = state.syncIssues.find((issue) => issue.entryType === "error");
  return <div className="sync-status-panel">
    <div>
      <span className="eyebrow">Состояние синхронизации</span>
      <h2>{report ? syncStatusLabel(report.status) : "Полная синхронизация ещё не запускалась"}</h2>
      <p>{report ? `Последний запуск: ${new Date(report.finishedAt).toLocaleString("ru-RU")}` : "Запустите общий сценарий, чтобы загрузить заказы и финансы."}</p>
    </div>
    <div className="sync-status-metrics">
      <Summary label="Загружено заказов" value={String(report?.totals?.loadedOrders || 0)} />
      <Summary label="Problem-заказы" value={String(report?.totals?.problemOrders || 0)} />
      <Summary label="Технические ошибки" value={String(report?.totals?.technicalErrors || 0)} />
      <Summary label="Последняя ошибка" value={latestError?.message || "нет"} />
    </div>
    <FullSyncControls refresh={refresh} initialReport={report} />
  </div>;
}

function FullSyncControls({ refresh, initialReport = null }: { refresh: () => Promise<void>; initialReport?: any }) {
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState("");
  const [report, setReport] = useState<any>(initialReport);
  const [issues, setIssues] = useState<any[]>([]);
  const [showIssues, setShowIssues] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => { if (initialReport) setReport(initialReport); }, [initialReport]);

  async function runAll() {
    setRunning(true);
    setMessage("");
    setStep("Подготовка полной синхронизации");
    const poll = window.setInterval(async () => {
      try {
        const response = await fetch("/api/sync/all", { cache: "no-store" });
        const payload = await response.json();
        if (payload.currentStep) setStep(payload.currentStep);
      } catch {}
    }, 700);
    try {
      const result = await mutate("/api/sync/all", { period: 30 });
      setReport(result.report);
      setMessage("Синхронизация завершена");
      await refresh();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Синхронизация не выполнена");
    } finally {
      window.clearInterval(poll);
      setRunning(false);
      setStep("");
    }
  }

  async function retryProblems() {
    setRunning(true);
    setStep("Повторная обработка problem-заказов");
    try {
      const result = await mutate("/api/orders/problems/retry");
      setMessage(`Проверено: ${result.report.attempted}, исправлено: ${result.report.resolved}, осталось: ${result.report.remaining}`);
      await refresh();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Повторная обработка не выполнена");
    } finally {
      setRunning(false);
      setStep("");
    }
  }

  async function loadIssues() {
    try {
      const response = await fetch("/api/sync/issues?limit=100", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setIssues(payload.issues || []);
      setShowIssues(true);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Не удалось загрузить ошибки");
    }
  }

  return <div className="full-sync-controls">
    <div className="toolbar">
      <button className="button primary" onClick={runAll} disabled={running}><RefreshCcw size={17} className={running ? "spin" : ""} /> {running ? "Синхронизация…" : "Синхронизировать всё"}</button>
      <button className="button ghost" onClick={loadIssues} disabled={running}>Показать ошибки</button>
      <button className="button ghost" onClick={retryProblems} disabled={running}>Повторно обработать problem-заказы</button>
    </div>
    {step && <div className="sync-progress"><RefreshCcw size={16} className="spin" />{step}</div>}
    {message && <div className={`notice ${message.includes("не ") ? "error" : ""}`}>{message}</div>}
    {report && <SyncReport report={report} />}
    {showIssues && <SyncIssues issues={issues} close={() => setShowIssues(false)} />}
  </div>;
}

function SyncReport({ report }: { report: any }) {
  const seconds = Math.round((report.durationMs || 0) / 100) / 10;
  const googleValues = (step: any) => step?.status === "skipped"
    ? [step.reason === "oauth_not_connected"
      ? "URL настроен · OAuth не подключён · пропущено"
      : "URL не настроен · пропущено"]
    : [`Источник: ${sheetSourceLabel(step.source)}`, `Прочитано строк: ${step.rowsRead}`, `Импортировано: ${step.imported || 0}`, `Создано: ${step.created}`, `Обновлено: ${step.updated}`, `Пропущено: ${step.skipped || 0}`, `Ошибок: ${step.errors}`];
  return <div className="sync-report">
    <div className="sync-report-head"><div><strong>Итоговый отчёт</strong><span>{syncStatusLabel(report.status)} · {seconds} сек.</span></div><Status value={report.status} /></div>
    <div className="sync-report-grid">
      <SyncReportCard title="Google Sheets / Товары" values={googleValues(report.googleProducts)} />
      <SyncReportCard title="Google Sheets / Филамент" values={googleValues(report.googleFilament)} />
      <SyncReportCard title="Яндекс / Заказы" values={[`Загружено: ${report.yandexOrders.loaded}`, `Создано: ${report.yandexOrders.created}`, `Обновлено: ${report.yandexOrders.updated}`, `Problem: ${report.yandexOrders.problem}`, `Ошибок: ${report.yandexOrders.errors}`]} />
      <SyncReportCard title="Яндекс / Статусы" values={[`Загружено: ${report.yandexStatuses.loaded}`, `Обновлено: ${report.yandexStatuses.updated}`, `Production lock: ${report.yandexStatuses.productionLocked}`, `Ошибок: ${report.yandexStatuses.errors}`]} />
      <SyncReportCard title="Яндекс / Финансы" values={[`Загружено: ${report.yandexFinance.loaded}`, `Сопоставлено: ${report.yandexFinance.matched}`, `Не сопоставлено: ${report.yandexFinance.unmatched}`]} />
      <SyncReportCard title="Итог" values={[`Problem-заказов: ${report.totals.problemOrders}`, `Технических ошибок: ${report.totals.technicalErrors}`, `Прибыль пересчитана: ${report.profitRecalculated}`]} />
    </div>
  </div>;
}

function SyncReportCard({ title, values }: { title: string; values: string[] }) {
  return <div className="sync-report-card"><strong>{title}</strong>{values.map((value) => <span key={value}>{value}</span>)}</div>;
}

function SyncIssues({ issues, close }: { issues: any[]; close: () => void }) {
  return <div className="sync-issues">
    <div className="sync-report-head"><div><strong>Последние ошибки синхронизации</strong><span>Problem и технические ошибки показаны отдельно.</span></div><button className="icon-button" onClick={close}>×</button></div>
    <div className="issues-table">
      <div className="issues-row issues-head"><span>Время</span><span>Источник</span><span>Операция</span><span>Order ID</span><span>SKU</span><span>Код</span><span>Сообщение</span></div>
      {issues.map((issue) => <div className={`issues-row issue-${issue.entryType}`} key={issue.id}><span>{new Date(issue.createdAt).toLocaleString("ru-RU")}</span><span>{issue.source}</span><span>{issue.operation}</span><span>{issue.orderId || "—"}</span><span>{issue.sku || "—"}</span><span><b>{issue.code || "—"}</b><small>{issue.entryType === "problem" ? "problem" : "error"}</small></span><span>{issue.message || "—"}</span></div>)}
      {!issues.length && <Empty text="Ошибок и problem-заказов пока нет" />}
    </div>
  </div>;
}

function syncStatusLabel(status: string) {
  return ({
    success: "Успешно",
    completed_with_problems: "Завершено с problem-заказами",
    partial: "Завершено частично",
    failed: "Ошибка синхронизации",
  } as Record<string, string>)[status] || status;
}

function aggregateFilament(state: State): FilamentForecast[] {
  const map = new Map<string, Omit<FilamentForecast, "forecast"> & { forecast: { id: string; name: string; count: number }[] }>();
  state.spools.forEach((spool) => {
    const key = `${normalizeFilamentMaterial(spool.material)}::${normalizeFilamentColor(spool.color)}`;
    const group = map.get(key) || { key, material: spool.material, color: spool.color, remaining: 0, reserved: 0, available: 0, forecast: [] };
    group.remaining += spool.remaining_weight_grams;
    group.reserved += spool.reserved_weight_grams;
    group.available += spool.remaining_weight_grams - spool.reserved_weight_grams;
    map.set(key, group);
  });
  return [...map.values()].map((group) => ({
    ...group,
    forecast: state.products.filter((product) =>
      product.is_active
      && product.weight_grams > 0
      && normalizeFilamentMaterial(product.filament_material) === normalizeFilamentMaterial(group.material)
      && normalizeFilamentColor(product.filament_color) === normalizeFilamentColor(group.color))
      .map((product) => ({ id: product.id, name: product.name, count: Math.floor(group.available / product.weight_grams) }))
      .filter((item) => item.count > 0),
  }));
}

function Metric({ label, value, accent, danger, warning, onClick }: { label: string; value: string; accent?: boolean; danger?: boolean; warning?: boolean; onClick?: () => void }) {
  const content = <><span>{label}</span><strong>{value}</strong></>;
  return onClick ? <button className={`metric ${accent ? "accent-card" : ""} ${danger ? "danger-card" : ""} ${warning ? "warning-card" : ""}`} onClick={onClick}>{content}</button> : <div className={`metric ${accent ? "accent-card" : ""} ${danger ? "danger-card" : ""} ${warning ? "warning-card" : ""}`}>{content}</div>;
}
function PanelHead({ title, action, onClick }: { title: string; action?: string; onClick?: () => void }) { return <div className="panel-title"><h2>{title}</h2>{action && <button onClick={onClick}>{action} →</button>}</div>; }
function Status({ value }: { value: string }) { return <span className={`status status-${value}`}>{orderStatusLabel(value)}</span>; }
function Summary({ label, value, strong }: { label: string; value: string; strong?: boolean }) { return <div className="summary"><span>{label}</span>{strong ? <strong>{value}</strong> : <b>{value}</b>}</div>; }
function Empty({ text }: { text: string }) { return <div className="empty">{text}</div>; }
function usageSourceLabel(value: string) {
  return ({ planned: "план", manual: "ручной ввод", printer: "принтер", history: "история" } as Record<string, string>)[value] || "не указан";
}
function orderStatusLabel(value: string) {
  return ({
    new: "Новый", waiting_production: "Новый / ожидает печати", in_production: "В производстве",
    printed: "Напечатано", ready_to_ship: "Готово к отправке", assembling: "В сборке",
    in_transit: "В пути", delivered: "Доставлено", cancelled: "Отменён",
    returned: "Возврат", problem: "Проблемный", queued: "В очереди", printing: "Печать",
    success: "Успешно", failed: "Ошибка", stopped: "Остановлен", idle: "Ожидает",
    completed_with_problems: "Завершено с проблемами", partial: "Частично", unmatched: "Не сопоставлено",
    expected: "Ожидает платёжного поручения", paid: "Выплачено", refunded: "Возвращено",
    not_available: "Расчёт ещё не передан",
  } as Record<string, string>)[value] || value.replaceAll("_", " ");
}
function formatDate(value: string) {
  if (!value) return "не указана";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-");
    return `${day}.${month}.${year}`;
  }
  return new Date(value).toLocaleString("ru-RU");
}
function formatDateOnly(value: string) {
  return value ? new Date(value).toLocaleDateString("ru-RU") : "дата не указана";
}
function ordersToday(orders: any[]) {
  const today = new Date().toLocaleDateString("sv-SE");
  return orders.filter((order) => new Date(order.order_date).toLocaleDateString("sv-SE") === today);
}
