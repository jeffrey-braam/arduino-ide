// Serial Plotter: graphs numbers printed by the sketch, one sample per line, in the same format
// as the Arduino IDE's plotter:
//   Serial.println(value);                               -> one line
//   Serial.print(a); Serial.print(" "); Serial.println(b); -> two lines ("value 1", "value 2")
//   Serial.print("light:"); Serial.print(l); Serial.print(","); ... -> named lines
// Values can be separated by spaces, tabs or commas. Lines without numbers are ignored.

const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;

// Returns [{ label, value }] for one line of serial output, or [] if it holds no data.
export function parsePlotLine(line) {
  const out = [];
  let unnamed = 0;
  for (const token of line.trim().split(/[\s,]+/)) {
    if (!token) continue;
    const colon = token.lastIndexOf(":");
    if (colon > 0) {
      const label = token.slice(0, colon);
      const value = token.slice(colon + 1);
      if (NUMBER.test(value)) out.push({ label, value: Number(value) });
    } else if (NUMBER.test(token)) {
      out.push({ label: `value ${++unnamed}`, value: Number(token) });
    }
  }
  return out;
}

const COLORS = ["#2a9d8f", "#e76f51", "#3a86ff", "#e9a800", "#b5179e", "#6a994e", "#8d6e63", "#7f8c8d"];

// Rounds a step up to 1, 2 or 5 times a power of ten, for tidy axis labels.
function niceStep(range, ticks) {
  const raw = range / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw);
}

const formatNumber = (n) => (Math.abs(n) >= 1e5 || (n !== 0 && Math.abs(n) < 1e-3) ? n.toExponential(1) : String(+n.toFixed(3)));

export class SerialPlotter {
  constructor(canvas, legend) {
    this.canvas = canvas;
    this.legend = legend;
    this.maxPoints = 500;
    this.paused = false;
    this.series = new Map(); // label -> { color, points: [[x, y]] }
    this.x = 0; // sample counter
    this.drawQueued = false;
    new ResizeObserver(() => this.draw()).observe(canvas);
  }

  addLine(line) {
    if (this.paused) return;
    const values = parsePlotLine(line);
    if (!values.length) return;
    this.x++;
    for (const { label, value } of values) {
      let s = this.series.get(label);
      if (!s) {
        if (this.series.size >= COLORS.length * 2) continue; // guard against runaway labels
        s = { color: COLORS[this.series.size % COLORS.length], points: [] };
        this.series.set(label, s);
        this.renderLegend();
      }
      s.points.push([this.x, value]);
      while (s.points.length && s.points[0][0] <= this.x - this.maxPoints) s.points.shift();
    }
    this.queueDraw();
  }

  clear() {
    this.series.clear();
    this.x = 0;
    this.renderLegend();
    this.draw();
  }

  setPaused(paused) {
    this.paused = paused;
  }

  setMaxPoints(n) {
    this.maxPoints = n;
    for (const s of this.series.values()) while (s.points.length && s.points[0][0] <= this.x - n) s.points.shift();
    this.draw();
  }

  renderLegend() {
    this.legend.replaceChildren(
      ...[...this.series].map(([label, s]) => {
        const item = document.createElement("span");
        item.className = "plot-key";
        const swatch = document.createElement("i");
        swatch.style.background = s.color;
        const value = document.createElement("b");
        s.valueEl = value;
        item.append(swatch, label + " ", value);
        return item;
      }),
    );
  }

  queueDraw() {
    if (this.drawQueued) return;
    this.drawQueued = true;
    requestAnimationFrame(() => {
      this.drawQueued = false;
      this.draw();
    });
  }

  draw() {
    const { canvas } = this;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return; // hidden
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const css = getComputedStyle(canvas);
    const text = css.getPropertyValue("--muted").trim() || "#888";
    const grid = css.getPropertyValue("--border").trim() || "#ddd";
    ctx.font = "11px system-ui, sans-serif";

    const pad = { left: 56, right: 12, top: 10, bottom: 18 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;
    let min = Infinity, max = -Infinity;
    for (const s of this.series.values()) for (const [, y] of s.points) {
      if (y < min) min = y;
      if (y > max) max = y;
    }
    if (min === Infinity) {
      ctx.fillStyle = text;
      ctx.textAlign = "center";
      ctx.fillText("Waiting for numbers… (Serial.println a value, or several separated by spaces or commas)", w / 2, h / 2);
      return;
    }
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const step = niceStep(max - min, 5);
    const lo = Math.floor(min / step) * step;
    const hi = Math.ceil(max / step) * step;
    const yPos = (y) => pad.top + plotH - ((y - lo) / (hi - lo)) * plotH;
    const x0 = this.x - this.maxPoints + 1;
    const xPos = (x) => pad.left + ((x - x0) / Math.max(1, this.maxPoints - 1)) * plotW;

    // Grid and y labels
    ctx.strokeStyle = grid;
    ctx.fillStyle = text;
    ctx.lineWidth = 1;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let v = lo; v <= hi + step / 2; v += step) {
      const y = Math.round(yPos(v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(w - pad.right, y);
      ctx.stroke();
      ctx.fillText(formatNumber(v), pad.left - 6, y);
    }
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(`last ${this.maxPoints} samples`, pad.left, h - pad.bottom + 4);

    // Series
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    for (const s of this.series.values()) {
      ctx.strokeStyle = s.color;
      ctx.beginPath();
      s.points.forEach(([x, y], i) => (i ? ctx.lineTo(xPos(x), yPos(y)) : ctx.moveTo(xPos(x), yPos(y))));
      ctx.stroke();
      const last = s.points[s.points.length - 1];
      if (s.valueEl) s.valueEl.textContent = last ? formatNumber(last[1]) : "";
    }
  }
}
