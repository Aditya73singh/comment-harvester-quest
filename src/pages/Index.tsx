
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

  const handleSearch = async (query: string, filterType: string) => {
    try {
      setIsLoading(true);
      setError(null);
      setHasSearched(true);
      setActiveFilter(filterType);
      
      const results = await searchComments(query, filterType);
      
      setComments(results);
      setIsLoading(false);
      
      if (results.length === 0) {
        toast({
          title: "No comments found",
          description: "Try a different search term or filter",
        });
      } else {
        const filterDescription = filterType !== 'all' 
          ? ` with ${filterType} filter` 
          : '';
          
        toast({
          title: `Found ${results.length} comments`,
          description: query 
            ? `Showing results for "${query}"${filterDescription}` 
            : `Showing popular comments${filterDescription}`,
        });
      }
      
    } catch (err) {
      setIsLoading(false);
      setError('Failed to fetch comments from Reddit. Please try again.');
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to fetch comments from Reddit. Please try again.",
      });
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex-1">
        <Header />
        <main className="container">
          <SearchBar onSearch={handleSearch} isLoading={isLoading} />
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
