import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

// Shared geometry for smoke particles (Bug 6 fix: avoid allocating per particle)
const SMOKE_GEOMETRY = new THREE.SphereGeometry(0.3, 4, 4);

// Recursive dispose helper for GPU resource cleanup (Bug 7 fix)
function disposeObject(obj) {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
        if (Array.isArray(obj.material)) {
            obj.material.forEach(m => m.dispose());
        } else {
            obj.material.dispose();
        }
    }
    if (obj.children) {
        for (const child of obj.children) {
            disposeObject(child);
        }
    }
}

// ============================================================
// CONFIGURATION
// ============================================================
const CONFIG = {
    TOTAL_LAPS: 3,
    NUM_AI: 5,
    TRACK_WIDTH: 14,
    CAR_STATS: [
        { name: 'Veloce GT', maxSpeed: 280, acceleration: 38, handling: 0.7, braking: 42, color: 0xff2222 },
        { name: 'Apex RS', maxSpeed: 250, acceleration: 35, handling: 0.85, braking: 45, color: 0x2266ff },
        { name: 'Nitro X', maxSpeed: 220, acceleration: 32, handling: 1.0, braking: 48, color: 0xffaa00 },
    ],
    AI_COLORS: [0x22cc44, 0xcc22cc, 0x22cccc, 0xcccc22, 0xff6622],
    GRAVITY: -20,
    CAMERA_MODES: ['chase', 'hood', 'far', 'top'],
};

// ============================================================
// TRACK DEFINITION - Circuit layout via control points
// ============================================================
function generateTrackPoints() {
    const points = [];
    // Realistic GP-style circuit with varied corners
    const trackData = [
        // Start/Finish straight
        { x: 0, z: 0 },
        { x: 80, z: 0 },
        { x: 160, z: 0 },
        // Turn 1 - fast right
        { x: 220, z: 10 },
        { x: 260, z: 40 },
        { x: 270, z: 80 },
        // Back straight with gentle curve
        { x: 260, z: 140 },
        { x: 240, z: 200 },
        // Chicane
        { x: 210, z: 240 },
        { x: 190, z: 260 },
        { x: 200, z: 290 },
        // Hairpin
        { x: 220, z: 340 },
        { x: 210, z: 380 },
        { x: 170, z: 400 },
        { x: 130, z: 390 },
        // Fast sweeping section
        { x: 100, z: 350 },
        { x: 60, z: 300 },
        { x: 20, z: 260 },
        // S-curves
        { x: -20, z: 220 },
        { x: -40, z: 180 },
        { x: -20, z: 140 },
        { x: 10, z: 110 },
        // Final corner back to straight
        { x: -10, z: 70 },
        { x: -30, z: 40 },
        { x: -20, z: 10 },
    ];

    for (const p of trackData) {
        points.push(new THREE.Vector3(p.x, 0, p.z));
    }
    return points;
}

// ============================================================
// TEXTURE GENERATORS
// ============================================================
class TextureGen {
    static createCanvas(w, h) {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        return { canvas: c, ctx: c.getContext('2d') };
    }

    static asphalt() {
        const { canvas, ctx } = this.createCanvas(512, 512);
        ctx.fillStyle = '#3a3a3a';
        ctx.fillRect(0, 0, 512, 512);
        // Noise for realistic asphalt
        for (let i = 0; i < 30000; i++) {
            const x = Math.random() * 512;
            const y = Math.random() * 512;
            const v = 40 + Math.random() * 30;
            ctx.fillStyle = `rgb(${v},${v},${v})`;
            ctx.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 2);
        }
        // Subtle tire marks
        ctx.strokeStyle = 'rgba(30,30,30,0.3)';
        ctx.lineWidth = 3;
        for (let i = 0; i < 5; i++) {
            ctx.beginPath();
            ctx.moveTo(Math.random() * 512, 0);
            ctx.lineTo(Math.random() * 512, 512);
            ctx.stroke();
        }
        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(1, 1);
        return tex;
    }

    static roadMarkings() {
        const { canvas, ctx } = this.createCanvas(512, 512);
        ctx.clearRect(0, 0, 512, 512);
        // Center dashed line
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.setLineDash([30, 20]);
        ctx.beginPath();
        ctx.moveTo(256, 0);
        ctx.lineTo(256, 512);
        ctx.stroke();
        ctx.setLineDash([]);
        // Edge lines
        ctx.strokeStyle = '#ff0000';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(20, 0); ctx.lineTo(20, 512);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(492, 0); ctx.lineTo(492, 512);
        ctx.stroke();
        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.transparent = true;
        return tex;
    }

    static grass() {
        const { canvas, ctx } = this.createCanvas(256, 256);
        ctx.fillStyle = '#2d5a1e';
        ctx.fillRect(0, 0, 256, 256);
        for (let i = 0; i < 8000; i++) {
            const x = Math.random() * 256;
            const y = Math.random() * 256;
            const g = 30 + Math.random() * 50;
            const r = 20 + Math.random() * 25;
            ctx.fillStyle = `rgb(${r},${60 + g},${15 + Math.random() * 20})`;
            ctx.fillRect(x, y, 1 + Math.random(), 2 + Math.random() * 3);
        }
        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(80, 80);
        return tex;
    }

    static curb() {
        const { canvas, ctx } = this.createCanvas(128, 128);
        const stripeW = 16;
        for (let i = 0; i < 128 / stripeW; i++) {
            ctx.fillStyle = i % 2 === 0 ? '#ff0000' : '#ffffff';
            ctx.fillRect(i * stripeW, 0, stripeW, 128);
        }
        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        return tex;
    }

    static concrete() {
        const { canvas, ctx } = this.createCanvas(256, 256);
        ctx.fillStyle = '#888888';
        ctx.fillRect(0, 0, 256, 256);
        for (let i = 0; i < 5000; i++) {
            const x = Math.random() * 256;
            const y = Math.random() * 256;
            const v = 120 + Math.random() * 40;
            ctx.fillStyle = `rgb(${v},${v},${v})`;
            ctx.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 2);
        }
        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(4, 4);
        return tex;
    }

    static metalPaint(color) {
        const { canvas, ctx } = this.createCanvas(128, 128);
        const c = new THREE.Color(color);
        ctx.fillStyle = `rgb(${c.r*255|0},${c.g*255|0},${c.b*255|0})`;
        ctx.fillRect(0, 0, 128, 128);
        // Metallic flake effect
        for (let i = 0; i < 2000; i++) {
            const x = Math.random() * 128;
            const y = Math.random() * 128;
            const a = 0.05 + Math.random() * 0.1;
            ctx.fillStyle = `rgba(255,255,255,${a})`;
            ctx.fillRect(x, y, 1, 1);
        }
        const tex = new THREE.CanvasTexture(canvas);
        return tex;
    }

    static sky() {
        const { canvas, ctx } = this.createCanvas(1024, 512);
        const grad = ctx.createLinearGradient(0, 0, 0, 512);
        grad.addColorStop(0, '#0a1628');
        grad.addColorStop(0.3, '#1a3a6a');
        grad.addColorStop(0.5, '#4a8abd');
        grad.addColorStop(0.7, '#7ab8e0');
        grad.addColorStop(1.0, '#b8daf0');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 1024, 512);
        // Clouds
        for (let i = 0; i < 15; i++) {
            const cx = Math.random() * 1024;
            const cy = 100 + Math.random() * 200;
            ctx.fillStyle = `rgba(255,255,255,${0.15 + Math.random() * 0.2})`;
            for (let j = 0; j < 8; j++) {
                const r = 20 + Math.random() * 40;
                ctx.beginPath();
                ctx.arc(cx + (Math.random() - 0.5) * 80, cy + (Math.random() - 0.5) * 20, r, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        const tex = new THREE.CanvasTexture(canvas);
        tex.mapping = THREE.EquirectangularReflectionMapping;
        return tex;
    }

    static tireTrack() {
        const { canvas, ctx } = this.createCanvas(64, 64);
        ctx.fillStyle = '#222';
        for (let y = 0; y < 64; y += 4) {
            ctx.fillRect(10, y, 20, 2);
            ctx.fillRect(34, y, 20, 2);
        }
        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        return tex;
    }
}

// ============================================================
// CAR BUILDER - Detailed procedural 3D car model
// ============================================================
class CarBuilder {
    static build(color, isPlayer = false) {
        const group = new THREE.Group();
        const bodyMat = new THREE.MeshStandardMaterial({
            color: color,
            metalness: 0.8,
            roughness: 0.2,
            envMapIntensity: 1.0,
        });
        const darkMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.5, roughness: 0.3 });
        const chromeMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 1.0, roughness: 0.1 });
        const glassMat = new THREE.MeshStandardMaterial({ color: 0x4488aa, metalness: 0.3, roughness: 0.1, transparent: true, opacity: 0.5 });
        const redMat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0x330000, metalness: 0.5, roughness: 0.3 });
        const headlightMat = new THREE.MeshStandardMaterial({ color: 0xffffee, emissive: 0xffffcc, emissiveIntensity: 0.5 });

        // Main body - sleek racing car shape
        const bodyShape = new THREE.Shape();
        bodyShape.moveTo(-2.2, 0.15);
        bodyShape.lineTo(-1.8, 0.1);
        bodyShape.lineTo(-0.5, 0.1);
        bodyShape.lineTo(0.3, 0.3);
        bodyShape.lineTo(0.8, 0.65);
        bodyShape.lineTo(0.5, 0.85);
        bodyShape.lineTo(-0.2, 0.9);
        bodyShape.lineTo(-1.0, 0.75);
        bodyShape.lineTo(-2.0, 0.55);
        bodyShape.lineTo(-2.3, 0.35);
        bodyShape.closePath();

        const bodyExtrudeSettings = { depth: 1.6, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 3 };
        const bodyGeo = new THREE.ExtrudeGeometry(bodyShape, bodyExtrudeSettings);
        bodyGeo.translate(0, 0, -0.8);
        const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
        bodyMesh.castShadow = true;
        bodyMesh.receiveShadow = true;
        group.add(bodyMesh);

        // Hood/bonnet - lower front section
        const hoodGeo = new THREE.BoxGeometry(1.4, 0.15, 1.5);
        const hood = new THREE.Mesh(hoodGeo, bodyMat);
        hood.position.set(-1.4, 0.2, 0);
        hood.castShadow = true;
        group.add(hood);

        // Roof scoop
        const scoopGeo = new THREE.BoxGeometry(0.3, 0.12, 0.4);
        const scoop = new THREE.Mesh(scoopGeo, darkMat);
        scoop.position.set(0.1, 0.95, 0);
        group.add(scoop);

        // Windshield
        const windshieldGeo = new THREE.BoxGeometry(0.6, 0.45, 1.4);
        const windshield = new THREE.Mesh(windshieldGeo, glassMat);
        windshield.position.set(0.2, 0.7, 0);
        windshield.rotation.z = -0.2;
        group.add(windshield);

        // Rear windshield
        const rearWindGeo = new THREE.BoxGeometry(0.5, 0.35, 1.3);
        const rearWind = new THREE.Mesh(rearWindGeo, glassMat);
        rearWind.position.set(-0.6, 0.7, 0);
        rearWind.rotation.z = 0.25;
        group.add(rearWind);

        // Side windows
        for (const side of [-1, 1]) {
            const winGeo = new THREE.BoxGeometry(0.8, 0.3, 0.05);
            const win = new THREE.Mesh(winGeo, glassMat);
            win.position.set(-0.1, 0.7, side * 0.78);
            group.add(win);
        }

        // Front splitter
        const splitterGeo = new THREE.BoxGeometry(0.3, 0.04, 1.7);
        const splitter = new THREE.Mesh(splitterGeo, darkMat);
        splitter.position.set(-2.15, 0.08, 0);
        group.add(splitter);

        // Rear diffuser
        const diffuserGeo = new THREE.BoxGeometry(0.4, 0.15, 1.6);
        const diffuser = new THREE.Mesh(diffuserGeo, darkMat);
        diffuser.position.set(1.0, 0.15, 0);
        group.add(diffuser);

        // Rear wing
        const wingPillarGeo = new THREE.BoxGeometry(0.06, 0.35, 0.06);
        for (const side of [-0.6, 0.6]) {
            const pillar = new THREE.Mesh(wingPillarGeo, darkMat);
            pillar.position.set(0.9, 0.7, side);
            group.add(pillar);
        }
        const wingGeo = new THREE.BoxGeometry(0.35, 0.04, 1.5);
        const wing = new THREE.Mesh(wingGeo, bodyMat);
        wing.position.set(0.9, 0.9, 0);
        wing.castShadow = true;
        group.add(wing);

        // Wing endplates
        for (const side of [-0.75, 0.75]) {
            const plateGeo = new THREE.BoxGeometry(0.35, 0.2, 0.03);
            const plate = new THREE.Mesh(plateGeo, bodyMat);
            plate.position.set(0.9, 0.85, side);
            group.add(plate);
        }

        // Side skirts
        for (const side of [-1, 1]) {
            const skirtGeo = new THREE.BoxGeometry(2.5, 0.08, 0.05);
            const skirt = new THREE.Mesh(skirtGeo, darkMat);
            skirt.position.set(-0.5, 0.1, side * 0.82);
            group.add(skirt);
        }

        // Side mirrors
        for (const side of [-1, 1]) {
            const mirrorGeo = new THREE.BoxGeometry(0.15, 0.08, 0.1);
            const mirror = new THREE.Mesh(mirrorGeo, darkMat);
            mirror.position.set(-0.3, 0.6, side * 0.9);
            group.add(mirror);
        }

        // Headlights
        for (const side of [-0.5, 0.5]) {
            const hlGeo = new THREE.BoxGeometry(0.08, 0.1, 0.25);
            const hl = new THREE.Mesh(hlGeo, headlightMat);
            hl.position.set(-2.18, 0.28, side);
            group.add(hl);
        }

        // Tail lights
        for (const side of [-0.55, 0.55]) {
            const tlGeo = new THREE.BoxGeometry(0.06, 0.12, 0.3);
            const tl = new THREE.Mesh(tlGeo, redMat);
            tl.position.set(1.02, 0.35, side);
            group.add(tl);
        }

        // Exhaust pipes
        for (const side of [-0.25, 0.25]) {
            const exGeo = new THREE.CylinderGeometry(0.04, 0.05, 0.15, 8);
            const ex = new THREE.Mesh(exGeo, chromeMat);
            ex.rotation.z = Math.PI / 2;
            ex.position.set(1.08, 0.18, side);
            group.add(ex);
        }

        // Wheels
        const wheelPositions = [
            { x: -1.5, z: 0.78 }, { x: -1.5, z: -0.78 },
            { x: 0.7, z: 0.78 }, { x: 0.7, z: -0.78 },
        ];

        wheelPositions.forEach((pos, i) => {
            const wheelGroup = new THREE.Group();
            wheelGroup.userData.isWheel = true;

            // Tire
            const tireGeo = new THREE.TorusGeometry(0.28, 0.12, 12, 24);
            const tireMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9, metalness: 0.1 });
            const tire = new THREE.Mesh(tireGeo, tireMat);
            tire.castShadow = true;
            wheelGroup.add(tire);

            // Rim
            const rimGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.15, 12);
            const rimMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.95, roughness: 0.1 });
            const rim = new THREE.Mesh(rimGeo, rimMat);
            rim.rotation.x = Math.PI / 2;
            wheelGroup.add(rim);

            // Spokes
            for (let s = 0; s < 5; s++) {
                const spokeGeo = new THREE.BoxGeometry(0.03, 0.16, 0.16);
                const spoke = new THREE.Mesh(spokeGeo, rimMat);
                spoke.rotation.z = (s / 5) * Math.PI;
                spoke.position.y = pos.z > 0 ? 0.01 : -0.01;
                wheelGroup.add(spoke);
            }

            // Brake disc (visible through spokes)
            const discGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.02, 16);
            const discMat = new THREE.MeshStandardMaterial({ color: 0x666666, metalness: 0.8, roughness: 0.4 });
            const disc = new THREE.Mesh(discGeo, discMat);
            disc.rotation.x = Math.PI / 2;
            wheelGroup.add(disc);

            // Brake caliper
            const caliperGeo = new THREE.BoxGeometry(0.06, 0.08, 0.08);
            const caliperMat = new THREE.MeshStandardMaterial({ color: 0xff0000, metalness: 0.5, roughness: 0.3 });
            const caliper = new THREE.Mesh(caliperGeo, caliperMat);
            caliper.position.set(0, 0.12, 0);
            wheelGroup.add(caliper);

            wheelGroup.rotation.y = Math.PI / 2;
            wheelGroup.position.set(pos.x, 0.28, pos.z);
            wheelGroup.userData.isFrontWheel = i < 2;
            group.add(wheelGroup);
        });

        // Underbody
        const underGeo = new THREE.BoxGeometry(3.8, 0.04, 1.5);
        const under = new THREE.Mesh(underGeo, darkMat);
        under.position.set(-0.4, 0.06, 0);
        group.add(under);

        // Racing number on side (simple)
        group.userData.type = 'car';
        return group;
    }
}

// ============================================================
// TRACK BUILDER
// ============================================================
class TrackBuilder {
    constructor(scene) {
        this.scene = scene;
        this.trackCurve = null;
        this.trackLength = 0;
        this.trackMeshes = [];
    }

    build() {
        const controlPoints = generateTrackPoints();
        this.trackCurve = new THREE.CatmullRomCurve3(controlPoints, true, 'catmullrom', 0.5);
        this.trackLength = this.trackCurve.getLength();

        this.createTrackSurface();
        this.createCurbs();
        this.createBarriers();
        this.createStartFinishLine();
        this.createGround();
        this.createEnvironment();

        return this.trackCurve;
    }

    createTrackSurface() {
        const divisions = 800;
        const halfWidth = CONFIG.TRACK_WIDTH / 2;
        const vertices = [];
        const uvs = [];
        const indices = [];
        const normals = [];

        for (let i = 0; i <= divisions; i++) {
            const t = i / divisions;
            const point = this.trackCurve.getPointAt(t);
            const tangent = this.trackCurve.getTangentAt(t);
            const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

            const left = point.clone().add(normal.clone().multiplyScalar(halfWidth));
            const right = point.clone().add(normal.clone().multiplyScalar(-halfWidth));

            vertices.push(left.x, 0.01, left.z);
            vertices.push(right.x, 0.01, right.z);

            uvs.push(0, t * 60);
            uvs.push(1, t * 60);

            normals.push(0, 1, 0, 0, 1, 0);

            if (i < divisions) {
                const base = i * 2;
                indices.push(base, base + 1, base + 2);
                indices.push(base + 1, base + 3, base + 2);
            }
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        geo.setIndex(indices);

        const asphaltTex = TextureGen.asphalt();
        asphaltTex.repeat.set(2, 60);
        const mat = new THREE.MeshStandardMaterial({
            map: asphaltTex,
            roughness: 0.8,
            metalness: 0.1,
            color: 0x555555,
        });

        const mesh = new THREE.Mesh(geo, mat);
        mesh.receiveShadow = true;
        this.scene.add(mesh);
        this.trackMeshes.push(mesh);
    }

    createCurbs() {
        const divisions = 800;
        const halfWidth = CONFIG.TRACK_WIDTH / 2;
        const curbWidth = 1.0;
        const curbTex = TextureGen.curb();

        for (const side of [-1, 1]) {
            const vertices = [];
            const uvs = [];
            const indices = [];
            const normals = [];

            for (let i = 0; i <= divisions; i++) {
                const t = i / divisions;
                const point = this.trackCurve.getPointAt(t);
                const tangent = this.trackCurve.getTangentAt(t);
                const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

                const inner = point.clone().add(normal.clone().multiplyScalar(side * halfWidth));
                const outer = point.clone().add(normal.clone().multiplyScalar(side * (halfWidth + curbWidth)));

                vertices.push(inner.x, 0.02, inner.z);
                vertices.push(outer.x, 0.02, outer.z);
                uvs.push(0, t * 120);
                uvs.push(1, t * 120);
                normals.push(0, 1, 0, 0, 1, 0);

                if (i < divisions) {
                    const base = i * 2;
                    indices.push(base, base + 1, base + 2);
                    indices.push(base + 1, base + 3, base + 2);
                }
            }

            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
            geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
            geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
            geo.setIndex(indices);

            const mat = new THREE.MeshStandardMaterial({ map: curbTex, roughness: 0.7 });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.receiveShadow = true;
            this.scene.add(mesh);
        }
    }

    createBarriers() {
        const divisions = 200;
        const halfWidth = CONFIG.TRACK_WIDTH / 2 + 2.5;
        const barrierHeight = 1.2;

        const concreteTex = TextureGen.concrete();

        for (const side of [-1, 1]) {
            const vertices = [];
            const uvs = [];
            const indices = [];
            const normals = [];

            for (let i = 0; i <= divisions; i++) {
                const t = i / divisions;
                const point = this.trackCurve.getPointAt(t);
                const tangent = this.trackCurve.getTangentAt(t);
                const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
                const pos = point.clone().add(normal.clone().multiplyScalar(side * halfWidth));

                // Bottom
                vertices.push(pos.x, 0, pos.z);
                // Top
                vertices.push(pos.x, barrierHeight, pos.z);

                uvs.push(t * 100, 0);
                uvs.push(t * 100, 1);

                normals.push(normal.x * side, 0, normal.z * side);
                normals.push(normal.x * side, 0, normal.z * side);

                if (i < divisions) {
                    const base = i * 2;
                    indices.push(base, base + 2, base + 1);
                    indices.push(base + 1, base + 2, base + 3);
                }
            }

            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
            geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
            geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
            geo.setIndex(indices);

            const mat = new THREE.MeshStandardMaterial({
                map: concreteTex,
                roughness: 0.9,
                color: 0xbbbbbb,
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            this.scene.add(mesh);

            // Red-white stripes on top
            const topVertices = [];
            const topIndices = [];
            const topUvs = [];
            const topNormals = [];
            for (let i = 0; i <= divisions; i++) {
                const t = i / divisions;
                const point = this.trackCurve.getPointAt(t);
                const tangent = this.trackCurve.getTangentAt(t);
                const normal2 = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
                const pos2 = point.clone().add(normal2.clone().multiplyScalar(side * halfWidth));

                topVertices.push(pos2.x - normal2.x * side * 0.3, barrierHeight, pos2.z - normal2.z * side * 0.3);
                topVertices.push(pos2.x + normal2.x * side * 0.3, barrierHeight, pos2.z + normal2.z * side * 0.3);
                topUvs.push(0, t * 80);
                topUvs.push(1, t * 80);
                topNormals.push(0, 1, 0, 0, 1, 0);

                if (i < divisions) {
                    const base = i * 2;
                    topIndices.push(base, base + 1, base + 2);
                    topIndices.push(base + 1, base + 3, base + 2);
                }
            }
            const topGeo = new THREE.BufferGeometry();
            topGeo.setAttribute('position', new THREE.Float32BufferAttribute(topVertices, 3));
            topGeo.setAttribute('uv', new THREE.Float32BufferAttribute(topUvs, 2));
            topGeo.setAttribute('normal', new THREE.Float32BufferAttribute(topNormals, 3));
            topGeo.setIndex(topIndices);
            const topMat = new THREE.MeshStandardMaterial({ map: TextureGen.curb(), roughness: 0.5 });
            const topMesh = new THREE.Mesh(topGeo, topMat);
            this.scene.add(topMesh);
        }
    }

    createStartFinishLine() {
        // Start/finish line
        const startPoint = this.trackCurve.getPointAt(0);
        const startTangent = this.trackCurve.getTangentAt(0);
        const startNormal = new THREE.Vector3(-startTangent.z, 0, startTangent.x).normalize();

        const lineGeo = new THREE.PlaneGeometry(CONFIG.TRACK_WIDTH, 3);
        const { canvas, ctx } = TextureGen.createCanvas(256, 64);
        // Checkered pattern
        const sq = 16;
        for (let x = 0; x < 256; x += sq) {
            for (let y = 0; y < 64; y += sq) {
                ctx.fillStyle = ((x / sq + y / sq) % 2 === 0) ? '#ffffff' : '#111111';
                ctx.fillRect(x, y, sq, sq);
            }
        }
        const lineTex = new THREE.CanvasTexture(canvas);
        const lineMat = new THREE.MeshStandardMaterial({ map: lineTex, roughness: 0.6 });
        const lineMesh = new THREE.Mesh(lineGeo, lineMat);
        lineMesh.rotation.x = -Math.PI / 2;
        lineMesh.position.set(startPoint.x, 0.03, startPoint.z);
        lineMesh.rotation.z = -Math.atan2(startTangent.z, startTangent.x);
        this.scene.add(lineMesh);

        // Start gantry
        const gantryMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.7, roughness: 0.3 });
        for (const side of [-1, 1]) {
            const pillarGeo = new THREE.BoxGeometry(0.5, 8, 0.5);
            const pillar = new THREE.Mesh(pillarGeo, gantryMat);
            const pPos = startPoint.clone().add(startNormal.clone().multiplyScalar(side * (CONFIG.TRACK_WIDTH / 2 + 1.5)));
            pillar.position.set(pPos.x, 4, pPos.z);
            pillar.castShadow = true;
            this.scene.add(pillar);
        }
        const beamGeo = new THREE.BoxGeometry(CONFIG.TRACK_WIDTH + 3, 1.5, 1);
        const beam = new THREE.Mesh(beamGeo, gantryMat);
        beam.position.set(startPoint.x, 7.5, startPoint.z);
        beam.rotation.y = -Math.atan2(startTangent.z, startTangent.x) + Math.PI / 2;
        beam.castShadow = true;
        this.scene.add(beam);

        // Signal lights on gantry
        for (let i = 0; i < 5; i++) {
            const lightGeo = new THREE.SphereGeometry(0.2, 12, 12);
            const lightMat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0x440000 });
            const light = new THREE.Mesh(lightGeo, lightMat);
            const offset = (i - 2) * 1.2;
            const lPos = startPoint.clone().add(startNormal.clone().multiplyScalar(offset));
            light.position.set(lPos.x, 7.5, lPos.z);
            this.scene.add(light);
        }
    }

    createGround() {
        const groundGeo = new THREE.PlaneGeometry(1200, 1200);
        const groundMat = new THREE.MeshStandardMaterial({
            map: TextureGen.grass(),
            roughness: 0.95,
            color: 0x3a7a2a,
        });
        const ground = new THREE.Mesh(groundGeo, groundMat);
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -0.05;
        ground.receiveShadow = true;
        this.scene.add(ground);
    }

    createEnvironment() {
        this.createTrees();
        this.createGrandstands();
        this.createPitBuildings();
        this.createLightPoles();
        this.createBillboards();
    }

    createTrees() {
        const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3728, roughness: 0.9 });
        const leafMats = [
            new THREE.MeshStandardMaterial({ color: 0x2d6b1e, roughness: 0.8 }),
            new THREE.MeshStandardMaterial({ color: 0x1e5a14, roughness: 0.8 }),
            new THREE.MeshStandardMaterial({ color: 0x3a8a2e, roughness: 0.8 }),
        ];

        const treePositions = [];
        for (let i = 0; i < 250; i++) {
            const t = Math.random();
            const point = this.trackCurve.getPointAt(t);
            const tangent = this.trackCurve.getTangentAt(t);
            const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
            const dist = (CONFIG.TRACK_WIDTH / 2 + 8 + Math.random() * 60) * (Math.random() > 0.5 ? 1 : -1);
            const pos = point.clone().add(normal.clone().multiplyScalar(dist));
            pos.x += (Math.random() - 0.5) * 10;
            pos.z += (Math.random() - 0.5) * 10;
            treePositions.push(pos);
        }

        for (const pos of treePositions) {
            const treeGroup = new THREE.Group();
            const height = 4 + Math.random() * 6;
            const trunkGeo = new THREE.CylinderGeometry(0.15, 0.25, height, 6);
            const trunk = new THREE.Mesh(trunkGeo, trunkMat);
            trunk.position.y = height / 2;
            trunk.castShadow = true;
            treeGroup.add(trunk);

            const leafMat = leafMats[Math.floor(Math.random() * leafMats.length)];
            const layers = 2 + Math.floor(Math.random() * 3);
            for (let l = 0; l < layers; l++) {
                const radius = 1.5 + Math.random() * 2 - l * 0.4;
                const canopyGeo = new THREE.SphereGeometry(radius, 8, 6);
                const canopy = new THREE.Mesh(canopyGeo, leafMat);
                canopy.position.y = height - 1 + l * 1.2;
                canopy.scale.y = 0.6 + Math.random() * 0.3;
                canopy.castShadow = true;
                treeGroup.add(canopy);
            }

            treeGroup.position.set(pos.x, 0, pos.z);
            this.scene.add(treeGroup);
        }
    }

    createGrandstands() {
        // Place grandstands along straights
        const standLocations = [
            { t: 0.02, side: 1, length: 40, rows: 6 },
            { t: 0.06, side: -1, length: 30, rows: 5 },
            { t: 0.35, side: 1, length: 25, rows: 4 },
        ];

        for (const loc of standLocations) {
            const point = this.trackCurve.getPointAt(loc.t);
            const tangent = this.trackCurve.getTangentAt(loc.t);
            const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
            const pos = point.clone().add(normal.clone().multiplyScalar(loc.side * (CONFIG.TRACK_WIDTH / 2 + 6)));

            const standGroup = new THREE.Group();
            const angle = Math.atan2(tangent.z, tangent.x);

            // Stepped seating
            for (let row = 0; row < loc.rows; row++) {
                const stepGeo = new THREE.BoxGeometry(loc.length, 1, 2);
                const stepMat = new THREE.MeshStandardMaterial({
                    color: row % 2 === 0 ? 0x888888 : 0x777777,
                    roughness: 0.9,
                });
                const step = new THREE.Mesh(stepGeo, stepMat);
                step.position.set(0, row * 1.2 + 0.5, row * 1.5 * loc.side);
                step.castShadow = true;
                step.receiveShadow = true;
                standGroup.add(step);

                // Spectator dots (simplified people)
                if (row < loc.rows - 1) {
                    for (let s = 0; s < loc.length * 1.5; s++) {
                        const specGeo = new THREE.SphereGeometry(0.2, 4, 4);
                        const specMat = new THREE.MeshStandardMaterial({
                            color: new THREE.Color().setHSL(Math.random(), 0.7, 0.5),
                        });
                        const spec = new THREE.Mesh(specGeo, specMat);
                        spec.position.set(
                            (Math.random() - 0.5) * loc.length * 0.9,
                            row * 1.2 + 1.3,
                            row * 1.5 * loc.side + (Math.random() - 0.5) * 1.5
                        );
                        standGroup.add(spec);
                    }
                }
            }

            // Roof
            const roofGeo = new THREE.BoxGeometry(loc.length + 2, 0.3, loc.rows * 2 + 4);
            const roofMat = new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.5 });
            const roof = new THREE.Mesh(roofGeo, roofMat);
            roof.position.set(0, loc.rows * 1.2 + 2, loc.rows * 0.75 * loc.side);
            roof.castShadow = true;
            standGroup.add(roof);

            standGroup.position.set(pos.x, 0, pos.z);
            standGroup.rotation.y = -angle;
            this.scene.add(standGroup);
        }
    }

    createPitBuildings() {
        const startPoint = this.trackCurve.getPointAt(0);
        const startTangent = this.trackCurve.getTangentAt(0);
        const pitNormal = new THREE.Vector3(-startTangent.z, 0, startTangent.x).normalize();

        // Pit lane building
        const buildingGroup = new THREE.Group();
        const buildingGeo = new THREE.BoxGeometry(50, 6, 10);
        const buildingMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.7 });
        const building = new THREE.Mesh(buildingGeo, buildingMat);
        building.position.y = 3;
        building.castShadow = true;
        building.receiveShadow = true;
        buildingGroup.add(building);

        // Pit wall
        const wallGeo = new THREE.BoxGeometry(50, 1.2, 0.3);
        const wallMat = new THREE.MeshStandardMaterial({ color: 0x999999 });
        const wall = new THREE.Mesh(wallGeo, wallMat);
        wall.position.set(0, 0.6, -5.5);
        buildingGroup.add(wall);

        // Garage doors
        for (let i = 0; i < 8; i++) {
            const doorGeo = new THREE.BoxGeometry(4, 3.5, 0.1);
            const doorMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
            const door = new THREE.Mesh(doorGeo, doorMat);
            door.position.set(-17.5 + i * 5.5, 2, -5);
            buildingGroup.add(door);
        }

        const pitPos = startPoint.clone().add(pitNormal.clone().multiplyScalar(-25));
        buildingGroup.position.set(pitPos.x, 0, pitPos.z);
        buildingGroup.rotation.y = -Math.atan2(startTangent.z, startTangent.x);
        this.scene.add(buildingGroup);
    }

    createLightPoles() {
        const divisions = 20;
        const halfWidth = CONFIG.TRACK_WIDTH / 2 + 4;

        for (let i = 0; i < divisions; i++) {
            const t = i / divisions;
            const point = this.trackCurve.getPointAt(t);
            const tangent = this.trackCurve.getTangentAt(t);
            const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
            const side = i % 2 === 0 ? 1 : -1;
            const pos = point.clone().add(normal.clone().multiplyScalar(side * halfWidth));

            const poleMat = new THREE.MeshStandardMaterial({ color: 0x666666, metalness: 0.7 });
            const poleGeo = new THREE.CylinderGeometry(0.08, 0.12, 12, 6);
            const pole = new THREE.Mesh(poleGeo, poleMat);
            pole.position.set(pos.x, 6, pos.z);
            pole.castShadow = true;
            this.scene.add(pole);

            // Light fixture
            const fixtureGeo = new THREE.BoxGeometry(1.5, 0.2, 0.8);
            const fixtureMat = new THREE.MeshStandardMaterial({ color: 0xffffee, emissive: 0x333322, emissiveIntensity: 0.3 });
            const fixture = new THREE.Mesh(fixtureGeo, fixtureMat);
            fixture.position.set(pos.x, 12, pos.z);
            this.scene.add(fixture);
        }
    }

    createBillboards() {
        const billboardData = [
            { t: 0.15, side: 1, text: 'GRAND PRIX', color: '#ff3333' },
            { t: 0.4, side: -1, text: 'RACING', color: '#3388ff' },
            { t: 0.65, side: 1, text: 'CHAMPION', color: '#ffaa00' },
            { t: 0.85, side: -1, text: 'SPEED', color: '#33ff33' },
        ];

        for (const bb of billboardData) {
            const point = this.trackCurve.getPointAt(bb.t);
            const tangent = this.trackCurve.getTangentAt(bb.t);
            const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
            const pos = point.clone().add(normal.clone().multiplyScalar(bb.side * (CONFIG.TRACK_WIDTH / 2 + 5)));

            // Billboard frame
            const frameGeo = new THREE.BoxGeometry(8, 4, 0.3);
            const frameMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
            const frame = new THREE.Mesh(frameGeo, frameMat);
            frame.position.set(pos.x, 5, pos.z);
            frame.rotation.y = -Math.atan2(tangent.z, tangent.x);
            frame.castShadow = true;
            this.scene.add(frame);

            // Billboard face with text
            const { canvas, ctx } = TextureGen.createCanvas(512, 256);
            ctx.fillStyle = '#111111';
            ctx.fillRect(0, 0, 512, 256);
            ctx.fillStyle = bb.color;
            ctx.font = 'bold 72px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(bb.text, 256, 150);
            const tex = new THREE.CanvasTexture(canvas);
            const faceGeo = new THREE.PlaneGeometry(7.5, 3.5);
            const faceMat = new THREE.MeshStandardMaterial({ map: tex, emissive: new THREE.Color(bb.color), emissiveIntensity: 0.15 });
            const face = new THREE.Mesh(faceGeo, faceMat);
            face.position.set(pos.x, 5, pos.z);
            face.rotation.y = -Math.atan2(tangent.z, tangent.x) + (bb.side > 0 ? Math.PI : 0);
            this.scene.add(face);

            // Support poles
            for (const dx of [-3, 3]) {
                const poleGeo = new THREE.CylinderGeometry(0.1, 0.15, 7, 6);
                const poleMat = new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.6 });
                const pole = new THREE.Mesh(poleGeo, poleMat);
                const poleOffset = new THREE.Vector3(tangent.x, 0, tangent.z).normalize().multiplyScalar(dx);
                pole.position.set(pos.x + poleOffset.x, 3.5, pos.z + poleOffset.z);
                pole.castShadow = true;
                this.scene.add(pole);
            }
        }
    }
}

// ============================================================
// CAR PHYSICS
// ============================================================
class CarPhysics {
    constructor(stats, trackCurve) {
        this.track = trackCurve;
        this.stats = stats;
        this.trackLength = trackCurve.getLength();

        // State
        this.position = new THREE.Vector3();
        this.rotation = 0; // Y rotation
        this.speed = 0; // m/s
        this.lateralSpeed = 0;
        this.engineRPM = 800;
        this.gear = 0; // 0=N, 1-6
        this.wheelAngle = 0;

        // Track progress
        this.trackT = 0;
        this.lap = 0;
        this.lastCheckpoint = 0;
        this.finished = false;
        this.totalDistance = 0;

        // Inputs
        this.throttle = 0;
        this.brake = 0;
        this.steer = 0;
        this.handbrake = false;

        // Drift
        this.driftAngle = 0;
        this.isDrifting = false;
    }

    update(dt) {
        dt = Math.min(dt, 0.05);
        const maxSpeedMs = this.stats.maxSpeed / 3.6;

        // Auto gear
        this.updateGear();

        // Engine force
        const gearRatio = this.gear === 0 ? 0 : (1.0 - (this.gear - 1) * 0.12);
        let engineForce = this.throttle * this.stats.acceleration * gearRatio;

        // Braking
        let brakeForce = this.brake * this.stats.braking;
        if (this.handbrake) brakeForce += 30;

        // Air/rolling resistance
        const dragForce = 0.4 * this.speed * this.speed * Math.sign(this.speed);
        const rollingResistance = 5 * Math.sign(this.speed);

        // Net force
        let acceleration = engineForce - brakeForce * Math.sign(this.speed) - dragForce - rollingResistance;

        // Apply if near-stopped and braking
        if (Math.abs(this.speed) < 1 && this.throttle === 0) {
            this.speed = 0;
            acceleration = 0;
        }

        this.speed += acceleration * dt;
        this.speed = THREE.MathUtils.clamp(this.speed, -maxSpeedMs * 0.2, maxSpeedMs);

        // Steering
        const speedFactor = Math.min(Math.abs(this.speed) / 15, 1);
        const steerSpeed = this.stats.handling * 3.0;
        const maxSteerAngle = 0.6 * (1 - Math.abs(this.speed) / maxSpeedMs * 0.5);
        this.wheelAngle = THREE.MathUtils.lerp(this.wheelAngle, this.steer * maxSteerAngle, dt * 8);

        // Turning
        const turnRate = this.wheelAngle * speedFactor * (this.speed > 0 ? 1 : -1);
        this.rotation += turnRate * dt * 2.5;

        // Drift mechanics
        const lateralForce = Math.abs(turnRate * this.speed) * 0.3;
        if (this.handbrake && Math.abs(this.speed) > 5) {
            this.driftAngle = THREE.MathUtils.lerp(this.driftAngle, this.steer * 0.4, dt * 3);
            this.isDrifting = true;
            this.speed *= (1 - dt * 0.5); // Lose some speed while drifting
        } else {
            this.driftAngle = THREE.MathUtils.lerp(this.driftAngle, 0, dt * 5);
            this.isDrifting = lateralForce > 8;
        }

        // Update position
        const moveDir = this.rotation + this.driftAngle;
        this.position.x += Math.cos(moveDir) * this.speed * dt;
        this.position.z += Math.sin(moveDir) * this.speed * dt;

        // Engine RPM
        const targetRPM = this.gear === 0 ? 800 :
            800 + (this.speed / maxSpeedMs) * 7200 * gearRatio + this.throttle * 1500;
        this.engineRPM = THREE.MathUtils.lerp(this.engineRPM, targetRPM, dt * 5);
        this.engineRPM = THREE.MathUtils.clamp(this.engineRPM, 600, 9000);

        // Track boundary collision
        this.constrainToTrack();

        // Update track progress
        this.updateTrackProgress();

        this.totalDistance += Math.abs(this.speed) * dt;
    }

    updateGear() {
        const speedKmh = Math.abs(this.speed) * 3.6;
        const gearSpeeds = [0, 40, 80, 130, 180, 230, 300];
        if (this.throttle > 0) {
            for (let g = 6; g >= 1; g--) {
                if (speedKmh >= gearSpeeds[g - 1]) {
                    this.gear = g;
                    break;
                }
            }
            if (speedKmh < 5) this.gear = 1;
        }
        if (this.throttle === 0 && this.brake === 0 && this.speed < 1) this.gear = 0;
    }

    constrainToTrack() {
        // Find closest point on track
        let minDist = Infinity;
        let closestT = this.trackT;
        const searchRange = 0.05;
        const steps = 50;

        for (let i = 0; i < steps; i++) {
            let t = this.trackT - searchRange + (2 * searchRange * i / steps);
            t = ((t % 1) + 1) % 1;
            const p = this.track.getPointAt(t);
            const d = this.position.distanceTo(p);
            if (d < minDist) {
                minDist = d;
                closestT = t;
            }
        }

        const maxDist = CONFIG.TRACK_WIDTH / 2 + 2;
        if (minDist > maxDist) {
            const trackPoint = this.track.getPointAt(closestT);
            const toTrack = trackPoint.clone().sub(this.position).normalize();
            const pushBack = minDist - maxDist;
            this.position.add(toTrack.multiplyScalar(pushBack * 0.5));
            this.speed *= 0.7;
        }
    }

    updateTrackProgress() {
        let minDist = Infinity;
        let bestT = this.trackT;
        const searchRange = 0.02;
        const steps = 30;

        for (let i = 0; i < steps; i++) {
            let t = this.trackT - searchRange / 2 + (searchRange * i / steps);
            t = ((t % 1) + 1) % 1;
            const p = this.track.getPointAt(t);
            const d = this.position.distanceTo(p);
            if (d < minDist) {
                minDist = d;
                bestT = t;
            }
        }

        const prevT = this.trackT;
        this.trackT = bestT;

        // Only count laps after car has moved a meaningful distance (Bug 5 fix)
        if (this.totalDistance < 10) return;

        // Lap detection (Bug 10 fix: require speed to prevent physics glitch false laps)
        if (prevT > 0.9 && this.trackT < 0.1 && this.speed > 1) {
            this.lap++;
        } else if (prevT < 0.1 && this.trackT > 0.9 && this.speed < -1) {
            this.lap = Math.max(0, this.lap - 1);
        }
    }

    getSpeedKmh() {
        return Math.abs(this.speed) * 3.6;
    }

    reset(t) {
        const point = this.track.getPointAt(t);
        const tangent = this.track.getTangentAt(t);
        this.position.copy(point);
        this.position.y = 0.3;
        this.rotation = Math.atan2(tangent.x, tangent.z) * -1 + Math.PI;
        this.speed = 0;
        this.gear = 0;
        this.engineRPM = 800;
        this.trackT = t;
        this.driftAngle = 0;
    }
}

// ============================================================
// AI DRIVER
// ============================================================
class AIDriver {
    constructor(physics, skill) {
        this.physics = physics;
        this.skill = skill; // 0.6 - 1.0
        this.lookAhead = 0.02 + Math.random() * 0.01;
        this.racingLine = 0.5 + (Math.random() - 0.5) * 0.3;
        this.aggressiveness = 0.5 + Math.random() * 0.5;
        this.mistakeTimer = 0;
        this.makingMistake = false;
    }

    update(dt, allCars) {
        const p = this.physics;
        const track = p.track;

        // Look ahead on track
        let lookT = (p.trackT + this.lookAhead) % 1;
        const target = track.getPointAt(lookT);
        const lookFar = (p.trackT + this.lookAhead * 3) % 1;
        const farTarget = track.getPointAt(lookFar);

        // Calculate angle to target
        const dx = target.x - p.position.x;
        const dz = target.z - p.position.z;
        const targetAngle = Math.atan2(dz, dx);
        let angleDiff = targetAngle - (p.rotation + Math.PI);

        // Normalize angle
        while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
        while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

        // Steering
        p.steer = THREE.MathUtils.clamp(angleDiff * 2.5 * this.skill, -1, 1);

        // Speed control based on upcoming curve
        const fdx = farTarget.x - target.x;
        const fdz = farTarget.z - target.z;
        const farAngle = Math.atan2(fdz, fdx);
        const curvature = Math.abs(farAngle - targetAngle);
        const normalizedCurve = Math.min(curvature / Math.PI, 1);

        const targetSpeed = p.stats.maxSpeed * (1 - normalizedCurve * 0.7) * this.skill;
        const currentSpeedKmh = p.getSpeedKmh();

        // Random mistakes
        this.mistakeTimer -= dt;
        if (this.mistakeTimer <= 0) {
            this.makingMistake = Math.random() > this.skill;
            this.mistakeTimer = 2 + Math.random() * 5;
        }

        if (this.makingMistake) {
            p.throttle = 0.5;
            p.brake = 0;
        } else if (currentSpeedKmh < targetSpeed * 0.95) {
            p.throttle = 0.8 + this.aggressiveness * 0.2;
            p.brake = 0;
        } else if (currentSpeedKmh > targetSpeed * 1.05) {
            p.throttle = 0;
            p.brake = 0.5 + normalizedCurve * 0.5;
        } else {
            p.throttle = 0.4;
            p.brake = 0;
        }

        // Avoid other cars
        for (const other of allCars) {
            if (other === p) continue;
            const dist = p.position.distanceTo(other.position);
            if (dist < 5) {
                const toCar = other.position.clone().sub(p.position);
                const angle = Math.atan2(toCar.z, toCar.x);
                let avoidAngle = angle - p.rotation;
                while (avoidAngle > Math.PI) avoidAngle -= 2 * Math.PI;
                while (avoidAngle < -Math.PI) avoidAngle += 2 * Math.PI;

                if (Math.abs(avoidAngle) < 0.5) {
                    p.steer -= Math.sign(avoidAngle) * 0.3;
                    if (dist < 3) p.brake = 0.3;
                }
            }
        }

        p.handbrake = false;
    }
}

// ============================================================
// AUDIO ENGINE - Web Audio API sound synthesis
// ============================================================
class AudioEngine {
    constructor() {
        this.ctx = null;
        this.masterGain = null;
        this.engineOsc = null;
        this.engineGain = null;
        this.initialized = false;
    }

    init() {
        try {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            this.masterGain = this.ctx.createGain();
            this.masterGain.gain.value = 0.3;
            this.masterGain.connect(this.ctx.destination);

            // Engine sound (multi-oscillator)
            this.engineOsc1 = this.ctx.createOscillator();
            this.engineOsc2 = this.ctx.createOscillator();
            this.engineOsc3 = this.ctx.createOscillator();
            this.engineGain = this.ctx.createGain();
            this.engineGain.gain.value = 0.15;

            this.engineOsc1.type = 'sawtooth';
            this.engineOsc2.type = 'square';
            this.engineOsc3.type = 'triangle';

            const filter = this.ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = 800;

            this.engineOsc1.connect(this.engineGain);
            this.engineOsc2.connect(this.engineGain);
            this.engineOsc3.connect(this.engineGain);
            this.engineGain.connect(filter);
            filter.connect(this.masterGain);

            this.engineOsc1.frequency.value = 80;
            this.engineOsc2.frequency.value = 160;
            this.engineOsc3.frequency.value = 40;
            this.engineOsc2.detune.value = -5;

            this.engineOsc1.start();
            this.engineOsc2.start();
            this.engineOsc3.start();

            // Wind noise
            const bufferSize = Math.ceil(this.ctx.sampleRate * 0.5);
            const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
            const data = noiseBuffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                data[i] = Math.random() * 2 - 1;
            }
            this.windNoise = this.ctx.createBufferSource();
            this.windNoise.buffer = noiseBuffer;
            this.windNoise.loop = true;
            this.windGain = this.ctx.createGain();
            this.windGain.gain.value = 0;
            const windFilter = this.ctx.createBiquadFilter();
            windFilter.type = 'bandpass';
            windFilter.frequency.value = 400;
            windFilter.Q.value = 0.5;
            this.windNoise.connect(windFilter);
            windFilter.connect(this.windGain);
            this.windGain.connect(this.masterGain);
            this.windNoise.start();

            this.initialized = true;
        } catch (e) {
            console.warn('Audio not available:', e);
        }
    }

    update(rpm, speedKmh, isDrifting) {
        if (!this.initialized) return;

        const freq = 30 + (rpm / 9000) * 250;
        this.engineOsc1.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.05);
        this.engineOsc2.frequency.setTargetAtTime(freq * 2, this.ctx.currentTime, 0.05);
        this.engineOsc3.frequency.setTargetAtTime(freq * 0.5, this.ctx.currentTime, 0.05);

        const vol = 0.08 + (rpm / 9000) * 0.2;
        this.engineGain.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.05);

        // Wind
        const windVol = Math.min(speedKmh / 300, 1) * 0.08;
        this.windGain.gain.setTargetAtTime(windVol, this.ctx.currentTime, 0.1);
    }

    playCountdown() {
        if (!this.initialized) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.frequency.value = 600;
        osc.type = 'sine';
        gain.gain.value = 0.2;
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start();
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.3);
        osc.stop(this.ctx.currentTime + 0.3);
    }

    playGo() {
        if (!this.initialized) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.frequency.value = 1200;
        osc.type = 'sine';
        gain.gain.value = 0.3;
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start();
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.5);
        osc.stop(this.ctx.currentTime + 0.5);
    }

    resume() {
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }
}

// ============================================================
// HUD RENDERER
// ============================================================
class HUDRenderer {
    constructor() {
        this.minimapCtx = document.getElementById('minimap-canvas').getContext('2d');
        this.tachoCtx = document.getElementById('tacho-canvas').getContext('2d');
    }

    update(playerPhysics, allPhysics, raceTime, lapTime, bestLap, trackCurve) {
        this.updateText(playerPhysics, allPhysics, raceTime, lapTime, bestLap);
        this.drawMinimap(playerPhysics, allPhysics, trackCurve);
        this.drawTachometer(playerPhysics);
    }

    updateText(player, allPhysics, raceTime, lapTime, bestLap) {
        // Speed
        document.getElementById('hud-speed').textContent = Math.round(player.getSpeedKmh());

        // Gear
        const gearText = player.gear === 0 ? 'N' : player.gear.toString();
        document.getElementById('speed-gear').textContent = gearText;

        // Position
        const positions = this.calculatePositions(allPhysics);
        const playerPos = positions.indexOf(allPhysics[0]) + 1;
        document.getElementById('hud-pos').textContent = playerPos;
        document.getElementById('hud-pos-suffix').textContent = this.getOrdinal(playerPos);

        // Lap
        const displayLap = Math.min(player.lap + 1, CONFIG.TOTAL_LAPS);
        document.getElementById('hud-lap').textContent = displayLap;
        document.getElementById('hud-lap-time').textContent = this.formatTime(lapTime);

        // Timer
        document.getElementById('hud-total-time').textContent = this.formatTime(raceTime);
        document.getElementById('hud-best-time').textContent = bestLap > 0 ? this.formatTime(bestLap) : '--:--.---';
    }

    calculatePositions(allPhysics) {
        return [...allPhysics].sort((a, b) => {
            if (a.lap !== b.lap) return b.lap - a.lap;
            return b.trackT - a.trackT;
        });
    }

    getOrdinal(n) {
        const s = ['th', 'st', 'nd', 'rd'];
        const v = n % 100;
        return s[(v - 20) % 10] || s[v] || s[0];
    }

    formatTime(ms) {
        const totalSec = ms / 1000;
        const min = Math.floor(totalSec / 60);
        const sec = Math.floor(totalSec % 60);
        const milli = Math.floor(ms % 1000);
        return `${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}.${milli.toString().padStart(3, '0')}`;
    }

    drawMinimap(player, allPhysics, track) {
        const ctx = this.minimapCtx;
        const w = 160, h = 160;
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(0, 0, w, h);

        // Draw track
        ctx.strokeStyle = '#555';
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let i = 0; i <= 200; i++) {
            const t = i / 200;
            const p = track.getPointAt(t);
            const mx = (p.x + 50) / 350 * w;
            const my = (p.z) / 450 * h;
            if (i === 0) ctx.moveTo(mx, my);
            else ctx.lineTo(mx, my);
        }
        ctx.closePath();
        ctx.stroke();

        // Draw cars
        for (let i = 0; i < allPhysics.length; i++) {
            const car = allPhysics[i];
            const mx = (car.position.x + 50) / 350 * w;
            const my = (car.position.z) / 450 * h;
            ctx.fillStyle = i === 0 ? '#ff3333' : '#33ff33';
            ctx.beginPath();
            ctx.arc(mx, my, i === 0 ? 4 : 3, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    drawTachometer(player) {
        const ctx = this.tachoCtx;
        const w = 220, h = 220;
        const cx = w / 2, cy = h / 2;
        const r = 90;

        ctx.clearRect(0, 0, w, h);

        // Background arc
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0.75 * Math.PI, 0.25 * Math.PI);
        ctx.lineWidth = 15;
        ctx.strokeStyle = 'rgba(50,50,50,0.7)';
        ctx.stroke();

        // RPM arc
        const rpmFrac = player.engineRPM / 9000;
        const startAngle = 0.75 * Math.PI;
        const endAngle = startAngle + rpmFrac * 1.5 * Math.PI;

        const gradient = ctx.createLinearGradient(0, 0, w, 0);
        gradient.addColorStop(0, '#33ff33');
        gradient.addColorStop(0.6, '#ffff33');
        gradient.addColorStop(0.85, '#ff3333');
        gradient.addColorStop(1, '#ff0000');

        ctx.beginPath();
        ctx.arc(cx, cy, r, startAngle, endAngle);
        ctx.lineWidth = 15;
        ctx.strokeStyle = gradient;
        ctx.stroke();

        // Tick marks
        for (let i = 0; i <= 9; i++) {
            const angle = startAngle + (i / 9) * 1.5 * Math.PI;
            const innerR = r - 12;
            const outerR = r + 5;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(angle) * innerR, cy + Math.sin(angle) * innerR);
            ctx.lineTo(cx + Math.cos(angle) * outerR, cy + Math.sin(angle) * outerR);
            ctx.lineWidth = i >= 7 ? 3 : 1.5;
            ctx.strokeStyle = i >= 7 ? '#ff3333' : '#888';
            ctx.stroke();

            // Number labels
            ctx.fillStyle = i >= 7 ? '#ff3333' : '#888';
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(i.toString(), cx + Math.cos(angle) * (r - 25), cy + Math.sin(angle) * (r - 25) + 3);
        }

        // RPM text
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 24px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(Math.round(player.engineRPM), cx, cy + 10);
        ctx.fillStyle = '#888';
        ctx.font = '10px sans-serif';
        ctx.fillText('RPM x1000', cx, cy + 25);
    }
}

// ============================================================
// MAIN GAME
// ============================================================
class Game {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.composer = null;
        this.clock = new THREE.Clock();
        this.trackCurve = null;

        this.playerCar = null;
        this.playerPhysics = null;
        this.aiCars = [];
        this.aiDrivers = [];
        this.aiPhysics = [];
        this.allPhysics = [];

        this.input = { forward: false, backward: false, left: false, right: false, handbrake: false };
        this.cameraMode = 0;
        this.cameraSmoothPos = new THREE.Vector3();
        this.cameraSmoothTarget = new THREE.Vector3();

        this.gameState = 'loading'; // loading, menu, countdown, racing, finished
        this.selectedCar = 0;
        this.raceStartTime = 0;
        this.lapStartTime = 0;
        this.bestLapTime = 0;
        this.countdownValue = 0;

        this.audio = new AudioEngine();
        this.hud = null;

        this.tireTracks = [];
        this.particleSystems = [];

        this.init();
    }

    async init() {
        this.updateLoading(10, 'Creating renderer...');

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.2;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        document.body.appendChild(this.renderer.domElement);

        // Scene
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x88aacc, 0.0015);

        // Sky
        const skyTex = TextureGen.sky();
        this.scene.background = skyTex;
        this.scene.environment = skyTex;

        this.updateLoading(20, 'Setting up camera...');

        // Camera
        this.camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.5, 2000);
        this.camera.position.set(0, 10, -20);

        this.updateLoading(30, 'Building track...');

        // Track
        const trackBuilder = new TrackBuilder(this.scene);
        this.trackCurve = trackBuilder.build();

        this.updateLoading(60, 'Setting up lighting...');
        this.setupLighting();

        this.updateLoading(70, 'Creating vehicles...');
        this.createCars();

        this.updateLoading(80, 'Post-processing...');
        this.setupPostProcessing();

        this.updateLoading(90, 'Initializing systems...');
        this.setupInput();
        this.setupUI();
        this.hud = new HUDRenderer();

        this.updateLoading(100, 'Ready!');

        setTimeout(() => {
            document.getElementById('loading-screen').classList.add('hidden');
            document.getElementById('main-menu').classList.add('visible');
            this.gameState = 'menu';
        }, 500);

        this.animate();
    }

    updateLoading(percent, text) {
        document.getElementById('loading-bar').style.width = percent + '%';
        document.getElementById('loading-text').textContent = text.toUpperCase();
    }

    setupLighting() {
        // Ambient
        const ambient = new THREE.AmbientLight(0x4466aa, 0.6);
        this.scene.add(ambient);

        // Hemisphere
        const hemi = new THREE.HemisphereLight(0x88bbff, 0x445522, 0.5);
        this.scene.add(hemi);

        // Sun (directional)
        const sun = new THREE.DirectionalLight(0xffeedd, 1.8);
        sun.position.set(100, 80, 50);
        sun.castShadow = true;
        sun.shadow.mapSize.width = 4096;
        sun.shadow.mapSize.height = 4096;
        sun.shadow.camera.left = -150;
        sun.shadow.camera.right = 150;
        sun.shadow.camera.top = 150;
        sun.shadow.camera.bottom = -150;
        sun.shadow.camera.near = 1;
        sun.shadow.camera.far = 400;
        sun.shadow.bias = -0.001;
        sun.shadow.normalBias = 0.02;
        this.scene.add(sun);
        this.sun = sun;

        // Fill light
        const fill = new THREE.DirectionalLight(0x8899bb, 0.4);
        fill.position.set(-60, 40, -30);
        this.scene.add(fill);
    }

    createCars() {
        // Player car
        const playerStats = CONFIG.CAR_STATS[this.selectedCar];
        this.playerCar = CarBuilder.build(playerStats.color, true);
        this.scene.add(this.playerCar);
        this.playerPhysics = new CarPhysics(playerStats, this.trackCurve);
        this.allPhysics = [this.playerPhysics];

        // AI cars
        this.aiCars = [];
        this.aiDrivers = [];
        this.aiPhysics = [];

        for (let i = 0; i < CONFIG.NUM_AI; i++) {
            const aiStats = { ...CONFIG.CAR_STATS[i % CONFIG.CAR_STATS.length] };
            aiStats.color = CONFIG.AI_COLORS[i];
            // Vary AI stats slightly
            aiStats.maxSpeed *= 0.85 + Math.random() * 0.25;
            aiStats.acceleration *= 0.85 + Math.random() * 0.2;
            aiStats.handling *= 0.9 + Math.random() * 0.15;

            const car = CarBuilder.build(aiStats.color);
            this.scene.add(car);
            this.aiCars.push(car);

            const physics = new CarPhysics(aiStats, this.trackCurve);
            this.aiPhysics.push(physics);
            this.allPhysics.push(physics);

            const skill = 0.65 + Math.random() * 0.3;
            const driver = new AIDriver(physics, skill);
            this.aiDrivers.push(driver);
        }
    }

    setupPostProcessing() {
        this.composer = new EffectComposer(this.renderer);
        const renderPass = new RenderPass(this.scene, this.camera);
        this.composer.addPass(renderPass);

        const bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            0.3, 0.4, 0.85
        );
        this.composer.addPass(bloomPass);

        const smaaPass = new SMAAPass(window.innerWidth, window.innerHeight);
        this.composer.addPass(smaaPass);
    }

    setupInput() {
        document.addEventListener('keydown', (e) => {
            this.audio.resume();
            switch (e.code) {
                case 'KeyW': case 'ArrowUp': this.input.forward = true; break;
                case 'KeyS': case 'ArrowDown': this.input.backward = true; break;
                case 'KeyA': case 'ArrowLeft': this.input.left = true; break;
                case 'KeyD': case 'ArrowRight': this.input.right = true; break;
                case 'Space': this.input.handbrake = true; e.preventDefault(); break;
                case 'KeyC': this.cycleCamera(); break;
                case 'KeyR': this.resetPlayerCar(); break;
                case 'Escape': this.togglePause(); break;
            }
        });
        document.addEventListener('keyup', (e) => {
            switch (e.code) {
                case 'KeyW': case 'ArrowUp': this.input.forward = false; break;
                case 'KeyS': case 'ArrowDown': this.input.backward = false; break;
                case 'KeyA': case 'ArrowLeft': this.input.left = false; break;
                case 'KeyD': case 'ArrowRight': this.input.right = false; break;
                case 'Space': this.input.handbrake = false; break;
            }
        });

        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
            this.composer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    setupUI() {
        // Car selection
        document.querySelectorAll('.car-option').forEach(el => {
            el.addEventListener('click', () => {
                document.querySelectorAll('.car-option').forEach(e => e.classList.remove('selected'));
                el.classList.add('selected');
                this.selectedCar = parseInt(el.dataset.car);
            });
        });

        // Buttons
        document.getElementById('btn-race').addEventListener('click', () => this.startRace());
        document.getElementById('btn-practice').addEventListener('click', () => this.startPractice());
        document.getElementById('btn-restart').addEventListener('click', () => this.startRace());
        document.getElementById('btn-menu').addEventListener('click', () => this.showMenu());
    }

    startRace() {
        if (!this.audio.initialized) this.audio.init();
        this.audio.resume();

        document.getElementById('main-menu').classList.remove('visible');
        document.getElementById('race-results').classList.remove('visible');

        // Reset cars
        this.resetCars();

        // Countdown
        this.gameState = 'countdown';
        this.countdownValue = 3;
        const countdownEl = document.getElementById('countdown');
        countdownEl.classList.add('visible');
        countdownEl.classList.remove('go');

        const doCountdown = () => {
            if (this.countdownValue > 0) {
                countdownEl.textContent = this.countdownValue;
                this.audio.playCountdown();
                this.countdownValue--;
                setTimeout(doCountdown, 1000);
            } else {
                countdownEl.textContent = 'GO!';
                countdownEl.classList.add('go');
                this.audio.playGo();
                this.gameState = 'racing';
                this.raceStartTime = performance.now();
                this.lapStartTime = performance.now();
                document.getElementById('hud').classList.add('visible');
                setTimeout(() => {
                    countdownEl.classList.remove('visible');
                }, 800);
            }
        };
        setTimeout(doCountdown, 500);
    }

    startPractice() {
        if (!this.audio.initialized) this.audio.init();
        this.audio.resume();

        document.getElementById('main-menu').classList.remove('visible');
        this.resetCars();
        this.gameState = 'racing';
        this.raceStartTime = performance.now();
        this.lapStartTime = performance.now();
        document.getElementById('hud').classList.add('visible');
    }

    resetCars() {
        // Remove old cars and rebuild with selected type (Bug 7 fix: dispose GPU resources)
        disposeObject(this.playerCar);
        this.scene.remove(this.playerCar);
        for (const car of this.aiCars) {
            disposeObject(car);
            this.scene.remove(car);
        }

        this.createCars();

        // Position all cars on grid
        const gridSpacing = 0.008; // Spacing along track
        const stagger = 0.003;

        this.playerPhysics.reset(0.98);
        for (let i = 0; i < this.aiPhysics.length; i++) {
            const row = Math.floor(i / 2);
            const col = i % 2;
            let t = 0.98 - (row + 1) * gridSpacing - col * stagger;
            t = ((t % 1) + 1) % 1;
            this.aiPhysics[i].reset(t);

            const tangent = this.trackCurve.getTangentAt(t);
            const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
            const offset = col === 0 ? -2.5 : 2.5;
            this.aiPhysics[i].position.add(normal.multiplyScalar(offset));
        }

        this.bestLapTime = 0;
    }

    resetPlayerCar() {
        if (this.gameState !== 'racing') return;
        this.playerPhysics.reset(this.playerPhysics.trackT);
    }

    cycleCamera() {
        this.cameraMode = (this.cameraMode + 1) % CONFIG.CAMERA_MODES.length;
    }

    togglePause() {
        if (this.gameState === 'racing') {
            this.gameState = 'paused';
            document.getElementById('main-menu').classList.add('visible');
        } else if (this.gameState === 'paused') {
            this.gameState = 'racing';
            document.getElementById('main-menu').classList.remove('visible');
        }
    }

    showMenu() {
        this.gameState = 'menu';
        document.getElementById('hud').classList.remove('visible');
        document.getElementById('race-results').classList.remove('visible');
        document.getElementById('main-menu').classList.add('visible');
    }

    showResults() {
        this.gameState = 'finished';
        document.getElementById('hud').classList.remove('visible');

        const positions = [...this.allPhysics].sort((a, b) => {
            if (a.lap !== b.lap) return b.lap - a.lap;
            return b.trackT - a.trackT;
        });

        const resultsTable = document.getElementById('results-table');
        resultsTable.innerHTML = '';

        const names = ['You', 'AI Racer 1', 'AI Racer 2', 'AI Racer 3', 'AI Racer 4', 'AI Racer 5'];

        positions.forEach((p, i) => {
            const idx = this.allPhysics.indexOf(p);
            const row = document.createElement('div');
            row.className = idx === 0 ? 'winner' : '';
            row.innerHTML = `<span>${i + 1}${this.hud.getOrdinal(i + 1)}</span><span>${names[idx]}</span>`;
            resultsTable.appendChild(row);
        });

        const playerPos = positions.indexOf(this.playerPhysics) + 1;
        document.getElementById('results-title').textContent =
            playerPos === 1 ? 'Victory!' : `Race Complete - ${playerPos}${this.hud.getOrdinal(playerPos)} Place`;

        document.getElementById('race-results').classList.add('visible');
    }

    updatePhysics(dt) {
        // Player input
        this.playerPhysics.throttle = this.input.forward ? 1 : 0;
        this.playerPhysics.brake = this.input.backward ? 1 : 0;
        this.playerPhysics.steer = (this.input.left ? 1 : 0) - (this.input.right ? 1 : 0);
        this.playerPhysics.handbrake = this.input.handbrake;

        // Track player lap
        const prevLap = this.playerPhysics.lap;
        this.playerPhysics.update(dt);

        if (this.playerPhysics.lap > prevLap) {
            const lapTime = performance.now() - this.lapStartTime;
            if (this.bestLapTime === 0 || lapTime < this.bestLapTime) {
                this.bestLapTime = lapTime;
            }
            this.lapStartTime = performance.now();

            if (this.playerPhysics.lap >= CONFIG.TOTAL_LAPS) {
                this.playerPhysics.finished = true;
                this.showResults();
            }
        }

        // AI
        for (let i = 0; i < this.aiDrivers.length; i++) {
            this.aiDrivers[i].update(dt, this.allPhysics.map(p => p));
            this.aiPhysics[i].update(dt);
        }
    }

    updateCarMesh(car, physics) {
        car.position.set(physics.position.x, physics.position.y ?? 0.3, physics.position.z);
        car.rotation.y = physics.rotation + Math.PI;

        // Wheel rotation
        const wheelSpeed = physics.speed * 5;
        car.children.forEach(child => {
            if (child.userData.isWheel) {
                child.children[0].rotation.z += wheelSpeed * 0.016; // Tire rotation
                if (child.userData.isFrontWheel) {
                    child.rotation.z = physics.wheelAngle * 0.5;
                }
            }
        });

        // Subtle body roll
        car.rotation.z = physics.steer * physics.speed * 0.0002;
        car.rotation.x = -physics.throttle * 0.01 + physics.brake * 0.015;
    }

    updateCamera(dt) {
        const p = this.playerPhysics;
        const carPos = p.position.clone();
        carPos.y = 0.5;

        const dir = new THREE.Vector3(
            Math.cos(p.rotation + p.driftAngle),
            0,
            Math.sin(p.rotation + p.driftAngle)
        );

        let targetPos, lookAtPos;

        switch (CONFIG.CAMERA_MODES[this.cameraMode]) {
            case 'chase':
                targetPos = carPos.clone()
                    .add(dir.clone().multiplyScalar(8))
                    .add(new THREE.Vector3(0, 4, 0));
                lookAtPos = carPos.clone().add(dir.clone().multiplyScalar(-10));
                break;
            case 'hood':
                targetPos = carPos.clone()
                    .add(dir.clone().multiplyScalar(-1.5))
                    .add(new THREE.Vector3(0, 1.5, 0));
                lookAtPos = carPos.clone().add(dir.clone().multiplyScalar(-20));
                break;
            case 'far':
                targetPos = carPos.clone()
                    .add(dir.clone().multiplyScalar(15))
                    .add(new THREE.Vector3(0, 8, 0));
                lookAtPos = carPos.clone().add(dir.clone().multiplyScalar(-15));
                break;
            case 'top':
                targetPos = carPos.clone().add(new THREE.Vector3(0, 30, 0.1));
                lookAtPos = carPos.clone();
                break;
        }

        // Smooth camera
        const smoothFactor = 1 - Math.pow(0.01, dt);
        this.cameraSmoothPos.lerp(targetPos, smoothFactor);
        this.cameraSmoothTarget.lerp(lookAtPos, smoothFactor);

        this.camera.position.copy(this.cameraSmoothPos);
        this.camera.lookAt(this.cameraSmoothTarget);

        // Speed-based FOV
        const speedFov = 65 + (p.getSpeedKmh() / p.stats.maxSpeed) * 15;
        this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, speedFov, dt * 3);
        this.camera.updateProjectionMatrix();

        // Move shadow camera with player
        if (this.sun) {
            this.sun.target.position.copy(carPos);
            this.sun.position.set(carPos.x + 100, 80, carPos.z + 50);
            this.sun.target.updateMatrixWorld();
        }
    }

    createTireSmoke(physics) {
        if (!physics.isDrifting && !physics.handbrake) return;
        if (Math.random() > 0.3) return;

        const mat = new THREE.MeshBasicMaterial({
            color: 0xcccccc,
            transparent: true,
            opacity: 0.4,
        });
        const smoke = new THREE.Mesh(SMOKE_GEOMETRY, mat);
        smoke.position.copy(physics.position);
        smoke.position.y = 0.2;
        smoke.userData.life = 1.0;
        smoke.userData.vel = new THREE.Vector3(
            (Math.random() - 0.5) * 2,
            1 + Math.random(),
            (Math.random() - 0.5) * 2
        );
        this.scene.add(smoke);
        this.particleSystems.push(smoke);
    }

    updateParticles(dt) {
        for (let i = this.particleSystems.length - 1; i >= 0; i--) {
            const p = this.particleSystems[i];
            p.userData.life -= dt * 1.5;
            p.position.add(p.userData.vel.clone().multiplyScalar(dt));
            p.scale.multiplyScalar(1 + dt * 2);
            if (p.scale.x > 3) p.scale.setScalar(3);
            p.material.opacity = p.userData.life * 0.3;

            if (p.userData.life <= 0) {
                this.scene.remove(p);
                p.material.dispose();
                this.particleSystems.splice(i, 1);
            }
        }
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        const dt = Math.min(this.clock.getDelta(), 0.05);

        if (this.gameState === 'racing') {
            this.updatePhysics(dt);

            // Update car meshes
            this.updateCarMesh(this.playerCar, this.playerPhysics);
            for (let i = 0; i < this.aiCars.length; i++) {
                this.updateCarMesh(this.aiCars[i], this.aiPhysics[i]);
            }

            this.updateCamera(dt);

            // Particles
            this.createTireSmoke(this.playerPhysics);
            this.updateParticles(dt);

            // Audio
            this.audio.update(
                this.playerPhysics.engineRPM,
                this.playerPhysics.getSpeedKmh(),
                this.playerPhysics.isDrifting
            );

            // HUD
            const raceTime = performance.now() - this.raceStartTime;
            const lapTime = performance.now() - this.lapStartTime;
            this.hud.update(
                this.playerPhysics,
                this.allPhysics,
                raceTime,
                lapTime,
                this.bestLapTime,
                this.trackCurve
            );
        } else if (this.gameState === 'menu' || this.gameState === 'countdown') {
            // Slow orbit camera for menu
            const time = performance.now() * 0.0001;
            const center = this.trackCurve ? this.trackCurve.getPointAt(0) : new THREE.Vector3();
            this.camera.position.set(
                center.x + Math.cos(time) * 60,
                25,
                center.z + Math.sin(time) * 60
            );
            this.camera.lookAt(center);
            this.updateParticles(dt);
        } else if (this.gameState === 'finished') {
            this.updateParticles(dt);
        }

        this.composer.render();
    }
}

// Start the game
const game = new Game();
