"""Feral Coast - step 1: import every model, sound and texture from SourceAssets/ into /Game/FeralCoast.
Run inside the Unreal Editor: Tools > Execute Python Script... (Python Editor Script Plugin is enabled by the project).
Each model goes into its own folder (/Game/FeralCoast/Models/<key>/) because the C++ code looks assets up by folder."""
import os
import unreal

PROJECT = unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_dir())
SRC = os.path.join(PROJECT, "SourceAssets")
tools = unreal.AssetToolsHelpers.get_asset_tools()

def run(tasks):
    if tasks:
        tools.import_asset_tasks(tasks)

def task(path, dest, name=None):
    t = unreal.AssetImportTask()
    t.filename = path
    t.destination_path = dest
    if name:
        t.destination_name = name
    t.automated = True
    t.replace_existing = True
    t.save = True
    return t

# textures
run([task(os.path.join(SRC, "Textures", f), "/Game/FeralCoast/Textures") for f in sorted(os.listdir(os.path.join(SRC, "Textures"))) if f.endswith(".png")])

# sounds (ogg -> SoundWave named after the file)
run([task(os.path.join(SRC, "Sounds", f), "/Game/FeralCoast/Sounds", os.path.splitext(f)[0]) for f in sorted(os.listdir(os.path.join(SRC, "Sounds"))) if f.endswith(".ogg")])

# models: one folder each; done one at a time so a bad file doesn't stop the rest
models = sorted(f for f in os.listdir(os.path.join(SRC, "Models")) if f.endswith(".glb"))
with unreal.ScopedSlowTask(len(models), "Importing Feral Coast models") as slow:
    slow.make_dialog(True)
    for f in models:
        if slow.should_cancel():
            break
        key = os.path.splitext(f)[0]
        slow.enter_progress_frame(1, key)
        try:
            run([task(os.path.join(SRC, "Models", f), "/Game/FeralCoast/Models/" + key)])
        except Exception as e:  # keep going
            unreal.log_warning("Feral Coast: failed to import %s: %s" % (f, e))

unreal.log("Feral Coast: import finished (%d models). Now run 2_build_level.py" % len(models))
