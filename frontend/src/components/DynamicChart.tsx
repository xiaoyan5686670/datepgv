import React, { useMemo } from 'react';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';

export interface ChartConfig {
  chart_type: 'line' | 'bar' | 'pie';
  x_axis_col: string;
  y_axis_cols?: string[];
  y_axis_col?: string;
  title?: string;
}

interface DynamicChartProps {
  config: ChartConfig;
  columns?: string[];
  rows?: Array<Record<string, unknown>>;
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

function formatNumber(value: number | string): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return String(value);
  
  if (Math.abs(num) >= 100000000) {
    return (num / 100000000).toLocaleString(undefined, { maximumFractionDigits: 2 }) + '亿';
  }
  if (Math.abs(num) >= 10000) {
    return (num / 10000).toLocaleString(undefined, { maximumFractionDigits: 2 }) + '万';
  }
  return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function DynamicChart({ config, columns, rows }: DynamicChartProps) {
  const data = useMemo(() => {
    if (!columns || !rows || rows.length === 0) return [];
    
    // rows is already an array of objects { col1: val1, col2: val2 }
    return rows;
  }, [columns, rows]);
  const { chart_type, x_axis_col, y_axis_col, y_axis_cols, title } = config;

  const yColsFromConfig = useMemo(() => {
    let rawCols: unknown[] = [];
    if (y_axis_cols && Array.isArray(y_axis_cols) && y_axis_cols.length > 0) {
      rawCols = y_axis_cols;
    } else if (y_axis_col) {
      rawCols = [y_axis_col];
    }
    
    // Ensure all dataKeys are strings and unique
    return Array.from(new Set(rawCols.map((c) => {
      if (typeof c === 'string') return c;
      if (typeof c === 'object' && c !== null) {
        const obj = c as Record<string, unknown>;
        const candidate = obj.col_name ?? obj.alias ?? obj.name;
        return typeof candidate === "string" ? candidate : JSON.stringify(c);
      }
      return String(c);
    })));
  }, [y_axis_cols, y_axis_col]);

  // Smart Pivot Logic for long-format SQL queries
  const { displayData, finalYCols } = useMemo(() => {
    if (!rows || rows.length === 0 || !columns || yColsFromConfig.length === 0) {
      return { displayData: [], finalYCols: [] };
    }
    
    let groupCol: string | null = null;
    if (yColsFromConfig.length === 1) {
      const yCol = yColsFromConfig[0];
      const otherCols = columns.filter(c => c !== x_axis_col && c !== yCol);
      // If there's exactly one other column unused, it's likely a dimension grouping
      if (otherCols.length === 1) {
         groupCol = otherCols[0];
      }
    }
    
    let processedRows = rows;
    let computedYCols = [...yColsFromConfig];

    if (groupCol) {
      const yValCol = yColsFromConfig[0];
      const map = new Map<string, Record<string, unknown>>();
      const valueKeys = new Set<string>();
      
      rows.forEach(row => {
        const xVal = row[x_axis_col];
        const groupVal = row[groupCol!];
        let yVal = row[yValCol];
        
        // Handle cast types or stringified numbers if needed
        if (typeof yVal === 'string' && !isNaN(Number(yVal))) {
            yVal = Number(yVal);
        }
        
        const pivotKey = String(groupVal || 'Unknown');
        valueKeys.add(pivotKey);
        
        const xKey = String(xVal);
        if (!map.has(xKey)) {
          map.set(xKey, { [x_axis_col]: xVal });
        }
        const obj = map.get(xKey);
        if (obj) obj[pivotKey] = yVal; // assigning pivot
      });
      
      processedRows = Array.from(map.values());
      computedYCols = Array.from(valueKeys);
    } else {
      // Ensure numerical parsing if passing directly
      processedRows = rows.map((r) => {
        const copy = { ...r };
        computedYCols.forEach((yc) => {
          const value = copy[yc];
          if (typeof value === 'string' && !isNaN(Number(value))) {
            copy[yc] = Number(value);
          }
        });
        return copy;
      });
    }

    // Fill missing values with 0 to prevent line breaks in the chart
    processedRows.forEach((row) => {
      computedYCols.forEach((yc) => {
        if (row[yc] === undefined || row[yc] === null) {
          row[yc] = 0;
        }
      });
    });
    
    return { displayData: processedRows, finalYCols: computedYCols };
  }, [rows, columns, x_axis_col, yColsFromConfig]);

  // Protect against misspelled keys making everything fail silently
  if (!data || data.length === 0 || !chart_type || !x_axis_col || finalYCols.length === 0) {
    return null;
  }

  return (
    <div className="w-full flex flex-col mt-4 p-5 border rounded-2xl bg-background shadow-xs overflow-hidden">
      {title && <h3 className="text-sm font-semibold mb-6 flex justify-center text-foreground">{title}</h3>}
      <div className="w-full h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          {chart_type === 'pie' ? (
            <PieChart>
              <Tooltip 
                contentStyle={{ borderRadius: '12px', border: '1px solid var(--border)', backgroundColor: 'var(--background)' }}
                itemStyle={{ color: 'var(--foreground)' }}
              />
              <Legend verticalAlign="bottom" height={36} wrapperStyle={{ fontSize: 12 }} />
              <Pie
                data={displayData}
                nameKey={x_axis_col}
                dataKey={finalYCols[0]}
                cx="50%"
                cy="50%"
                outerRadius={100}
                fill="#3b82f6"
                label={({ name, percent }) => `${String(name)} ${(((percent ?? 0) as number) * 100).toFixed(0)}%`}
              >
                {displayData.map((_, index: number) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
            </PieChart>
          ) : chart_type === 'bar' ? (
            <BarChart data={displayData} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
              <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="currentColor" strokeOpacity={0.1} />
              <XAxis 
                dataKey={x_axis_col} 
                tick={{ fontSize: 12, fill: 'currentColor', opacity: 0.7 }} 
                tickLine={false}
                axisLine={{ stroke: 'currentColor', opacity: 0.2 }}
              />
              <YAxis 
                tickFormatter={(val) => formatNumber(val)}
                tick={{ fontSize: 12, fill: 'currentColor', opacity: 0.7 }} 
                tickLine={false}
                axisLine={false}
              />
              <Tooltip 
                formatter={(val: string | number) => formatNumber(val)}
                labelStyle={{ color: 'var(--foreground)' }}
                contentStyle={{ borderRadius: '12px', border: '1px solid var(--border)', backgroundColor: 'var(--background)' }}
                cursor={{ fill: 'currentColor', opacity: 0.05 }}
              />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 10 }} />
              {finalYCols.map((col, idx) => (
                <Bar key={col} dataKey={col} fill={COLORS[idx % COLORS.length]} radius={[4, 4, 0, 0]} maxBarSize={60} />
              ))}
            </BarChart>
          ) : (
            <LineChart data={displayData} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
              <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="currentColor" strokeOpacity={0.1} />
              <XAxis 
                dataKey={x_axis_col} 
                tick={{ fontSize: 12, fill: 'currentColor', opacity: 0.7 }} 
                tickLine={false}
                axisLine={{ stroke: 'currentColor', opacity: 0.2 }}
              />
              <YAxis 
                tickFormatter={(val) => formatNumber(val)}
                tick={{ fontSize: 12, fill: 'currentColor', opacity: 0.7 }} 
                tickLine={false}
                axisLine={false}
              />
              <Tooltip 
                formatter={(val: string | number) => formatNumber(val)}
                labelStyle={{ color: 'var(--foreground)' }}
                contentStyle={{ borderRadius: '12px', border: '1px solid var(--border)', backgroundColor: 'var(--background)' }}
              />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 10 }} />
              {finalYCols.map((col, idx) => (
                <Line 
                  key={col}
                  type="monotone" 
                  dataKey={col} 
                  stroke={COLORS[idx % COLORS.length]} 
                  strokeWidth={3} 
                  dot={{ r: 4, strokeWidth: 2 }} 
                  activeDot={{ r: 6 }} 
                />
              ))}
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
