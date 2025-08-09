import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, useWindowDimensions, Platform, Vibration } from 'react-native';
import { Canvas, useCanvasRef, useDrawCallback, Skia, Paint, Path, Group } from '@shopify/react-native-skia';
import { StatusBar } from 'expo-status-bar';
import { Audio, AVPlaybackStatusSuccess } from 'expo-av';

// Types
interface Guard { x: number; y: number; dir: 1 | -1; speed: number; minX: number; maxX: number; phase: number; }
interface Horse { x: number; y: number; dir: 1 | -1; speed: number; minX: number; maxX: number; phase: number; }
interface Balloon { x: number; y: number; vy: number; r: number; color: string; popped: boolean; wobble: number; }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; age: number; color: string; }

const POP_URL = 'https://assets.mixkit.co/active_storage/sfx/2561/2561-preview.mp3'; // short pop

function randomBalloonColor() {
  const palette = ['#ff6b6b', '#ffd36b', '#6bffb0', '#6bd0ff', '#c06bff', '#ff8ad4'];
  return palette[Math.floor(Math.random() * palette.length)];
}

function shade(hex: string, amt: number) {
  const clamp = (n: number) => Math.max(0, Math.min(255, n));
  const c = hex.replace('#', '');
  const num = parseInt(c, 16);
  const r = num >> 16;
  const g = (num >> 8) & 0xff;
  const b = num & 0xff;
  const f = (v: number) => clamp(Math.round(v + (amt >= 0 ? (255 - v) * amt : v * amt)));
  return `#${((1 << 24) + (f(r) << 16) + (f(g) << 8) + f(b)).toString(16).slice(1)}`;
}

function useRaf(onFrame: (dt: number) => void) {
  const lastTs = useRef<number | null>(null);
  useEffect(() => {
    let raf = 0;
    const loop = (ts: number) => {
      const last = lastTs.current ?? ts;
      const dt = Math.min(0.033, (ts - last) / 1000);
      lastTs.current = ts;
      onFrame(dt);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [onFrame]);
}

export default function App() {
  const { width, height } = useWindowDimensions();
  const canvasRef = useCanvasRef();

  // UI state
  const [score, setScore] = useState(0);
  const [balloonGame, setBalloonGame] = useState(false);
  const [balloonCount, setBalloonCount] = useState(0);

  // Audio
  const popSoundRef = useRef<Audio.Sound | null>(null);
  const ensurePopSound = useCallback(async () => {
    if (popSoundRef.current) return popSoundRef.current;
    const { sound } = await Audio.Sound.createAsync({ uri: POP_URL }, { volume: 0.8 });
    popSoundRef.current = sound;
    return sound;
  }, []);
  useEffect(() => {
    return () => { popSoundRef.current?.unloadAsync(); };
  }, []);
  const playPop = useCallback(async () => {
    try {
      const s = await ensurePopSound();
      const status = await s.getStatusAsync();
      if ((status as AVPlaybackStatusSuccess).isLoaded) {
        await s.replayAsync();
      }
    } catch {
      Vibration.vibrate(10);
    }
  }, [ensurePopSound]);

  // World/actors state kept in refs (mutable, avoids re-rendering)
  const timeRef = useRef(0);
  const guardsRef = useRef<Guard[]>([]);
  const horsesRef = useRef<Horse[]>([]);
  const balloonsRef = useRef<Balloon[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const spawnAccRef = useRef(0);

  const castle = useMemo(() => ({
    x: () => width * 0.5,
    y: () => height * 0.7,
    w: () => Math.min(900, width * 0.8),
    h: () => Math.min(380, height * 0.42),
  }), [width, height]);

  const resetActors = useCallback(() => {
    const guards: Guard[] = [];
    const horses: Horse[] = [];
    const topY = castle.y() - castle.h() * 0.75;
    const leftX = castle.x() - castle.w() * 0.4;
    const rightX = castle.x() + castle.w() * 0.4;
    for (let i = 0; i < 6; i++) {
      const start = leftX + (i / 6) * (rightX - leftX);
      guards.push({ x: start, y: topY, minX: leftX, maxX: rightX, dir: Math.random() > 0.5 ? 1 : -1, speed: 30 + Math.random() * 20, phase: Math.random() * Math.PI * 2 });
    }
    const groundY = castle.y() + 12;
    const gLeft = castle.x() - castle.w() * 0.45;
    const gRight = castle.x() + castle.w() * 0.45;
    for (let i = 0; i < 3; i++) {
      const start = gLeft + Math.random() * (gRight - gLeft);
      horses.push({ x: start, y: groundY, minX: gLeft, maxX: gRight, dir: Math.random() > 0.5 ? 1 : -1, speed: 40 + Math.random() * 25, phase: Math.random() * Math.PI * 2 });
    }
    guardsRef.current = guards;
    horsesRef.current = horses;
  }, [castle]);

  const resetGame = useCallback(() => {
    setScore(0);
    balloonsRef.current = [];
    particlesRef.current = [];
    spawnAccRef.current = 0;
    setBalloonCount(0);
    resetActors();
  }, [resetActors]);

  useEffect(() => { resetActors(); }, [resetActors]);

  // Spawning
  const spawnBalloon = useCallback(() => {
    const margin = Math.min(140, width * 0.12);
    const x = margin + Math.random() * (width - margin * 2);
    const y = height + 30;
    const r = 16 + Math.random() * 10;
    const vy = -(18 + Math.random() * 14);
    balloonsRef.current.push({ x, y, vy, r, color: randomBalloonColor(), popped: false, wobble: Math.random() * Math.PI * 2 });
    setBalloonCount(balloonsRef.current.length);
  }, [width, height]);

  // Touch handler on canvas
  const onTouch = useCallback(async (x: number, y: number) => {
    const arr = balloonsRef.current;
    for (let i = arr.length - 1; i >= 0; i--) {
      const b = arr[i];
      if (b.popped) continue;
      const dx = x - b.x;
      const dy = y - b.y;
      if (dx * dx + dy * dy <= b.r * b.r * 1.2) {
        b.popped = true;
        // confetti
        const count = 14 + Math.floor(Math.random() * 10);
        for (let j = 0; j < count; j++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 60 + Math.random() * 160;
          const vx = Math.cos(angle) * speed;
          const vy = Math.sin(angle) * speed - 80;
          const life = 0.6 + Math.random() * 0.6;
          const color = Math.random() < 0.4 ? b.color : randomBalloonColor();
          particlesRef.current.push({ x: b.x, y: b.y, vx, vy, life, age: 0, color });
        }
        await playPop();
        setScore(s => s + 1);
        break;
      }
    }
  }, [playPop]);

  // RAF game loop (update world + invalidate canvas)
  useRaf((dt) => {
    timeRef.current += dt;

    // guards
    for (const g of guardsRef.current) {
      g.x += g.dir * g.speed * dt;
      g.phase += dt * 8;
      if (g.x < g.minX || g.x > g.maxX) { g.dir *= -1; g.x = Math.max(g.minX, Math.min(g.maxX, g.x)); }
    }

    // horses
    for (const h of horsesRef.current) {
      h.x += h.dir * h.speed * dt;
      h.phase += dt * 6;
      if (h.x < h.minX || h.x > h.maxX) { h.dir *= -1; h.x = Math.max(h.minX, Math.min(h.maxX, h.x)); }
    }

    // balloons
    if (balloonGame) {
      spawnAccRef.current += dt;
      const every = 0.8;
      while (spawnAccRef.current >= every) { spawnAccRef.current -= every; spawnBalloon(); }
    }
    const alive: Balloon[] = [];
    for (const b of balloonsRef.current) {
      if (!b.popped) {
        b.y += b.vy * dt;
        b.wobble += dt * 1.5;
        if (b.y + b.r > -40) alive.push(b);
      }
    }
    balloonsRef.current = alive;
    setBalloonCount(alive.length);

    // particles
    const aliveP: Particle[] = [];
    for (const p of particlesRef.current) {
      p.age += dt;
      p.vy += 200 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.age < p.life) aliveP.push(p);
    }
    particlesRef.current = aliveP;

    // redraw
    canvasRef.current?.redraw();
  });

  // Draw callback
  const draw = useDrawCallback((canvas, info) => {
    const t = timeRef.current;

    // sky
    const sky = Skia.Shader.MakeLinearGradient(
      { x: 0, y: 0 }, { x: 0, y: height },
      [Skia.Color('#eaf5ff'), Skia.Color('#a8d0ff')], null, 'clamp'
    );
    const skyPaint = Skia.Paint();
    skyPaint.setShader(sky);
    canvas.drawRect(Skia.XYWHRect(0, 0, width, height), skyPaint);

    // sun
    const sunPaint = Skia.Paint();
    sunPaint.setColor(Skia.Color('rgba(255,230,160,0.9)'));
    canvas.drawCircle(width * 0.12, height * 0.16, 40, sunPaint);

    // clouds (simple moving strokes based on time)
    const cloudPaint = Skia.Paint();
    cloudPaint.setColor(Skia.Color('rgba(255,255,255,0.9)'));
    for (let i = 0; i < Math.max(4, Math.floor(width / 400)); i++) {
      const x = ((t * (10 + i * 3)) % (width + 120)) - 60;
      const y = 20 + (i * 35) % (height * 0.3);
      canvas.drawCircle(x, y, 24, cloudPaint);
      canvas.drawCircle(x + 20, y - 10, 18, cloudPaint);
      canvas.drawCircle(x - 22, y - 8, 20, cloudPaint);
      canvas.drawCircle(x + 10, y + 8, 22, cloudPaint);
    }

    // ground
    const groundY = castle.y() + 16;
    const grass = Skia.Shader.MakeLinearGradient(
      { x: 0, y: groundY }, { x: 0, y: height },
      [Skia.Color('#a7d36b'), Skia.Color('#6cb148')], null, 'clamp'
    );
    const grassPaint = Skia.Paint();
    grassPaint.setShader(grass);
    canvas.drawRect(Skia.XYWHRect(0, groundY, width, height - groundY), grassPaint);

    // castle shadow
    const shadowPaint = Skia.Paint();
    shadowPaint.setColor(Skia.Color('rgba(0,0,0,0.06)'));
    canvas.drawOval(Skia.XYWHRect(castle.x() - castle.w() * 0.55, castle.y() + castle.h() * 0.2, castle.w() * 1.1, castle.h() * 0.36), shadowPaint);

    // castle walls
    const wallTop = castle.y() - castle.h() * 0.5;
    const wallHeight = castle.h() * 0.45;
    const wallWidth = castle.w() * 0.75;
    const wallLeft = castle.x() - wallWidth / 2;
    const brick = Skia.Shader.MakeLinearGradient(
      { x: wallLeft, y: wallTop }, { x: wallLeft, y: wallTop + wallHeight },
      [Skia.Color('#d2d5df'), Skia.Color('#b7bbc7')], null, 'clamp'
    );
    const wallPaint = Skia.Paint(); wallPaint.setShader(brick);
    canvas.drawRect(Skia.XYWHRect(wallLeft, wallTop, wallWidth, wallHeight), wallPaint);

    // crenellations
    const crenPaint = Skia.Paint(); crenPaint.setColor(Skia.Color('#c5c9d6'));
    const blockW = 22; const blockH = 14; const gap = 10; const y = wallTop + 10;
    for (let xi = wallLeft + 8; xi < wallLeft + wallWidth - 16 - blockW; xi += blockW + gap) {
      canvas.drawRect(Skia.XYWHRect(xi, y - blockH, blockW, blockH), crenPaint);
    }

    // gate
    const gateW = Math.max(70, castle.w() * 0.12);
    const gateH = wallHeight * 0.7;
    const gateX = wallLeft + wallWidth / 2 - gateW / 2;
    const gateY = wallTop + wallHeight - gateH;
    const gatePaint = Skia.Paint(); gatePaint.setColor(Skia.Color('#74553b'));
    const r = 12;
    const gatePath = Skia.Path.Make();
    gatePath.moveTo(gateX, gateY + r);
    gatePath.arcTo(gateX, gateY, gateX + r, gateY, r);
    gatePath.lineTo(gateX + gateW - r, gateY);
    gatePath.arcTo(gateX + gateW, gateY, gateX + gateW, gateY + r, r);
    gatePath.lineTo(gateX + gateW, gateY + gateH);
    gatePath.lineTo(gateX, gateY + gateH);
    gatePath.close();
    canvas.drawPath(gatePath, gatePaint);

    const gateLine = Skia.Paint(); gateLine.setColor(Skia.Color('rgba(0,0,0,0.25)')); gateLine.setStrokeWidth(2); gateLine.setStyle(Paint.Style.Stroke);
    for (let i = 1; i < 5; i++) {
      const gx = gateX + (gateW / 5) * i;
      canvas.drawLine(gx, gateY + 4, gx, gateY + gateH - 4, gateLine);
    }

    // towers
    const towerW = castle.w() * 0.18; const towerH = castle.h() * 0.6;
    const tLeftX = wallLeft - towerW * 0.2; const tRightX = wallLeft + wallWidth - towerW * 0.8; const tY = castle.y() - towerH * 0.6;
    const towerGrad = (x: number) => {
      const g = Skia.Shader.MakeLinearGradient({ x, y: tY }, { x, y: tY + towerH }, [Skia.Color('#e2e5ee'), Skia.Color('#c5cad8')], null, 'clamp');
      const p = Skia.Paint(); p.setShader(g); return p;
    };
    canvas.drawRect(Skia.XYWHRect(tLeftX, tY, towerW, towerH), towerGrad(tLeftX));
    canvas.drawRect(Skia.XYWHRect(tRightX, tY, towerW, towerH), towerGrad(tRightX));
    const crenP = Skia.Paint(); crenP.setColor(Skia.Color('#c5c9d6'));
    for (let xi = tLeftX + 6; xi < tLeftX + towerW - 12 - 22; xi += 32) {
      canvas.drawRect(Skia.XYWHRect(xi, tY + 12 - 14, 22, 14), crenP);
    }
    for (let xi = tRightX + 6; xi < tRightX + towerW - 12 - 22; xi += 32) {
      canvas.drawRect(Skia.XYWHRect(xi, tY + 12 - 14, 22, 14), crenP);
    }
    const winPaint = Skia.Paint(); winPaint.setColor(Skia.Color('#3b4a5e'));
    for (let i = 0; i < 3; i++) {
      canvas.drawRect(Skia.XYWHRect(tLeftX + towerW * 0.35, tY + 40 + i * 60, towerW * 0.3, 14), winPaint);
      canvas.drawRect(Skia.XYWHRect(tRightX + towerW * 0.35, tY + 40 + i * 60, towerW * 0.3, 14), winPaint);
    }

    // simple flags (triangles waving)
    const flag = (x: number, phase: number, a: string, b: string) => {
      const w = 36; const h = 18; const yTop = tY + 6 - 40 + 6; // pole height
      const pole = Skia.Paint(); pole.setColor(Skia.Color('#555a66')); pole.setStrokeWidth(2); pole.setStyle(Paint.Style.Stroke);
      canvas.drawLine(x, tY + 6, x, yTop, pole);
      const path = Skia.Path.Make();
      const steps = 5;
      path.moveTo(x, yTop);
      for (let i = 0; i <= steps; i++) {
        const px = x + (w / steps) * i;
        const py = yTop + Math.sin(timeRef.current * 4 + i * 0.6 + phase) * 6;
        path.lineTo(px, py);
      }
      path.lineTo(x + w, yTop + h + Math.sin(timeRef.current * 4 + 3.5 + phase) * 6);
      for (let i = steps; i >= 0; i--) {
        const px = x + (w / steps) * i;
        const py = yTop + h + Math.sin(timeRef.current * 4 + i * 0.55 + 0.3 + phase) * 6;
        path.lineTo(px, py);
      }
      path.close();
      const grad = Skia.Shader.MakeLinearGradient({ x, y: yTop }, { x: x + w, y: yTop + h }, [Skia.Color(a), Skia.Color(b)], null, 'clamp');
      const p = Skia.Paint(); p.setShader(grad);
      canvas.drawPath(path, p);
    };
    flag(tLeftX + towerW * 0.5, 0, '#ff6b6b', '#ffd0d0');
    flag(tRightX + towerW * 0.5, 0.6, '#6bd0ff', '#bfe8ff');

    // guards
    const guardBody = Skia.Paint(); guardBody.setColor(Skia.Color('#3b4a5e'));
    const skin = Skia.Paint(); skin.setColor(Skia.Color('#f5d3b1'));
    const helmet = Skia.Paint(); helmet.setColor(Skia.Color('#aab4c5'));
    const leg = Skia.Paint(); leg.setColor(Skia.Color('#2a333f')); leg.setStrokeWidth(3); leg.setStyle(Paint.Style.Stroke); leg.setStrokeCap(Paint.Cap.Round);
    const spear = Skia.Paint(); spear.setColor(Skia.Color('#8f9bad')); spear.setStrokeWidth(2);
    for (const g of guardsRef.current) {
      // body
      canvas.drawRect(Skia.XYWHRect(g.x - 6, g.y - 22, 12, 18), guardBody);
      // head
      canvas.drawCircle(g.x, g.y - 28, 6, skin);
      // helmet
      canvas.drawRect(Skia.XYWHRect(g.x - 7, g.y - 34, 14, 4), helmet);
      // legs
      const legOffset = Math.sin(g.phase) * 3;
      canvas.drawLine(g.x - 3, g.y - 4, g.x - 3 + legOffset, g.y + 6, leg);
      canvas.drawLine(g.x + 3, g.y - 4, g.x + 3 - legOffset, g.y + 6, leg);
      // spear
      canvas.drawLine(g.x + 8, g.y - 18, g.x + 16, g.y - 34, spear);
    }

    // horses
    const body = Skia.Paint(); body.setColor(Skia.Color('#7a553a'));
    const dark = Skia.Paint(); dark.setColor(Skia.Color('#6a4a33')); dark.setStrokeWidth(3); dark.setStyle(Paint.Style.Stroke); dark.setStrokeCap(Paint.Cap.Round);
    const tail = Skia.Paint(); tail.setColor(Skia.Color('#523726')); tail.setStrokeWidth(2);
    for (const h of horsesRef.current) {
      // body
      canvas.drawOval(Skia.XYWHRect(h.x - 20, h.y - 22, 40, 24), body);
      canvas.drawOval(Skia.XYWHRect(h.x + 10, h.y - 24, 16, 12), body);
      canvas.drawRect(Skia.XYWHRect(h.x + 12, h.y - 20, 8, 10), body);
      const swing = Math.sin(h.phase) * 4;
      canvas.drawLine(h.x - 8, h.y - 2, h.x - 8 + swing, h.y + 12, dark);
      canvas.drawLine(h.x + 8, h.y - 2, h.x + 8 - swing, h.y + 12, dark);
      canvas.drawLine(h.x - 2, h.y - 2, h.x - 2 - swing, h.y + 12, dark);
      canvas.drawLine(h.x + 2, h.y - 2, h.x + 2 + swing, h.y + 12, dark);
      const tailPath = Skia.Path.Make();
      tailPath.moveTo(h.x - 18, h.y - 14);
      tailPath.quadTo(h.x - 24, h.y - 8 + swing * 0.2, h.x - 20, h.y - 2);
      canvas.drawPath(tailPath, tail);
    }

    // balloons
    for (const b of balloonsRef.current) {
      // string
      const string = Skia.Path.Make();
      const sway = Math.sin(b.wobble + timeRef.current * 2) * 8;
      string.moveTo(b.x, b.y + b.r);
      string.cubicTo(b.x + sway * 0.2, b.y + b.r + 10, b.x + sway * 0.6, b.y + b.r + 24, b.x + sway, b.y + b.r + 38);
      const sPaint = Skia.Paint(); sPaint.setColor(Skia.Color('rgba(0,0,0,0.25)')); sPaint.setStyle(Paint.Style.Stroke); sPaint.setStrokeWidth(1);
      canvas.drawPath(string, sPaint);

      // body
      const grad = Skia.Shader.MakeRadialGradient(
        { x: b.x - b.r * 0.4, y: b.y - b.r * 0.4 }, b.r, [Skia.Color('rgba(255,255,255,0.9)'), Skia.Color(b.color), Skia.Color(shade(b.color, -0.2))], [0, 0.15, 1], 'clamp'
      );
      const p = Skia.Paint(); p.setShader(grad);
      const oval = Skia.RRectXY(Skia.XYWHRect(b.x - b.r * 0.9, b.y - b.r * 1.1, b.r * 1.8, b.r * 2.2), b.r * 0.9, b.r * 0.9);
      canvas.drawRRect(oval, p);
      const knot = Skia.Paint(); knot.setColor(Skia.Color(shade(b.color, -0.3)));
      const knotPath = Skia.Path.Make();
      knotPath.moveTo(b.x - 3, b.y + b.r * 0.8);
      knotPath.lineTo(b.x, b.y + b.r * 0.95);
      knotPath.lineTo(b.x + 3, b.y + b.r * 0.8);
      knotPath.close();
      canvas.drawPath(knotPath, knot);
    }

    // particles
    for (const p of particlesRef.current) {
      const alpha = Math.max(0, 1 - p.age / p.life);
      const paint = Skia.Paint();
      paint.setColor(Skia.Color(p.color));
      paint.setAlphaf(alpha);
      canvas.drawCircle(p.x, p.y, 2 + Math.random() * 2, paint);
    }
  }, [width, height]);

  // Pass touch events to our handler
  const handleResponder = useCallback((evt: any) => {
    const { locationX, locationY } = evt.nativeEvent;
    onTouch(locationX, locationY);
  }, [onTouch]);

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <Canvas ref={canvasRef} style={{ width, height }} onTouch={handleResponder} onStart={handleResponder} onEnd={() => {}} onStroke={handleResponder} onActive={handleResponder} onPointerDown={handleResponder}>
        {/* All drawing is done in useDrawCallback via manual redraw */}
        <Group layer>{/* dummy group to keep Canvas non-empty */}</Group>
      </Canvas>

      <View style={styles.panel} pointerEvents="box-none">
        <View style={styles.card}>
          <Text style={styles.title}>Castle & Balloon Pop</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Score: <Text style={styles.value}>{score}</Text></Text>
            <Text style={styles.label}>Balloons: <Text style={styles.value}>{balloonCount}</Text></Text>
          </View>
          <View style={styles.controls}>
            <Pressable style={styles.btnPrimary} onPress={() => setBalloonGame(g => !g)}>
              <Text style={styles.btnText}>{balloonGame ? 'Stop Balloon Game' : 'Start Balloon Game'}</Text>
            </Pressable>
            <Pressable style={styles.btnGhost} onPress={resetGame}>
              <Text style={[styles.btnText, { color: '#0f1a2a' }]}>Reset</Text>
            </Pressable>
          </View>
          <Text style={styles.hint}>Tap balloons to pop! A short pop sound plays.</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#cfe4ff' },
  panel: { position: 'absolute', top: 16, left: 16, right: 16 },
  card: {
    backgroundColor: 'rgba(255,255,255,0.6)',
    borderRadius: 16, padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.6)',
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 10 },
  },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 10, color: '#0f1a2a' },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  label: { color: '#49586c', fontWeight: '600' },
  value: { color: '#0f1a2a' },
  controls: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  btnPrimary: {
    backgroundColor: '#5b7bff', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10,
    shadowColor: '#5b7bff', shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 6 },
  },
  btnGhost: { backgroundColor: 'rgba(255,255,255,0.85)', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10 },
  btnText: { color: 'white', fontWeight: '700' },
  hint: { color: '#49586c', fontSize: 12 },
});
