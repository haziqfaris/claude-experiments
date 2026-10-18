// Crossings in 3D: repos glow in an inner ring, chats orbit outside them in their project colours. A line runs from a
// chat to each repo it changed; light flows along it when the chat committed or pushed. When a push lands in a repo
// another chat works in, the repo sends a shockwave and an amber pulse runs out to that chat: it should pull.
import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { ChatItem, Crossings } from '../types';
import { hueOf } from '../projects';
import { chatName } from './ui';

export interface SceneProps {
  data: Crossings;
  chats: ChatItem[];
  /** Repo or chat to light up, from outside (the alert list). */
  focus: string | null;
  onChat: (id: string) => void;
  onRepo: (id: string | null) => void;
  /** The chat or repo under the pointer, so the page can say what it is. */
  onHover?: (id: string | null) => void;
}

const BG = 0x0b1220;
const PUSH = new THREE.Color('#fb923c');
const ATTEND = new THREE.Color('#fbbf24');
const FOREIGN = new THREE.Color('#b39dff');
const R_REPO = 4.2, R_CHAT = 9.5;

/** A soft round dot, drawn once, for particles and stars. */
function dotTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!, gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

interface Flow { curve: THREE.Curve<THREE.Vector3>; pts: THREE.Points; speed: number; n: number; off: number }
interface Pulse { mesh: THREE.Mesh; period: number; off: number; max: number }
interface Node { id: string; kind: 'chat' | 'repo'; obj: THREE.Object3D; core: THREE.Mesh; label: CSS2DObject; base: number; spin?: THREE.Object3D; breathe: number }
interface Edge { a: string; b: string; mats: (THREE.Material & { opacity: number })[]; base: number[] }

const Crossings3D: React.FC<SceneProps> = ({ data, chats, focus, onChat, onRepo, onHover }) => {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{ build: (d: Crossings, c: ChatItem[]) => void; focus: (id: string | null) => void } | null>(null);
  const cb = useRef({ onChat, onRepo, onHover }); cb.current = { onChat, onRepo, onHover };

  useEffect(() => {
    const el = host.current!;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }); }
    catch { el.innerHTML = '<p class="small dim" style="padding:24px">This browser cannot draw 3D here. The list beside it has everything.</p>'; return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    el.appendChild(renderer.domElement);
    const labels = new CSS2DRenderer();
    labels.domElement.className = 'x3-labels';
    el.appendChild(labels.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(BG);
    scene.fog = new THREE.FogExp2(BG, 0.022);
    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 400);
    camera.position.set(0, 14.5, 16.5);
    const controls = new OrbitControls(camera, labels.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.06;
    controls.minDistance = 8; controls.maxDistance = 42; controls.maxPolarAngle = Math.PI * 0.47;
    controls.autoRotate = !reduce; controls.autoRotateSpeed = 0.35;
    controls.target.set(0, 0.6, 0);
    let idleTimer: ReturnType<typeof setTimeout>;
    controls.addEventListener('start', () => { controls.autoRotate = false; clearTimeout(idleTimer); });
    controls.addEventListener('end', () => { idleTimer = setTimeout(() => { controls.autoRotate = !reduce; }, 9000); });

    scene.add(new THREE.AmbientLight(0x8fb4ff, 0.55));
    const key = new THREE.PointLight(0x34d399, 40, 40); key.position.set(0, 6, 0); scene.add(key);
    const rim = new THREE.DirectionalLight(0x9db8ff, 0.8); rim.position.set(-8, 10, -6); scene.add(rim);

    const dot = dotTexture();
    // Stars and a polar floor: depth without noise.
    {
      const n = 900, pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { const r = 60 + Math.random() * 90, t = Math.random() * Math.PI * 2, p = Math.acos(Math.random() * 2 - 1); pos.set([r * Math.sin(p) * Math.cos(t), Math.abs(r * Math.cos(p)) * 0.8 - 8, r * Math.sin(p) * Math.sin(t)], i * 3); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      scene.add(new THREE.Points(g, new THREE.PointsMaterial({ size: 0.6, map: dot, transparent: true, depthWrite: false, color: 0x9fb4d8, opacity: 0.55, fog: false })));
      const grid = new THREE.PolarGridHelper(14, 16, 6, 96, 0x1f3b4a, 0x142a36);
      (grid.material as THREE.Material).transparent = true; (grid.material as THREE.Material & { opacity: number }).opacity = 0.55;
      grid.position.y = -1.6; scene.add(grid);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(R_REPO + 1.2, 96), new THREE.MeshBasicMaterial({ color: 0x34d399, transparent: true, opacity: 0.035, depthWrite: false }));
      disc.rotation.x = -Math.PI / 2; disc.position.y = -1.58; scene.add(disc);
    }

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.62, 0.5, 0.28);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    // ---- The graph: rebuilt when the data changes; the camera stays where you left it ----
    let graph = new THREE.Group(); scene.add(graph);
    let nodes: Node[] = [], edges: Edge[] = [], flows: Flow[] = [], pulses: Pulse[] = [];
    let focused: string | null = null, hovered: string | null = null;

    const dispose = (o: THREE.Object3D) => o.traverse((x) => {
      const m = x as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((q) => q.dispose());
      if (x instanceof CSS2DObject) x.element.remove();
    });

    const label = (html: string, cls: string) => { const d = document.createElement('div'); d.className = `x3-label ${cls}`; d.innerHTML = html; return new CSS2DObject(d); };
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

    const build = (d: Crossings, allChats: ChatItem[]) => {
      graph.removeFromParent(); dispose(graph);
      graph = new THREE.Group(); scene.add(graph);
      nodes = []; edges = []; flows = []; pulses = [];
      const byChat = new Map(allChats.map((c) => [c.id, c]));
      const now = Date.now();
      // Repos on the inner ring, grouped by project so a project's repos sit together.
      const repos = [...d.repos].sort((a, b) => a.project.localeCompare(b.project) || a.name.localeCompare(b.name));
      const angle = new Map<string, number>();
      const pos = new Map<string, THREE.Vector3>();
      repos.forEach((r, i) => {
        const a = (i / Math.max(1, repos.length)) * Math.PI * 2 + 0.3;
        angle.set(r.id, a);
        const rr = repos.length === 1 ? 0 : R_REPO;
        pos.set(r.id, new THREE.Vector3(Math.cos(a) * rr, 0.4, Math.sin(a) * rr));
      });
      // Chats outside, each near the repos it touched, spread so none overlap.
      const chatIds = [...new Set(d.links.map((l) => l.chat))].filter((id) => byChat.has(id));
      const want = chatIds.map((id) => {
        const ls = d.links.filter((l) => l.chat === id);
        const x = ls.reduce((s, l) => s + Math.cos(angle.get(l.repo) ?? 0), 0), z = ls.reduce((s, l) => s + Math.sin(angle.get(l.repo) ?? 0), 0);
        return { id, a: Math.atan2(z, x) };
      }).sort((p, q) => p.a - q.a);
      const gap = (Math.PI * 2) / Math.max(want.length, 1);
      want.forEach((w, i) => {
        const even = want[0].a + i * gap, a = want.length > 2 ? even * 0.55 + w.a * 0.45 : w.a + i * 0.6;
        const c = byChat.get(w.id)!;
        pos.set(w.id, new THREE.Vector3(Math.cos(a) * R_CHAT, 0.9 + (c.state === 'working' ? 1.1 : c.state === 'waiting' ? 0.6 : 0) + Math.sin(i * 1.7) * 0.5, Math.sin(a) * R_CHAT));
      });

      for (const r of repos) {
        const hue = new THREE.Color(hueOf(r.project));
        const g = new THREE.Group(); g.position.copy(pos.get(r.id)!);
        const size = 0.55 + Math.min(r.chats, 5) * 0.12;
        const core = new THREE.Mesh(new THREE.IcosahedronGeometry(size, 2), new THREE.MeshStandardMaterial({ color: hue, emissive: hue, emissiveIntensity: r.hot ? 1.1 : 0.55, roughness: 0.35, metalness: 0.2 }));
        core.userData = { id: r.id, kind: 'repo' };
        const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(size * 1.55, 1), new THREE.MeshBasicMaterial({ color: r.hot ? ATTEND : hue, wireframe: true, transparent: true, opacity: r.hot ? 0.55 : 0.22 }));
        const ring = new THREE.Mesh(new THREE.TorusGeometry(size * 2, 0.025, 8, 96), new THREE.MeshBasicMaterial({ color: r.hot ? ATTEND : hue, transparent: true, opacity: 0.5 }));
        ring.rotation.x = Math.PI / 2; ring.position.y = -0.2;
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 2, 6), new THREE.MeshBasicMaterial({ color: hue, transparent: true, opacity: 0.25 }));
        stem.position.y = -1;
        g.add(core, shell, ring, stem);
        const flags = [r.branch ? esc(r.branch) : '', r.behind ? `<i class="warn">${r.behind} behind GitHub</i>` : '', r.ahead ? `${r.ahead} not pushed` : '', r.dirty ? `${r.dirty} files changed` : ''].filter(Boolean).join(' · ');
        const lb = label(`<b>${esc(r.name)}</b><span>${esc(r.project)}${flags ? ` · ${flags}` : ''}</span>`, `x3-repo${r.hot ? ' x3-hot' : ''}`);
        lb.position.set(0, size * 1.9 + 0.35, 0); g.add(lb);
        graph.add(g);
        nodes.push({ id: r.id, kind: 'repo', obj: g, core, label: lb, base: r.hot ? 1.1 : 0.55, spin: shell, breathe: Math.random() * 6 });
        if (r.hot) pulses.push({ mesh: ring, period: 2.4, off: Math.random() * 2, max: 1.5 });
      }

      for (const id of chatIds) {
        const c = byChat.get(id)!;
        const hue = new THREE.Color(hueOf(c.project));
        const g = new THREE.Group(); g.position.copy(pos.get(id)!);
        const live = c.state !== 'idle';
        const core = new THREE.Mesh(new THREE.SphereGeometry(c.state === 'working' ? 0.38 : 0.3, 32, 16), new THREE.MeshStandardMaterial({ color: hue, emissive: hue, emissiveIntensity: live ? 1.2 : 0.25, roughness: 0.3 }));
        core.userData = { id, kind: 'chat' };
        g.add(core);
        const needs = d.alerts.some((a) => a.to === id && a.level === 'attend');
        if (needs || c.state === 'waiting') {
          const halo = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.62, 48), new THREE.MeshBasicMaterial({ color: ATTEND, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
          halo.lookAt(camera.position); g.add(halo);
          pulses.push({ mesh: halo, period: 1.6, off: Math.random(), max: 1.8 });
        }
        const shadow = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, g.position.y + 1.6, 4), new THREE.MeshBasicMaterial({ color: hue, transparent: true, opacity: 0.12 }));
        shadow.position.y = -(g.position.y + 1.6) / 2; g.add(shadow);
        const state = needs ? '<i class="warn">needs you</i>' : c.state === 'working' ? '<i class="ok">working</i>' : c.state === 'waiting' ? '<i class="warn">waiting</i>' : 'idle';
        const lb = label(`<b>${esc(chatName(c))}</b><span>${esc(c.project)} · ${state}</span>`, `x3-chat${needs ? ' x3-hot' : ''}${live || needs ? '' : ' x3-quiet'}`);
        lb.position.set(0, 0.75, 0); g.add(lb);
        graph.add(g);
        nodes.push({ id, kind: 'chat', obj: g, core, label: lb, base: live ? 1.2 : 0.25, breathe: Math.random() * 6 });
      }

      // Lines: a chat to each repo it worked in. Thicker and orange with flowing light when it committed or pushed.
      const arc = (a: THREE.Vector3, b: THREE.Vector3, lift: number) => {
        const mid = a.clone().add(b).multiplyScalar(0.5); mid.y += lift + a.distanceTo(b) * 0.12;
        return new THREE.QuadraticBezierCurve3(a.clone(), mid, b.clone());
      };
      for (const l of d.links) {
        const a = pos.get(l.chat), b = pos.get(l.repo); if (!a || !b) continue;
        const c = byChat.get(l.chat)!;
        const wrote = l.commits + l.pushes + l.merges > 0;
        const curve = arc(a, b, wrote ? 1.6 : 0.8);
        const col = l.foreign ? FOREIGN : wrote ? PUSH : new THREE.Color(hueOf(c.project));
        const mats: Edge['mats'] = [], base: number[] = [];
        if (l.foreign) {
          const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(64));
          const line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: col, dashSize: 0.35, gapSize: 0.22, transparent: true, opacity: 0.85 }));
          line.computeLineDistances(); graph.add(line);
          mats.push(line.material as THREE.LineDashedMaterial); base.push(0.85);
        }
        const radius = l.edits || wrote ? Math.min(0.02 + (l.edits * 0.002) + (l.commits + l.pushes * 2) * 0.008, 0.09) : 0.012;
        const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 64, radius, 8, false), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: wrote ? 0.75 : l.edits ? 0.45 : 0.18, depthWrite: false, blending: THREE.AdditiveBlending }));
        graph.add(tube);
        mats.push(tube.material as THREE.MeshBasicMaterial); base.push((tube.material as THREE.MeshBasicMaterial).opacity);
        edges.push({ a: l.chat, b: l.repo, mats, base });
        // Light flows chat to repo: fast for recent pushes, slow for edits, none for a chat that only sits there.
        const recent = now - l.lastAt < 3 * 3_600_000;
        if (wrote || (l.edits && recent)) {
          const n = wrote ? 7 : 3;
          const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
          const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: wrote ? 0.42 : 0.28, map: dot, color: wrote ? PUSH : col, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
          graph.add(pts);
          flows.push({ curve, pts, n, off: Math.random(), speed: (wrote ? 0.22 : 0.08) * (recent ? 1.6 : 1) });
          mats.push(pts.material as THREE.PointsMaterial); base.push(1);
        }
      }
      // What needs you: from the repo out to the chat that should pull, an amber pulse; the repo sends a shockwave.
      for (const al of d.alerts.filter((x) => x.level === 'attend' && x.to)) {
        const a = pos.get(al.repo), b = pos.get(al.to!); if (!a || !b) continue;
        const curve = arc(a, b, 2.6);
        const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 64, 0.045, 8, false), new THREE.MeshBasicMaterial({ color: ATTEND, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
        graph.add(tube);
        const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(4 * 3), 3));
        const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.6, map: dot, color: ATTEND, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
        graph.add(pts);
        flows.push({ curve, pts, n: 4, off: 0, speed: 0.3 });
        edges.push({ a: al.repo, b: al.to!, mats: [tube.material as THREE.MeshBasicMaterial, pts.material as THREE.PointsMaterial], base: [0.55, 1] });
        if (now - al.at < 30 * 60_000) {
          const wave = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 64), new THREE.MeshBasicMaterial({ color: PUSH, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
          wave.rotation.x = -Math.PI / 2; wave.position.copy(a); wave.position.y -= 0.2; graph.add(wave);
          pulses.push({ mesh: wave, period: 2.2, off: 0, max: 5 });
        }
      }
      applyFocus();
    };

    // ---- Focus: light one node and what it touches; dim the rest ----
    const applyFocus = () => {
      const f = hovered ?? focused;
      const near = new Set<string>();
      if (f) { near.add(f); for (const e of edges) if (e.a === f || e.b === f) { near.add(e.a); near.add(e.b); } }
      for (const e of edges) { const on = !f || e.a === f || e.b === f; e.mats.forEach((m, i) => { m.opacity = on ? e.base[i] : e.base[i] * 0.1; }); }
      for (const nd of nodes) {
        const on = !f || near.has(nd.id);
        (nd.core.material as THREE.MeshStandardMaterial).emissiveIntensity = on ? nd.base * (f === nd.id ? 1.6 : 1) : 0.08;
        nd.label.element.classList.toggle('x3-dim', !on);
        nd.label.element.classList.toggle('x3-focus', f === nd.id);
      }
    };

    // ---- Pointer: hover lights a node, click opens it ----
    const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
    let downAt = { x: 0, y: 0 };
    const pick = (ev: PointerEvent) => {
      const r = labels.domElement.getBoundingClientRect();
      ptr.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ptr, camera);
      const hit = ray.intersectObjects(nodes.map((nd) => nd.core), false)[0];
      return hit ? (hit.object.userData as { id: string; kind: 'chat' | 'repo' }) : null;
    };
    const onMove = (ev: PointerEvent) => {
      const h = pick(ev);
      const id = h?.id ?? null;
      labels.domElement.style.cursor = id ? 'pointer' : 'grab';
      if (id !== hovered) { hovered = id; applyFocus(); cb.current.onHover?.(id); }
    };
    const onDown = (ev: PointerEvent) => { downAt = { x: ev.clientX, y: ev.clientY }; };
    const onUp = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y) > 5) return;
      const h = pick(ev);
      if (!h) { cb.current.onRepo(null); return; }
      if (h.kind === 'chat') cb.current.onChat(h.id); else cb.current.onRepo(h.id);
    };
    const onLeave = () => { if (hovered) { hovered = null; applyFocus(); cb.current.onHover?.(null); } };
    labels.domElement.addEventListener('pointermove', onMove);
    labels.domElement.addEventListener('pointerdown', onDown);
    labels.domElement.addEventListener('pointerup', onUp);
    labels.domElement.addEventListener('pointerleave', onLeave);

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h); labels.setSize(w, h); composer.setSize(w, h); bloom.setSize(w, h);
      camera.aspect = w / h;
      if (w < 600) camera.position.setLength(30);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize); ro.observe(el); resize();

    // ---- The loop: stops while the tab is hidden ----
    const clock = new THREE.Clock();
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (document.hidden) return;
      const t = clock.getElapsedTime();
      controls.update();
      const mv = reduce ? 0 : 1;
      for (const f of flows) {
        const arr = (f.pts.geometry.getAttribute('position') as THREE.BufferAttribute);
        for (let i = 0; i < f.n; i++) {
          const u = ((t * f.speed * mv + f.off + i / f.n) % 1 + 1) % 1;
          const p = f.curve.getPointAt(u); arr.setXYZ(i, p.x, p.y, p.z);
        }
        arr.needsUpdate = true;
      }
      for (const p of pulses) {
        const u = reduce ? 0.4 : ((t + p.off) % p.period) / p.period;
        const s = 1 + u * (p.max - 1); p.mesh.scale.set(s, s, s);
        (p.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - u);
      }
      for (const nd of nodes) {
        if (nd.spin && !reduce) { nd.spin.rotation.y = t * 0.25 + nd.breathe; nd.spin.rotation.x = t * 0.11; }
        if (!reduce) nd.core.position.y = Math.sin(t * 1.3 + nd.breathe) * (nd.kind === 'chat' ? 0.12 : 0.05);
        for (const ch of nd.obj.children) if (ch instanceof THREE.Mesh && ch.geometry instanceof THREE.RingGeometry && nd.kind === 'chat') ch.lookAt(camera.position);
      }
      key.intensity = 34 + Math.sin(t * 0.8) * 6;
      composer.render();
      labels.render(scene, camera);
    };
    tick();

    api.current = { build, focus: (id) => { focused = id; applyFocus(); } };
    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); clearTimeout(idleTimer);
      controls.dispose(); dispose(scene); dot.dispose(); composer.dispose(); renderer.dispose();
      el.innerHTML = '';
      api.current = null;
    };
  }, []);

  // Rebuild only when what is drawn changes, not on every poll.
  const sig = JSON.stringify([data.repos.map((r) => [r.id, r.hot, r.behind, r.branch, r.chats]), data.links.map((l) => [l.chat, l.repo, l.edits, l.commits, l.pushes, l.merges, l.foreign]), data.alerts.map((a) => a.id),
    chats.filter((c) => data.links.some((l) => l.chat === c.id)).map((c) => [c.id, c.state, c.name])]);
  useEffect(() => { api.current?.build(data, chats); }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api.current?.focus(focus); }, [focus]);

  return <div ref={host} className="x3" role="img" aria-label="Chats and the repos they change, in 3D. The list beside it says the same in words." />;
};

export default Crossings3D;
