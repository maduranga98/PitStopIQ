import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, Timestamp, where } from "firebase/firestore";
import {
  Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { db } from "../../config/firebase";
import { downloadCSV } from "../../lib/csvExport";
import type { Supplier, SupplierSupply } from "../../types/auth";
import {
  CHART_TOOLTIP_STYLE, formatDate, formatLKR, monthlyTotals,
} from "../../lib/reportFormat";
import { EmptyNote, ReportCard, StatTiles } from "./reportUi";

// What the workshop bought, from whom, and at what cost. Everything here comes
// off the goods-received records, so it answers the two questions an owner
// actually asks about buying: where is the money going, and which supplier is
// carrying the business.

interface Props {
  centerId: string;
  startDate: Date;
  endDate: Date;
}

interface SupplierRow {
  supplierId: string;
  name: string;
  company: string;
  brand: string;
  deliveries: number;
  spend: number;
  lastSupply: Timestamp | null;
}

interface ItemRow {
  itemName: string;
  unit: string;
  quantity: number;
  spend: number;
  lastPrice: number;
}

interface Loaded {
  /** The centre + date range this data answers for. */
  key: string;
  supplies: SupplierSupply[];
  suppliers: Supplier[];
  error: string;
}

export default function SupplierReport({ centerId, startDate, endDate }: Props) {
  // Held together with the range it was fetched for, so "loading" is simply
  // "what we have doesn't answer the question being asked" — and a slow reply
  // for an old range can never overwrite a newer one.
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const rangeKey = `${centerId}:${startDate.getTime()}:${endDate.getTime()}`;

  useEffect(() => {
    if (!centerId) return;
    Promise.all([
      getDocs(query(
        collection(db, "servicecenters", centerId, "supplierSupplies"),
        where("createdAt", ">=", Timestamp.fromDate(startDate)),
        where("createdAt", "<=", Timestamp.fromDate(endDate)),
      )),
      getDocs(collection(db, "servicecenters", centerId, "suppliers")),
    ]).then(([supplySnap, supplierSnap]) => {
      setLoaded({
        key: rangeKey,
        supplies: supplySnap.docs.map(d => ({ id: d.id, ...d.data() } as SupplierSupply)),
        suppliers: supplierSnap.docs.map(d => ({ id: d.id, ...d.data() } as Supplier)),
        error: "",
      });
    }).catch(() => {
      setLoaded({ key: rangeKey, supplies: [], suppliers: [], error: "Could not load supplier data." });
    });
    // startDate/endDate are folded into rangeKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey]);

  const fresh = loaded?.key === rangeKey ? loaded : null;
  const loading = fresh === null;
  const error = fresh?.error ?? "";
  const supplies = useMemo(() => fresh?.supplies ?? [], [fresh]);
  const suppliers = useMemo(() => fresh?.suppliers ?? [], [fresh]);

  const totalSpend = useMemo(
    () => supplies.reduce((sum, s) => sum + (s.total ?? 0), 0),
    [supplies],
  );

  const bySupplier = useMemo<SupplierRow[]>(() => {
    const map = new Map<string, SupplierRow>();
    supplies.forEach(s => {
      const key = s.supplierId || s.supplierCompany || s.supplierName;
      const row = map.get(key) ?? {
        supplierId: key,
        name: s.supplierName,
        company: s.supplierCompany,
        brand: s.supplierBrand ?? "",
        deliveries: 0,
        spend: 0,
        lastSupply: null,
      };
      row.deliveries += 1;
      row.spend += s.total ?? 0;
      if (!row.lastSupply || s.createdAt?.toMillis() > row.lastSupply.toMillis()) {
        row.lastSupply = s.createdAt ?? null;
      }
      map.set(key, row);
    });
    return Array.from(map.values()).sort((a, b) => b.spend - a.spend);
  }, [supplies]);

  const byItem = useMemo<ItemRow[]>(() => {
    const map = new Map<string, ItemRow>();
    supplies.forEach(s => {
      (s.items ?? []).forEach(line => {
        const row = map.get(line.itemName) ?? {
          itemName: line.itemName,
          unit: line.unit,
          quantity: 0,
          spend: 0,
          lastPrice: line.purchasePrice,
        };
        row.quantity += line.quantity;
        row.spend += line.lineTotal;
        row.lastPrice = line.purchasePrice;
        map.set(line.itemName, row);
      });
    });
    return Array.from(map.values()).sort((a, b) => b.spend - a.spend);
  }, [supplies]);

  const monthly = useMemo(
    () => monthlyTotals(supplies, s => s.createdAt.toDate(), s => s.total ?? 0),
    [supplies],
  );

  // Suppliers on the books who sent nothing this period — the ones worth a call.
  const quietSuppliers = useMemo(() => {
    const active = new Set(bySupplier.map(r => r.supplierId));
    return suppliers.filter(s => s.isActive !== false && !active.has(s.id));
  }, [suppliers, bySupplier]);

  function exportSuppliers() {
    downloadCSV(
      `supplier-analysis-${startDate.toISOString().slice(0, 10)}.csv`,
      ["Company", "Rep", "Brand", "Deliveries", "Total Spend (LKR)", "Share %", "Last Delivery"],
      bySupplier.map(r => [
        r.company,
        r.name,
        r.brand,
        String(r.deliveries),
        r.spend.toFixed(2),
        totalSpend > 0 ? ((r.spend / totalSpend) * 100).toFixed(1) : "0",
        r.lastSupply ? r.lastSupply.toDate().toLocaleDateString("en-GB") : "",
      ]),
    );
  }

  function exportItems() {
    downloadCSV(
      `supplier-items-${startDate.toISOString().slice(0, 10)}.csv`,
      ["Item", "Unit", "Quantity Received", "Total Spend (LKR)", "Latest Purchase Price (LKR)"],
      byItem.map(r => [
        r.itemName, r.unit, String(r.quantity), r.spend.toFixed(2), r.lastPrice.toFixed(2),
      ]),
    );
  }

  if (loading) {
    return <div className="text-center text-gray-400 py-16">Loading supplier data…</div>;
  }
  if (error) {
    return <div className="text-center text-red-400 py-16 text-sm">{error}</div>;
  }

  const avgDelivery = supplies.length > 0 ? totalSpend / supplies.length : 0;

  return (
    <div className="space-y-6">
      <StatTiles
        tiles={[
          { label: "Total Purchases", value: formatLKR(totalSpend), sub: "Goods received in period" },
          { label: "Deliveries", value: String(supplies.length), sub: `${bySupplier.length} suppliers` },
          { label: "Avg Delivery", value: formatLKR(avgDelivery), sub: "Per goods-received note" },
          {
            label: "Top Supplier",
            value: bySupplier[0]?.company ?? "—",
            sub: bySupplier[0]
              ? `${formatLKR(bySupplier[0].spend)} · ${((bySupplier[0].spend / totalSpend) * 100).toFixed(0)}% of spend`
              : "No deliveries in period",
          },
        ]}
      />

      <ReportCard title="Monthly Purchases">
        {monthly.length === 0 ? (
          <EmptyNote>No deliveries recorded in this period</EmptyNote>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={monthly} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
              <XAxis dataKey="month" tick={{ fill: "#6b7280", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fill: "#6b7280", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={v => `${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip
                cursor={{ fill: "rgba(255,255,255,0.04)" }}
                contentStyle={CHART_TOOLTIP_STYLE}
                labelStyle={{ color: "#fff" }}
                formatter={v => [formatLKR(v as number), "Purchases"]}
              />
              <Bar dataKey="value" fill="#F97316" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ReportCard>

      <ReportCard title="Spend by Supplier" onExport={bySupplier.length > 0 ? exportSuppliers : undefined}>
        {bySupplier.length === 0 ? (
          <EmptyNote>No supplier deliveries in this period</EmptyNote>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left text-xs text-gray-500 uppercase tracking-wider pb-2 pr-4">Supplier</th>
                  <th className="text-right text-xs text-gray-500 uppercase tracking-wider pb-2 pr-4">Deliveries</th>
                  <th className="text-right text-xs text-gray-500 uppercase tracking-wider pb-2 pr-4">Spend</th>
                  <th className="text-right text-xs text-gray-500 uppercase tracking-wider pb-2 pr-4">Share</th>
                  <th className="text-right text-xs text-gray-500 uppercase tracking-wider pb-2">Last Delivery</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {bySupplier.map(r => {
                  const share = totalSpend > 0 ? (r.spend / totalSpend) * 100 : 0;
                  return (
                    <tr key={r.supplierId}>
                      <td className="py-3 pr-4">
                        <div className="text-white">{r.company || r.name}</div>
                        <div className="text-xs text-gray-500">
                          {r.brand ? `${r.brand} · ` : ""}{r.name}
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-right text-gray-300">{r.deliveries}</td>
                      <td className="py-3 pr-4 text-right text-white font-medium">{formatLKR(r.spend)}</td>
                      <td className="py-3 pr-4 text-right text-gray-400">{share.toFixed(1)}%</td>
                      <td className="py-3 text-right text-gray-400 text-xs">{formatDate(r.lastSupply)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </ReportCard>

      <ReportCard title="Most Bought Items" onExport={byItem.length > 0 ? exportItems : undefined}>
        {byItem.length === 0 ? (
          <EmptyNote>No items received in this period</EmptyNote>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left text-xs text-gray-500 uppercase tracking-wider pb-2 pr-4">Item</th>
                  <th className="text-right text-xs text-gray-500 uppercase tracking-wider pb-2 pr-4">Received</th>
                  <th className="text-right text-xs text-gray-500 uppercase tracking-wider pb-2 pr-4">Spend</th>
                  <th className="text-right text-xs text-gray-500 uppercase tracking-wider pb-2">Latest Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {byItem.slice(0, 15).map(r => (
                  <tr key={r.itemName}>
                    <td className="py-3 pr-4 text-white">{r.itemName}</td>
                    <td className="py-3 pr-4 text-right text-gray-300">{r.quantity} {r.unit}</td>
                    <td className="py-3 pr-4 text-right text-white font-medium">{formatLKR(r.spend)}</td>
                    <td className="py-3 text-right text-gray-400">{formatLKR(r.lastPrice)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {byItem.length > 15 && (
              <p className="text-xs text-gray-600 mt-3">
                Showing the top 15 of {byItem.length} items — export the CSV for the full list.
              </p>
            )}
          </div>
        )}
      </ReportCard>

      {quietSuppliers.length > 0 && (
        <ReportCard title="No Deliveries This Period">
          <div className="flex flex-wrap gap-2">
            {quietSuppliers.map(s => (
              <span
                key={s.id}
                className="text-xs bg-[#0B1120] border border-white/10 text-gray-400 rounded-lg px-3 py-1.5"
              >
                {s.companyName}
                {s.brand ? ` · ${s.brand}` : ""}
              </span>
            ))}
          </div>
          <p className="text-xs text-gray-600 mt-3">
            Active suppliers with nothing booked in against them in this period.
          </p>
        </ReportCard>
      )}
    </div>
  );
}
