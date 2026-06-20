"""
Spherize a Bedrock poly_mesh geo — smooth lumps then project onto a sphere.

Example:
  python _spherize_verity_geo.py ^
    --in "c:\\Users\\thien\\Downloads\\Verity RP\\models\\entity\\verity.geo.json" ^
    --out "c:\\Users\\thien\\Downloads\\Verity RP\\models\\entity\\verity_round.geo.json" ^
    --smooth 4 --strength 1.0 --game-ball
"""

import argparse
import json
import math
from pathlib import Path


def dist(a, b):
    return math.sqrt(sum((a[i] - b[i]) ** 2 for i in range(3)))


def lerp(a, b, t):
    return [a[i] + (b[i] - a[i]) * t for i in range(3)]


def centroid(positions):
    n = len(positions)
    return [sum(p[i] for p in positions) / n for i in range(3)]


def parse_quads(polys):
    quads = []
    for entry in polys:
        if isinstance(entry, dict):
            for v in entry.values():
                quads.append(v)
        else:
            quads.append(entry)
    return quads


def build_neighbors(num_verts, quads):
    neighbors = [set() for _ in range(num_verts)]
    for quad in quads:
        pis = [quad[i][0] for i in range(4)]
        for i in range(4):
            a, b = pis[i], pis[(i + 1) % 4]
            neighbors[a].add(b)
            neighbors[b].add(a)
    return neighbors


def face_normal(p0, p1, p2):
    ax, ay, az = p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]
    bx, by, bz = p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]
    nx = ay * bz - az * by
    ny = az * bx - ax * bz
    nz = ax * by - ay * bx
    length = math.sqrt(nx * nx + ny * ny + nz * nz)
    if length < 1e-8:
        return [0.0, 1.0, 0.0]
    return [nx / length, ny / length, nz / length]


def recompute_normals(positions, quads):
    accum = [[0.0, 0.0, 0.0] for _ in positions]
    for quad in quads:
        pis = [quad[i][0] for i in range(4)]
        n = face_normal(positions[pis[0]], positions[pis[1]], positions[pis[2]])
        for pi in pis:
            accum[pi][0] += n[0]
            accum[pi][1] += n[1]
            accum[pi][2] += n[2]

    normals = []
    for vec in accum:
        length = math.sqrt(vec[0] ** 2 + vec[1] ** 2 + vec[2] ** 2)
        if length < 1e-8:
            normals.append([0.0, 1.0, 0.0])
        else:
            normals.append([vec[0] / length, vec[1] / length, vec[2] / length])
    return normals


def laplacian_smooth(positions, neighbors, factor=0.5):
    out = []
    for i, p in enumerate(positions):
        nbs = neighbors[i]
        if not nbs:
            out.append(list(p))
            continue
        avg = [0.0, 0.0, 0.0]
        for j in nbs:
            avg[0] += positions[j][0]
            avg[1] += positions[j][1]
            avg[2] += positions[j][2]
        inv = 1.0 / len(nbs)
        avg = [avg[0] * inv, avg[1] * inv, avg[2] * inv]
        out.append(lerp(p, avg, factor))
    return out


def project_to_sphere(positions, center, radius, strength=1.0):
    out = []
    for p in positions:
        offset = [p[i] - center[i] for i in range(3)]
        d = math.sqrt(sum(v * v for v in offset))
        if d < 1e-8:
            out.append(list(center))
            continue
        target = [center[i] + offset[i] / d * radius for i in range(3)]
        out.append(lerp(p, target, strength))
    return out


def mean_radius(positions, center):
    return sum(dist(p, center) for p in positions) / len(positions)


def scale_to_game_ball(positions, center, target_center, target_radius):
    src_r = mean_radius(positions, center)
    if src_r < 1e-8:
        return positions
    scale = target_radius / src_r
    out = []
    for p in positions:
        out.append(
            [
                target_center[0] + (p[0] - center[0]) * scale,
                target_center[1] + (p[1] - center[1]) * scale,
                target_center[2] + (p[2] - center[2]) * scale,
            ]
        )
    return out


def spherize_geo(data, smooth_iters, strength, game_ball):
    geo = data["minecraft:geometry"][0]
    mesh = geo["bones"][0]["poly_mesh"]
    positions = [list(p) for p in mesh["positions"]]
    quads = parse_quads(mesh["polys"])
    neighbors = build_neighbors(len(positions), quads)

    center = centroid(positions)
    radius = mean_radius(positions, center)

    for _ in range(smooth_iters):
        positions = laplacian_smooth(positions, neighbors, 0.5)
        center = centroid(positions)
        radius = mean_radius(positions, center)

    positions = project_to_sphere(positions, center, radius, strength)

    if game_ball:
        positions = scale_to_game_ball(positions, center, [0.0, 8.0, 0.0], 8.0)
        geo["description"]["identifier"] = "geometry.pntmc_verityball"
        geo["description"]["texture_width"] = 1024
        geo["description"]["texture_height"] = 1024
        geo["description"]["visible_bounds_width"] = 2.5
        geo["description"]["visible_bounds_height"] = 2.5
        geo["description"]["visible_bounds_offset"] = [0, 0.5, 0]
        geo["bones"][0]["name"] = "ball"
        geo["bones"][0]["pivot"] = [0, 8, 0]
    else:
        geo["description"]["identifier"] = "geometry.verity_round"

    mesh["positions"] = [[round(v, 5) for v in p] for p in positions]
    mesh["normals"] = [
        [round(v, 5) for v in n] for n in recompute_normals(positions, quads)
    ]
    return data


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--in", dest="src", required=True)
    parser.add_argument("--out", dest="out", required=True)
    parser.add_argument("--smooth", type=int, default=3)
    parser.add_argument("--strength", type=float, default=1.0)
    parser.add_argument("--game-ball", action="store_true")
    args = parser.parse_args()

    src = Path(args.src)
    out = Path(args.out)
    data = json.loads(src.read_text(encoding="utf-8"))
    data = spherize_geo(data, args.smooth, args.strength, args.game_ball)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, indent=2), encoding="utf-8")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
