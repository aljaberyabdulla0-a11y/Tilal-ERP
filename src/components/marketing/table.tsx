import { Empty } from "./ui";

// جدولٌ بسيط للقوائم داخل البطاقات — رأسٌ وصفوف، والفراغ يُقال لا يُخفى
export function SimpleTable({ head, rows, empty = "لا شيء بعد." }: { head: string[]; rows: React.ReactNode[][]; empty?: string }) {
  if (rows.length === 0) return <Empty>{empty}</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-right text-sm">
        <thead className="bg-gray-50 text-xs text-gray-500">
          <tr>{head.map((h) => <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-gray-50/60">
              {r.map((cell, j) => <td key={j} className="px-3 py-2 align-top">{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
