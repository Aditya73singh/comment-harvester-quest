// Add a simple cache system for search results
const searchCache = new Map<string, {
  timestamp: number,
  results: RedditComment[]
}>();

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes cache duration

function getCacheKey(query: string, filterType: string): string {
  return `${query.toLowerCase()}_${filterType}`;
}

async function getFromCache(query: string, filterType: string): Promise<RedditComment[] | null> {
  const key = getCacheKey(query, filterType);
  const cached = searchCache.get(key);
  
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.results;
  }
  
  return null;
}

function saveToCache(query: string, filterType: string, results: RedditComment[]): void {
  const key = getCacheKey(query, filterType);
  searchCache.set(key, {
    timestamp: Date.now(),
    results
  });
}

// Modify searchComments to use caching
export async function searchComments(query: string, filterType: string = 'all'): Promise<RedditComment[]> {
  try {
    // Check cache first
    const cachedResults = await getFromCache(query, filterType);
    if (cachedResults) {
      return cachedResults;
    }
    
    // ... existing fetch logic ...
    
    // Save results to cache before returning
    saveToCache(query, filterType, filteredComments);
    return filteredComments;
    
  } catch (error) {
    console.error('Error fetching Reddit data:', error);
    return mockComments;
  }
}
