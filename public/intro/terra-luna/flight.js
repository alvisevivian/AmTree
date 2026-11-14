'use strict';

const duration = 7;
const moon = [1.32, -0.18, 9.35];
const radius = 0.65;
const sun = unit([-0.34, 0.69, 0.64]);
const timeline = [
  [0.00, [ 0.11, 0.24, 3.52], [ 0.00, 0.00, 0.00]],
  [0.91, [-0.63, 0.37, 3.76], [-0.06, 0.01, 0.00]],
  [1.68, [-1.06, 0.43, 5.04], [-0.09, 0.01, 0.00]],
  [2.32, [-0.63, 0.42, 7.35], [-0.09, 0.00, 0.00]],
  [2.91, [ 0.10, 0.32, 10.37], [0.03, 0.00, 0.40]],
  [3.47, [ 0.40, 0.39, 12.65], [0.24, -0.04, 2.60]],
  [4.15, [ 0.23, 0.58, 13.97], [0.86, -0.17, 7.48]],
  [4.81, [-0.18, 0.48, 13.81], moon],
  [5.85, [-0.44, 0.38, 12.22], moon],
  [7.00, [-0.52, 0.28, 11.57], moon]
];
const sub = (a,b) => a.map((v,i) => v-b[i]);
const add = (a,b) => a.map((v,i) => v+b[i]);
const mul = (a,k) => a.map(v => v*k);
const dot = (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const clamp = (x,a=0,b=1) => Math.max(a,Math.min(b,x));
function unit(a) {const n=Math.hypot(...a)||1;return a.map(x=>x/n);}
function rotY([x,y,z],a){return [Math.cos(a)*x+Math.sin(a)*z,y,-Math.sin(a)*x+Math.cos(a)*z];}
function rotZ([x,y,z],a){return [Math.cos(a)*x-Math.sin(a)*y,Math.sin(a)*x+Math.cos(a)*y,z];}
function value(t,slot) {
  const i=Math.max(0,timeline.findIndex((v,j)=>j<timeline.length-1&&t<=timeline[j+1][0]));
  const a=timeline[i],b=timeline[i+1],lo=timeline[Math.max(0,i-1)],hi=timeline[Math.min(timeline.length-1,i+2)];
  const span=b[0]-a[0],s=clamp((t-a[0])/span),s2=s*s,s3=s2*s;
  return a[slot].map((v,k)=>{
    const p=i===0 ? .54*(b[slot][k]-v) : span*(b[slot][k]-lo[slot][k])/(b[0]-lo[0]);
    const q=i===timeline.length-2 ? 0 : span*(hi[slot][k]-v)/(hi[0]-a[0]);
    return (2*s3-3*s2+1)*v+(s3-2*s2+s)*p+(-2*s3+3*s2)*b[slot][k]+(s3-s2)*q;
  });
}
function shot(seconds) {
  const t=Math.min(seconds,duration);
  const eye=value(t,1),focus=value(t,2),forward=unit(sub(focus,eye));
  const east=unit(cross(forward,[0,1,0])),north=cross(east,forward);
  const bank=clamp((t-2.88)/2.82);
  const roll=-.022*Math.sin(t*.66)-.115*Math.pow(Math.sin(Math.PI*bank),2);
  const right=add(mul(east,Math.cos(roll)),mul(north,Math.sin(roll)));
  const up=cross(right,forward);
  const turn=clamp((t-2.85)/(duration-2.85));
  const spinRate=.99/(duration-2.85);
  const drift=0;
  const moonSpin=.43+1.98*turn*turn*(2.5-1.5*turn)+drift;
  return {t,eye,forward,right,up,moonSpin};
}

const vertex = `
attribute vec2 position;
varying vec2 uv;
void main(){uv=position;gl_Position=vec4(position,0.,1.);}
`;

const fragment = `
precision highp float;
varying vec2 uv;
uniform vec2 film;
uniform float time, moonSpin;
uniform vec3 eye, forward, right, up, sun, moon;
uniform sampler2D earthMap, moonMap, cloudMap, nightMap, moonRelief;
const float pi=3.14159265358979;
vec3 ry(vec3 p,float a){float c=cos(a),s=sin(a);return vec3(c*p.x+s*p.z,p.y,-s*p.x+c*p.z);}
vec3 rz(vec3 p,float a){float c=cos(a),s=sin(a);return vec3(c*p.x-s*p.y,s*p.x+c*p.y,p.z);}
vec2 mapUV(vec3 n){return vec2(.5-atan(n.z,n.x)/(2.*pi),acos(clamp(n.y,-1.,1.))/pi);}
vec3 linearColor(vec3 c){return pow(c,vec3(2.2));}
float hit(vec3 p,vec3 d,float r){
  float b=dot(p,d),q=b*b-dot(p,p)+r*r;
  if(q<0.)return -1.;
  float k=-b-sqrt(q);
  return k>0.?k:-1.;
}
float hash(vec2 p){
  vec3 q=fract(vec3(p.xyx)*.1031);
  q+=dot(q,q.yzx+33.33);
  return fract((q.x+q.y)*q.z);
}
vec3 stars(vec2 p,float density,float chance,float size){
  vec2 cell=floor(p*density),local=fract(p*density)-.5;
  float h=hash(cell+34.57);
  vec2 offset=(vec2(hash(cell+13.3),hash(cell+52.7))-.5)*.65;
  float distanceToStar=length(local-offset);
  float intensity=pow(clamp((h-chance)/(1.-chance),0.,1.),4.);
  float aa=max(fwidth(p.x),fwidth(p.y))*density;
  float core=exp(-pow(distanceToStar/max(size,aa*.53),2.)*2.5);
  vec3 tint=mix(vec3(.79,.88,1.),vec3(1.,.89,.77),hash(cell+72.3));
  return tint*intensity*core*min(1.,size/max(.015,aa*.43));
}
vec3 sky(vec3 d){
  vec2 p=mapUV(ry(rz(d,.39),1.43));
  vec3 c=vec3(.00010,.00013,.00020);
  c+=stars(p*vec2(1.,.62),1000.,.88,.040)*.11;
  c+=stars((p+.173)*vec2(1.,.70),331.,.90,.040)*.42;
  return c;
}
vec3 shadeEarth(vec3 n,vec3 ray){
  vec3 axis=rz(n,-.23);
  vec2 tex=mapUV(ry(axis,1.10+time*.125));
  vec3 raw=texture2D(earthMap,tex).rgb;
  vec3 base=linearColor(raw);
  float water=(1.-smoothstep(.063,.20,max(raw.r,raw.g)))*smoothstep(-.025,.03,raw.b-raw.r);
  base+=vec3(.007,.022,.045)*water;
  float ns=dot(n,sun),day=max(ns,0.),view=max(0.,dot(n,-ray));
  float light=.006+1.11*day;
  vec3 c=base*light;
  vec3 halfLight=normalize(sun-ray);
  c+=vec3(.44,.52,.61)*pow(max(dot(n,halfLight),0.),88.)*water*day*.27;
  float night=pow(texture2D(nightMap,tex).r,2.5);
  c+=vec3(.25,.128,.052)*night*(1.-smoothstep(-.25,-.03,ns));
  vec2 cloudUV=mapUV(ry(axis,1.109+time*.128));
  float cloud=smoothstep(.16,.96,texture2D(cloudMap,cloudUV).r)*.82;
  c=mix(c,vec3(.76,.81,.86)*(.004+day*.88),cloud);
  c+=vec3(.024,.078,.165)*pow(1.-view,3.)*(.025+.84*day);
  return c;
}
vec3 shadeMoon(vec3 n,vec3 ray){
  float spin=moonSpin;
  vec3 local=ry(rz(n,.10),spin);
  vec2 tex=mapUV(local);
  vec3 base=linearColor(texture2D(moonMap,tex).rgb);
  vec2 stepUV=vec2(.0015,.0023);
  float reliefX=texture2D(moonRelief,tex+vec2(stepUV.x,0.)).r-texture2D(moonRelief,tex-vec2(stepUV.x,0.)).r;
  float reliefY=texture2D(moonRelief,tex+vec2(0.,stepUV.y)).r-texture2D(moonRelief,tex-vec2(0.,stepUV.y)).r;
  vec3 tangent=normalize(vec3(-local.z,0.,local.x)+vec3(.0001,0.,0.));
  vec3 bitangent=normalize(cross(local,tangent));
  vec3 localNormal=normalize(local+tangent*reliefX*.42+bitangent*reliefY*.42);
  vec3 normal=rz(ry(localNormal,-spin),-.10);
  float d=max(dot(normal,sun),0.);
  float view=max(dot(n,-ray),0.);
  float scattering=d/(d+view+.09);
  float lighting=.004+d*.56+scattering*.64*smoothstep(0.,.11,d);
  return base*lighting*vec3(.98,1.,1.02);
}
void main(){
  vec3 ray=normalize(forward+right*uv.x*film.x+up*uv.y*film.y);
  vec3 col=sky(ray);
  float e=hit(eye,ray,1.),m=hit(eye-moon,ray,.65);
  bool showsEarth=e>0.&&(m<0.||e<m);
  if(m>0.&&!showsEarth)col=shadeMoon(normalize(eye+ray*m-moon),ray);
  if(showsEarth)col=shadeEarth(normalize(eye+ray*e),ray);
  float shell=hit(eye,ray,1.035);
  if(shell>0.&&(m<0.||shell<m)){
    vec3 nearPoint=eye+ray*shell;
    float tangent=length(eye-ray*dot(eye,ray));
    float daylight=.02+.98*smoothstep(-.22,.65,dot(normalize(nearPoint),sun));
    float rim=exp(-max(0.,tangent-1.)*144.)*smoothstep(.92,1.,tangent);
    rim*=1.-smoothstep(1.019,1.035,tangent);
    col+=vec3(.035,.11,.235)*rim*daylight*.30;
  }
  col=1.-exp(-col*1.29);
  col=pow(max(col,0.),vec3(.454545));
  col+=(hash(gl_FragCoord.xy)-.5)/255.;
  gl_FragColor=vec4(col,1.);
}
`;

function webgl(canvas,images){
  const gl=canvas.getContext('webgl',{alpha:false,antialias:false,depth:false,stencil:false,powerPreference:'high-performance'});
  if(!gl)throw Error('WebGL unavailable');
  const derivatives=gl.getExtension('OES_standard_derivatives');
  if(!derivatives)throw Error('Shader derivatives unavailable');
  const program=gl.createProgram();
  for(const [kind,source] of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,'#extension GL_OES_standard_derivatives : enable\n'+fragment]]){
    const shader=gl.createShader(kind);
    gl.shaderSource(shader,source);
    gl.compileShader(shader);
    if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader));
    gl.attachShader(program,shader);
  }
  gl.linkProgram(program);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  const p=gl.getAttribLocation(program,'position'),buffer=gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
  gl.enableVertexAttribArray(p);
  gl.vertexAttribPointer(p,2,gl.FLOAT,false,0,0);
  const names=['earthMap','moonMap','cloudMap','nightMap','moonRelief'];
  for(const [i,name] of names.entries()){
    const texture=gl.createTexture();
    gl.activeTexture(gl.TEXTURE0+i);
    gl.bindTexture(gl.TEXTURE_2D,texture);
    const bitmap=document.createElement('canvas');
    bitmap.width=images[i].naturalWidth;bitmap.height=images[i].naturalHeight;
    bitmap.getContext('2d').drawImage(images[i],0,0);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,bitmap);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.uniform1i(gl.getUniformLocation(program,name),i);
  }
  const loc=Object.fromEntries(['film','time','moonSpin','eye','forward','right','up','sun','moon'].map(k=>[k,gl.getUniformLocation(program,k)]));
  gl.uniform3fv(loc.sun,sun);
  gl.uniform3fv(loc.moon,moon);
  canvas.dataset.renderer='webgl';
  return (s,w,h,fx,fy)=>{
    gl.viewport(0,0,w,h);
    gl.uniform2f(loc.film,fx,fy);
    gl.uniform1f(loc.time,s.t);
    gl.uniform1f(loc.moonSpin,s.moonSpin);
    for(const k of ['eye','forward','right','up'])gl.uniform3fv(loc[k],s[k]);
    gl.drawArrays(gl.TRIANGLES,0,3);
  };
}

function software(canvas,images){
  const ctx=canvas.getContext('2d',{alpha:false});
  const maps=images.map(image=>{
    const copy=document.createElement('canvas');
    copy.width=image.naturalWidth;copy.height=image.naturalHeight;
    const c=copy.getContext('2d',{willReadFrequently:true});
    c.drawImage(image,0,0);
    return c.getImageData(0,0,copy.width,copy.height);
  });
  const surface=document.createElement('canvas'),pixels=surface.getContext('2d',{alpha:true});
  let seed=203190;
  const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
  const starlight=Array.from({length:8500},()=>{
    const y=random()*2-1,a=random()*Math.PI*2,r=Math.sqrt(1-y*y);
    return [[r*Math.cos(a),y,r*Math.sin(a)],Math.pow(random(),7),random()];
  });
  const toLinear=Float32Array.from({length:256},(_,i)=>Math.pow(i/255,2.2));
  const toDisplay=Uint8Array.from({length:4096},(_,i)=>Math.round(255*Math.pow(1-Math.exp(-i/4095*1.29),.4545)));
  function smooth(a,b,x){const q=clamp((x-a)/(b-a));return q*q*(3-2*q);}
  function row(z,r,a){
    const u=z*z-r*r;
    const b=r*Math.sqrt(a*a+u);
    return [(a*z-b)/u,(a*z+b)/u];
  }
  function sample(map,u,v,ch){
    const x=u*map.width-.5,y=clamp(v*map.height-.5,0,map.height-1);
    const xi=Math.floor(x),yi=Math.floor(y),fx=x-xi,fy=y-yi;
    const x0=xi&(map.width-1),x1=(xi+1)&(map.width-1),y1=Math.min(yi+1,map.height-1);
    const i=(yi*map.width+x0)*4+ch,j=(yi*map.width+x1)*4+ch;
    const k=(y1*map.width+x0)*4+ch,l=(y1*map.width+x1)*4+ch;
    const data=map.data;
    return Math.round((data[i]+(data[j]-data[i])*fx)*(1-fy)+(data[k]+(data[l]-data[k])*fx)*fy);
  }
  function globe(center,r,isEarth,s,w,h,fx,fy){
    const p=sub(center,s.eye),depth=dot(p,s.forward),bound=isEarth?1.035:r;
    if(depth<=-bound)return;
    const xr=depth>bound?row(depth,bound,dot(p,s.right)):[-fx,fx];
    const yr=depth>bound?row(depth,bound,dot(p,s.up)):[-fy,fy];
    const left=Math.max(0,Math.floor(w*(.5+xr[0]/(2*fx)))-1),top=Math.max(0,Math.floor(h*(.5-yr[1]/(2*fy)))-1);
    const gw=Math.min(w,Math.ceil(w*(.5+xr[1]/(2*fx)))+1)-left,gh=Math.min(h,Math.ceil(h*(.5-yr[0]/(2*fy)))+1)-top;
    if(gw<1||gh<1)return;
    surface.width=gw;surface.height=gh;
    const frame=pixels.createImageData(gw,gh),rgba=frame.data,pp=dot(p,p),r2=r*r;
    const spin=isEarth?1.10+s.t*.125:s.moonSpin,tilt=isEarth?-.23:.10;
    const ca=Math.cos(spin),sa=Math.sin(spin),ct=Math.cos(tilt),st=Math.sin(tilt);
    const map=maps[isEarth?0:1],sx=sun[0],sy=sun[1],sz=sun[2];
    const [fw0,fw1,fw2]=s.forward,[rt0,rt1,rt2]=s.right,[up0,up1,up2]=s.up;
    const [px,py,pz]=p;
    const xs=Float32Array.from({length:gw},(_,x)=>((x+left+.5)*2/w-1)*fx);
    const highQuality=s.t>=duration-.001;
    for(let y=0,k=0;y<gh;y++){
      const yv=(1-(y+top+.5)*2/h)*fy;
      const ox=fw0+up0*yv,oy=fw1+up1*yv,oz=fw2+up2*yv,rowSq=1+yv*yv;
      for(let x=0;x<gw;x++,k+=4){
        const xv=xs[x],inv=1/Math.sqrt(rowSq+xv*xv);
        const dx=(ox+rt0*xv)*inv,dy=(oy+rt1*xv)*inv,dz=(oz+rt2*xv)*inv;
        const b=px*dx+py*dy+pz*dz,q=b*b-pp+r2;
        if(b<=0)continue;
        if(q<0){
          if(isEarth&&q>-.072){
            const h=Math.sqrt(1-q)-1;
            const lit=clamp(((-px+dx*b)*sx+(-py+dy*b)*sy+(-pz+dz*b)*sz+.18)/.79);
            rgba[k]=48;rgba[k+1]=101;rgba[k+2]=166;rgba[k+3]=255*Math.exp(-h*125)*(.035+.57*lit);
          }
          continue;
        }
        const z=b-Math.sqrt(q);
        if(z<=0)continue;
        const nx=(dx*z-px)/r,ny=(dy*z-py)/r,nz=(dz*z-pz)/r;
        const ax=ct*nx-st*ny,ay=st*nx+ct*ny,lx=ca*ax+sa*nz,lz=-sa*ax+ca*nz;
        const u=.5-Math.atan2(lz,lx)/(2*Math.PI),v=Math.acos(clamp(ay,-1,1))/Math.PI;
        const view=Math.max(0,-nx*dx-ny*dy-nz*dz),ns=nx*sx+ny*sy+nz*sz;
        let day=Math.max(0,ns);
        if(!isEarth&&highQuality){
          const hm=maps[4],hx=(sample(hm,u+.0015,v,0)-sample(hm,u-.0015,v,0))/255;
          const hy=(sample(hm,u,v+.0023,0)-sample(hm,u,v-.0023,0))/255;
          day=Math.max(0,ns+.27*hx*(nx*sz-nz*sx)+.38*hy*(sy-ny*ns));
        }
        const light=isEarth?.006+1.11*day:.004+.56*day+.64*day/(day+view+.09)*smooth(0,.11,day);
        const tx=(Math.floor(u*map.width)+map.width)&(map.width-1),ty=Math.min(map.height-1,Math.floor(v*map.height));
        const at=(ty*map.width+tx)*4,data=map.data;
        const red=highQuality?sample(map,u,v,0):data[at];
        const green=highQuality?sample(map,u,v,1):data[at+1];
        const blue=highQuality?sample(map,u,v,2):data[at+2];
        if(isEarth){
          const water=(1-smooth(.063,.20,Math.max(red,green)/255))*smooth(-.025,.03,(blue-red)/255);
          const clouds=maps[2].data,lights=maps[3].data;
          const cloud=smooth(.16,.96,clouds[at]/255)*.82;
          const night=Math.pow(lights[at]/255,2.5)*(1-smooth(-.25,-.03,ns));
          const rim=(1-view)*(1-view)*(1-view)*(.025+.84*day);
          const sunOcean=water*day*Math.pow(Math.max(0,(nx*(sx-dx)+ny*(sy-dy)+nz*(sz-dz))/Math.sqrt(2-2*(sx*dx+sy*dy+sz*dz))),88)*.27;
          const diffuse=.004+.88*day;
          rgba[k]=toDisplay[clamp(((toLinear[red]+.007*water)*light*(1-cloud)+.76*diffuse*cloud+.024*rim+.25*night+.44*sunOcean)*4095|0,0,4095)];
          rgba[k+1]=toDisplay[clamp(((toLinear[green]+.022*water)*light*(1-cloud)+.81*diffuse*cloud+.078*rim+.128*night+.52*sunOcean)*4095|0,0,4095)];
          rgba[k+2]=toDisplay[clamp(((toLinear[blue]+.045*water)*light*(1-cloud)+.86*diffuse*cloud+.165*rim+.052*night+.61*sunOcean)*4095|0,0,4095)];
        }else{
          rgba[k]=toDisplay[clamp(toLinear[red]*light*.98*4095|0,0,4095)];
          rgba[k+1]=toDisplay[clamp(toLinear[green]*light*4095|0,0,4095)];
          rgba[k+2]=toDisplay[clamp(toLinear[blue]*light*1.02*4095|0,0,4095)];
        }
        rgba[k+3]=255;
      }
    }
    pixels.putImageData(frame,0,0);
    ctx.drawImage(surface,left,top);
  }
  canvas.dataset.renderer='canvas';
  return (s,w,h,fx,fy)=>{
    ctx.fillStyle='#040507';
    ctx.fillRect(0,0,w,h);
    const pixel=Math.min(w,h)/510;
    for(const [d,b,q] of starlight){
      const z=dot(d,s.forward);
      if(z<.56||b<.03)continue;
      const x=dot(d,s.right)/(z*fx),y=dot(d,s.up)/(z*fy);
      if(Math.abs(x)>1||Math.abs(y)>1)continue;
      ctx.fillStyle=q>.3?'#c5d4e8':'#efe1cf';
      ctx.globalAlpha=.05+.47*b;
      const size=(.55+b*.78)*pixel;
      ctx.fillRect((.5+x*.5)*w,(.5-y*.5)*h,size,size);
    }
    ctx.globalAlpha=1;
    globe([0,0,0],1,true,s,w,h,fx,fy);
    globe(moon,radius,false,s,w,h,fx,fy);
  };
}

function image(name){
  return new Promise((resolve,reject)=>{
    const img=new Image();
    img.onload=()=>resolve(img);
    img.onerror=reject;
    img.src='assets/'+name+'-nasa.jpg';
  });
}
let canvas=document.querySelector('#view');
const replay=document.querySelector('#replay');
const reduce=matchMedia('(prefers-reduced-motion: reduce)');
let draw,frame=0,elapsed=0,start=0,finished=false,images,lastPaint=-Infinity;
function paint(t){
  const width=window.innerWidth,height=window.innerHeight;
  const slow=canvas.dataset.renderer==='canvas';
  const cap=slow?(t>=duration?(reduce.matches?1600:1060):840):2000;
  const scale=Math.min(slow?1.15:1.75,devicePixelRatio,cap/Math.max(width,height));
  const w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale));
  if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
  const ratio=w/h,base=.395;
  const fy=base*Math.max(1,.83/ratio),fx=fy*ratio;
  draw(shot(t),w,h,fx,fy);
}
function end(){
  finished=true;
  replay.dataset.ended='';
  canvas.dataset.flight='complete';
}
function schedule(){
  if(draw&&!document.hidden&&!finished)frame=requestAnimationFrame(tick);
}
function tick(now){
  frame=0;
  const seconds=Math.max(0,(now-start)/1000);
  if(!finished&&seconds>=duration)end();
  elapsed=finished&&reduce.matches?duration:seconds;
  if(!finished||reduce.matches||now-lastPaint>=30){
    paint(elapsed);
    lastPaint=now;
  }
  schedule();
}
function begin(){
  cancelAnimationFrame(frame);
  finished=false;
  elapsed=0;
  delete replay.dataset.ended;
  canvas.dataset.flight='playing';
  start=performance.now();
  lastPaint=-Infinity;
  paint(0);
  schedule();
}
function replaceRenderer(){
  const next=canvas.cloneNode(false);
  canvas.replaceWith(next);
  canvas=next;
  draw=software(canvas,images);
}
Promise.all(['earth','moon','cloud','night','relief'].map(image)).then(assets=>{
  images=assets;
  try{draw=webgl(canvas,images);}catch{replaceRenderer();}
  canvas.addEventListener('webglcontextlost',event=>{
    event.preventDefault();
    replaceRenderer();
    paint(elapsed);
  },{once:true});
  if(reduce.matches){elapsed=duration;end();paint(elapsed);}else begin();
  canvas.classList.add('ready');
});
replay.addEventListener('click',()=>{if(draw&&finished)begin();});
window.addEventListener('resize',()=>{if(draw)paint(elapsed);});
document.addEventListener('visibilitychange',()=>{
  if(!draw)return;
  if(document.hidden){cancelAnimationFrame(frame);frame=0;}
  else{start=performance.now()-elapsed*1000;lastPaint=-Infinity;schedule();}
});
reduce.addEventListener('change',()=>{
  if(!draw||!finished)return;
  cancelAnimationFrame(frame);
  frame=0;
  if(reduce.matches)paint(elapsed);
  else{start=performance.now()-elapsed*1000;lastPaint=-Infinity;schedule();}
});
