// Visor 3D mínimo: carga un .glb, encuadra al personaje y reproduce el clip de cada expresión.
import {WebGLRenderer,Scene,PerspectiveCamera,AmbientLight,DirectionalLight,HemisphereLight,AnimationMixer,Box3,Vector3,LoopOnce,LoopRepeat,SRGBColorSpace} from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
const cache={};
function load(url){return cache[url]||(cache[url]=new Promise(function(ok,ko){new GLTFLoader().load(url,ok,undefined,ko)}))}
// cfg: {url, clips:{expr:{name,once,speed,morph:{Sad:1}}}, headFrac (0..1 parte alta a encuadrar), yaw}
export async function mount3d(el,cfg,expr){
 var gltf=await load(cfg.url);
 var renderer=new WebGLRenderer({antialias:true,alpha:true});
 renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));renderer.outputColorSpace=SRGBColorSpace;
 var w=el.clientWidth||200,h=el.clientHeight||200;renderer.setSize(w,h);
 renderer.domElement.style.cssText='width:100%;height:100%;display:block';
 el.appendChild(renderer.domElement);
 var scene=new Scene();
 scene.add(new HemisphereLight(0xcfeaff,0x223355,1.6));
 var key=new DirectionalLight(0xffffff,2.2);key.position.set(2,4,5);scene.add(key);
 var rim=new DirectionalLight(0x22d3ee,1.6);rim.position.set(-3,2,-3);scene.add(rim);
 // clon por instancia (grande y mini comparten el glb cacheado)
 var SU=await import('three/examples/jsm/utils/SkeletonUtils.js');
 var model=SU.clone(gltf.scene);scene.add(model);
 if(cfg.yaw)model.rotation.y=cfg.yaw;
 var mixer=new AnimationMixer(model),act=null,last=performance.now(),dead=false;
 var morphMeshes=[];model.traverse(function(o){if(o.isMesh&&o.morphTargetDictionary)morphMeshes.push(o)});
 var morphGoal={};
 function set(e){
  var c=cfg.clips[e]||cfg.clips.neutral;
  var clip=gltf.animations.find(function(a){return a.name===c.name});
  var next=mixer.clipAction(clip);next.reset();next.setLoop(c.once?LoopOnce:LoopRepeat,Infinity);next.clampWhenFinished=!!c.once;
  next.setEffectiveTimeScale(c.speed||1);
  if(act&&act!==next){next.crossFadeFrom(act,0.25,false)}
  next.play();act=next;
  morphGoal=c.morph||{};
 }
 set('neutral');mixer.update(0);model.updateMatrixWorld(true);
 var box=new Box3().setFromObject(model,true),size=box.getSize(new Vector3()),ctr=box.getCenter(new Vector3());
 var hf=cfg.headFrac||1;
 var camH=size.y*hf,midY=box.max.y-camH/2;
 var cam=new PerspectiveCamera(30,w/h,size.y/100,size.y*100);
 var dist=(camH*0.5/Math.tan(15*Math.PI/180))*1.18;
 cam.position.set(ctr.x,midY,ctr.z+dist);cam.lookAt(ctr.x,midY,ctr.z);
 set(expr);
 function tick(){
  if(dead)return;requestAnimationFrame(tick);
  var n=performance.now();mixer.update(Math.min((n-last)/1000,.1));last=n;
  morphMeshes.forEach(function(m){Object.keys(m.morphTargetDictionary).forEach(function(k){var i=m.morphTargetDictionary[k],g=morphGoal[k]||0;m.morphTargetInfluences[i]+=(g-m.morphTargetInfluences[i])*0.15})});
  renderer.render(scene,cam);
 }
 tick();
 return {set:set,dispose:function(){dead=true;mixer.stopAllAction();renderer.dispose();renderer.forceContextLoss();if(renderer.domElement.parentNode)renderer.domElement.parentNode.removeChild(renderer.domElement)}};
}
