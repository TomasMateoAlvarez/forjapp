import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface ForjaBarChartProps {
  data: Array<Record<string, unknown>>;
  xKey: string;
  yKey: string;
  color?: string;
}

export default function ForjaBarChart({ data, xKey, yKey, color = "#d9a54a" }: ForjaBarChartProps) {
  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
        <XAxis
          dataKey={xKey}
          tick={{ fill: "var(--steel)", fontSize: 10, fontFamily: "var(--mono)" }}
          axisLine={{ stroke: "var(--line)" }}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: "var(--steel)", fontSize: 10, fontFamily: "var(--mono)" }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
          width={30}
        />
        <Tooltip
          contentStyle={{
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: 6,
            fontFamily: "var(--mono)",
            fontSize: 12,
          }}
          labelStyle={{ color: "var(--steel)", fontSize: 10 }}
          itemStyle={{ color }}
          formatter={(v) => [`${v} PR${v === 1 ? "" : "s"}`, ""]}
        />
        <Bar dataKey={yKey} fill={color} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
