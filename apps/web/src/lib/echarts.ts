import { BarChart, LineChart, PieChart } from "echarts/charts";
import {
  AriaComponent,
  BrushComponent,
  GridComponent,
  MarkLineComponent,
  ToolboxComponent,
  TooltipComponent,
} from "echarts/components";
// eslint-disable-next-line import/no-namespace -- `echarts/core` has no default export and Kumo's charts take the whole namespace object as a prop
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

/**
 * The ECharts instance every Kumo chart in the app is handed.
 *
 * Kumo takes `echarts` as a prop rather than importing it, so the bundle only
 * carries what is registered here — the full `echarts` barrel is roughly a
 * megabyte. Registering once in a shared module also keeps two charts on the
 * same page from disagreeing about which features exist.
 *
 * `Brush`, `Toolbox`, `MarkLine` and `Aria` are Kumo's, not ours:
 * `TimeseriesChart` puts all four in the options it builds, and ECharts logs a
 * warning for every option whose component was never registered.
 */
echarts.use([
  BarChart,
  LineChart,
  PieChart,
  AriaComponent,
  BrushComponent,
  GridComponent,
  MarkLineComponent,
  ToolboxComponent,
  TooltipComponent,
  CanvasRenderer,
]);

export { echarts };
