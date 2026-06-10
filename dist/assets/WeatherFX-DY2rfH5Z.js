import{P as M,au as x,av as g,a1 as w,V as y,M as b,$ as A,d as C,o as S,a5 as _}from"./index-DLpo4h7k.js";const P=`
  uniform float uTime;
  uniform vec3 uCenter;
  uniform vec3 uBox;
  uniform vec2 uShear;     // horizontale Drift (Wind + Fahrtwind)
  attribute vec3 aOffset;  // 0..1 Zufallsposition in der Box
  attribute float aSpeed;
  varying float vAlpha;
  void main() {
    float fall = uTime * (9.0 + aSpeed * 5.0);
    vec3 cell = aOffset;
    cell.y = fract(aOffset.y - fall / uBox.y);
    vec3 base = uCenter + (cell - 0.5) * uBox;
    // Streifen entlang der Fallrichtung verscheren
    vec3 p = position;
    vec2 shear = uShear * (0.5 + aSpeed * 0.5);
    base.xz += shear * (p.y / max(uBox.y, 0.001)) * 14.0;
    // zylindrisches Billboard zur Kamera
    vec3 toCam = normalize(cameraPosition - base);
    vec3 sideDir = normalize(vec3(-toCam.z, 0.0, toCam.x));
    vec3 world = base + sideDir * p.x + vec3(0.0, p.y, 0.0);
    vAlpha = 0.25 + aSpeed * 0.3;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`,I=`
  uniform float uIntensity;
  varying float vAlpha;
  void main() {
    gl_FragColor = vec4(0.65, 0.7, 0.8, vAlpha * uIntensity);
  }
`;class O{constructor(o,a){this.scene=o;const i=a.rainCount,r=new M(.012,.55),e=new x;e.index=r.index,e.attributes.position=r.attributes.position,e.attributes.uv=r.attributes.uv;const n=new Float32Array(i*3),l=new Float32Array(i);for(let t=0;t<i;t++)n[t*3]=Math.random(),n[t*3+1]=Math.random(),n[t*3+2]=Math.random(),l[t]=Math.random();e.setAttribute("aOffset",new g(n,3)),e.setAttribute("aSpeed",new g(l,1)),e.instanceCount=i,this.rainUniforms={uTime:{value:0},uCenter:{value:new y},uBox:{value:new y(34,18,34)},uShear:{value:new w(0,0)},uIntensity:{value:0}},this.rainMesh=new b(e,new A({vertexShader:P,fragmentShader:I,uniforms:this.rainUniforms,transparent:!0,depthWrite:!1})),this.rainMesh.frustumCulled=!1,this.rainMesh.layers.set(2),this.rainMesh.visible=!1,o.add(this.rainMesh),this.canvas=document.createElement("canvas"),this.canvas.width=this.canvas.height=512,this.ctx=this.canvas.getContext("2d"),this.dropTex=new C(this.canvas),this.dropMat=new S({map:this.dropTex,transparent:!0,blending:_,depthWrite:!1,opacity:.85,toneMapped:!1}),this.dropMesh=null,this.drops=[],this._hasDrops=!1}attachWindshield(o,a,i,r,e){this.dropMesh=new b(new M(a,i),this.dropMat),this.dropMesh.position.copy(r),this.dropMesh.rotation.y=Math.PI,this.dropMesh.rotateX(e),this.dropMesh.renderOrder=5,this.dropMesh.layers.set(2),o.add(this.dropMesh),this.wsWidth=a,this.wsHeight=i}setWiperGeometry(o){this.wiperPivots=o}_spawnDrop(o){const a=1.5+Math.random()*3.5,i=Math.random()*512,r=Math.random()*512,e=this.ctx,n=e.createRadialGradient(i,r-a*.2,a*.1,i,r,a);n.addColorStop(0,"rgba(190,205,225,0.10)"),n.addColorStop(.7,"rgba(190,205,225,0.20)"),n.addColorStop(1,"rgba(190,205,225,0.0)"),e.fillStyle=n,e.beginPath(),e.arc(i,r,a,0,Math.PI*2),e.fill(),e.fillStyle="rgba(235,242,255,0.5)",e.beginPath(),e.arc(i+a*.25,r+a*.3,a*.22,0,Math.PI*2),e.fill(),a>3.2&&this.drops.length<24&&this.drops.push({x:i,y:r,r:a*.6,life:2+Math.random()*3}),this._hasDrops=!0}update(o,a,i,r,e,n){const l=a.rain;if(this.rainMesh.visible=l>.02,this.rainMesh.visible&&(this.rainUniforms.uTime.value=n,this.rainUniforms.uCenter.value.copy(i.position),this.rainUniforms.uIntensity.value=l,this.rainUniforms.uShear.value.set(-r.x*.04+.05,-r.z*.04)),!this.dropMesh)return;const t=this.ctx;let c=!1;if(l>.03){const h=r.length(),s=l*26*Math.max(.25,1-h/35);for(this._spawnAcc=(this._spawnAcc||0)+s*o;this._spawnAcc>=1;)this._spawnDrop(l),this._spawnAcc-=1,c=!0}if(this.drops.length){for(let h=this.drops.length-1;h>=0;h--){const s=this.drops[h];s.life-=o;const d=26*o*(.5+s.r*.15);s.y+=d,s.x+=Math.sin(s.y*.05+h)*.4,t.fillStyle="rgba(190,205,225,0.16)",t.beginPath(),t.arc(s.x,s.y,s.r,0,Math.PI*2),t.fill(),(s.life<=0||s.y>520)&&this.drops.splice(h,1)}c=!0}if(this._hasDrops){this._fadeAcc=(this._fadeAcc||0)+o;const h=l>.03?.5:.12;this._fadeAcc>h&&(this._fadeAcc=0,t.globalCompositeOperation="destination-out",t.fillStyle="rgba(0,0,0,0.06)",t.fillRect(0,0,512,512),t.globalCompositeOperation="source-over",c=!0)}if(e&&this.wiperPivots&&e.isMoving){const h=e.sweep;t.globalCompositeOperation="destination-out",t.lineCap="round";for(const s of this.wiperPivots){const d=-.25+h*1.75,f=s.u*512,u=512-s.v*512,p=s.len*512,v=Math.sin(d),m=-Math.cos(d);t.strokeStyle="rgba(0,0,0,0.85)",t.lineWidth=26,t.beginPath(),t.moveTo(f+v*p*.25,u+m*p*.25),t.lineTo(f+v*p,u+m*p),t.stroke()}t.globalCompositeOperation="source-over",c=!0}c&&(this.dropTex.needsUpdate=!0)}}export{O as WeatherFX};
