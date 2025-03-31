import axios from 'axios';

export interface RedditComment {
  id: string;
  author: string;
  body: string;
  subreddit: string;
  upvotes: number;
  timestamp: string;
}

// Reddit API endpoints
const REDDIT_API_BASE = 'https://www.reddit.com';

export async function searchComments(query: string, filterType: string = 'all'): Promise<RedditComment[]> {
  try {
    let subreddits = ['technology', 'programming', 'JEE', 'btechtards', 'TeenIndia'];
    
    // If searching by subreddit, prioritize the query as a subreddit
    if (filterType === 'subreddit' && query) {
      subreddits = [query];
    }
    // Otherwise if no query, use the default subreddits
    else if (query && filterType !== 'subreddit') {
      // Keep the default subreddits
    }
    
    // We'll request multiple subreddits to get a variety of comments
    const requests = subreddits.map(subreddit => 
      axios.get(`${REDDIT_API_BASE}/r/${subreddit}.json?limit=10`)
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
                  
                  allComments.push({
                    id: comment.data.id,
                    author: comment.data.author,
                    body: comment.data.body,
                    subreddit: comment.data.subreddit,
                    upvotes: comment.data.ups,
                    timestamp: new Date(comment.data.created_utc * 1000).toISOString()
                  });
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
              filteredComments = allComments.filter(comment => 
                comment.body.toLowerCase().includes(query.toLowerCase())
              );
              break;
            case 'subreddit':
              // Already filtered by subreddit in the API request if possible
              // This is for exact matching
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
              filteredComments = allComments.filter(comment => 
                comment.body.toLowerCase().includes(query.toLowerCase()) ||
                comment.author.toLowerCase().includes(query.toLowerCase()) ||
                comment.subreddit.toLowerCase().includes(query.toLowerCase())
              );
              break;
          }
        }
        
        resolve(filteredComments);
      }, 2000); // Wait 2 seconds for comment data to start accumulating
    });
    
  } catch (error) {
    console.error('Error fetching Reddit data:', error);
    throw new Error('Failed to fetch comments from Reddit');
  }
}
