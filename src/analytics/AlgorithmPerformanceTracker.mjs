import fs from 'fs'; import path from 'path'
const DB_PATH = 'data/analytics/algorithm_performance.json'

export class AlgorithmPerformanceTracker {
  constructor(){ this.dbPath = DB_PATH; this.data = this._load() }
  _load(){ try{ return JSON.parse(fs.readFileSync(this.dbPath,'utf8')) }catch{ return { algos: {}, history: [] } } }
  _save(){ try{ fs.mkdirSync(path.dirname(this.dbPath),{recursive:true}); fs.writeFileSync(this.dbPath, JSON.stringify(this.data, null, 2)) }catch{} }
  
  trackRender(article, algorithm, concept){
    const entry = {
      timestamp: Date.now(),
      algoNumber: algorithm.number,
      algoId: algorithm.id,
      niche: algorithm.niche,
      hook: algorithm.hook,
      arc: algorithm.arc,
      visual: algorithm.visual.id,
      tone: algorithm.tone.id,
      structure: algorithm.structure.id,
      title: article.title,
      category: article.category,
      heroImage: concept.heroImage,
      overlayText: concept.overlayText,
    }
    if(!this.data.algos[algorithm.number]) this.data.algos[algorithm.number] = { count:0, titles:[], niches:{}, visuals:{}, tones:{} }
    const a = this.data.algos[algorithm.number]
    a.count++; a.titles.push(article.title.slice(0,60))
    a.niches[algorithm.niche] = (a.niches[algorithm.niche]||0)+1
    a.visuals[algorithm.visual.id] = (a.visuals[algorithm.visual.id]||0)+1
    a.tones[algorithm.tone.id] = (a.tones[algorithm.tone.id]||0)+1
    this.data.history.push(entry)
    if(this.data.history.length>200) this.data.history = this.data.history.slice(-200)
    this._save()
    return entry
  }

  trackPerformance(algoNumber, metrics){
    // metrics: { retention: 0-100, ctr: 0-100, views, likes }
    if(!this.data.algos[algoNumber]) return
    const a = this.data.algos[algoNumber]
    if(!a.perf) a.perf = { totalViews:0, avgRetention:0, avgCtr:0, count:0 }
    a.perf.totalViews += metrics.views||0
    a.perf.avgRetention = ((a.perf.avgRetention * a.perf.count) + (metrics.retention||0)) / (a.perf.count+1)
    a.perf.avgCtr = ((a.perf.avgCtr * a.perf.count) + (metrics.ctr||0)) / (a.perf.count+1)
    a.perf.count++
    this._save()
  }

  getTopAlgos(limit=10){
    return Object.entries(this.data.algos)
      .map(([num, d])=>({ number: parseInt(num), count: d.count, avgRetention: d.perf?.avgRetention||0, avgCtr: d.perf?.avgCtr||0, score: (d.perf?.avgRetention||50)*0.6 + (d.perf?.avgCtr||5)*8 }))
      .sort((a,b)=>b.score-a.score)
      .slice(0,limit)
  }

  getDiversityReport(){
    const recent = this.data.history.slice(-20)
    const uniquePhotos = new Set(recent.map(r=>r.heroImage)).size
    const uniqueAlgos = new Set(recent.map(r=>r.algoNumber)).size
    const uniqueVisuals = new Set(recent.map(r=>r.visual)).size
    const uniqueTones = new Set(recent.map(r=>r.tone)).size
    const duplicatePhotos = recent.length - uniquePhotos
    return {
      last20: recent.length,
      uniquePhotos,
      uniqueAlgos,
      uniqueVisuals,
      uniqueTones,
      duplicatePhotos,
      isDiverse: duplicatePhotos===0 && uniqueAlgos>=Math.min(10, recent.length),
      topAlgos: this.getTopAlgos(5),
      recent
    }
  }

  verifyNoActuallySee(text){ return !/actually see/i.test(text) }
}

export const tracker = new AlgorithmPerformanceTracker()
