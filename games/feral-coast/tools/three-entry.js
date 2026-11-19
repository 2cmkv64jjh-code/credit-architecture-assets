// Bundles three.js plus the add-ons the game uses into one classic script exposing window.THREE.
import * as THREE_NS from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { N8AOPass } from 'n8ao';
import * as PLINK from 'plinkfx';

window.THREE = Object.assign({}, THREE_NS, {
  GLTFLoader, MeshoptDecoder, SkeletonUtils, BufferGeometryUtils, Sky,
  EffectComposer, RenderPass, UnrealBloomPass, OutputPass, ShaderPass, SMAAPass, N8AOPass,
});
// plinkfx: CC0 game sound effects rendered from code (https://github.com/maximilianfeix/plinkfx)
window.PLINK = PLINK;
