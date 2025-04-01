
import axios from 'axios';

export interface RedditComment {
  id: string;
  author: string;
  body: string;
  subreddit: string;
  upvotes: number;
  timestamp: string;
  matchScore?: number; // Score for matching search terms
}

// Reddit API credentials and endpoints
const REDDIT_CLIENT_ID = 'xmNNjvzBns1KvnjE5M7WEg';
const REDDIT_API_BASE = 'https://oauth.reddit.com';
const REDDIT_AUTH_URL = 'https://www.reddit.com/api/v1/access_token';

// Store OAuth token
let accessToken: string | null = null;
let tokenExpiration: number = 0;

// Get OAuth token for Reddit API
async function getRedditAccessToken(): Promise<string> {
  // If we have a valid token, return it
  if (accessToken && Date.now() < tokenExpiration) {
    return accessToken;
  }
  
  try {
    // Make a request to get a new token
    const response = await axios({
      method: 'post',
      url: REDDIT_AUTH_URL,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${btoa(`${REDDIT_CLIENT_ID}:`)}`
      },
      data: 'grant_type=client_credentials',
    });
    
    // Save the token and its expiration
    accessToken = response.data.access_token;
    // Set expiration to slightly before actual expiry to be safe
    tokenExpiration = Date.now() + (response.data.expires_in * 1000) - 60000;
    
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

export async function searchComments(query: string, filterType: string = 'all'): Promise<RedditComment[]> {
  try {
    // Parse the query into individual words for multi-word searching
    const searchTerms = query.toLowerCase().trim().split(/\s+/).filter(term => term.length > 0);
    
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
      redditApiRequest(`${REDDIT_API_BASE}/r/${subreddit}/hot.json?limit=20`)
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
    
    // For immediate results without waiting for all comment requests,
    // we'll implement a timeout and return whatever comments we have so far
    return new Promise(resolve => {
      // First wait for some comments to load
      setTimeout(async () => {
        // Try to wait for at least a few comment requests to complete
        if (commentRequests.length > 0) {
          await Promise.allSettled(commentRequests.slice(0, 5));
        }
        
        let filteredComments = allComments;
        
        // Apply filtering based on the filter type
        if (query) {
          switch (filterType) {
            case 'keyword':
              filteredComments = allComments.filter(comment => {
                const commentText = comment.body.toLowerCase();
                // Calculate how many search terms match in this comment
                const matchCount = searchTerms.filter(term => commentText.includes(term)).length;
                // Only include comments that match at least one term
                if (matchCount > 0) {
                  comment.matchScore = matchCount;
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
              break;
            case 'author':
              filteredComments = allComments.filter(comment => 
                comment.author.toLowerCase().includes(query.toLowerCase())
              );
              break;
            case 'all':
            default:
              filteredComments = allComments.filter(comment => {
                const commentText = comment.body.toLowerCase();
                const authorText = comment.author.toLowerCase();
                const subredditText = comment.subreddit.toLowerCase();
                
                // Calculate match score based on how many search terms appear in the comment
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
              break;
          }
        }
        
        // Sort results by match score, putting comments with more matching terms first
        filteredComments.sort((a, b) => {
          // Default to 0 if matchScore is undefined
          const scoreA = a.matchScore || 0;
          const scoreB = b.matchScore || 0;
          
          // Sort by match score first (higher is better)
          if (scoreB !== scoreA) {
            return scoreB - scoreA;
          }
          
          // If match scores are equal, sort by upvotes
          return b.upvotes - a.upvotes;
        });
        
        resolve(filteredComments);
      }, 2000); // Wait 2 seconds for comment data to start accumulating
    });
    
  } catch (error) {
    console.error('Error fetching Reddit data:', error);
    throw new Error('Failed to fetch comments from Reddit');
  }
}
