import { ARENA_H, ARENA_W, DIR_VEC, type Agent, type Personality, type World } from "./world.ts";

export const PERSONALITY_COLOR: Record<Personality, string> = {
  aggressive: "#ff4d6d",
  cautious: "#4dd2ff",
  greedy: "#ffd166",
  trickster: "#c77dff",
};
export const HEURISTIC_COLOR = "#8a94a6";
export const HUMAN_COLOR = "#3dffb0";

export function agentColor(a: Agent): string {
  if (a.controller === "human") return HUMAN_COLOR;
  if (a.controller === "heuristic") return HEURISTIC_COLOR;
  return PERSONALITY_COLOR[a.personality];
}

export interface RenderOptions {
  showTargets: boolean;
  nowMs: number;
}

export function drawWorld(ctx: CanvasRenderingContext2D, world: World, width: number, height: number, opts: RenderOptions): void {
  const scale = Math.min(width / ARENA_W, height / ARENA_H);
  const ox = (width - ARENA_W * scale) / 2;
  const oy = (height - ARENA_H * scale) / 2;
  ctx.save();
  ctx.fillStyle = "#07090d";
  ctx.fillRect(0, 0, width, height);
  ctx.translate(ox, oy);
  ctx.scale(scale, scale);

  // arena
  ctx.fillStyle = "#0b0f16";
  ctx.fillRect(0, 0, ARENA_W, ARENA_H);
  ctx.strokeStyle = "#141b26";
  ctx.lineWidth = 1;
  for (let x = 0; x <= ARENA_W; x += 100) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, ARENA_H);
    ctx.stroke();
  }
  for (let y = 0; y <= ARENA_H; y += 100) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(ARENA_W, y);
    ctx.stroke();
  }
  ctx.strokeStyle = "#2a3548";
  ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, ARENA_W, ARENA_H);

  // pellets
  ctx.fillStyle = "#e8f0ff";
  for (const p of world.pellets) {
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // eat flashes
  for (const e of world.events) {
    const age = world.time - e.at;
    if (age > 0.6) continue;
    const r = e.kind === "eat" ? 20 + age * 90 : 10 + age * 40;
    ctx.strokeStyle = e.kind === "eat" ? `rgba(255,77,109,${1 - age / 0.6})` : `rgba(61,255,176,${1 - age / 0.6})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // target lines
  if (opts.showTargets) {
    ctx.lineWidth = 1;
    for (const a of world.agents) {
      if (!a.alive || !a.decision.target) continue;
      const t = world.agents.find((o) => o.id === a.decision.target) ?? world.pellets.find((p) => p.id === a.decision.target);
      if (!t) continue;
      ctx.strokeStyle = agentColor(a);
      ctx.globalAlpha = 0.28;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(t.x, t.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  // agents
  const sorted = [...world.agents].filter((a) => a.alive).sort((a, b) => a.size - b.size);
  for (const a of sorted) {
    const color = agentColor(a);
    const boosting = a.boostLeft > 0;
    ctx.save();
    ctx.translate(a.x, a.y);
    // in-flight ring
    if (a.inFlight > 0) {
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 5]);
      ctx.lineDashOffset = -(opts.nowMs / 40) % 9;
      ctx.beginPath();
      ctx.arc(0, 0, a.size + 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // fresh decision flash
    const sinceDecision = opts.nowMs - a.decision.at;
    if (a.controller === "jev" && sinceDecision < 220 && a.decision.source === "jev") {
      ctx.strokeStyle = color;
      ctx.globalAlpha = 1 - sinceDecision / 220;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, a.size + 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // body
    ctx.shadowColor = color;
    ctx.shadowBlur = boosting ? 28 : 12;
    ctx.fillStyle = color;
    ctx.globalAlpha = a.controller === "heuristic" ? 0.75 : 0.95;
    ctx.beginPath();
    if (a.controller === "heuristic") {
      const s = a.size * 0.9;
      ctx.rect(-s, -s, s * 2, s * 2);
    } else {
      ctx.arc(0, 0, a.size, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    // heading tick
    let hx = 0;
    let hy = 0;
    if (a.steerTo) {
      const dx = a.steerTo.x - a.x;
      const dy = a.steerTo.y - a.y;
      const d = Math.hypot(dx, dy) || 1;
      hx = dx / d;
      hy = dy / d;
    } else if (a.heading !== "hold") {
      hx = DIR_VEC[a.heading].x;
      hy = DIR_VEC[a.heading].y;
    }
    if (hx || hy) {
      ctx.strokeStyle = "#07090d";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(hx * a.size * 0.3, hy * a.size * 0.3);
      ctx.lineTo(hx * a.size * 0.95, hy * a.size * 0.95);
      ctx.stroke();
    }
    // label
    ctx.fillStyle = "#e8f0ff";
    ctx.font = `600 ${Math.max(11, a.size * 0.55)}px ui-monospace, Menlo, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(a.controller === "human" ? "YOU" : a.id, 0, a.size + 4);
    if (a.controller !== "human") {
      ctx.fillStyle = "rgba(232,240,255,0.55)";
      ctx.font = `500 10px ui-monospace, Menlo, monospace`;
      ctx.fillText(a.controller === "heuristic" ? "heur" : a.personality.slice(0, 4), 0, a.size + 6 + Math.max(11, a.size * 0.55));
    }
    ctx.restore();
  }
  ctx.restore();
}

export function screenToWorld(canvas: HTMLCanvasElement, clientX: number, clientY: number): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;
  const scale = Math.min(width / ARENA_W, height / ARENA_H);
  const ox = (width - ARENA_W * scale) / 2;
  const oy = (height - ARENA_H * scale) / 2;
  return { x: (clientX - rect.left - ox) / scale, y: (clientY - rect.top - oy) / scale };
}
