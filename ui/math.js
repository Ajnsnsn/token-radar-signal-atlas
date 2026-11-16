/* Shared, deterministic model arithmetic. Node and the offline page use this file. */
(() => {
  const parameters=Object.freeze({maxRows:140,priorWeight:6,growthFloor:-60,growthCap:100,growthExponent:.5,ageFloor:.75,ageRange:.25,ageCapDays:730,ratioWinsorLow:.1,ratioWinsorHigh:.9});
  const clamp=(v,lo,hi)=>Math.min(hi,Math.max(lo,v));
  function quantile(values,q){
    if(!values.length)throw Error('Cannot calibrate an empty peer set');
    const a=[...values].sort((x,y)=>x-y),p=(a.length-1)*q,i=Math.floor(p);
    return a[i]+(a[Math.min(i+1,a.length-1)]-a[i])*(p-i);
  }
  const growthFactor=g=>Math.pow(1+clamp(g??0,parameters.growthFloor,parameters.growthCap)/100,parameters.growthExponent);
  const ageFactor=(age,fallback)=>parameters.ageFloor+parameters.ageRange*clamp(age??fallback,0,parameters.ageCapDays)/parameters.ageCapDays;
  function calibratePeers(peers,categories){
    if(peers.length<3)throw Error('At least three observed-token valuation peers are required');
    const raw=peers.map(p=>Math.log(p.mcap/p.tvl)),lo=quantile(raw,.1),hi=quantile(raw,.9),logs=raw.map(v=>clamp(v,lo,hi));
    const median=quantile(logs,.5),q20=quantile(logs,.2),q80=quantile(logs,.8);
    const groups=categories.map(category=>{
      const g=peers.filter(p=>p.category===category).map(p=>clamp(Math.log(p.mcap/p.tvl),lo,hi)),w=g.length/(g.length+parameters.priorWeight);
      const blend=(q,f)=>Math.exp(w*(g.length?quantile(g,q):f)+(1-w)*f);
      return {category,n:g.length,weight:Number(w.toFixed(6)),ratio:blend(.5,median),lowRatio:blend(.2,q20),highRatio:blend(.8,q80)};
    });
    return {peers,categories:groups,globalRatio:Math.exp(median),lowRatio:Math.exp(lo),highRatio:Math.exp(hi)};
  }
  function estimate(p,c,fallbackAge){
    const growthMult=growthFactor(p.growth),ageMult=ageFactor(p.age,fallbackAge);
    // Keep the same multiplication order and rounded category weight as Atlas 01.
    const value=clamp(Math.round(p.tvl*c.ratio*growthMult*ageMult),1,1e14);
    const expansion=Math.exp(.20+.25*(1-c.weight)+(p.age===null?.15:0)+(p.growth===null?.15:0));
    const low=Math.max(1,Math.min(value,Math.round(p.tvl*c.lowRatio*growthMult*ageMult/expansion)));
    const high=Math.max(value,Math.min(1e14,Math.round(p.tvl*c.highRatio*growthMult*ageMult*expansion)));
    return {value,low,high,growthMult,ageMult,expansion};
  }
  function nearestPeers(p,peers){
    const same=peers.filter(q=>q.category===p.category);
    return (same.length?same:peers).slice().sort((a,b)=>Math.abs(Math.log(a.tvl/p.tvl))-Math.abs(Math.log(b.tvl/p.tvl))||a.slug.localeCompare(b.slug)).slice(0,3).map(q=>q.slug);
  }
  function auditPeers(peers,fallbackAge){
    const categories=[...new Set(peers.map(p=>p.category))];
    const folds=peers.map(p=>{
      // Inputs are already one representative per token. Removing its key removes
      // every representative of that token; no smaller duplicate is reintroduced.
      const train=peers.filter(q=>q.tokenKey!==p.tokenKey),c=calibratePeers(train,categories).categories.find(c=>c.category===p.category);
      const prediction=estimate(p,c,fallbackAge),bias=prediction.value/p.mcap;
      return {slug:p.slug,tokenKey:p.tokenKey,excludedRecords:p.duplicateCount,trainingPeers:train.length,peerN:c.n,...prediction,error:Math.max(bias,1/bias),bias,covered:p.mcap>=prediction.low&&p.mcap<=prediction.high};
    });
    const covered=folds.filter(f=>f.covered).length;
    return {folds,count:folds.length,covered,coverage:covered/folds.length,medianError:quantile(folds.map(f=>f.error),.5),medianBias:quantile(folds.map(f=>f.bias),.5),fallbackAge};
  }
  function decode(d){
    const slug=a=>a[0]||a[1].toLowerCase().replace(/\s+/g,'-');
    const peers=d.peers.map(a=>({slug:slug(a),name:a[1],category:d.categories[a[2]],tvl:a[3],mcap:a[4],ratio:a[4]/a[3],tokenKey:a[5]||slug(a),growth:a[6],age:a[7],duplicateCount:a[8]}));
    const calibration=calibratePeers(peers,d.categories),model={...d.model,...calibration,parameters,peerCount:peers.length,ratioWinsor:[calibration.lowRatio,calibration.highRatio]};
    const rows=d.rows.map((a,i)=>{
      const r={slug:slug(a),name:a[1],category:d.categories[a[2]],chains:a[3].map(j=>d.chains[j]),tvl:a[4],growth:a[5],age:a[6],watch:!!a[7],rank:i+1};
      const c=model.categories.find(c=>c.category===r.category);
      return {...r,...estimate(r,c,model.fallbackAge),ratio:c.ratio,peerN:c.n,peerSlugs:nearestPeers(r,peers),confidence:c.n>=6&&r.age!==null&&r.growth!==null?'stronger':c.n>=3&&r.age!==null?'moderate':'limited',listedAt:r.age===null?null:new Date(Date.parse(d.asOf+'T00:00:00Z')-r.age*86400000).toISOString().slice(0,10)};
    });
    return {rows,peers,model,audit:auditPeers(peers,model.fallbackAge)};
  }
  globalThis.AtlasMath={parameters,clamp,quantile,growthFactor,ageFactor,calibratePeers,estimate,nearestPeers,auditPeers,decode};
})();
