import { useEffect, useRef } from 'react';
import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Filler,
} from 'chart.js';
import type { PerformanceReport } from '@relaydesk/contracts';
Chart.register(
  LineController,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Filler,
);
export function ActivityChart({
  trend,
  metric,
}: {
  trend: PerformanceReport['trend'];
  metric: 'tickets' | 'runs' | 'tokens';
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const labels =
    metric === 'tickets'
      ? ['Opened', 'Closed']
      : metric === 'runs'
        ? ['Completed', 'Failed']
        : ['Input tokens', 'Output tokens'];
  useEffect(() => {
    if (!canvas.current) return;
    const keys =
      metric === 'tickets'
        ? (['opened', 'closed'] as const)
        : metric === 'runs'
          ? (['completed', 'failed'] as const)
          : (['inputTokens', 'outputTokens'] as const);
    const names =
      metric === 'tickets'
        ? ['Opened', 'Closed']
        : metric === 'runs'
          ? ['Completed', 'Failed']
          : ['Input tokens', 'Output tokens'];
    const chart = new Chart(canvas.current, {
      type: 'line',
      data: {
        labels: trend.map((d) => d.day),
        datasets: keys.map((key, i) => ({
          label: names[i],
          data: trend.map((d) => d[key]),
          borderColor: i ? '#08745e' : '#5040d6',
          backgroundColor: i ? '#08745e0a' : '#5040d60d',
          borderWidth: 3,
          borderDash: i ? [6, 4] : [],
          pointRadius: trend.length <= 30 ? 3 : 1,
          pointHoverRadius: 6,
          pointHitRadius: 14,
          fill: !i,
          tension: 0,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          tooltip: {
            backgroundColor: '#17233b',
            titleColor: '#fff',
            bodyColor: '#fff',
            padding: 14,
            titleFont: { size: 14 },
            bodyFont: { size: 14 },
            displayColors: true,
          },
        },
        layout: { padding: { top: 18, right: 10 } },
        scales: {
          x: {
            grid: { display: false },
            border: { color: '#cad3e1' },
            ticks: {
              color: '#344256',
              font: { size: 13, family: 'Inter, Segoe UI, Arial, sans-serif' },
              maxTicksLimit: 7,
              maxRotation: 0,
              callback: (_v, i) =>
                new Date(trend[i].day + 'T12:00:00Z').toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                }),
            },
          },
          y: {
            beginAtZero: true,
            suggestedMax: 1,
            border: { display: false },
            grid: { color: '#dce1eb' },
            ticks: {
              color: '#344256',
              font: { size: 13, family: 'Inter, Segoe UI, Arial, sans-serif' },
              precision: 0,
              maxTicksLimit: 5,
            },
          },
        },
      },
    });
    const syncTheme = () => {
      const dark = document.documentElement.dataset.theme === 'dark';
      chart.data.datasets.forEach((dataset, i) => {
        dataset.borderColor = i ? (dark ? '#79ddbd' : '#08745e') : dark ? '#b6a6ff' : '#5040d6';
        dataset.backgroundColor = i ? 'transparent' : dark ? '#b6a6ff10' : '#5040d60d';
      });
      for (const axis of ['x', 'y'] as const) {
        const options = chart.options.scales?.[axis];
        if (options?.ticks) options.ticks.color = dark ? '#d4deef' : '#344256';
        if (options?.grid && axis === 'y') options.grid.color = dark ? '#425574' : '#dce1eb';
        if (options?.border) options.border.color = dark ? '#607797' : '#cad3e1';
      }
      chart.update('none');
    };
    syncTheme();
    window.addEventListener('relaydesk:appearance', syncTheme);
    return () => {
      window.removeEventListener('relaydesk:appearance', syncTheme);
      chart.destroy();
    };
  }, [trend, metric]);
  return (
    <div className="performance-canvas">
      <canvas
        ref={canvas}
        role="img"
        aria-label={`${labels.join(' and ')} by UTC day. Use View daily data below for exact values.`}
      >
        Daily data is available in the table below this chart.
      </canvas>
    </div>
  );
}
