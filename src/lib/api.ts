import axios from 'axios';

export interface RedditComment {
  id: string;
  author: string;
  body: string;
  subreddit: string;
  upvotes: number;
  timestamp: string;
  matchScore?: number; // Score for matching search terms
  score?: number;      // Combined score for sorting
}

// Reddit API credentials and endpoints
const REDDIT_CLIENT_ID = 'xmNNjvzBns1KvnjE5M7WEg';
const REDDIT_CLIENT_SECRET = 'N39e8RHrhC0XhHnxzUEhwkq5tbrJWw';
const REDDIT_API_BASE = 'https://oauth.reddit.com';
const REDDIT_AUTH_URL = 'https://www.reddit.com/api/v1/access_token';

// Store OAuth token
let accessToken: string | null = null;
let tokenExpiration: number = 0;

// Add a simple cache system for search results
const searchCache = new Map<string, {
  timestamp: number,
  results: RedditComment[]
}>();

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes cache duration

// Helper function to escape regex special characters in user input
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

// Get OAuth token for Reddit API
async function getRedditAccessToken(): Promise<string> {
  // If we have a valid token, return it
  if (accessToken && Date.now() < tokenExpiration) {
    return accessToken;
  }
  
  try {
    // Make a request to get a new token using client credentials
    const authString = btoa(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`);
    
    const response = await axios({
      method: 'post',
      url: REDDIT_AUTH_URL,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${authString}`
      },
      data: 'grant_type=client_credentials',
    });
    
    // Save the token and its expiration
    accessToken = response.data.access_token;
    // Set expiration to slightly before actual expiry to be safe
    tokenExpiration = Date.now() + (response.data.expires_in * 1000) - 60000;
    
    console.log('Successfully obtained Reddit access token');
    return accessToken;
  } catch (error) {
    console.error('Error getting Reddit access token:', error);
    throw new Error('Failed to authenticate with Reddit API');
  }
}

// Make an authenticated request to Reddit API
async function redditApiRequest(url: string): Promise<any> {
  try {
    const token = await getRedditAccessToken();
    
    const response = await axios({
      method: 'get',
      url,
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'web:CommentHarvester:v1.0 (by /u/commentharvester)'
      }
    });
    
    return response.data;
  } catch (error) {
    console.error('Error making Reddit API request:', error);
    throw error;
  }
}

// Mock data to use when API fails
const mockComments: RedditComment[] = [
  {
    id: 'mock1',
    author: 'tech_enthusiast',
    body: 'I find that modern programming languages like Rust and Go are gaining popularity because they address memory safety and concurrency issues that older languages struggle with.',
    subreddit: 'programming',
    upvotes: 128,
    timestamp: new Date().toISOString()
  },
  {
    id: 'mock2',
    author: 'science_lover',
    body: 'The James Webb Space Telescope has revolutionized our understanding of distant galaxies. The images we\'re getting show galaxy formations from much earlier in the universe\'s history than ever before.',
    subreddit: 'science',
    upvotes: 243,
    timestamp: new Date().toISOString()
  },
  {
    id: 'mock3',
    author: 'design_thinker',
    body: 'Apple\'s design philosophy has always prioritized simplicity and user experience over feature bloat. This is why their products feel cohesive despite having fewer customization options.',
    subreddit: 'technology',
    upvotes: 87,
    timestamp: new Date().toISOString()
  }
];

/**
 * Search for Reddit comments based on query and filter type
 * 
 * @param query - The search terms
 * @param filterType - Type of filtering ('all', 'keyword', 'subreddit', 'author')
 * @param limit - Maximum number of results to return
 * @returns Promise with array of RedditComment objects
 */
export async function searchComments(query: string, filterType: string = 'all', limit: number = 20): Promise<RedditComment[]> {
  try {
    // Check cache first
    const cachedResults = await getFromCache(query, filterType);
    if (cachedResults) {
      return cachedResults.slice(0, limit);
    }

    // Parse the query into individual words for multi-word searching
    const searchTerms = query.toLowerCase().trim().split(/\s+/).filter(term => term.length > 0);
    
    // Create regexes for more robust matching
    const regexes = searchTerms.map(term => new RegExp(escapeRegex(term), 'gi'));
    
    // Starting point - either use specific subreddit or search more broadly
    let subreddits: string[] = [];
    let useDefaultSubreddits = true;
    
    // If searching by subreddit, prioritize the query as a subreddit
    if (filterType === 'subreddit' && query) {
      // For subreddit search, use the query directly as a subreddit name
      subreddits = [query];
      useDefaultSubreddits = false;
    } 
    
    // If we should use defaults or query is empty
    if (useDefaultSubreddits) {
      // Include popular subreddits for general searches
      subreddits = [
        'technology', 'programming', 'JEE', 'btechtards', 'TeenIndia',
        'AskReddit', 'explainlikeimfive', 'science', 'todayilearned', 'worldnews'
      ];
      
      // Add "all" to search across all of Reddit
      if (filterType !== 'subreddit') {
        subreddits.push('all');
      }
    }
    
    // Make requests to each subreddit
    const requests = subreddits.map(subreddit => 
      redditApiRequest(`${REDDIT_API_BASE}/r/${subreddit}/hot.json?limit=${Math.min(25, limit)}`)
        .catch(err => {
          console.warn(`Error fetching from r/${subreddit}:`, err);
          return { data: { children: [] } }; // Return empty result on error
        })
    );
    
    const responses = await Promise.allSettled(requests);
    
    // Transform Reddit's API response into our RedditComment format
    const allComments: RedditComment[] = [];
    const commentRequests: Promise<void>[] = [];
    
    responses.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value?.data?.children) {
        const posts = result.value.data.children;
        
        posts.forEach((post: any) => {
          // Get the comments for this post
          const commentUrl = `${REDDIT_API_BASE}${post.data.permalink}.json`;
          
          // We need to make another request to get the comments
          const commentPromise = redditApiRequest(commentUrl)
            .then(commentResponse => {
              // The second element in the array contains comments
              if (commentResponse && commentResponse.length > 1) {
                const comments = commentResponse[1].data.children;
                
                comments.forEach((comment: any) => {
                  // Skip deleted comments and AutoModerator
                  if (comment.kind === 't1' && 
                      comment.data.body && 
                      comment.data.author !== 'AutoModerator' && 
                      comment.data.author !== '[deleted]') {
                    
                    const commentData: RedditComment = {
                      id: comment.data.id,
                      author: comment.data.author,
                      body: comment.data.body,
                      subreddit: comment.data.subreddit,
                      upvotes: comment.data.ups,
                      timestamp: new Date(comment.data.created_utc * 1000).toISOString()
                    };
                    
                    allComments.push(commentData);
                  }
                });
              }
            })
            .catch(error => {
              console.error('Error fetching comments:', error);
            });
            
          commentRequests.push(commentPromise);
        });
      }
    });
    
    // Return mock data if we don't have any successful responses after a timeout
    return new Promise((resolve) => {
      // First wait for some comments to load
      setTimeout(async () => {
        // Try to wait for at least a few comment requests to complete
        if (commentRequests.length > 0) {
          await Promise.allSettled(commentRequests.slice(0, 5));
        }
        
        // If no comments were fetched, use mock data
        if (allComments.length === 0) {
          console.log('Using mock data as fallback since API returned no comments');
          
          // Filter mock data based on query terms if provided
          let filteredMockComments = [...mockComments];
          
          if (searchTerms.length > 0) {
            filteredMockComments = mockComments.filter(comment => {
              const commentText = comment.body.toLowerCase();
              const authorText = comment.author.toLowerCase();
              const subredditText = comment.subreddit.toLowerCase();
              
              let matchCount = 0;
              
              // Check each search term against different fields
              searchTerms.forEach(term => {
                if (commentText.includes(term)) matchCount++;
                if (authorText.includes(term)) matchCount++;
                if (subredditText.includes(term)) matchCount++;
              });
              
              // Only include comments that match at least one term
              if (matchCount > 0) {
                comment.matchScore = matchCount;
                return true;
              }
              return false;
            });
          }
          
          // Calculate scores using regex matching and upvotes
          filteredMockComments = filteredMockComments.map(comment => {
            let matchCount = 0;
            
            // Count regex matches
            regexes.forEach(re => {
              const matches = comment.body.match(re);
              if (matches) {
                matchCount += matches.length;
              }
            });
            
            // Calculate combined score with upvotes
            comment.score = matchCount + (comment.upvotes / 100);
            return comment;
          });
          
          // Sort by score descending
          filteredMockComments.sort((a, b) => (b.score || 0) - (a.score || 0));
          
          // Cache the results
          saveToCache(query, filterType, filteredMockComments);
          
          // Return limited results
          resolve(filteredMockComments.slice(0, limit));
          return;
        }
        
        let filteredComments = allComments;
        
        // Apply filtering based on the filter type
        if (query) {
          switch (filterType) {
            case 'keyword':
              filteredComments = allComments.filter(comment => {
                const commentText = comment.body.toLowerCase();
                // Calculate how many search terms match in this comment using regex
                let matchCount = 0;
                regexes.forEach(re => {
                  const matches = comment.body.match(re);
                  if (matches) matchCount += matches.length;
                });
                
                // Only include comments that match at least one term
                if (matchCount > 0) {
                  comment.matchScore = matchCount;
                  // Calculate combined score with upvotes
                  comment.score = matchCount + (comment.upvotes / 100);
                  return true;
                }
                return false;
              });
              break;
            case 'subreddit':
              // For subreddit filter, include any comment whose subreddit matches the query exactly
              filteredComments = allComments.filter(comment => 
                comment.subreddit.toLowerCase() === query.toLowerCase()
              );
              // Calculate scores for sorting
              filteredComments = filteredComments.map(comment => {
                comment.score = comment.upvotes / 100; // Base score on upvotes for subreddit filter
                return comment;
              });
              break;
            case 'author':
              filteredComments = allComments.filter(comment => 
                comment.author.toLowerCase().includes(query.toLowerCase())
              );
              // Calculate scores for sorting
              filteredComments = filteredComments.map(comment => {
                comment.score = comment.upvotes / 100; // Base score on upvotes for author filter
                return comment;
              });
              break;
            case 'all':
            default:
              filteredComments = allComments.filter(comment => {
                const commentText = comment.body.toLowerCase();
                const authorText = comment.author.toLowerCase();
                const subredditText = comment.subreddit.toLowerCase();
                
                // Calculate match score based on regex matches across fields
                let matchCount = 0;
                
                // Count regex matches in comment text
                regexes.forEach(re => {
                  const bodyMatches = comment.body.match(re);
                  if (bodyMatches) matchCount += bodyMatches.length;
                  
                  // Check author and subreddit too
                  if (re.test(authorText)) matchCount++;
                  if (re.test(subredditText)) matchCount++;
                });
                
                // Only include comments that match at least one term
                if (matchCount > 0) {
                  comment.matchScore = matchCount;
                  // Calculate combined score with upvotes
                  comment.score = matchCount + (comment.upvotes / 100);
                  return true;
                }
                return false;
              });
              break;
          }
        }
        
        // Sort results by score, putting comments with better overall scores first
        filteredComments.sort((a, b) => {
          // Default to 0 if score is undefined
          const scoreA = a.score || 0;
          const scoreB = b.score || 0;
          
          return scoreB - scoreA;
        });
        
        // Cache results before limiting
        saveToCache(query, filterType, filteredComments);
        
        // Limit results
        resolve(filteredComments.slice(0, limit));
      }, 2000); // Wait 2 seconds for comment data to start accumulating
    });
    
  } catch (error) {
    console.error('Error fetching Reddit data:', error);
    // Return mock data on error
    const filteredMockComments = mockComments.slice(0, limit);
    
    // Apply basic scoring to mock data
    filteredMockComments.forEach(comment => {
      comment.score = comment.upvotes / 100;
    });
    
    return filteredMockComments;
  }
}
