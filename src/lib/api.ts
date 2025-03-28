
import axios from 'axios';

// Mock API for frontend development (replace with real Reddit API integration)
const API_URL = 'https://jsonplaceholder.typicode.com/comments';

export interface RedditComment {
  id: string;
  author: string;
  body: string;
  subreddit: string;
  upvotes: number;
  timestamp: string;
}

// Expanded list of subreddits for more variety
const SUBREDDITS = [
  'technology', 'design', 'apple', 'programming', 'minimalism',
  'gaming', 'movies', 'science', 'askreddit', 'worldnews',
  'politics', 'music', 'books', 'food', 'travel',
  'photography', 'diy', 'fitness', 'funny', 'todayilearned'
];

export async function searchComments(query: string): Promise<RedditComment[]> {
  // For demo purposes, we'll use jsonplaceholder and transform the data
  try {
    // Fetch more comments by getting multiple postIds
    const requests = [1, 2, 3, 4, 5].map(postId => 
      axios.get(`${API_URL}?postId=${postId}`)
    );
    
    const responses = await Promise.all(requests);
    
    // Combine and transform all the data
    const allComments: RedditComment[] = [];
    
    responses.forEach(response => {
      const comments: RedditComment[] = response.data.map((comment: any) => ({
        id: comment.id.toString(),
        author: comment.email.split('@')[0],
        body: comment.body,
        subreddit: SUBREDDITS[Math.floor(Math.random() * SUBREDDITS.length)],
        upvotes: Math.floor(Math.random() * 10000),
        timestamp: new Date(Date.now() - Math.floor(Math.random() * 10000000000)).toISOString()
      }));
      
      allComments.push(...comments);
    });
    
    // Simple filtering based on query
    return query 
      ? allComments.filter(comment => 
          comment.body.toLowerCase().includes(query.toLowerCase()) ||
          comment.author.toLowerCase().includes(query.toLowerCase()) ||
          comment.subreddit.toLowerCase().includes(query.toLowerCase())
        )
      : allComments.slice(0, 30); // Limit to 30 comments when no query to avoid overwhelming the UI
  } catch (error) {
    console.error('Error fetching comments:', error);
    throw new Error('Failed to fetch comments');
  }
}
