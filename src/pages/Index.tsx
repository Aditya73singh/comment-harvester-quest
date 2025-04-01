
import React, { useState } from 'react';
import Header from '../components/Header';
import SearchBar from '../components/SearchBar';
import CommentList from '../components/CommentList';
import { RedditComment, searchComments } from '../lib/api';
import { toast } from '@/components/ui/use-toast';

const Index: React.FC = () => {
  const [comments, setComments] = useState<RedditComment[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState<boolean>(false);
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const handleSearch = async (query: string, filterType: string) => {
    try {
      setIsLoading(true);
      setError(null);
      setHasSearched(true);
      setActiveFilter(filterType);
      setSearchQuery(query);
      
      const results = await searchComments(query, filterType);
      
      setComments(results);
      setIsLoading(false);
      
      if (results.length === 0) {
        toast({
          title: "No comments found",
          description: "Try a different search term or filter",
        });
      } else {
        // Count how many search terms were used
        const searchTermCount = query.trim().split(/\s+/).filter(term => term.length > 0).length;
        const searchTermText = searchTermCount > 1 ? `${searchTermCount} keywords` : "keyword";
        
        const filterDescription = filterType !== 'all' 
          ? ` with ${filterType} filter` 
          : ' across all of Reddit';
          
        toast({
          title: `Found ${results.length} comments`,
          description: query 
            ? `Showing results for ${searchTermText}: "${query}"${filterDescription}` 
            : `Showing results${filterDescription}`,
        });
      }
      
    } catch (err) {
      setIsLoading(false);
      const errorMessage = "Failed to fetch comments from Reddit. Using backup data.";
      setError(errorMessage);
      toast({
        variant: "destructive",
        title: "Error",
        description: errorMessage,
      });
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex-1">
        <Header />
        <main className="container">
          <SearchBar onSearch={handleSearch} isLoading={isLoading} />
          
          {searchQuery && comments.length > 0 && (
            <div className="text-center text-sm text-muted-foreground mb-6">
              <p>Results ranked by most matching terms first</p>
            </div>
          )}
          
          <CommentList 
            comments={comments} 
            isLoading={isLoading} 
            error={error} 
            filterType={activeFilter}
          />
          
          {!hasSearched && (
            <div className="absolute bottom-8 left-0 right-0 flex justify-center animate-fade-in opacity-70">
              <div className="glass px-4 py-2 rounded-full text-xs text-muted-foreground">
                Search for a topic or subreddit above to find real Reddit comments
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default Index;
