const CATEGORY_KEYWORDS = {
  gaming: ['nintendo', 'sony', 'playstation', 'xbox', 'microsoft gaming', 'sega', 'atari', 'retro', 'console', 'game', 'gaming', 'steam', 'epic games', 'roblox', 'minecraft', 'fortnite', 'rpg', 'fps', 'arcade', 'pixel', 'emulator', 'rom', 'modding', 'speedrun', 'esports', 'twitch', 'nvidia rtx', 'gpu gaming', 'handheld', 'nintendo switch', 'ps5', 'xbox series', 'wii', 'game boy', 'pokemon', 'zelda', 'mario', 'sonic', 'final fantasy', 'call of duty', 'grand theft auto', 'rockstar', 'bethesda', 'ubisoft', 'electronic arts', 'ea sports', 'fifa', 'madden', 'nba 2k', 'pc gaming', 'indie game', 'kickstarter game'],
  ai: ['artificial intelligence', 'machine learning', 'deep learning', 'neural network', 'llm', 'gpt', 'chatgpt', 'openai', 'claude', 'gemini', 'copilot', 'ai model', 'ai agent', 'ai tool', 'ai assistant', 'ai image', 'ai video', 'generative ai', 'diffusion', 'transformer', 'fine-tuning', 'hugging face', 'stable diffusion', 'midjourney', 'ai chip', 'ai processor', 'ai startup', 'ai safety', 'ai regulation'],
  robotics: ['robot', 'robotics', 'humanoid', 'drone', 'autonomous', 'boston dynamics', 'tesla bot', 'optimus', 'robotaxi', 'self-driving', 'automation', 'robotic arm', 'cyberdyne', 'mechatronics', 'servo', 'sensor fusion', 'lidar', 'slam'],
  cybersecurity: ['cyber', 'hack', 'breach', 'ransomware', 'malware', 'phishing', 'zero-day', 'vulnerability', 'exploit', 'encryption', 'firewall', 'security', 'cyberattack', 'cybercrime', 'data leak', 'privacy', 'gdpr', 'cve', 'patch', 'incident response', 'penetration test', 'bug bounty', 'dark web'],
  space: ['spacex', 'nasa', 'esa', 'rocket', 'starship', 'falcon', 'launch', 'satellite', 'iss', 'mars', 'moon', 'lunar', 'orbit', 'telescope', 'james webb', 'hubble', 'astronaut', 'cosmos', 'galaxy', 'exoplanet', 'asteroid', 'space station', 'blue origin', 'virgin galactic', 'starlink', 'space force'],
  quantum: ['quantum', 'qubit', 'superposition', 'entanglement', 'quantum computing', 'ibm quantum', 'google quantum', 'sycamore', 'quantum supremacy', 'quantum error', 'quantum processor', 'quantum algorithm', 'quantum cryptography'],
  biotech: ['biotech', 'biotechnology', 'gene', 'dna', 'rna', 'crispr', 'vaccine', 'clinical trial', 'fda', 'drug', 'therapy', 'medical breakthrough', 'genome', 'protein', 'cell', 'tissue', 'organ', 'bionic', 'prosthetic', 'neuro', 'brain-computer', 'neuralink', 'synthetic biology', 'bioinformatics'],
  programming: ['javascript', 'python', 'rust', 'typescript', 'react', 'node', 'api', 'sdk', 'open source', 'github', 'docker', 'kubernetes', 'devops', 'backend', 'frontend', 'full stack', 'algorithm', 'data structure', 'compiler', 'framework', 'library', 'package', 'npm', 'pip', 'cargo', 'language', 'programming', 'developer', 'coding', 'software engineering', 'code review', 'tech stack'],
  sports: ['nfl', 'nba', 'mlb', 'nhl', 'premier league', 'la liga', 'serie a', 'bundesliga', 'champions league', 'super bowl', 'world cup', 'olympics', 'f1', 'formula 1', 'ufc', 'boxing', 'tennis', 'golf', 'cricket', 'soccer', 'football', 'basketball', 'baseball', 'hockey', 'athlete', 'coach', 'trade', 'draft', 'championship', 'playoff', 'stadium', 'arena'],
  politics: ['president', 'congress', 'senate', 'parliament', 'election', 'vote', 'policy', 'legislation', 'regulation', 'law', 'supreme court', 'governor', 'mayor', 'cabinet', 'diplomacy', 'treaty', 'sanctions', 'tariff', 'budget', 'tax', 'republican', 'democrat', 'labour', 'conservative', 'prime minister', 'chancellor', 'political', 'government', 'administration'],
  science: ['physics', 'chemistry', 'biology', 'mathematics', 'discovery', 'research', 'study', 'scientists', 'experiment', 'laboratory', 'nature', 'science journal', 'peer review', 'breakthrough', 'theory', 'hypothesis', 'particle', 'cern', 'lhc', 'fusion', 'nuclear', 'renewable', 'solar', 'battery', 'energy', 'climate', 'environment'],
  technology: ['tech', 'apple', 'google', 'microsoft', 'meta', 'amazon', 'nvidia', 'intel', 'amd', 'qualcomm', 'samsung', 'xiaomi', 'huawei', 'software', 'hardware', 'update', 'launch', 'release', 'smartphone', 'laptop', 'tablet', 'wearable', 'ios', 'android', 'windows', 'linux', 'macos', 'startup', 'innovation', 'digital'],
  lifestyle: ['fashion', 'beauty', 'food', 'travel', 'wellness', 'fitness', 'health', 'lifestyle', 'trend', 'culture', 'design', 'art', 'music', 'film', 'entertainment', 'celebrity', 'influencer', 'social media', 'tiktok', 'instagram', 'youtube', 'netflix', 'spotify', 'disney'],
}

const CATEGORY_ORDER = ['gaming', 'ai', 'robotics', 'cybersecurity', 'space', 'quantum', 'biotech', 'programming', 'sports', 'politics', 'science', 'technology', 'lifestyle']

export class CategoryClassifier {
  classify(article) {
    const title = (article.title || '').toLowerCase()
    const desc = (article.description || '').toLowerCase()
    const source = (article.source || '').toLowerCase()
    const text = `${title} ${desc} ${source}`
    const categoryMap = article.category ? { [CATEGORY_ORDER.indexOf(article.category.toLowerCase())]: article.category.toLowerCase() } : {}

    let bestCategory = 'technology'
    let bestScore = 0

    for (const cat of CATEGORY_ORDER) {
      const keywords = CATEGORY_KEYWORDS[cat] || []
      let score = 0
      for (const kw of keywords) {
        if (text.includes(kw)) score++
      }
      if (article.category && article.category.toLowerCase() === cat) score += 2
      if (score > bestScore) { bestScore = score; bestCategory = cat }
    }

    return {
      category: bestCategory,
      confidence: Math.min(1, bestScore / 5),
      keywords: CATEGORY_KEYWORDS[bestCategory]?.filter(k => text.includes(k)).slice(0, 5) || [],
    }
  }
}
