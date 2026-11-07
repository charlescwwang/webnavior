// Frozen algorithm oracle from the user-supplied v4 page; test-only.

/* UMA-8 Spatial Competition + Spatial Gate, streaming DSP.
   Port of validate_spatial_gate.py. Processing input: 48kHz, 7 usable channels.
   Output: 16kHz, single-channel mask and gate. No speaker output.
   IMPORTANT: CH1=mic0 .. CH7=mic6, 45 mm radius are unverified assumptions.
*/
export class SpatialEngine {
  constructor(onOutput = null) {
    this.fsIn = 48000; this.fs = 16000; this.N = 512; this.H = 256;
    this.channels = 7; this.onOutput = onOutput;
    this.frontAngles = [-10,-5,0,5,10];
    this.otherAngles = [-90,-60,-45,45,60,90,180];
    this.angles = this.frontAngles.concat(this.otherAngles);
    this.frontCount = this.frontAngles.length;
    this.front0Index = this.frontAngles.indexOf(0);
    this.window = Float64Array.from({length:512},(_,i)=>0.5-0.5*Math.cos(2*Math.PI*i/512));
    this.bitrev = new Uint16Array(512);
    for(let i=0;i<512;i++){let v=i,r=0;for(let j=0;j<9;j++){r=(r<<1)|(v&1);v>>=1;}this.bitrev[i]=r;}
    this.fftR = new Float64Array(512); this.fftI = new Float64Array(512);
    this.downScratch = new Float64Array(7);
    this.normReScratch = new Float64Array(7);
    this.normImScratch = new Float64Array(7);
    this.spectraRScratch = Array.from({length:7},()=>new Float64Array(257));
    this.spectraIScratch = Array.from({length:7},()=>new Float64Array(257));
    this.phaseR = new Float64Array(this.angles.length*7*257);this.phaseI=new Float64Array(this.angles.length*7*257);
    const micXY=[[0,0],[-.045,0],[-.0225,.045*Math.sqrt(3)/2],[.0225,.045*Math.sqrt(3)/2],[.045,0],[.0225,-.045*Math.sqrt(3)/2],[-.0225,-.045*Math.sqrt(3)/2]];
    for(let a=0;a<this.angles.length;a++){
      let rad=this.angles[a]*Math.PI/180,dx=Math.sin(rad),dy=-Math.cos(rad);
      for(let m=0;m<7;m++){
        const tau=(micXY[m][0]*dx+micXY[m][1]*dy)/343;
        for(let f=0;f<257;f++){
          let phase=-2*Math.PI*(f*16000/512)*tau;
          let p=(a*7+m)*257+f;
          this.phaseR[p]=Math.cos(phase);this.phaseI[p]=Math.sin(phase);
        }
      }
    }
    const gauss=sigma=>{let rad=Math.round(4*sigma),a=[];for(let i=-rad;i<=rad;i++)a.push(Math.exp(-.5*(i/sigma)**2));let s=a.reduce((u,v)=>u+v,0);return Float64Array.from(a.map(v=>v/s));};
    this.gf=gauss(1.4);this.gt=gauss(.9);
    // Polyphase-compatible decimator (scipy.signal.resample_poly, 48k -> 16k).
    const i0=x=>{let v=1,sum=1;for(let k=1;k<24;k++){v*=x*x/(4*k*k);sum+=v;if(v<1e-15*sum)break;}return sum;};
    const h=[];let hs=0;for(let j=-30;j<=30;j++){
      const t=j/30,win=i0(5*Math.sqrt(Math.max(0,1-t*t)))/i0(5);
      const v=(j===0?1/3:Math.sin(Math.PI*j/3)/(Math.PI*j))*win;
      h.push(v);hs+=v;
    }
    this.fir=Float64Array.from(h.map(x=>x/hs));
    this.ring48=Array.from({length:7},()=>new Float32Array(128));
    this.ring16=Array.from({length:7},()=>new Float32Array(1024));
    this.samples48=0;this.samples16=0;
    this.frames=[];this.masks=[];this.hard=[];
    this.didMask=0;this.didHard=0;this.didSynth=0;
    this.gateSegments=[];this.gateCursor=0;this.runStart=-1;this.activeGateSegment=-1;
    this.capacity=32768;
    this.accMask=new Float64Array(this.capacity);this.accGate=new Float64Array(this.capacity);this.norm=new Float64Array(this.capacity);
    this.raw16=new Float32Array(this.capacity);
    this.finalized=0;this.sent=0;this.gatedOn=0;this.numGatedFrames=0;this.finalFrameCount=0;
    this.final=false;this.workMs=0;this.workMaxMs=0;this.computeCalls=0;
  }
  _ensureCapacity(n){if(n<=this.capacity)return;let cap=this.capacity;while(cap<n)cap*=2;for(const prop of ['accMask','accGate','norm','raw16']){let src=this[prop];let a=prop==='raw16'?new Float32Array(cap):new Float64Array(cap);a.set(src);this[prop]=a;}this.capacity=cap;}
  _fft(inverse=false){const re=this.fftR,im=this.fftI,bit=this.bitrev;for(let i=0;i<512;i++){let j=bit[i];if(j>i){let t=re[i];re[i]=re[j];re[j]=t;t=im[i];im[i]=im[j];im[j]=t;}}
    for(let size=2;size<=512;size*=2){let half=size/2,ang=(inverse?2:-2)*Math.PI/size;let ur=Math.cos(ang),ui=Math.sin(ang);for(let offset=0;offset<512;offset+=size){let wr=1,wi=0;for(let j=0;j<half;j++){
      let u=offset+j,v=u+half,vr=re[v]*wr-im[v]*wi,vi=re[v]*wi+im[v]*wr,tr=re[u],ti=im[u];
      re[u]=tr+vr;im[u]=ti+vi;re[v]=tr-vr;im[v]=ti-vi;
      let nr=wr*ur-wi*ui;wi=wr*ui+wi*ur;wr=nr;
    }}}
    if(inverse){for(let i=0;i<512;i++){re[i]/=512;im[i]/=512;}}
  }
  /** Block of 7 or 8 Float32Array channels (48 kHz). */
  push(block){if(this.final)throw Error('引擎已結束');if(block.length<7)throw Error('需至少 7 聲道');let n=block[0].length;for(let ch=1;ch<7;ch++)if(block[ch].length!==n)throw Error('聲道取樣數不一致');
    for(let j=0;j<n;j++){
      let idx=this.samples48;
      for(let ch=0;ch<7;ch++)this.ring48[ch][idx%128]=block[ch][j];
      this.samples48++;let center=idx-30;
      if(center>=0 && center%3===0){let down=this.downScratch;
        for(let ch=0;ch<7;ch++){let sum=0,ring=this.ring48[ch];for(let offset=-30;offset<=30;offset++){let p=center+offset;if(p>=0)sum+=this.fir[offset+30]*ring[p%128];}down[ch]=sum;}
        this._one16(down);
      }
    }
  }
  _one16(vals){let pos=this.samples16;this._ensureCapacity(pos+2048);
    for(let ch=0;ch<7;ch++)this.ring16[ch][pos%1024]=vals[ch];
    this.raw16[pos]=vals[5];this.samples16++;
    if(pos>=255 && (pos-255)%256===0){let center=pos-255;this._computeFrame(center);}
  }
  _computeFrame(center){
    const spectraR=this.spectraRScratch,spectraI=this.spectraIScratch;
    for(let ch=0;ch<7;ch++){
      for(let j=0;j<512;j++){let p=center-256+j;this.fftR[j]=p<0?0:this.ring16[ch][p%1024]*this.window[j];this.fftI[j]=0;}
      this._fft();for(let f=0;f<257;f++){spectraR[ch][f]=this.fftR[f]/256;spectraI[ch][f]=this.fftI[f]/256;}
    }
    let mf=new Float64Array(257),dif=new Float64Array(257),w=new Float64Array(257),frontR=new Float64Array(257),frontI=new Float64Array(257);
    let dNum=0,dDen=0;
    for(let f=0;f<257;f++){
      const normRe=this.normReScratch,normIm=this.normImScratch;
      let power=0;
      for(let ch=0;ch<7;ch++){let r=spectraR[ch][f],i=spectraI[ch][f];let mag=Math.hypot(r,i);normRe[ch]=r/(mag+1e-12);normIm[ch]=i/(mag+1e-12);power+=r*r+i*i;}
      let bestF=-100,bestO=-100;
      for(let a=0;a<this.angles.length;a++){
        let sr=0,si=0,sq=0,bfr=0,bfi=0;
        for(let ch=0;ch<7;ch++){
          const p=(a*7+ch)*257+f,pr=this.phaseR[p],pi=this.phaseI[p];
          const re=normRe[ch]*pr-normIm[ch]*pi,im=normRe[ch]*pi+normIm[ch]*pr;
          sr+=re;si+=im;sq+=normRe[ch]*normRe[ch]+normIm[ch]*normIm[ch];
          if(a===this.front0Index){bfr+=spectraR[ch][f]*pr-spectraI[ch][f]*pi;bfi+=spectraR[ch][f]*pi+spectraI[ch][f]*pr;}
        }
        if(a===this.front0Index){frontR[f]=bfr/7;frontI[f]=bfi/7;}
        let coh=(sr*sr+si*si-sq)/42;
        if(a<this.frontCount){if(coh>bestF)bestF=coh;}else if(coh>bestO)bestO=coh;
      }
      dif[f]=bestF-bestO;mf[f]=dif[f]>0?1:0;w[f]=Math.sqrt(power);
      if(f>=7 && f<=121){dNum+=w[f]*dif[f];dDen+=w[f];}
    }
    // Gaussian on frequency axis, with scipy.ndimage reflect boundary.
    let fm=new Float64Array(257);
    for(let f=0;f<257;f++){let s=0;for(let o=-6;o<=6;o++)s+=mf[this._reflect(f+o,257)]*this.gf[o+6];fm[f]=s;}
    this.frames.push({fm,frontR,frontI,w,d:dNum/(dDen+1e-12)});
    this._pipeline(false);
  }
  _reflect(i,n){while(i<0||i>=n){if(i<0)i=-i-1;else i=2*n-1-i;}return i;}
  _pipeline(atEnd){
    const n=this.frames.length;
    // Smoothing mask at current frame requires 4 future STFT frames.
    while(this.didMask<n && (atEnd||this.didMask+4<n)){
      let k=this.didMask++,center=this.frames[k],smooth=new Float64Array(257),numer=0,den=0;
      for(let f=0;f<257;f++){
        let val=0;for(let off=-4;off<=4;off++){let ix=this._reflect(k+off,n);val+=this.gt[off+4]*this.frames[ix].fm[f];}
        smooth[f]=val;
        if(f>=7 && f<=121){let wf=center.w[f];numer+=wf*val;den+=wf;}
      }
      this.masks[k]={freq:smooth,m:numer/(den+1e-12)};
    }
    while(this.didHard<this.didMask && (atEnd||this.didHard+3<this.didMask)){
      let k=this.didHard++,d=0,m=0;
      for(let off=-3;off<=3;off++){let ix=this._reflect(k+off,n);d+=this.frames[ix].d/7;m+=this.masks[ix].m/7;}
      this.hard[k]=d>-.10 && m>.055;this._acceptHard(k,this.hard[k]);
    }
    // 6 future hard decisions guarantee pre-roll, min-on, hangover, edge fades.
    while(this.didSynth<this.didHard && (atEnd||this.didSynth+24<this.didHard)){
      const k=this.didSynth++,gain=this._gateAt(k),frame=this.frames[k];
      this.gatedOn+=gain>0?1:0;this.numGatedFrames++;this._synthFrame(k,frame,this.masks[k].freq,gain);
    }
    if(atEnd){this._emitReady(this.samples16);}
  }
  _acceptHard(k,on){
    if(!on){this.runStart=-1;this.activeGateSegment=-1;return;}
    if(this.runStart<0)this.runStart=k;
    if(k-this.runStart+1<3)return;
    const left=Math.max(0,this.runStart-6),right=k+20;
    const segs=this.gateSegments;
    if(this.activeGateSegment<0){
      if(segs.length && left<=segs[segs.length-1][1]){
        this.activeGateSegment=segs.length-1;
        segs[this.activeGateSegment][1]=Math.max(segs[this.activeGateSegment][1],right);
      }else{segs.push([left,right]);this.activeGateSegment=segs.length-1;}
    }else segs[this.activeGateSegment][1]=Math.max(segs[this.activeGateSegment][1],right);
  }
  _gateAt(k){
    const segs=this.gateSegments;
    while(this.gateCursor<segs.length && segs[this.gateCursor][1]<=k)this.gateCursor++;
    const seg=segs[this.gateCursor];
    if(!seg||k<seg[0])return 0;
    const [a,b]=seg,r=Math.min(2,b-a);
    let g=1;
    if(k<a+r)g*=(k-a+1)/(r+1);
    if(k>=b-r)g*=(b-k)/(r+1);
    return g;
  }
  _synthFrame(k,frame,mask,gain){
    let {frontR,frontI}=frame;
    for(let f=0;f<257;f++){this.fftR[f]=frontR[f]*mask[f];this.fftI[f]=frontI[f]*mask[f];}
    for(let f=257;f<512;f++){this.fftR[f]=this.fftR[512-f];this.fftI[f]=-this.fftI[512-f];}
    this._fft(true);
    const start=k*256-256;
    this._ensureCapacity(start+1024);
    for(let j=0;j<512;j++){let ix=start+j;if(ix<0||ix>=this.capacity)continue;
      let hann=this.window[j],v=this.fftR[j]*256*hann;
      this.accMask[ix]+=v;this.accGate[ix]+=this.raw16[ix]*hann*hann*gain;this.norm[ix]+=hann*hann;
    }
    this.finalFrameCount++;
    this._emitReady(Math.min(this.samples16,k*256));
  }
  _emitReady(end){end=Math.max(this.finalized,Math.min(end,this.samples16));this.finalized=end;
    // Run short chunks during the recording; avoid accumulating all output until stop.
    while(this.onOutput && (this.finalized-this.sent>=2048 || (this.final && this.sent<this.finalized))){let n=Math.min(2048,this.finalized-this.sent),raw=new Float32Array(n),mask=new Float32Array(n),gate=new Float32Array(n);
      for(let j=0;j<n;j++){let ix=this.sent+j,inv=this.norm[ix]>1e-12?1/this.norm[ix]:0;
        raw[j]=this.raw16[ix];mask[j]=this.accMask[ix]*inv;gate[j]=this.accGate[ix]*inv;
      }
      this.sent+=n;this.onOutput({raw,mask,gate});
    }
  }
  finish(){if(this.final)return;this.final=true;const true48=this.samples48;this.outputLength=Math.ceil(true48/3);
    // Pad the 48 kHz decimator to include all valid 16 kHz output centers.
    const final16=Math.ceil(true48/3);
    for(let p=0;this.samples16<final16&&p<64;p++){
      const idx=this.samples48;for(let ch=0;ch<7;ch++)this.ring48[ch][idx%128]=0;this.samples48++;
      let center=idx-30;
      if(center>=0 && center%3===0){let down=this.downScratch;for(let ch=0;ch<7;ch++){
        let s=0,ring=this.ring48[ch];for(let off=-30;off<=30;off++){let sample=center+off;if(sample>=0)s+=this.fir[off+30]*ring[sample%128];}down[ch]=s;
      }this._one16(down);}
    }
    // scipy stft boundary='zeros', padded=True: final center ceil(N/H)*H.
    const lastCenter=Math.ceil(final16/256)*256;
    let finalFrameCenter=(this.frames.length-1)*256;
    while(finalFrameCenter<lastCenter){let center=finalFrameCenter+256;
      for(let k=this.samples16;k<=center+255;k++)for(let ch=0;ch<7;ch++)this.ring16[ch][k%1024]=0;
      this._computeFrame(center);finalFrameCenter=center;
    }
    this._pipeline(true);
  }
  /** Returns saved 16 kHz arrays, including zero-filled gate. */
  result(){if(!this.final)throw Error('先執行 finish()');const n=this.outputLength;
    const raw=new Float32Array(n),mask=new Float32Array(n),gate=new Float32Array(n);
    for(let j=0;j<n;j++){let inv=this.norm[j]>1e-12?1/this.norm[j]:0;
      raw[j]=this.raw16[j];mask[j]=this.accMask[j]*inv;gate[j]=this.accGate[j]*inv;
    }
    return {raw,mask,gate,sampleRate:16000,gateOpenFraction:this.numGatedFrames?this.gatedOn/this.numGatedFrames:0,frames:this.numGatedFrames};
  }
}
