"""Procedural Timewarp mascots: Orbit, Nova and Cosmo.

Run with Blender 5.1+:
  blender -b --factory-startup --python mascots.py -- --name orbit [--preview]

Every motion is periodic over LOOP frames, so frame LOOP+1 equals frame 1 and
the rendered sequence loops seamlessly as an animated avatar.
"""
import bpy, bmesh, math, os, sys
from mathutils import Vector, Matrix

LOOP = 48
HERE = os.path.dirname(os.path.abspath(__file__))
TAU = math.tau


def args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    out = {'name': 'orbit', 'preview': False, 'size': 512, 'samples': 96, 'out': os.path.join(HERE, 'render')}
    i = 0
    while i < len(argv):
        key = argv[i].lstrip('-')
        if key == 'preview': out['preview'] = True
        else: out[key] = argv[i + 1]; i += 1
        i += 1
    out['size'] = int(out['size']); out['samples'] = int(out['samples'])
    return out


def hex_rgb(h, a=1.0):
    h = h.lstrip('#')
    srgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]
    return (*lin, a)


# ---------------------------------------------------------------- scene setup

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    s = bpy.context.scene
    s.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for kind in ('OPTIX', 'CUDA'):
        try:
            prefs.compute_device_type = kind; prefs.get_devices()
            for d in prefs.devices: d.use = d.type != 'CPU'
            s.cycles.device = 'GPU'; break
        except Exception:
            continue
    s.cycles.use_adaptive_sampling = True
    s.cycles.use_denoising = True
    s.cycles.caustics_reflective = s.cycles.caustics_refractive = False
    s.cycles.transparent_max_bounces = 24
    s.render.film_transparent = True
    s.cycles.film_transparent_glass = True
    s.view_settings.view_transform = 'Standard'
    s.view_settings.look = 'None'
    s.render.image_settings.file_format = 'PNG'
    s.render.image_settings.color_mode = 'RGBA'
    s.render.image_settings.color_depth = '8'
    s.render.image_settings.compression = 15
    s.frame_start, s.frame_end = 1, LOOP
    s.render.fps = 24
    world = bpy.data.worlds.new('Space'); s.world = world
    world.use_nodes = True
    nt = world.node_tree; bg = nt.nodes['Background']
    grad = nt.nodes.new('ShaderNodeTexGradient'); coord = nt.nodes.new('ShaderNodeTexCoord')
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ'); mapr = nt.nodes.new('ShaderNodeMapRange')
    nt.links.new(coord.outputs['Generated'], sep.inputs[0])
    nt.links.new(sep.outputs['Z'], mapr.inputs['Value'])
    mapr.inputs['From Min'].default_value = 0.3; mapr.inputs['From Max'].default_value = 0.8
    nt.links.new(mapr.outputs['Result'], ramp.inputs['Fac'])
    ramp.color_ramp.elements[0].color = hex_rgb('#120d2e'); ramp.color_ramp.elements[1].color = hex_rgb('#6d7fd8')
    nt.links.new(ramp.outputs['Color'], bg.inputs['Color']); bg.inputs['Strength'].default_value = 0.35
    return s


def camera(scale=2.9, z=0.0):
    cam = bpy.data.cameras.new('Camera'); cam.type = 'ORTHO'; cam.ortho_scale = scale
    obj = bpy.data.objects.new('Camera', cam); bpy.context.collection.objects.link(obj)
    obj.location = (0, -12, z); obj.rotation_euler = (math.radians(90), 0, 0)
    bpy.context.scene.camera = obj
    return obj


def area(name, loc, energy, color='#ffffff', size=3.0):
    light = bpy.data.lights.new(name, 'AREA'); light.energy = energy; light.size = size
    light.color = hex_rgb(color)[:3]
    obj = bpy.data.objects.new(name, light); bpy.context.collection.objects.link(obj)
    obj.location = loc
    direction = -Vector(loc); obj.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    return obj


def lights(rim_a, rim_b, key=900):
    area('Key', (-3.2, -5.5, 4.2), key, '#fff6ee', 4)
    area('Fill', (4.5, -5, 0.3), key * 0.28, '#dfe8ff', 5)
    area('RimA', (3.5, 4.5, 2.8), key * 0.9, rim_a, 3)
    area('RimB', (-3.8, 4, -1.5), key * 0.75, rim_b, 3)


# ---------------------------------------------------------------- objects

def link(obj, parent=None):
    bpy.context.collection.objects.link(obj)
    if parent is not None:
        bpy.context.view_layer.update()
        obj.parent = parent; obj.matrix_parent_inverse = parent.matrix_world.inverted()
    return obj


def empty(name, loc=(0, 0, 0), parent=None):
    obj = bpy.data.objects.new(name, None); obj.location = loc
    return link(obj, parent)


def mesh_obj(name, bm, mat, parent=None, smooth=True):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    if smooth:
        for p in me.polygons: p.use_smooth = True
    obj = bpy.data.objects.new(name, me)
    if mat: me.materials.append(mat)
    return obj


def sphere(name, mat, loc=(0, 0, 0), scale=(1, 1, 1), r=1.0, parent=None, seg=64):
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=seg // 2, radius=r)
    obj = mesh_obj(name, bm, mat); obj.location = loc; obj.scale = scale
    return link(obj, parent)


def torus(name, mat, major, minor, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), parent=None):
    bm = bmesh.new(); seg, ring = 128, 24
    verts = []
    for i in range(seg):
        a = TAU * i / seg
        row = []
        for j in range(ring):
            b = TAU * j / ring
            rr = major + minor * math.cos(b)
            row.append(bm.verts.new((rr * math.cos(a), rr * math.sin(a), minor * math.sin(b))))
        verts.append(row)
    for i in range(seg):
        for j in range(ring):
            bm.faces.new((verts[i][j], verts[(i + 1) % seg][j], verts[(i + 1) % seg][(j + 1) % ring], verts[i][(j + 1) % ring]))
    obj = mesh_obj(name, bm, mat); obj.location = loc; obj.rotation_euler = rot; obj.scale = scale
    return link(obj, parent)


def tube(name, mat, points, radius, parent=None):
    cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '3D'
    cu.bevel_depth = radius; cu.bevel_resolution = 6; cu.use_fill_caps = True
    sp = cu.splines.new('BEZIER'); sp.bezier_points.add(len(points) - 1)
    for bp, p in zip(sp.bezier_points, points):
        bp.co = p; bp.handle_left_type = bp.handle_right_type = 'AUTO'
    obj = bpy.data.objects.new(name, cu); cu.materials.append(mat)
    return link(obj, parent)


def flat(name, mat, outline, loc, scale=1.0, parent=None):
    """Camera-facing flat shape in the XZ plane (fan-filled from its centre)."""
    bm = bmesh.new(); c = bm.verts.new((0, 0, 0))
    ring = [bm.verts.new((x, 0, z)) for x, z in outline]
    for i in range(len(ring)):
        bm.faces.new((c, ring[(i + 1) % len(ring)], ring[i]))
    obj = mesh_obj(name, bm, mat, smooth=False); obj.location = loc; obj.scale = (scale, scale, scale)
    return link(obj, parent)


def circle_outline(n=48, r=1.0):
    return [(r * math.cos(TAU * i / n), r * math.sin(TAU * i / n)) for i in range(n)]


def star_outline(points=4, inner=0.22):
    out = []
    for i in range(points * 2):
        a = math.pi / 2 + math.pi * i / points
        r = 1.0 if i % 2 == 0 else inner
        out.append((r * math.cos(a), r * math.sin(a)))
    return out


def surface(obj, x, z, lift=0.0):
    """Front surface point of obj at world (x, z), via a ray cast towards +Y."""
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get(); ev = obj.evaluated_get(dg)
    inv = obj.matrix_world.inverted()
    origin = inv @ Vector((x, -20, z)); direction = (inv.to_3x3() @ Vector((0, 1, 0))).normalized()
    hit, loc, normal, _ = ev.ray_cast(origin, direction)
    if not hit: raise RuntimeError(f'No surface on {obj.name} at {x},{z}')
    world = obj.matrix_world @ loc
    n = (obj.matrix_world.to_3x3().inverted().transposed() @ normal).normalized()
    return world + n * lift, n


def face_to(obj, normal):
    """Orient obj so its local -Y faces along the given surface normal."""
    obj.rotation_euler = normal.to_track_quat('-Y', 'Z').to_euler()


# ---------------------------------------------------------------- materials

class M:
    def __init__(self, name):
        self.mat = bpy.data.materials.new(name); self.mat.use_nodes = True
        self.nt = self.mat.node_tree; self.n = self.nt.nodes; self.l = self.nt.links
        self.out = self.n['Material Output']; self.p = self.n.get('Principled BSDF')

    def node(self, kind, **inputs):
        nd = self.n.new(kind)
        for k, v in inputs.items():
            if isinstance(v, bpy.types.NodeSocket): self.l.new(v, nd.inputs[k])
            else: nd.inputs[k].default_value = v
        return nd

    def math(self, op, a, b=0.0, clamp=False):
        nd = self.n.new('ShaderNodeMath'); nd.operation = op; nd.use_clamp = clamp
        for i, v in enumerate((a, b)):
            if isinstance(v, bpy.types.NodeSocket): self.l.new(v, nd.inputs[i])
            else: nd.inputs[i].default_value = v
        return nd.outputs[0]

    def ramp(self, fac, stops, interp='LINEAR'):
        nd = self.n.new('ShaderNodeValToRGB'); cr = nd.color_ramp; cr.interpolation = interp
        while len(cr.elements) < len(stops): cr.elements.new(0.5)
        for el, (pos, col) in zip(cr.elements, stops):
            el.position = pos; el.color = hex_rgb(col) if isinstance(col, str) else col
        self.l.new(fac, nd.inputs['Fac'])
        return nd.outputs['Color']

    def mix_color(self, blend, fac, a, b):
        nd = self.n.new('ShaderNodeMix'); nd.data_type = 'RGBA'; nd.blend_type = blend; nd.clamp_result = False
        for sock, v in ((nd.inputs[0], fac), (nd.inputs[6], a), (nd.inputs[7], b)):
            if isinstance(v, bpy.types.NodeSocket): self.l.new(v, sock)
            else: sock.default_value = v if sock is nd.inputs[0] else (hex_rgb(v) if isinstance(v, str) else v)
        return nd.outputs[2]

    def coord(self, kind='Object'):
        return self.n.new('ShaderNodeTexCoord').outputs[kind]

    def set(self, **kw):
        names = {'base': 'Base Color', 'rough': 'Roughness', 'metal': 'Metallic', 'coat': 'Coat Weight',
                 'coat_rough': 'Coat Roughness', 'emit': 'Emission Color', 'strength': 'Emission Strength',
                 'sss': 'Subsurface Weight', 'sss_radius': 'Subsurface Radius', 'trans': 'Transmission Weight',
                 'ior': 'IOR', 'film': 'Thin Film Thickness', 'sheen': 'Sheen Weight', 'sheen_tint': 'Sheen Tint',
                 'spec': 'Specular IOR Level', 'alpha': 'Alpha'}
        for k, v in kw.items():
            sock = self.p.inputs[names[k]]
            if isinstance(v, bpy.types.NodeSocket): self.l.new(v, sock)
            elif isinstance(v, str): sock.default_value = hex_rgb(v)
            else: sock.default_value = v
        return self


def solid(name, base, rough=0.4, **kw):
    return M(name).set(base=base, rough=rough, **kw).mat


def glow(name, color, strength):
    m = M(name); m.n.remove(m.p)
    em = m.node('ShaderNodeEmission', Color=hex_rgb(color), Strength=strength)
    m.l.new(em.outputs[0], m.out.inputs['Surface'])
    return m.mat, em


def soft(name, color, strength, opacity=1.0, power=2.0):
    """Radial soft glow for camera-facing discs: transparent at the rim."""
    m = M(name); m.n.remove(m.p)
    co = m.coord('Object')
    length = m.node('ShaderNodeVectorMath'); length.operation = 'LENGTH'; m.l.new(co, length.inputs[0])
    fall = m.math('POWER', m.math('SUBTRACT', 1.0, length.outputs['Value'], clamp=True), power)
    fac = m.math('MULTIPLY', fall, opacity, clamp=True)
    em = m.node('ShaderNodeEmission', Color=hex_rgb(color), Strength=strength)
    tr = m.node('ShaderNodeBsdfTransparent')
    mix = m.node('ShaderNodeMixShader'); m.l.new(fac, mix.inputs[0])
    m.l.new(tr.outputs[0], mix.inputs[1]); m.l.new(em.outputs[0], mix.inputs[2])
    m.l.new(mix.outputs[0], m.out.inputs['Surface'])
    return m.mat, em


def eye_material(name, iris):
    m = M(name)
    co = m.coord('Object'); sep = m.node('ShaderNodeSeparateXYZ', Vector=co)
    comb = m.node('ShaderNodeCombineXYZ', X=sep.outputs['X'], Z=sep.outputs['Z'])
    ln = m.node('ShaderNodeVectorMath'); ln.operation = 'LENGTH'; m.l.new(comb.outputs[0], ln.inputs[0])
    r = ln.outputs['Value']
    ring = m.ramp(r, [(0.0, (0, 0, 0, 1)), (0.38, (0, 0, 0, 1)), (0.56, (1, 1, 1, 1)), (0.7, (0.25, 0.25, 0.25, 1)), (0.86, (0, 0, 0, 1))])
    nebula = m.node('ShaderNodeTexNoise', Vector=co, Scale=3.0, Detail=4.0)
    deep = m.ramp(nebula.outputs['Fac'], [(0.35, '#07061a'), (0.7, '#231a55')])
    m.set(base=deep, rough=0.12, coat=1.0, coat_rough=0.02, spec=0.6,
          emit=m.mix_color('MULTIPLY', 1.0, ring, hex_rgb(iris)), strength=3.2)
    return m.mat


def galaxy_material(name, stops, star_scale=26, star_size=0.055, nebula_glow=0.35, coat=1.0):
    """Marbled nebula body with tiny glowing stars embedded under a clear coat."""
    m = M(name); co = m.coord('Object')
    warp = m.node('ShaderNodeTexNoise', Vector=co, Scale=1.6, Detail=8.0, Roughness=0.62, Distortion=0.9)
    neb = m.ramp(warp.outputs['Fac'], stops)
    vor = m.node('ShaderNodeTexVoronoi', Vector=co, Scale=star_scale)
    vor.feature = 'F1'; vor.distance = 'EUCLIDEAN'
    star = m.math('LESS_THAN', vor.outputs['Distance'], star_size)
    rnd = m.math('GREATER_THAN', m.node('ShaderNodeSeparateColor', Color=vor.outputs['Color']).outputs[0], 0.45)
    star = m.math('MULTIPLY', star, rnd)
    emit = m.mix_color('ADD', 1.0, m.mix_color('MULTIPLY', 1.0, neb, (nebula_glow,) * 3 + (1,)),
                       m.mix_color('MULTIPLY', star, (0, 0, 0, 1), (7, 7, 7, 1)))
    m.set(base=neb, rough=0.38, coat=coat, coat_rough=0.04, emit=emit, strength=1.0, sheen=0.4,
          sheen_tint=hex_rgb('#c9b8ff'))
    return m.mat


# ---------------------------------------------------------------- shared rigs

def add_eye(name, body, x, z, size, mat, highlight, lid_mat, parent, lift=-0.02, squash=(1, 0.5, 1.15)):
    """Glossy eye that blinks by squashing; a happy closed-eye arc shows mid-blink."""
    p, n = surface(body, x, z, lift * size)
    frame = empty(name, p, parent); face_to(frame, n)
    pivot = empty(name + 'Blink'); pivot.parent = frame
    eye = sphere(name + 'Ball', mat, (0, 0, 0), (size * squash[0], size * squash[1], size * squash[2]))
    eye.parent = pivot
    for i, (hx, hz, hs) in enumerate(((-0.34, 0.42, 0.26), (0.3, -0.3, 0.12))):
        h = sphere(f'{name}Spark{i}', highlight, (hx * size, -size * squash[1] * 0.95, hz * size * squash[2]),
                   (hs * size, hs * size * 0.4, hs * size), seg=24)
        h.parent = pivot
    arc = [(size * 0.8 * (2 * i / 6 - 1), -size * squash[1] * 1.05, size * (0.22 * math.sin(math.pi * i / 6) - 0.08))
           for i in range(7)]
    lid = tube(name + 'Lid', lid_mat, arc, size * 0.11); lid.parent = frame; lid.scale = (0, 0, 0)
    return pivot, lid


def add_mouth(name, body, x0, x1, z, depth, mat, parent, radius=0.028):
    pts = []
    for i in range(5):
        t = i / 4; x = x0 + (x1 - x0) * t
        zz = z - depth * math.sin(math.pi * t)
        p, _ = surface(body, x, zz, radius * 0.4)
        pts.append(p)
    return tube(name, mat, pts, radius, parent)


def add_blush(name, body, x, z, size, mat, parent):
    p, n = surface(body, x, z, 0.012)
    d = flat(name, mat, circle_outline(32), p, 1.0, parent)
    d.scale = (size, 1, size * 0.62)
    return d


def add_sparkles(spots, mat, parent):
    out = []
    for i, (x, z, s, phase) in enumerate(spots):
        sp = flat(f'Sparkle{i}', mat, star_outline(4, 0.2), (x, -2.5, z), s, parent)
        out.append((sp, s, phase))
    return out


def key(obj, frame, *paths):
    for p in paths: obj.keyframe_insert(p, frame=frame)


def wave(t, phase=0.0, k=1):
    return math.sin(TAU * k * t + phase)


def blink(frame, start=33):
    curve = {start: 0.55, start + 1: 0.05, start + 2: 0.05, start + 3: 0.6}
    return curve.get(frame, 1.0)


def key_blink(eyes, f, start):
    for pivot, lid in eyes:
        s = blink(f, start)
        pivot.scale = (1, 1, s); lid.scale = (1, 1, 1) if s < 0.3 else (0, 0, 0)
        key(pivot, f, 'scale'); key(lid, f, 'scale')


def animate(fn):
    for f in range(1, LOOP + 1):
        bpy.context.scene.frame_set(f)
        fn(f, (f - 1) / LOOP)
    bpy.context.scene.frame_set(1)


def animate_sparkles(sparkles, f, t):
    for sp, s, phase in sparkles:
        v = max(0.0, wave(t, phase)) ** 1.5
        sp.scale = (s * (0.25 + 0.75 * v),) * 3
        sp.rotation_euler = (0, TAU * t * 0.25 + phase, 0)
        key(sp, f, 'scale', 'rotation_euler')


def badge(color_a, color_b, rim):
    """Deep-space disc behind the mascot for icon use (hidden unless --badge)."""
    col = bpy.data.collections.new('Badge'); bpy.context.scene.collection.children.link(col)
    m = M('BadgeSpace'); m.n.remove(m.p); co = m.coord('Object')
    ln = m.node('ShaderNodeVectorMath'); ln.operation = 'LENGTH'; m.l.new(co, ln.inputs[0])
    base = m.ramp(ln.outputs['Value'], [(0.0, color_a), (0.65, color_b), (1.0, '#07051a')])
    neb = m.node('ShaderNodeTexNoise', Vector=co, Scale=1.5, Detail=4.0, Distortion=0.15)
    nebc = m.ramp(neb.outputs['Fac'], [(0.5, (0, 0, 0, 1)), (0.9, hex_rgb(rim))])
    vor = m.node('ShaderNodeTexVoronoi', Vector=co, Scale=34.0)
    stars = m.math('LESS_THAN', vor.outputs['Distance'], 0.04)
    col_out = m.mix_color('ADD', 1.0, m.mix_color('ADD', 0.22, base, nebc), m.mix_color('MULTIPLY', stars, (0, 0, 0, 1), (1.6, 1.6, 1.8, 1)))
    em = m.node('ShaderNodeEmission', Color=col_out, Strength=1.0)
    m.l.new(em.outputs[0], m.out.inputs['Surface'])
    disc = flat('BadgeDisc', m.mat, circle_outline(128), (0, 6, 0), 1.43)
    rim_mat, _ = glow('BadgeRim', rim, 2.2)
    ring = torus('BadgeRim', rim_mat, 1.0, 0.012, (0, 5.9, 0), (math.radians(90), 0, 0), (1.43, 1.43, 1.43))
    for o in (disc, ring):
        bpy.context.collection.objects.unlink(o); col.objects.link(o)
    col.hide_render = True
    return col


# ---------------------------------------------------------------- mascots

def build_orbit():
    """A pocket-sized planet with one huge eye, a tilted ring and two moons."""
    lights('#7fe3ff', '#ff7ad9')
    root = empty('Root')
    body_mat = galaxy_material('OrbitGalaxy', [(0.25, '#1d1b5c'), (0.48, '#4a35a8'), (0.66, '#8a56e0'), (0.86, '#62d4ff')])
    body = sphere('Body', body_mat, (0, 0, -0.08), (0.84, 0.84, 0.8), parent=root)
    eye_mat = eye_material('OrbitEye', '#7fe9ff')
    spark = glow('EyeSpark', '#ffffff', 6.0)[0]
    lid = solid('Lid', '#1b0f3a', 0.4)
    eyes = [add_eye('Eye', body, 0.0, 0.12, 0.36, eye_mat, spark, lid, root, squash=(1, 0.45, 1.05))]
    add_mouth('Mouth', body, -0.12, 0.12, -0.39, 0.06, solid('Mouth', '#2a0f33', 0.5), root, 0.026)
    blush_mat = soft('Blush', '#ff8fd6', 2.4, 0.55, 1.4)[0]
    add_blush('BlushL', body, -0.48, -0.28, 0.11, blush_mat, root)
    add_blush('BlushR', body, 0.48, -0.28, 0.11, blush_mat, root)
    # Antenna sprout with a little star bulb.
    stem_mat = solid('Stem', '#5b46c4', 0.3, coat=1.0)
    top, _ = surface(body, 0.12, 0.6)
    sway = empty('Sway', (top.x, top.y + 0.05, top.z - 0.05), root)
    tube('Stem', stem_mat, [(top.x, top.y + 0.05, top.z - 0.05), (top.x + 0.06, top.y + 0.05, top.z + 0.16), (top.x + 0.2, top.y + 0.05, top.z + 0.3)], 0.024, sway)
    bulb_mat, bulb_em = glow('Bulb', '#ffc24d', 1.8)
    bulb = sphere('Bulb', bulb_mat, (top.x + 0.2, top.y + 0.05, top.z + 0.32), (0.075,) * 3, parent=sway, seg=32)
    bulb_halo_mat, halo_em = soft('BulbHalo', '#ffc46b', 3.0, 0.9, 2.2)
    flat('BulbHalo', bulb_halo_mat, circle_outline(48), (top.x + 0.2, -1.2, top.z + 0.32), 0.24, sway)
    # Planetary ring and moons share one tilted frame.
    tilt = empty('Tilt', (0, 0, -0.12), root)  # tilted per frame, after its children are parented
    ring_m = M('Ring'); co = ring_m.coord('Object')
    grad = ring_m.node('ShaderNodeTexGradient', Vector=co); grad.gradient_type = 'RADIAL'
    rc = ring_m.ramp(grad.outputs['Fac'], [(0.0, '#7fe9ff'), (0.33, '#c6a8ff'), (0.66, '#ff9ee0'), (1.0, '#7fe9ff')])
    ring_m.set(base=rc, rough=0.2, metal=0.3, coat=1.0, emit=rc, strength=1.6)
    torus('Ring', ring_m.mat, 1.2, 0.1, (0, 0, 0), (0, 0, 0), (1, 1, 0.16), tilt)
    torus('RingInner', glow('RingInner', '#cbb8ff', 1.2)[0], 1.36, 0.012, (0, 0, 0), (0, 0, 0), (1, 1, 0.3), tilt)
    spin = empty('Spin', (0, 0, 0), tilt)
    moon_a, moon_em = glow('MoonA', '#ff9f6b', 1.6)
    moon_b = solid('MoonB', '#e9f3ff', 0.3, emit='#b8dcff', strength=1.4)
    sphere('MoonA', moon_a, (1.2, 0, 0.14), (0.1,) * 3, parent=spin, seg=32)
    sphere('MoonB', moon_b, (1.2 * math.cos(2.2), 1.2 * math.sin(2.2), 0.11), (0.07,) * 3, parent=spin, seg=32)
    sparkles = add_sparkles([(-1.08, 0.86, 0.11, 0.0), (1.12, 0.62, 0.075, 2.2), (-0.98, -0.95, 0.07, 4.1)],
                            glow('Sparkle', '#ffc94d', 1.6)[0], root)

    def frame(f, t):
        root.location = (0, 0, 0.05 * wave(t)); root.rotation_euler = (0, math.radians(4) * wave(t, 0.8), 0)
        key(root, f, 'location', 'rotation_euler')
        spin.rotation_euler = (0, 0, -TAU * t); key(spin, f, 'rotation_euler')
        tilt.rotation_euler = (math.radians(31 + 3 * wave(t, 1.3)), math.radians(-14), 0); key(tilt, f, 'rotation_euler')
        sway.rotation_euler = (0, math.radians(9) * wave(t, 2.0), 0); key(sway, f, 'rotation_euler')
        key_blink(eyes, f, 33)
        bulb_em.inputs['Strength'].default_value = 1.8 + 0.8 * wave(t, 0.5, 2)
        bulb_em.inputs['Strength'].keyframe_insert('default_value', frame=f)
        animate_sparkles(sparkles, f, t)
    animate(frame)
    return {'scale': 3.0, 'z': 0.0, 'badge': ('#3a2a8a', '#14104a', '#7fe3ff')}


def build_nova():
    """A plush star creature born in a nebula; its five tips breathe light."""
    lights('#ffd27a', '#b88cff')
    root = empty('Root')
    mb = bpy.data.metaballs.new('NovaBlob'); mb.resolution = 0.03; mb.render_resolution = 0.025; mb.threshold = 0.6
    core = mb.elements.new(); core.co = (0, 0, 0); core.radius = 1.05
    for k in range(5):
        a = math.pi / 2 + TAU * k / 5
        for d, r in ((0.55, 0.58), (0.86, 0.42), (1.1, 0.3)):
            el = mb.elements.new(); el.co = (math.cos(a) * d, 0, math.sin(a) * d); el.radius = r
    blob = bpy.data.objects.new('NovaBlob', mb); bpy.context.collection.objects.link(blob)
    bpy.context.view_layer.update()
    me = bpy.data.meshes.new_from_object(blob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(blob); bpy.data.metaballs.remove(mb)
    for p in me.polygons: p.use_smooth = True
    me.transform(Matrix.Diagonal((1, 0.72, 1, 1)))
    body = bpy.data.objects.new('Body', me); link(body, root); body.location = (0, 0, -0.04)
    m = M('NovaStar'); co = m.coord('Object')
    ln = m.node('ShaderNodeVectorMath'); ln.operation = 'LENGTH'; m.l.new(co, ln.inputs[0])
    r = ln.outputs['Value']
    warp = m.node('ShaderNodeTexNoise', Vector=co, Scale=2.4, Detail=5.0, Distortion=0.5)
    radial = m.math('ADD', m.math('MULTIPLY', r, 0.8), m.math('MULTIPLY', warp.outputs['Fac'], 0.25))
    base = m.ramp(radial, [(0.2, '#ff6fae'), (0.5, '#ff8fa6'), (0.8, '#ffab5e'), (1.05, '#ffcf4a')])
    tips = m.math('POWER', m.node('ShaderNodeMapRange', Value=r, **{'From Min': 0.85, 'From Max': 1.38}).outputs[0], 1.6)
    vor = m.node('ShaderNodeTexVoronoi', Vector=co, Scale=24.0)
    star = m.math('LESS_THAN', vor.outputs['Distance'], 0.05)
    emit = m.mix_color('ADD', 1.0, m.mix_color('MULTIPLY', tips, (0, 0, 0, 1), hex_rgb('#ffb830')),
                       m.mix_color('MULTIPLY', star, (0, 0, 0, 1), (2.5, 2.4, 2.2, 1)))
    strength = m.node('ShaderNodeValue'); strength.outputs[0].default_value = 1.6
    m.set(base=base, rough=0.42, sss=0.25, sss_radius=(0.9, 0.35, 0.3), coat=0.6, coat_rough=0.1,
          film=380.0, emit=emit, strength=strength.outputs[0], sheen=0.5, sheen_tint=hex_rgb('#fff0d6'))
    body.data.materials.append(m.mat)
    eye_mat = eye_material('NovaEye', '#b48cff')
    spark = glow('EyeSpark', '#ffffff', 6.0)[0]
    lid = solid('Lid', '#5a1734', 0.4)
    eyes = [add_eye('EyeL', body, -0.24, 0.08, 0.2, eye_mat, spark, lid, root, squash=(1, 0.5, 1.2)),
            add_eye('EyeR', body, 0.24, 0.08, 0.2, eye_mat, spark, lid, root, squash=(1, 0.5, 1.2))]
    add_mouth('Mouth', body, -0.1, 0.1, -0.2, 0.065, solid('Mouth', '#5a1734', 0.5), root, 0.024)
    blush_mat = soft('Blush', '#ff6fa8', 2.0, 0.6, 1.4)[0]
    add_blush('BlushL', body, -0.46, -0.14, 0.1, blush_mat, root)
    add_blush('BlushR', body, 0.46, -0.14, 0.1, blush_mat, root)
    halo_mat, halo_em = soft('NovaHalo', '#ffc27a', 1.6, 0.32, 2.6)
    halo = flat('Halo', halo_mat, circle_outline(64), (0, 3, -0.04), 1.55, root)
    comet_mat = glow('Comet', '#ffe08a', 2.2)[0]
    orbit = empty('CometOrbit', (0, 0, -0.04), root)
    sphere('Comet', comet_mat, (1.32, 0, 0), (0.05,) * 3, parent=orbit, seg=24)
    sparkles = add_sparkles([(-1.12, 0.94, 0.1, 0.4), (1.16, -0.86, 0.08, 2.6), (1.0, 1.02, 0.065, 4.4)],
                            glow('Sparkle', '#ffb547', 1.6)[0], root)

    def frame(f, t):
        root.location = (0, 0, 0.045 * wave(t)); key(root, f, 'location')
        body.rotation_euler = (0, math.radians(6) * wave(t, 0.4), 0)
        s = 0.022 * wave(t, 1.0, 2); body.scale = (1 + s, 1, 1 - s)
        key(body, f, 'rotation_euler', 'scale')
        key_blink(eyes, f, 28)
        strength.outputs[0].default_value = 1.6 + 0.9 * wave(t, 0.0, 2)
        strength.outputs[0].keyframe_insert('default_value', frame=f)
        halo_em.inputs['Strength'].default_value = 1.6 + 0.5 * wave(t, 0.0, 2)
        halo_em.inputs['Strength'].keyframe_insert('default_value', frame=f)
        orbit.rotation_euler = (math.radians(22), math.radians(24), -TAU * t); key(orbit, f, 'rotation_euler')
        animate_sparkles(sparkles, f, t)
    animate(frame)
    return {'scale': 3.05, 'z': 0.02, 'badge': ('#6a2c8f', '#24103f', '#ffc56b')}


def build_cosmo():
    """An alien cadet in a bubble helmet, antennae glowing, waving hello."""
    lights('#7fe3ff', '#ff8fd0')
    root = empty('Root', (0, 0, 0.1))
    head_m = M('CosmoSkin'); co = head_m.coord('Object')
    sep = head_m.node('ShaderNodeSeparateXYZ', Vector=co)
    noise = head_m.node('ShaderNodeTexNoise', Vector=co, Scale=2.0, Detail=4.0)
    tone = head_m.math('ADD', head_m.math('MULTIPLY', sep.outputs['Z'], 0.35), head_m.math('MULTIPLY', noise.outputs['Fac'], 0.3))
    skin = head_m.ramp(tone, [(0.05, '#5fa8ff'), (0.35, '#8ec7ff'), (0.6, '#b9e2ff')])
    vor = head_m.node('ShaderNodeTexVoronoi', Vector=co, Scale=18.0)
    freckle = head_m.math('LESS_THAN', vor.outputs['Distance'], 0.05)
    head_m.set(base=skin, rough=0.38, sss=0.2, sss_radius=(0.3, 0.5, 1.0), coat=0.5, coat_rough=0.08,
               emit=head_m.mix_color('MULTIPLY', freckle, (0, 0, 0, 1), (2.2, 2.4, 2.8, 1)), strength=1.0)
    head = sphere('Head', head_m.mat, (0, 0, 0.22), (0.66, 0.6, 0.6), parent=root)
    eye_mat = eye_material('CosmoEye', '#ff8fe0')
    spark = glow('EyeSpark', '#ffffff', 6.0)[0]
    lid = solid('Lid', '#1f1a4a', 0.4)
    eyes = [add_eye('EyeL', head, -0.23, 0.27, 0.165, eye_mat, spark, lid, root, squash=(1, 0.5, 1.25)),
            add_eye('EyeR', head, 0.23, 0.27, 0.165, eye_mat, spark, lid, root, squash=(1, 0.5, 1.25))]
    add_mouth('Mouth', head, -0.09, 0.09, 0.02, 0.06, solid('Mouth', '#1f1a4a', 0.5), root, 0.022)
    blush_mat = soft('Blush', '#ff7fc4', 2.0, 0.55, 1.4)[0]
    add_blush('BlushL', head, -0.42, 0.07, 0.085, blush_mat, root)
    add_blush('BlushR', head, 0.42, 0.07, 0.085, blush_mat, root)
    stem = solid('Antenna', '#7cb8ff', 0.3, coat=1.0)
    antennae = []
    for side, colour in ((-1, '#7fe9ff'), (1, '#ff9be0')):
        base, _ = surface(head, side * 0.22, 0.7)
        base.y = 0.0
        piv = empty(f'Antenna{side}', base, root)
        tip = base + Vector((side * 0.2, 0, 0.3))
        tube(f'Stem{side}', stem, [base, base + Vector((side * 0.04, 0, 0.16)), tip], 0.022, piv)
        orb_mat, orb_em = glow(f'Orb{side}', colour, 2.0)
        sphere(f'Orb{side}', orb_mat, tip, (0.075,) * 3, parent=piv, seg=32)
        halo_mat, halo_em = soft(f'OrbHalo{side}', colour, 3.0, 0.9, 2.2)
        flat(f'OrbHalo{side}', halo_mat, circle_outline(48), (tip.x, -1.4, tip.z), 0.22, piv)
        antennae.append((piv, side, orb_em, halo_em))
    glass = M('Helmet').set(base='#f2f8ff', rough=0.02, trans=1.0, ior=1.08, coat=0.0, spec=0.7)
    helmet = sphere('Helmet', glass.mat, (0, 0, 0.3), (1.0, 1.0, 1.0), r=0.98, parent=root)
    helmet.visible_shadow = False  # caustics are off, so a shadowing dome would leave the head unlit
    glint = soft('Glint', '#ffffff', 3.0, 0.7, 1.2)[0]
    g = flat('Glint', glint, [(math.cos(a) * 1.0, math.sin(a) * 0.32) for a in [TAU * i / 32 for i in range(32)]], (-0.5, -1.2, 0.82), 0.3, root)
    g.rotation_euler = (0, math.radians(-40), 0)
    suit = solid('Suit', '#f1efff', 0.35, coat=0.6, coat_rough=0.1, sheen=0.4, sheen_tint=hex_rgb('#c8d6ff'))
    trim, trim_em = glow('Trim', '#8fd3ff', 3.0)
    torus('Collar', suit, 0.6, 0.12, (0, 0, -0.62), (0, 0, 0), (1, 0.8, 1), root)
    torus('CollarGlow', trim, 0.6, 0.03, (0, -0.04, -0.66), (0, 0, 0), (1.12, 0.92, 1), root)
    torso = sphere('Torso', suit, (0, 0, -1.02), (0.56, 0.44, 0.44), parent=root)
    emblem, _ = surface(torso, 0, -0.98, 0.01)
    flat('EmblemDisc', glow('EmblemDisc', '#2b2470', 1.0)[0], circle_outline(40), emblem, 0.12, root)
    flat('Hourglass', trim, [(-0.6, 0.75), (0.6, 0.75), (0.08, 0.0), (0.6, -0.75), (-0.6, -0.75), (-0.08, 0.0)],
         emblem + Vector((0, -0.01, 0)), 0.07, root)
    glove = solid('Glove', '#8ec7ff', 0.35, coat=0.6)
    arms = []
    for side in (-1, 1):
        shoulder = Vector((side * 0.48, 0, -0.88))
        piv = empty(f'Shoulder{side}', shoulder, root)
        sphere(f'Arm{side}', suit, shoulder + Vector((side * 0.17, 0, -0.14)), (0.16, 0.15, 0.26), parent=piv, seg=32)
        sphere(f'Hand{side}', glove, shoulder + Vector((side * 0.26, -0.02, -0.36)), (0.13,) * 3, parent=piv, seg=32)
        arms.append((piv, side))
    sparkles = add_sparkles([(-1.12, 0.98, 0.1, 0.9), (1.14, 1.02, 0.07, 3.1), (-1.1, -0.6, 0.065, 5.0)],
                            glow('Sparkle', '#5fd0ff', 1.6)[0], root)

    def frame(f, t):
        root.location = (0, 0, 0.1 + 0.04 * wave(t)); key(root, f, 'location')
        head.rotation_euler = (0, math.radians(3) * wave(t, 1.2), 0); key(head, f, 'rotation_euler')
        for piv, side, orb_em, halo_em in antennae:
            piv.rotation_euler = (0, math.radians(8) * wave(t, 1.6 if side > 0 else 2.6), 0); key(piv, f, 'rotation_euler')
            orb_em.inputs['Strength'].default_value = 2.0 + 0.9 * wave(t, 0 if side > 0 else math.pi, 2)
            orb_em.inputs['Strength'].keyframe_insert('default_value', frame=f)
        for piv, side in arms:
            if side > 0:
                ang = math.radians(78) + math.radians(22) * wave(t, 0, 2)
            else:
                ang = math.radians(-6) + math.radians(3) * wave(t, 0.6)
            piv.rotation_euler = (0, -ang, 0); key(piv, f, 'rotation_euler')
        key_blink(eyes, f, 36)
        animate_sparkles(sparkles, f, t)
    animate(frame)
    return {'scale': 3.0, 'z': 0.0, 'badge': ('#235a9a', '#0f1f4a', '#9fdcff')}


BUILDERS = {'orbit': build_orbit, 'nova': build_nova, 'cosmo': build_cosmo}


def main():
    a = args(); s = reset()
    info = BUILDERS[a['name']]()
    camera(info['scale'], info['z'])
    badge_col = badge(*info['badge'])
    s.render.resolution_x = s.render.resolution_y = a['size']
    s.cycles.samples = a['samples']
    out = os.path.join(a['out'], a['name']); os.makedirs(out, exist_ok=True)
    src = os.path.join(HERE, 'source'); os.makedirs(src, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(src, a['name'] + '.blend'))
    frames = [1, 30, 35] if a["preview"] else range(1, LOOP + 1)
    for f in frames:
        s.frame_set(f); s.render.filepath = os.path.join(out, f'frame_{f:04d}.png')
        bpy.ops.render.render(write_still=True)
    badge_col.hide_render = False; s.frame_set(1)
    s.render.filepath = os.path.join(a['out'], a['name'] + '_badge.png')
    bpy.ops.render.render(write_still=True)
    print('MASCOT_DONE', a['name'])


main()
