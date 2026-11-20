"""Feral Coast - step 2: create materials and the Island map with sky, lighting, ocean, post-processing,
the player start and the FCWorldBuilder (forest, outposts, piers, vehicles, militia).
Run after 1_import_assets.py and after compiling the C++ project. The landscape is imported by hand
(see README: Landscape mode > Import from file, Data/heightmap_1009.png) because the editor's Python
API does not expose landscape heightmap import."""
import json
import os
import unreal

PROJECT = unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_dir())
world = json.load(open(os.path.join(PROJECT, "Data", "world.json")))
MEL = unreal.MaterialEditingLibrary
tools = unreal.AssetToolsHelpers.get_asset_tools()
eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)

def ue(x, y, z):  # three.js metres -> Unreal cm (X=x, Y=z, Z=y)
    return unreal.Vector(x * 100.0, z * 100.0, y * 100.0)

def new_material(name):
    path = "/Game/FeralCoast/Materials/" + name
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        unreal.EditorAssetLibrary.delete_asset(path)
    return tools.create_asset(name, "/Game/FeralCoast/Materials", unreal.Material, unreal.MaterialFactoryNew())

def tex(name):
    return unreal.load_asset("/Game/FeralCoast/Textures/" + name)

def tiled_sample(m, texture, tiling, x, y):
    s = MEL.create_material_expression(m, unreal.MaterialExpressionTextureSample, x, y)
    s.texture = texture
    wp = MEL.create_material_expression(m, unreal.MaterialExpressionWorldPosition, x - 600, y)
    mask = MEL.create_material_expression(m, unreal.MaterialExpressionComponentMask, x - 450, y)
    mask.r = True; mask.g = True; mask.b = False; mask.a = False
    div = MEL.create_material_expression(m, unreal.MaterialExpressionDivide, x - 300, y)
    div.const_b = tiling
    MEL.connect_material_expressions(wp, "", mask, "")
    MEL.connect_material_expressions(mask, "", div, "A")
    MEL.connect_material_expressions(div, "", s, "UVs")
    return s

# --- structure material: world-aligned plaster/concrete for the outpost blocks ---
m = new_material("M_Structure")
s = tiled_sample(m, tex("T_wall"), 300.0, -300, 0)
MEL.connect_material_property(s, "RGB", unreal.MaterialProperty.MP_BASE_COLOR)
r = MEL.create_material_expression(m, unreal.MaterialExpressionConstant, -300, 200); r.r = 0.85
MEL.connect_material_property(r, "", unreal.MaterialProperty.MP_ROUGHNESS)
MEL.recompile_material(m)
structure_mat = m

# --- landscape material: sand near sea level, grass, rock on steep slopes ---
m = new_material("M_Island")
grass = tiled_sample(m, tex("T_grass"), 400.0, -500, -300)
sand = tiled_sample(m, tex("T_dirt"), 400.0, -500, 0)
rock = tiled_sample(m, tex("T_stone"), 600.0, -500, 300)
wp = MEL.create_material_expression(m, unreal.MaterialExpressionWorldPosition, -900, 600)
zmask = MEL.create_material_expression(m, unreal.MaterialExpressionComponentMask, -750, 600); zmask.r = False; zmask.g = False; zmask.b = True; zmask.a = False
MEL.connect_material_expressions(wp, "", zmask, "")
sandk = MEL.create_material_expression(m, unreal.MaterialExpressionDivide, -600, 600); sandk.const_b = 250.0   # sand below ~2.5 m
MEL.connect_material_expressions(zmask, "", sandk, "A")
sat = MEL.create_material_expression(m, unreal.MaterialExpressionSaturate, -450, 600)
MEL.connect_material_expressions(sandk, "", sat, "")
lerp1 = MEL.create_material_expression(m, unreal.MaterialExpressionLinearInterpolate, -200, -150)
MEL.connect_material_expressions(sand, "RGB", lerp1, "A")
MEL.connect_material_expressions(grass, "RGB", lerp1, "B")
MEL.connect_material_expressions(sat, "", lerp1, "Alpha")
nrm = MEL.create_material_expression(m, unreal.MaterialExpressionVertexNormalWS, -900, 800)
nz = MEL.create_material_expression(m, unreal.MaterialExpressionComponentMask, -750, 800); nz.r = False; nz.g = False; nz.b = True; nz.a = False
MEL.connect_material_expressions(nrm, "", nz, "")
oneminus = MEL.create_material_expression(m, unreal.MaterialExpressionOneMinus, -600, 800)
MEL.connect_material_expressions(nz, "", oneminus, "")
steep = MEL.create_material_expression(m, unreal.MaterialExpressionMultiply, -450, 800); steep.const_b = 3.0
MEL.connect_material_expressions(oneminus, "", steep, "A")
sat2 = MEL.create_material_expression(m, unreal.MaterialExpressionSaturate, -300, 800)
MEL.connect_material_expressions(steep, "", sat2, "")
lerp2 = MEL.create_material_expression(m, unreal.MaterialExpressionLinearInterpolate, -50, 0)
MEL.connect_material_expressions(lerp1, "", lerp2, "A")
MEL.connect_material_expressions(rock, "RGB", lerp2, "B")
MEL.connect_material_expressions(sat2, "", lerp2, "Alpha")
MEL.connect_material_property(lerp2, "", unreal.MaterialProperty.MP_BASE_COLOR)
rough = MEL.create_material_expression(m, unreal.MaterialExpressionConstant, -50, 300); rough.r = 0.9
MEL.connect_material_property(rough, "", unreal.MaterialProperty.MP_ROUGHNESS)
MEL.recompile_material(m)

# --- ocean: translucent, glossy, tinted ---
m = new_material("M_Ocean")
m.set_editor_property("blend_mode", unreal.BlendMode.BLEND_TRANSLUCENT)
m.set_editor_property("translucency_lighting_mode", unreal.TranslucencyLightingMode.TLM_SURFACE)
c = MEL.create_material_expression(m, unreal.MaterialExpressionConstant3Vector, -300, 0); c.constant = unreal.LinearColor(0.02, 0.17, 0.2, 1)
MEL.connect_material_property(c, "", unreal.MaterialProperty.MP_BASE_COLOR)
o = MEL.create_material_expression(m, unreal.MaterialExpressionConstant, -300, 150); o.r = 0.82
MEL.connect_material_property(o, "", unreal.MaterialProperty.MP_OPACITY)
rr = MEL.create_material_expression(m, unreal.MaterialExpressionConstant, -300, 250); rr.r = 0.05
MEL.connect_material_property(rr, "", unreal.MaterialProperty.MP_ROUGHNESS)
sp = MEL.create_material_expression(m, unreal.MaterialExpressionConstant, -300, 330); sp.r = 1.0
MEL.connect_material_property(sp, "", unreal.MaterialProperty.MP_SPECULAR)
MEL.recompile_material(m)
ocean_mat = m

# --- the map ---
MAP = "/Game/FeralCoast/Maps/Island"
if unreal.EditorAssetLibrary.does_asset_exist(MAP):
    les.load_level(MAP)
else:
    les.new_level(MAP)

def spawn(cls, loc=unreal.Vector(0, 0, 0), rot=unreal.Rotator(0, 0, 0), label=None):
    a = eas.spawn_actor_from_class(cls, loc, rot)
    if label:
        a.set_actor_label(label)
    return a

# remove anything this script made before so it can be re-run
for a in eas.get_all_level_actors():
    if a.get_actor_label().startswith("FC_"):
        eas.destroy_actor(a)

sun = spawn(unreal.DirectionalLight, unreal.Vector(0, 0, 50000), unreal.Rotator(0, -38, 135), "FC_Sun")
sc = sun.get_component_by_class(unreal.DirectionalLightComponent)
sc.set_editor_property("intensity", 9.0)
sc.set_editor_property("atmosphere_sun_light", True)
sc.set_editor_property("light_color", unreal.Color(255, 244, 222, 255))
spawn(unreal.SkyAtmosphere, label="FC_SkyAtmosphere")
sky = spawn(unreal.SkyLight, unreal.Vector(0, 0, 2000), label="FC_SkyLight")
slc = sky.get_component_by_class(unreal.SkyLightComponent)
slc.set_editor_property("real_time_capture", True)
slc.set_editor_property("mobility", unreal.ComponentMobility.MOVABLE)
spawn(unreal.VolumetricCloud, label="FC_Clouds")
fog = spawn(unreal.ExponentialHeightFog, unreal.Vector(0, 0, 0), label="FC_Fog")
fc = fog.get_component_by_class(unreal.ExponentialHeightFogComponent)
fc.set_editor_property("fog_density", 0.012)
fc.set_editor_property("volumetric_fog", True)
pp = spawn(unreal.PostProcessVolume, label="FC_PostProcess")
pp.set_editor_property("unbound", True)
st = pp.get_editor_property("settings")
st.set_editor_property("override_bloom_intensity", True); st.set_editor_property("bloom_intensity", 0.6)
st.set_editor_property("override_auto_exposure_min_brightness", True); st.set_editor_property("auto_exposure_min_brightness", 1.0)
st.set_editor_property("override_auto_exposure_max_brightness", True); st.set_editor_property("auto_exposure_max_brightness", 3.0)
st.set_editor_property("override_vignette_intensity", True); st.set_editor_property("vignette_intensity", 0.35)
st.set_editor_property("override_color_saturation", True); st.set_editor_property("color_saturation", unreal.Vector4(1.08, 1.08, 1.08, 1))
pp.set_editor_property("settings", st)

# ocean: one large plane at sea level (swap for the Water plugin's Ocean later for waves)
plane = unreal.load_asset("/Engine/BasicShapes/Plane")
ocean = spawn(unreal.StaticMeshActor, unreal.Vector(0, 0, -5), label="FC_Ocean")
ocean.static_mesh_component.set_static_mesh(plane)
ocean.static_mesh_component.set_material(0, ocean_mat)
ocean.set_actor_scale3d(unreal.Vector(4000, 4000, 1))

s0 = world["start"]
spawn(unreal.PlayerStart, ue(s0["x"], s0["y"] + 2, s0["z"]), unreal.Rotator(0, 0, -90), "FC_PlayerStart")
builder_cls = unreal.load_class(None, "/Script/FeralCoast.FCWorldBuilder")
if builder_cls:
    b = spawn(builder_cls, label="FC_WorldBuilder")
    b.set_editor_property("structure_material", structure_mat)
else:
    unreal.log_error("Feral Coast: compile the C++ project first (FCWorldBuilder class not found)")

les.save_current_level()
unreal.log("Feral Coast: Island map built. Import the landscape (README step 4), then press Play.")
