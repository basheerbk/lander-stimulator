// map.js — Side-view terrain navigation map
import { CRATERS } from './terrain.js';
import { footpadClearance } from './lander.js';

const MAP_W = 220;
const MAP_H = 160;

let canvas, ctx;

export function initMap() {
  canvas = document.getElementById('landing-map');
  if (!canvas) return;
  canvas.width  = MAP_W;
  canvas.height = MAP_H;
  ctx = canvas.getContext('2d');
}

export function drawMap(rocket, groundHeightAt) {
  if (!ctx) return;

  const marginX = 140;
  const xMin = rocket.x - marginX;
  const xMax = rocket.x + marginX;
  const yMin = -25;
  const yMax = Math.max(rocket.y + 60, 200);

  const worldW = xMax - xMin;
  const worldH = yMax - yMin;

  const inset = 14;
  const toX = wx => inset + ((wx - xMin) / worldW) * (MAP_W - inset * 2);
  const toY = wy => MAP_H - inset - ((wy - yMin) / worldH) * (MAP_H - inset * 2);

  ctx.fillStyle = 'rgba(4, 8, 18, 0.88)';
  ctx.fillRect(0, 0, MAP_W, MAP_H);

  // Grid
  ctx.strokeStyle = 'rgba(60, 90, 120, 0.25)';
  ctx.lineWidth = 0.5;
  for (let gx = Math.ceil(xMin / 50) * 50; gx <= xMax; gx += 50) {
    const px = toX(gx);
    ctx.beginPath();
    ctx.moveTo(px, inset);
    ctx.lineTo(px, MAP_H - inset);
    ctx.stroke();
  }
  for (let gy = Math.ceil(yMin / 100) * 100; gy <= yMax; gy += 100) {
    const py = toY(gy);
    ctx.beginPath();
    ctx.moveTo(inset, py);
    ctx.lineTo(MAP_W - inset, py);
    ctx.stroke();
  }

  // Terrain
  const steps = 80;
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const wx = xMin + (i / steps) * worldW;
    const px = toX(wx);
    const py = toY(groundHeightAt(wx));
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.lineTo(toX(xMax), MAP_H - inset);
  ctx.lineTo(toX(xMin), MAP_H - inset);
  ctx.closePath();
  ctx.fillStyle = 'rgba(90, 82, 72, 0.9)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(130, 120, 108, 0.6)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const wx = xMin + (i / steps) * worldW;
    if (i === 0) ctx.moveTo(toX(wx), toY(groundHeightAt(wx)));
    else ctx.lineTo(toX(wx), toY(groundHeightAt(wx)));
  }
  ctx.stroke();

  // Crater rims visible in side view
  for (const c of CRATERS) {
    if (c.x + c.r < xMin || c.x - c.r > xMax) continue;
    if (Math.abs(c.z) > c.r * 0.85) continue;
    const cx = toX(c.x);
    const cy = toY(groundHeightAt(c.x) + c.rim * 0.25);
    const rx = (c.r / worldW) * (MAP_W - inset * 2);
    const ry = (c.r / worldH) * (MAP_H - inset * 2) * 0.55;
    ctx.strokeStyle = 'rgba(100, 92, 82, 0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, Math.max(3, ry), 0, Math.PI, 0);
    ctx.stroke();
    ctx.fillStyle = 'rgba(70, 64, 58, 0.25)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + ry * 0.3, rx * 0.85, Math.max(2, ry * 0.7), 0, 0, Math.PI);
    ctx.fill();
  }

  // Predicted impact
  if (rocket.vy < -0.5) {
    const altNow = footpadClearance(rocket, groundHeightAt);
    const tLand  = altNow / (-rocket.vy);
    if (tLand > 0 && tLand < 120) {
      const predX = rocket.x + rocket.vx * tLand;
      ctx.strokeStyle = 'rgba(255, 180, 60, 0.45)';
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(toX(rocket.x), toY(rocket.y));
      ctx.lineTo(toX(predX), toY(groundHeightAt(predX)));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255, 120, 60, 0.7)';
      ctx.beginPath();
      ctx.arc(toX(predX), toY(groundHeightAt(predX)), 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Velocity vector
  const vScale = 4;
  ctx.strokeStyle = 'rgba(126, 200, 255, 0.75)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(toX(rocket.x), toY(rocket.y));
  ctx.lineTo(toX(rocket.x + rocket.vx * vScale), toY(rocket.y + rocket.vy * vScale));
  ctx.stroke();

  // Rocket
  const rx = toX(rocket.x);
  const ry = toY(rocket.y);
  const rLen = 7;
  const sinA = Math.sin(rocket.angle);
  const cosA = Math.cos(rocket.angle);
  ctx.fillStyle = '#e8f0ff';
  ctx.strokeStyle = 'rgba(126, 200, 255, 0.9)';
  ctx.beginPath();
  ctx.moveTo(rx + sinA * rLen, ry - cosA * rLen);
  ctx.lineTo(rx - sinA * 3 - cosA * 4, ry + cosA * 3 - sinA * 4);
  ctx.lineTo(rx - sinA * 3 + cosA * 4, ry + cosA * 3 + sinA * 4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = 'rgba(126, 200, 255, 0.35)';
  ctx.strokeRect(0.5, 0.5, MAP_W - 1, MAP_H - 1);

  ctx.fillStyle = 'rgba(126, 200, 255, 0.7)';
  ctx.font = '9px Share Tech Mono, monospace';
  ctx.textAlign = 'left';
  ctx.fillText('TERRAIN MAP', 6, 11);
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(100, 140, 170, 0.8)';
  const alt = footpadClearance(rocket, groundHeightAt);
  const spd = Math.sqrt(rocket.vx ** 2 + rocket.vy ** 2);
  ctx.fillText(`${alt.toFixed(0)}m alt · ${spd.toFixed(1)} m/s`, MAP_W - 6, MAP_H - 5);
}
