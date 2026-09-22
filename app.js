import {VERSION,PALETTE,PRESETS,LightDetector,PulseTracker,clamp,median,noteFrequency,frequencyNote,colorNote,dominantFrequency,decodePatterns,normalizeSteps,sequenceTimeline} from './engine.js';

const $=id=>document.getElementById(id), video=$('source-video');
const view=$('view'),vctx=view.getContext('2d'),work=document.createElement('canvas'),wctx=work.getContext('2d',{willReadFrequently:true});
const demoCanvas=document.createElement('canvas');demoCanvas.width=640;demoCanvas.height=400;const dctx=demoCanvas.getContext('2d');
const detector=new LightDetector(),tracker=new PulseTracker();
const state={source:'none',name:'',running:false,stream:null,url:null,image:null,roi:null,previous:null,lastTargetTime:0,time:0,frames:0,dropped:0,lastPresented:null,light:[],blob:null,audio:null,raf:0,vfc:0,lastUI:0,lastCount:-1,lastMediaTime:-1,generation:0,snapshot:null,sessionStarted:null};
let toastTimer,saveAction,selectedStep=0,sequence=normalizeSteps(readStore('sequence',PRESETS.encounter.steps));
if(!sequence.length)sequence=structuredClone(PRESETS.encounter.steps);
let sessions=readStore('sessions',[]),patterns=readStore('patterns',[]);
if(!Array.isArray(sessions))sessions=[];if(!Array.isArray(patterns))patterns=[];
patterns=patterns.filter(p=>p&&typeof p.name==='string'&&normalizeSteps(p.steps).length).map(p=>({...p,steps:normalizeSteps(p.steps)}));
const audio={ctx:null,analyser:null,media:null,mic:null,demoInput:null,spectrum:null,voices:new Set(),output:null};
let transmission=null,wakeLock=null;

function readStore(key,fallback){try{return JSON.parse(localStorage.getItem('phactory-signal:'+key))??fallback;}catch{return fallback;}}
function writeStore(key,value){try{localStorage.setItem('phactory-signal:'+key,JSON.stringify(value));return true;}catch{toast('Device storage is unavailable or full. Export a backup.');return false;}}
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4500);}
function message(text,error=false){$('capture-message').textContent=text;$('capture-message').classList.toggle('error',error);}
function escapeText(text){return String(text??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function timecode(t){t=Math.max(0,t||0);return String(Math.floor(t/60)).padStart(2,'0')+':'+(t%60).toFixed(2).padStart(5,'0');}
function switchPage(name){if(!['scanner','composer','sessions'].includes(name))name='scanner';document.querySelectorAll('.page').forEach(p=>p.hidden=p.id!==name+'-page');document.querySelectorAll('[data-page]').forEach(b=>{const active=b.dataset.page===name;b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});if(name==='sessions')renderArchive();history.replaceState(null,'','#'+name);window.scrollTo({top:0,behavior:'instant'});}
document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>switchPage(b.dataset.page));
document.querySelector('.brand').onclick=e=>{e.preventDefault();switchPage('scanner');};
$('help').onclick=()=>$('guide-dialog').showModal();
document.querySelectorAll('.close-dialog').forEach(b=>b.onclick=()=>b.closest('dialog').close());
$('name-form').onsubmit=e=>{e.preventDefault();const name=$('item-name').value.trim();if(!name)return;saveAction?.(name);$('name-dialog').close();};
function nameItem(title,suggestion,fn){saveAction=fn;$('name-title').textContent=title;$('item-name').value=suggestion;$('name-dialog').showModal();$('item-name').focus();}

async function ensureAudio(){
  if(!audio.ctx){
    const Context=window.AudioContext||window.webkitAudioContext;if(!Context)throw new Error('Web Audio is unavailable in this browser.');
    audio.ctx=new Context();audio.analyser=audio.ctx.createAnalyser();audio.analyser.fftSize=8192;audio.analyser.smoothingTimeConstant=.2;
    audio.spectrum=new Float32Array(audio.analyser.frequencyBinCount);
    audio.output=audio.ctx.createGain();audio.output.gain.value=+$('volume').value/100*.4;audio.output.connect(audio.ctx.destination);
  }
  if(audio.ctx.state!=='running')await audio.ctx.resume();
  return audio.ctx;
}
function disconnectInput(){for(const key of ['media','mic','demoInput'])if(audio[key]){try{audio[key].disconnect();}catch{}}state.audio=null;}
function connectVideoAudio(){if(!audio.ctx)return;if(!audio.media)audio.media=audio.ctx.createMediaElementSource(video);audio.media.disconnect();audio.media.connect(audio.analyser);audio.media.connect(audio.ctx.destination);}
function sampleAudio(){if(!audio.ctx||!audio.analyser||!state.running)return null;audio.analyser.getFloatFrequencyData(audio.spectrum);return dominantFrequency(audio.spectrum,audio.ctx.sampleRate,audio.analyser.fftSize);}
function playTone(note,when,duration,{output=audio.output,input=null,volume=1}={}){
  const ctx=audio.ctx;if(!ctx)return;
  const osc=ctx.createOscillator(),gain=ctx.createGain();osc.type=$('synth-wave').value;osc.frequency.value=noteFrequency(note);osc.connect(gain);
  if(output)gain.connect(output);if(input)gain.connect(input);
  gain.gain.setValueAtTime(0,when);gain.gain.linearRampToValueAtTime(volume,when+.015);gain.gain.setValueAtTime(volume,Math.max(when+.016,when+duration-.035));gain.gain.linearRampToValueAtTime(0,when+duration);
  osc.start(when);osc.stop(when+duration+.02);audio.voices.add(osc);osc.onended=()=>{audio.voices.delete(osc);osc.disconnect();gain.disconnect();};return osc;
}
function stopVoices(){for(const osc of audio.voices){try{osc.stop();}catch{}}audio.voices.clear();}
async function requestWakeLock(){try{if('wakeLock'in navigator&&!wakeLock){const lock=await navigator.wakeLock.request('screen');if(state.running||transmission)wakeLock=lock;else await lock.release();}}catch{}}
function releaseWakeLock(){wakeLock?.release().catch(()=>{});wakeLock=null;}
function setRunning(running){state.running=running;$('stop-capture').disabled=!running;$('source-badge').classList.toggle('active',running);$('source-badge').textContent=running?({camera:'LIVE',video:'VIDEO',demo:'SYNTHETIC TEST'}[state.source]||'ACTIVE'):state.source==='image'?'STILL IMAGE':state.source==='none'?'STANDBY':'PAUSED';if(running)requestWakeLock();else if(!transmission)releaseWakeLock();}
function finishTrace(){tracker.finish(tracker.missing??state.time);renderResults();}
function haltCapture({release=true}={}){
  setRunning(false);cancelAnimationFrame(state.raf);if(state.vfc&&video.cancelVideoFrameCallback)video.cancelVideoFrameCallback(state.vfc);state.vfc=0;
  finishTrace();video.pause();$('play-pause').textContent='Play';
  if(release&&state.stream){state.stream.getTracks().forEach(t=>t.stop());state.stream=null;video.srcObject=null;}
  disconnectInput();stopVoices();
}
function resetTrace(){tracker.reset();state.frames=0;state.dropped=0;state.lastPresented=null;state.light=[];state.time=0;state.lastMediaTime=-1;state.previous=null;state.blob=null;state.audio=null;state.lastCount=-1;state.snapshot=null;state.sessionStarted=new Date().toISOString();renderResults();}
function resetSource(type,name){state.generation++;haltCapture();stopTransmission();if(state.url)URL.revokeObjectURL(state.url);state.url=null;video.removeAttribute('src');video.load();state.image=null;state.source=type;state.name=name;state.roi=null;resetTrace();$('idle-overlay').hidden=true;$('playback').hidden=type!=='video';$('source-badge').textContent=type==='image'?'STILL IMAGE':'READY';$('view-label').textContent=type==='demo'?'SYNTHETIC TEST SIGNAL':type==='camera'?'REAR CAMERA':name;$('view-label').title=name;drawBackground(vctx,960,600);return state.generation;}
function captureError(err){const known={NotAllowedError:'Camera or microphone access was denied. Allow access in Safari website settings, then try again.',NotFoundError:'No usable camera or microphone was found.',NotReadableError:'The camera is busy. Close other apps using it and try again.',OverconstrainedError:'This camera cannot use the requested mode.'};message(known[err.name]||err.message||'Could not open this media. Try an H.264 MP4 video or a JPEG photo.',true);}

$('camera').onclick=async()=>{
  const token=resetSource('camera','Live camera');message('Opening the rear camera…');
  try{
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('Camera access requires the hosted HTTPS app in Safari.');
    if($('microphone').checked)await ensureAudio();
    const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30,max:60}},audio:$('microphone').checked?{echoCancellation:false,noiseSuppression:false,autoGainControl:false}:false});
    if(token!==state.generation){stream.getTracks().forEach(t=>t.stop());return;}
    state.stream=stream;video.srcObject=stream;video.muted=true;
    if(stream.getAudioTracks().length&&audio.ctx){audio.mic=audio.ctx.createMediaStreamSource(stream);audio.mic.connect(audio.analyser);}
    await video.play();if(token!==state.generation)return;setRunning(true);startVideoFrames();
    message('Live analysis. Tap a light to isolate it. '+(stream.getAudioTracks().length?'Microphone is active.':'Microphone is off.'));
    stream.getVideoTracks()[0].addEventListener('ended',()=>{if(state.source==='camera'&&state.running){haltCapture();message('Camera stopped. Tap Use camera to reopen it.');}});
  }catch(err){if(token!==state.generation)return;haltCapture();captureError(err);}
};
$('microphone').onchange=()=>{if(state.source==='camera'&&state.running)toast('Restart the camera to apply the microphone setting.');};
$('import').onclick=()=>$('media-file').click();
$('media-file').onchange=async e=>{
  const file=e.target.files[0];e.target.value='';if(!file)return;
  const image=/^image\//.test(file.type)||/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name);
  const movie=/^video\//.test(file.type)||/\.(mp4|mov|m4v|webm)$/i.test(file.name);
  if(!image&&!movie){message('Choose a video or image file.',true);return;}
  const token=resetSource(image?'image':'video',file.name);state.url=URL.createObjectURL(file);message('Opening '+file.name+'…');
  if(image){
    const img=new Image();img.onload=()=>{if(token!==state.generation)return;state.image=img;processFrame(img,0,false);setRunning(false);state.snapshot=state.blob?{rgb:state.blob.rgb,hex:rgbHexSafe(state.blob.rgb),mappedNote:colorNote(state.blob.rgb)?.note||null}:null;renderResults();message('Still image: color measurement only. Tap to choose a region; photos have no pulse timing.');};
    img.onerror=()=>{if(token===state.generation)message('This image format could not be decoded. Export it as JPEG or PNG and try again.',true);};img.src=state.url;
  }else{
    try{await ensureAudio();}catch{toast('Audio analysis unavailable; video analysis still works.');}
    if(token!==state.generation)return;
    video.src=state.url;video.muted=false;video.volume=.55;
    video.onloadedmetadata=()=>{if(token!==state.generation)return;$('seek').max=Number.isFinite(video.duration)?video.duration:0;$('duration-label').textContent=timecode(video.duration).slice(0,5);message('Video ready. Press Play to analyze its frames and soundtrack.');};
    video.onloadeddata=()=>{if(token===state.generation&&!state.running)processFrame(video,video.currentTime,false);};
    video.load();
  }
};
video.addEventListener('error',()=>{if(state.source==='video'&&video.getAttribute('src')){haltCapture();message('Safari could not decode this video. Try an H.264/AAC MP4 export.',true);}});
video.addEventListener('ended',()=>{if(state.source==='video'){state.time=video.duration;haltCapture({release:false});message('Clip complete. Review the signal log or save this session.');}});
video.addEventListener('pause',()=>{if(state.source==='video'&&state.running)haltCapture({release:false});});
async function resumeVideo(){if(state.source!=='video')return;try{await ensureAudio();connectVideoAudio();if(video.ended){video.currentTime=0;resetTrace();}await video.play();setRunning(true);$('play-pause').textContent='Pause';startVideoFrames();message('Analyzing video and soundtrack during playback. Tap a light to focus.');}catch(err){captureError(err);}}
$('play-pause').onclick=()=>state.running?haltCapture({release:false}):resumeVideo();
$('restart').onclick=()=>{if(state.source!=='video')return;haltCapture({release:false});video.currentTime=0;resetTrace();resumeVideo();};
$('seek').oninput=()=>{if(state.source!=='video')return;haltCapture({release:false});resetTrace();video.currentTime=+$('seek').value;message('New trace at this position. Press Play to analyze.');};
video.addEventListener('seeked',()=>{if(state.source==='video'&&!state.running)processFrame(video,video.currentTime,false);});
$('stop-capture').onclick=()=>{state.generation++;haltCapture();message('Capture stopped. Measurements are ready to save or export.');};

function startVideoFrames(){
  if(state.vfc&&video.cancelVideoFrameCallback)video.cancelVideoFrameCallback(state.vfc);cancelAnimationFrame(state.raf);
  let lastCallback=performance.now();
  if(video.requestVideoFrameCallback){
    const onFrame=(now,meta)=>{if(!state.running)return;lastCallback=now;if(state.lastPresented!==null)state.dropped+=Math.max(0,meta.presentedFrames-state.lastPresented-1);state.lastPresented=meta.presentedFrames;if(meta.mediaTime>state.lastMediaTime){processFrame(video,meta.mediaTime,true);state.lastMediaTime=meta.mediaTime;}state.vfc=video.requestVideoFrameCallback(onFrame);};state.vfc=video.requestVideoFrameCallback(onFrame);
  }
  // Fallback for browsers that pause frame callbacks for an occluded video element.
  const watchdog=()=>{if(!state.running)return;if((!video.requestVideoFrameCallback||performance.now()-lastCallback>200)&&video.readyState>=2&&video.currentTime>state.lastMediaTime){processFrame(video,video.currentTime,true);state.lastMediaTime=video.currentTime;}state.raf=requestAnimationFrame(watchdog);};state.raf=requestAnimationFrame(watchdog);
}
function drawBackground(ctx,w,h){ctx.fillStyle='#060d12';ctx.fillRect(0,0,w,h);ctx.strokeStyle='#14303755';ctx.lineWidth=.5;for(let x=32;x<w;x+=48){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();}for(let y=24;y<h;y+=48){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}for(let i=0;i<80;i++){const x=(i*199+17)%w,y=(i*107+29)%h;ctx.fillStyle=i%3?'#45627555':'#9ab6bc55';ctx.fillRect(x,y,1,1);}}
let drawRect={x:0,y:0,w:960,h:600};
function processFrame(source,time,record=true){
  const sw=source.videoWidth||source.naturalWidth||source.width,sh=source.videoHeight||source.naturalHeight||source.height;if(!sw||!sh)return;
  const scale=Math.min(320/sw,320/sh,1),ww=Math.max(1,Math.round(sw*scale)),wh=Math.max(1,Math.round(sh*scale));if(work.width!==ww||work.height!==wh){work.width=ww;work.height=wh;}
  wctx.drawImage(source,0,0,ww,wh);
  let result;try{result=detector.analyze(wctx.getImageData(0,0,ww,wh),{threshold:+$('threshold').value,minPixels:3,roi:state.roi,previous:state.previous});}catch(err){haltCapture();message('Could not read this media frame: '+err.message,true);return;}
  state.time=time;state.blob=result.target;
  if(result.target){state.previous=result.target;state.lastTargetTime=time;}
  else if(time-state.lastTargetTime>1.5)state.previous=null;
  state.audio=record?sampleAudio():null;
  if(record){state.frames++;tracker.update(time,result.target,state.audio);state.light.push(result.target?Math.max(...result.target.rgb)/255:0);if(state.light.length>220)state.light.shift();}
  const displayScale=Math.min(view.width/sw,view.height/sh);drawRect={w:sw*displayScale,h:sh*displayScale,x:(view.width-sw*displayScale)/2,y:(view.height-sh*displayScale)/2};
  vctx.fillStyle='#03080c';vctx.fillRect(0,0,view.width,view.height);vctx.drawImage(source,drawRect.x,drawRect.y,drawRect.w,drawRect.h);
  if(state.roi){const r=state.roi;vctx.strokeStyle='#b4e4d388';vctx.setLineDash([8,6]);vctx.lineWidth=1.5;vctx.strokeRect(drawRect.x+clamp(r.x-r.radius,0,1)*drawRect.w,drawRect.y+clamp(r.y-r.radius,0,1)*drawRect.h,(Math.min(1,r.x+r.radius)-Math.max(0,r.x-r.radius))*drawRect.w,(Math.min(1,r.y+r.radius)-Math.max(0,r.y-r.radius))*drawRect.h);vctx.setLineDash([]);}
  for(const blob of result.blobs.slice(0,8)){const selected=blob===result.target,b=blob.box;vctx.strokeStyle=selected?'#91ffda':'#7da0b366';vctx.lineWidth=selected?2:1;vctx.strokeRect(drawRect.x+b.x*drawRect.w-5,drawRect.y+b.y*drawRect.h-5,b.w*drawRect.w+10,b.h*drawRect.h+10);if(selected){vctx.font='12px monospace';vctx.fillStyle='#b5f6e1';vctx.fillText('TRACK 01',drawRect.x+b.x*drawRect.w-5,Math.max(54,drawRect.y+b.y*drawRect.h-13));}}
  if(performance.now()-state.lastUI>90||!record){state.lastUI=performance.now();updateReadouts();drawGraphs();if(tracker.events.length!==state.lastCount)renderResults();}
}
function rgbHexSafe(rgb){return '#'+rgb.map(v=>Math.round(v).toString(16).padStart(2,'0')).join('');}
$('view').onclick=e=>{if(state.source==='none')return;const r=view.getBoundingClientRect(),x=(e.clientX-r.left)/r.width*view.width,y=(e.clientY-r.top)/r.height*view.height;if(x<drawRect.x||x>drawRect.x+drawRect.w||y<drawRect.y||y>drawRect.y+drawRect.h)return;state.roi={x:(x-drawRect.x)/drawRect.w,y:(y-drawRect.y)/drawRect.h,radius:.17};state.previous=null;finishTrace();if(state.source==='image')refreshImage();toast('Detection region selected. Reset target restores the full frame.');};
function refreshImage(){if(!state.image)return;processFrame(state.image,0,false);state.snapshot=state.blob?{rgb:state.blob.rgb,hex:rgbHexSafe(state.blob.rgb),mappedNote:colorNote(state.blob.rgb)?.note||null}:null;renderResults();}
$('reset-target').onclick=()=>{state.roi=null;state.previous=null;finishTrace();refreshImage();toast('Scanning the full frame.');};
$('threshold').oninput=()=>{$('threshold-value').textContent=$('threshold').value+' / 255';state.previous=null;refreshImage();};

$('demo').onclick=async()=>{
  const token=resetSource('demo','Synthetic five-tone test');
  try{await ensureAudio();}catch(err){message('Test will run without audio: '+err.message);}
  if(token!==state.generation)return;
  const schedule=sequenceTimeline(PRESETS.encounter.steps),base=(audio.ctx?.currentTime||performance.now()/1000)+.7;
  if(audio.ctx){audio.demoInput=audio.ctx.createGain();audio.demoInput.connect(audio.analyser);schedule.steps.forEach(s=>playTone(s.note,base+s.start,s.duration,{input:audio.demoInput,volume:.65}));}
  setRunning(true);message('Synthetic test: five colored pulses and generated tones, processed through the same detector.');
  const loop=()=>{if(!state.running||state.source!=='demo')return;const t=(audio.ctx?.currentTime||performance.now()/1000)-base,step=schedule.steps.find(s=>t>=s.start&&t<s.end);drawBackground(dctx,640,400);dctx.fillStyle='#0a1821';dctx.beginPath();dctx.moveTo(0,365);for(let x=0;x<=640;x+=40)dctx.lineTo(x,320+Math.sin(x*.014)*21);dctx.lineTo(640,400);dctx.lineTo(0,400);dctx.fill();if(step){const x=320+Math.sin(t*.15)*20,y=175;const glow=dctx.createRadialGradient(x,y,3,x,y,68);glow.addColorStop(0,step.color+'99');glow.addColorStop(1,step.color+'00');dctx.fillStyle=glow;dctx.fillRect(x-68,y-68,136,136);dctx.fillStyle=step.color;dctx.beginPath();dctx.arc(x,y,12,0,Math.PI*2);dctx.fill();}processFrame(demoCanvas,t+.7,true);if(t>schedule.duration+.5){haltCapture();message('Test complete. These are synthetic measurements. Try your camera or import a video.');return;}state.raf=requestAnimationFrame(loop);};state.raf=requestAnimationFrame(loop);
};
$('demo-again').onclick=()=>$('demo').click();

function updateReadouts(){
  const b=state.blob,n=state.audio;const mapped=b?colorNote(b.rgb):null;
  $('timecode').textContent=timecode(state.time);$('frame-count').textContent=state.frames+' FRAMES';
  $('target-status').textContent=b?(b.clipped>.15?'TARGET FOUND · COLOR CLIPPING':'TARGET LOCKED · 01'):state.source==='none'?'AWAITING INPUT':'SEARCHING FOR LIGHT';
  $('audio-note').textContent=n?.note||'—';$('frequency').textContent=n?Math.round(n.hz).toString():'—';$('solfege').textContent=n?(PALETTE.find(p=>p.name===n.note.replace(/[0-9]/g,''))?.solfege.toUpperCase()||'CHROMATIC')+(n.cents>0?' +':' ')+n.cents+'¢':state.source==='image'?'STILL IMAGE':'NO TONE';
  $('rgb-label').textContent=b?`R ${b.rgb[0]}  G ${b.rgb[1]}  B ${b.rgb[2]}`:'R —  G —  B —';$('color-swatch').style.background=b?rgbHexSafe(b.rgb):'#23353d';$('mapped-note').textContent=mapped?mapped.note:'—';$('intensity-value').textContent=b?Math.round(Math.max(...b.rgb)/255*100)+'%':'—';
  if(state.source==='video')$('seek').value=video.currentTime;
  const interval=median(tracker.intervals)*1000;$('timing-quality').textContent=interval?`~${interval.toFixed(0)} ms/frame · ${state.dropped} missed`:'Timing resolution —';
}
function graphBase(canvas){const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;ctx.clearRect(0,0,w,h);ctx.strokeStyle='#29434b77';ctx.lineWidth=1;for(let y=h/4;y<h;y+=h/4){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}for(let x=0;x<w;x+=w/12){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();}return {ctx,w,h};}
function drawGraphs(){
  let {ctx,w,h}=graphBase($('spectrum'));
  if(audio.spectrum&&state.running){const bins=audio.spectrum,step=audio.ctx.sampleRate/audio.analyser.fftSize;for(let j=0;j<60;j++){const lo=Math.floor(65*(4000/65)**(j/60)/step),hi=Math.max(lo+1,Math.floor(65*(4000/65)**((j+1)/60)/step));let db=-100;for(let i=lo;i<hi;i++)db=Math.max(db,bins[i]||-100);const level=clamp((db+85)/75,0,1);ctx.fillStyle=j%5===0?'#a4f6d5':'#65c9bc';ctx.globalAlpha=.4+level*.6;ctx.fillRect(j*w/60,h-level*(h-8),w/60-3,Math.max(1,level*(h-8)));}ctx.globalAlpha=1;}
  ({ctx,w,h}=graphBase($('waveform')));ctx.beginPath();const values=state.light;values.forEach((v,i)=>{const x=i/219*w,y=h-7-v*(h-18);if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);});if(!values.length){ctx.moveTo(0,h/2);ctx.lineTo(w,h/2);}ctx.strokeStyle='#78dfca';ctx.lineWidth=2;ctx.stroke();
  ({ctx,w,h}=graphBase($('timeline')));const events=tracker.events,total=Math.max(state.time,events.at(-1)?.end||0,5);ctx.font='12px monospace';ctx.fillStyle='#6c8a94';for(let i=0;i<=4;i++)ctx.fillText((total*i/4).toFixed(1)+'s',12+i*(w-50)/4,h-8);
  events.forEach(e=>{const x=12+e.start/total*(w-30),bw=Math.max(2,e.duration/total*(w-30));ctx.fillStyle=e.hex;ctx.globalAlpha=.78;ctx.fillRect(x,22,bw,h-52);});ctx.globalAlpha=1;
  if(!events.length){ctx.font='14px monospace';ctx.fillStyle='#55717b';ctx.fillText('NO PULSES RECORDED',20,55);}
}
function renderResults(){
  state.lastCount=tracker.events.length;$('pulse-count').textContent=tracker.events.length+' PULSES';
  $('dictionary-count').textContent=4+patterns.length+' REFERENCES';
  const has=tracker.events.length>0||!!state.snapshot;['save-session','export-json','export-csv'].forEach(id=>$(id).disabled=!has);$('copy-response').disabled=!tracker.events.some(e=>e.audioNote||e.mappedNote);
  $('event-log').innerHTML=tracker.events.length?tracker.events.slice(-150).map(e=>`<tr><td>${String(e.index).padStart(2,'0')}</td><td>${e.start.toFixed(3)} s</td><td>${Math.round(e.duration*1000)} ms</td><td><i class="inline-swatch" style="background:${e.hex}"></i>${e.rgb.join(' / ')}</td><td>${e.audioNote||'—'}</td><td>${e.mappedNote||'—'}</td></tr>`).join(''):'<tr><td colspan="6" class="empty-table">'+(state.source==='image'?'A still image contains no pulse sequence.':'Your detected pulses will appear here.')+'</td></tr>';
  const matches=decodePatterns(tracker.events,patterns);
  $('matches').innerHTML=matches.length?matches.map(m=>`<div class="match-card"><span class="overline">${escapeText(m.type)}</span><h3>${escapeText(m.name)}</h3><p>${escapeText(m.detail)}</p></div>`).join('')+'<p>Pattern similarity does not establish the signal’s meaning or source.</p>':`<div class="decoder-icon">⌁</div><h3>${state.source==='image'?'One frame, one observation':tracker.events.length?'No reference match yet':'Listening for structure'}</h3><p>${state.source==='image'?'A video is needed to measure flashes, rhythm, and audio.':tracker.events.length?'Capture a complete sequence. A lack of a match does not imply an unusual source.':'Capture a sequence to compare its notes, rhythm, and pulse groups.'}</p>`;
  if(tracker.limitReached)message('The 3,000-pulse session limit was reached. Stop and export before starting a new trace.',true);
  drawGraphs();
}
function sessionData(name=state.name){return {schema:'phactory-signal/session-v1',appVersion:VERSION,name,source:state.source,sourceName:state.name,synthetic:state.source==='demo',createdAt:state.sessionStarted||new Date().toISOString(),savedAt:new Date().toISOString(),frames:state.frames,missedPresentedFrames:state.dropped,timingResolutionMs:Math.round(median(tracker.intervals)*1000),threshold:+$('threshold').value,roi:state.roi,snapshot:state.snapshot,events:structuredClone(tracker.events),matches:decodePatterns(tracker.events,patterns),notes:'RGB values are decoded pixel samples, not optical wavelengths. Timing is frame-limited. Color-note mappings are conventions. FFT notes use a prominent frequency, not guaranteed fundamental pitch.'};}
function download(name,text,type='application/json'){const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function filename(prefix,ext){return prefix+'-'+new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')+'.'+ext;}
function exportSession(s){download(filename('signal-session','json'),JSON.stringify(s,null,2));}
$('export-json').onclick=()=>exportSession(sessionData());
$('export-csv').onclick=()=>{const columns=['pulse','start_s','duration_s','red','green','blue','audio_note','audio_hz','mapped_note','timing_resolution_ms','clipped_fraction'];const rows=tracker.events.map(e=>[e.index,e.start,e.duration,...e.rgb,e.audioNote||'',e.audioHz||'',e.mappedNote||'',e.timingResolutionMs,e.clippedFraction]);if(state.snapshot)rows.push(['','','',...state.snapshot.rgb,'','',state.snapshot.mappedNote||'','','']);download(filename('signal-pulses','csv'),[columns,...rows].map(r=>r.join(',')).join('\r\n'),'text/csv');};
$('save-session').onclick=()=>nameItem('Name this session',state.source==='demo'?'Five-tone test':state.name||'New observation',name=>{const next=[{...sessionData(name),id:crypto.randomUUID?.()||Date.now().toString()},...sessions].slice(0,25);if(writeStore('sessions',next)){sessions=next;toast('Session saved on this device.');}});
$('copy-response').onclick=()=>{sequence=normalizeSteps(tracker.events.filter(e=>e.audioNote||e.mappedNote).map((e,i,all)=>({note:e.audioNote||e.mappedNote,color:e.hex,duration:e.duration,gap:all[i+1]?all[i+1].start-e.end:.35})));selectedStep=0;renderSequence();switchPage('composer');toast('Response created. Output timing is limited to at least 250 ms on and off.');};

// Sequencer and reference dictionary.
$('pads').innerHTML=PALETTE.map((p,i)=>`<button class="pad" data-pad="${i}" style="--pad:${p.hex}" aria-label="Play and add ${p.note}, ${p.solfege}"><strong>${p.name}</strong><span>${p.solfege.toUpperCase()}</span></button>`).join('');
document.querySelectorAll('[data-pad]').forEach(b=>b.onclick=async()=>{if(sequence.length>=32){toast('A sequence can hold up to 32 steps.');return;}const p=PALETTE[+b.dataset.pad];try{await ensureAudio();if(state.running)haltCapture();stopTransmission();playTone(p.note,audio.ctx.currentTime+.015,.4);}catch(err){toast(err.message);}sequence.push({note:p.note,color:p.hex,duration:.65,gap:.35});selectedStep=sequence.length-1;renderSequence();b.classList.add('active');setTimeout(()=>b.classList.remove('active'),230);});
for(let octave=2;octave<=6;octave++)for(const note of ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']){const option=document.createElement('option');option.value=note+octave;option.textContent=note+octave;$('step-note').append(option);}
$('presets').innerHTML=Object.entries(PRESETS).map(([key,p])=>`<button class="preset" data-preset="${key}"><span class="preset-bars">${p.steps.slice(0,5).map(s=>`<i style="background:${s.color}"></i>`).join('')}</span><span><strong>${p.name}</strong><small>${p.description}</small></span><span>↗</span></button>`).join('');
document.querySelectorAll('[data-preset]').forEach(b=>b.onclick=()=>{sequence=structuredClone(PRESETS[b.dataset.preset].steps);selectedStep=0;renderSequence();toast(PRESETS[b.dataset.preset].name+' loaded.');});
function renderSequence(){
  sequence=normalizeSteps(sequence);if(selectedStep>=sequence.length)selectedStep=Math.max(0,sequence.length-1);$('step-count').textContent=sequence.length+' STEPS';
  $('sequence').innerHTML=sequence.length?sequence.map((s,i)=>`<button class="sequence-step ${i===selectedStep?'selected':''}" data-step="${i}" style="--step:${s.color}" aria-label="Edit step ${i+1}, ${s.note}" aria-pressed="${i===selectedStep}"><small>${String(i+1).padStart(2,'0')}</small><b>${s.note}</b><span>${Math.round(s.duration*1000)} ms</span></button>`).join(''):'<p class="empty-sequence">Tap a colored key to add your first step.</p>';
  document.querySelectorAll('[data-step]').forEach(b=>b.onclick=()=>{selectedStep=+b.dataset.step;renderSequence();});
  $('step-editor').hidden=!sequence.length;['broadcast','preview','save-pattern'].forEach(id=>$(id).disabled=!sequence.length);
  const s=sequence[selectedStep];if(s){$('edit-label').textContent='EDIT STEP '+String(selectedStep+1).padStart(2,'0');$('step-note').value=s.note;$('step-color').value=s.color;$('step-duration').value=Math.round(s.duration*1000);$('step-gap').value=Math.round(s.gap*1000);$('move-left').disabled=selectedStep===0;$('move-right').disabled=selectedStep===sequence.length-1;}
  writeStore('sequence',sequence);
}
for(const id of ['step-note','step-color','step-duration','step-gap'])$(id).onchange=()=>{const s=sequence[selectedStep];if(!s)return;s.note=$('step-note').value;s.color=$('step-color').value;s.duration=clamp(+$('step-duration').value/1000,.25,4);s.gap=clamp(+$('step-gap').value/1000,.25,4);renderSequence();};
$('remove-step').onclick=()=>{sequence.splice(selectedStep,1);renderSequence();};
$('move-left').onclick=()=>{if(selectedStep<1)return;[sequence[selectedStep-1],sequence[selectedStep]]=[sequence[selectedStep],sequence[selectedStep-1]];selectedStep--;renderSequence();};
$('move-right').onclick=()=>{if(selectedStep>=sequence.length-1)return;[sequence[selectedStep+1],sequence[selectedStep]]=[sequence[selectedStep],sequence[selectedStep+1]];selectedStep++;renderSequence();};
$('clear-sequence').onclick=()=>{sequence=[];renderSequence();};
$('volume').oninput=()=>{$('volume-value').textContent=$('volume').value+'%';if(audio.output)audio.output.gain.setTargetAtTime(+$('volume').value/100*.4,audio.ctx.currentTime,.02);};
$('save-pattern').onclick=()=>nameItem('Name your shared pattern','My light greeting',name=>{if(patterns.length>=30){toast('Your dictionary can hold 30 patterns. Remove one before saving.');return;}const next=[...patterns,{id:crypto.randomUUID?.()||Date.now().toString(),name,steps:structuredClone(sequence)}];if(writeStore('patterns',next)){patterns=next;renderResults();toast('Pattern saved. Share your dictionary with the receiver.');}});
$('broadcast').onclick=()=>{$('broadcast-summary').textContent=sequence.length+' steps · '+(sequenceTimeline(sequence,+$('repeat').value).duration).toFixed(1)+' seconds';$('broadcast-dialog').showModal();};
$('preview').onclick=()=>{if(transmission)stopTransmission();else beginTransmission(false);};
$('start-broadcast').onclick=()=>{$('broadcast-dialog').close();beginTransmission(true);};
$('stop-broadcast').onclick=()=>stopTransmission();
async function beginTransmission(light){
  try{await ensureAudio();}catch(err){toast(err.message);return;}
  haltCapture();stopTransmission();const schedule=sequenceTimeline(sequence,+$('repeat').value);if(!schedule.steps.length)return;
  const base=audio.ctx.currentTime+(light?1:.08);transmission={light,schedule,base,raf:0,lastIndex:-1};
  if(light){$('transmission').hidden=false;$('light-field').style.transition=$('soft-light').checked?'background-color 110ms linear':'none';$('stop-broadcast').focus();try{const p=$('transmission').requestFullscreen?.();p?.catch(()=>{});}catch{}}
  else $('preview').textContent='■ Stop preview';
  requestWakeLock();schedule.steps.forEach(s=>playTone(s.note,base+s.start,s.duration));
  const tick=()=>{if(!transmission)return;const t=audio.ctx.currentTime-base,step=schedule.steps.find(s=>t>=s.start&&t<s.end);if(light){$('light-field').style.background=step?step.color:'#000';$('transmit-note').textContent=t<0?'Ready':step?.note||'·';$('transmit-progress').textContent=t<0?'Starting in 1 second':`${Math.max(0,t).toFixed(1)} / ${schedule.duration.toFixed(1)} seconds`;}
    document.querySelectorAll('[data-step]').forEach(b=>b.classList.toggle('playing',!!step&&+b.dataset.step===step.index));if(t>=schedule.duration){stopTransmission();toast('Transmission complete.');return;}transmission.raf=requestAnimationFrame(tick);};transmission.raf=requestAnimationFrame(tick);
}
function stopTransmission(){if(transmission){cancelAnimationFrame(transmission.raf);transmission=null;stopVoices();releaseWakeLock();}const wasOpen=!$('transmission').hidden;$('transmission').hidden=true;$('light-field').style.background='#000';$('preview').innerHTML='<svg><use href="#i-play"/></svg> Preview sound';document.querySelectorAll('.playing').forEach(b=>b.classList.remove('playing'));if(wasOpen){if(document.fullscreenElement)document.exitFullscreen?.().catch(()=>{});$('broadcast').focus();}}
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&transmission){e.preventDefault();stopTransmission();}});
document.addEventListener('fullscreenchange',()=>{if(transmission?.light&&!document.fullscreenElement)stopTransmission();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){state.generation++;haltCapture();stopTransmission();audio.ctx?.suspend().catch(()=>{});}});
window.addEventListener('pagehide',()=>{state.generation++;haltCapture();stopTransmission();});

function renderArchive(){
  $('saved-count').textContent=sessions.length+' SESSIONS';
  $('sessions-list').innerHTML=sessions.length?sessions.map((s,i)=>`<div class="archive-item"><h3>${escapeText(s.name)}</h3><p>${new Date(s.savedAt).toLocaleString()} · ${s.events?.length||0} pulses${s.synthetic?' · Synthetic test':''}</p><div class="mini-sequence">${(s.events||[]).slice(0,24).map(e=>`<i style="background:${/^#[a-f0-9]{6}$/i.test(e.hex)?e.hex:'#7ee9d2'}"></i>`).join('')}</div><div class="inline-actions"><button class="text-button" data-session-export="${i}">Export JSON</button><button class="text-button" data-session-load="${i}">Review</button><button class="text-button danger-text" data-session-delete="${i}">Delete</button></div></div>`).join(''):'<div class="archive-empty"><svg><use href="#i-folder"/></svg><h3>Your field notes start here.</h3><p>Capture a signal, then save the session to revisit its measurements.</p></div>';
  $('patterns-list').innerHTML=patterns.length?patterns.map((p,i)=>`<div class="archive-item"><h3>${escapeText(p.name)}</h3><p>${p.steps.length} steps · ${p.steps.map(s=>s.note).join(' · ')}</p><div class="inline-actions"><button class="text-button" data-pattern-load="${i}">Load in deck</button><button class="text-button danger-text" data-pattern-delete="${i}">Delete</button></div></div>`).join(''):'<div class="archive-empty"><svg><use href="#i-wave"/></svg><h3>Make a shared language.</h3><p>Save a response as a reference pattern, then export your dictionary.</p></div>';
  document.querySelectorAll('[data-session-export]').forEach(b=>b.onclick=()=>exportSession(sessions[+b.dataset.sessionExport]));
  document.querySelectorAll('[data-session-load]').forEach(b=>b.onclick=()=>{const s=sessions[+b.dataset.sessionLoad];resetSource('archive',s.name);tracker.events=structuredClone(s.events||[]);state.source=s.source;state.frames=s.frames;state.dropped=s.missedPresentedFrames||0;state.snapshot=s.snapshot;state.time=tracker.events.at(-1)?.end||0;state.sessionStarted=s.createdAt;$('source-badge').textContent='SAVED SESSION';$('idle-overlay').hidden=false;$('idle-overlay').querySelector('p').textContent='Session restored.';$('idle-overlay').querySelector('span').textContent='Measurements restored; the original media is not stored.';if(s.timingResolutionMs)tracker.intervals=[s.timingResolutionMs/1000];$('playback').hidden=true;renderResults();updateReadouts();switchPage('scanner');message('Saved measurements restored. Original media is not retained.');});
  document.querySelectorAll('[data-session-delete]').forEach(b=>b.onclick=()=>{if(!confirm('Delete this saved session from this device? Export it first if you need a backup.'))return;const next=sessions.filter((_,i)=>i!==+b.dataset.sessionDelete);if(writeStore('sessions',next)){sessions=next;renderArchive();}});
  document.querySelectorAll('[data-pattern-load]').forEach(b=>b.onclick=()=>{sequence=structuredClone(patterns[+b.dataset.patternLoad].steps);selectedStep=0;renderSequence();switchPage('composer');});
  document.querySelectorAll('[data-pattern-delete]').forEach(b=>b.onclick=()=>{if(!confirm('Delete this dictionary pattern?'))return;const next=patterns.filter((_,i)=>i!==+b.dataset.patternDelete);if(writeStore('patterns',next)){patterns=next;renderArchive();renderResults();}});
}
$('export-patterns').onclick=()=>download('phactory-signal-dictionary.json',JSON.stringify({schema:'phactory-signal/dictionary-v1',patterns},null,2));
$('import-patterns').onclick=()=>$('pattern-file').click();
$('pattern-file').onchange=async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;if(file.size>1_000_000){toast('Choose a dictionary smaller than 1 MB.');return;}try{const data=JSON.parse(await file.text());if(data.schema!=='phactory-signal/dictionary-v1'||!Array.isArray(data.patterns))throw new Error('Choose an exported Phactory Signal dictionary.');const incoming=data.patterns.slice(0,30).map(p=>({id:crypto.randomUUID?.()||Math.random().toString(36),name:String(p.name||'Imported pattern').slice(0,60),steps:normalizeSteps(p.steps)})).filter(p=>p.steps.length);if(!incoming.length)throw new Error('No valid patterns were found.');const next=[...patterns,...incoming].slice(0,30);if(writeStore('patterns',next)){patterns=next;renderArchive();renderResults();toast('Dictionary imported; '+patterns.length+' custom patterns available.');}}catch(err){toast(err.message||'Could not import this dictionary.');}};

drawBackground(vctx,960,600);renderSequence();renderResults();renderArchive();switchPage(location.hash.slice(1)||'scanner');
if('serviceWorker'in navigator&&(location.protocol==='https:'||location.hostname==='localhost'||location.hostname==='127.0.0.1'))navigator.serviceWorker.register('./sw.js').catch(()=>{});
