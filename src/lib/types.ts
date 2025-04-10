export interface RedditComment {
  id: string;
  author: string;
  body: string;
  subreddit: string;
  upvotes: number;
  awards?: number;
  timestamp: string;
  permalink?: string;
  score?: number;
  matchScore?: number;
}
