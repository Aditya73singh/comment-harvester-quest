
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

  const handleSearch = async (query: string) => {
    try {
      setIsLoading(true);
      setError(null);
      setHasSearched(true);
      
      const results = await searchComments(query);
      
      // Small delay for animation smoothness
      setTimeout(() => {
        setComments(results);
        setIsLoading(false);
        
        if (results.length === 0) {
          toast({
            title: "No results found",
            description: "Try a different search term",
          });
        } else {
          toast({
            title: `Found ${results.length} comments`,
            description: "Showing the most relevant results",
          });
        }
      }, 800);
      
    } catch (err) {
      setIsLoading(false);
      setError('Failed to fetch comments. Please try again.');
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to fetch comments. Please try again.",
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
          />
          
          {!hasSearched && (
            <div className="absolute bottom-8 left-0 right-0 flex justify-center animate-fade-in opacity-70">
              <div className="glass px-4 py-2 rounded-full text-xs text-muted-foreground">
                Use the search bar above to find comments
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default Index;
