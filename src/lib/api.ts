
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

// Reddit API endpoints
const REDDIT_API_BASE = 'https://www.reddit.com';

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
      axios.get(`${REDDIT_API_BASE}/r/${subreddit}.json?limit=20`)
    );
    
    const responses = await Promise.all(requests);
    
    // Transform Reddit's API response into our RedditComment format
    const allComments: RedditComment[] = [];
    
    responses.forEach(response => {
      const posts = response.data.data.children;
      
      posts.forEach((post: any) => {
        // Get the comments for this post
        const commentUrl = `${REDDIT_API_BASE}${post.data.permalink}.json`;
        
        // We need to make another request to get the comments
        axios.get(commentUrl)
          .then(commentResponse => {
            // The second element in the array contains comments
            if (commentResponse.data && commentResponse.data.length > 1) {
              const comments = commentResponse.data[1].data.children;
              
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
      });
    });
    
    // For immediate results without waiting for all comment requests,
    // we'll implement a timeout and return whatever comments we have so far
    return new Promise(resolve => {
      setTimeout(() => {
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
