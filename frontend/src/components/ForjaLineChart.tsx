import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface ForjaLineChartProps {
  data: Array<Record<string, unknown>>;
  xKey: string;
  yKey: string;
  color?: string;
  yUnit?: string;
  renderTooltip?: (props: Record<string, unknown>) => React.ReactNode;
}

export default function ForjaLineChart({
  data,
  xKey,
  yKey,
  color = "#d9a54a",
  yUnit = "",
  renderTooltip,
}: ForjaLineChartProps) {
  return (
    <ResponsiveContainer width="100%" height={160}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
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
          tickFormatter={(v: number) => `${v}`}
          width={40}
        />
        <Tooltip
          content={
            renderTooltip
              ? (props) => renderTooltip(props as Record<string, unknown>)
              : undefined
          }
          contentStyle={{
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: 6,
            fontFamily: "var(--mono)",
            fontSize: 12,
          }}
          labelStyle={{ color: "var(--steel)", fontSize: 10 }}
          itemStyle={{ color }}
          formatter={(v) => [`${v} ${yUnit}`, ""]}
        />
        <Line
          type="monotone"
          dataKey={yKey}
          stroke={color}
          strokeWidth={2}
          dot={{ fill: color, r: 3, strokeWidth: 0 }}
          activeDot={{ r: 5, fill: color }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
