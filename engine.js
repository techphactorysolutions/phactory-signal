/* Phactory Signal — pure signal processing; no network or browser dependencies. */
export const VERSION = '1.0.0';
export const PALETTE = [
  { name: 'C', note: 'C4', solfege: 'Do', hex: '#ff667a' },
  { name: 'D', note: 'D4', solfege: 'Re', hex: '#ffb564' },
  { name: 'E', note: 'E4', solfege: 'Mi', hex: '#ffd972' },
  { name: 'F', note: 'F4', solfege: 'Fa', hex: '#60dfbd' },
  { name: 'G', note: 'G3', solfege: 'Sol', hex: '#58cded' },
  { name: 'A', note: 'A4', solfege: 'La', hex: '#7886ff' },
  { name: 'B', note: 'B4', solfege: 'Ti', hex: '#cf85ef' }
];
const NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
export const clamp = (v,a,b) => Math.min(b,Math.max(a,v));
export const median = a => { const s=[...a].sort((x,y)=>x-y); return s.length ? s[Math.floor(s.length/2)] : 0; };
export function noteFrequency(note) {
  const match = /^([A-G]#?)([0-8])$/.exec(note || '');
  if (!match || !NAMES.includes(match[1])) return null;
  const midi = (+match[2]+1)*12+NAMES.indexOf(match[1]);
  return 440*2**((midi-69)/12);
}
export function frequencyNote(hz) {
  if (!Number.isFinite(hz) || hz <= 0) return null;
  const exact = 69+12*Math.log2(hz/440), midi=Math.round(exact);
  return { note:NAMES[((midi%12)+12)%12]+(Math.floor(midi/12)-1), cents:Math.round((exact-midi)*100), hz };
}
export const hexRGB = h => [1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
export const rgbHex = rgb => '#'+rgb.map(n=>Math.round(clamp(n,0,255)).toString(16).padStart(2,'0')).join('');
export function hue(rgb) {
  const [r,g,b] = rgb.map(n=>n/255), max=Math.max(r,g,b), min=Math.min(r,g,b), d=max-min;
  if (d<0.001) return {h:0,s:0,v:max};
  let h=max===r?(g-b)/d:max===g?2+(b-r)/d:4+(r-g)/d;
  return {h:(h*60+360)%360,s:d/max,v:max};
}
export function colorNote(rgb, palette=PALETTE) {
  const c=hue(rgb);
  if(c.s<0.15) return null;
  return palette.reduce((best,p)=> {
    const angle=Math.abs(c.h-hue(hexRGB(p.hex)).h), distance=Math.min(angle,360-angle);
    return distance<best.distance?{...p,distance}:best;
  },{distance:Infinity});
}
export function dominantFrequency(db, sampleRate, fftSize) {
  const step=sampleRate/fftSize, lo=Math.max(2,Math.ceil(65/step)), hi=Math.min(db.length-2,Math.floor(4000/step));
  let peak=lo;
  for(let i=lo;i<=hi;i++) if(db[i]>db[peak]) peak=i;
  if(!Number.isFinite(db[peak]) || db[peak]<-65) return null;
  const floor=median(Array.from(db.slice(lo,hi+1)).filter(Number.isFinite));
  if(db[peak]-floor<12) return null;
  const a=db[peak-1], b=db[peak], c=db[peak+1], den=a-2*b+c;
  const offset=Number.isFinite(den)&&Math.abs(den)>1e-9 ? clamp(.5*(a-c)/den,-.5,.5):0;
  return {...frequencyNote((peak+offset)*step),db:b,resolutionHz:step};
}

/** Bright connected components in decoded camera RGB. This is not object recognition. */
export class LightDetector {
  analyze({data,width:w,height:h},{threshold=165,minPixels=3,roi=null,previous=null}={}) {
    const n=w*h;
    if(this.size!==n) {this.size=n;this.mask=new Uint8Array(n);this.queue=new Int32Array(n);}
    const mask=this.mask;mask.fill(0);
    const x0=roi?Math.floor(clamp(roi.x-roi.radius,0,1)*w):0, x1=roi?Math.ceil(clamp(roi.x+roi.radius,0,1)*w):w;
    const y0=roi?Math.floor(clamp(roi.y-roi.radius,0,1)*h):0, y1=roi?Math.ceil(clamp(roi.y+roi.radius,0,1)*h):h;
    for(let y=y0;y<y1;y++) for(let x=x0;x<x1;x++) {
      const i=y*w+x,j=i*4;
      if(Math.max(data[j],data[j+1],data[j+2])>=threshold) mask[i]=1;
    }
    const blobs=[];
    for(let i=0;i<n;i++) {
      if(mask[i]!==1)continue;
      let head=0,tail=1,count=0,sx=0,sy=0,r=0,g=0,b=0,clipped=0,minX=w,minY=h,maxX=0,maxY=0;
      this.queue[0]=i; mask[i]=2;
      while(head<tail) {
        const p=this.queue[head++],x=p%w,y=Math.floor(p/w),j=p*4;
        count++;sx+=x;sy+=y;r+=data[j];g+=data[j+1];b+=data[j+2];
        if(Math.max(data[j],data[j+1],data[j+2])>=250)clipped++;
        minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
        const visit=q=>{if(mask[q]===1){mask[q]=2;this.queue[tail++]=q;}};
        if(x>0)visit(p-1);if(x<w-1)visit(p+1);if(y>0)visit(p-w);if(y<h-1)visit(p+w);
      }
      if(count>=minPixels) blobs.push({x:sx/count/w,y:sy/count/h,area:count,rgb:[r,g,b].map(v=>Math.round(v/count)),clipped:clipped/count,box:{x:minX/w,y:minY/h,w:(maxX-minX+1)/w,h:(maxY-minY+1)/h}});
    }
    blobs.sort((a,b)=>b.area-a.area);
    let target=blobs[0]||null;
    if(previous && !roi) {
      const nearby=blobs.map(b=>({b,d:Math.hypot(b.x-previous.x,b.y-previous.y)})).filter(x=>x.d<.18).sort((a,b)=>a.d-b.d);
      target=nearby[0]?.b||null;
    }
    return {target,blobs:blobs.slice(0,30)};
  }
}

export class PulseTracker {
  constructor(){this.reset();}
  reset(){this.events=[];this.active=null;this.missing=null;this.previousTime=null;this.intervals=[];this.limitReached=false;}
  update(time,blob,audio=null) {
    if(this.previousTime!==null) {
      if(time<this.previousTime) this.finish(this.previousTime);
      const dt=time-this.previousTime;
      if(dt>0&&dt<.5){this.intervals.push(dt);if(this.intervals.length>90)this.intervals.shift();}
    }
    this.previousTime=time;
    if(blob) {
      if(this.active) {
        const a=hue(this.active.rgb.map(v=>v/this.active.samples)),b=hue(blob.rgb),d=Math.abs(a.h-b.h);
        if(a.s>.25&&b.s>.25&&Math.min(d,360-d)>28) this.finish(time);
      }
      if(this.missing!==null && time-this.missing>=.055) this.finish(this.missing);
      this.missing=null;
      if(!this.active)this.active={start:time,last:time,rgb:[0,0,0],samples:0,notes:{},frequencies:[],clipped:0};
      const a=this.active;a.last=time;a.samples++;a.clipped+=blob.clipped;
      blob.rgb.forEach((v,i)=>a.rgb[i]+=v);
      if(audio) {a.notes[audio.note]=(a.notes[audio.note]||0)+1;a.frequencies.push(audio.hz);}
    } else if(this.active) {
      if(this.missing===null)this.missing=time;
      if(time-this.missing>=.055)this.finish(this.missing);
    }
  }
  finish(time) {
    const a=this.active;
    if(a&&time-a.start>=.045&&a.samples>=2) {
      const rgb=a.rgb.map(v=>Math.round(v/a.samples));
      const notes=Object.entries(a.notes).sort((a,b)=>b[1]-a[1]);
      const measured=notes[0]&&notes[0][1]>=2?notes[0][0]:null;
      if(this.events.length<3000)this.events.push({index:this.events.length+1,start:+a.start.toFixed(4),end:+time.toFixed(4),duration:+(time-a.start).toFixed(4),rgb,hex:rgbHex(rgb),mappedNote:colorNote(rgb)?.note||null,audioNote:measured,audioHz:measured?+median(a.frequencies).toFixed(2):null,samples:a.samples,clippedFraction:+(a.clipped/a.samples).toFixed(3),timingResolutionMs:+(median(this.intervals)*1000).toFixed(1)});
      else this.limitReached=true;
    }
    this.active=null;this.missing=null;
  }
}

export const MORSE = {A:'.-',B:'-...',C:'-.-.',D:'-..',E:'.',F:'..-.',G:'--.',H:'....',I:'..',J:'.---',K:'-.-',L:'.-..',M:'--',N:'-.',O:'---',P:'.--.',Q:'--.-',R:'.-.',S:'...',T:'-',U:'..-',V:'...-',W:'.--',X:'-..-',Y:'-.--',Z:'--..','0':'-----','1':'.----','2':'..---','3':'...--','4':'....-','5':'.....','6':'-....','7':'--...','8':'---..','9':'----.'};
export function morseSequence(message,unit=.3) {
  const out=[];
  [...message.toUpperCase()].forEach(letter=>{
    if(letter===' '){if(out.length)out.at(-1).gap=unit*7;return;}
    const code=MORSE[letter];if(!code)return;
    [...code].forEach((c,i)=>out.push({note:'C4',color:'#ff667a',duration:unit*(c==='-'?3:1),gap:unit*(i===code.length-1?3:1)}));
  });return out;
}
export const PRESETS = {
  encounter: { name:'Five-tone greeting',description:'D · E · C · C · G — cinematic reference',steps:['D4','E4','C4','C3','G3'].map(n=>({note:n,color:PALETTE.find(p=>p.name===n[0]).hex,duration:.65,gap:.35})) },
  sos: {name:'SOS',description:'International Morse · · · — — — · · ·',steps:morseSequence('SOS')},
  hello: {name:'Hello',description:'HELLO in International Morse',steps:morseSequence('HELLO')},
  primes: {name:'Prime numbers',description:'Pulse groups of 2, 3, 5 and 7',steps:[2,3,5,7].flatMap(n=>Array.from({length:n},(_,i)=>({note:'G3',color:'#58cded',duration:.3,gap:i===n-1?1.2:.3})))}
};
export function decodeMorse(events) {
  if(events.length<3)return null;
  const ds=events.map(e=>e.duration),unit=median([...ds].sort((a,b)=>a-b).slice(0,Math.max(1,Math.ceil(ds.length*.55))));
  if(unit<=0)return null;
  const ratios=ds.map(d=>d/unit);
  if(ratios.some(r=>Math.min(Math.abs(r-1),Math.abs(r-3))>.7))return null;
  const reverse=Object.fromEntries(Object.entries(MORSE).map(([k,v])=>[v,k]));
  let code='',letters=[],codes=[];
  events.forEach((e,i)=>{
    code+=ratios[i]>=2?'-':'.';
    const gap=i<events.length-1?events[i+1].start-e.end:Infinity;
    if(gap>=unit*2){letters.push(reverse[code]||'?');codes.push(code);code='';if(gap>=unit*5.5&&Number.isFinite(gap))letters.push(' ');}
  });
  if(letters.includes('?'))return null;
  return {text:letters.join(''),code:codes.join(' '),unit};
}
const pitchClass = n => n?.replace(/[0-9-]/g,'');
export function decodePatterns(events,custom=[]) {
  const results=[];
  if(!events.length)return results;
  const candidates=[{name:'Five-tone greeting',steps:PRESETS.encounter.steps},...custom];
  for(const p of candidates) {
    if(!p.steps?.length||events.length!==p.steps.length)continue;
    const measured=events.every(e=>e.audioNote);
    const notes=events.map(e=>pitchClass(measured?e.audioNote:e.mappedNote));
    const wanted=p.steps.map(s=>pitchClass(s.note));
    const rhythms=events.map((e,i)=>e.duration/p.steps[i].duration),scale=median(rhythms);
    const colorMatch=events.every((e,i)=>{const a=hue(e.rgb),b=hue(hexRGB(p.steps[i].color));if(a.s<.15||b.s<.15)return a.s<.15&&b.s<.15;const d=Math.abs(a.h-b.h);return Math.min(d,360-d)<12;});
    const gapMatch=events.slice(0,-1).every((e,i)=>{const actual=events[i+1].start-e.end,expected=p.steps[i].gap*scale;return Math.abs(actual-expected)<Math.max(.12,expected*.45);});
    if((measured?notes.every((n,i)=>n&&n===wanted[i]):colorMatch)&&rhythms.every(r=>Math.abs(r/scale-1)<.4)&&gapMatch)results.push({name:p.name,type:measured?'Audio-note pattern':'Mapped-color pattern',detail:(measured?notes:wanted).join(' · ')+(measured?' · prominent audio notes':' · this reference’s color-to-note convention'),strength:measured?'Notes + rhythm':'Colors + rhythm'});
  }
  const mono=events.every(e=>e.mappedNote===events[0].mappedNote);
  if(mono) {
    const morse=decodeMorse(events);
    if(morse)results.push({name:morse.text==='SOS'?'SOS pattern':morse.text==='HELLO'?'Hello in Morse':`Morse candidate: ${morse.text}`,type:'Pulse-duration pattern',detail:morse.code+' · timing-based candidate',strength:'Rhythm match'});
    const unit=median(events.map(e=>e.duration)),groups=[1];
    events.slice(1).forEach((e,i)=>{if(e.start-events[i].end>unit*2.3)groups.push(1);else groups[groups.length-1]++;});
    if(JSON.stringify(groups)==='[2,3,5,7]')results.push({name:'Prime-number groups',type:'Pulse-count pattern',detail:'2 · 3 · 5 · 7 pulses',strength:'Group-count match'});
  }
  return results;
}
export function normalizeSteps(steps) {
  if(!Array.isArray(steps))return [];
  return steps.slice(0,32).filter(s=>noteFrequency(s.note)&&/^#[a-f0-9]{6}$/i.test(s.color)).map(s=>({note:s.note,color:s.color,duration:clamp(Number(s.duration)||.65,.25,4),gap:clamp(Number(s.gap)||.35,.25,4)}));
}
export function sequenceTimeline(steps,repeat=1) {
  let time=0;const result=[];
  for(let r=0;r<clamp(repeat,1,5);r++)steps.forEach((s,i)=>{result.push({...s,index:i,start:time,end:time+s.duration});time+=s.duration+s.gap;});
  return {steps:result,duration:time};
}
