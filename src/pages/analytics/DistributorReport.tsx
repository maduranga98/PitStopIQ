import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, Timestamp, where } from "firebase/firestore";
import {
  Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { db } from "../../config/firebase";
import { downloadCSV } from "../../lib/csvExport";
import { summarisePayments } from "../../lib/distributors";
import type { Distributor, DistributorOrder } from "../../types/auth";
import {
  CHART_TOOLTIP_STYLE, formatDate, formatLKR, monthlyTotals,
} from "../../lib/reportFormat";
import { EmptyNote, ReportCard, StatTiles } from "./reportUi";

// The other side of the stock ledger: what left the store room for the dealers
// who sell it on, what they've paid for it, and what they still owe. Only
// released (finalized) orders count as business done — a submitted order is
// still just a request.

interface Props {
  centerId: string;
  startDate: Date;
  endDate: Date;
}

interface DistributorRow {
  distributorId: string;
  name: string;
  phone: string;
  orders: number;
  released: number;
  received: number;
  credit: number;
  balanceDue: number;
  lastOrder: Timestamp | null;
}

interface ItemRow {
  itemName: string;
  unit: string;
  quantity: number;
  value: number;
}

interface Loaded {
  /** The centre + date range this data answers for. */
  key: string;
  orders: DistributorOrder[];
  distributors: Distributor[];
  error: string;
}

export default function DistributorReport({ centerId, startDate, endDate }: Props) {
  // Held together with the range it was fetched for, so "loading" is simply
  // "what we have doesn't answer the question being asked" — and a slow reply
  // for an old range can never overwrite a newer one.
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const rangeKey = `${centerId}:${startDate.getTime()}:${endDate.getTime()}`;

  useEffect(() => {
    if (!centerId) return;
    Promise.all([
      getDocs(query(
        collection(db, "servicecenters", centerId, "distributorOrders"),
        where("createdAt", ">=", Timestamp.fromDate(startDate)),
        where("createdAt", "<=", Timestamp.fromDate(endDate)),
      )),
      getDocs(collection(db, "servicecenters", centerId, "distributors")),
    ]).then(([orderSnap, distributorSnap]) => {
      setLoaded({
        key: rangeKey,
        orders: orderSnap.docs.map(d => ({ id: d.id, ...d.data() } as DistributorOrder)),
        distributors: distributorSnap.docs.map(d => ({ id: d.id, ...d.data() } as Distributor)),
        error: "",
      });
    }).catch(() => {
      setLoaded({ key: rangeKey, orders: [], distributors: [], error: "Could not load distributor data." });
    });
    // startDate/endDate are folded into rangeKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey]);

  const fresh = loaded?.key === rangeKey ? loaded : null;
  const loading = fresh === null;
  const error = fresh?.error ?? "";
  const orders = useMemo(() => fresh?.orders ?? [], [fresh]);
  const distributors = useMemo(() => fresh?.distributors ?? [], [fresh]);

  const released = useMemo(() => orders.filter(o => o.status === "finalized"), [orders]);
  const pending = useMemo(() => orders.filter(o => o.status === "submitted"), [orders]);

  // Payment totals are re-summed from each order's entries rather than trusted
  // from the denormalised fields, so an order written before those existed still
  // counts correctly.
  const money = useMemo(() => {
    return released.reduce(
      (acc, o) => {
        const s = summarisePayments(o.payments, o.total);
        acc.releasedValue += o.total ?? 0;
        acc.cash += s.cash;
        acc.cheque += s.cheque;
        acc.credit += s.credit;
        acc.received += s.received;
        acc.balanceDue += s.balanceDue;
        return acc;
      },
      { releasedValue: 0, cash: 0, cheque: 0, credit: 0, received: 0, balanceDue: 0 },
    );
  }, [released]);

  const byDistributor = useMemo<DistributorRow[]>(() => {
    const map = new Map<string, DistributorRow>();
    released.forEach(o => {
      const s = summarisePayments(o.payments, o.total);
      const row = map.get(o.distributorId) ?? {
        distributorId: o.distributorId,
        name: o.distributorName,
        phone: o.distributorPhone ?? "",
        orders: 0,
        released: 0,
        received: 0,
        credit: 0,
        balanceDue: 0,
        lastOrder: null,
      };
      row.orders += 1;
      row.released += o.total ?? 0;
      row.received += s.received;
      row.credit += s.credit;
      row.balanceDue += s.balanceDue;
      const when = o.finalizedAt ?? o.createdAt;
      if (when && (!row.lastOrder || when.toMillis() > row.lastOrder.toMillis())) row.lastOrder = when;
      map.set(o.distributorId, row);
    });
    return Array.from(map.values()).sort((a, b) => b.released - a.released);
  }, [released]);

  const byItem = useMemo<ItemRow[]>(() => {
    const map = new Map<string, ItemRow>();
    released.forEach(o => {
      (o.items ?? []).forEach(line => {
        if (line.approvedQty <= 0) return;
        const row = map.get(line.itemName) ?? {
          itemName: line.itemName, unit: line.unit, quantity: 0, value: 0,
        };
        row.quantity += line.approvedQty;
        row.value += line.lineTotal;
        map.set(line.itemName, row);
      });
    });
    return Array.from(map.values()).sort((a, b) => b.value - a.value);
  }, [released]);

  const monthly = useMemo(
    () => monthlyTotals(released, o => (o.finalizedAt ?? o.createdAt).toDate(), o => o.total ?? 0),
    [released],
  );

  const quietDistributors = useMemo(() => {
    const active = new Set(byDistributor.map(r => r.distributorId));
    return distributors.filter(d => d.isActive !== false && !active.has(d.id));
  }, [distributors, byDistributor]);

  function exportDistributors() {
    downloadCSV(
      `distributor-analysis-${startDate.toISOString().slice(0, 10)}.csv`,
      ["Distributor", "Phone", "Orders", "Released (LKR)", "Received (LKR)", "Credit (LKR)", "Balance Due (LKR)", "Last Order"],
      byDistributor.map(r => [
        r.name,
        r.phone,
        String(r.orders),
        r.released.toFixed(2),
        r.received.toFixed(2),
        r.credit.toFixed(2),
        r.balanceDue.toFixed(2),
        r.lastOrder ? r.lastOrder.toDate().toLocaleDateString("en-GB") : "",
      ]),
    );
  }

  function exportItems() {
    downloadCSV(
      `distributor-items-${startDate.toISOString().slice(0, 10)}.csv`,
      ["Item", "Unit", "Quantity Released", "Value (LKR)"],
      byItem.map(r => [r.itemName, r.unit, String(r.quantity), r.value.toFixed(2)]),
    );
  }

  if (loading) {
    return <div className="text-center text-gray-400 py-16">Loading distributor data…</div>;
  }
  if (error) {
    return <div className="text-center text-red-400 py-16 text-sm">{error}</div>;
  }

  return (
    <div className="space-y-6">
      <StatTiles
        tiles={[
          { label: "Stock Released", value: formatLKR(money.releasedValue), sub: `${released.length} orders released` },
          { label: "Money Received", value: formatLKR(money.received), sub: "Cash + cheques", tone: "text-green-400" },
          {
            label: "Outstanding",
            value: formatLKR(money.balanceDue),
            sub: pending.length > 0 ? `${pending.length} order(s) awaiting review` : "Across released orders",
            tone: money.balanceDue > 0 ? "text-amber-400" : "text-green-400",
          },
          {
            label: "Top Dealer",
            value: byDistributor[0]?.name ?? "—",
            sub: byDistributor[0]
              ? `${formatLKR(byDistributor[0].released)} · ${((byDistributor[0].released / money.releasedValue) * 100).toFixed(0)}% of stock`
              : "Nothing released in period",
          },
        ]}
      />

      {/* How the dealers settled. Three figures beat a three-slice pie. */}
      <ReportCard title="How Dealers Settled">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {([
            ["Cash", money.cash, "text-green-400"],
            ["Cheques", money.cheque, "text-blue-400"],
            ["On credit", money.credit, "text-amber-400"],
            ["Balance due", money.balanceDue, money.balanceDue > 0 ? "text-amber-400" : "text-green-400"],
          ] as const).map(([label, value, tone]) => (
            <div key={label} className="bg-[#0B1120] border border-white/5 rounded-lg px-3 py-2">
              <div className="text-xs text-gray-500">{label}</div>
              <div className={`text-sm font-semibold mt-0.5 ${tone}`}>{formatLKR(value)}</div>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-600 mt-3">
          Cheques count as money received the day they're recorded. Credit stays in the balance due until it's paid.
        </p>
      </ReportCard>

      <ReportCard title="Monthly Stock Released">
        {monthly.length === 0 ? (
          <EmptyNote>No stock released to distributors in this period</EmptyNote>
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
                formatter={v => [formatLKR(v as number), "Released"]}
              />
              <Bar dataKey="value" fill="#3B82F6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ReportCard>

      <ReportCard title="Dealer Ledger" onExport={byDistributor.length > 0 ? exportDistributors : undefined}>
        {byDistributor.length === 0 ? (
          <EmptyNote>No released orders in this period</EmptyNote>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left text-xs text-gray-500 uppercase tracking-wider pb-2 pr-4">Distributor</th>
                  <th className="text-right text-xs text-gray-500 uppercase tracking-wider pb-2 pr-4">Orders</th>
                  <th className="text-right text-xs text-gray-500 uppercase tracking-wider pb-2 pr-4">Released</th>
                  <th className="text-right text-xs text-gray-500 uppercase tracking-wider pb-2 pr-4">Received</th>
                  <th className="text-right text-xs text-gray-500 uppercase tracking-wider pb-2 pr-4">Credit</th>
                  <th className="text-right text-xs text-gray-500 uppercase tracking-wider pb-2 pr-4">Balance</th>
                  <th className="text-right text-xs text-gray-500 uppercase tracking-wider pb-2">Last Order</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {byDistributor.map(r => (
                  <tr key={r.distributorId}>
                    <td className="py-3 pr-4">
                      <div className="text-white">{r.name}</div>
                      {r.phone && <div className="text-xs text-gray-500">{r.phone}</div>}
                    </td>
                    <td className="py-3 pr-4 text-right text-gray-300">{r.orders}</td>
                    <td className="py-3 pr-4 text-right text-white font-medium">{formatLKR(r.released)}</td>
                    <td className="py-3 pr-4 text-right text-green-400">{formatLKR(r.received)}</td>
                    <td className="py-3 pr-4 text-right text-amber-400">{formatLKR(r.credit)}</td>
                    <td className={`py-3 pr-4 text-right font-medium ${r.balanceDue > 0 ? "text-red-400" : "text-green-400"}`}>
                      {formatLKR(r.balanceDue)}
                    </td>
                    <td className="py-3 text-right text-gray-400 text-xs">{formatDate(r.lastOrder)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ReportCard>

      <ReportCard title="Most Released Items" onExport={byItem.length > 0 ? exportItems : undefined}>
        {byItem.length === 0 ? (
          <EmptyNote>No items released in this period</EmptyNote>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left text-xs text-gray-500 uppercase tracking-wider pb-2 pr-4">Item</th>
                  <th className="text-right text-xs text-gray-500 uppercase tracking-wider pb-2 pr-4">Released</th>
                  <th className="text-right text-xs text-gray-500 uppercase tracking-wider pb-2">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {byItem.slice(0, 15).map(r => (
                  <tr key={r.itemName}>
                    <td className="py-3 pr-4 text-white">{r.itemName}</td>
                    <td className="py-3 pr-4 text-right text-gray-300">{r.quantity} {r.unit}</td>
                    <td className="py-3 text-right text-white font-medium">{formatLKR(r.value)}</td>
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

      {quietDistributors.length > 0 && (
        <ReportCard title="No Orders This Period">
          <div className="flex flex-wrap gap-2">
            {quietDistributors.map(d => (
              <span
                key={d.id}
                className="text-xs bg-[#0B1120] border border-white/10 text-gray-400 rounded-lg px-3 py-1.5"
              >
                {d.name}
              </span>
            ))}
          </div>
          <p className="text-xs text-gray-600 mt-3">
            Active distributors who took no stock in this period.
          </p>
        </ReportCard>
      )}
    </div>
  );
}
