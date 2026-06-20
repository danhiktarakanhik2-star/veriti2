import json
import math
from pathlib import Path

SRC = Path(r"c:\Users\thien\Downloads\VERITY TALKING\pntmc_verityball.geo.json")
OUT = Path(
    r"c:\Users\thien\AppData\Roaming\Minecraft Bedrock\Users\Shared\games\com.mojang\development_resource_packs\ThatMob's Verity by PnTMC [RP]\models\entity\pntmc_verityball.geo.json"
)

CENTER = (0.0, 8.0, 0.0)
RING_CUTS = 2
EXPAND_RINGS = 4
UV_BOUNDS = (0.12, 0.14, 0.84, 0.86)  # u0, v0, u1, v1


def lerp(a, b, t):
    return [a[i] + (b[i] - a[i]) * t for i in range(len(a))]


def parse_quads(polys):
    quads = []
    for entry in polys:
        if isinstance(entry, dict):
            for v in entry.values():
                quads.append(v)
        else:
            quads.append(entry)
    return quads


def quad_center(positions, pis):
    pts = [positions[pi] for pi in pis]
    return [sum(c) / 4 for c in zip(*pts)]


def is_seed_quad(positions, pis):
    if not all(positions[pi][2] > 0 for pi in pis):
        return False
    cx, cy, cz = quad_center(positions, pis)
    return cz > 0.82 and 13.6 < cy < 15.15 and abs(cx) < 1.1


def build_quad_neighbors(quads):
    edge_to_quads = {}
    for qi, quad in enumerate(quads):
        pis = [quad[i][0] for i in range(4)]
        for i in range(4):
            a, b = pis[i], pis[(i + 1) % 4]
            key = (min(a, b), max(a, b))
            edge_to_quads.setdefault(key, []).append(qi)

    neighbors = [set() for _ in quads]
    for qlist in edge_to_quads.values():
        if len(qlist) != 2:
            continue
        a, b = qlist
        neighbors[a].add(b)
        neighbors[b].add(a)
    return neighbors


def expand_quad_selection(quads, positions, rings):
    neighbors = build_quad_neighbors(quads)
    seeds = {
        i
        for i, q in enumerate(quads)
        if is_seed_quad(positions, [q[j][0] for j in range(4)])
    }
    if not seeds:
        raise RuntimeError("no seed quads found")

    selected = set(seeds)
    frontier = set(seeds)
    for _ in range(rings):
        nxt = set()
        for qi in frontier:
            for nb in neighbors[qi]:
                if nb in selected:
                    continue
                pis = [quads[nb][j][0] for j in range(4)]
                if not all(positions[pi][2] > 0 for pi in pis):
                    continue
                selected.add(nb)
                nxt.add(nb)
        frontier = nxt
    return selected


def mesh_radius(positions):
    total = 0.0
    for p in positions:
        x, y, z = p[0] - CENTER[0], p[1] - CENTER[1], p[2] - CENTER[2]
        total += math.sqrt(x * x + y * y + z * z)
    return total / len(positions)


def project_to_sphere(p, radius):
    x, y, z = p[0] - CENTER[0], p[1] - CENTER[1], p[2] - CENTER[2]
    ln = math.sqrt(x * x + y * y + z * z) or 1.0
    s = radius / ln
    return [CENTER[0] + x * s, CENTER[1] + y * s, CENTER[2] + z * s]


def unit_dir(p):
    x, y, z = p[0] - CENTER[0], p[1] - CENTER[1], p[2] - CENTER[2]
    ln = math.sqrt(x * x + y * y + z * z) or 1.0
    return x / ln, y / ln, z / ln


def stereo_plane(p):
    x, y, z = unit_dir(p)
    if z < -0.02:
        return None
    denom = max(1.0 + z, 0.08)
    return x / denom, -y / denom


def subdivide_geometry(mesh):
    positions = [list(p) for p in mesh["positions"]]
    radius = mesh_radius(positions)
    old_quads = parse_quads(mesh["polys"])
    face_quads = expand_quad_selection(old_quads, positions, EXPAND_RINGS)
    fracs = [(i + 1) / (RING_CUTS + 1) for i in range(RING_CUTS)]
    edge_cache = {}
    new_quads = []

    def point_on_edge(pi_a, pi_b, t):
        key = (pi_a, pi_b, round(t, 6))
        if key in edge_cache:
            return edge_cache[key]
        pi = len(positions)
        positions.append(project_to_sphere(lerp(positions[pi_a], positions[pi_b], t), radius))
        edge_cache[key] = pi
        return pi

    for qi, quad in enumerate(old_quads):
        pis = [quad[i][0] for i in range(4)]
        if qi not in face_quads:
            new_quads.append(quad)
            continue

        tl, tr, br, bl = 0, 1, 2, 3
        rows = [[pis[tl], pis[tr]]]
        for t in fracs:
            pl = point_on_edge(pis[tl], pis[bl], t)
            pr = point_on_edge(pis[tr], pis[br], t)
            rows.append([pl, pr])
        rows.append([pis[bl], pis[br]])

        for r in range(len(rows) - 1):
            new_quads.append(
                [
                    [rows[r][0], rows[r][0], 0],
                    [rows[r][1], rows[r][1], 0],
                    [rows[r + 1][1], rows[r + 1][1], 0],
                    [rows[r + 1][0], rows[r + 1][0], 0],
                ]
            )

    return positions, new_quads, face_quads


def collect_face_vertices(quads, face_quad_ids):
    verts = set()
    for qi in face_quad_ids:
        for i in range(4):
            verts.add(quads[qi][i][0])
    return verts


def build_connected_face_uvs(positions, face_verts, original_uvs):
    u0, v0, u1, v1 = UV_BOUNDS
    planes = {}
    su_vals = []
    sv_vals = []

    for pi in face_verts:
        plane = stereo_plane(positions[pi])
        if plane is None:
            continue
        su, sv = plane
        planes[pi] = (su, sv)
        su_vals.append(su)
        sv_vals.append(sv)

    if not su_vals:
        raise RuntimeError("no face vertices for UV")

    su_min, su_max = min(su_vals), max(su_vals)
    sv_min, sv_max = min(sv_vals), max(sv_vals)
    su_span = su_max - su_min or 1.0
    sv_span = sv_max - sv_min or 1.0

    uvs = [None] * len(positions)
    for i in range(min(len(original_uvs), len(positions))):
        uvs[i] = list(original_uvs[i])

    for pi, (su, sv) in planes.items():
        u = u0 + ((su - su_min) / su_span) * (u1 - u0)
        v = v0 + ((sv - sv_min) / sv_span) * (v1 - v0)
        uvs[pi] = [max(0.04, min(0.96, u)), max(0.04, min(0.96, v))]

    for pi in range(len(positions)):
        if uvs[pi] is not None:
            continue
        if pi in face_verts:
            uvs[pi] = [0.48086, 0.5]
        elif pi < len(original_uvs):
            uvs[pi] = list(original_uvs[pi])
        else:
            uvs[pi] = [0.04, 0.04]

    return uvs


def process_mesh(mesh):
    original_uvs = mesh["uvs"]
    positions, quads, face_quad_ids = subdivide_geometry(mesh)
    face_verts = collect_face_vertices(quads, face_quad_ids)
    uvs = build_connected_face_uvs(positions, face_verts, original_uvs)
    return {
        "normalized_uvs": mesh.get("normalized_uvs", True),
        "positions": positions,
        "uvs": uvs,
        "polys": quads,
    }, len(face_quad_ids), len(face_verts)


def main():
    with SRC.open(encoding="utf-8") as f:
        data = json.load(f)

    mesh = data["minecraft:geometry"][0]["bones"][1]["poly_mesh"]
    new_mesh, face_quads, face_verts = process_mesh(mesh)

    data["minecraft:geometry"][0]["bones"][1]["poly_mesh"] = new_mesh
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"))

    print(f"face quads: {face_quads}")
    print(f"face verts: {face_verts}")
    print(f"positions: {len(new_mesh['positions'])}")
    print(f"uvs: {len(new_mesh['uvs'])} (1:1 connected)")
    print("written", OUT)


if __name__ == "__main__":
    main()
