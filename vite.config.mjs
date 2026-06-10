import { defineConfig } from 'vite';

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function required(settings, fields) {
  const missing = fields.filter((field) => !String(settings[field] || '').trim());
  if (missing.length) {
    return `Не заполнено: ${missing.join(', ')}`;
  }
  return '';
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      message: payload?.message || payload?.error || text || `HTTP ${response.status}`,
      payload,
    };
  }

  return { ok: true, status: response.status, payload };
}

function formatRuDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }).replace(' г.', '');
}

function formatRuDateTime(value) {
  if (!value) return '';
  const text = String(value);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(text) || /T00:00:00/.test(text)) return formatRuDate(value);
  return date.toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
}

function firstDate(...values) {
  return values.find((value) => value && !Number.isNaN(new Date(value).getTime())) || '';
}

function moneyValue(value) {
  const number = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(number) ? number : 0;
}

function roundMoney(value) {
  return Math.round(moneyValue(value) * 100) / 100;
}

function ozonExpenseAmount(value) {
  const number = moneyValue(value);
  return number ? Math.abs(roundMoney(number)) : 0;
}

function ozonConfirmedExpense(value) {
  const number = moneyValue(value);
  return number < 0 ? Math.abs(roundMoney(number)) : 0;
}

function getOzonServiceLabel(key) {
  const labels = {
    MarketplaceServiceItemDirectFlowLogistic: 'Логистика до покупателя',
    MarketplaceServiceItemDropoffPVZ: 'Прием отправления в ПВЗ',
    MarketplaceServiceItemDropoffSC: 'Прием в сортировочном центре',
    MarketplaceServiceItemDropoffFF: 'Прием на фулфилменте',
    MarketplaceServiceItemRedistributionDropOffApvz: 'Перераспределение после приема в ПВЗ',
    MarketplaceServiceItemRedistributionLastMileCourier: 'Последняя миля курьером',
    MarketplaceServiceItemFulfillment: 'Обработка отправления',
    MarketplaceServiceItemPickup: 'Забор отправления',
    MarketplaceServiceItemReturnFlowLogistic: 'Обратная логистика',
    MarketplaceServiceItemDelivToCustomer: 'Доставка до покупателя',
    MarketplaceServiceItemReturnNotDelivToCustomer: 'Возврат недоставленного',
    MarketplaceServiceItemReturnAfterDelivToCustomer: 'Возврат после доставки',
    MarketplaceServiceItemReturnPartGoodsCustomer: 'Частичный возврат покупателя',
    MarketplaceRedistributionOfAcquiringOperation: 'Эквайринг / платежи',
    MarketplaceServiceItemAcquiring: 'Эквайринг / платежи',
    commission_amount: 'Комиссия площадки',
    actions_amount: 'Акции, баллы, скидки продавца',
    total_discount_value: 'Скидки и акции',
    acquiring: 'Эквайринг / платежи',
    acquiring_amount: 'Эквайринг / платежи',
    marketplace_service_item_acquiring: 'Эквайринг / платежи',
    marketplace_service_item_fulfillment: 'Обработка отправления',
    marketplace_service_item_pickup: 'Забор отправления',
    marketplace_service_item_dropoff_pvz: 'Прием в ПВЗ',
    marketplace_service_item_dropoff_sc: 'Прием в сортировочном центре',
    marketplace_service_item_dropoff_ff: 'Прием на фулфилменте',
    marketplace_service_item_direct_flow_trans: 'Магистраль до покупателя',
    marketplace_service_item_return_flow_trans: 'Обратная магистраль',
    marketplace_service_item_deliv_to_customer: 'Доставка до покупателя',
    marketplace_service_item_return_not_deliv_to_customer: 'Возврат недоставленного',
    marketplace_service_item_return_part_goods_customer: 'Частичный возврат покупателя',
    marketplace_service_item_return_after_deliv_to_customer: 'Возврат после доставки',
  };
  if (labels[key]) return labels[key];
  const normalized = key
    .replace(/^marketplace_service_item_/i, '')
    .replace(/^MarketplaceServiceItem/, '')
    .replace(/([a-zа-я])([A-ZА-Я])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\bPVZ\b/g, 'ПВЗ')
    .replace(/\bSC\b/g, 'СЦ')
    .replace(/\bFF\b/g, 'фулфилмент')
    .trim();
  return normalized || key;
}

function pushOzonServiceRows(rows, services, source, prefix) {
  Object.entries(services || {}).forEach(([key, value]) => {
    const amount = ozonExpenseAmount(value);
    if (!amount) return;
    rows.push({
      id: `${prefix}-${key}`,
      label: getOzonServiceLabel(key),
      amount,
      status: 'confirmed',
      source,
    });
  });
}

function pushOzonMoneyRow(rows, id, label, amount, source) {
  const value = ozonExpenseAmount(amount);
  if (!value) return;
  rows.push({
    id,
    label,
    amount: value,
    status: 'confirmed',
    source,
  });
}

function isMoneyLikeOzonPromoField(field) {
  const value = field.toLowerCase();
  if (value.includes('percent') || value.includes('percentage') || value.includes('rate')) return false;
  if (value === 'total_discount_value') return false;
  return /(bonus|cashback|promo|loyalty|action)/i.test(field);
}

function pushOzonPromoRows(rows, product, index) {
  const rowId = product.product_id || index;
  const source = 'Ozon financial_data.products';
  const knownFields = [
    ['actions_amount', 'Акции Ozon / маркетплейса'],
    ['customer_bonus', 'Баллы покупателя'],
    ['bonus_amount', 'Баллы покупателя'],
    ['cashback_amount', 'Кешбэк / баллы'],
    ['loyalty_discount', 'Программа лояльности'],
  ];

  const used = new Set();
  knownFields.forEach(([field, label]) => {
    if (product[field] === undefined || product[field] === null) return;
    used.add(field);
    pushOzonMoneyRow(rows, `ozon-promo-${field}-${rowId}`, label, product[field], source);
  });

  Object.entries(product).forEach(([field, value]) => {
    if (used.has(field) || !isMoneyLikeOzonPromoField(field)) return;
    pushOzonMoneyRow(
      rows,
      `ozon-promo-${field}-${rowId}`,
      getOzonServiceLabel(field),
      value,
      source,
    );
  });
}

function getFinancePostingNumber(operation) {
  return String(
    operation.posting?.posting_number
      || operation.posting_number
      || operation.posting?.postingNumber
      || operation.postingNumber
      || '',
  );
}

function addFinanceRow(group, row) {
  if (!row.amount) return;
  const existing = group.adjustments.find((item) => item.label === row.label && item.source === row.source);
  if (existing) {
    existing.amount = roundMoney(existing.amount + row.amount);
  } else {
    group.adjustments.push(row);
  }
}

function getOzonFinanceLabel(operation) {
  const label = operation.operation_type_name
    || operation.operation_type
    || operation.type
    || 'Списание Ozon';
  return getOzonServiceLabel(label);
}

function buildOzonFinanceByPosting(operations) {
  const byPosting = new Map();

  operations.forEach((operation, index) => {
    const postingNumber = getFinancePostingNumber(operation);
    if (!postingNumber) return;

    const group = byPosting.get(postingNumber) || {
      reportSale: 0,
      reportNet: 0,
      adjustments: [],
    };
    const source = 'Финансовый отчет Ozon';
    const sale = moneyValue(operation.accruals_for_sale);
    if (sale > 0) group.reportSale = roundMoney(group.reportSale + sale);
    group.reportNet = roundMoney(group.reportNet + moneyValue(operation.amount));
    const rowsBeforeOperation = group.adjustments.length;
    const services = operation.services || [];

    addFinanceRow(group, {
      id: `ozon-report-commission-${index}`,
      label: 'Комиссия за продажу',
      amount: ozonConfirmedExpense(operation.sale_commission),
      direction: 'expense',
      status: 'confirmed',
      source,
    });

    if (!services.length) {
      addFinanceRow(group, {
        id: `ozon-report-logistics-${index}`,
        label: 'Логистика',
        amount: ozonConfirmedExpense(operation.delivery_charge),
        direction: 'expense',
        status: 'confirmed',
        source,
      });

      addFinanceRow(group, {
        id: `ozon-report-return-logistics-${index}`,
        label: 'Обратная логистика',
        amount: ozonConfirmedExpense(operation.return_delivery_charge),
        direction: 'expense',
        status: 'confirmed',
        source,
      });
    }

    services.forEach((service, serviceIndex) => {
      addFinanceRow(group, {
        id: `ozon-report-service-${index}-${serviceIndex}`,
        label: getOzonServiceLabel(service.name || service.service_name || 'Услуга Ozon'),
        amount: ozonConfirmedExpense(service.price),
        direction: 'expense',
        status: 'confirmed',
        source,
      });
    });

    const hasDetailedRows = group.adjustments.length > rowsBeforeOperation;
    const amount = moneyValue(operation.amount);
    if (!hasDetailedRows && amount < 0) {
      addFinanceRow(group, {
        id: `ozon-report-operation-${index}`,
        label: getOzonFinanceLabel(operation),
        amount: ozonExpenseAmount(amount),
        direction: 'expense',
        status: 'confirmed',
        source,
      });
    } else if (!hasDetailedRows && amount > 0 && !sale) {
      addFinanceRow(group, {
        id: `ozon-report-income-${index}`,
        label: getOzonFinanceLabel(operation),
        amount: roundMoney(amount),
        direction: 'income',
        status: 'confirmed',
        source,
      });
    }

    byPosting.set(postingNumber, group);
  });

  byPosting.forEach((group, postingNumber) => {
    if (group.reportSale <= 0) return;

    const detailedNetExpense = group.adjustments.reduce(
      (sum, row) => sum + (row.direction === 'income' ? -row.amount : row.amount),
      0,
    );
    const reportNetExpense = group.reportSale - group.reportNet;
    const difference = roundMoney(reportNetExpense - detailedNetExpense);

    if (difference > 0) {
      addFinanceRow(group, {
        id: `ozon-report-balance-expense-${postingNumber}`,
        label: 'Прочие списания и корректировки Ozon',
        amount: difference,
        direction: 'expense',
        status: 'confirmed',
        source: 'Сверка с итогом финансового отчета Ozon',
      });
    } else if (difference < 0) {
      addFinanceRow(group, {
        id: `ozon-report-balance-income-${postingNumber}`,
        label: 'Компенсации и корректировки Ozon',
        amount: Math.abs(difference),
        direction: 'income',
        status: 'confirmed',
        source: 'Сверка с итогом финансового отчета Ozon',
      });
    }
  });

  return byPosting;
}

async function fetchOzonFinanceReport(settings, since, to) {
  const operations = [];
  const pageSize = 1000;

  for (let page = 1; page <= 10; page += 1) {
    const result = await fetchJson('https://api-seller.ozon.ru/v3/finance/transaction/list', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Client-Id': String(settings['Client ID']).trim(),
        'Api-Key': String(settings['API key']).trim(),
      },
      body: JSON.stringify({
        filter: {
          date: {
            from: since.toISOString(),
            to: to.toISOString(),
          },
          operation_type: [],
          posting_number: '',
          transaction_type: 'all',
        },
        page,
        page_size: pageSize,
      }),
    });

    if (!result.ok) return result;

    const pageOperations = result.payload?.result?.operations
      || result.payload?.result?.items
      || result.payload?.operations
      || [];
    operations.push(...pageOperations);

    const pageCount = Number(result.payload?.result?.page_count || result.payload?.result?.pageCount || 0);
    if ((pageCount && page >= pageCount) || pageOperations.length < pageSize) break;
  }

  return {
    ok: true,
    operations,
    byPosting: buildOzonFinanceByPosting(operations),
  };
}

function getOzonAdjustments(posting) {
  const financial = posting.financial_data || {};
  const rows = [];

  (financial.products || []).forEach((product, index) => {
    const commission = ozonExpenseAmount(product.commission_amount);
    if (commission) {
      rows.push({
        id: `ozon-commission-${product.product_id || index}`,
        label: 'Комиссия площадки',
        amount: commission,
        status: 'confirmed',
        source: 'Ozon financial_data.products',
      });
    }

    pushOzonPromoRows(rows, product, index);

    pushOzonServiceRows(
      rows,
      product.item_services,
      'Ozon financial_data.products.item_services',
      `ozon-product-service-${product.product_id || index}`,
    );
  });

  pushOzonServiceRows(rows, financial.posting_services, 'Ozon financial_data.posting_services', 'ozon-service');

  const uniqueRows = new Map();
  rows.forEach((row) => {
    uniqueRows.set(row.id, row);
  });
  return Array.from(uniqueRows.values());
}

function getOzonStatusHint(posting) {
  return [
    posting.status,
    posting.substatus,
    posting.delivery_status,
    posting.fulfillment_status,
    posting.logistics_status,
    posting.analytics_data?.delivery_status,
    posting.financial_data?.posting_services?.status,
  ]
    .filter(Boolean)
    .join(' ');
}

function mapMarketplaceStatus(status) {
  const value = String(status || '').toLowerCase();
  if (value.includes('delivered') || value.includes('получ') || value.includes('доставлен')) return 'Доставлен';
  if (value.includes('pickup') || value.includes('пвз') || value.includes('pick-up') || value.includes('pick_up') || value.includes('arrived') || value.includes('ready_for_pickup') || value.includes('awaiting_client')) return 'Доставлен в ПВЗ';
  if (value.includes('delivering') || value.includes('delivery') || value.includes('достав')) return 'Доставляется';
  if (value.includes('awaiting_packaging') || value.includes('acceptance') || value.includes('new')) return 'Новый';
  if (value.includes('awaiting_deliver')) return 'Упакован';
  if (value.includes('ship') || value.includes('отгруж')) return 'Отгружен';
  return 'Новый';
}

function mapOzonOrders(postings, allowedStatuses, financeByPosting = new Map()) {
  const allowed = new Set(allowedStatuses);
  return postings.filter((posting) => allowed.has(String(posting.status || '').toLowerCase())).map((posting) => {
    const products = posting.products || [];
    const firstProduct = products[0] || {};
    const price = products.reduce((sum, product) => sum + Number(product.price || 0) * Number(product.quantity || 1), 0);
    const marketplaceStatusHint = getOzonStatusHint(posting);
    const status = mapMarketplaceStatus(marketplaceStatusHint);
    const pickedUpAt = status === 'Доставлен'
      ? firstDate(posting.delivering_date, posting.delivered_at, posting.last_changed_status_date, posting.status_changed_at, posting.updated_at)
      : '';
    const pvzDeliveredAt = status === 'Доставлен'
      ? firstDate(posting.pickup_point_arrived_at, posting.arrived_at)
      : firstDate(posting.delivering_date);
    const id = posting.posting_number || posting.order_number || posting.order_id;
    const reportFinance = financeByPosting.get(String(id));
    return {
      id,
      channel: 'Ozon',
      source: posting.delivery_method?.name || posting.warehouse?.name || 'Ozon',
      sku: firstProduct.offer_id || firstProduct.sku || '',
      marketplaceProductName: firstProduct.name || firstProduct.offer_name || '',
      quantity: products.reduce((sum, product) => sum + Number(product.quantity || 1), 0) || 1,
      price: reportFinance?.reportSale || Math.round(price),
      adjustments: reportFinance?.adjustments || [],
      marketplaceNet: reportFinance?.reportNet,
      financeReportLoaded: financeByPosting.size > 0,
      due: formatRuDate(posting.shipment_date || posting.in_process_at),
      status,
      marketplaceStatus: marketplaceStatusHint || posting.status || '',
      dates: {
        received: formatRuDateTime(posting.in_process_at || posting.created_at),
        shipped: formatRuDateTime(posting.shipment_date),
        pvzDelivered: formatRuDateTime(pvzDeliveredAt),
        pickedUp: formatRuDateTime(pickedUpAt),
      },
    };
  }).filter((order) => order.id && order.sku);
}

function mapWildberriesOrders(orders) {
  return orders.map((order) => ({
    id: String(order.id || order.rid || order.srid || ''),
    channel: 'Wildberries',
    source: 'Wildberries API',
    sku: String(order.article || order.vendorCode || order.nmId || ''),
    quantity: 1,
    price: Math.round(Number(order.convertedPrice || order.price || 0) / (Number(order.convertedPrice || order.price || 0) > 10000 ? 100 : 1)),
    due: formatRuDate(order.createdAt || order.createdDate),
    status: 'Новый',
    marketplaceStatus: order.status || '',
    dates: {
      received: formatRuDateTime(order.createdAt || order.createdDate),
      shipped: '',
      pvzDelivered: '',
      pickedUp: '',
    },
  })).filter((order) => order.id && order.sku);
}

function mapYandexOrders(orders) {
  return orders.map((order) => {
    const firstItem = order.items?.[0] || {};
    const total = Number(order.buyerTotal || order.total || order.itemsTotal || firstItem.buyerPrice || firstItem.price || 0);
    return {
      id: String(order.id || ''),
      channel: 'Яндекс',
      source: 'Маркет FBS',
      sku: firstItem.offerId || firstItem.shopSku || firstItem.marketSku || '',
      quantity: Number(firstItem.count || 1),
      price: Math.round(total),
      due: formatRuDate(order.delivery?.shipments?.[0]?.shipmentDate || order.creationDate),
      status: mapMarketplaceStatus(order.status),
      marketplaceStatus: order.status || '',
      dates: {
        received: formatRuDateTime(order.creationDate),
        shipped: formatRuDateTime(order.delivery?.shipments?.[0]?.shipmentDate),
        pvzDelivered: '',
        pickedUp: '',
      },
    };
  }).filter((order) => order.id && order.sku);
}

async function syncOzon(settings) {
  const missing = required(settings, ['Client ID', 'API key']);
  if (missing) return { ok: false, message: missing };

  const to = new Date();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const activeStatuses = ['awaiting_packaging', 'awaiting_deliver', 'delivering'];
  const historyStatuses = ['delivered'];
  const statuses = [...activeStatuses, ...historyStatuses];
  const requests = await Promise.all(
    statuses.map((status) =>
      fetchJson('https://api-seller.ozon.ru/v3/posting/fbs/list', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Client-Id': String(settings['Client ID']).trim(),
          'Api-Key': String(settings['API key']).trim(),
        },
        body: JSON.stringify({
          dir: 'ASC',
          filter: {
            since: since.toISOString(),
            to: to.toISOString(),
            status,
          },
          limit: 100,
          offset: 0,
          with: {
            analytics_data: true,
            financial_data: true,
          },
        }),
      }),
    ),
  );
  const failed = requests.find((result) => !result.ok);
  if (failed) return failed;

  const postingsById = new Map();
  requests.forEach((result) => {
    (result.payload?.result?.postings || []).forEach((posting) => {
      const id = posting.posting_number || posting.order_number || posting.order_id;
      if (id) postingsById.set(id, posting);
    });
  });
  const postings = Array.from(postingsById.values());
  const financeReport = await fetchOzonFinanceReport(settings, since, to);
  const financeByPosting = financeReport.ok ? financeReport.byPosting : new Map();
  const activeOrders = mapOzonOrders(postings, activeStatuses, financeByPosting);
  const historyOrders = mapOzonOrders(postings, historyStatuses, financeByPosting);
  const orders = [...activeOrders, ...historyOrders];

  return {
    ok: true,
    count: orders.length,
    message: `Ozon ответил: рабочих ${activeOrders.length}, в истории ${historyOrders.length}. Фин. отчет: ${financeReport.ok ? `${financeReport.operations.length} операций` : `не загрузился (${financeReport.message})`}.`,
    orders,
    payload: {
      result: {
        postings,
      },
    },
  };
}

async function syncWildberries(settings) {
  const token = settings['Token статистики'] || settings['Token контента'] || settings['Token цен'];
  if (!String(token || '').trim()) return { ok: false, message: 'Не заполнен token Wildberries' };

  const result = await fetchJson('https://marketplace-api.wildberries.ru/api/v3/orders/new', {
    headers: {
      Authorization: String(token).trim(),
    },
  });

  if (!result.ok) return result;
  const orders = result.payload?.orders || [];
  return {
    ok: true,
    count: orders.length,
    message: `Wildberries ответил: новых заказов ${orders.length}.`,
    orders: mapWildberriesOrders(orders),
    payload: result.payload,
  };
}

async function syncYandex(settings) {
  const missing = required(settings, ['OAuth token', 'Campaign ID']);
  if (missing) return { ok: false, message: missing };

  const to = new Date();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const formatDate = (date) => date.toISOString().slice(0, 10);
  const url = new URL(`https://api.partner.market.yandex.ru/campaigns/${String(settings['Campaign ID']).trim()}/orders`);
  url.searchParams.set('fromDate', formatDate(since));
  url.searchParams.set('toDate', formatDate(to));
  url.searchParams.set('pageSize', '50');

  const result = await fetchJson(url, {
    headers: {
      Authorization: `OAuth ${String(settings['OAuth token']).trim()}`,
    },
  });

  if (!result.ok) return result;
  const orders = result.payload?.orders || [];
  return {
    ok: true,
    count: orders.length,
    message: `Яндекс ответил: получено ${orders.length} заказов за 30 дней.`,
    orders: mapYandexOrders(orders),
    payload: result.payload,
  };
}

function marketplaceSyncPlugin() {
  return {
    name: 'satori-marketplace-sync',
    configureServer(server) {
      server.middlewares.use('/api/marketplace-sync', async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, message: 'Метод не поддерживается' });
          return;
        }

        try {
          const { marketplace, settings = {} } = await readJson(req);
          let result;
          if (marketplace === 'ozon') result = await syncOzon(settings);
          else if (marketplace === 'wildberries') result = await syncWildberries(settings);
          else if (marketplace === 'yandex') result = await syncYandex(settings);
          else if (marketplace === 'manual') result = { ok: true, message: 'Ручной канал сохранен. API для него не требуется.', count: 0 };
          else result = { ok: false, message: 'Неизвестная интеграция' };

          sendJson(res, result.ok ? 200 : 400, result);
        } catch (error) {
          sendJson(res, 500, {
            ok: false,
            message: error?.message || 'Не удалось выполнить синхронизацию',
          });
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [marketplaceSyncPlugin()],
});
