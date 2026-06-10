import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { apiError } from "@/lib/http";
import { orderProblemDetails } from "@/lib/services/order-diagnostics-service";
import { buildOrderProfitBreakdown } from "@/lib/services/profit-breakdown-service";
import { storage } from "@/lib/storage";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireSession();
    const { id } = await context.params;
    const database = await storage.read();
    const order = database.orders.find((candidate) => candidate.id === id);
    if (!order) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
    const productsById = new Map(database.products.map((item) => [item.id, item]));
    return NextResponse.json({
      order: {
        ...order,
        items: database.order_items.filter((item) => item.order_id === order.id).map((item) => ({
          ...item,
          product: productsById.get(item.product_id) || null,
          product_match: item.product_id ? "matched" : "missing",
        })),
        operations: database.financial_operations.filter((item) => item.order_id === order.id),
        profit_status: order.profit_status,
        profitBreakdown: buildOrderProfitBreakdown(database, order),
        problemDetails: orderProblemDetails(database, order),
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
